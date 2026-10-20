// ─────────────────────────────────────────────────────────────────────────────
// ESP32 board definition — THE single source of truth for this board's pins.
//
// The 3D pin spheres (electronicsFactory), the wiring UI (wiring.js /
// WiringPanel / WiringWorkbench), the firmware validator (arduinoDiagnostics)
// and the Simulation-tab pin inspector ALL derive from the table below. There is
// deliberately no second pin list anywhere.
//
// VARIANT — verified against the pin diagram supplied with the model
// (3dassets/esp32_wroom.glb, ESP-WROOM-32 module):
//   ESP32-WROOM-32 on the 30-pin "DevKit V1" header.
//   left  (top→bottom): EN 36 39 34 35 32 33 25 26 27 14 12 13 GND VIN
//   right (top→bottom): 23 22 1 3 21 19 18 5 17 16 4 2 15 GND 3V3
// This 30-pin header does NOT break out GPIO0 or GPIO6–11 (GPIO6–11 are wired to
// the module's SPI flash and must never be used). 36-pin DevKits differ — if a
// different board is added later, give it its own table rather than widening
// this one.
//
// Capability data is for the ESP32-D0WD (classic ESP32) in the WROOM-32 module.
// ─────────────────────────────────────────────────────────────────────────────

export const ESP32_BOARD = {
  id: 'esp32',
  name: 'ESP32 DevKit V1',
  chip: 'ESP32-D0WD (ESP-WROOM-32)',
  header: '30-pin',
  framework: 'arduino',
  /** Arduino-ESP32 core the API surface is written against. */
  coreVersion: '3.x',
  adcBits: 12,          // analogRead() → 0…4095 (NOT 0…1023 like an Uno)
  adcMax: 4095,
  pwmBits: 8,           // analogWrite()/ledcWrite() default duty resolution
  pwmMax: 255,
  ledcChannels: 16,
  logicVolts: 3.3,
}

/**
 * Pin records, in physical header order.
 *
 *  name       wiring id, also what the firmware may use (GPIO23 / 23)
 *  gpio       GPIO number, or null for power/enable pins
 *  side       'left' | 'right' as printed on the board
 *  index      0-based position down that side (0…14)
 *  kind       'digital' | 'power' | 'gnd' | 'enable'
 *  inputOnly  true  → cannot be an output, and has no internal pull-up/down
 *  adc        { unit, ch } | null   (ADC2 is unavailable while Wi-Fi is on)
 *  dac        1 | 2 | null
 *  touch      touch channel number | null
 *  pwm        can drive LEDC PWM
 *  uart/i2c/spi  default peripheral role on this board, if any
 *  strapping  sampled at boot — driving it can stop the board booting
 *  reserved   wired to something on the board; avoid
 */
export const ESP32_PINS = [
  // ── left header ──────────────────────────────────────────────────────────
  { name: 'EN',     gpio: null, side: 'left', index: 0,  kind: 'enable', label: 'EN',
    note: 'Chip enable / reset. Pull LOW to reset. Not a GPIO.' },
  { name: 'GPIO36', gpio: 36, side: 'left', index: 1,  kind: 'digital', label: '36', alt: 'SENSOR_VP',
    inputOnly: true, adc: { unit: 1, ch: 0 }, pwm: false },
  { name: 'GPIO39', gpio: 39, side: 'left', index: 2,  kind: 'digital', label: '39', alt: 'SENSOR_VN',
    inputOnly: true, adc: { unit: 1, ch: 3 }, pwm: false },
  { name: 'GPIO34', gpio: 34, side: 'left', index: 3,  kind: 'digital', label: '34',
    inputOnly: true, adc: { unit: 1, ch: 6 }, pwm: false },
  { name: 'GPIO35', gpio: 35, side: 'left', index: 4,  kind: 'digital', label: '35',
    inputOnly: true, adc: { unit: 1, ch: 7 }, pwm: false },
  { name: 'GPIO32', gpio: 32, side: 'left', index: 5,  kind: 'digital', label: '32',
    adc: { unit: 1, ch: 4 }, touch: 9, pwm: true, alt: 'XTAL32' },
  { name: 'GPIO33', gpio: 33, side: 'left', index: 6,  kind: 'digital', label: '33',
    adc: { unit: 1, ch: 5 }, touch: 8, pwm: true, alt: 'XTAL32' },
  { name: 'GPIO25', gpio: 25, side: 'left', index: 7,  kind: 'digital', label: '25',
    adc: { unit: 2, ch: 8 }, dac: 1, pwm: true },
  { name: 'GPIO26', gpio: 26, side: 'left', index: 8,  kind: 'digital', label: '26',
    adc: { unit: 2, ch: 9 }, dac: 2, pwm: true },
  { name: 'GPIO27', gpio: 27, side: 'left', index: 9,  kind: 'digital', label: '27',
    adc: { unit: 2, ch: 7 }, touch: 7, pwm: true },
  { name: 'GPIO14', gpio: 14, side: 'left', index: 10, kind: 'digital', label: '14',
    adc: { unit: 2, ch: 6 }, touch: 6, pwm: true, spi: 'HSPI_CLK' },
  { name: 'GPIO12', gpio: 12, side: 'left', index: 11, kind: 'digital', label: '12',
    adc: { unit: 2, ch: 5 }, touch: 5, pwm: true, spi: 'HSPI_MISO', strapping: true,
    note: 'Strapping pin (MTDI): must be LOW at boot. A pull-up here can stop the board booting.' },
  { name: 'GPIO13', gpio: 13, side: 'left', index: 12, kind: 'digital', label: '13',
    adc: { unit: 2, ch: 4 }, touch: 4, pwm: true, spi: 'HSPI_MOSI' },
  { name: 'GND1',   gpio: null, side: 'left', index: 13, kind: 'gnd',   label: 'GND' },
  { name: 'VIN',    gpio: null, side: 'left', index: 14, kind: 'power', label: 'VIN',
    note: '5 V input (regulated to 3.3 V on board). Logic is 3.3 V.' },

  // ── right header ─────────────────────────────────────────────────────────
  { name: 'GPIO23', gpio: 23, side: 'right', index: 0,  kind: 'digital', label: '23', pwm: true, spi: 'VSPI_MOSI' },
  { name: 'GPIO22', gpio: 22, side: 'right', index: 1,  kind: 'digital', label: '22', pwm: true, i2c: 'SCL' },
  { name: 'GPIO1',  gpio: 1,  side: 'right', index: 2,  kind: 'digital', label: 'TX0', pwm: true, uart: 'U0_TXD',
    reserved: true, note: 'USB serial transmit. Using it breaks Serial over USB.' },
  { name: 'GPIO3',  gpio: 3,  side: 'right', index: 3,  kind: 'digital', label: 'RX0', pwm: true, uart: 'U0_RXD',
    reserved: true, note: 'USB serial receive. Using it breaks Serial over USB.' },
  { name: 'GPIO21', gpio: 21, side: 'right', index: 4,  kind: 'digital', label: '21', pwm: true, i2c: 'SDA' },
  { name: 'GPIO19', gpio: 19, side: 'right', index: 5,  kind: 'digital', label: '19', pwm: true, spi: 'VSPI_MISO' },
  { name: 'GPIO18', gpio: 18, side: 'right', index: 6,  kind: 'digital', label: '18', pwm: true, spi: 'VSPI_CLK' },
  { name: 'GPIO5',  gpio: 5,  side: 'right', index: 7,  kind: 'digital', label: '5',  pwm: true, spi: 'VSPI_CS',
    strapping: true, note: 'Strapping pin: must be HIGH at boot.' },
  { name: 'GPIO17', gpio: 17, side: 'right', index: 8,  kind: 'digital', label: '17', pwm: true, uart: 'U2_TXD' },
  { name: 'GPIO16', gpio: 16, side: 'right', index: 9,  kind: 'digital', label: '16', pwm: true, uart: 'U2_RXD' },
  { name: 'GPIO4',  gpio: 4,  side: 'right', index: 10, kind: 'digital', label: '4',
    adc: { unit: 2, ch: 0 }, touch: 0, pwm: true },
  { name: 'GPIO2',  gpio: 2,  side: 'right', index: 11, kind: 'digital', label: '2',
    adc: { unit: 2, ch: 2 }, touch: 2, pwm: true, strapping: true,
    note: 'On-board LED on most DevKit V1 boards. Strapping pin: must be LOW or floating at boot.' },
  { name: 'GPIO15', gpio: 15, side: 'right', index: 12, kind: 'digital', label: '15',
    adc: { unit: 2, ch: 3 }, touch: 3, pwm: true, spi: 'HSPI_CS', strapping: true,
    note: 'Strapping pin: must be HIGH at boot.' },
  { name: 'GND2',   gpio: null, side: 'right', index: 13, kind: 'gnd',   label: 'GND' },
  { name: '3V3',    gpio: null, side: 'right', index: 14, kind: 'power', label: '3V3',
    note: '3.3 V output. The ESP32 is NOT 5 V tolerant.' },
]

/** GPIO numbers that exist on the chip but are not on this header. */
export const ESP32_NOT_ON_HEADER = new Set([0, 6, 7, 8, 9, 10, 11, 20, 24, 28, 29, 30, 31, 37, 38])
/** Wired to the module's SPI flash — never usable, on any ESP32 board. */
export const ESP32_FLASH_PINS = new Set([6, 7, 8, 9, 10, 11])

export const ESP32_PIN_NAMES = ESP32_PINS.map(p => p.name)

const BY_GPIO = new Map(ESP32_PINS.filter(p => p.gpio != null).map(p => [p.gpio, p]))
const BY_NAME = new Map(ESP32_PINS.map(p => [p.name, p]))

export const pinByGpio = (n) => BY_GPIO.get(Number(n)) ?? null
export const pinByName = (s) => BY_NAME.get(String(s)) ?? null

/** 'GPIO23' | '23' | 'TX0' → 23; null when it isn't an ESP32 GPIO name. */
export function esp32GpioFromName(name) {
  if (name == null) return null
  const s = String(name).trim()
  const m = /^GPIO(\d+)$/i.exec(s)
  if (m) return Number(m[1])
  const byName = BY_NAME.get(s)
  if (byName) return byName.gpio
  if (/^\d+$/.test(s)) return Number(s)
  return null
}

/**
 * Is this GPIO usable for `use` on this board?
 * @returns {{level:'ok'|'warn'|'error', message?:string, hint?:string}}
 */
export function validateEsp32Pin(gpio, use = 'digital') {
  const n = Number(gpio)
  if (!Number.isInteger(n)) return { level: 'error', message: 'Pin must be a GPIO number.' }
  if (ESP32_FLASH_PINS.has(n))
    return { level: 'error', message: `GPIO${n} is wired to the on-board flash chip`, hint: 'GPIO6–11 can never be used. Pick another pin.' }
  const p = pinByGpio(n)
  if (!p)
    return { level: 'error', message: `GPIO${n} is not on the ${ESP32_BOARD.header} header`, hint: `Available: ${ESP32_PINS.filter(x => x.gpio != null).map(x => x.gpio).join(', ')}.` }

  if ((use === 'output' || use === 'pwm' || use === 'dac') && p.inputOnly)
    return { level: 'error', message: `GPIO${n} is input-only`, hint: 'GPIO34, 35, 36 and 39 can only read. Use another pin for outputs.' }
  if (use === 'pwm' && !p.pwm)
    return { level: 'error', message: `GPIO${n} cannot do PWM`, hint: 'Pick a pin that supports LEDC PWM.' }
  if (use === 'dac' && !p.dac)
    return { level: 'error', message: `GPIO${n} has no DAC`, hint: 'Only GPIO25 (DAC1) and GPIO26 (DAC2) have a real analog output.' }
  if (use === 'touch' && p.touch == null)
    return { level: 'error', message: `GPIO${n} is not a capacitive-touch pin`, hint: `Touch pins: ${ESP32_PINS.filter(x => x.touch != null).map(x => x.gpio).join(', ')}.` }
  if (use === 'adc' && !p.adc)
    return { level: 'error', message: `GPIO${n} has no ADC`, hint: `Analog-capable pins: ${ESP32_PINS.filter(x => x.adc).map(x => x.gpio).join(', ')}.` }

  if (use === 'adc' && p.adc?.unit === 2)
    return { level: 'warn', message: `GPIO${n} uses ADC2, which stops working while Wi-Fi is on`, hint: 'Use an ADC1 pin (32–36, 39) if the sketch also uses Wi-Fi.' }
  if (p.reserved)
    return { level: 'warn', message: `GPIO${n} is ${p.note}`, hint: 'Prefer another pin unless you mean to use the USB serial lines.' }
  if (p.strapping)
    return { level: 'warn', message: `GPIO${n} is a strapping pin`, hint: p.note }
  return { level: 'ok' }
}

/** One-line capability summary for the pin inspector UI. */
export function esp32PinSummary(p) {
  if (!p) return ''
  if (p.kind === 'power') return p.note || 'Power'
  if (p.kind === 'gnd') return 'Ground'
  if (p.kind === 'enable') return p.note || 'Enable / reset'
  const bits = []
  bits.push(p.inputOnly ? 'input only' : 'digital in/out')
  if (p.adc) bits.push(`ADC${p.adc.unit}_CH${p.adc.ch}`)
  if (p.dac) bits.push(`DAC${p.dac}`)
  if (p.pwm) bits.push('PWM')
  if (p.touch != null) bits.push(`Touch${p.touch}`)
  if (p.i2c) bits.push(`I²C ${p.i2c}`)
  if (p.spi) bits.push(p.spi.replace('_', ' '))
  if (p.uart) bits.push(p.uart.replace('_', ' '))
  return bits.join(' · ')
}
