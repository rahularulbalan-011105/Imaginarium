// Render the part-picker thumbnails (public/thumbs/<type>.webp) from the real
// part models, so the Parts panel shows pictures instead of names.
//
//   npm run dev                              (must be running)
//   node tools/thumbs/render-thumbs.cjs
//
// Re-run after adding a part or changing a part's model.
const { chromium } = require('playwright')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const base = process.env.DEV_URL ?? 'http://localhost:5173/Imaginarium/'

;(async () => {
  let browser
  for (const ch of ['msedge', 'chrome', 'chromium']) {
    try { browser = await chromium.launch(ch === 'chromium' ? {} : { channel: ch }); break } catch { /* next */ }
  }
  if (!browser) throw new Error('No Chromium-based browser found')
  const page = await browser.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()) })
  await page.goto(`${base}tools/thumbs/thumbRender.js`, { waitUntil: 'domcontentloaded' })
  const thumbs = await page.evaluate(async (base) => {
    const { renderThumbs } = await import(`${base}tools/thumbs/thumbRender.js`)
    return renderThumbs(160)
  }, base)
  await browser.close()
  const dir = join('public', 'thumbs')
  mkdirSync(dir, { recursive: true })
  for (const [key, url] of Object.entries(thumbs)) {
    const buf = Buffer.from(url.split(',')[1], 'base64')
    writeFileSync(join(dir, `${key}.webp`), buf)
    console.log(`${key}.webp  ${(buf.length / 1024).toFixed(1)} KB`)
  }
})().catch((e) => { console.error(e.message ?? e); process.exit(1) })
