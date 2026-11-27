// Why isn't the robot moving? — every reason the simulator finds, tagged with
// WHERE the problem is, so the user knows which workspace to open:
//
//   cad          the robot's build: joints, legs, weight, balance, materials
//   electronics  the wiring: a servo with no signal wire or no power, a battery
//   code         the sketch: wrong pin, never commands anything, a gait that
//                can't push the robot
//
// Pure functions (plain data in, plain issues out) so they are unit-tested.
// An issue: { id, category, severity: 'error'|'warning', title, detail, fix }

import { isSupplyPinName, isGroundPinName, pinNameToNumber } from '../../../stores/electronicsStore.js'

export const CATEGORY_LABEL = { cad: 'CAD', electronics: 'Electronics', code: 'Code' }

export function makeIssue(category, id, title, detail, fix, severity = 'error') {
  return { id, category, severity, title, detail, fix }
}

// ── CAD: can these legs walk at all? (ArticulatedRobot.walkability) ──────────
export function walkabilityIssue(walk) {
  if (!walk || walk.ok) return null
  if (walk.legs === 2 && walk.stuckLegs?.length && /side-to-side/.test(walk.reason ?? '')) {
    return makeIssue('cad', 'cad:biped-roll',
      "Two legs can't balance on one foot",
      'To step, a biped stands on one foot while the other swings — so it must lean its body over that foot. Every joint on this robot swings front-to-back; none tilts it sideways.',
      'Add a side-to-side (roll) servo to each leg — at the ankle or the hip.')
  }
  const n = walk.stuckLegs?.length ?? 0
  return makeIssue('cad', 'cad:legs-cant-lift',
    `${n} of ${walk.legs} legs can't lift a foot`,
    "A step needs a foot lifted clear of the ground while the others stand. With only a swing servo, a foot just sweeps along an arc on the floor — pushing back and forward equally, so the robot stays put.",
    'Add a knee (lift) servo to each leg, so the foot can rise during its forward swing.')
}

// ── CAD: is the robot too heavy for its servos? (static load check) ────────
// A vertical load F on a foot makes a torque about each leg joint equal to
// F × the joint-to-foot lever perpendicular to the joint axis. Standing, the
// weight is shared by every foot; while stepping only ~half the feet carry it
// (a biped: one), and a swinging leg is never perfectly straight — so the
// stepping lever is at least legLength·sin 15°.
const G = 9.81
const KGCM = 0.0980665           // N·m per kg·cm (servo datasheets quote kg·cm)
const STEP_TILT = Math.sin(15 * Math.PI / 180)

/**
 * @param robot { massKg, legs: [{ foot:{x,y,z}, joints:[{ anchor, axis, servo:{ name, maxTorque /N·m } }] }] }
 *              positions in scene units, axis unit vectors (world, authored pose)
 * @param suToM metres per scene unit
 * @returns [{ name, standNm, walkNm, maxNm }]
 */
export function servoLoads(robot, suToM) {
  const n = robot.legs.length
  if (!n || !(robot.massKg > 0)) return []
  const stanceStand = n, stanceWalk = Math.max(1, Math.floor(n / 2))
  const W = robot.massKg * G
  const out = []
  for (const leg of robot.legs) {
    for (const j of leg.joints) {
      if (!j.servo) continue
      const r = { x: (leg.foot.x - j.anchor.x) * suToM, y: (leg.foot.y - j.anchor.y) * suToM, z: (leg.foot.z - j.anchor.z) * suToM }
      // τ about axis a from an upward force at r:  a · (r × ŷ) = a.x·(−r.z) + a.z·r.x
      const lever = Math.abs(-j.axis.x * r.z + j.axis.z * r.x)
      const len = Math.hypot(r.x, r.y, r.z)
      const walkLever = Math.max(lever, len * STEP_TILT)
      out.push({ name: j.servo.name, standNm: W / stanceStand * lever, walkNm: W / stanceWalk * walkLever, maxNm: j.servo.maxTorque })
    }
  }
  return out
}

/** Load-check issues: can't stand (error) · can't step (error) · near the limit (warning). */
export function weightIssues(massKg, loads) {
  if (!loads.length) return []
  const worst = (k) => loads.reduce((a, b) => (b[k] / b.maxNm > a[k] / a.maxNm ? b : a))
  const kg = (nm) => (nm / KGCM).toFixed(nm / KGCM < 10 ? 1 : 0)
  const s = worst('standNm'), w = worst('walkNm')
  const mass = massKg < 10 ? massKg.toFixed(2) : massKg.toFixed(0)
  if (s.standNm > s.maxNm) {
    return [makeIssue('cad', 'cad:weight-stand',
      `Too heavy: the legs can't hold up ${mass} kg`,
      `Just standing, ${s.name} needs ${kg(s.standNm)} kg·cm of torque but gives at most ${kg(s.maxNm)} kg·cm (${Math.round(s.standNm / s.maxNm * 100)}% of its limit). The legs will fold and the robot will collapse.`,
      'Make the robot lighter, use stronger servos (Physics → Actuator), or put the feet closer under the joints (shorter lever).')]
  }
  if (w.walkNm > w.maxNm) {
    return [makeIssue('cad', 'cad:weight-walk',
      `Too heavy to walk: ${mass} kg on these servos`,
      `It can stand, but while stepping fewer feet carry the weight: ${w.name} would need ${kg(w.walkNm)} kg·cm and gives at most ${kg(w.maxNm)} kg·cm. The legs will sag or stall mid-step.`,
      'Make the robot lighter or use stronger servos (Physics → Actuator).')]
  }
  if (w.walkNm > 0.8 * w.maxNm) {
    return [makeIssue('cad', 'cad:weight-margin',
      `Heavy for its servos: ${mass} kg`,
      `While stepping, ${w.name} works at ${Math.round(w.walkNm / w.maxNm * 100)}% of its torque — any extra load or a low battery will make it stall.`,
      'Lighten the robot or pick a stronger servo (Physics → Actuator).', 'warning')]
  }
  return []
}

// ── CAD: parts that aren't attached (sceneGraph loose parts / skipped joints) ─
export function looseIssue(names) {
  if (!names.length) return null
  const shown = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
  return makeIssue('cad', 'cad:loose',
    `${shown} ${names.length === 1 ? "isn't" : "aren't"} attached to the robot`,
    `${names.length === 1 ? 'This part is' : 'These parts are'} not bonded, not on a servo horn, and not touching any other part. On a real robot ${names.length === 1 ? 'it' : 'they'} would fall off — the simulator holds ${names.length === 1 ? 'it' : 'them'} to the body for now, so the weight is still counted.`,
    'Bond each part to the robot (Surface → bond), attach it to a servo horn, or delete it.')
}

export function graphWarningIssue(warnings) {
  if (!warnings?.length) return null
  return makeIssue('cad', 'cad:graph',
    'Some joints could not be built',
    warnings.join('; '),
    'Check that each servo has a part attached to its horn and is mounted on the robot.', 'warning')
}

export function collapsedIssue(massKg) {
  return makeIssue('cad', 'run:collapsed',
    'The legs collapsed under the weight',
    `The body sank well below its standing height${massKg ? ` — the servos can't carry ${massKg < 10 ? massKg.toFixed(2) : massKg.toFixed(0)} kg` : ''}.`,
    'Make the robot lighter or use stronger servos (Physics → Actuator).')
}

export function engineIssue(reason) {
  return makeIssue('cad', 'cad:no-physics-model',
    "The physics model of this robot couldn't be built",
    `The real physics engine rejected the robot (${reason}), so it can't move under physics.`,
    'Check that every leg part is bonded or attached to a servo horn, and that the servos sit in the robot (CAD).')
}

// ── Electronics: is each servo wired to the board and powered? ───────────────
/**
 * @param servos       [{ id, name }]
 * @param connections  electronicsStore.connections (array or map of {fromPinId,toPinId})
 * @returns Map servoId → { signalPin: number|null, powered: boolean }
 */
export function servoWiring(servos, connections) {
  const out = new Map()
  for (const s of servos) out.set(s.id, { signalPin: null, pca: null, vcc: false, gnd: false })
  const conns = Object.values(connections ?? {})
  // A servo plugged into a PCA9685 channel (utils/pca9685.js) takes its power
  // from the board's V+ rail — which only has power if V+ is wired to a supply.
  const rails = new Set()
  for (const { fromPinId, toPinId } of conns)
    for (const [a, b] of [[fromPinId, toPinId], [toPinId, fromPinId]]) {
      const [aComp, aPin] = String(a).split(':')
      const [bComp, bPin] = String(b).split(':')
      if (aPin === 'V+' && !out.has(bComp) && isSupplyPinName(bPin)) rails.add(aComp)   // a servo's VCC is a load, not a supply
    }
  for (const { fromPinId, toPinId } of conns) {
    for (const [a, b] of [[fromPinId, toPinId], [toPinId, fromPinId]]) {
      const [aComp, aPin] = String(a).split(':')
      const st = out.get(aComp)
      if (!st) continue
      const [bComp, bPin] = String(b).split(':')
      if (aPin === 'SIGNAL') {
        const n = pinNameToNumber(bPin); if (n != null) st.signalPin = n
        const ch = /^PWM(\d+)$/.exec(bPin ?? ''); if (ch) st.pca = { id: bComp, ch: Number(ch[1]) }
      }
      if (aPin === 'VCC' && (isSupplyPinName(bPin) || (bPin === 'V+' && rails.has(bComp)))) st.vcc = true
      if (aPin === 'GND' && isGroundPinName(bPin)) st.gnd = true
    }
  }
  for (const st of out.values()) st.powered = st.vcc && st.gnd
  return out
}

/** The sketch can reach this servo: a board pin, or a PCA9685 channel. */
export const hasSignal = (w) => w?.signalPin != null || w?.pca != null

/** Servos the sketch can't move: no power, or no signal wire. */
export function servoWiringIssues(servos, wiring) {
  const issues = []
  const noPower = servos.filter(s => !wiring.get(s.id)?.powered)
  const noSignal = servos.filter(s => !hasSignal(wiring.get(s.id)))
  if (noPower.length) {
    issues.push(makeIssue('electronics', 'elec:servo-power',
      `${list(noPower)} ${noPower.length === 1 ? 'has' : 'have'} no power`,
      "A servo needs its VCC wired to a supply pin (5V) and its GND to a ground pin. Without power it can't hold or move — it goes limp.",
      'Build → Wiring: connect each servo VCC → 5V and GND → GND.'))
  }
  if (noSignal.length) {
    issues.push(makeIssue('electronics', 'elec:servo-signal',
      `${list(noSignal)} ${noSignal.length === 1 ? 'is' : 'are'} not connected to the board`,
      "Nothing is wired to the servo's SIGNAL pin, so the code can't reach it — it goes limp.",
      'Build → Wiring: connect each servo SIGNAL to a board pin (and use that pin in Servo.attach()), or plug it into a PCA9685 channel.'))
  }
  return issues
}

/** Servo.attach(pin) on a pin with no servo: a wiring gap or a wrong pin in the code? */
export function attachIssue(pin, servos, wiring) {
  const unwired = servos.filter(s => !hasSignal(wiring.get(s.id)))
  const used = [...new Set(servos.map(s => wiring.get(s.id)?.signalPin).filter(p => p != null))].sort((a, b) => a - b)
  if (unwired.length) {
    return makeIssue('electronics', `elec:attach-${pin}`,
      `Servo.attach(${pin}): no servo is wired to pin ${pin}`,
      `${list(unwired)} ${unwired.length === 1 ? 'has' : 'have'} no signal wire, so nothing on pin ${pin} moves.`,
      `Build → Wiring: connect a servo SIGNAL to pin ${pin}${used.length ? ` (servos are already on ${pinList(used)})` : ''}.`)
  }
  return makeIssue('code', `code:attach-${pin}`,
    `Servo.attach(${pin}): no servo is wired to pin ${pin}`,
    `Your servos are wired to ${pinList(used)}, but the code uses pin ${pin}.`,
    `Change Servo.attach(${pin}) to one of ${pinList(used)}.`)
}

export function fallenIssue(tiltDeg) {
  return makeIssue('cad', 'run:fallen',
    'The robot has fallen over',
    `Its body is on the ground${tiltDeg ? `, tipped ${Math.round(tiltDeg)}°` : ''}: the centre of mass went outside the feet while the legs moved. A robot lying down can't walk.`,
    'Lower the centre of mass, widen or lengthen the feet, or move heavy parts (boards, batteries) over the legs. A biped also needs roll servos to keep its balance while stepping.')
}

/** Body tilt from upright (deg), from a link quaternion whose authored pose is upright. */
export function tiltDeg(q) {
  const up = 1 - 2 * (q.x * q.x + q.z * q.z)
  return Math.acos(Math.max(-1, Math.min(1, up))) * 180 / Math.PI
}

export function idleCodeIssue() {
  return makeIssue('code', 'code:idle',
    "The code doesn't move anything",
    'The sketch is running but never calls walk()/turn() or Servo.write(), so the robot has no reason to move.',
    'Call walk(speed) — or attach the servos and Servo.write() angles in loop().', 'warning')
}

// ── Runtime: the robot is told to move but doesn't (physics telemetry) ──────
/**
 * Pick the most likely reason from one telemetry snapshot (ArticulatedRobot.telemetry()).
 * @param ctx { mode: 'gait'|'direct', walkable: boolean, stalledFrac, slipFrac }
 */
export function stuckIssue(t, ctx) {
  if (t?.battery?.brownout) {
    return makeIssue('electronics', 'run:brownout',
      'The battery browned out',
      'The servos drew more current than the battery can give; its voltage collapsed and the servos lost power.',
      'Use a bigger battery / higher current limit (Physics → Robot → Power), or fewer servos moving at once.')
  }
  if (t?.stability?.bodyContact && (t.stability.groundedFeet ?? 0) < 2) return fallenIssue()
  if ((ctx.stalledFrac ?? 0) > 0.4) {
    const kg = t?.stability?.mass
    return makeIssue('cad', 'run:servo-weak',
      "The servos are too weak for this robot's weight",
      `The leg servos are stalling at full torque${kg ? ` holding up ${kg.toFixed(2)} kg` : ''} — they can't move the legs, so the robot sags instead of stepping.`,
      'Choose a stronger servo (Physics → Actuator) or make the parts lighter.')
  }
  if ((ctx.slipFrac ?? 0) > 0.5) {
    return makeIssue('cad', 'run:slip',
      'The feet are slipping',
      'The feet slide on the floor instead of gripping, so pushing them back doesn\'t move the body.',
      'Give the feet a grippier material (Physics → Body → rubber), or make the robot heavier on its feet.')
  }
  if (ctx.mode === 'direct') {
    return makeIssue('code', 'run:gait-no-push',
      "The servo pattern doesn't push the robot",
      ctx.walkable
        ? "The legs move, but each foot pushes forward on the ground as much as backward, so the pushes cancel."
        : "The legs move, but no foot ever leaves the ground: each one pushes forward as much as backward, so the pushes cancel.",
      ctx.walkable
        ? 'Lift each foot (knee servo) while it swings forward and keep it down while it sweeps back — or use walk().'
        : 'This needs feet that lift (see the CAD issue) — a different servo pattern alone cannot make it walk.')
  }
  return makeIssue('cad', 'run:stuck',
    "The robot isn't moving forward",
    'The gait is running but the body is not advancing.',
    'Check the Physics panel telemetry: servo torque, foot contacts and the support margin.', 'warning')
}

/**
 * Watches "told to move" against "actually moved". Feed it every frame; it
 * returns 'stuck' once the robot has been commanded for `window` seconds with
 * less than `minMove` scene units of horizontal travel, 'moving' when it
 * makes progress again, else null.
 */
export class MotionWatchdog {
  constructor({ window = 2.5, minMove = 0.5, minTurn = 0.35 } = {}) {
    this.window = window; this.minMove = minMove; this.minTurn = minTurn
    this.reset()
  }
  reset() { this.t = 0; this.start = null; this.stuck = false; this.stalled = 0; this.slipping = 0; this.samples = 0 }
  /** @param commanded bool · pos {x,z,yaw?} · sample { stalled: bool, slipping: bool } */
  update(dt, commanded, pos, sample = {}) {
    if (!commanded || !pos) { this.t = 0; this.start = null; this.stalled = this.slipping = this.samples = 0; return null }
    if (!this.start) this.start = { x: pos.x, z: pos.z, yaw: pos.yaw ?? 0 }
    this.t += dt
    this.samples++
    if (sample.stalled) this.stalled++
    if (sample.slipping) this.slipping++
    const moved = Math.hypot(pos.x - this.start.x, pos.z - this.start.z)
    const dyaw = Math.abs(Math.atan2(Math.sin((pos.yaw ?? 0) - this.start.yaw), Math.cos((pos.yaw ?? 0) - this.start.yaw)))
    if (moved >= this.minMove || dyaw >= this.minTurn) {          // walked, or turned on the spot
      const was = this.stuck
      this.start = { x: pos.x, z: pos.z, yaw: pos.yaw ?? 0 }; this.t = 0; this.stuck = false
      this.stalled = this.slipping = this.samples = 0
      return was ? 'moving' : null
    }
    if (!this.stuck && this.t >= this.window) { this.stuck = true; return 'stuck' }
    return null
  }
  get stalledFrac()  { return this.samples ? this.stalled / this.samples : 0 }
  get slipFrac()     { return this.samples ? this.slipping / this.samples : 0 }
}

function list(servos) {
  const names = servos.map(s => s.name || s.id)
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
}
function pinList(pins) { return pins.length ? pins.map(p => `pin ${p}`).join(', ') : 'no pins' }
