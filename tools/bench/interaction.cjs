// Interaction benchmark against a PRODUCTION build (no access to app internals —
// it drives the real UI like a user). Real GPU, optional CPU slowdown + high-DPI.
//   npm run build && npx vite preview --port 4180     (or any served build)
//   node tools/bench/interaction.cjs http://localhost:4180/Imaginarium/ <label> [cpuSlowdown=4] [dpr=2]
//
// Scene: the 4-wheel-chassis preset + 60 cubes added with the "3" shortcut.
// Measures frame time while (1) nudging the selected cube with the arrow keys
// (store update → mesh → panels → paint, the same path as a gizmo drag),
// (2) orbiting with the mouse, (3) sitting idle; plus long tasks (>50 ms).
const { chromium } = require('playwright')
const [url, label = 'run', cpu = '4', dpr = '2'] = process.argv.slice(2)

;(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: +dpr })
  page.on('pageerror', e => console.error('[pageerror]', e.message))
  await page.addInitScript(() => {
    try { localStorage.setItem('tinkerbot.welcomeSeen.v1', '1') } catch {}
    window.__lt = []
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ type: 'longtask' }) } catch {}
    window.__rec = (on) => {
      if (!on) { window.__recOn = false; return window.__dts }
      window.__dts = []; window.__recOn = true; let last = performance.now()
      const f = () => { if (!window.__recOn) return; const t = performance.now(); window.__dts.push(t - last); last = t; requestAnimationFrame(f) }
      requestAnimationFrame(f)
    }
  })
  await page.goto(url + '?app=1', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 120000 })
  await page.waitForTimeout(3000)
  const preset = await (await fetch(new URL('presets/4-wheel-chassis.json', url))).json()
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('constructa:load-project', { detail: d })), preset)
  await page.waitForTimeout(3000)
  const box = await page.locator('canvas').first().boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.click(box.x + 40, box.y + box.height - 40)       // focus the viewport (empty corner)
  for (let i = 0; i < 60; i++) { await page.keyboard.press('3'); await page.waitForTimeout(20) }
  await page.waitForTimeout(2500)
  if (+cpu > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu }) }
  await page.waitForTimeout(1500)

  const stats = (a) => { const s = [...a].slice(3).sort((x, y) => x - y); const q = p => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1); return { frames: s.length, p50: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(1) } }
  const measure = async (fn) => {
    await page.evaluate(() => { window.__lt.length = 0; window.__rec(true) })
    await fn()
    const dts = await page.evaluate(() => window.__rec(false))
    const lt = await page.evaluate(() => window.__lt.slice())
    return { ...stats(dts), longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, b) => a + b, 0)) }
  }
  const out = { label, cpuSlowdown: +cpu, dpr: +dpr }
  out.nudge = await measure(async () => { for (let i = 0; i < 120; i++) { await page.keyboard.press(i % 40 < 20 ? 'ArrowRight' : 'ArrowLeft'); await page.waitForTimeout(16) } })
  out.orbit = await measure(async () => {
    await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' })
    for (let i = 0; i < 120; i++) { await page.mouse.move(cx + Math.sin(i / 15) * 200, cy + Math.cos(i / 20) * 60); await page.waitForTimeout(16) }
    await page.mouse.up({ button: 'middle' })
  })
  out.idle = await page.evaluate(async () => {
    // count paints by watching the canvas' GL draw calls is impossible from outside;
    // instead report main-thread busy time over 3 s of idling
    window.__lt.length = 0; const t0 = performance.now(); let busy = 0, last = t0
    await new Promise(done => { const f = () => { const t = performance.now(); if (t - last > 20) busy += t - last - 16.7; last = t; if (t - t0 < 3000) requestAnimationFrame(f); else done() }; requestAnimationFrame(f) })
    return { longTasks: window.__lt.length, jankMs: Math.round(busy) }
  })
  console.log(JSON.stringify(out))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
