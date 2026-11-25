// ─────────────────────────────────────────────────────────────────────────────
// 28BYJ-48 stepper motor + ULN2003 driver board — the logic, as pure functions.
//
//   board pin ──► IN1…IN4 ──► [ ULN2003 ] ──► OUT1…OUT4 ──► coil wires ──► rotor
//                                  └── COM (+) ──────────────► red common wire
//
// The ULN2003 is four switches: INn HIGH → OUTn sinks current → that coil is
// energised (and the board's LED A…D lights). The motor is unipolar: four coil
// wires around the stator, 90° apart electrically:
//
//   BLUE 0°   PINK 90°   YELLOW 180°   ORANGE 270°
//
// The rotor turns to the magnetic field of the energised coils — the vector sum
// of their directions. That one rule gives the real behaviour for free:
//   • full step  (two coils, 1010 → 0110 → 0101 → 1001)      → 90° electrical
//   • half step  (one / two coils alternating)               → 45°
//   • wrong pin order (8,9,10,11 instead of 8,10,9,11)       → opposite coils,
//     no net field half the time → the motor hums and jitters, it doesn't turn
//   • stepping faster than the rotor can follow (> MAX_RPM)  → it misses steps
//     and stalls
// Each 90° electrical = one full step; 2048 full steps = one output revolution
// (32 steps × the ~1:64 gearbox — the figure every Arduino tutorial uses).
//
// Imports nothing, so electronicsStore, SimulationManager and tests can use it.
// ─────────────────────────────────────────────────────────────────────────────

export const ULN2003_INPUTS  = ['IN1', 'IN2', 'IN3', 'IN4']
export const ULN2003_OUTPUTS = ['OUT1', 'OUT2', 'OUT3', 'OUT4']
/** Every ULN2003 pin, in the order the wiring views list them. COM = the
 *  socket's red pin (tied to + on the board). */
export const ULN2003_PIN_ORDER = [...ULN2003_INPUTS, 'GND', 'VCC', ...ULN2003_OUTPUTS, 'COM']

/** 28BYJ-48 wires, named by their real colours. */
export const STEPPER_WIRES = ['BLUE', 'PINK', 'YELLOW', 'ORANGE', 'RED']
const COIL_ANGLE = { BLUE: 0, PINK: 90, YELLOW: 180, ORANGE: 270 }

/** The motor's 5-pin plug into the ULN2003 socket: [driver pin, motor wire, colour]. */
export const STEPPER_PLUG = [
  ['OUT1', 'BLUE', '#2563eb'],
  ['OUT2', 'PINK', '#ec4899'],
  ['OUT3', 'YELLOW', '#eab308'],
  ['OUT4', 'ORANGE', '#f97316'],
  ['COM', 'RED', '#ef4444'],
]

export const STEPS_PER_REV = 2048
/** Fastest the 28BYJ-48 follows at 5 V; faster and it starts missing steps. */
export const MAX_RPM = 17
/** Minimum time for one full step (90° electrical) at MAX_RPM. */
export const MIN_STEP_MS = 60000 / (STEPS_PER_REV * MAX_RPM)

// Same rule as electronicsStore.isSupplyPinName (kept local: this file imports nothing).
const isSupply = (p) => !!p && (/^(5V|3V3|VIN|VCC)$/.test(p) || p.endsWith('_V'))

/**
 * Wiring between drivers and steppers.
 * @returns {{ outMap: Object<string, Object<string, {id:string, wire:string}[]>>,
 *             common: Set<string> }}
 *   outMap: driverId → { OUT1: [{ id: stepperId, wire: 'BLUE' }], … }
 *   common: stepper ids whose RED common wire reaches + (ULN2003 COM/VCC or a
 *           supply pin) — without it no coil current flows.
 */
export function buildStepperWiring(connections, objects) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const outMap = {}
  const common = new Set()
  for (const { fromPinId, toPinId } of Object.values(connections ?? {})) {
    for (const [a, b] of [[fromPinId, toPinId], [toPinId, fromPinId]]) {
      const [aComp, aPin] = a.split(':')
      const [bComp, bPin] = b.split(':')
      if (byId.get(bComp)?.type !== 'stepper') continue
      const aType = byId.get(aComp)?.type
      if (bPin === 'RED' && (aType === 'uln2003' ? (aPin === 'COM' || aPin === 'VCC') : isSupply(aPin))) common.add(bComp)
      if (aType === 'uln2003' && ULN2003_OUTPUTS.includes(aPin) && bPin in COIL_ANGLE) {
        const list = ((outMap[aComp] ??= {})[aPin] ??= [])
        if (!list.some((t) => t.id === bComp && t.wire === bPin)) list.push({ id: bComp, wire: bPin })
      }
    }
  }
  return { outMap, common }
}

/** The ULN2003's VCC (+) reaches a supply pin on another part. */
export function isUln2003Powered(connections, driverId) {
  for (const { fromPinId, toPinId } of Object.values(connections ?? {})) {
    for (const [a, b] of [[fromPinId, toPinId], [toPinId, fromPinId]]) {
      const [aComp, aPin] = a.split(':')
      const [bComp, bPin] = b.split(':')
      if (aComp === driverId && aPin === 'VCC' && bComp !== driverId && isSupply(bPin)) return true
    }
  }
  return false
}

/** OUT1…OUT4 on/off from the last level written to each input (HIGH = > 127). */
export function uln2003Outputs(levels = {}, powered = true, grounded = true) {
  const on = powered && grounded
  return Object.fromEntries(ULN2003_OUTPUTS.map((o, i) => [o, on && (levels[ULN2003_INPUTS[i]] ?? 0) > 127]))
}

/**
 * Direction (degrees, electrical) of the field made by the energised coils, or
 * null when there is no net field (nothing on, or opposite coils cancelling).
 * @param on { BLUE?: bool, PINK?: bool, YELLOW?: bool, ORANGE?: bool }
 */
export function fieldAngle(on) {
  let x = 0, y = 0
  for (const [wire, deg] of Object.entries(COIL_ANGLE)) {
    if (!on[wire]) continue
    x += Math.cos((deg * Math.PI) / 180); y += Math.sin((deg * Math.PI) / 180)
  }
  if (Math.hypot(x, y) < 0.5) return null
  return Math.round((Math.atan2(y, x) * 180) / Math.PI / 45) * 45   // fields come in 45° steps
}

/** pos = rotor position in full steps (one full step = 90° electrical);
 *  lastT / lastField = when and where the field last moved. */
export function createRotor() { return { pos: 0, lastT: -Infinity, lastField: null, missed: 0 } }

const wrap180 = (a) => ((((a % 360) + 540) % 360) - 180)   // −180 … <180

/**
 * Move the rotor to the field of `on`, if it can. `t` (ms) is when this coil
 * pattern was applied; pass null to skip the speed check (raw digitalWrite
 * sequences carry no timing). Returns true if the rotor moved.
 *
 * Speed limit: if the FIELD moves faster than MAX_RPM allows, the rotor loses
 * sync and stays where it is (a real overdriven stepper hums and stalls — it
 * doesn't keep turning slowly). It picks up again once the steps slow down.
 */
export function driveRotor(rotor, on, t = null) {
  const phi = fieldAngle(on)
  if (phi == null) return false                         // no field: rotor stays put
  if (t != null) {
    const dField = rotor.lastField == null ? 90 : Math.abs(wrap180(phi - rotor.lastField))
    const tooFast = dField > 1e-6 && t - rotor.lastT < MIN_STEP_MS * (dField / 90) - 1e-6
    if (dField > 1e-6) { rotor.lastT = t; rotor.lastField = phi }
    if (tooFast) { rotor.missed++; return false }
  }
  const d = wrap180(phi - rotor.pos * 90)
  if (Math.abs(d) < 1e-6) return false
  if (Math.abs(d) >= 179.5) return false                // field exactly opposite: no torque to choose a way
  rotor.pos += d / 90
  return true
}

/** Output-shaft angle in radians (positive = clockwise seen from the shaft). */
export const shaftAngle = (rotor) => (rotor.pos / STEPS_PER_REV) * Math.PI * 2

/** Code-editor template (CodeEditor → Templates). */
export const STEPPER_EXAMPLE_SKETCH = `// 28BYJ-48 stepper motor + ULN2003 driver
// Wiring:  IN1 → 8   IN2 → 9   IN3 → 10   IN4 → 11
//          ULN2003 VCC → 5V   GND → GND      motor plug → ULN2003 socket
#include <Stepper.h>

const int STEPS_PER_REV = 2048;   // one turn of the output shaft (1:64 gearbox)

// Pin order is IN1, IN3, IN2, IN4 — the order this motor's coils need.
// (8, 9, 10, 11 makes it hum and jitter instead of turning.)
Stepper stepper(STEPS_PER_REV, 8, 10, 9, 11);

void setup() {
  stepper.setSpeed(12);           // RPM — the 28BYJ-48 tops out near 15
  Serial.begin(9600);
}

void loop() {
  Serial.println("one turn clockwise");
  stepper.step(STEPS_PER_REV);
  delay(500);

  Serial.println("quarter turn back");
  stepper.step(-STEPS_PER_REV / 4);
  delay(500);
}`
