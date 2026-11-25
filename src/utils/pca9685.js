// PCA9685 16-channel 12-bit PWM / servo driver — pure logic (no Three.js, no stores).
//
// The board talks I2C: the sketch never touches a servo pin. It sends
// "channel n: high from tick ON to tick OFF of every 4096-tick period" to the
// chip at address 0x40 (+ the A0–A5 jumpers), and the chip makes the pulses.
// The sandbox (managers/sketchSandbox.js, Adafruit_PWMServoDriver) does the
// library's arithmetic and hands the parent the resulting pulse width; this
// file turns that into what a servo does with it, and works out from the
// wiring which servos hang off which channel, and whether the board is on the
// I2C bus and powered at all.
//
// Power, as on the real board: VCC (3–5 V logic) runs the chip; V+ feeds the
// servo headers only. VCC without V+ → the chip answers but servos stay limp.

export const PCA_CHANNELS = 16
export const PCA_PWM_PINS = Array.from({ length: PCA_CHANNELS }, (_, i) => `PWM${i}`)
/** Pin order for the wiring UI: the 6-pin header, then the 16 channel signal pins. */
export const PCA_PIN_ORDER = ['GND', 'OE', 'SCL', 'SDA', 'VCC', 'V+', ...PCA_PWM_PINS]
export const PCA_DEFAULT_ADDR = 0x40
/** A0–A2 solder jumpers → 0x40 … 0x47 (A3–A5 reach 0x7F; eight boards = 128 servos is plenty here). */
export const PCA_ADDRESSES = Array.from({ length: 8 }, (_, i) => 0x40 + i)
export const hex = (a) => '0x' + Number(a).toString(16).toUpperCase().padStart(2, '0')
export const addrOf = (obj) => Number(obj?.i2cAddr ?? PCA_DEFAULT_ADDR)

/** The chip's internal oscillator (datasheet: 25 MHz). */
export const PCA_OSC = 25_000_000

/** Adafruit_PWMServoDriver::setPWMFreq() — the prescale register value for a wanted frequency. */
export function prescaleFor(freq, osc = PCA_OSC) {
  const f = Math.min(3500, Math.max(1, Number(freq) || 1))
  const v = osc / (f * 4096) + 0.5 - 1
  return Math.floor(Math.min(255, Math.max(3, v)))
}
/** The frequency the chip really runs at for a prescale value. */
export const freqOf = (prescale) => PCA_OSC / (4096 * (prescale + 1))

/** Pulse width (µs) for ON/OFF tick values, honouring the full-on / full-off bit (4096). */
export function pulseUs(on, off, prescale) {
  const period = 1e6 / freqOf(prescale)
  if (off >= 4096) return 0
  if (on >= 4096) return period
  const ticks = ((Number(off) - Number(on)) % 4096 + 4096) % 4096
  return (ticks * period) / 4096
}

// ── what a hobby servo does with a pulse ────────────────────────────────────
// The same end points as the Arduino Servo library (544 µs = 0°, 2400 µs = 180°).
export const SERVO_MIN_US = 544
export const SERVO_MAX_US = 2400
/** Pulses outside this window aren't a servo command: the servo ignores them. */
export const VALID_US = [300, 3000]
/** Above this a hobby servo can't follow the frame rate (analog ones heat and jitter). */
export const SERVO_MAX_HZ = 330

/**
 * Servo angle for a pulse, or null when the servo ignores it (no pulse, a pulse
 * that's too short/long to be a command, or a frame rate it can't follow).
 */
export function pulseToAngle(us, hz) {
  if (!(us > 0) || hz > SERVO_MAX_HZ) return null
  if (us < VALID_US[0] || us > VALID_US[1]) return null
  const a = ((us - SERVO_MIN_US) / (SERVO_MAX_US - SERVO_MIN_US)) * 180
  return Math.max(0, Math.min(180, a))
}

// ── wiring ──────────────────────────────────────────────────────────────────
/** The controller pins that carry I2C on each board (default Wire pins). */
export const BOARD_I2C = {
  arduino: { SDA: ['SDA'], SCL: ['SCL'] },                // A4 / A5 on an Uno
  esp32:   { SDA: ['GPIO21'], SCL: ['GPIO22'] },
  subo:    { SDA: null, SCL: null },                       // any IO pin: Wire.begin(sda, scl)
}
const BOARDS = new Set(Object.keys(BOARD_I2C))

/** Union-find over connected pins: every pin id → its net id. */
function nets(connections) {
  const parent = new Map()
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a) } return a }
  const add = (a) => { if (!parent.has(a)) parent.set(a, a) }
  for (const { fromPinId, toPinId } of Object.values(connections ?? {})) {
    add(fromPinId); add(toPinId)
    const ra = find(fromPinId), rb = find(toPinId)
    if (ra !== rb) parent.set(ra, rb)
  }
  const members = new Map()
  for (const p of parent.keys()) { const r = find(p); if (!members.has(r)) members.set(r, []); members.get(r).push(p) }
  return { netOf: (p) => (parent.has(p) ? find(p) : null), members: (p) => (parent.has(p) ? members.get(find(p)) : []) }
}

/**
 * Everything the simulator needs to know about each PCA9685 in the scene.
 * @returns { [pcaId]: { addr, sda, scl, swapped, logic, rail, channels: { ch: [servoId] } } }
 *   sda/scl  — that line reaches the board's I2C pin (directly or through another PCA9685: chaining)
 *   swapped  — SDA went to the board's SCL (or the other way round)
 *   logic    — VCC on a supply pin and GND on a ground pin: the chip is on
 *   rail     — V+ on a supply pin: the servo headers have power
 */
export function pcaWiring(connections, objects, { isSupply, isGround }) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const { members } = nets(connections)
  const pinsOn = (pinId) => members(pinId).map((p) => { const [id, pin] = p.split(':'); return { id, pin, type: byId.get(id)?.type } })
  const boardHas = (pinId, line) => pinsOn(pinId).some(({ type, pin }) => {
    if (!BOARDS.has(type)) return false
    const want = BOARD_I2C[type][line]
    return want ? want.includes(pin) : /^IO\d+$/.test(pin)
  })
  const out = {}
  for (const o of objects) {
    if (o.type !== 'pca9685') continue
    const id = o.id
    const sda = boardHas(`${id}:SDA`, 'SDA'), scl = boardHas(`${id}:SCL`, 'SCL')
    const strict = (pinId, line) => pinsOn(pinId).some(({ type, pin }) => BOARD_I2C[type]?.[line]?.includes(pin))
    const swapped = strict(`${id}:SDA`, 'SCL') || strict(`${id}:SCL`, 'SDA')
    // only a controller's own 5V / 3V3 / VIN / GND is a source (a servo's VCC on the same net is a load)
    const touches = (pin, test) => pinsOn(`${id}:${pin}`).some((p) => BOARDS.has(p.type) && test(p.pin))
    const channels = {}
    for (let ch = 0; ch < PCA_CHANNELS; ch++) {
      const servos = pinsOn(`${id}:PWM${ch}`).filter((p) => (p.type === 'servo' || p.type === 'servo_cr') && p.pin === 'SIGNAL').map((p) => p.id)
      if (servos.length) channels[ch] = servos
    }
    out[id] = {
      addr: addrOf(o), sda, scl, swapped,
      logic: touches('VCC', isSupply) && touches('GND', isGround),
      rail: touches('V+', isSupply),
      channels,
    }
  }
  return out
}

/** The three wires that plug a servo's lead onto channel `ch` (like the real 3-pin header). */
export function plugWires(pcaId, ch, servoId) {
  return [
    [`${pcaId}:PWM${ch}`, `${servoId}:SIGNAL`, '#eab308'],
    [`${pcaId}:V+`, `${servoId}:VCC`, '#ef4444'],
    [`${pcaId}:GND`, `${servoId}:GND`, '#1f2937'],
  ]
}

/** The header wires to a controller: GND, SCL, SDA, VCC and (small servos only) V+ from its 5 V. */
export function boardWires(pcaId, board) {
  const b = board.id
  const pins = board.type === 'esp32'
    ? { GND: 'GND1', SCL: 'GPIO22', SDA: 'GPIO21', VCC: '3V3', 'V+': 'VIN' }
    : board.type === 'subo'
      ? { GND: 'GND1', SCL: 'IO2', SDA: 'IO1', VCC: '5V', 'V+': '5V' }
      : { GND: 'GND1', SCL: 'SCL', SDA: 'SDA', VCC: '5V', 'V+': '5V' }
  const color = { GND: '#1f2937', SCL: '#3b82f6', SDA: '#22c55e', VCC: '#ef4444', 'V+': '#f97316' }
  return Object.entries(pins).map(([pca, pin]) => [`${pcaId}:${pca}`, `${b}:${pin}`, color[pca]])
}

export const PCA_EXAMPLE_SKETCH = `// PCA9685 servo driver: sweep the servos on channels 0-3, one after another.
// Wiring: PCA9685 GND -> GND, SCL -> SCL (A5), SDA -> SDA (A4), VCC -> 5V,
//         V+ -> 5V (servo power). Servos plug into channels 0, 1, 2, 3.
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();   // address 0x40

#define SERVO_FREQ 50     // analog servos run at ~50 Hz
#define SERVOMIN  110     // pulse length (ticks out of 4096) for 0 degrees
#define SERVOMAX  490     // pulse length for 180 degrees

// angle (0-180) -> pulse length in ticks
int angleToPulse(int angle) {
  return map(angle, 0, 180, SERVOMIN, SERVOMAX);
}

void setup() {
  Serial.begin(9600);
  Serial.println("PCA9685 servo test");
  pwm.begin();
  pwm.setPWMFreq(SERVO_FREQ);
  delay(10);
}

void loop() {
  for (int servo = 0; servo < 4; servo++) {
    Serial.print("servo ");
    Serial.println(servo);
    for (int a = 0; a <= 180; a += 5) { pwm.setPWM(servo, 0, angleToPulse(a)); delay(15); }
    for (int a = 180; a >= 0; a -= 5) { pwm.setPWM(servo, 0, angleToPulse(a)); delay(15); }
  }
}
`
