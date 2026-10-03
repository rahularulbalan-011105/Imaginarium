// Startup benchmark: production build served locally, measured in Chromium with
// DevTools CPU/network emulation. Usage: npm run build && npx vite preview --port 4180, then
//   node tools/bench/startup.cjs http://localhost:4180/Imaginarium/ <label>
const { chromium } = require('playwright')
const url = process.argv[2]
const label = process.argv[3] || 'run'

const PROFILES = {
  fast:    { cpu: 1, down: 0, up: 0, lat: 0 },                              // no throttling
  average: { cpu: 4, down: 25e6 / 8, up: 5e6 / 8, lat: 20 },                // 25 Mbps, 4× slower CPU
  low:     { cpu: 6, down: 8e6 / 8, up: 2e6 / 8, lat: 60 },                 // 8 Mbps, 6× slower CPU
}

async function run(profileName) {
  const P = PROFILES[profileName]
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  if (P.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu })
  if (P.down) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: P.lat, downloadThroughput: P.down, uploadThroughput: P.up })
  const bytes = { js: 0, glb: 0, wasm: 0, other: 0 }, reqs = []
  const types = new Map()
  cdp.on('Network.responseReceived', e => types.set(e.requestId, e.response.url))
  cdp.on('Network.loadingFinished', e => {
    const u = types.get(e.requestId) || ''
    const k = /\.js(\?|$)/.test(u) ? 'js' : /\.glb/.test(u) ? 'glb' : /\.wasm/.test(u) ? 'wasm' : 'other'
    bytes[k] += e.encodedDataLength
    if (k === 'glb' || k === 'js') reqs.push({ u: u.split('/').pop().split('?')[0], kb: Math.round(e.encodedDataLength / 1024), t: Date.now() })
  })
  await page.addInitScript(() => {
    window.__lt = []
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch {}
    // Skip first-run overlays so they don't block the measurement.
    try { localStorage.setItem('tinkerbot.welcomeSeen.v1', '1') } catch {}
  })
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'commit' })
  const fcp = await page.evaluate(() => new Promise(r => {
    const f = () => { const e = performance.getEntriesByName('first-contentful-paint')[0]; if (e) r(e.startTime); else setTimeout(f, 20) }; f()
  }))
  // Workspace usable = editor mounted and the viewport canvas has drawn.
  await page.waitForSelector('canvas', { timeout: 180000 })
  const workspace = await page.evaluate(() => performance.now())
  await page.waitForTimeout(1500)
  const m = await page.evaluate(() => ({
    lt: window.__lt, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  }))
  const ltBefore = m.lt.filter(([s]) => s < workspace)
  const out = {
    profile: profileName, fcp_ms: Math.round(fcp), workspace_ms: Math.round(workspace),
    js_kb: Math.round(bytes.js / 1024), glb_kb: Math.round(bytes.glb / 1024), wasm_kb: Math.round(bytes.wasm / 1024),
    longtasks_before_workspace: ltBefore.length, longtask_ms_before_workspace: Math.round(ltBefore.reduce((s, [, d]) => s + d, 0)),
    heap_mb: m.heap, wall_ms: Date.now() - t0,
    requests: reqs.filter(r => r.kb > 20).map(r => `${r.u}:${r.kb}KB`).join(' '),
  }
  await browser.close()
  return out
}

;(async () => {
  const which = (process.argv[4] || 'fast,average,low').split(',')
  const results = []
  for (const p of which) results.push(await run(p))
  console.log(JSON.stringify({ label, results }, null, 1))
})().catch(e => { console.error(e); process.exit(1) })
