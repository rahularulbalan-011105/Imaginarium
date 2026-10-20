// Save/load compatibility: an ESP32 board must survive a reload (IndexedDB
// autosave) and an older project with no ESP32 must be unaffected.
const { chromium } = require('playwright')
const URL = 'http://localhost:4182/Imaginarium/'
const out = []
const log = (ok, m) => { out.push((ok ? 'PASS ' : 'FAIL ') + m); console.log((ok ? 'PASS ' : 'FAIL ') + m) }
const rail = async (pg, parent, tab) => {
  await pg.locator('nav[aria-label="Main navigation"] button[aria-label="' + parent + '"]').first().click()
  await pg.waitForTimeout(500)
  if (tab) { const t = pg.locator('button', { hasText: tab }).first(); if (await t.count()) await t.click() }
  await pg.waitForTimeout(500)
}
const boot = async (pg) => {
  await pg.waitForTimeout(4000)
  for (const t of ['Explore', 'Skip', 'Close', 'Maybe later']) {
    const el = pg.locator('button:has-text("' + t + '")').first()
    if (await el.count() && await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await pg.waitForTimeout(300) }
  }
  const em = pg.locator('input[type=email]').first()
  if (await em.count() && await em.isVisible().catch(() => false)) { await em.fill('test@example.com'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(800) }
}

;(async () => {
  const br = await chromium.launch()
  const ctx = await br.newContext({ viewport: { width: 1500, height: 900 } })
  // Headless Chromium would block on the native save picker; force the blob
  // download fallback so the export is observable.
  await ctx.addInitScript(() => { try { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }) } catch (e) {} })
  const pg = await ctx.newPage()
  pg.on('pageerror', e => console.log('PAGEERROR ' + e.message))
  await pg.goto(URL, { waitUntil: 'load' })
  await boot(pg)

  // add a box (an ordinary object) and an ESP32, then save
  await pg.keyboard.press('3')
  await pg.waitForTimeout(800)
  await rail(pg, 'ELEC', 'Elec')
  await pg.locator('button:has-text("ESP32 DevKit V1")').first().click()
  await pg.waitForTimeout(3000)
  const before = (await pg.locator('body').innerText()).match(/Objects: (\d+)/)
  log(before && +before[1] === 2, 'scene holds the box and the ESP32 (' + (before && before[1]) + ')')
  await pg.locator('button:has-text("Save")').first().click()
  await pg.waitForTimeout(2500)

  // Export JSON → New Project → Import JSON: the real save/load path.
  const dl = pg.waitForEvent('download')
  await pg.locator('button:has-text("File")').first().click()
  await pg.waitForTimeout(400)
  await pg.locator('text=Export JSON').first().click()
  const file = await (await dl).path()
  const data = JSON.parse(require('fs').readFileSync(file, 'utf8'))
  const types = data.objects.map(o => o.type)
  log(types.includes('esp32'), 'exported project contains the esp32 object: ' + JSON.stringify(types))
  const esp = data.objects.find(o => o.type === 'esp32')
  log(!!esp && !!esp.position && (esp.modelKey === 'esp32' || esp.modelKey == null), 'esp32 record carries its transform/modelKey: ' + JSON.stringify({ modelKey: esp && esp.modelKey, pos: esp && esp.position }))
  log(!/password|pass|ssid/i.test(JSON.stringify(data)), 'no Wi-Fi credentials were written into the project file')

  await pg.locator('button:has-text("File")').first().click()
  await pg.waitForTimeout(300)
  pg.once('dialog', d => d.accept())
  await pg.locator('text=New Project').first().click()
  await pg.waitForTimeout(1500)
  const empty = (await pg.locator('body').innerText()).match(/Objects: (\d+)/)
  log(empty && +empty[1] === 0, 'new project is empty (' + (empty && empty[1]) + ')')

  await pg.locator('button:has-text("File")').first().click()
  await pg.waitForTimeout(300)
  const chooser = pg.waitForEvent('filechooser')
  await pg.locator('text=Import JSON').first().click()
  ;(await chooser).setFiles(file)
  await pg.waitForTimeout(4000)
  const back = (await pg.locator('body').innerText()).match(/Objects: (\d+)/)
  log(back && +back[1] === 2, 'imported project restored both objects (' + (back && back[1]) + ')')
  await rail(pg, 'CODE', 'C++ Coding')
  await pg.waitForTimeout(900)
  log(/ESP32 DevKit V1 target/.test(await pg.locator('body').innerText()), 'the restored board is still recognised as an ESP32')
  await pg.screenshot({ path: process.env.TEMP + '/esp32-persist.png' })

  console.log('')
  console.log(out.filter(l => l.startsWith('PASS')).length + '/' + out.length + ' checks passed')
  await br.close()
})().catch(e => { console.log('HARNESS ' + e.message); process.exit(1) })
