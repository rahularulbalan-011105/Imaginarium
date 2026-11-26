// Mecanum wheels — pure logic: roller geometry, and the drive kinematics that
// let a robot move sideways.
//
// A mecanum wheel is a normal hub whose rim is a ring of free rollers set at 45°
// to the axle. The wheel can only push the robot ACROSS its bottom roller (along
// the roller it just rolls freely), so each wheel pushes diagonally. Four wheels,
// two of each hand (A = rollers one way, B = the other), add up to any motion:
//
//   all four forward                → forward
//   FL+ FR− RL− RR+  (diagonal pairs) → sideways (strafe)
//   left side − , right side +        → turn on the spot
//
// For a wheel at (x forward, y left) on the robot, rolling at surface speed v,
// with its bottom roller's axis at angle β from forward:
//
//   v = (vx − ω·y) + s·(vy + ω·x)        s = −cot β   (±1 for 45° rollers)
//
// A plain wheel is s = 0 plus "no sideways slip": vy + ω·x = 0.
// solveTwist() finds the robot velocity (vx, vy, ω) that best fits every wheel
// (least squares), so 4 mecanum wheels in the right X pattern strafe, a wrong
// pattern can't, and a plain wheel mixed in blocks sideways motion — all from
// the same equations, as on a real robot. The roller direction is read from
// the wheel's actual orientation, never assumed.

export const MECANUM_HANDS = ['A', 'B']
/** A rollers lean one way, B the other (seen from above). */
export const handSign = (hand) => (hand === 'B' ? 1 : -1)
export const isMecanum = (obj) => obj?.type === 'wheel' && obj.wheelStyle === 'mecanum'

/**
 * Axis of the roller at angle φ around the axle, in the wheel's own frame
 * (axle = local X; the roller sits at (0, r·cos φ, r·sin φ)). 45° between the
 * axle and the rim's direction of travel. Used for BOTH the 3D model and the
 * physics, so what you see is what drives.
 */
export function rollerAxisLocal(phi, hand) {
  const k = Math.SQRT1_2
  return [handSign(hand) * k, -Math.sin(phi) * k, Math.cos(phi) * k]
}
/** The roller touching the ground (φ = π, at (0, −r, 0)). */
export const contactRollerAxisLocal = (hand) => rollerAxisLocal(Math.PI, hand)

/**
 * Axis of whichever roller is touching the ground, from the axle direction in
 * the world (y up) — valid however far the wheel has spun, since every roller
 * takes the same slant as it reaches the bottom. Same rule as rollerAxisLocal:
 * axis = hand·axle + (up × axle), normalised (at φ = π that is (h, 0, −1)/√2).
 */
export function groundRollerAxis(axle, hand) {
  const h = handSign(hand)
  const t = [axle[2], 0, -axle[0]]                       // up × axle
  const a = [h * axle[0] + t[0], h * axle[1] + t[1], h * axle[2] + t[2]]
  const n = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / n, a[1] / n, a[2] / n]
}

/**
 * Slip factor s of a wheel whose ground roller points along `axisWorld`,
 * on a robot facing `fwd` with `left` to its left (all unit 3-vectors, y up).
 * s = −cot β, β = roller angle from forward. Rollers along the axle (β = 90°)
 * give 0 — a plain wheel; rollers along the direction of travel can't drive.
 */
export function slipFactor(axisWorld, fwd, left) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const c = dot(axisWorld, fwd), sn = dot(axisWorld, left)
  if (Math.abs(sn) < 1e-6) return c >= 0 ? -1e3 : 1e3
  return -c / sn
}

const W_NOSLIP = 4   // a plain wheel's sideways grip, vs its rolling row (tyres can scrub a little)

/** Rows of the wheel equations:  row · [vx, vy, ω] = target. */
function rows(wheels) {
  const R = []
  for (const w of wheels) {
    if (w.s == null) {                                        // plain wheel
      R.push({ a: [1, 0, -w.y], b: w.v ?? 0, k: 1 })
      R.push({ a: [0, 1, w.x], b: 0, k: W_NOSLIP })
    } else R.push({ a: [1, w.s, -w.y + w.s * w.x], b: w.v ?? 0, k: 1 })
  }
  return R
}

function solve3(M, r) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(M)
  if (Math.abs(D) < 1e-12) return [0, 0, 0]
  return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((v, j) => (j === c ? r[i] : v)))) / D)
}

/**
 * Robot velocity from its wheels.
 * @param wheels [{ x, y, v, s }]  x forward, y left (scene units), v surface speed,
 *                                 s slip factor (null = plain wheel)
 * @returns { vx, vy, omega }      forward, leftward (units/s), turn rate (rad/s, + = left)
 */
export function solveTwist(wheels) {
  const R = rows(wheels)
  const M = [[1e-6, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]], r = [0, 0, 0]
  for (const { a, b, k } of R) {
    const w = k * k
    for (let i = 0; i < 3; i++) {
      r[i] += w * a[i] * b
      for (let j = 0; j < 3; j++) M[i][j] += w * a[i] * a[j]
    }
  }
  const [vx, vy, omega] = solve3(M, r)
  return { vx, vy, omega }
}

/** Wheel surface speeds that produce a robot velocity (inverse kinematics). */
export function wheelSpeedsFor(wheels, { vx = 0, vy = 0, omega = 0 }) {
  return wheels.map((w) => (vx - omega * w.y) + (w.s == null ? 0 : w.s * (vy + omega * w.x)))
}

/**
 * Can this wheel layout strafe / turn? Command the motion, let the wheels
 * produce it, and see what the robot actually does.
 */
export function layoutCheck(wheels) {
  const reach = Math.max(1, ...wheels.map((w) => Math.abs(w.x) + Math.abs(w.y)))
  const test = (cmd) => {
    const v = wheelSpeedsFor(wheels, cmd)
    return solveTwist(wheels.map((w, i) => ({ ...w, v: v[i] })))
  }
  const st = test({ vy: 1 })
  const tu = test({ omega: 1 / reach })
  // The layout: in the standard X the diagonal pairs match (FL = RR, FR = RL) and
  // every roller leans so that s·sign(x)·sign(y) = −1. The mirror image ("O")
  // still moves, but sideways and turning come out reversed vs X-pattern code,
  // and it barely resists spinning (worst on a square chassis).
  const mec = wheels.filter((w) => w.s != null && Math.abs(w.s) > 0.2)
  const sgn = mec.map((w) => Math.sign(w.s) * Math.sign(w.x || 1e-9) * Math.sign(w.y || 1e-9))
  const pattern = !mec.length ? 'plain'
    : mec.length !== wheels.length ? 'mixed'
    : sgn.every((v) => v < 0) ? 'X' : sgn.every((v) => v > 0) ? 'O' : 'mixed'
  return {
    pattern,
    canStrafe: Math.abs(st.vy - 1) < 0.15 && Math.abs(st.vx) < 0.15 && Math.abs(st.omega * reach) < 0.15,
    canTurn: Math.abs(tu.omega * reach - 1) < 0.25,
    strafeGot: st,
  }
}

export const MECANUM_EXAMPLE_SKETCH = `// Mecanum robot: forward, sideways, diagonal and turning on the spot.
// Four TT motors with mecanum wheels on two L298N drivers (ENA/ENB jumpers on):
//   driver 1: IN1 -> D2, IN2 -> D3 (front-left)   IN3 -> D4, IN4 -> D5 (rear-left)
//   driver 2: IN1 -> D6, IN2 -> D7 (front-right)  IN3 -> D8, IN4 -> D9 (rear-right)
// Wheels in an X: front-left and rear-right are one hand (A), the other two B.

const int FL1 = 2, FL2 = 3, RL1 = 4, RL2 = 5;
const int FR1 = 6, FR2 = 7, RR1 = 8, RR2 = 9;

// one wheel: +1 forward, -1 backward, 0 stop
void wheel(int a, int b, int dir) {
  digitalWrite(a, dir > 0 ? HIGH : LOW);
  digitalWrite(b, dir < 0 ? HIGH : LOW);
}

void drive(int fl, int fr, int rl, int rr) {
  wheel(FL1, FL2, fl); wheel(FR1, FR2, fr);
  wheel(RL1, RL2, rl); wheel(RR1, RR2, rr);
}

void setup() {
  Serial.begin(9600);
  for (int p = 2; p <= 9; p++) pinMode(p, OUTPUT);
}

// run a move for a while, then stop briefly so the robot settles (it has momentum)
void move(const char *name, int fl, int fr, int rl, int rr) {
  Serial.println(name);
  drive(fl, fr, rl, rr); delay(1500);
  drive(0, 0, 0, 0);     delay(600);
}

void loop() {
  move("forward",       1,  1,  1,  1);
  move("strafe right",  1, -1, -1,  1);
  move("backward",     -1, -1, -1, -1);
  move("strafe left",  -1,  1,  1, -1);
  move("diagonal",      1,  0,  0,  1);
  move("turn left",    -1,  1, -1,  1);
  delay(1000);
}
`
