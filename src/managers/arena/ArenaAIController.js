import * as THREE from 'three'
import { physicsManager } from '../physics/PhysicsManager.js'
import { weaponManager } from '../WeaponManager.js'
import { useCombatStore } from '../../stores/combatStore.js'
import { wrapAngle } from './smoothing.js'

// ─────────────────────────────────────────────────────────────────────────────
// ArenaAIController — the Physics-Arena 1v1 opponent.
//
// It produces the SAME input shape the player does — { fwd, turn, primary,
// secondary } — so it plugs straight into CombatManager._drive + WeaponManager:
// same speed caps, same cooldowns/heat/reload, same hit detection and damage.
// It never touches health, damage, physics or weapons directly.
//
// Layers (all cheap; strategic work runs only on decision ticks):
//   perception  – a lagged, smoothed estimate of the player (reaction time) and
//                 a lead prediction whose quality depends on difficulty
//   observation – slow moving averages of how the player fights THIS match
//                 (closing, range, lateral/circling, fire rate, chasing, backing
//                 off after hits) → a style guess with confidence and inertia
//   personality – a per-match temperament (aggressive/tactical/defensive/
//                 erratic/balanced) with jittered parameters
//   tactics     – utility-scored states (approach / attack / strafe / charge /
//                 retreat / evade / recover) with noise, minimum durations and a
//                 switching margin so it doesn't dither
//   execution   – steering + range keeping + fire discipline (range, aim, line
//                 of sight, heat, rocket splash) with human-like mistakes
//
// Fairness: adaptation only changes DECISIONS. When the AI is winning it makes
// more mistakes and eases off; when losing it gets more decisive. Stats never move.
//
// Weapons (Normal / Hard): the AI aims like a player with a mouse — it outputs
// an aim POINT (`out.aim`: its lagged estimate of you, led by the round's flight
// time, offset by this window's aim error) and its guns swivel toward it within
// their real arc + traverse speed; shots leave the real muzzles along the real
// barrels. It fires a weapon only when THAT barrel bears on its aim point. Easy
// keeps the old fixed-gun behaviour (it steers the hull to aim).
//
// What it may know (CombatManager's intel): your robot's visible components and
// their visible condition (wear / sag / smoke are on screen), your drive state,
// rockets in flight, and its own weapons — including whether its barrel's path
// is blocked (the same trace your impact pip shows). Never your inputs, never
// the future, never a hidden stat.
// ─────────────────────────────────────────────────────────────────────────────

// Difficulty tiers — THE place difficulty lives. configure() accepts
// { level, ...overrides }; the legacy keys (reactionMin/Max, accuracy, aimTol)
// are still honoured. No tier changes health, damage, ammo, cooldowns, speed or
// physics — only how well the AI perceives, decides and aims.
//   reactionMin/Max   ms between decisions          perceptionLag  s (smoothing of what it sees)
//   accuracy          → per-window aim error         predict        0..1 lead quality
//   aimTol            fire tolerance (rad)            wobble         hand shake (rad)
//   mistakes / brilliance   chance of a slip / a sharp read per window
//   openMin/Max       ms it sizes you up before the first shot
//   turret            swivels its guns at an aim point (else steers the hull)
//   verify            checks its barrel's path; never fires into a wall
//   fireOnMove        keeps shooting while circling / dodging when a gun bears
//   burst / rest      trigger-hold / pause lengths (ms)
//   orbitLeg / turnIn while circling: ms spent orbiting vs turning in to shoot
//   dodge             chance it sidesteps a rocket it sees coming
//   partAim           chance per window it aims at a chosen component (your gun,
//                     a damaged drive unit, a failing mount) instead of the hull
//   rocketDiscipline  holds splash weapons for a good shot (slow / close target)
//   exploit           how strongly it adapts to the state of the fight (your lost
//                     weapons / mobility, its own damage, a blocked line of fire)
//   ease              how much it eases off while winning (rubber band)
const TIERS = {
  easy: {
    reactionMin: 420, reactionMax: 650, accuracy: 0.62, aimTol: 0.2, turnGain: 1.5,
    perceptionLag: 0.34, predict: 0.25, learnTime: 22, obsTau: 9, wobble: 0.09,
    mistakes: 0.2, brilliance: 0.03, noise: 0.2, openMin: 1800, openMax: 3200,
    turret: false, verify: false, fireOnMove: false, burst: [500, 1400], rest: [120, 520],
    dodge: 0, partAim: 0, rocketDiscipline: false, exploit: 0.2, ease: 1.6,
    orbitLeg: [800, 1900], turnIn: [450, 900],
  },
  normal: {
    reactionMin: 280, reactionMax: 480, accuracy: 0.68, aimTol: 0.16, turnGain: 1.8,
    perceptionLag: 0.26, predict: 0.5, learnTime: 13, obsTau: 6, wobble: 0.07,
    mistakes: 0.14, brilliance: 0.07, noise: 0.14, openMin: 1100, openMax: 2300,
    turret: true, verify: false, fireOnMove: true, burst: [600, 1500], rest: [160, 520],
    dodge: 0.3, partAim: 0.2, rocketDiscipline: false, exploit: 0.6, ease: 1.0,
    orbitLeg: [700, 1600], turnIn: [550, 1000],
  },
  hard: {
    reactionMin: 170, reactionMax: 290, accuracy: 0.88, aimTol: 0.12, turnGain: 2.3,
    perceptionLag: 0.11, predict: 0.9, learnTime: 7, obsTau: 4, wobble: 0.03,
    mistakes: 0.05, brilliance: 0.14, noise: 0.08, openMin: 250, openMax: 600,
    turret: true, verify: true, fireOnMove: true, burst: [1100, 2400], rest: [60, 220],
    dodge: 0.75, partAim: 0.65, rocketDiscipline: true, exploit: 1, ease: 0.35,
    orbitLeg: [450, 1000], turnIn: [750, 1400],
  },
}
const DEFAULT_LEVEL = 'normal'

// Per-match temperaments. aggr = base aggression; strafe/charge/retreat bias the
// tactic scores; range scales the preferred distance; heat = how hot it runs
// before holding fire; chaos = extra decision noise.
const PERSONAS = [
  { name: 'aggressive', aggr: 0.78, strafe: 0.35, charge: 0.35, retreat: -0.12, range: 0.8, heat: 0.88, chaos: 1.0 },
  { name: 'tactical',   aggr: 0.5,  strafe: 0.6,  charge: 0.0,  retreat: 0.05,  range: 1.05, heat: 0.72, chaos: 0.8 },
  { name: 'defensive',  aggr: 0.32, strafe: 0.45, charge: -0.15, retreat: 0.18, range: 1.15, heat: 0.7, chaos: 0.9 },
  { name: 'erratic',    aggr: 0.58, strafe: 0.5,  charge: 0.2,  retreat: 0.05,  range: 0.95, heat: 0.82, chaos: 1.9 },
  { name: 'balanced',   aggr: 0.55, strafe: 0.42, charge: 0.1,  retreat: 0.0,   range: 1.0,  heat: 0.78, chaos: 1.0 },
]

// Minimum / maximum time (ms) a tactic runs before it may be reconsidered.
const STATE_TIME = {
  approach: [1000, 3600], attack: [1400, 3800], strafe: [1600, 4000], charge: [900, 2600],
  retreat: [900, 2200], evade: [500, 950], recover: [1000, 2600],
}
const SWITCH_MARGIN = 0.12   // a new tactic must beat the current one by this much

const STYLES = ['aggressive', 'defensive', 'ranged', 'chaser', 'strafer']

const rand = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = (v) => clamp(v, 0, 1)
const ema = (cur, x, dt, tau) => cur + (x - cur) * (1 - Math.exp(-dt / tau))
const hpOf = (a) => (a ? Math.max(0, a.armor) + Math.max(0, a.core) : 0)
const hpFrac = (a) => (a ? hpOf(a) / Math.max(1, (a.armorMax ?? 100) + (a.coreMax ?? 100)) : 1)
// yaw (atan2(fwd.x, fwd.z)) of a Rapier rotation without allocating
const yawOfRot = (r) => Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y))

export class ArenaAIController {
  constructor() {
    this.configure()
  }

  configure(difficulty = {}) {
    const level = TIERS[difficulty.level] ? difficulty.level : DEFAULT_LEVEL
    this._difficulty = { ...TIERS[level], ...difficulty, level }
    this._reset()
    return this
  }

  _reset() {
    const d = this._difficulty
    // Personality for this match, with ±12% parameter jitter so two "tactical"
    // opponents still differ.
    const base = PERSONAS[Math.floor(Math.random() * PERSONAS.length)]
    const j = (v) => v * rand(0.88, 1.12)
    this._persona = {
      ...base, aggr: clamp01(j(base.aggr)), strafe: j(base.strafe), range: j(base.range),
      heat: clamp(j(base.heat), 0.6, 0.9), chaos: j(base.chaos),
    }
    this._aggr = this._persona.aggr         // live aggression (drifts during the match)
    this._aggrWalk = 0                        // bounded random walk added to aggression

    this._state = 'approach'
    this._stateSince = 0
    this._stateMin = 0
    this._stateMax = 0
    this._decideAt = 0
    this._started = 0
    this._openUntil = 0
    this._lastNow = 0

    // execution details refreshed on decisions
    this._aimError = 0
    this._leadSign = 1
    this._fireLoose = 0                       // + = fires a bit early, − = waits for a clean shot
    this._hesitateUntil = 0
    this._burstUntil = 0
    this._burstRestUntil = 0
    this._orbitDir = Math.random() < 0.5 ? -1 : 1
    this._turnInAt = 0
    this._turnInUntil = 0
    this._evadeDir = 1
    this._evadeReadyAt = 0
    this._weavePhase = rand(0, Math.PI * 2)
    this._weaveAmp = 0
    this._los = true
    this._wallAhead = false
    this._wallBehind = false
    this._flank = 0                           // sideways aim-point offset (rad) for flanking runs
    this._lastFwd = 0
    this._lastFwdAbs = 0
    this._selfId = null

    // retreat budget — never flee forever
    this._retreatLog = []                     // [startMs, endMs]
    this._retreatStart = 0

    // unstick (legacy behaviour, kept)
    this._prevX = 0; this._prevZ = 0
    this._stuckFor = 0
    this._unstickUntil = 0
    this._unstickTurn = 1

    // perception
    this._seen = null                         // { x, z, vx, vz }

    // observation model of the PLAYER (this match only)
    this._model = {
      t: 0, conf: 0, style: 'balanced', pending: null, pendingN: 0,
      closing: 0, lateral: 0, orbit: 0, closeFrac: 0, farFrac: 0, dist: 20,
      fireRate: 0, chasing: 0, backoff: 0, accuracy: 0.5, aimingAtMe: 0,
    }
    this._obs = {
      playerAmmo: null, prevPlayerHp: null, prevSelfHp: null,
      lastPlayerShot: -1e9, lastSelfShot: -1e9, hitWindowUntil: 0, hitWindowDist: 0,
      dealt: 0, taken: 0,                     // decayed damage tallies (momentum)
      selfAmmo: null,
    }
    this._dominance = 0
    this._mistakeRate = this._difficulty.mistakes

    // weapons / tactics on the real state of the fight
    this._aim = new THREE.Vector3()
    this._aimErrY = 0
    this._aimPart = null                      // a component of the player it is aiming at (id)
    this._vp = []; this._vpAt = -1e9          // cached visible parts of the player
    this._blocked = false                     // its barrel's path meets a wall first
    this._blockedFor = 0
    this._verifyIn = 0
    this._rocketSeen = new WeakMap()          // rocket → { at, dodge, done }
    this._dodgeReadyAt = 0
    this._intel = { playerArmed: true, playerDrive: 1, selfDrive: 1 }
    this.stats = { dodges: 0, blockedHolds: 0, partPicks: 0, shotsCalled: 0, hold: {} }
  }

  // Dev / test: what it is doing and why.
  debug() {
    return { level: this._difficulty.level, state: this._state, persona: this._persona.name, style: this._model.style,
      aimPart: this._aimPart, blocked: this._blocked, blockedFor: +this._blockedFor.toFixed(2), los: this._los,
      intel: { ...this._intel }, stats: { ...this.stats, hold: { ...this.stats.hold } } }
  }

  // Compute this frame's input for `self` fighting `targetRobot`.
  update(dt, self, selfActor, targetRobot, now, weapons, intel = null) {
    const out = { fwd: 0, turn: 0, primary: false, secondary: false, aim: null }
    if (!self || !targetRobot || !selfActor || selfActor.state === 'destroyed') return out
    const body = physicsManager.getBody(self.bodyId)
    const tgtBody = physicsManager.getBody(targetRobot.bodyId)
    if (!body || !tgtBody) return out
    this._selfId = self.bodyId
    if (!this._started) {
      this._started = now
      this._decideAt = now + rand(150, 450)
      const dd = this._difficulty
      this._openUntil = now + rand(dd.openMin, dd.openMax) * (1.25 - this._persona.aggr * 0.5)
    }
    this._lastNow = now

    const d = this._difficulty
    const P = body.translation()
    const T = tgtBody.translation()
    const TV = tgtBody.linvel()
    const SV = body.linvel()
    const heading = yawOfRot(body.rotation())
    const targetHeading = yawOfRot(tgtBody.rotation())

    // ── Perception: lagged estimate of where the player is and how it moves ──
    if (!this._seen) this._seen = { x: T.x, z: T.z, vx: TV.x, vz: TV.z }
    const s = this._seen
    s.x = ema(s.x, T.x, dt, d.perceptionLag)
    s.z = ema(s.z, T.z, dt, d.perceptionLag)
    s.vx = ema(s.vx, TV.x, dt, d.perceptionLag * 1.5)
    s.vz = ema(s.vz, TV.z, dt, d.perceptionLag * 1.5)

    const dx = s.x - P.x, dz = s.z - P.z
    const dist = Math.max(0.01, Math.hypot(dx, dz))
    const bearing = Math.atan2(dx, dz)

    // Weapon envelope from the equipped weapons that still WORK (a wrecked gun
    // still hangs on but is no use; a torn-off one has already left the groups).
    const works = (i) => !!i && (!intel || intel.condition(self.id, i) !== 'OFFLINE')
    const prim = works(weapons?.primary) ? weapons.primary : (weapons?.primaries || []).find(works) || null
    const sec = works(weapons?.secondary) ? weapons.secondary : null
    const main = prim || (sec?.weaponMesh ? sec : null)        // the weapon it fights with
    const pDef = main?.def ?? null
    const sDef = (main === sec ? null : sec?.def) ?? null
    const env = this._envelope(pDef, sDef, self, targetRobot)

    const selfHp = hpFrac(selfActor)
    const playerActor = useCombatStore.getState().actors?.[targetRobot.id]
    const playerHp = hpFrac(playerActor)

    this._observe(dt, now, P, T, TV, SV, dist, targetHeading, selfActor, playerActor, targetRobot, weapons?.primary, weapons?.secondary)

    // ── Strategic decision (reaction-time ticks only) ────────────────────────
    if (now >= this._decideAt) {
      this._decideAt = now + rand(d.reactionMin, d.reactionMax)
      this._decide(now, P, body, targetRobot, dist, bearing, env, selfActor, selfHp, playerHp, main, self, intel)
    }
    // A rocket it can see coming: sidestep (a reflex, not a tactic re-think).
    if (d.dodge > 0 && intel) this._watchRockets(now, P, self, intel, bearing)

    // ── Unstick: barely moved while trying to → wiggle out (legacy behaviour) ─
    const moved = Math.hypot(P.x - this._prevX, P.z - this._prevZ)
    this._prevX = P.x; this._prevZ = P.z
    if (dist > env.contact && this._lastFwdAbs > 0.3 && moved < 0.02 * dt * 60) this._stuckFor += dt
    else this._stuckFor = Math.max(0, this._stuckFor - dt * 2)
    if (this._stuckFor > 0.6 && now >= this._unstickUntil) {
      this._unstickUntil = now + 650; this._unstickTurn = Math.random() < 0.5 ? -1 : 1; this._stuckFor = 0
      this._orbitDir = -this._orbitDir
    }
    if (now < this._unstickUntil) {
      out.turn = this._unstickTurn
      out.fwd = this._lastFwd >= 0 ? -0.6 : 0.6
      this._lastFwdAbs = 0
      return out
    }

    // ── Execute the current tactic ────────────────────────────────────────────
    // Aim point: perceived position + lead (projectile flight / reaction), with
    // the decision's persistent aim error. The lead can be wrong (leadSign).
    // Its guns share one aim point: lead for the weapon that fires most (the
    // sustained gun), not the occasional rocket.
    const leadDef = [prim, sec].filter(i => i?.weaponMesh).sort((a, b) => (b.def.fireRateHz || 0) - (a.def.fireRateHz || 0))[0]?.def ?? pDef
    const flight = leadDef?.projectileSpeed ? dist / leadDef.projectileSpeed : 0.12   // rockets + shells travel
    const lead = d.predict * flight * this._leadSign
    const ax = s.x + s.vx * lead, az = s.z + s.vz * lead
    const aimYaw = Math.atan2(ax - P.x, az - P.z) + this._aimError
    const t = (now - this._started) / 1000

    let desiredYaw = aimYaw
    let fwd = 0
    let mayFire = true
    const st = this._state

    if (st === 'approach') {
      // Weave on the way in so the approach isn't a straight, predictable line.
      desiredYaw = bearing + this._flank + Math.sin(t * 2.6 + this._weavePhase) * this._weaveAmp
      const err = Math.abs(wrapAngle(desiredYaw - heading))
      fwd = err < 1.1 ? 1 : 0.35
      if (dist < env.ideal) { desiredYaw = aimYaw; fwd = 0.4 }
    } else if (st === 'attack') {
      // Hold the weapon's sweet spot while aiming; never a sitting duck.
      desiredYaw = aimYaw
      if (dist > env.ideal + 2.5) fwd = 0.65
      else if (dist < env.min || dist < env.ideal - 4) fwd = this._wallBehind ? 0 : -0.7
      else fwd = 0.3 * Math.sin(t * 1.9 + this._weavePhase)
    } else if (st === 'strafe') {
      // Orbit the player at the preferred radius; periodically turn in to shoot.
      if (now >= this._turnInAt && now >= this._turnInUntil) {
        this._turnInUntil = now + rand(d.turnIn[0], d.turnIn[1])
        this._turnInAt = this._turnInUntil + rand(d.orbitLeg[0], d.orbitLeg[1]) * (1.2 - this._aggr * 0.5)
      }
      if (now < this._turnInUntil) {
        desiredYaw = aimYaw
        fwd = dist > env.ideal + 3 ? 0.4 : dist < env.min ? -0.5 : 0.1
      } else {
        const around = Math.atan2(P.x - s.x, P.z - s.z) + this._orbitDir * 0.75
        const ox = s.x + Math.sin(around) * env.ideal, oz = s.z + Math.cos(around) * env.ideal
        desiredYaw = Math.atan2(ox - P.x, oz - P.z)
        fwd = 0.9
        mayFire = d.fireOnMove        // a swivelling gun keeps firing while it circles
      }
    } else if (st === 'charge') {
      // Full-speed ram (the existing collision damage rewards the faster robot).
      desiredYaw = bearing + this._aimError * 0.5
      fwd = 1
    } else if (st === 'retreat') {
      // Kite: keep facing the player and back away, shooting as it goes.
      desiredYaw = aimYaw
      fwd = this._wallBehind ? 0.2 : -1
    } else if (st === 'evade') {
      // Sidestep out of the player's line of fire.
      desiredYaw = bearing + this._evadeDir * 1.35
      fwd = 1
      mayFire = d.fireOnMove
    } else if (st === 'recover') {
      // Overheated / staggered / empty: create space, face the threat.
      desiredYaw = aimYaw
      fwd = dist < env.ideal + 6 && !this._wallBehind ? -0.8 : 0.25
    }

    // The gun may not point down the nose (a weapon turned on its mount): steer
    // so the GUN bears where the nose was meant to — and judge "aimed" on it.
    const gunOff = weaponManager.weaponYawOffset(self.id)
    const yawErr = wrapAngle(desiredYaw - heading - gunOff)
    // Positive yaw error = target to the LEFT; turn input +1 steers RIGHT
    // (CombatManager._drive: yaw rate = -turn · rate), so steer with the negative.
    out.turn = clamp(-yawErr * d.turnGain, -1, 1)
    out.fwd = fwd
    this._lastFwd = fwd
    this._lastFwdAbs = Math.abs(fwd)

    // ── Aim point (turret tiers) ──────────────────────────────────────────────
    // Where it BELIEVES the target point is: a chosen component (else the
    // hull), shifted by its perception lag, led by the round's flight time, and
    // offset by this window's aim error turned into a miss distance. The guns
    // swivel toward it at their real traverse speed (WeaponManager).
    const wob = Math.sin(t * 3.1 + this._weavePhase) * d.wobble
    if (d.turret) {
      let bx = T.x, by = T.y, bz = T.z
      const tp = this._aimPart && intel ? this._partsOf(intel, targetRobot.id, now).find(p => p.id === this._aimPart) : null
      if (tp) { bx = tp.center.x; by = tp.center.y; bz = tp.center.z } else this._aimPart = null
      const px = bx + (s.x - T.x) + s.vx * lead, pz = bz + (s.z - T.z) + s.vz * lead
      const miss = Math.tan(this._aimError + wob) * dist
      const lx = (pz - P.z) / dist, lz = -(px - P.x) / dist          // across the line of sight
      out.aim = this._aim.set(px + lx * miss, by + this._aimErrY * dist, pz + lz * miss)
    }

    // ── Fire discipline ───────────────────────────────────────────────────────
    // "Aimed" is judged against where the AI BELIEVES the target is (aim error
    // and a small hand wobble included), so a bad read produces real misses.
    const angularSize = Math.atan2((targetRobot.radius || 1.5) * 0.9, dist)
    const tolFor = (def) => Math.max(0.03, d.aimTol * 0.5 + angularSize + ((def?.spreadDeg ?? 2) * Math.PI / 180) * 0.4 + this._fireLoose)
    const hullAimed = (def, off) => Math.abs(wrapAngle(aimYaw + wob - heading - off)) < tolFor(def)
    // Turret tiers: THIS weapon's real barrel must bear on the aim point (and the
    // aim point be inside its arc) — it never fires a gun that points elsewhere.
    const aligned = (inst) => {
      if (!d.turret || !inst?.weaponMesh || !intel || !out.aim) return hullAimed(inst?.def, inst?.weaponMesh ? gunOff : 0)
      if (inst.outOfArc) return false
      const ray = intel.aimRay(self, inst)
      if (!ray) return false
      const e = Math.abs(wrapAngle(Math.atan2(ray.forward.x, ray.forward.z) - Math.atan2(out.aim.x - ray.muzzle.x, out.aim.z - ray.muzzle.z)))
      return e < tolFor(inst.def) * 0.8
    }
    // Verify tiers: is its head weapon's path blocked by the arena (a wall in
    // the way)? Then it holds fire and (in _decide) repositions.
    if (d.verify && intel && main?.weaponMesh && (this._verifyIn -= dt) <= 0) {
      this._verifyIn = 0.1
      const ray = intel.aimRay(self, main)
      if (ray) {
        const tr = intel.traceShot(self.id, ray.muzzle, ray.forward, Math.min(main.def.range, dist + 6))
        this._blocked = !tr.targetId && tr.dist < dist - (targetRobot.radius || 1.5) - 0.5
      }
    } else if (!d.verify) this._blocked = false
    this._blockedFor = this._blocked ? this._blockedFor + dt : Math.max(0, this._blockedFor - dt * 2)
    const hot = selfActor.overheated || selfActor.heat > selfActor.heatMax * this._persona.heat
    const pressing = playerHp < 0.25 && selfActor.heat < selfActor.heatMax * 0.95   // finish-off exception
    // Opening: size the opponent up before the first shot (unless shot first).
    const opening = now < this._openUntil && now - this._obs.lastPlayerShot > 1500
    const canShoot = mayFire && !opening && this._los && now >= this._hesitateUntil && (!hot || pressing) &&
      now < this._burstUntil && st !== 'recover'
    if (canShoot && this._blocked) this.stats.blockedHolds++
    // Self-safety for splash weapons uses the nearer of perceived/actual distance
    // (it only prevents blowing itself up; it never helps it hit).
    const safeDist = Math.min(dist, Math.hypot(T.x - P.x, T.z - P.z))
    const ready = (inst) => !!inst && (intel ? intel.usable(self.id, inst) : !inst.reloading)
    // Splash weapons are held for a shot that will tell (Hard): a slow or close
    // target, a staggered one, or the finish.
    const goodShot = (def) => !def?.splashRadius || !d.rocketDiscipline ||
      Math.hypot(s.vx, s.vz) < 7 || dist < 32 || playerActor?.staggered || playerHp < 0.3
    const call = (inst, rangeK) => inst && ready(inst) && dist <= inst.def.range * rangeK &&
      !(inst.def.splashRadius && safeDist < inst.def.splashRadius + 2) && goodShot(inst.def) && aligned(inst)
    if (canShoot && !this._blocked) {
      if (call(prim, 0.98)) out.primary = true
      if (call(sec, 0.92)) out.secondary = true
      if (out.primary || out.secondary) this.stats.shotsCalled++
    }
    // Dev instrumentation: why it is NOT firing this frame (first reason wins).
    if (!out.primary && !out.secondary) {
      const why = !mayFire ? 'moving' : opening ? 'opening' : !this._los ? 'no-los' : now < this._hesitateUntil ? 'hesitating'
        : hot && !pressing ? 'heat' : now >= this._burstUntil ? 'burst-rest' : st === 'recover' ? 'recover' : this._blocked ? 'blocked'
        : ![prim, sec].some(i => ready(i)) ? 'not-ready' : ![prim, sec].some(i => i && dist <= i.def.range * 0.95) ? 'range'
        : ![prim, sec].some(i => i && aligned(i)) ? ([prim, sec].some(i => i?.outOfArc) ? 'out-of-arc' : 'aligning') : 'holding'
      this.stats.hold[why] = (this.stats.hold[why] || 0) + 1
    }
    // Bursts: hold the trigger in human-length bursts with short rests.
    if (now >= this._burstUntil && now >= this._burstRestUntil) {
      this._burstUntil = now + rand(d.burst[0], d.burst[1]) * (0.7 + this._aggr * 0.6)
      this._burstRestUntil = this._burstUntil + rand(d.rest[0], d.rest[1]) * (1.3 - this._aggr * 0.6)
    }
    return out
  }

  // The player's visible components (refreshed ~10×/s, not every frame).
  _partsOf(intel, id, now) {
    if (now - this._vpAt > 100) { this._vp = intel.visibleParts(id) || []; this._vpAt = now }
    return this._vp
  }

  // Watch the rockets in flight it did not fire. Each one is judged ONCE after
  // its reaction time (dodge chance = tier): if its line passes inside the
  // blast radius soon, step out of it to the side the line is already passing.
  _watchRockets(now, P, self, intel, bearing) {
    const d = this._difficulty
    for (const rk of intel.incoming(self.id)) {
      let r = this._rocketSeen.get(rk.id)
      if (!r) { r = { at: now, dodge: Math.random() < d.dodge, done: false }; this._rocketSeen.set(rk.id, r) }
      if (r.done || now - r.at < d.reactionMin) continue
      r.done = true
      if (!r.dodge || now < this._dodgeReadyAt) continue
      const rx = P.x - rk.pos.x, ry = P.y - rk.pos.y, rz = P.z - rk.pos.z
      const along = rx * rk.dir.x + ry * rk.dir.y + rz * rk.dir.z
      if (along <= 0 || along / rk.speed > 1.6) continue                  // going away / far off
      const cx = rx - rk.dir.x * along, cz = rz - rk.dir.z * along         // line → me
      if (Math.hypot(cx, cz) > rk.splash * 0.8 + (self.radius || 1.5)) continue
      this._enter('evade', now, bearing, P, 0, null)
      // Move further off the rocket's line (the side it would pass on).
      const yawA = bearing + 1.35, yawB = bearing - 1.35
      const da = Math.sin(yawA) * cx + Math.cos(yawA) * cz, db = Math.sin(yawB) * cx + Math.cos(yawB) * cz
      this._evadeDir = Math.abs(da - db) < 1e-3 ? (this._wallAhead ? -this._evadeDir : this._evadeDir) : da > db ? 1 : -1
      this._dodgeReadyAt = now + 900
      this.stats.dodges++
    }
  }

  // Preferred distances for the equipped weapons.
  _envelope(pDef, sDef, self, target) {
    const contact = (self.radius || 1.5) + (target.radius || 1.5)
    let ideal, min
    if (pDef) {
      ideal = Math.min(pDef.range * 0.6, 22)
      min = 3
      if (pDef.splashRadius) { ideal = Math.max(ideal, pDef.splashRadius + 6); min = pDef.splashRadius + 2 }
      if (pDef.range < 20) { ideal = pDef.range * 0.55; min = 2 }
    } else {
      // Melee-only robot: get in close.
      ideal = Math.max(contact + 0.5, (sDef?.range ?? 7) * 0.6)
      min = 0
    }
    ideal = Math.max(contact + 1, ideal * this._persona.range)
    return { ideal, min, contact: contact + 1, melee: !pDef, ranged: !!pDef && pDef.range >= 20 }
  }

  // ── Observation: what is the player doing this match? ──────────────────────
  _observe(dt, now, P, T, TV, SV, dist, targetHeading, selfActor, playerActor, targetRobot, prim, sec) {
    const m = this._model, o = this._obs, d = this._difficulty
    const tau = d.obsTau
    m.t += dt
    m.conf = 1 - Math.exp(-m.t / d.learnTime)

    const maxV = targetRobot.stats?.maxSpeed || 16
    const ux = (P.x - T.x) / dist, uz = (P.z - T.z) / dist          // player → AI
    const along = (TV.x * ux + TV.z * uz) / maxV                    // + = player closing in
    const lat = (TV.x * uz - TV.z * ux) / maxV                      // signed lateral (circling)
    m.closing = ema(m.closing, clamp(along, -1, 1), dt, tau)
    // Circling = most of the movement is sideways to the line between us (kiting
    // and rushing are mostly radial). Only judged while the player is moving.
    if (Math.hypot(along, lat) > 0.25) {
      m.lateral = ema(m.lateral, Math.abs(lat) / (Math.abs(lat) + Math.abs(along) + 1e-3), dt, tau)
      m.orbit = ema(m.orbit, clamp(lat, -1, 1), dt, tau)
    } else {
      m.lateral = ema(m.lateral, 0, dt, tau * 2)
      m.orbit = ema(m.orbit, 0, dt, tau * 2)
    }
    m.dist = ema(m.dist, dist, dt, tau)
    m.closeFrac = ema(m.closeFrac, dist < 10 ? 1 : 0, dt, tau)
    m.farFrac = ema(m.farFrac, dist > 20 ? 1 : 0, dt, tau)

    // Is the player's gun pointed at me?
    const toMe = Math.atan2(P.x - T.x, P.z - T.z)
    const pAim = Math.abs(wrapAngle(toMe - targetHeading))
    m.aimingAtMe = ema(m.aimingAtMe, pAim < 0.3 ? 1 : 0, dt, 0.5)

    // Player shots (ammo counters of the player's real weapons).
    const pw = weaponManager.weaponsFor(targetRobot.id)
    const ammo = (pw?.primary?.ammo ?? 0) + (pw?.secondary?.ammo ?? 0)
    let shot = 0
    if (o.playerAmmo !== null && ammo < o.playerAmmo) { shot = o.playerAmmo - ammo; o.lastPlayerShot = now }
    o.playerAmmo = ammo
    const rateNorm = (pw?.primary?.def?.fireRateHz || pw?.secondary?.def?.fireRateHz || 4)
    m.fireRate = ema(m.fireRate, dt > 0 ? clamp(shot / dt / rateNorm, 0, 1) : 0, dt, tau)

    // Chasing: player closing while I move away from it.
    const myAway = (SV.x * ux + SV.z * uz) / maxV
    m.chasing = ema(m.chasing, along > 0.25 && myAway > 0.2 ? 1 : 0, dt, tau)

    // Damage bookkeeping (momentum + player accuracy + backing off after hits).
    const selfHp = hpOf(selfActor), playerHp = hpOf(playerActor)
    const ammoSelf = (prim?.ammo ?? 0) + (sec?.ammo ?? 0)
    if (o.selfAmmo !== null && ammoSelf < o.selfAmmo) o.lastSelfShot = now
    o.selfAmmo = ammoSelf
    const decay = Math.exp(-dt / 10)
    o.dealt *= decay; o.taken *= decay
    if (o.prevSelfHp !== null && selfHp < o.prevSelfHp) {
      const dmg = o.prevSelfHp - selfHp
      o.taken += dmg
      if (now - o.lastPlayerShot < 300) m.accuracy = ema(m.accuracy, 1, 0.5, 4)
    } else if (shot) {
      m.accuracy = ema(m.accuracy, 0, 0.12, 4)
    }
    if (o.prevPlayerHp !== null && playerHp < o.prevPlayerHp) {
      o.dealt += o.prevPlayerHp - playerHp
      o.hitWindowUntil = now + 1500; o.hitWindowDist = dist
    }
    if (now < o.hitWindowUntil) {
      // After being hit, does the player open distance?
      m.backoff = ema(m.backoff, dist > o.hitWindowDist + 0.5 ? 1 : 0, dt, tau)
    }
    o.prevSelfHp = selfHp; o.prevPlayerHp = playerHp
  }

  // Style guess with confidence + inertia (a candidate must persist to stick).
  _classify() {
    const m = this._model
    const scores = {
      aggressive: 0.45 * Math.max(0, m.closing) * 2 + 0.35 * m.closeFrac + 0.2 * m.fireRate,
      defensive: 0.45 * Math.max(0, -m.closing) * 2 + 0.25 * (1 - m.fireRate) * m.farFrac + 0.3 * m.backoff,
      // Keeps its distance AND shoots from there (a camper that never fires isn't "ranged").
      ranged: 0.5 * m.farFrac * Math.min(1, 0.3 + 2 * m.fireRate) + 0.4 * m.fireRate - 0.3 * m.closeFrac,
      chaser: 1.2 * m.chasing,
      strafer: 0.75 * m.lateral + 0.35 * Math.abs(m.orbit) - 0.1,
    }
    let best = 'balanced', bestV = 0.34, second = 0
    for (const k of STYLES) {
      const v = scores[k]
      if (v > bestV) { second = bestV; bestV = v; best = k } else if (v > second) second = v
    }
    if (best !== 'balanced' && bestV - second < 0.06) best = 'balanced'
    // Hysteresis: an existing read holds while it is still reasonably supported.
    if (m.style !== 'balanced' && scores[m.style] >= 0.26 && bestV - scores[m.style] < 0.1) best = m.style
    if (m.conf < 0.25) best = 'balanced'                 // too early to tell
    if (best === m.style) { m.pending = null; m.pendingN = 0; return }
    if (best === m.pending) m.pendingN++
    else { m.pending = best; m.pendingN = 1 }
    if (m.pendingN >= 3) { m.style = best; m.pending = null; m.pendingN = 0 }
  }

  // ── Decision tick ───────────────────────────────────────────────────────────
  _decide(now, P, body, targetRobot, dist, bearing, env, selfActor, selfHp, playerHp, prim, self = null, intel = null) {
    const d = this._difficulty, m = this._model, per = this._persona
    this._classify()

    // Momentum: who is winning lately (damage dealt vs taken + health lead).
    const o = this._obs
    const flow = (o.dealt - o.taken) / Math.max(20, o.dealt + o.taken)
    this._dominance = clamp(0.6 * flow + 0.6 * (selfHp - playerHp), -1, 1)
    const dom = this._dominance
    // Winning → sloppier and calmer; losing → sharper and more decisive. How
    // much it eases off while ahead is the tier's `ease`.
    this._mistakeRate = clamp(d.mistakes * (1 + 1.6 * d.ease * Math.max(0, dom)) * (1 - 0.6 * Math.max(0, -dom)), 0.01, 0.45)

    // The state of the fight as it can see it: are your guns still working,
    // how is your drivetrain, how is its own?
    if (intel && self) {
      const vp = this._partsOf(intel, targetRobot.id, now)
      const pd = intel.driveState(targetRobot.id), sd = intel.driveState(self.id)
      this._intel = {
        playerArmed: vp.some(p => p.role === 'weapon' && p.health > 0),
        playerDrive: pd.units ? pd.mean : 1,
        selfDrive: sd.units ? sd.mean : 1,
      }
    }

    this._aggrWalk = clamp(this._aggrWalk + rand(-0.08, 0.08) * per.chaos, -0.2, 0.2)
    const aggrTarget = clamp01(per.aggr + 0.3 * (selfHp - playerHp) + this._aggrWalk
      - 0.18 * d.ease * Math.max(0, dom - 0.2) + 0.12 * Math.max(0, -dom - 0.2)
      + (playerHp < 0.3 ? 0.15 : 0) - (selfHp < 0.3 ? 0.15 : 0))
    this._aggr += (aggrTarget - this._aggr) * 0.3

    // Line of sight + wall probes (existing physics raycast; a few per second).
    this._los = this._probeLOS(P, targetRobot, dist)
    const hdg = yawOfRot(body.rotation())
    this._wallBehind = this._probeWall(P, hdg + Math.PI, 5, targetRobot.id)
    this._wallAhead = this._probeWall(P, hdg, 5, targetRobot.id)

    // Fresh execution noise for this reaction window.
    // Comfortably ahead → aims a little lazier; behind → no change (never sharper
    // than its tier).
    const spreadAim = (1 - d.accuracy) * 0.55 * (1 + 0.9 * d.ease * Math.max(0, dom - 0.15))
    this._aimError = rand(-spreadAim, spreadAim)
    this._aimErrY = rand(-spreadAim, spreadAim) * 0.3
    // Component targeting: now and then it picks the part that matters most and
    // aims at it instead of the hull — your working gun (more so if its mount
    // is already failing), a damaged drive unit, a part hanging off.
    this._aimPart = null
    if (d.partAim > 0 && intel && dist < 48 && Math.random() < d.partAim * (0.5 + 0.5 * m.conf)) {
      this._aimPart = this._pickPart(this._partsOf(intel, targetRobot.id, now))
      if (this._aimPart) this.stats.partPicks++
    }
    this._leadSign = 1
    this._fireLoose = rand(-0.02, 0.03)
    const sharp = Math.random() < d.brilliance * (1 + Math.max(0, -dom))
    const erring = Math.random() < this._mistakeRate
    if (sharp) { this._aimError *= 0.2; this._leadSign = 1.25 }
    if (erring) {
      // One believable slip per window.
      const r = Math.random()
      if (r < 0.3) this._aimError *= 2.4                                    // sloppy aim
      else if (r < 0.5) this._leadSign = -0.8                                // wrong prediction
      else if (r < 0.7) this._hesitateUntil = now + rand(350, 900)          // misses the opening
      else if (r < 0.85) this._fireLoose = rand(0.08, 0.18)                  // fires too early
      else this._fireLoose = -0.05                                          // waits too long
    }
    // Strafers: once it has noticed, sometimes lead with their circling direction.
    if (m.style === 'strafer' && Math.random() < 0.55 * m.conf) this._leadSign = erring ? -1.2 : 1.35

    const aimed = Math.abs(wrapAngle(bearing - hdg)) < 0.35
    const weaponReady = !prim || (!prim.reloading && selfActor.heat < selfActor.heatMax * per.heat)
    const inRange = env.melee ? dist < env.ideal + 3 : dist <= Math.min(prim?.def?.range ?? 20, env.ideal + 8)
    const far = dist > env.ideal + 5
    const close = dist < Math.max(env.min + 1, env.ideal - 5)
    const threatened = m.aimingAtMe > 0.55 && now - o.lastPlayerShot < 600
    const recentRetreat = this._recentRetreatMs(now)
    const conf = m.conf
    const is = (k) => (m.style === k ? conf : 0)
    const aggr = this._aggr

    const u = {}
    u.approach = (far ? 0.55 + 0.35 * aggr : 0.04) + 0.25 * (is('ranged') + is('defensive')) +
      (this._los ? 0 : 0.35) + (env.melee && dist > env.ideal + 1 ? 0.3 : 0)
    u.attack = (inRange && !far ? 0.45 + 0.2 * (weaponReady ? 1 : 0) : 0.08) -
      (threatened ? 0.15 * (1 - aggr) : 0) + (this._los ? 0 : -0.4) - (env.melee ? 0.2 : 0)
    u.strafe = (inRange || !far ? 0.3 + per.strafe * 0.35 : 0.1) + (threatened ? 0.18 : 0) +
      0.22 * is('strafer') + 0.18 * is('aggressive') + (this._los ? 0 : 0.25)
    u.charge = (dist < 18 ? 0.15 : 0) + aggr * 0.35 + per.charge * 0.5 + (playerHp < 0.35 ? 0.28 : 0) +
      (env.melee ? 0.4 : 0) + 0.2 * is('defensive') + 0.15 * is('aggressive') * aggr -
      (selfHp < 0.3 ? 0.35 : 0) -
      (prim?.def?.splashRadius && !env.melee ? 0.35 : 0) - (dist > 24 ? 0.3 : 0)
    u.retreat = (selfHp < 0.35 ? 0.32 : 0) + (close && env.ranged ? 0.28 : 0) +
      0.45 * (is('aggressive') + is('chaser')) + (1 - aggr) * 0.15 + per.retreat +
      (selfHp < playerHp - 0.25 ? 0.12 : 0) - (this._wallBehind ? 0.5 : 0) -
      (recentRetreat > 2600 ? 0.9 : recentRetreat > 1600 ? 0.3 : 0) - (env.melee ? 0.3 : 0)
    u.evade = now >= this._evadeReadyAt && threatened
      ? 0.22 + (1 - aggr) * 0.22 + (selfHp < 0.5 ? 0.1 : 0) + (sharp ? 0.2 : 0) : null
    // Overheat / stagger force a recovery; a reload only nudges it toward
    // repositioning (forcing it would flip tactics on every magazine).
    const needRecover = selfActor.overheated || selfActor.staggered
    u.recover = needRecover ? 0.75 + (selfActor.overheated ? 0.3 : 0) : null
    if (prim?.reloading && !env.melee) {
      u.strafe += 0.2; u.retreat += 0.12; u.attack -= 0.15; u.charge -= 0.1
    }
    // Adapt to what the fight has done to both robots (weight = tier `exploit`).
    const ex = d.exploit, it = this._intel
    if (!it.playerArmed) {                 // you can't shoot back: press in and stay on you
      u.attack += 0.25 * ex; u.charge += 0.15 * ex; u.retreat -= 0.3 * ex
      if (u.evade != null) u.evade -= 0.2 * ex
    }
    if (it.playerDrive < 0.6) u.strafe += 0.22 * ex        // you turn badly: work round your flank
    if (it.selfDrive < 0.5) {             // its own drive is shot: stand and shoot, don't dance
      u.charge -= 0.4 * ex; u.strafe -= 0.25 * ex; u.approach -= 0.15 * ex; u.retreat -= 0.2 * ex; u.attack += 0.3 * ex
    }
    if (this._blockedFor > 0.6) {         // its line of fire is blocked: move to open it
      u.strafe += 0.5 * ex; u.approach += 0.25 * ex; u.attack -= 0.45 * ex
    }

    // Bounded noise so equal situations don't always play out the same way.
    const noise = d.noise * per.chaos
    for (const k in u) if (u[k] !== null) u[k] += rand(-noise, noise)

    // Rank (unavailable tactics are null); a slip sometimes takes the runner-up.
    const ranked = Object.keys(u).filter(k => u[k] !== null).sort((a, b) => u[b] - u[a])
    let pick = ranked[0]
    if (erring && ranked.length > 1 && Math.random() < 0.5) pick = ranked[1]

    // Stability: honour the minimum duration; switch only on a clear margin,
    // or when the current tactic has run its course. Recovery can always cut in.
    const cur = this._state
    const elapsed = now - this._stateSince
    const expired = elapsed >= this._stateMax
    const canLeave = elapsed >= this._stateMin
    const curScore = u[cur] ?? -Infinity
    let next = cur
    if (pick === 'recover' && cur !== 'recover') next = 'recover'                  // always allowed to cut in
    else if (cur === 'recover' && !needRecover && canLeave) next = pick
    else if (canLeave && pick !== cur && (u[pick] > curScore + SWITCH_MARGIN || expired)) next = pick
    else if (expired && pick === cur && ranked[1] && u[ranked[1]] > curScore - 0.2) next = ranked[1]   // a spent tactic yields to a close runner-up
    // Never flee forever: after enough backing off, turn and fight.
    if (cur === 'retreat' && recentRetreat > 2600) next = aggr > 0.45 || env.melee ? 'charge' : 'attack'

    if (next !== cur || expired) this._enter(next, now, bearing, P, dist, env)
  }

  _enter(state, now, bearing, P, dist, env) {
    const m = this._model
    if (this._state === 'retreat' && state !== 'retreat') this._retreatLog.push([this._retreatStart, now])
    if (state === 'retreat' && this._state !== 'retreat') this._retreatStart = now
    const [lo, hi] = STATE_TIME[state]
    this._state = state
    this._stateSince = now
    this._stateMin = lo
    this._stateMax = rand(Math.max(lo, hi * 0.6), hi)
    if (state === 'strafe') {
      // A player who circles (once noticed) gets shadowed — orbit in the same
      // rotational sense to keep the guns on them; otherwise pick a side.
      // Sometimes it guesses wrong.
      const counter = m.style === 'strafer' && Math.random() < 0.4 + 0.4 * m.conf
      this._orbitDir = counter ? (m.orbit >= 0 ? 1 : -1) : (Math.random() < 0.5 ? -1 : 1)
      if (this._wallAhead) this._orbitDir = -this._orbitDir
      this._turnInAt = now + rand(300, 900)
      this._turnInUntil = 0
    } else if (state === 'approach') {
      const erratic = this._persona.name === 'erratic' ? 0.25 : 0
      this._weaveAmp = rand(0.05, 0.3) + erratic + (m.aimingAtMe > 0.5 ? 0.12 : 0)
      this._flank = Math.random() < 0.3 ? rand(-0.45, 0.45) : 0          // occasional flanking line
    } else if (state === 'evade') {
      this._evadeDir = Math.random() < 0.5 ? -1 : 1
      if (this._wallAhead) this._evadeDir = -this._evadeDir
      this._evadeReadyAt = now + rand(1800, 3600)
    }
  }

  // The component worth shooting (visible parts of the player), or null = hull.
  _pickPart(parts) {
    let best = null, bv = 0.5
    for (const p of parts) {
      let v = 0
      if (p.role === 'weapon' && p.health > 0) v = 2 + (1 - p.health) * 2 + p.mountState * 0.6
      else if (p.role === 'drive' && p.health > 0) v = 0.9 + (1 - p.health) * 1.5 + p.mountState * 0.4
      else if (p.breakable && p.mountState >= 2) v = 0.6 + p.mountState * 0.3
      if (v > bv) { bv = v; best = p }
    }
    return best?.id ?? null
  }

  _recentRetreatMs(now) {
    const since = now - 8000
    this._retreatLog = this._retreatLog.filter(([, e]) => e > since)
    let ms = 0
    for (const [a, e] of this._retreatLog) ms += e - Math.max(a, since)
    if (this._state === 'retreat') ms += now - Math.max(this._retreatStart, since)
    return ms
  }

  _probeLOS(P, targetRobot, dist) {
    const tb = physicsManager.getBody(targetRobot.bodyId)
    if (!tb) return true
    const T = tb.translation()
    const dx = T.x - P.x, dy = T.y - P.y, dz = T.z - P.z
    const len = Math.hypot(dx, dy, dz) || 1
    const hit = physicsManager.raycast({ x: P.x, y: P.y + 0.6, z: P.z }, { x: dx / len, y: dy / len, z: dz / len }, len + 1, this._selfId)
    // Static geometry (arena walls, obstacles) has no body id → id is null: that
    // blocks just like anything else in the way.
    return !hit || hit.id === targetRobot.bodyId || hit.toi >= len - (targetRobot.radius || 1.5)
  }

  _probeWall(P, yaw, reach, targetId) {
    const hit = physicsManager.raycast({ x: P.x, y: P.y + 0.3, z: P.z }, { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, reach + 2.5, this._selfId)
    return !!hit && hit.id !== targetId && hit.toi < reach + 2
  }
}
