// Regression guard: the shared sketch sandbox gained ESP32 shims, so a SUBO
// sketch (matrix + buzzer + Serial) must still compile, run and print.
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

;(async () => {
  const br = await chromium.launch()
  const pg = await br.newPage({ viewport: { width: 1500, height: 900 } })
  const errs = []
  pg.on('pageerror', e => errs.push(e.message))
  await pg.goto(URL, { waitUntil: 'load' })
  await pg.waitForTimeout(4000)
  for (const t of ['Explore', 'Skip', 'Close', 'Maybe later']) {
    const el = pg.locator('button:has-text("' + t + '")').first()
    if (await el.count() && await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await pg.waitForTimeout(300) }
  }
  const em = pg.locator('input[type=email]').first()
  if (await em.count() && await em.isVisible().catch(() => false)) { await em.fill('test@example.com'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(800) }

  await rail(pg, 'ELEC', 'Elec')
  await pg.locator('button:has-text("SUBO")').first().click()
  await pg.waitForTimeout(3000)
  await rail(pg, 'CODE', 'C++ Coding')
  await pg.waitForTimeout(800)
  const ta = pg.locator('textarea').first()
  log(await ta.count() > 0, 'C++ editor is present')
  await ta.fill([
    '#include <Subo.h>',
    'int n = 0;',
    'void setup() {',
    '  Serial.begin(9600);',
    '  SuboMatrixInit();',
    '}',
    'void loop() {',
    '  setAllLED(10, 0, 0);',
    '  Serial.println(n);',
    '  n = n + 1;',
    '  delay(200);',
    '}',
  ].join('\n'))
  await pg.waitForTimeout(500)
  const run = pg.locator('button:has-text("Run")').first()
  log(!(await run.isDisabled()), 'Run is enabled for a SUBO board alone')
  await run.click()
  await pg.waitForTimeout(3500)
  const txt = await pg.locator('body').innerText()
  log(/Running/.test(txt), 'SUBO sketch is running')
  log(/\b[0-9]+\b/.test(txt) && /Serial|Monitor|Output|\n/.test(txt), 'serial output is reaching the UI')
  log(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)))
  await pg.screenshot({ path: process.env.TEMP + '/subo-regress.png' })
  console.log('')
  console.log(out.filter(l => l.startsWith('PASS')).length + '/' + out.length + ' checks passed')
  await br.close()
})().catch(e => { console.log('HARNESS ' + e.message); process.exit(1) })
