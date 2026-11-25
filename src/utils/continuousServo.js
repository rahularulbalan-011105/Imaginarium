// ─────────────────────────────────────────────────────────────────────────────
// Continuous-rotation servo (FS90R-style) — the logic, as pure functions.
//
// It LOOKS and WIRES like a servo (SIGNAL / VCC / GND, Servo.attach + write),
// but inside, the position feedback is gone: the pulse no longer means "go to
// this angle", it means "turn at this speed".
//
//   write(90)        → stop
//   write(90 → 180)  → faster and faster one way   (full speed by ~130)
//   write(90 → 0)    → faster and faster the other way (full speed by ~50)
//
// So it is a MOTOR that speaks the servo protocol. That is why it is its own
// type ('servo_cr') and not a servo variant: everything that reads 'servo' as
// "a positional joint" (legged robots, the physics joint graph, encoders) must
// NOT treat it as one, and everything that drives wheels must treat it as a
// drive motor — with no L298N needed.
//
// Imports nothing (DriveManager, SimulationManager and tests use it).
// ─────────────────────────────────────────────────────────────────────────────

/** Within this many degrees of 90 the servo stays still (real ones have a small deadband). */
export const CR_DEADBAND_DEG = 1.5
/** Degrees from 90 at which it reaches full speed (≈ ±400 µs of pulse). */
export const CR_FULL_SPEED_DEG = 40
/** FS90R no-load speed at ~5 V. */
export const CR_MAX_RPM = 110
/** The drive model's full-PWM speed (DifferentialDrive: Kv 20 rpm/V × 7.4 V). */
const DRIVE_FULL_RPM = 20 * 7.4

/** Servo.write angle (0…180) → speed −1…+1 (+ = the 180 direction). */
export function crSpeed(angle) {
  const a = Math.max(0, Math.min(180, Number(angle) || 0))
  const d = a - 90
  if (Math.abs(d) <= CR_DEADBAND_DEG) return 0
  const s = (Math.abs(d) - CR_DEADBAND_DEG) / (CR_FULL_SPEED_DEG - CR_DEADBAND_DEG)
  return Math.sign(d) * Math.min(1, s)
}

/**
 * Servo.write angle → the signed −255…+255 "motor speed" the rest of the
 * simulator uses (wheel drive, horn spin), scaled so full speed is the FS90R's
 * 110 RPM rather than a 148 RPM BO motor's.
 */
export function crMotorSpeed(angle) {
  return crSpeed(angle) * 255 * (CR_MAX_RPM / DRIVE_FULL_RPM)
}

/** Code-editor template (CodeEditor → Templates). */
export const CR_SERVO_EXAMPLE_SKETCH = `// Two FS90R continuous-rotation servos as robot wheels
// Wiring:  left SIGNAL → 9    right SIGNAL → 10
//          both VCC → 5V      both GND → GND
// A continuous servo uses the normal Servo library, but write() sets
// SPEED, not angle:  90 = stop,  180 = full one way,  0 = full the other.
#include <Servo.h>

Servo left;
Servo right;

void drive(int l, int r) {          // -100 … 100 % per side
  left.write(90 + l * 40 / 100);
  right.write(90 + r * 40 / 100);
}

void setup() {
  left.attach(9);
  right.attach(10);
}

void loop() {
  drive(100, 100);   delay(2000);   // forward
  drive(0, 0);       delay(800);    // stop
  drive(60, -60);    delay(900);    // turn on the spot
  drive(-50, -50);   delay(1500);   // back up slowly
  drive(0, 0);       delay(1000);
}`
