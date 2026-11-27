// ATtiny85 compiler rules: pins 0–5 only; PWM only on 0, 1, 4.
import { describe, it, expect } from 'vitest'
import { loadParts } from '../../src/parts/registry.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'

await loadParts()
const sketch = (body) => `void setup() { ${body} }\nvoid loop() {}`

describe('ATtiny85 diagnostics', () => {
  it('accepts PB0–PB5 and pins 0–5', () => {
    const r = analyzeArduino(sketch('pinMode(PB3, OUTPUT); digitalWrite(4, HIGH); analogWrite(1, 128);'), { board: 'attiny85' })
    expect(r.errors).toEqual([]); expect(r.warnings.filter(w => w.kind === 'no-pwm')).toEqual([])
  })
  it('rejects a pin the chip does not have', () => {
    const r = analyzeArduino(sketch('pinMode(9, OUTPUT);'), { board: 'attiny85' })
    expect(r.errors.map(e => e.kind)).toContain('invalid-pin')
  })
  it('warns that analogWrite on a non-PWM pin is just on/off', () => {
    const r = analyzeArduino(sketch('analogWrite(3, 100);'), { board: 'attiny85' })
    expect(r.errors).toEqual([]); expect(r.warnings.map(w => w.kind)).toContain('no-pwm')
  })
  it('leaves the Uno rules unchanged (pin 9 is fine there)', () => {
    expect(analyzeArduino(sketch('pinMode(9, OUTPUT);'), { board: 'arduino' }).errors).toEqual([])
  })
})
