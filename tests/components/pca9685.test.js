// PCA9685 servo driver: register arithmetic, servo pulse model, I2C wiring,
// servo power through V+, and the sandbox's Adafruit_PWMServoDriver class.
import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import {
  prescaleFor, freqOf, pulseUs, pulseToAngle, pcaWiring, plugWires, boardWires,
  PCA_PIN_ORDER, PCA_EXAMPLE_SKETCH, SERVO_MIN_US, SERVO_MAX_US,
} from '../../src/utils/pca9685.js'
import { isSupplyPinName, isGroundPinName } from '../../src/stores/electronicsStore.js'
import { servoWiring, servoWiringIssues } from '../../src/managers/physics/robotics/diagnosis.js'
import { bootstrapHtml } from '../../src/managers/sketchSandbox.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { PIN_DEFS as WIRING_PINS } from '../../src/utils/wiring.js'
import { PIN_DEFS as FACTORY_PINS } from '../../src/utils/electronicsFactory.js'

const deps = { isSupply: isSupplyPinName, isGround: isGroundPinName }
const conns = (pairs) => Object.fromEntries(pairs.map(([a, b], i) => [`c${i}`, { fromPinId: a, toPinId: b }]))

describe('register arithmetic (as the Adafruit library + the chip)', () => {
  it('50 Hz → prescale 121 → really 50.03 Hz', () => {
    expect(prescaleFor(50)).toBe(121)
    expect(freqOf(121)).toBeCloseTo(50.03, 2)
  })
  it('pulse width from ON/OFF ticks, with the full-on / full-off bits', () => {
    const p = prescaleFor(50), period = 1e6 / freqOf(p)
    expect(pulseUs(0, 307, p)).toBeCloseTo(307 * period / 4096, 6)   // ≈ 1.5 ms
    expect(pulseUs(100, 407, p)).toBeCloseTo(pulseUs(0, 307, p), 6)  // phase-shifted, same width
    expect(pulseUs(0, 4096, p)).toBe(0)
    expect(pulseUs(4096, 0, p)).toBeCloseTo(period, 6)
  })
})

describe('what a servo does with the pulse', () => {
  it('544 µs = 0°, 2400 µs = 180°, clamped beyond', () => {
    expect(pulseToAngle(SERVO_MIN_US, 50)).toBe(0)
    expect(pulseToAngle(SERVO_MAX_US, 50)).toBe(180)
    expect(pulseToAngle(1472, 50)).toBeCloseTo(90, 6)
    expect(pulseToAngle(2900, 50)).toBe(180)
  })
  it('ignores no pulse, nonsense pulses and frame rates it cannot follow', () => {
    expect(pulseToAngle(0, 50)).toBeNull()
    expect(pulseToAngle(100, 50)).toBeNull()
    expect(pulseToAngle(1500, 1000)).toBeNull()     // begin() without setPWMFreq(50)
  })
})

describe('wiring', () => {
  const objects = [{ id: 'u', type: 'arduino' }, { id: 'p', type: 'pca9685' }, { id: 's', type: 'servo', name: 'S1' }]
  const header = [['p:SDA', 'u:SDA'], ['p:SCL', 'u:SCL'], ['p:VCC', 'u:5V'], ['p:GND', 'u:GND1'], ['p:V+', 'u:5V']]
  const lead = plugWires('p', 3, 's').map(([a, b]) => [a, b])
  it('on the bus, powered, servo on channel 3', () => {
    const w = pcaWiring(conns([...header, ...lead]), objects, deps).p
    expect(w).toMatchObject({ addr: 0x40, sda: true, scl: true, swapped: false, logic: true, rail: true })
    expect(w.channels).toEqual({ 3: ['s'] })
  })
  it('spots swapped SDA/SCL and a missing V+', () => {
    const swapped = [['p:SDA', 'u:SCL'], ['p:SCL', 'u:SDA'], ...header.slice(2)]
    expect(pcaWiring(conns(swapped), objects, deps).p).toMatchObject({ sda: false, swapped: true })
    expect(pcaWiring(conns(header.slice(0, 4)), objects, deps).p.rail).toBe(false)
    expect(pcaWiring(conns([...header.slice(0, 4), ...lead]), objects, deps).p.rail).toBe(false)   // servo VCC is not a supply
  })
  it('a second board chained off the first is on the bus too', () => {
    const two = [...objects, { id: 'q', type: 'pca9685', i2cAddr: 0x41 }]
    const w = pcaWiring(conns([...header, ['q:SDA', 'p:SDA'], ['q:SCL', 'p:SCL']]), two, deps)
    expect(w.q).toMatchObject({ addr: 0x41, sda: true, scl: true })
  })
  it('servo power comes through V+ only when V+ itself is powered', () => {
    const sv = [{ id: 's', name: 'S1' }]
    const on = servoWiring(sv, conns([...header, ...lead])).get('s')
    expect(on).toMatchObject({ powered: true, pca: { id: 'p', ch: 3 } })
    expect(servoWiringIssues(sv, servoWiring(sv, conns([...header, ...lead])))).toEqual([])
    expect(servoWiring(sv, conns([...header.slice(0, 4), ...lead])).get('s').powered).toBe(false)
  })
  it('"Connect to board" wires the header to the Arduino I2C pins', () => {
    const w = pcaWiring(conns(boardWires('p', objects[0]).map(([a, b]) => [a, b])), objects, deps).p
    expect(w).toMatchObject({ sda: true, scl: true, logic: true, rail: true })
  })
  it('3D pins and wiring pins agree; the Arduino has SDA/SCL', () => {
    expect(WIRING_PINS.pca9685).toEqual(PCA_PIN_ORDER)
    expect(Object.keys(FACTORY_PINS.pca9685).sort()).toEqual([...PCA_PIN_ORDER].sort())
    expect(WIRING_PINS.arduino).toEqual(expect.arrayContaining(['SDA', 'SCL']))
    expect(Object.keys(FACTORY_PINS.arduino)).toEqual(expect.arrayContaining(['SDA', 'SCL']))
  })
})

describe('parser + diagnostics', () => {
  it('#define: trailing comments, hex/suffixed numbers, expressions', () => {
    const { code, error } = parseAndTranspile(`#define SERVOMIN 110   // pulse (ticks out of 4096)
#define MID (SERVOMIN + 490) / 2
#define ADDR 0x41
#define BIG 100000UL
#define PIN A0 /* sensor */
#define MSG "a // b"
#define SQ(x) ((x)*(x))
void setup(){}`, new Set())
    expect(error).toBeFalsy()
    expect(code).toMatch(/const SERVOMIN = 110;/)
    expect(code).toMatch(/const MID = \(\(SERVOMIN \+ 490\) \/ 2\);/)
    expect(code).toMatch(/const ADDR = 0x41;/)
    expect(code).toMatch(/const BIG = 100000;/)
    expect(code).toMatch(/const PIN = \(A0\);/)
    expect(code).toMatch(/const MSG = "a \/\/ b";/)
    expect(code).not.toMatch(/SQ/)
  })
  it('the example sketch compiles cleanly', () => {
    const diag = analyzeArduino(PCA_EXAMPLE_SKETCH, { board: 'arduino' })
    expect(diag.errors, JSON.stringify(diag.errors)).toEqual([])
    const { code, error } = parseAndTranspile(PCA_EXAMPLE_SKETCH, new Set(['Adafruit_PWMServoDriver']))
    expect(error).toBeFalsy()
    expect(code).toMatch(/pwm\.setPWM/)
  })
})

// ── the real sandbox runtime ────────────────────────────────────────────────
function sandbox() {
  const html = bootstrapHtml('', '')
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1]
  const sent = []
  const ctx = vm.createContext({
    parent: { postMessage: (m) => { if (m?.t === 'out' && m.f === 'pcaOut') sent.push(m.a) } },
    addEventListener: () => {}, performance, setTimeout, console,
  })
  vm.runInContext(js, ctx)
  return { ctx, sent, run: (src) => vm.runInContext(src, ctx) }
}

describe('sandbox: Adafruit_PWMServoDriver', () => {
  it('begin() alone runs at ~1 kHz; setPWMFreq(50) then setPWM gives the pulse width', () => {
    const { run, sent } = sandbox()
    run('var pwm = Adafruit_PWMServoDriver(); pwm.begin(); pwm.setPWM(0, 0, 307)')
    expect(sent.at(-1)[3]).toBeGreaterThan(900)                  // 1 kHz → servo ignores it
    run('pwm.setPWMFreq(50)')                                    // re-sends channel 0 at the new rate
    const [addr, ch, us, hz] = sent.at(-1)
    expect([addr, ch]).toEqual([0x40, 0])
    expect(hz).toBeCloseTo(50.03, 2)
    expect(us).toBeCloseTo(1498.6, 0)                            // 307 ticks of 4.88 µs ≈ 1.5 ms ≈ 92°
  })
  it('the template pulse range 110 … 490 covers ~0° … ~180°', () => {
    const { run, sent } = sandbox()
    run('var pwm = new Adafruit_PWMServoDriver(0x41); pwm.begin(); pwm.setPWMFreq(50); pwm.setPWM(5, 0, 110); pwm.setPWM(5, 0, 490)')
    const [lo, hi] = sent.slice(-2)
    expect(lo[0]).toBe(0x41)
    expect(pulseToAngle(lo[2], lo[3])).toBeLessThan(2)
    expect(pulseToAngle(hi[2], hi[3])).toBeGreaterThan(178)
  })
  it('writeMicroseconds uses the library tick (oscillator the sketch sets)', () => {
    const { run, sent } = sandbox()
    run('var pwm = Adafruit_PWMServoDriver(); pwm.begin(); pwm.setPWMFreq(50); pwm.writeMicroseconds(2, 1500)')
    expect(sent.at(-1)[2]).toBeCloseTo(1500, -1)
    // calibrated for a 27 MHz chip, but this one runs at 25 MHz → pulses come out longer
    run('pwm.setOscillatorFrequency(27000000); pwm.setPWMFreq(50); pwm.writeMicroseconds(2, 1500)')
    expect(sent.at(-1)[2]).toBeGreaterThan(1500)
  })
  it('sleep() stops the pulses', () => {
    const { run, sent } = sandbox()
    run('var pwm = Adafruit_PWMServoDriver(); pwm.begin(); pwm.setPWMFreq(50); pwm.setPWM(1, 0, 300); pwm.sleep()')
    expect(sent.at(-1)[2]).toBe(0)
  })
})
