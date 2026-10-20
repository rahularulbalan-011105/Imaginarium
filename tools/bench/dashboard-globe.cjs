// Dashboard check with a MOCKED collector: proves the globe panel, the places
// table and the KPI card render from real analyze() output.
const { chromium } = require('playwright')
const SHOT = process.env.TEMP + '/claude/c--projects-toolsapp/3e3f0685-ad03-44d8-9027-22bd69c573b2/scratchpad/'

const HEADERS = ['received', 'env', 'eid', 'app', 'event', 'email', 'vid', 'sid',
  'source', 'medium', 'campaign', 'content', 'term', 'ref', 'referrer',
  'page', 'device', 'value', 'meta', 'client_ts', 'tz', 'lang']

const PLACES = [
  ['Asia/Kolkata', 'en-IN', 22], ['Asia/Dubai', 'en-AE', 4], ['Europe/London', 'en-GB', 6],
  ['America/New_York', 'en-US', 9], ['America/Sao_Paulo', 'pt-BR', 3], ['Africa/Lagos', 'en-NG', 5],
  ['Asia/Tokyo', 'ja-JP', 4], ['Australia/Sydney', 'en-AU', 2], ['Asia/Srednekolymsk', 'ru-RU', 1],
]
const rows = []
let n = 0
const t0 = Date.now() - 3 * 24 * 3600 * 1000
for (const [tz, lang, count] of PLACES) {
  for (let i = 0; i < count; i++) {
    const vid = 'v' + (++n), email = i % 3 === 0 ? `u${n}@example.com` : ''
    const at = new Date(t0 + n * 60000).toISOString()
    rows.push([at, 'prod', 'e' + n + 'a', 'landing', 'landing_view', email, vid, 's' + n, 'whatsapp', 'chat', 'launch', '', '', '', '', '/', 'desktop', '', '', at, tz, lang])
    rows.push([at, 'prod', 'e' + n + 'b', 'editor', 'editor_open', email, vid, 's' + n, 'whatsapp', 'chat', 'launch', '', '', '', '', '/', 'desktop', '', '', at, tz, lang])
    if (email) rows.push([at, 'prod', 'e' + n + 'c', 'editor', 'code_run', email, vid, 's' + n, 'whatsapp', 'chat', 'launch', '', '', '', '', '/', 'desktop', '', '', at, tz, lang])
  }
}
// one legacy row from before the location columns existed
rows.push([new Date(t0).toISOString(), 'prod', 'eold', 'editor', 'editor_open', '', 'vold', 'sold', 'whatsapp', '', '', '', '', '', '', '/', 'desktop', '', '', ''])

;(async () => {
  const br = await chromium.launch()
  const pg = await br.newPage({ viewport: { width: 1500, height: 1000 } })
  const errs = []
  pg.on('pageerror', e => errs.push(e.message))
  await pg.route('**script.google.com/**', (route) => {
    const u = new URL(route.request().url())
    const what = u.searchParams.get('what')
    const body = what === 'links' ? { ok: true, rows: [] }
      : what === 'ping' ? { ok: true, keySet: true }
      : { ok: true, headers: HEADERS, rows }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await pg.goto('http://localhost:5176/Imaginarium/utm-dashboard.html', { waitUntil: 'load' })
  await pg.waitForTimeout(1200)
  const key = pg.locator('#key')
  if (await key.isVisible().catch(() => false)) { await key.fill('test-key'); await pg.locator('#unlock').click() }
  await pg.waitForTimeout(2500)

  const legend = await pg.locator('#globeLegend').textContent()
  console.log('legend: ' + legend)
  const kpi = await pg.locator('.cards').innerText()
  console.log('countries KPI: ' + (/Countries\s*\n?\s*/.test(kpi) ? kpi.split('\n').slice(-6).join(' | ') : 'MISSING'))
  const places = await pg.locator('#t_places tbody tr').allInnerTexts()
  console.log('places rows: ' + places.length)
  console.log(places.slice(0, 4).map(r => r.replace(/\s+/g, ' ')).join('  //  '))
  await pg.locator('#globe').scrollIntoViewIfNeeded()
  await pg.waitForTimeout(1500)
  await pg.screenshot({ path: SHOT + 'dash-globe.png' })
  // hover a dot → tooltip
  const box = await pg.locator('#globe').boundingBox()
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await pg.waitForTimeout(400)
  // click the top row → globe flies there
  await pg.locator('#t_places tbody tr').first().click()
  await pg.waitForTimeout(900)
  await pg.screenshot({ path: SHOT + 'dash-globe2.png' })
  console.log('page errors: ' + JSON.stringify(errs))
  await br.close()
})().catch(e => { console.log('HARNESS ' + e.message); process.exit(1) })
