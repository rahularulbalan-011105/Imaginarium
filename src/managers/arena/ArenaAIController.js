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
// ─────────────────────────────────────────────────────────────────────────────

// Difficulty tiers. configure() accepts { level, ...overrides }; the legacy keys
// (reactionMin/Max, accuracy, aimTol) are still honoured.
const TIERS = {
  easy: {
    reactionMin: 420, reactionMax: 650, accuracy: 0.62, aimTol: 0.2, turnGain: 1.5,
    perceptionLag: 0.34, predict: 0.25, learnTime: 22, obsTau: 9, wobble: 0.09,
    mistakes: 0.2, brilliance: 0.03, noise: 0.2, openMin: 1800, openMax: 3200,
  },
  normal: {
    reactionMin: 280, reactionMax: 480, accuracy: 0.72, aimTol: 0.16, turnGain: 1.8,
    perceptionLag: 0.22, predict: 0.55, learnTime: 13, obsTau: 6, wobble: 0.06,
    mistakes: 0.12, brilliance: 0.07, noise: 0.14, openMin: 1100, openMax: 2300,
  },
  hard: {
    reactionMin: 190, reactionMax: 330, accuracy: 0.85, aimTol: 0.13, turnGain: 2.1,
    perceptionLag: 0.13, predict: 0.8, learnTime: 8, obsTau: 4.5, wobble: 0.035,
    mistakes: 0.05, brilliance: 0.12, noise: 0.1, openMin: 600, openMax: 1400,
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
  }

  // Compute this frame's input for `self` fighting `targetRobot`.
  update(dt, self, selfActor, targetRobot, now, weapons) {
    const out = { fwd: 0, turn: 0, primary: false, secondary: false }
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

    // Weapon envelope from the equipped weapons.
    const prim = weapons?.primary ?? null
    const sec = weapons?.secondary ?? null
    const pDef = prim?.def ?? null
    const sDef = sec?.def ?? null
    const env = this._envelope(pDef, sDef, self, targetRobot)

    const selfHp = hpFrac(selfActor)
    const playerActor = useCombatStore.getState().actors?.[targetRobot.id]
    const playerHp = hpFrac(playerActor)

    this._observe(dt, now, P, T, TV, SV, dist, targetHeading, selfActor, playerActor, targetRobot, prim, sec)

    // ── Strategic decision (reaction-time ticks only) ────────────────────────
    if (now >= this._decideAt) {
      this._decideAt = now + rand(d.reactionMin, d.reactionMax)
      this._decide(now, P, body, targetRobot, dist, bearing, env, selfActor, selfHp, playerHp, prim)
    }

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
    const flight = pDef?.projectileSpeed ? dist / pDef.projectileSpeed : 0.12   // rockets + shells travel
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
        this._turnInUntil = now + rand(450, 900)
        this._turnInAt = this._turnInUntil + rand(800, 1900) * (1.2 - this._aggr * 0.5)
      }
      if (now < this._turnInUntil) {
        desiredYaw = aimYaw
        fwd = dist > env.ideal + 3 ? 0.4 : dist < env.min ? -0.5 : 0.1
      } else {
        const around = Math.atan2(P.x - s.x, P.z - s.z) + this._orbitDir * 0.75
        const ox = s.x + Math.sin(around) * env.ideal, oz = s.z + Math.cos(around) * env.ideal
        desiredYaw = Math.atan2(ox - P.x, oz - P.z)
        fwd = 0.9
        mayFire = false
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
      mayFire = false
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

    // ── Fire discipline ───────────────────────────────────────────────────────
    // "Aimed" is judged against where the AI BELIEVES the target is (aim error
    // and a small hand wobble included), so a bad read produces real misses.
    const aimErrNow = Math.abs(wrapAngle(aimYaw + Math.sin(t * 3.1 + this._weavePhase) * d.wobble - heading - gunOff))
    const angularSize = Math.atan2((targetRobot.radius || 1.5) * 0.9, dist)
    const spread = ((pDef?.spreadDeg ?? 2) * Math.PI) / 180
    const tol = Math.max(0.03, d.aimTol * 0.5 + angularSize + spread * 0.4 + this._fireLoose)
    const aimed = aimErrNow < tol
    const hot = selfActor.overheated || selfActor.heat > selfActor.heatMax * this._persona.heat
    const pressing = playerHp < 0.25 && selfActor.heat < selfActor.heatMax * 0.95   // finish-off exception
    // Opening: size the opponent up before the first shot (unless shot first).
    const opening = now < this._openUntil && now - this._obs.lastPlayerShot > 1500
    const canShoot = mayFire && !opening && this._los && now >= this._hesitateUntil && (!hot || pressing) &&
      now < this._burstUntil && st !== 'recover'
    // Self-safety for splash weapons uses the nearer of perceived/actual distance
    // (it only prevents blowing itself up; it never helps it hit).
    const safeDist = Math.min(dist, Math.hypot(T.x - P.x, T.z - P.z))
    if (canShoot && aimed) {
      if (prim && pDef && !prim.reloading && dist <= pDef.range * 0.98 &&
          !(pDef.splashRadius && safeDist < pDef.splashRadius + 2)) out.primary = true
      if (sec && sDef && !sec.reloading && dist <= sDef.range * 0.92 &&
          !(sDef.splashRadius && safeDist < sDef.splashRadius + 2)) out.secondary = true
    }
    // Bursts: hold the trigger in human-length bursts with short rests.
    if (now >= this._burstUntil && now >= this._burstRestUntil) {
      this._burstUntil = now + rand(500, 1400) * (0.7 + this._aggr * 0.6)
      this._burstRestUntil = this._burstUntil + rand(120, 520) * (1.3 - this._aggr * 0.6)
    }
    return out
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
  _decide(now, P, body, targetRobot, dist, bearing, env, selfActor, selfHp, playerHp, prim) {
    const d = this._difficulty, m = this._model, per = this._persona
    this._classify()

    // Momentum: who is winning lately (damage dealt vs taken + health lead).
    const o = this._obs
    const flow = (o.dealt - o.taken) / Math.max(20, o.dealt + o.taken)
    this._dominance = clamp(0.6 * flow + 0.6 * (selfHp - playerHp), -1, 1)
    const dom = this._dominance
    // Winning → sloppier and calmer; losing → sharper and more decisive.
    this._mistakeRate = clamp(d.mistakes * (1 + 1.6 * Math.max(0, dom)) * (1 - 0.6 * Math.max(0, -dom)), 0.01, 0.45)

    this._aggrWalk = clamp(this._aggrWalk + rand(-0.08, 0.08) * per.chaos, -0.2, 0.2)
    const aggrTarget = clamp01(per.aggr + 0.3 * (selfHp - playerHp) + this._aggrWalk
      - 0.18 * Math.max(0, dom - 0.2) + 0.12 * Math.max(0, -dom - 0.2)
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
    const spreadAim = (1 - d.accuracy) * 0.55 * (1 + 0.9 * Math.max(0, dom - 0.15))
    this._aimError = rand(-spreadAim, spreadAim)
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
