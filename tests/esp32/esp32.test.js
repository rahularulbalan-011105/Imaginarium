// ─────────────────────────────────────────────────────────────────────────────
// ESP32 integration tests — board table, pin legality, control annotations,
// diagnostics and the example sketches.
//
// These cover the parts that must stay honest: the pin table is the single
// source of truth, an illegal pin is an error (not a silent success), and every
// shipped example both passes diagnostics and survives the real transpiler.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  ESP32_BOARD, ESP32_PINS, ESP32_FLASH_PINS, pinByGpio, pinByName,
  esp32GpioFromName, validateEsp32Pin,
} from '../../src/utils/esp32Board.js'
import { parseControlAnnotations, controlDefaults } from '../../src/utils/esp32Controls.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { ESP32_EXAMPLES } from '../../src/utils/esp32Examples.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'

describe('ESP32 board table', () => {
  it('describes a 30-pin DevKit V1 with a 12-bit ADC', () => {
    expect(ESP32_PINS).toHaveLength(30)
    expect(ESP32_BOARD.adcBits).toBe(12)
    expect(ESP32_BOARD.adcMax).toBe(4095)
    expect(ESP32_PINS.filter(p => p.side === 'left')).toHaveLength(15)
    expect(ESP32_PINS.filter(p => p.side === 'right')).toHaveLength(15)
  })

  it('has unique pin names and unique GPIO numbers', () => {
    const names = ESP32_PINS.map(p => p.name)
    expect(new Set(names).size).toBe(names.length)
    const gpios = ESP32_PINS.map(p => p.gpio).filter(g => g != null)
    expect(new Set(gpios).size).toBe(gpios.length)
  })

  it('resolves pins by gpio and by name, both directions', () => {
    expect(pinByGpio(2).name).toBe(pinByName('GPIO2').name)
    expect(esp32GpioFromName('GPIO2')).toBe(2)
    expect(esp32GpioFromName('GPIO23')).toBe(23)
    expect(esp32GpioFromName('23')).toBe(23)
    expect(esp32GpioFromName('NOPE')).toBe(null)
  })

  it('marks 34/35/36/39 input-only and 6-11 as flash', () => {
    for (const g of [34, 35, 36, 39]) expect(pinByGpio(g)?.inputOnly).toBe(true)
    for (const g of [6, 7, 8, 9, 10, 11]) expect(ESP32_FLASH_PINS.has(g)).toBe(true)
    // T0 is channel 0 — a falsy value that must still count as touch-capable.
    expect(pinByGpio(4).touch).toBe(0)
  })
})

describe('ESP32 pin legality', () => {
  it('accepts ordinary pins', () => {
    expect(validateEsp32Pin(23, 'output').level).toBe('ok')
    expect(validateEsp32Pin(34, 'adc').level).toBe('ok')
    expect(validateEsp32Pin(25, 'dac').level).toBe('ok')
    expect(validateEsp32Pin(4, 'touch').level).toBe('ok')
  })

  it('rejects impossible uses', () => {
    expect(validateEsp32Pin(34, 'output').level).toBe('error')   // input-only
    expect(validateEsp32Pin(7, 'digital').level).toBe('error')   // flash
    expect(validateEsp32Pin(13, 'dac').level).toBe('error')      // no DAC
    expect(validateEsp32Pin(23, 'adc').level).toBe('error')      // no ADC
    expect(validateEsp32Pin(21, 'touch').level).toBe('error')    // no touch
    expect(validateEsp32Pin(50, 'digital').level).toBe('error')  // not on header
    expect(validateEsp32Pin(0, 'digital').level).toBe('error')   // not broken out on the 30-pin board
  })

  it('warns — but does not block — on strapping and ADC2 pins', () => {
    expect(validateEsp32Pin(12, 'output').level).toBe('warn')    // strapping
    expect(validateEsp32Pin(5, 'output').level).toBe('warn')     // strapping
    expect(validateEsp32Pin(2, 'adc').level).toBe('warn')        // ADC2 vs Wi-Fi
  })
})

describe('@control annotations', () => {
  it('parses every control type with its defaults', () => {
    const src = `
// @control button  horn                      label="Horn"
// @control toggle  power  on
// @control slider  speed  0 255  step=5 value=120 unit="%"
// @control number  rpm    0 3000 value=1200
// @control select  mode   idle,drive,park  value=drive
// @control readout dist   label="Distance" unit="cm"
`
    const { controls, errors } = parseControlAnnotations(src)
    expect(errors).toEqual([])
    expect(controls.map(c => c.type)).toEqual(['button', 'toggle', 'slider', 'number', 'select', 'readout'])
    const d = controlDefaults(controls)
    expect(d).toEqual({ horn: 0, power: 1, speed: 120, rpm: 1200, mode: 1, dist: 0 })
    const slider = controls.find(c => c.id === 'speed')
    expect(slider).toMatchObject({ min: 0, max: 255, step: 5, unit: '%' })
    expect(controls.find(c => c.id === 'horn').label).toBe('Horn')
    expect(controls.find(c => c.id === 'dist').readOnly).toBe(true)
  })

  it('reports bad declarations instead of guessing', () => {
    const cases = [
      '// @control wobbler x 0 1',          // unknown type
      '// @control slider 9bad 0 1',        // bad id
      '// @control slider s 5 5',           // max not > min
      '// @control select s onlyone',       // needs 2+ options
      '// @control slider s',               // missing range
      '// @control slider a 0 1\n// @control toggle a',   // duplicate id
    ]
    for (const c of cases) expect(parseControlAnnotations(c).errors.length).toBeGreaterThan(0)
  })

  it('validates a declared pin against the board', () => {
    expect(parseControlAnnotations('// @control toggle led on pin=34').errors.length).toBe(1)   // input-only
    const ok = parseControlAnnotations('// @control toggle led on pin=23')
    expect(ok.errors).toEqual([])
    expect(ok.controls[0].pin).toBe(23)
  })

  it('ignores sketches with no annotations', () => {
    expect(parseControlAnnotations('void setup(){}\nvoid loop(){}').controls).toEqual([])
  })
})

describe('ESP32 diagnostics', () => {
  const esp = (code) => analyzeArduino(code, { board: 'esp32' })

  it('accepts the ESP32 API on an ESP32 board', () => {
    const r = esp(`void setup(){ ledcAttach(23,5000,8); analogReadResolution(12); }
void loop(){ ledcWrite(23, 128); dacWrite(25, 10); touchRead(4); int v = analogRead(34); delay(v>0?1:1); }`)
    expect(r.ok).toBe(true)
  })

  it('flags illegal pins as errors and risky pins as warnings', () => {
    const r = esp('void setup(){ pinMode(34, OUTPUT); dacWrite(13, 5); pinMode(12, OUTPUT); }\nvoid loop(){}')
    expect(r.ok).toBe(false)
    expect(r.errors.map(e => e.kind)).toContain('invalid-pin')
    expect(r.errors).toHaveLength(2)
    expect(r.warnings.some(w => /strapping/.test(w.message))).toBe(true)
  })

  it('does not guess when the pin is not a literal', () => {
    expect(esp('int p = 34;\nvoid setup(){ pinMode(p, OUTPUT); pinMode(1+1, OUTPUT); }\nvoid loop(){}').ok).toBe(true)
  })

  it('reports cross-board API use in both directions', () => {
    expect(esp('void setup(){ playTone(100,100); }\nvoid loop(){}').ok).toBe(false)
    const avr = analyzeArduino('void setup(){ ledcAttach(2,5000,8); }\nvoid loop(){}', { board: 'arduino' })
    expect(avr.ok).toBe(false)
    expect(avr.errors[0].kind).toBe('board-mismatch')
  })

  it('leaves Arduino and SUBO sketches exactly as they were', () => {
    expect(analyzeArduino('void setup(){ pinMode(13,OUTPUT); }\nvoid loop(){ digitalWrite(13,HIGH); delay(100); }', { board: 'arduino' }).ok).toBe(true)
    expect(analyzeArduino('#include <Subo.h>\nvoid setup(){ SuboMatrixInit(); }\nvoid loop(){ setAllLED(1,2,3); }', { board: 'subo' }).ok).toBe(true)
    // input-only pins are an ESP32 concept — never applied to other boards
    expect(analyzeArduino('void setup(){ pinMode(34,OUTPUT); }\nvoid loop(){}', { board: 'arduino' }).ok).toBe(true)
  })

  it('accepts a comma-separated declaration list (no false "not declared")', () => {
    expect(analyzeArduino('const int A_PIN = 23, B_PIN = 22;\nvoid setup(){ pinMode(A_PIN,OUTPUT); pinMode(B_PIN,OUTPUT); }\nvoid loop(){}', { board: 'arduino' }).ok).toBe(true)
  })
})

describe('shipped ESP32 examples', () => {
  it('there are examples and each one has a label and code', () => {
    expect(ESP32_EXAMPLES.length).toBeGreaterThanOrEqual(10)
    for (const ex of ESP32_EXAMPLES) {
      expect(typeof ex.label).toBe('string')
      expect(ex.code).toMatch(/void loop\(/)
    }
  })

  it('every example passes diagnostics, parses its controls and transpiles', () => {
    for (const ex of ESP32_EXAMPLES) {
      const d = analyzeArduino(ex.code, { board: 'esp32' })
      expect(d.errors, `${ex.label}: ${d.errors.map(e => e.message).join('; ')}`).toEqual([])
      expect(parseControlAnnotations(ex.code).errors, ex.label).toEqual([])
      expect(() => parseAndTranspile(ex.code), ex.label).not.toThrow()
    }
  })
})
