// Arduino Print semantics in the transpiler + sandbox (end to end through runSketch):
// chars print as characters, floats with 2 decimals, integers in a given base.
import { describe, it, expect } from 'vitest'
import { loadParts } from '../../src/parts/registry.js'
import { createKit } from '../../src/parts/testkit.js'
import { runSketch } from '../../src/parts/sketchRunner.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'

await loadParts()
async function printed(body) {
  const kit = createKit(); kit.scene({ U: 'arduino' })
  const s = runSketch(kit, `void setup() {\n${body}\n}\nvoid loop() { delay(50); }`)
  await s.run(60); s.stop()
  return s.out.join('')
}

describe('Arduino Print semantics', () => {
  it('a char literal and a char variable print as characters; char arithmetic stays numeric', async () => {
    expect(await printed(`char c = 'A'; Serial.println('Z'); Serial.println(c); Serial.println(c + 1);`)).toBe('Z\nA\n66\n')
  })
  it('floats print with 2 decimals (25.0 → "25.00"), or the requested digits', async () => {
    expect(await printed(`float t = 25.0; Serial.println(t); Serial.println(3.14159, 3); Serial.println(t / 4);`)).toBe('25.00\n3.142\n6.25\n')
  })
  it('integers print in a base: HEX / BIN / OCT / DEC', async () => {
    expect(await printed(`int v = 255; Serial.println(v, HEX); Serial.println(5, BIN); Serial.println(8, OCT); Serial.println(42, DEC);`)).toBe('FF\n101\n10\n42\n')
  })
  it('plain ints and strings are unchanged', async () => {
    expect(await printed(`int n = 7; Serial.println(n); Serial.println("hi"); Serial.print(n * 2);`)).toBe('7\nhi\n14')
  })
  it('unary & (address-of) and lowercase library classes transpile', () => {
    const { code, error } = parseAndTranspile(`decode_results results;\nvoid loop() { if (irrecv.decode(&results)) { irrecv.resume(); } }`, new Set())
    expect(error).toBeFalsy()
    expect(code).toContain('new decode_results()')
    expect(code).toContain('irrecv.decode(results)')
  })
})
