// Servo gripper (claw) — pure logic: geometry, grip force, hold check.
//
// One hobby servo drives a gear; a second gear meshes with it, so the two
// links swing mirror-image. Each link carries a finger through a parallelogram,
// so the rubber pads stay parallel while they open and close (the common
// "parallel claw" kit). The sketch talks to it exactly like a servo:
//
//     Servo claw;  claw.attach(9);  claw.write(OPEN);  claw.write(CLOSED);
//
// write(0) = fully open, write(180) = fully closed (pads touching).
//
// Grip model (managers/GripperSystem.js runs it each frame):
//   • the jaws close at the servo's speed until the pads touch a LOOSE object
//     between them — then they stop at the object's width;
//   • the squeeze is the servo's position error: commanded just to the object's
//     width it barely presses; commanded well past it the servo pushes with its
//     full stall torque (and, like a real one, stalls and heats while it does);
//   • the object is held if the friction of both pads beats its weight:
//         2 · μ · F_pad ≥ m · g       F_pad = (τ_stall · η / 2) / L · cos θ
//     otherwise it slips out. Opening releases it and it falls.
import { SERVO_PRESETS } from '../managers/physics/robotics/ServoActuator.js'

// Geometry (scene units = cm), gripper frame: fingers point +z, jaws open along ±x.
export const GRIP = {
  maxGap: 4.0,           // pad-to-pad opening at write(0)
  pivotX: 0.45,          // gear axes at x = ±pivotX
  pivotZ: 0.9,
  link: 2.2,             // link length (cm) — the lever arm of the squeeze
  padInset: 0.27,        // finger plate + rubber pad thickness, inward from the link end
  padLen: 1.9,           // pad length along z
  padY: [-0.55, 0.55],   // pad height band (relative to the jaw plane)
}

export const GRIPPER_SERVOS = ['sg90', 'mg90s', 'mg996r']
export const DEFAULT_GRIPPER_SERVO = 'sg90'
export const servoOf = (obj) => (GRIPPER_SERVOS.includes(obj?.gripServo) ? obj.gripServo : DEFAULT_GRIPPER_SERVO)

/** Rubber pads on a plastic / wooden part. */
export const PAD_MU = 0.7
/** How much of the pad (height and length, cm) must bear on a part to grip it. */
export const MIN_BITE_CM = 0.15
/** Commanded this far (cm) past the object, the servo pushes with full stall torque. */
export const FULL_SQUEEZE_CM = 0.4

/** Pad-to-pad gap (cm) for a servo angle: 0° open … 180° closed. */
export const gapForAngle = (deg) => GRIP.maxGap * (1 - Math.max(0, Math.min(180, Number(deg) || 0)) / 180)
/** The servo angle that gives a gap (inverse of gapForAngle). */
export const angleForGap = (gap) => Math.round(180 * (1 - Math.max(0, Math.min(GRIP.maxGap, gap)) / GRIP.maxGap))

/** Link angle θ (rad, from +z, outward positive) that puts the pads `gap` apart. */
export function linkAngle(gap) {
  const s = (gap / 2 + GRIP.padInset - GRIP.pivotX) / GRIP.link
  return Math.asin(Math.max(-1, Math.min(1, s)))
}

/** Where each link ends (finger root) for a gap — the jaw is mirrored for the left side. */
export function fingerRoot(gap) {
  const t = linkAngle(gap)
  return { x: GRIP.pivotX + GRIP.link * Math.sin(t), z: GRIP.pivotZ + GRIP.link * Math.cos(t), theta: t }
}

/** The pad region (gripper frame) for a gap: between the pad faces, along the pad length. */
export function gripZone(gap) {
  const { z } = fingerRoot(gap)
  return { x: [-gap / 2, gap / 2], z: [z, z + GRIP.padLen], y: GRIP.padY }
}

/** Servo slew: how fast the gap can change (cm/s), from the servo's no-load speed. */
export function gapRate(servo) {
  const p = SERVO_PRESETS[servo] ?? SERVO_PRESETS.sg90
  const degPerS = (p.maxVelocity * 180) / Math.PI
  return (GRIP.maxGap * degPerS) / 180
}

/** Force (N) ONE pad presses with at full stall, at this gap. */
export function padForceN(servo, gap) {
  const p = SERVO_PRESETS[servo] ?? SERVO_PRESETS.sg90
  const tau = p.maxTorque * p.efficiency / 2                 // the gear pair shares the torque between both jaws
  return (tau / (GRIP.link / 100)) * Math.cos(linkAngle(gap))
}

/** Pad force (N) for a squeeze: commanded gap vs the object's width. */
export function squeezeN(servo, contactGap, commandedGap) {
  const over = contactGap - commandedGap
  const frac = Math.max(0, Math.min(1, over / FULL_SQUEEZE_CM))
  return padForceN(servo, contactGap) * frac
}

/** Friction capacity (N) of both pads at a pad force. */
export const holdCapacityN = (padN, mu = PAD_MU) => 2 * mu * padN

/** Heaviest part (kg) this servo can hold at full squeeze, for a part `width` cm wide. */
export function maxPayloadKg(servo, width, g = 9.81) {
  return holdCapacityN(padForceN(servo, width)) / Math.max(0.01, g)
}

/**
 * The part's footprint in the gripper frame (8 world-space corners already
 * transformed into the gripper frame): does it sit between the pads, and how wide is it?
 * @returns { inZone, width, centerX } or null when it isn't between the pads at all
 */
export function partBetweenPads(localBox, gap) {
  const zone = gripZone(gap)
  const { min, max } = localBox
  // the pads must really bear on it — a part the pad edge only grazes (the
  // table under the part, a wall beside it) is not gripped
  const overlaps = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) >= MIN_BITE_CM
  if (!overlaps(min.z, max.z, zone.z[0], zone.z[1])) return null
  if (!overlaps(min.y, max.y, zone.y[0], zone.y[1])) return null
  const cx = (min.x + max.x) / 2
  if (Math.abs(cx) > gap / 2) return null                    // its middle is outside the jaws
  return { width: max.x - min.x, centerX: cx }
}

export const GRIPPER_EXAMPLE_SKETCH = `// Servo gripper: close on the part, hold it, then let go.
// Wiring: gripper SIGNAL -> D9, VCC -> 5V, GND -> GND.
// Put a part between the jaws and tick "Loose object" in its Properties.
#include <Servo.h>

Servo claw;

const int OPEN   = 10;    // write(0) = fully open
const int CLOSED = 170;   // a bit past the part, so the servo squeezes it

void setup() {
  Serial.begin(9600);
  claw.attach(9);
  claw.write(OPEN);
  delay(1000);
}

void loop() {
  Serial.println("closing");
  for (int a = OPEN; a <= CLOSED; a += 5) {   // close slowly
    claw.write(a);
    delay(30);
  }
  Serial.println("holding");
  delay(2000);
  Serial.println("opening");
  claw.write(OPEN);
  delay(2000);
}
`

export const GRIPPER_ARM_SKETCH = `// Pick and place: an arm servo lifts the gripper, the gripper holds the part.
// Wiring: gripper SIGNAL -> D9, arm servo SIGNAL -> D10; both VCC -> 5V, GND -> GND.
// Build: arm servo lying on its side (horn axis horizontal) bonded to a base
// plate, the gripper attached to its horn; the part is a Loose object.
#include <Servo.h>

Servo claw, arm;

const int OPEN = 10, CLOSED = 170;   // gripper
const int DOWN = 90, UP = 150;       // arm: swap these if your arm lifts the other way

void setup() {
  Serial.begin(9600);
  claw.attach(9);
  arm.attach(10);
  arm.write(DOWN);
  claw.write(OPEN);
  delay(1200);
}

void loop() {
  Serial.println("grab");
  claw.write(CLOSED);
  delay(1000);

  Serial.println("lift");
  for (int a = DOWN; a <= UP; a += 2) { arm.write(a); delay(30); }
  delay(2000);

  Serial.println("drop");
  claw.write(OPEN);
  delay(1500);

  Serial.println("back down");
  for (int a = UP; a >= DOWN; a -= 2) { arm.write(a); delay(30); }
  delay(2000);
}
`
