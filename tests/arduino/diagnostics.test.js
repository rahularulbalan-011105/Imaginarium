// The pre-flight compiler must accept every function the simulator provides —
// a false "not declared" error withholds the whole sketch from running.
import { describe, it, expect } from 'vitest'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'

describe('arduino diagnostics', () => {
  it('accepts the legged locomotion API (walk / turn / stopWalking)', () => {
    const code = '#include <Servo.h>\nServo s;\nvoid setup() {\n  s.attach(8);\n  walk(100);\n  turn(-50);\n}\nvoid loop() {\n  stopWalking();\n  delay(100);\n}\n'
    const r = analyzeArduino(code, { board: 'arduino' })
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('still catches a misspelled walk()', () => {
    const r = analyzeArduino('void setup() {\n  wlak(100);\n}\nvoid loop() {}\n', { board: 'arduino' })
    expect(r.ok).toBe(false)
  })
})
