// Export a code-authored model (tools/models/<name>.model.js) to
// assets-src/models/<name>.glb — the editable source the optimise step reads.
//
//   npm run dev                                  (must be running)
//   node tools/models/export-model.cjs l298n
//   npm run optimize:models l298n                (→ public/models/l298n.glb)
//
// Uses Playwright with an installed Chromium-based browser (Edge or Chrome by
// default — set EXPORT_BROWSER=chromium to use Playwright's own build). The
// browser is needed because the models draw canvas textures (PCB silkscreen).
const { chromium } = require('playwright')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const name = process.argv[2]
const base = process.env.DEV_URL ?? 'http://localhost:5173/Imaginarium/'
if (!name) { console.error('usage: node tools/models/export-model.cjs <name>'); process.exit(1) }

;(async () => {
  const pref = process.env.EXPORT_BROWSER
  const channels = pref ? [pref] : ['msedge', 'chrome', 'chromium']
  let browser
  for (const ch of channels) {
    try { browser = await chromium.launch(ch === 'chromium' ? {} : { channel: ch }); break } catch { /* try next */ }
  }
  if (!browser) throw new Error('No Chromium-based browser found (install Edge/Chrome, or run `npx playwright install chromium`)')
  const page = await browser.newPage()
  // Open a plain file from the dev server (same origin, but no app boot that
  // could navigate away mid-export), then import the exporter as a module.
  await page.goto(`${base}tools/models/glbExport.js`, { waitUntil: 'domcontentloaded' })
  const res = await page.evaluate(async ({ base, name }) => {
    const { exportModelGLB } = await import(`${base}tools/models/glbExport.js`)
    return exportModelGLB(name)
  }, { base, name })
  await browser.close()
  const out = join('assets-src', 'models', `${name}.glb`)
  mkdirSync(join('assets-src', 'models'), { recursive: true })
  writeFileSync(out, Buffer.from(res.base64, 'base64'))
  console.log(`${out}: ${(res.bytes / 1024).toFixed(0)} KB · ${res.meshes} meshes · ${res.tris} triangles`)
})().catch((e) => { console.error(e.message ?? e); process.exit(1) })
