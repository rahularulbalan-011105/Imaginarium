// Frame-cost benchmark on the machine's REAL GPU (Benchmarks A–D, F + in-app E).
//   npx vite --port 5173                         (dev server: the bench imports app modules)
//   node tools/bench/frames.cjs http://localhost:5173/Imaginarium/ <label> [cpuSlowdown=1] [gpu=d3d11|swiftshader] [devicePixelRatio=1]
//
// Every render is timed with gl.finish() so the number includes the GPU's work,
// not just command submission (bench-only; the app never calls finish()).
//   A  empty editor      idle paints/s and GPU ms spent per idle second
//   B  CAD scene         60 primitives + 6 GLB parts: idle, orbit (camera only), drag (object moves)
//   C  large assets      45 GLB parts: load time, draw calls, triangles, orbit cost, GPU resources
//   D  robot assembly    real presets (4-wheel chassis, single leg) in edit mode
//   E  simulation        4-wheel chassis driving: frame time + physics telemetry
//   F  long session      5× (load preset → simulate → stop → new project): resources must not grow
const { chromium } = require('playwright')
const [url, label = 'run', cpu = '1', gpu = 'd3d11', dpr = '1'] = process.argv.slice(2)


;(async () => {
  const args = gpu === 'swiftshader' ? ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] : ['--use-angle=' + gpu, '--enable-gpu', '--ignore-gpu-blocklist']
  const browser = await chromium.launch({ args })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: +dpr })
  page.on('pageerror', e => console.error('[pageerror]', e.message))
  await page.addInitScript(() => { try { localStorage.setItem('tinkerbot.welcomeSeen.v1', '1') } catch {} })
  await page.goto(url + '?app=1', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 120000 })
  await page.waitForTimeout(3000)
  if (+cpu > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu }) }

  const out = await page.evaluate(async () => {
    const B = location.pathname.replace(/\/$/, '') + '/src/'
    const { useSceneStore } = await import(B + 'stores/sceneStore.js')
    const { useUiStore } = await import(B + 'stores/uiStore.js')
    const { sceneManager } = await import(B + 'managers/SceneManager.js')
    const { physicsManager } = await import(B + 'managers/physics/PhysicsManager.js')
    const { preparePhysics } = await import(B + 'managers/DriveManager.js')
    const ML = await import(B + 'utils/modelLoader.js')
    const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) }
    const S = () => useSceneStore.getState()
    const sm = sceneManager, r = sm.renderer, gl = r.getContext()
    const frame = () => new Promise(res => requestAnimationFrame(res))
    const wait = (ms) => new Promise(res => setTimeout(res, ms))
    const res = { gpu: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?' })(), pixelRatio: r.getPixelRatio(), profile: sm.quality?.profile }

    // Time every app render including GPU completion.
    const orig = r.render.bind(r)
    let log = null
    r.render = (s, c) => { const t = performance.now(); orig(s, c); if (log) { gl.finish(); log.push(performance.now() - t) } }
    // rAF callbacks per frame (detects duplicated loops across sessions)
    const rafOrig = window.requestAnimationFrame.bind(window); let rafCount = 0
    window.requestAnimationFrame = (cb) => { rafCount++; return rafOrig(cb) }
    const rafPerFrame = async () => { rafCount = 0; for (let i = 0; i < 30; i++) await frame(); return +(rafCount / 30).toFixed(2) }

    async function idle(ms = 3000) {
      await wait(1200); log = []; const t0 = performance.now(); await wait(ms)
      const secs = (performance.now() - t0) / 1000, l = log; log = null
      return { paintsPerSec: +(l.length / secs).toFixed(1), gpuMsPerSec: +(l.reduce((a, b) => a + b, 0) / secs).toFixed(1), msPerPaint: +(l.reduce((a, b) => a + b, 0) / Math.max(1, l.length)).toFixed(2) }
    }
    async function orbit(n = 120) {
      const c = sm.camera.position, ax = { x: 0, y: 1, z: 0, isVector3: true }
      log = []; const dt = []; let last = performance.now()
      for (let i = 0; i < n; i++) { c.applyAxisAngle(ax, 0.01); sm.camera.lookAt(0, 0, 0); sm.orbitControls.dispatchEvent({ type: 'change' }); await frame(); const t = performance.now(); dt.push(t - last); last = t }
      const l = log; log = null
      return { renderP50: pct(l, 0.5), renderP95: pct(l, 0.95), frameP95: pct(dt.slice(5), 0.95), calls: r.info.render.calls, tris: r.info.render.triangles }
    }
    async function drag(id, n = 120) {
      log = []; const dt = []; let last = performance.now()
      for (let i = 0; i < n; i++) { S().updateObject(id, { position: { x: Math.sin(i / 10) * 4, y: 1, z: 0 } }); await frame(); const t = performance.now(); dt.push(t - last); last = t }
      const l = log; log = null
      return { renderP50: pct(l, 0.5), renderP95: pct(l, 0.95), frameP50: pct(dt.slice(5), 0.5), frameP95: pct(dt.slice(5), 0.95) }
    }
    const mem = () => ({ geometries: r.info.memory.geometries, textures: r.info.memory.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, bodies: physicsManager.world ? physicsManager.world.bodies.len() : 0 })
    const loadProject = async (data) => { window.dispatchEvent(new CustomEvent('constructa:load-project', { detail: data })); for (let i = 0; i < 100 && S().objects.length !== (data.objects || []).length; i++) await wait(100); await wait(1500) }
    const preset = async (name) => (await fetch(location.pathname.replace(/\/$/, '') + '/presets/' + name + '.json')).json()
    const clear = async () => { await loadProject({ version: '1.1', objects: [] }) }

    // A — empty editor
    res.A_empty = { idle: await idle(), rafCallbacksPerFrame: await rafPerFrame(), ...mem() }

    // B — typical CAD scene
    for (let i = 0; i < 60; i++) { const o = S().addObject(['box', 'sphere', 'cylinder', 'cone'][i % 4]); S().updateObject(o.id, { position: { x: (i % 10) * 3 - 15, y: 1, z: Math.floor(i / 10) * 3 - 9 } }) }
    await ML.ensureModels(['arduino_uno', 'servo', 'motor_dc', 'ultrasonic', 'led', 'subo'])
    for (const [i, t] of ['arduino_uno', 'servo', 'motor_dc', 'ultrasonic', 'led', 'subo'].entries()) { const o = S().addObject(t); S().updateObject(o.id, { position: { x: i * 5 - 12, y: 1, z: 12 } }) }
    await wait(1500)
    S().selectObject(S().objects[0].id); await wait(500)
    res.B_cad = { idle: await idle(), orbit: await orbit(), drag: await drag(S().objects[0].id), ...mem() }
    S().clearSelection?.()

    // C — large asset scene: 45 GLB parts
    await clear()
    const keys = ['arduino_uno', 'subo', 'servo', 'motor_dc', 'motor_bo', 'led', 'free_wheels', 'ultrasonic', 'ir_sensor', 'gas_sensor', 'oled', 'buzzer', 'ldr', 'dht11', 'servo']
    const tl = performance.now(); await ML.ensureModels(keys); const loadMs = performance.now() - tl
    const tc = performance.now()
    for (let i = 0; i < 45; i++) { const k = keys[i % keys.length]; const o = k === 'free_wheels' ? null : S().addObject(k); if (o) S().updateObject(o.id, { position: { x: (i % 9) * 6 - 24, y: 1, z: Math.floor(i / 9) * 6 - 12 } }) }
    await wait(2000)
    res.C_assets = { modelLoadMs: Math.round(loadMs), createMs: Math.round(performance.now() - tc), parts: S().objects.length, idle: await idle(), orbit: await orbit(), ...mem() }

    // D — robot assemblies in edit mode
    res.D_robots = {}
    for (const p of ['4-wheel-chassis', 'single-leg', 'robotic-head']) {
      await loadProject(await preset(p))
      res.D_robots[p] = { parts: S().objects.length, idle: await idle(2000), orbit: await orbit(60), ...mem() }
    }

    // E — active simulation (wheeled chassis)
    await loadProject(await preset('4-wheel-chassis'))
    await preparePhysics()
    useUiStore.getState().setSimActive(true)
    await wait(1500)
    { log = []; const dt = []; let last = performance.now()
      for (let i = 0; i < 300; i++) { await frame(); const t = performance.now(); dt.push(t - last); last = t }
      const l = log; log = null
      res.E_sim = { frameP50: pct(dt, 0.5), frameP95: pct(dt, 0.95), renderP95: pct(l, 0.95), paints: l.length, ...mem() } }
    useUiStore.getState().setSimActive(false); await wait(800)

    // F — long session churn
    const before = { ...mem(), raf: await rafPerFrame() }
    const cycles = []
    for (let c = 0; c < 5; c++) {
      await loadProject(await preset(['4-wheel-chassis', 'single-leg', 'simple-claw'][c % 3]))
      useUiStore.getState().setSimActive(true); await wait(1200)
      useUiStore.getState().setSimActive(false); await wait(600)
      await clear()
      cycles.push(mem())
    }
    res.F_churn = { before, after: { ...mem(), raf: await rafPerFrame() }, cycles: cycles.map(m => `${m.geometries}g/${m.textures}t/${m.bodies}b/${m.heapMB}MB`).join('  ') }
    return res
  })
  console.log(JSON.stringify({ label, cpuSlowdown: +cpu, devicePixelRatio: +dpr, ...out }, null, 1))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
