// Runtime benchmark (dev server). Same scenarios against any build of the app:
//   node tools/bench/runtime.cjs http://localhost:5173/Imaginarium/ <label>
//
// Scenarios (each measured, never just "it ran"):
//   drag      React components re-rendered + JS ms per transform update (gizmo drag)
//   idle      React commits and render-loop JS work over 3 s with nothing happening
//   scale     100 / 500 / 1000 primitives: create time, draw calls, triangles, render ms
//   churn     create+delete 20 GLB parts × 5 cycles: GPU geometries/textures must not grow
// Uses a React DevTools-style hook to count rendered components per commit.
const { chromium } = require('playwright')
const url = process.argv[2], label = process.argv[3] || 'run'

;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => console.error('[pageerror]', e.message))
  await page.addInitScript(() => {
    try { localStorage.setItem('tinkerbot.welcomeSeen.v1', '1') } catch {}
    // Count function components that performed work in each React commit.
    const stats = { commits: 0, rendered: 0, names: {} }
    window.__renderStats = stats
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject() { return 1 }, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      onCommitFiberRoot(_id, root) {
        stats.commits++
        // DevTools-style: a subtree whose child list is identical to the previous
        // commit bailed out (was not rendered) — don't descend into it, or stale
        // "performed work" flags from older renders get counted.
        const walk = (next, prev) => {
          if (typeof next.type === 'function' && (next.flags & 1)) {
            stats.rendered++
            if (stats.track) { const n = next.type.displayName || next.type.name || 'anon'; stats.names[n] = (stats.names[n] || 0) + 1 }
          }
          if (prev && next.child === prev.child) return
          for (let c = next.child; c; c = c.sibling) walk(c, c.alternate)
        }
        walk(root.current, root.current.alternate)
      },
    }
  })
  await page.goto(url + '?app=1', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 120000 })
  await page.waitForTimeout(4000)

  const out = await page.evaluate(async () => {
    const B = location.pathname.replace(/\/$/, '') + '/src/'
    const { useSceneStore } = await import(B + 'stores/sceneStore.js')
    const { sceneManager } = await import(B + 'managers/SceneManager.js')
    const { objectManager } = await import(B + 'managers/ObjectManager.js')
    const ML = await import(B + 'utils/modelLoader.js')
    const frame = () => new Promise(r => requestAnimationFrame(() => r()))
    const settle = async (n = 3) => { for (let i = 0; i < n; i++) await frame() }
    const S = () => useSceneStore.getState()
    const R = window.__renderStats
    const res = {}

    // ── drag: 60 object objects on screen, drag one of them ────────────────────
    for (let i = 0; i < 60; i++) { const o = S().addObject(['box', 'sphere', 'cylinder'][i % 3]); S().updateObject(o.id, { position: { x: (i % 10) * 3 - 15, y: 1, z: Math.floor(i / 10) * 3 - 9 } }) }
    await settle(10)
    const target = S().objects[0].id
    S().selectObject(target)
    await settle(10)
    let c0 = R.commits, r0 = R.rendered, ms = 0
    R.track = true; R.names = {}
    for (let i = 0; i < 60; i++) {
      const t = performance.now()
      S().updateObject(target, { position: { x: -15 + i * 0.1, y: 1, z: -9 } })
      await new Promise(r => setTimeout(r, 0))          // let React commit
      ms += performance.now() - t
      await frame()
    }
    R.track = false
    res.dragTop = Object.entries(R.names).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `${n}:${(c / 60).toFixed(1)}`).join(' ')
    res.drag = { componentsPerUpdate: +((R.rendered - r0) / 60).toFixed(1), commitsPerUpdate: +((R.commits - c0) / 60).toFixed(2), jsMsPerUpdate: +(ms / 60).toFixed(2) }

    // ── idle: nothing happens for 3 s (object selected) ─────────────────────────
    await settle(10)
    c0 = R.commits; r0 = R.rendered
    const tick0 = performance.now()
    let busy = 0, frames = 0, last = performance.now()
    await new Promise(done => {
      const f = () => {
        const now = performance.now(); frames++
        if (now - tick0 < 3000) { requestAnimationFrame(f) } else done()
        last = now
      }
      requestAnimationFrame(f)
    })
    void busy; void last
    res.idle = { reactCommits: R.commits - c0, componentsRendered: R.rendered - r0, frames }

    // ── scale: 100 / 500 / 1000 primitives ──────────────────────────────────────
    res.scale = {}
    for (const n of [100, 500, 1000]) {
      for (const o of [...S().objects]) S().removeObject?.(o.id)
      await settle(5)
      const t = performance.now()
      const ids = []
      for (let i = 0; i < n; i++) ids.push(S().addObject(['box', 'sphere', 'cylinder', 'cone'][i % 4]).id)
      await settle(2)
      const createMs = performance.now() - t
      // Spread them out so they're all visible
      useSceneStore.setState({ objects: S().objects.map((o, i) => ({ ...o, position: { x: (i % 32) * 2.2 - 35, y: 1, z: Math.floor(i / 32) * 2.2 - 35 } })) })
      await settle(5)
      const r = sceneManager.renderer
      let rt = 0
      for (let k = 0; k < 20; k++) { const t0 = performance.now(); r.render(sceneManager.scene, sceneManager.camera); rt += performance.now() - t0 }
      res.scale[n] = { createMs: Math.round(createMs), calls: r.info.render.calls, triangles: r.info.render.triangles, renderMs: +(rt / 20).toFixed(2), geometries: r.info.memory.geometries }
    }
    // ── Objects panel open with 1000 objects: drag one ─────────────────────────
    {
      const { useUiStore } = await import(B + 'stores/uiStore.js')
      useUiStore.getState().setActivePanel('objects')
      await settle(10)
      const id = S().objects[500].id
      S().selectObject(id); await settle(5)
      const r0 = R.rendered, t = performance.now()
      for (let i = 0; i < 30; i++) {
        S().updateObject(id, { position: { x: i * 0.1, y: 1, z: 0 } })
        await new Promise(r => setTimeout(r, 0)); await frame()
      }
      res.objectList1000 = { componentsPerUpdate: +((R.rendered - r0) / 30).toFixed(1), msPerUpdate: +((performance.now() - t) / 30).toFixed(1), domRows: document.querySelectorAll('[data-tour] .group, .group').length }
      useUiStore.getState().setActivePanel('properties')
      await settle(5)
    }
    for (const o of [...S().objects]) S().removeObject?.(o.id)
    await settle(5)

    // ── churn: create + delete 20 servos, 5 times ───────────────────────────────
    if (ML.ensureModels) await ML.ensureModels(['servo'])
    const mem = []
    for (let cycle = 0; cycle < 5; cycle++) {
      const ids = []
      for (let i = 0; i < 20; i++) ids.push(S().addObject('servo').id)
      await settle(4)
      for (const id of ids) S().removeObject?.(id)
      await settle(4)
      const m = sceneManager.renderer.info.memory
      mem.push(`${m.geometries}/${m.textures}`)
    }
    res.churn = { geometriesTexturesAfterEachCycle: mem.join('  '), meshesLeft: objectManager.objects.size }
    res.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
    return res
  })
  console.log(JSON.stringify({ label, ...out }, null, 1))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
