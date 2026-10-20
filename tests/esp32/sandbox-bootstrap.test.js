// The sketch sandbox builds its entire runtime as ONE template literal. A stray
// backtick or an under-escaped newline inside it is a syntax error that breaks
// every sketch at once (it happened twice while the ESP32 shims were added), so
// this test parses the generated program instead of trusting review.
import { describe, it, expect } from 'vitest'
import { transformSync } from 'esbuild'
import { bootstrapHtml, OUT_CALLS } from '../../src/managers/sketchSandbox.js'

const scriptOf = (html) => {
  const m = html.match(/<script>([\s\S]*)<\/script>/)
  expect(m, 'bootstrap must contain a script tag').toBeTruthy()
  return m[1]
}
const has = (js, name) => expect(js, name).toMatch(new RegExp('\\b' + name + '\\b'))

describe('sandbox bootstrap', () => {
  it('generates syntactically valid JavaScript', () => {
    const html = bootstrapHtml('async function setup(){}\nasync function loop(){ await delay(1) }', 'const X = 1;')
    expect(() => transformSync(scriptOf(html), { loader: 'js' })).not.toThrow()
  })

  it('keeps the strict CSP and the opaque-origin contract', () => {
    const html = bootstrapHtml('', '')
    expect(html).toMatch(/default-src 'none'/)
    expect(html).not.toMatch(/allow-same-origin/)
  })

  it('only forwards calls that are allow-listed', () => {
    const js = scriptOf(bootstrapHtml('', ''))
    const used = new Set([...js.matchAll(/send\('([A-Za-z0-9_]+)'/g)].map((m) => m[1]))
    expect(used.size).toBeGreaterThan(5)
    const missing = [...used].filter((n) => !OUT_CALLS.has(n))
    expect(missing, 'send() channels not allow-listed: ' + missing.join(', ')).toEqual([])
  })

  it('exposes the ESP32 API the way firmware uses it', () => {
    const js = scriptOf(bootstrapHtml('', ''))
    for (const n of ['ledcAttach', 'ledcSetup', 'ledcWrite', 'dacWrite', 'touchRead', 'controlValue', 'controlPublish', 'WiFi']) has(js, n)
    // Bluetooth must be CONSTRUCTIBLE: "BLESerial ble;" transpiles to new BLESerial().
    expect(js).toMatch(/function _btClass/)
    expect(js).toMatch(/var BLESerial = _btClass\('ble'\)/)
    expect(js).toMatch(/var BluetoothSerial = _btClass\('classic'\)/)
    // Line-oriented reads exist on Serial and on both Bluetooth flavours.
    expect([...js.matchAll(/readStringUntil/g)].length).toBeGreaterThanOrEqual(2)
  })

  it('still carries the Arduino and SUBO API untouched', () => {
    const js = scriptOf(bootstrapHtml('', ''))
    for (const n of ['digitalWrite', 'analogRead', 'Servo', 'SuboMatrixInit', 'playTone', 'walk', 'turn']) has(js, n)
  })
})
