const { chromium } = require('playwright')
const URL = 'http://localhost:4182/Imaginarium/'
const SHOT = process.env.TEMP + '/claude/c--projects-toolsapp/3e3f0685-ad03-44d8-9027-22bd69c573b2/scratchpad/'
const out = []
const log = (ok, msg) => { out.push((ok ? 'PASS ' : 'FAIL ') + msg); console.log((ok ? 'PASS ' : 'FAIL ') + msg) }
// The right-hand rail is two levels: a parent button (aria-label) then a tab.
const rail = async (pg, parent, tab) => {
  await pg.locator(`nav[aria-label="Main navigation"] button[aria-label="${parent}"]`).first().click()
  await pg.waitForTimeout(500)
  if (tab) {
    const t = pg.locator('button', { hasText: tab }).first()
    if (await t.count()) await t.click()
  }
  await pg.waitForTimeout(500)
}

;(async () => {
  const br = await chromium.launch()
  const pg = await br.newPage({ viewport: { width: 1600, height: 950 } })
  pg.on('pageerror', e => console.log('PAGEERROR ' + e.message))
  await pg.goto(URL, { waitUntil: 'load' })
  await pg.waitForTimeout(4000)
  for (const t of ['Explore', 'Skip', 'Close', 'Maybe later']) {
    const el = pg.locator('button:has-text("' + t + '")').first()
    if (await el.count() && await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await pg.waitForTimeout(400) }
  }
  const em = pg.locator('input[type=email]').first()
  if (await em.count() && await em.isVisible().catch(() => false)) {
    await em.fill('test@example.com'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1000)
  }

  // 1. add an ESP32 from the Electronics section
  await rail(pg, 'ELEC', 'Elec')
  await pg.waitForTimeout(700)
  const esp = pg.locator('button:has-text("ESP32 DevKit V1")').first()
  log(await esp.count() > 0, 'ESP32 entry exists in the Electronics library')
  await esp.click()
  await pg.waitForTimeout(3500)
  await pg.screenshot({ path: SHOT + 'esp32-after-add.png' })
  console.log('BODY-AFTER-ADD: ' + (await pg.locator('body').innerText()).split(String.fromCharCode(10)).join(' | ').slice(0, 1400))

  // 2. Code panel: ESP32 templates + Run
  await rail(pg, 'CODE', 'C++ Coding')
  await pg.waitForTimeout(800)
  const bodyTxt = await pg.locator('body').innerText()
  log(/ESP32 DevKit V1 target/.test(bodyTxt), 'Code panel shows the ESP32 target line')
  await pg.locator('button:has-text("Templates")').first().click()
  await pg.waitForTimeout(1500)
  const names = (await pg.locator('div.absolute button').allInnerTexts()).map(s => s.trim())
  log(names.includes('Simulation controls'), 'ESP32 example list loaded (' + names.length + ' entries)')
  await pg.locator('div.absolute button', { hasText: 'Simulation controls' }).first().click()
  await pg.waitForTimeout(600)
  const runBtn = pg.locator('button:has-text("Run")').first()
  log(!(await runBtn.isDisabled()), 'Run is enabled with an ESP32 alone (no wiring needed)')
  await runBtn.click()
  await pg.waitForTimeout(2500)
  log(/Running/.test(await pg.locator('body').innerText()), 'firmware reported as running')

  // 3. Simulation panel: program-defined controls
  await rail(pg, 'SIMULATE', 'Simulator')
  await pg.waitForTimeout(1200)
  const simTxt = await pg.locator('body').innerText()
  log(/ESP32 DevKit V1/.test(simTxt), 'ESP32 section appears in the Simulation panel')
  const want = ['Power', 'Speed', 'Mode', 'Horn', 'Motor duty']
  log(want.every(w => new RegExp('(^|\\n)\\s*' + w + '\\s*(\\n|$)', 'm').test(simTxt) || simTxt.includes(w)),
    'all 5 declared controls rendered')

  await pg.locator('select').first().selectOption({ index: 1 })
  await pg.waitForTimeout(400)
  const slider = pg.locator('input[type=range]').first()
  await slider.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, 200)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await pg.waitForTimeout(2000)
  const greens = (await pg.locator('span.text-green-300').allInnerTexts()).join(',')
  log(/\d\d+/.test(greens) && !/^0$/.test(greens.trim()), 'controlPublish readout follows the controls (shown: "' + greens + '")')
  await pg.screenshot({ path: SHOT + 'esp32-controls.png' })

  // 4. Wi-Fi example
  await rail(pg, 'CODE', 'C++ Coding')
  await pg.waitForTimeout(700)
  let st = pg.locator('button:has-text("Stop")').first()
  if (await st.count() && await st.isVisible().catch(() => false)) { await st.click(); await pg.waitForTimeout(700) }
  await pg.locator('button:has-text("Templates")').first().click()
  await pg.waitForTimeout(700)
  await pg.locator('div.absolute button', { hasText: 'Wi-Fi station' }).first().click()
  await pg.waitForTimeout(400)
  await pg.locator('button:has-text("Run")').first().click()
  await pg.waitForTimeout(4500)
  await rail(pg, 'SIMULATE', 'Simulator')
  await pg.waitForTimeout(700)
  await pg.locator('button:has-text("network")').first().click()
  await pg.waitForTimeout(1200)
  const netTxt = await pg.locator('body').innerText()
  console.log('NET-PANEL: ' + netTxt.split(String.fromCharCode(10)).join(' | ').slice(-900))
  log(/connected/i.test(netTxt) && /192\.168\./.test(netTxt), 'Wi-Fi reaches connected with an IP shown in the UI')
  log(/SIMULATED/.test(netTxt), 'Wi-Fi and Bluetooth are labelled SIMULATED')
  log(/Web Serial/.test(netTxt), 'real-hardware capability line is shown')
  await pg.screenshot({ path: SHOT + 'esp32-network.png' })

  // 5. BLE round trip
  await rail(pg, 'CODE', 'C++ Coding')
  await pg.waitForTimeout(600)
  st = pg.locator('button:has-text("Stop")').first()
  if (await st.count() && await st.isVisible().catch(() => false)) { await st.click(); await pg.waitForTimeout(600) }
  await pg.locator('button:has-text("Templates")').first().click()
  await pg.waitForTimeout(700)
  await pg.locator('div.absolute button', { hasText: 'BLE serial control' }).first().click()
  await pg.waitForTimeout(400)
  await pg.locator('button:has-text("Run")').first().click()
  await pg.waitForTimeout(2200)
  await rail(pg, 'SIMULATE', 'Simulator')
  await pg.waitForTimeout(600)
  await pg.locator('button:has-text("network")').first().click()
  await pg.waitForTimeout(600)
  await pg.locator('button:has-text("Connect a phone")').first().click()
  await pg.waitForTimeout(600)
  const box = pg.locator('input[placeholder*="Bluetooth"]').first()
  await box.fill('fast')
  await box.press('Enter')
  await pg.waitForTimeout(2500)
  await pg.locator('button:has-text("log")').first().click()
  await pg.waitForTimeout(800)
  const logTxt = await pg.locator('body').innerText()
  console.log('LOG-PANEL: ' + logTxt.split(String.fromCharCode(10)).join(' | ').slice(-900))
  log(/speed=255/.test(logTxt), 'BLE round trip: the sketch answered speed=255')
  await pg.screenshot({ path: SHOT + 'esp32-ble.png' })

  console.log('')
  console.log(out.filter(l => l.startsWith('PASS')).length + '/' + out.length + ' checks passed')
  await br.close()
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(1) })
