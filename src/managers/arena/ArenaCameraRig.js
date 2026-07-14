import * as THREE from 'three'
import { physicsManager } from '../physics/PhysicsManager.js'
import { smoothDampScalar, smoothDampVec3, smoothDampAngle, makeVec3DampState, expSmooth } from './smoothing.js'

// ─────────────────────────────────────────────────────────────────────────────
// ArenaCameraRig — the spring-arm chase camera pipeline.
//
//   Player Robot → Smoothed Follow Target → Spring Arm (mode offset, speed-scaled)
//     → Collision Check (raycast, shorten arm) → Camera Position (SmoothDamp)
//     → Smooth Look Target (robot centre + velocity look-ahead)
//
// Everything is critically damped (no overshoot) and frame-rate independent.
// Horizon is kept level (camera.up = +Y, no roll). FOV eases per mode and widens
// slightly with speed. Mode changes blend because we lerp the ACTIVE mode params
// toward the target mode's params over ~300 ms; the rig always reads the blended
// params, so there's never a hard cut.
// ─────────────────────────────────────────────────────────────────────────────

const UP = new THREE.Vector3(0, 1, 0)
const FWD = new THREE.Vector3(0, 0, 1)

export class ArenaCameraRig {
  constructor() {
    this._camera = null
    this._excludeId = null       // player body id (camera never collides with it)

    this._follow = new THREE.Vector3()      // smoothed follow target (robot centre)
    this._followState = makeVec3DampState()
    this._camPos = new THREE.Vector3()      // smoothed camera position
    this._camState = makeVec3DampState()
    this._look = new THREE.Vector3()        // smoothed look target
    this._lookState = makeVec3DampState()
    this._yaw = 0                            // smoothed rig yaw (chase heading)
    this._yawState = { v: 0 }
    this._arm = 15                           // current (collision-shortened) arm length
    this._armState = { v: 0 }
    this._fov = 70
    this._fovState = { v: 0 }

    // Blended (live) mode params — lerped toward the target mode.
    this._p = null
    this._target = null
    this._orbitYaw = 0                       // F3 free-orbit mouse yaw
    this._orbitPitch = 0.35
    this._initialized = false
  }

  configure(camera, excludeId, mode) {
    this._camera = camera
    this._excludeId = excludeId
    this._p = { ...mode }
    this._target = { ...mode }
    this._initialized = false
    this._arm = mode.distance
    this._fov = mode.fov
    return this
  }

  setModeTarget(mode) { this._target = { ...mode } }

  // Mouse deltas for F3 orbit mode.
  addOrbit(dx, dy) {
    this._orbitYaw -= dx * 0.005
    this._orbitPitch = Math.max(-0.2, Math.min(1.2, this._orbitPitch + dy * 0.004))
  }

  // Snap state to the robot on first frame so we don't fly in from the old camera.
  _seed(followTarget, yaw) {
    this._follow.copy(followTarget)
    this._yaw = yaw
    this._orbitYaw = yaw
    const desired = this._desiredCamPos(followTarget, yaw, this._p, this._arm)
    this._camPos.copy(desired)
    this._look.copy(followTarget)
    this._initialized = true
  }

  // Blend live params toward the target mode (~300 ms).
  _blend(dt) {
    const t = this._target, p = this._p
    const tau = 0.13   // ~300ms visual settle
    for (const k of ['distance', 'height', 'pitchDeg', 'fov', 'sideOffset', 'lookAhead', 'armSmooth']) {
      p[k] = expSmooth(p[k], t[k], tau, dt)
    }
    p.followYaw = t.followYaw; p.orbit = t.orbit; p.key = t.key; p.label = t.label
  }

  // Ideal camera position for a given follow point + rig yaw + arm length.
  _desiredCamPos(follow, yaw, p, arm, out = new THREE.Vector3()) {
    const pitch = THREE.MathUtils.degToRad(p.pitchDeg)
    // Direction FROM follow point back to camera, in the rig's yaw frame.
    const horiz = Math.cos(pitch)
    const back = new THREE.Vector3(Math.sin(yaw) * horiz, Math.sin(pitch), Math.cos(yaw) * horiz)
    out.copy(follow).addScaledVector(back, arm)
    out.y += p.height
    // Lateral shoulder offset (right of the view direction).
    if (p.sideOffset) {
      const right = new THREE.Vector3().crossVectors(back, UP).normalize()
      out.addScaledVector(right, p.sideOffset)
    }
    return out
  }

  // Advance one frame. `body` = player Rapier body; returns nothing (writes camera).
  update(dt, body) {
    if (!this._camera || !body) return
    this._blend(dt)
    const p = this._p

    const P = body.translation()
    const rot = body.rotation()
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
    const fwd = FWD.clone().applyQuaternion(q)
    const robotYaw = Math.atan2(fwd.x, fwd.z)
    const vel = body.linvel()
    const speed = Math.hypot(vel.x, vel.z)

    // Follow point = robot centre, raised toward chest height.
    const followTarget = new THREE.Vector3(P.x, P.y + 1.2, P.z)

    if (!this._initialized) this._seed(followTarget, p.orbit ? this._orbitYaw : robotYaw)

    // Smooth the follow target (critically damped).
    smoothDampVec3(this._follow, followTarget, this._followState, p.armSmooth, dt, this._follow)

    // Rig yaw: orbit → mouse; followYaw → robot heading (smoothed); else world-fixed.
    let targetYaw
    if (p.orbit) targetYaw = this._orbitYaw
    else if (p.followYaw) targetYaw = robotYaw
    else targetYaw = 0
    this._yaw = smoothDampAngle(this._yaw, targetYaw, this._yawState, p.orbit ? 0.05 : 0.16, dt)

    // Speed-scaled arm + FOV ("sprint" widens view, pulls back a little).
    const speedK = Math.min(1, speed / 14)
    const armWanted = p.distance + speedK * 5
    const fovWanted = p.fov + speedK * 7

    // Spring arm collision: cast from follow point toward the ideal camera pos.
    const ideal = this._desiredCamPos(this._follow, p.orbit ? this._orbitPitchYaw() : this._yaw, p, armWanted)
    let armLen = armWanted
    const origin = { x: this._follow.x, y: this._follow.y, z: this._follow.z }
    const toCam = new THREE.Vector3().subVectors(ideal, this._follow)
    const camDist = toCam.length()
    if (camDist > 0.01) {
      const dir = { x: toCam.x / camDist, y: toCam.y / camDist, z: toCam.z / camDist }
      const hit = physicsManager.raycast(origin, dir, camDist, this._excludeId)
      if (hit && hit.id !== this._excludeId && hit.toi < camDist) {
        armLen = Math.max(3.5, (hit.toi - 0.8) * (armWanted / camDist))   // pull in, keep a wall buffer
      }
    }
    // Smoothly restore/shorten the arm (never pop).
    this._arm = smoothDampScalar(this._arm, armLen, this._armState, hitShorten(this._arm, armLen), dt)

    // Final desired camera position from the collision-corrected arm.
    const desired = p.orbit
      ? this._desiredCamPosOrbit(this._follow, this._arm, p)
      : this._desiredCamPos(this._follow, this._yaw, p, this._arm)

    smoothDampVec3(this._camPos, desired, this._camState, Math.max(0.06, p.armSmooth * 0.8), dt, this._camPos)
    this._camera.position.copy(this._camPos)

    // Subtle speed-scaled engine bob so driving FEELS alive (vertical + slight sway).
    // Never in top-down/orbit (would read as jitter), only while actually moving.
    if (!p.orbit && p.key !== 'topdown' && speedK > 0.02) {
      this._bobT = (this._bobT || 0) + dt * (8 + speed * 0.6)
      const vBob = Math.sin(this._bobT) * 0.06 * speedK
      const hBob = Math.cos(this._bobT * 0.7) * 0.045 * speedK
      const rx = Math.cos(this._yaw), rz = -Math.sin(this._yaw)   // screen-right on XZ
      this._camera.position.y += vBob
      this._camera.position.x += rx * hBob
      this._camera.position.z += rz * hBob
    }

    // Look target = robot centre, raised so the robot sits in the LOWER-MIDDLE of
    // frame, plus a velocity look-ahead so the camera anticipates movement.
    const lookAt = new THREE.Vector3(P.x, P.y + 2.0, P.z)
    if (p.lookAhead > 0 && speed > 0.5) lookAt.addScaledVector(new THREE.Vector3(vel.x, 0, vel.z).normalize(), Math.min(speed, 14) * p.lookAhead)
    smoothDampVec3(this._look, lookAt, this._lookState, 0.14, dt, this._look)

    // FOV ease.
    this._fov = smoothDampScalar(this._fov, fovWanted, this._fovState, 0.2, dt)
    if (Math.abs(this._camera.fov - this._fov) > 0.01) { this._camera.fov = this._fov; this._camera.updateProjectionMatrix() }

    // Level horizon, look at the smoothed target (roll is never introduced).
    this._camera.up.set(0, 1, 0)
    this._camera.lookAt(this._look)
  }

  _orbitPitchYaw() { return this._orbitYaw }

  _desiredCamPosOrbit(follow, arm, p, out = new THREE.Vector3()) {
    const pitch = this._orbitPitch
    const horiz = Math.cos(pitch)
    const back = new THREE.Vector3(Math.sin(this._orbitYaw) * horiz, Math.sin(pitch), Math.cos(this._orbitYaw) * horiz)
    out.copy(follow).addScaledVector(back, arm)
    out.y += p.height * 0.4
    return out
  }

  // Where the camera ended up (for shake to add its offset on top).
  get position() { return this._camera?.position }
  get lookTarget() { return this._look }
}

// Collision arm should snap IN fast (avoid clipping) but restore OUT slowly.
function hitShorten(current, target) { return target < current ? 0.05 : 0.35 }
