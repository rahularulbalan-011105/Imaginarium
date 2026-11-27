// Render the starter-project pictures (public/thumbs/preset_<file>.webp) by
// opening each preset in the real editor, framing the whole build and
// capturing the 3D view.
//
//   npm run dev                                   (must be running)
//   node tools/thumbs/render-preset-thumbs.cjs
const { chromium } = require('playwright')
const { readdirSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const base = process.env.DEV_URL ?? 'http://localhost:5173/Imaginarium/'
const files = readdirSync(join('public', 'presets')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))

;(async () => {
  let browser
  for (const ch of ['msedge', 'chrome', 'chromium']) {
    try { browser = await chromium.launch(ch === 'chromium' ? {} : { channel: ch }); break } catch { /* next */ }
  }
  if (!browser) throw new Error('No Chromium-based browser found')
  mkdirSync(join('public', 'thumbs'), { recursive: true })
  for (const file of files) {
    const page = await browser.newPage({ viewport: { width: 760, height: 560 } })
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.evaluate(async ({ base, file }) => {
      const data = await (await fetch(`${base}presets/${file}.json`)).json()
      window.dispatchEvent(new CustomEvent('constructa:load-project', { detail: data }))
    }, { base, file })
    await page.waitForTimeout(4000)
    // Frame every part from a three-quarter view; hide the grid, gizmo and all UI.
    await page.evaluate(async (base) => {
      // Import the SAME module instances the app runs (in dev, Vite adds ?t=… /
      // ?v=… to some URLs; a bare URL would load a second, empty copy).
      const urls = performance.getEntriesByType('resource').map((e) => e.name)
      const mod = (path) => import(urls.find((u) => u.includes(path)) ?? base + path)
      const THREE = await mod('node_modules/.vite/deps/three.js')
      const { sceneManager } = await mod('src/managers/SceneManager.js')
      const { objectManager } = await mod('src/managers/ObjectManager.js')
      const { useSceneStore } = await mod('src/stores/sceneStore.js')
      const { useUiStore } = await mod('src/stores/uiStore.js')
      useSceneStore.getState().selectObject?.(null)
      useUiStore.getState().setPanelOpen(false)
      if (useSceneStore.getState().gridVisible) useSceneStore.getState().toggleGrid()
      if (useSceneStore.getState().axesVisible) useSceneStore.getState().toggleAxes()
      const box = new THREE.Box3()
      for (const m of objectManager.getAllMeshes()) if (m.visible) box.expandByObject(m)
      const center = box.getCenter(new THREE.Vector3())
      const r = box.getBoundingSphere(new THREE.Sphere()).radius
      const cam = sceneManager.camera
      const dir = new THREE.Vector3(1, 0.85, 1.2).normalize()
      cam.position.copy(center).addScaledVector(dir, r / Math.sin((cam.fov * Math.PI) / 360) * 0.85)
      sceneManager.orbitControls.target.copy(center)
      sceneManager.orbitControls.update()
      sceneManager.requestRender?.(500)
      const style = document.createElement('style')
      style.textContent = 'header,nav,footer,[role=toolbar],[role=dialog],[aria-label="View cube"],.absolute:not(canvas){visibility:hidden!important}'
      document.head.appendChild(style)
    }, base)
    await page.waitForTimeout(1200)
    const canvas = page.locator('canvas').first()
    const bb = await canvas.boundingBox()
    const w = Math.min(bb.width, bb.height * 1.6), h = w / 1.6
    await page.screenshot({
      path: join('public', 'thumbs', `preset_${file}.png`),
      clip: { x: bb.x + (bb.width - w) / 2, y: bb.y + (bb.height - h) / 2, width: w, height: h },
    })
    // Convert to a small WebP in the page (keeps the repo light).
    const png = require('node:fs').readFileSync(join('public', 'thumbs', `preset_${file}.png`)).toString('base64')
    const webp = await page.evaluate(async (png) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode()
      const c = document.createElement('canvas'); c.width = 400; c.height = 250
      c.getContext('2d').drawImage(img, 0, 0, 400, 250)
      return c.toDataURL('image/webp', 0.85).split(',')[1]
    }, png)
    require('node:fs').writeFileSync(join('public', 'thumbs', `preset_${file}.webp`), Buffer.from(webp, 'base64'))
    require('node:fs').unlinkSync(join('public', 'thumbs', `preset_${file}.png`))
    console.log(`preset_${file}.webp`)
    await page.close()
  }
  await browser.close()
})().catch((e) => { console.error(e.message ?? e); process.exit(1) })
