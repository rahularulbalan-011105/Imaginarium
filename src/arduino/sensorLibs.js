import * as sensorSim from './sensorSim.js'

// ─────────────────────────────────────────────────────────────────────────────
// sensorLibs — the RUNTIME implementations of the Arduino sensor libraries the
// simulator makes available to user sketches. They mirror, method-for-method,
// the genuine Arduino library sources in src/arduino/libraries/*/ (LDR, DHT11,
// ColorSensor), so `#include <LDR.h>` + `LDR ldr(A0);` behaves exactly like the
// built-in `Servo` class already does in SimulationManager.
//
// Every reading is routed through the reusable sensorSim interface — no sensor
// behaviour is hard-coded here or in the parser.
//
// createSensorLibraries({ sensorMap, getStore }) returns { LDR, DHT11,
// ColorSensor, RGB }, which SimulationManager injects into the sandbox exactly
// like Servo. A library instance binds to the scene sensor wired to its pin (via
// sensorMap); if none is wired, it still returns simulated defaults so any
// example sketch runs without error.
// ─────────────────────────────────────────────────────────────────────────────

export function createSensorLibraries({ sensorMap, getStore }) {
  const idForPin = (pin) => {
    const s = sensorMap[Number(pin)]
    return s ? s.id : null
  }

  // ── LDR (light-dependent resistor) — mirrors libraries/LDR ─────────────────
  class LDR {
    constructor(pin) { this._pin = Number(pin); this._id = idForPin(this._pin) }
    begin()          { this._id = idForPin(this._pin); return true }
    read()           { return sensorSim.readLDR(getStore(), this._id) }
    readPercentage() { return sensorSim.readLDRPercentage(getStore(), this._id) }
  }

  // ── DHT11 (temperature + humidity) — mirrors libraries/DHT11 ───────────────
  class DHT11 {
    constructor(pin)    { this._pin = Number(pin); this._id = idForPin(this._pin) }
    begin()             { this._id = idForPin(this._pin); return true }
    readTemperature()   { return sensorSim.readTemperature(getStore(), this._id) }
    readHumidity()      { return sensorSim.readHumidity(getStore(), this._id) }
  }

  // ── RGB value struct — returned by ColorSensor.readRGB() ───────────────────
  class RGB {
    constructor(r = 0, g = 0, b = 0) {
      this.r = Math.round(r); this.g = Math.round(g); this.b = Math.round(b)
    }
  }

  // ── ColorSensor (TCS3200-style) — mirrors libraries/ColorSensor ────────────
  class ColorSensor {
    constructor(s0, s1, s2, s3, out) {
      this._s0 = Number(s0); this._s1 = Number(s1)
      this._s2 = Number(s2); this._s3 = Number(s3)
      this._out = Number(out)
      this._id = idForPin(this._out)
    }
    begin()      { this._id = idForPin(this._out); return true }
    // null → sensor not powered/wired: report a clearly-dead reading.
    _rgb()       { return sensorSim.readColorRGB(getStore(), this._id) }
    readRGB()    { const c = this._rgb(); return c ? new RGB(c.r, c.g, c.b) : new RGB(0, 0, 0) }
    readColor()  { const c = this._rgb(); return c ? sensorSim.classifyColor(c) : 'None' }
    readRed()    { const c = this._rgb(); return c ? c.r : 0 }
    readGreen()  { const c = this._rgb(); return c ? c.g : 0 }
    readBlue()   { const c = this._rgb(); return c ? c.b : 0 }
  }

  return { LDR, DHT11, ColorSensor, RGB }
}
