// Waveshare 2.8" capacitive touch LCD: one pin table shared by the 3D pins, the
// wiring lists, the Workbench card and the shipped GLB.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TFT28_PIN_ORDER, TFT28_PINS_TABLE, TFT28_GH } from '../../src/utils/tft28.js'
import { PIN_DEFS as WIRING_PINS, ELEC_TYPES } from '../../src/utils/wiring.js'
import { PIN_DEFS as FACTORY_PINS } from '../../src/utils/electronicsFactory.js'

// Read the JSON chunk of a GLB (names survive meshopt compression).
function glbJson(file) {
  const buf = readFileSync(file)
  expect(buf.readUInt32LE(0)).toBe(0x46546c67)          // 'glTF'
  const len = buf.readUInt32LE(12)
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'))
}

describe('2.8" touch LCD (tft28)', () => {
  it('has the 13-pin GH1.25 header in Waveshare order', () => {
    expect(TFT28_PIN_ORDER).toEqual(['VCC', 'GND', 'MISO', 'MOSI', 'SCLK', 'LCD_CS', 'LCD_DC', 'LCD_RST', 'LCD_BL', 'TP_SDA', 'TP_SCL', 'TP_INT', 'TP_RST'])
    expect(TFT28_PINS_TABLE.find((p) => p.name === 'VCC').role).toBe('power')
    expect(TFT28_PINS_TABLE.find((p) => p.name === 'GND').role).toBe('gnd')
  })

  it('3D pins and wiring pins agree', () => {
    expect(ELEC_TYPES.has('tft28')).toBe(true)
    expect(WIRING_PINS.tft28).toEqual(TFT28_PIN_ORDER)
    expect(Object.keys(FACTORY_PINS.tft28)).toEqual(TFT28_PIN_ORDER)
  })

  it('places the pins 1.25 mm apart in the connector mouth, VCC first', () => {
    const p = FACTORY_PINS.tft28
    for (let i = 1; i < TFT28_PIN_ORDER.length; i++) {
      const a = p[TFT28_PIN_ORDER[i - 1]], b = p[TFT28_PIN_ORDER[i]]
      expect(a.x - b.x).toBeCloseTo(TFT28_GH.pitch / 10, 6)
      expect(b.z).toBe(a.z)
    }
    // inside the 73.06 mm glass footprint, below the PCB (y < 0.4 cm)
    expect(Math.abs(p.VCC.z)).toBeLessThan(7.306 / 2)
    expect(p.VCC.y).toBeLessThan(0.4)
  })

  it('ships a GLB with the named parts the app relies on', () => {
    for (const file of ['public/models/tft28.glb', 'assets-src/models/tft28.glb']) {
      const names = new Set(glbJson(file).nodes.map((n) => n.name))
      for (const n of ['pcb', 'touch_glass', 'lcd_active_area', 'lcd_panel', 'touch_controller_CST328_QFN', 'display_driver_ST7789_COG', 'level_shifter_SSOP20', 'fpc_interface1_18pin', 'standoffs_M2.5'])
        expect([...names].some((x) => x === n || x.startsWith(n)), `${file}: ${n}`).toBe(true)
      expect([...names].some((x) => /^connector_GH1/.test(x)), `${file}: GH connector`).toBe(true)
    }
  })
})
