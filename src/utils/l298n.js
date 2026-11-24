// ─────────────────────────────────────────────────────────────────────────────
// L298N dual H-bridge motor driver — the logic, as pure functions.
//
// A motor no longer has to be wired straight to a board pin. With a driver:
//
//   board pin ──► IN1 / IN2 / ENA ──► [ L298N channel A ] ──► OUT1 / OUT2 ──► motor
//   board pin ──► IN3 / IN4 / ENB ──► [ L298N channel B ] ──► OUT3 / OUT4 ──► motor
//
// Each output is its IN level gated by the channel's EN level:
//
//   OUTn = INn × EN / 255 × L298N_DROP
//
// and the motor already turns at  TERM_A − TERM_B  (SimulationManager), so:
//   IN1 HIGH, IN2 LOW  → forward      IN1 LOW, IN2 HIGH → reverse
//   both LOW or both HIGH → stopped (brake)
//   analogWrite(ENA, 0…255) → speed   (or PWM on the IN pins with ENA left free)
//
// ENA / ENB jumper: on the real module a jumper ties EN to 5 V (always on).
// Here an EN pin with NO wire behaves like that jumper; wiring it to a board pin
// is "jumper removed" — the pin's value then gates the channel (LOW = off).
//
// Imports nothing, so electronicsStore and SimulationManager can both use it.
// ─────────────────────────────────────────────────────────────────────────────

export const L298N_INPUTS  = ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB']
export const L298N_OUTPUTS = ['OUT1', 'OUT2', 'OUT3', 'OUT4']
/** Every pin, in the order the wiring views list them. */
export const L298N_PIN_ORDER = ['OUT1', 'OUT2', 'OUT3', 'OUT4', '12V', 'GND', '5V', ...L298N_INPUTS]

/**
 * The L298N is a bipolar bridge: it drops ≈ 2 V between its supply and the
 * motor. On the 7.4 V pack the drive model assumes, the motor sees ≈ 5.4 V —
 * about 73 % of the speed it gets wired straight to the supply.
 */
export const L298N_DROP = (7.4 - 2.0) / 7.4

/** Which IN/EN pins drive which outputs. */
const CHANNELS = [
  { en: 'ENA', pairs: [['IN1', 'OUT1'], ['IN2', 'OUT2']] },
  { en: 'ENB', pairs: [['IN3', 'OUT3'], ['IN4', 'OUT4']] },
]

/**
 * Output levels (0…255 × drop) from the last value written to each input.
 * @param levels   { IN1…IN4, ENA, ENB } → 0…255 (missing = 0 / LOW)
 * @param enWired  { ENA?: true, ENB?: true } — EN pins that have a wire
 *                 (no wire = jumper on = always enabled)
 * @param grounded the driver shares a ground with the board; if not, its
 *                 inputs have no reference and nothing comes out.
 */
export function l298nOutputs(levels = {}, enWired = {}, grounded = true) {
  const out = { OUT1: 0, OUT2: 0, OUT3: 0, OUT4: 0 }
  if (!grounded) return out
  for (const { en, pairs } of CHANNELS) {
    const enable = enWired[en] ? (levels[en] ?? 0) : 255
    for (const [inp, o] of pairs) out[o] = ((levels[inp] ?? 0) * enable / 255) * L298N_DROP
  }
  return out
}

const MOTORS = new Set(['motor', 'motor_bo', 'motor_dc'])

/**
 * driverId → { OUT1: [{ id, terminal }], … } — the motor terminals wired to
 * each driver output. terminal is 'A' (TERM_A) or 'B' (TERM_B), the same
 * convention the direct-wired motor path uses.
 */
export function buildDriverOutputMap(connections, objects) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const map = {}
  for (const { fromPinId, toPinId } of Object.values(connections ?? {})) {
    for (const [a, b] of [[fromPinId, toPinId], [toPinId, fromPinId]]) {
      const [aComp, aPin] = a.split(':')
      const [bComp, bPin] = b.split(':')
      if (byId.get(aComp)?.type !== 'l298n' || !L298N_OUTPUTS.includes(aPin)) continue
      if (!MOTORS.has(byId.get(bComp)?.type) || !bPin?.startsWith('TERM')) continue
      const terminal = bPin === 'TERM_B' ? 'B' : 'A'
      const list = ((map[aComp] ??= {})[aPin] ??= [])
      if (!list.some((t) => t.id === bComp && t.terminal === terminal)) list.push({ id: bComp, terminal })
    }
  }
  return map
}

/** Motor ids reached through any L298N output (for "is this motor wired?" checks). */
export function motorsOnDrivers(connections, objects) {
  const ids = new Set()
  for (const outs of Object.values(buildDriverOutputMap(connections, objects)))
    for (const list of Object.values(outs)) for (const t of list) ids.add(t.id)
  return ids
}

/** Code-editor template: two motors through one L298N (CodeEditor → Templates). */
export const L298N_EXAMPLE_SKETCH = `// L298N dual motor driver
// Wiring:  ENA → ~5   IN1 → 7   IN2 → 8      (left motor on OUT1 / OUT2)
//          ENB → ~6   IN3 → 9   IN4 → 10     (right motor on OUT3 / OUT4)
//          L298N GND → Arduino GND   (shared ground — required!)
// IN1/IN2 set the direction, ENA sets the speed (0–255).
int ENA = 5, IN1 = 7, IN2 = 8;
int ENB = 6, IN3 = 9, IN4 = 10;

void drive(int left, int right) {      // -255 … 255 per side
  digitalWrite(IN1, left > 0);  digitalWrite(IN2, left < 0);
  digitalWrite(IN3, right > 0); digitalWrite(IN4, right < 0);
  analogWrite(ENA, abs(left));
  analogWrite(ENB, abs(right));
}

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
}

void loop() {
  drive(200, 200);    delay(2000);   // forward
  drive(-200, -200);  delay(1500);   // reverse
  drive(200, -200);   delay(800);    // spin on the spot
  drive(0, 0);        delay(1000);   // stop
}`
