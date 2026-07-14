import * as THREE from 'three'
import { physicsManager } from '../physics/PhysicsManager.js'
import { wrapAngle } from './smoothing.js'

// ─────────────────────────────────────────────────────────────────────────────
// ArenaAIController — an EASY, beatable 1v1 combat AI.
//
// It produces the SAME input shape the player does — { fwd, turn, primary,
// secondary } — so it plugs straight into CombatManager._drive + WeaponManager
// with zero changes to movement or weapons. One controller instance drives one
// enemy robot toward one target (the player); the design generalises to N later.
//
// "Easy" is deliberate: decisions refresh only every 400–600 ms (reaction time),
// aim carries a persistent error (~70% effective accuracy), it pauses briefly
// after firing, strafes at random, backs off when overheating, and unsticks
// itself when it stops moving. No prediction, no cover, no flanking.
// ─────────────────────────────────────────────────────────────────────────────

const FWD = new THREE.Vector3(0, 0, 1)

export class ArenaAIController {
  constructor() {
    this._reset()
  }

  _reset() {
    this._decideAt = 0            // next decision time (ms)
    this._aimError = 0            // current persistent aim error (rad)
    this._strafeDir = 0           // -1 / 0 / +1
    this._strafeUntil = 0
    this._pauseUntil = 0          // brief stop after attacking
    this._unstickUntil = 0
    this._unstickTurn = 1
    this._wantFire = false
    this._q = new THREE.Quaternion()
    this._prevPos = new THREE.Vector3()
    this._stuckFor = 0
    this._difficulty = { reactionMin: 400, reactionMax: 600, accuracy: 0.7, aimTol: 0.22 }
  }

  configure(difficulty = {}) {
    this._reset()
    this._difficulty = { reactionMin: 400, reactionMax: 600, accuracy: 0.7, aimTol: 0.22, ...difficulty }
    return this
  }

  // Compute this frame's input for `self` chasing `target`. `selfActor` gives
  // heat/overheat/state; ranges come from the equipped weapons.
  update(dt, self, selfActor, targetRobot, now, weapons) {
    const out = { fwd: 0, turn: 0, primary: false, secondary: false }
    if (!self || !targetRobot || !selfActor || selfActor.state === 'destroyed') return out

    const body = physicsManager.getBody(self.bodyId)
    const tgtBody = physicsManager.getBody(targetRobot.bodyId)
    if (!body || !tgtBody) return out

    const P = body.translation()
    const T = tgtBody.translation()
    const rot = body.rotation()
    this._q.set(rot.x, rot.y, rot.z, rot.w)
    const heading = Math.atan2(...forwardYaw(this._q))    // robot's facing yaw

    // Vector to target on the XZ plane.
    const dx = T.x - P.x, dz = T.z - P.z
    const dist = Math.hypot(dx, dz)
    const bearing = Math.atan2(dx, dz)                     // world yaw toward target
    const aimErr = wrapAngle(bearing - heading)

    // Ranges from the equipped weapons (fall back to sane defaults).
    const primaryRange = weapons?.primary?.def?.range ?? 60
    const secondaryRange = weapons?.secondary?.def?.range ?? 16
    const preferred = Math.min(primaryRange * 0.7, 40)     // stand-off distance

    // ── Periodic decision (reaction time) ─────────────────────────────────────
    if (now >= this._decideAt) {
      const d = this._difficulty
      this._decideAt = now + d.reactionMin + Math.random() * (d.reactionMax - d.reactionMin)
      // Fresh aim error: better accuracy → smaller spread. 70% ≈ ±0.18 rad typical.
      const spread = (1 - d.accuracy) * 0.9
      this._aimError = (Math.random() - 0.5) * 2 * spread
      // Occasionally strafe.
      if (Math.random() < 0.35) { this._strafeDir = Math.random() < 0.5 ? -1 : 1; this._strafeUntil = now + 500 + Math.random() * 700 }
      else this._strafeDir = 0
      // Occasionally miss a beat entirely (do nothing this decision) — human-like.
      this._wantFire = Math.random() < d.accuracy
    }

    // ── Unstick: if we've barely moved while trying to, wiggle out ─────────────
    const moved = Math.hypot(P.x - this._prevPos.x, P.z - this._prevPos.z)
    this._prevPos.set(P.x, P.y, P.z)
    if (dist > secondaryRange && moved < 0.02 * dt * 60) this._stuckFor += dt
    else this._stuckFor = Math.max(0, this._stuckFor - dt * 2)
    if (this._stuckFor > 0.5 && now >= this._unstickUntil) { this._unstickUntil = now + 700; this._unstickTurn = Math.random() < 0.5 ? -1 : 1; this._stuckFor = 0 }
    if (now < this._unstickUntil) { out.turn = this._unstickTurn; out.fwd = -0.4; return out }

    // ── Back away while overheated ─────────────────────────────────────────────
    if (selfActor.overheated || selfActor.heat > selfActor.heatMax * 0.9) {
      out.turn = clampTurn(aimErr + this._aimError)
      out.fwd = -0.7
      return out
    }

    // ── Face the target (with persistent error) ───────────────────────────────
    const effErr = aimErr + this._aimError
    out.turn = clampTurn(effErr)

    // ── Move toward / hold at preferred range ─────────────────────────────────
    if (now < this._pauseUntil) {
      out.fwd = 0                                          // brief stop after attacking
    } else if (dist > preferred + 3) {
      out.fwd = 1
    } else if (dist < preferred - 6) {
      out.fwd = -0.5                                       // too close for primary — ease back
    } else {
      out.fwd = 0.15
    }
    // Strafe = a bit of turn bias while roughly aimed (reads as circling).
    if (this._strafeDir && now < this._strafeUntil && Math.abs(aimErr) < 0.5) {
      out.turn = clampTurn(out.turn + this._strafeDir * 0.25)
      out.fwd = Math.max(out.fwd, 0.3)
    }

    // ── Fire decisions ─────────────────────────────────────────────────────────
    const aimed = Math.abs(effErr) < this._difficulty.aimTol
    if (this._wantFire && aimed) {
      if (dist <= primaryRange) { out.primary = true; this._pauseUntil = Math.max(this._pauseUntil, now + 120) }
      if (dist <= secondaryRange * 0.9) { out.secondary = true; this._pauseUntil = Math.max(this._pauseUntil, now + 250) }
    }
    return out
  }
}

// yaw args for Math.atan2 from a quaternion's local +Z forward → [sinYaw, cosYaw].
function forwardYaw(q) {
  const f = FWD.clone().applyQuaternion(q)
  return [f.x, f.z]
}
function clampTurn(err) { return Math.max(-1, Math.min(1, err * 1.6)) }
