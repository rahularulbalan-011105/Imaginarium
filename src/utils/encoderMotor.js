// ─────────────────────────────────────────────────────────────────────────────
// TT gear motor with a Hall quadrature encoder (type 'motor_enc') — the logic,
// as pure functions.
//
// A small magnet disc on the motor's rear shaft passes two Hall sensors 90°
// apart, so the encoder gives two square waves, A and B:
//
//   forward:   A rises while B is LOW  → A leads B
//   backward:  A rises while B is HIGH → B leads A
//
//   11 pulses per MOTOR turn (each pulse = 4 edges on A+B: "4× counting")
//   × the gearbox ratio            → pulses per WHEEL turn  (1:48 → 528)
//
// The simulator turns the motor's real speed (PWM → gearbox → load → spin-up
// lag) into an exact, signed quadrature count; the sandbox replays the count
// changes as A/B pin edges, firing attachInterrupt() handlers.
//
// Imports only gearMotor.js (also pure).
// ─────────────────────────────────────────────────────────────────────────────
import { gearSpecs } from './gearMotor.js'

/** Hall pulses per MOTOR-shaft revolution (one channel, rising edges). */
export const ENC_PPR = 11
/** Motor speed time constant (s): how quickly it spins up / coasts down. */
export const MOTOR_TAU = 0.06

/** Header pins: motor power M1/M2 (TERM_A/B), encoder A/B outputs, encoder supply. */
export const ENC_MOTOR_PIN_ORDER = ['TERM_A', 'TERM_B', 'ENC_A', 'ENC_B', 'VCC', 'GND']

/** Pulses (A rising edges) per output-shaft turn: PPR × gear ratio. ×4 for full quadrature. */
export const pulsesPerWheelTurn = (ratio) => ENC_PPR * ratio

/** Output-shaft rpm for a signed −255…255 drive value through gearbox `ratio`. */
export function outputRpm(net, ratio, loadFactor = 1) {
  return Math.sign(net) * gearSpecs(ratio).rpm * (Math.min(255, Math.abs(net)) / 255) * Math.max(0, loadFactor)
}

/** First-order step of the actual rpm toward the target over dt seconds. */
export const stepRpm = (rpm, target, dt, tau = MOTOR_TAU) => rpm + (target - rpm) * (1 - Math.exp(-Math.max(0, dt) / tau))

/** Signed 4×-quadrature count for a motor-shaft position in revolutions. */
export const quadCount = (motorRevs) => Math.floor(motorRevs * ENC_PPR * 4)

/** A/B levels for a quadrature count (state 0:00 → 1:A → 2:AB → 3:B → …). */
export function quadLevels(count) {
  const s = ((count % 4) + 4) % 4
  return { A: s === 1 || s === 2 ? 1 : 0, B: s === 2 || s === 3 ? 1 : 0 }
}

/**
 * Encoder wiring for every motor_enc: which board pins its A/B outputs reach,
 * and whether the encoder is powered (VCC → supply, GND → ground).
 * @param pinNum    (pinName) → board pin number | null   (electronicsStore.pinNameToNumber)
 * @param isSupply  (pinName) → bool                       (electronicsStore.isSupplyPinName)
 * @param isGround  (pinName) → bool                       (electronicsStore.isGroundPinName)
 * @returns {Object<string,{pinA:number|null,pinB:number|null,powered:boolean}>}
 */
export function encoderWiring(connections, objects, { pinNum, isSupply, isGround }) {
  const out = {}
  for (const o of objects) if (o.type === 'motor_enc') out[o.id] = { pinA: null, pinB: null, vcc: false, gnd: false }
  for (const { fromPinId, toPinId } of Object.values(connections ?? {})) {
    for (const [a, b] of [[fromPinId, toPinId], [toPinId, fromPinId]]) {
      const [aComp, aPin] = String(a).split(':')
      const st = out[aComp]
      if (!st) continue
      const bPin = String(b).split(':')[1]
      if (aPin === 'ENC_A') st.pinA = pinNum(bPin) ?? st.pinA
      if (aPin === 'ENC_B') st.pinB = pinNum(bPin) ?? st.pinB
      if (aPin === 'VCC' && isSupply(bPin)) st.vcc = true
      if (aPin === 'GND' && isGround(bPin)) st.gnd = true
    }
  }
  for (const st of Object.values(out)) { st.powered = st.vcc && st.gnd; delete st.vcc; delete st.gnd }
  return out
}

/** Arduino Uno: only pins 2 and 3 can trigger interrupts (INT0 / INT1). */
export const UNO_INTERRUPT_PINS = [2, 3]

/** Code-editor template (CodeEditor → Templates). */
export const ENCODER_EXAMPLE_SKETCH = `// TT motor with a Hall encoder: count pulses, turn the wheel exactly once,
// then measure the speed.
// Wiring:  motor M1 (+) → ~5      motor M2 (−) → GND
//          encoder A → 2  (an interrupt pin)   encoder B → 4
//          encoder VCC → 5V       encoder GND → GND
const int MOTOR = 5, ENC_A = 2, ENC_B = 4;

// 11 pulses per motor turn × the 1:48 gearbox = 528 per wheel turn.
// (Change the gearbox in Properties? Change this number too.)
const long PULSES_PER_TURN = 528;

volatile long ticks = 0;          // changed inside the interrupt → volatile

// Runs on every rising edge of A. B tells us which way it is turning.
void onA() {
  if (digitalRead(ENC_B) == LOW) ticks++;
  else ticks--;
}

void setup() {
  pinMode(ENC_A, INPUT_PULLUP);
  pinMode(ENC_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENC_A), onA, RISING);
  Serial.begin(9600);
}

void loop() {
  // 1. Exactly one wheel turn.
  noInterrupts(); ticks = 0; interrupts();
  analogWrite(MOTOR, 200);
  while (ticks < PULSES_PER_TURN) delay(2);
  analogWrite(MOTOR, 0);
  delay(300);                     // let it coast to a stop
  Serial.print("one turn: target 528, counted ");
  Serial.println(ticks);          // a bit more than 528 — the motor coasts

  // 2. Speed: count pulses for half a second.
  analogWrite(MOTOR, 150);
  delay(300);                     // spin up first
  noInterrupts(); ticks = 0; interrupts();
  delay(500);
  long n = ticks;
  analogWrite(MOTOR, 0);
  Serial.print("speed: ");
  Serial.print(n * 2 * 60 / PULSES_PER_TURN);
  Serial.println(" RPM");
  delay(1500);
}`
