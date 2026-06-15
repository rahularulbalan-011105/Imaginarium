import * as THREE from 'three'
import { simulationManager } from './SimulationManager.js'
import { physicsManager } from './physics/PhysicsManager.js'
import { DifferentialDrive } from './robot/DifferentialDrive.js'
import { LeggedSystem } from './robot/LeggedSystem.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { usePhysicsStore } from '../stores/physicsStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { totalMass, totalMomentOfInertia, maxFrontalArea } from './physics/MassCalculator.js'
import { PhysicsIntegrator } from './physics/PhysicsIntegrator.js'
import { SCENE_TO_M } from './physics/EnvironmentConfig.js'

const MOTOR_TYPES    = new Set(['motor', 'motor_bo', 'motor_dc'])
const DRIVE_BODY_ID  = 'robot_drive'
const MAX_V          = 200  // max vertical fall speed (scene units/s) — clamps gravity accumulation

class DriveManager {
  constructor() {
    this.scene       = null
    this.objectMgr   = null
    this.rootGroup   = null
    this._leftIds    = []
    this._rightIds   = []
    this._lastTime   = null
    this.wheelbase   = 3.0
    this._yawOffset  = 0

    // Motor model — wheelbase is updated in enter() once motor positions are known
    this._drive       = new DifferentialDrive()
    // Physics state
    this._integrator  = null
    this._totalMass   = 1.0
    this._momentOfI   = 0.1
    this._frontalArea = 0.01

    // Legged robot state
    this._isLegged     = false
    this._leggedSystem = null

    // Vertical / gravity state
    this._vy          = 0   // vertical velocity (scene units/s), gravity-driven
    this._robotMinY   = 0   // lowest world-Y of any robot mesh when rootGroup.y = 0
    this._obstacleIds = []  // Rapier body IDs for static obstacle colliders

    // Pitch / tipping state — robot tips over wheel axle when COM is offset in Z
    this._pitch          = 0          // current pitch angle (rotation.x, radians)
    this._pitchVel       = 0          // pitch angular velocity (rad/s)
    this._roll           = 0          // current roll angle (rotation.z, radians)
    this._rollVel        = 0          // roll angular velocity (rad/s)
    this._comLocalZ      = 0          // local-Z of COM from axle (neg=forward, pos=backward)
    this._comLocalX      = 0          // local-X of COM from pivot (drives roll tipping)
    this._comLocalY      = 1.0        // local-Y of COM above axle (height)
    this._pitchExtent    = 0          // max |Z| extent of robot body from axle (scene units)
    this._maxPitch       = Math.PI * 0.4  // recomputed in enter() from geometry
    this._maxRoll        = Math.PI * 0.4  // recomputed in enter() from geometry
    this._robotMinLocalZ = -3         // min local-Z of robot bounding box (set in enter)
    this._robotMaxLocalZ =  3         // max local-Z of robot bounding box (set in enter)
    this._robotMinLocalX = -3         // min local-X of robot bounding box (set in enter)
    this._robotMaxLocalX =  3         // max local-X of robot bounding box (set in enter)

    // Quaternion reuse objects (avoid allocation every frame)
    this._q     = new THREE.Quaternion()
    this._euler = new THREE.Euler()
  }

  init(scene, objectMgr) {
    this.scene     = scene
    this.objectMgr = objectMgr
    // Start loading the Rapier WASM immediately so it's ready by simulation time
    physicsManager.init()
  }

  get isActive() { return !!this.rootGroup }

  enter(objects) {
    if (!this.scene || this.rootGroup) return

    // Split scene objects into robot parts (go into rootGroup) and standalone
    // obstacles (stay fixed; get static Rapier colliders so the robot stops on contact).
    // Only objects the user explicitly detached (standaloneIds) are treated as obstacles.
    // Everything else — including geometric bodies like wheels that may not have direct
    // electronic connections — moves with the robot.
    const standaloneSet = new Set(useSceneStore.getState().standaloneIds)
    const topLevel = []
    const standaloneObjects = []
    for (const obj of objects) {
      if (obj.type === 'plane') continue
      const mesh = this.objectMgr.getMesh(obj.id)
      if (!mesh || mesh.parent !== this.scene) continue
      if (standaloneSet.has(obj.id)) standaloneObjects.push(obj)
      else                            topLevel.push(obj)
    }
    if (topLevel.length === 0) return

    // ── Step 1: identify motors in world space and compute axle midpoint ──────
    //
    // The rootGroup pivot MUST be the midpoint of the wheel axle, not the
    // centroid of all objects.  Using the centroid shifts the rotation axis
    // away from the axle and makes spin-in-place look like a planetary orbit.
    const motors = topLevel.filter(o => MOTOR_TYPES.has(o.type))
    let pivotX = 0, pivotZ = 0

    if (motors.length >= 2) {
      const motorWorldPos = motors.map(o => {
        const mesh = this.objectMgr.getMesh(o.id)
        mesh?.updateMatrixWorld(true)
        const p = new THREE.Vector3()
        mesh?.getWorldPosition(p)
        return { id: o.id, x: p.x, z: p.z }
      })

      const xs = motorWorldPos.map(m => m.x)
      const zs = motorWorldPos.map(m => m.z)
      const xSpread = Math.max(...xs) - Math.min(...xs)
      const zSpread = Math.max(...zs) - Math.min(...zs)

      const sorted = [...motorWorldPos].sort(
        xSpread >= zSpread ? (a, b) => a.x - b.x : (a, b) => a.z - b.z
      )
      const half = Math.max(1, Math.floor(sorted.length / 2))
      this._leftIds  = sorted.slice(0, half).map(m => m.id)
      this._rightIds = sorted.slice(-half).map(m => m.id)

      const lPos = motorWorldPos.find(m => m.id === this._leftIds[0])
      const rPos = motorWorldPos.find(m => m.id === this._rightIds[0])

      if (lPos && rPos) {
        pivotX = (lPos.x + rPos.x) / 2
        pivotZ = (lPos.z + rPos.z) / 2

        const dx = rPos.x - lPos.x
        const dz = rPos.z - lPos.z
        this.wheelbase  = Math.max(0.5, Math.sqrt(dx * dx + dz * dz))
        this._yawOffset = Math.atan2(-dz, dx)

        // Tell the motor model the real axle width
        this._drive.wheelbase = this.wheelbase
      }
    } else {
      this._leftIds   = []
      this._rightIds  = []
      this.wheelbase  = 3.0
      this._yawOffset = 0
      this._drive.wheelbase = 3.0

      let n = 0
      for (const obj of topLevel) {
        const mesh = this.objectMgr.getMesh(obj.id)
        if (!mesh) continue
        mesh.updateMatrixWorld(true)
        const p = new THREE.Vector3()
        mesh.getWorldPosition(p)
        pivotX += p.x; pivotZ += p.z; n++
      }
      if (n > 0) { pivotX /= n; pivotZ /= n }
    }

    // ── Step 1b: detect legged robot ─────────────────────────────────────────
    // If there are no drive motors but servos have attached arm objects → legged robot
    const { attachments } = useElectronicsStore.getState()
    if (motors.length < 2) {
      const legSys = new LeggedSystem()
      if (legSys.build(topLevel, this.objectMgr, attachments)) {
        this._leggedSystem = legSys
        this._isLegged     = true
        usePhysicsStore.getState().setIsLeggedRobot(true)
      }
    }

    // ── Step 1c: compute robot physics properties ────────────────────────────
    const robotMass = Math.max(0.1, totalMass(topLevel))
    const robotI    = Math.max(0.001, totalMomentOfInertia(topLevel, pivotX, pivotZ))
    const robotA    = maxFrontalArea(topLevel)
    this._totalMass   = robotMass
    this._momentOfI   = robotI
    this._frontalArea = robotA
    this._integrator  = new PhysicsIntegrator({
      mass:            robotMass,
      momentOfInertia: robotI,
      frontalArea:     robotA,
    })
    console.log(
      `[Physics] mass=${robotMass.toFixed(3)} kg  I=${robotI.toFixed(4)} kg·m²  A=${robotA.toFixed(4)} m²`
    )
    // Apply environment gravity to Rapier world
    const { gravity, groundFriction: gf } = usePhysicsStore.getState()
    physicsManager.init().then(() => physicsManager.setGravity(gravity))

    // ── Step 2: create rootGroup at the axle midpoint and re-parent meshes ───
    this.rootGroup = new THREE.Group()
    this.rootGroup.userData.isDriveRoot = true
    this.rootGroup.position.set(pivotX, 0, pivotZ)
    this.scene.add(this.rootGroup)
    // Force matrixWorld update immediately — Three.js only refreshes it during
    // the render cycle, so the re-parenting math would use a stale identity
    // matrix and displace every mesh by (pivotX, 0, pivotZ).
    this.rootGroup.updateMatrixWorld(true)

    for (const obj of topLevel) {
      const mesh = this.objectMgr.getMesh(obj.id)
      if (!mesh || mesh.parent !== this.scene) continue
      mesh.updateMatrixWorld(true)
      const wm = mesh.matrixWorld.clone()
      mesh.removeFromParent()
      this.rootGroup.add(mesh)
      const localMat = new THREE.Matrix4()
        .copy(this.rootGroup.matrixWorld)
        .invert()
        .multiply(wm)
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      localMat.decompose(p, q, s)
      mesh.position.copy(p)
      mesh.quaternion.copy(q)
      mesh.scale.copy(s)
    }

    // ── Step 3: create Rapier kinematic body at the pivot ────────────────────
    // Compute actual bounding box of the robot so the collider matches visuals.
    const robotBox = new THREE.Box3()
    for (const obj of topLevel) {
      const mesh = this.objectMgr.getMesh(obj.id)
      if (mesh) { mesh.updateMatrixWorld(true); robotBox.expandByObject(mesh) }
    }
    // Store lowest world-Y (with rootGroup at 0) so gravity lands the mesh at y=0
    this._robotMinY = robotBox.isEmpty() ? 0 : robotBox.min.y

    // ── Pitch / tipping setup ────────────────────────────────────────────────
    // Use VOLUME-WEIGHTED COM so the simulation automatically determines which
    // side is heavier — no manual configuration needed.  A large wheel counts
    // more than a thin platform; a heavy motor body more than a light board.
    // Without weighting, equal-sized mesh pivots cancel out even when one side
    // visually/physically dominates.
    {
      let wSumZ = 0, wSumY = 0, totalVol = 0
      let minLZ = Infinity, maxLZ = -Infinity
      let wSumX = 0

      for (const obj of topLevel) {
        const mesh = this.objectMgr.getMesh(obj.id)
        if (!mesh || mesh.parent !== this.rootGroup) continue
        mesh.updateMatrixWorld(true)

        // Bounding box in world space (rootGroup has no rotation yet, so
        // world Z − pivotZ = local Z relative to the axle pivot)
        const bb   = new THREE.Box3().setFromObject(mesh)
        if (bb.isEmpty()) continue
        const sz   = bb.getSize(new THREE.Vector3())
        const vol  = Math.max(0.001, sz.x * sz.y * sz.z)   // volume proxy for mass
        const ctr  = bb.getCenter(new THREE.Vector3())

        const ctrZ = ctr.z - pivotZ   // local Z
        const ctrY = ctr.y            // local Y
        const ctrX = ctr.x - pivotX   // local X

        wSumZ += ctrZ * vol
        wSumY += ctrY * vol
        wSumX += ctrX * vol
        totalVol += vol

        minLZ = Math.min(minLZ, bb.min.z - pivotZ)
        maxLZ = Math.max(maxLZ, bb.max.z - pivotZ)
      }

      this._comLocalZ   = totalVol > 0 ? wSumZ / totalVol : 0
      this._comLocalX   = totalVol > 0 ? wSumX / totalVol : 0
      this._comLocalY   = totalVol > 0 ? Math.max(0.1, wSumY / totalVol) : 1.0
      this._pitchExtent = Math.max(0.5,
        Math.abs(minLZ === Infinity ? 0 : minLZ),
        Math.abs(maxLZ === -Infinity ? 0 : maxLZ)
      )
      const bodyH = Math.max(0.1, this._comLocalY - this._robotMinY)
      this._maxPitch = Math.min(
        Math.PI * 0.47,
        Math.atan2(bodyH, Math.max(0.1, this._pitchExtent * 0.5))
      )
      // Roll: allow up to ~85° — ground clamp handles the actual floor contact,
      // this cap just prevents rotating past vertical into an upside-down state.
      this._maxRoll  = Math.PI * 0.47
      this._pitch    = 0
      this._pitchVel = 0

      // XZ extent of bounding box in rootGroup local space.
      // Used by the pitch+roll-aware ground clamp.
      this._robotMinLocalZ = robotBox.isEmpty() ? -3 : robotBox.min.z - pivotZ
      this._robotMaxLocalZ = robotBox.isEmpty() ?  3 : robotBox.max.z - pivotZ
      this._robotMinLocalX = robotBox.isEmpty() ? -3 : robotBox.min.x - pivotX
      this._robotMaxLocalX = robotBox.isEmpty() ?  3 : robotBox.max.x - pivotX
    }

    // ── Non-wheeled: extract design-time tilt into rootGroup rotation ─────────
    // When a standalone object is placed at an angle, one corner touches the
    // floor while the rest floats.  Lifting the tilt into rootGroup.rotation
    // lets the settling physics in step() pivot the object flat under gravity,
    // exactly as a real dropped rigid body would.
    if (motors.length < 2 && !this._isLegged) {
      let dominantMesh = null, maxVol = 0
      for (const obj of topLevel) {
        const mesh = this.objectMgr.getMesh(obj.id)
        if (!mesh || mesh.parent !== this.rootGroup) continue
        const bb = new THREE.Box3().setFromObject(mesh)
        if (bb.isEmpty()) continue
        const sz = bb.getSize(new THREE.Vector3())
        if (sz.x * sz.y * sz.z > maxVol) { maxVol = sz.x * sz.y * sz.z; dominantMesh = mesh }
      }
      if (dominantMesh) {
        // XYZ Euler is consistent with how Three.js applies rootGroup.rotation
        const e = new THREE.Euler().setFromQuaternion(dominantMesh.quaternion, 'XYZ')
        const tiltX = e.x, tiltZ = e.z
        if (Math.abs(tiltX) > 0.01 || Math.abs(tiltZ) > 0.01) {
          this.rootGroup.rotation.x = tiltX
          this.rootGroup.rotation.z = tiltZ
          this.rootGroup.updateMatrixWorld(true)

          // Re-express every mesh's local position and quaternion in the now-tilted
          // rootGroup frame so the world transforms remain EXACTLY the same.
          const rqInv = this.rootGroup.quaternion.clone().invert()
          for (const obj of topLevel) {
            const mesh = this.objectMgr.getMesh(obj.id)
            if (!mesh || mesh.parent !== this.rootGroup) continue
            const pL = mesh.position.clone()
            const qL = mesh.quaternion.clone()
            mesh.position.copy(pL.applyQuaternion(rqInv))
            mesh.quaternion.copy(rqInv.clone().multiply(qL))
          }

          this._pitch    = tiltX
          this._roll     = tiltZ
          this._pitchVel = 0
          this._rollVel  = 0
        }
      }
    }

    const robotSize = new THREE.Vector3()
    robotBox.getSize(robotSize)
    const robotHalf = {
      x: Math.max(0.3, robotSize.x * 0.5),
      y: Math.max(0.2, robotSize.y * 0.5),
      z: Math.max(0.3, robotSize.z * 0.5),
    }

    if (physicsManager.ready) {
      physicsManager.createRobotBody(DRIVE_BODY_ID, { x: pivotX, y: 0, z: pivotZ }, robotHalf)
    }
    // If Rapier isn't ready yet, the first few step() calls fall back to
    // direct kinematic integration — the body is created lazily in step().

    // Create static Rapier colliders for standalone obstacles (deferred so Rapier is ready)
    physicsManager.init().then(() => {
      for (const obj of standaloneObjects) {
        const mesh = this.objectMgr.getMesh(obj.id)
        if (!mesh) continue
        mesh.updateMatrixWorld(true)
        const box    = new THREE.Box3().setFromObject(mesh)
        const center = new THREE.Vector3(); box.getCenter(center)
        const half   = new THREE.Vector3(); box.getSize(half).multiplyScalar(0.5)
        physicsManager.createStaticObstacle(
          'obs_' + obj.id, center,
          { x: Math.max(0.1, half.x), y: Math.max(0.1, half.y), z: Math.max(0.1, half.z) },
        )
        this._obstacleIds.push('obs_' + obj.id)
      }
    })

    this._lastTime = null
  }

  exit(updateObject) {
    if (!this.rootGroup) return

    // Reset pitch rotation and gravity Y-offset before extracting child world
    // transforms.  Without this, each mesh gets its tilted/lowered simulation
    // end-state baked into its world position, causing wrong COM and motor
    // detection on the next simulation run.
    this.rootGroup.rotation.x = 0
    this.rootGroup.rotation.z = 0
    this.rootGroup.position.y = 0
    this.rootGroup.updateMatrixWorld(true)

    const children = [...this.rootGroup.children]
    for (const mesh of children) {
      const id = mesh.userData.id
      mesh.updateMatrixWorld(true)
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      mesh.matrixWorld.decompose(p, q, s)
      this.rootGroup.remove(mesh)
      this.scene.add(mesh)
      mesh.position.copy(p); mesh.quaternion.copy(q); mesh.scale.copy(s)
      if (id && updateObject) {
        const e = new THREE.Euler().setFromQuaternion(q)
        updateObject(id, {
          position: { x: p.x, y: p.y, z: p.z },
          rotation: { x: e.x, y: e.y, z: e.z },
        })
      }
    }
    this.scene.remove(this.rootGroup)
    this.rootGroup  = null
    this._leftIds   = []
    this._rightIds  = []
    this._lastTime  = null
    this._yawOffset = 0

    physicsManager.removeBody(DRIVE_BODY_ID)
    for (const id of this._obstacleIds) physicsManager.removeBody(id)
    this._obstacleIds = []
    this._vy = 0
    this._robotMinY = 0
    this._pitch     = 0
    this._pitchVel  = 0
    this._roll      = 0
    this._rollVel   = 0
    if (this._integrator) { this._integrator.reset(); this._integrator = null }
    if (this._leggedSystem) { this._leggedSystem.reset(); this._leggedSystem = null }
    this._isLegged = false
    usePhysicsStore.getState().setIsLeggedRobot(false)
    usePhysicsStore.getState().setLeggedControl(0, 0)
  }

  // Called every animation frame.
  step() {
    if (!this.rootGroup) return

    const now = performance.now() / 1000
    const dt  = this._lastTime !== null ? Math.min(now - this._lastTime, 0.05) : 0
    this._lastTime = now
    if (dt === 0) return

    // ── Legged robot path (always active in sim mode) ────────────────────────
    if (this._isLegged && this._leggedSystem) {
      this._stepLegged(dt)
      return
    }

    // ── Read environment once per frame ──────────────────────────────────────
    const physState  = usePhysicsStore.getState()
    const physEnv = {
      gravity:         physState.gravity,
      airDensity:      physState.airDensity,
      rollingFriction: physState.rollingFriction,
      wind:            physState.wind,
    }

    // ── Gravity always active — robot falls as soon as sim mode is entered ───
    const gravAccel = physEnv.gravity / SCENE_TO_M  // m/s² → scene_u/s²
    this._vy = Math.max(this._vy + gravAccel * dt, -MAX_V)
    this.rootGroup.position.y += this._vy * dt

    // ── Pitch / tipping physics ───────────────────────────────────────────────
    // Only applies when the COM is meaningfully offset from the axle in Z
    // (asymmetric robot — one end unsupported).  Symmetric differential-drive
    // robots have |_comLocalZ| ≈ 0 and skip this block entirely.
    //
    // NOTE: we intentionally use ONLY the _comLocalZ·cos(θ) term.  Adding a
    // _comLocalY·sin(θ) term would model an inverted pendulum and cause
    // runaway tipping for every robot regardless of balance.
    if (this._leftIds.length === 0) {
      // Non-wheeled physics: two independent torque sources are combined.
      //
      // 1. COM-tipping: if the volume-weighted COM is offset from the pivot in X
      //    or Z, gravity tips the object toward the heavy side — exactly like the
      //    wheeled-robot pitch, but now for both axes.  This drives a seesaw or
      //    any lopsided assembly to tip onto its heavy end.
      //
      // 2. Settling: a restoring spring torque (−g·arm·sin θ) brings a design-time
      //    tilt back to horizontal for symmetric objects.  The spring is blended
      //    away when the COM is strongly offset, so it does not fight the seesaw.
      //
      // Which dominates is decided by the "tip ratio" (normalised COM offset):
      //   tipRatio ≈ 0  → symmetric object → settling wins → lands flat
      //   tipRatio ≈ 1  → lopsided seesaw  → tipping wins  → heavy side falls
      const gScene = Math.abs(physEnv.gravity) / SCENE_TO_M
      const armP   = Math.max(0.5, this._pitchExtent)
      const armR   = Math.max(0.5,
        Math.max(Math.abs(this._robotMinLocalX), Math.abs(this._robotMaxLocalX)))
      const pitchI = Math.max(1.0, armP * armP * 0.3)
      const rollI  = Math.max(1.0, armR * armR * 0.3)

      // Blend: 0 = pure settling, 1 = pure COM tipping
      const tipP = Math.min(1, Math.abs(this._comLocalZ) / Math.max(0.1, armP * 0.15))
      const tipR = Math.min(1, Math.abs(this._comLocalX) / Math.max(0.1, armR * 0.15))

      // COM tipping torques (same formula as wheeled-robot pitch, applied here)
      const pitchTorque_tip =  gScene * this._comLocalZ * Math.cos(this._pitch) * tipP
      const rollTorque_tip  = -gScene * this._comLocalX * Math.cos(this._roll)  * tipR

      // Settling torques (restoring spring toward θ = 0), suppressed in tipping mode
      const pitchTorque_settle = -gScene * armP * Math.sin(this._pitch) * (1 - tipP)
      const rollTorque_settle  = -gScene * armR * Math.sin(this._roll)  * (1 - tipR)

      const sinP = Math.sin(this._pitch)
      const cosP = Math.cos(this._pitch)
      const sinR = Math.sin(this._roll)
      const cosR = Math.cos(this._roll)
      const lxC  = sinR >= 0 ? this._robotMinLocalX : this._robotMaxLocalX
      const lzC  = sinP * cosR >= 0 ? this._robotMaxLocalZ : this._robotMinLocalZ
      const lowestY = this.rootGroup.position.y
        + lxC * sinR
        + (this._robotMinY * cosP - lzC * sinP) * cosR
      const isGrounded = lowestY < 0.5

      // Physics only activates when grounded, or when COM-tipping is in play
      const active = isGrounded && (
        Math.abs(this._pitch) > 0.003 || Math.abs(this._roll) > 0.003 ||
        tipP > 0.01 || tipR > 0.01
      )

      if (active) {
        this._pitchVel += ((pitchTorque_tip + pitchTorque_settle) / pitchI) * dt
        this._rollVel  += ((rollTorque_tip  + rollTorque_settle)  / rollI)  * dt
        this._pitchVel *= Math.exp(-4.0 * dt)
        this._rollVel  *= Math.exp(-4.0 * dt)

        // Cap tipping mode at ~85° (prevents upside-down state)
        if (tipP > 0.5 && Math.abs(this._pitch) >= this._maxPitch) {
          this._pitch = Math.sign(this._pitch || this._pitchVel) * this._maxPitch
          if (Math.sign(this._pitchVel) === Math.sign(this._pitch)) this._pitchVel = 0
        }
        if (tipR > 0.5 && Math.abs(this._roll) >= this._maxRoll) {
          this._roll = Math.sign(this._roll || this._rollVel) * this._maxRoll
          if (Math.sign(this._rollVel) === Math.sign(this._roll)) this._rollVel = 0
        }

        this._pitch += this._pitchVel * dt
        this._roll  += this._rollVel  * dt

        // Snap to flat only in settling mode (symmetric, no COM offset)
        if (tipP < 0.1 && Math.abs(this._pitch) < 0.003 && Math.abs(this._pitchVel) < 0.01) { this._pitch = 0; this._pitchVel = 0 }
        if (tipR < 0.1 && Math.abs(this._roll)  < 0.003 && Math.abs(this._rollVel)  < 0.01) { this._roll  = 0; this._rollVel  = 0 }
      }

      this.rootGroup.rotation.x = this._pitch
      this.rootGroup.rotation.z = this._roll
    }
    if (this._leftIds.length > 0 && this._pitchExtent > 0.5 && Math.abs(this._comLocalZ) > 0.05) {
      const gScene      = Math.abs(physEnv.gravity) / SCENE_TO_M
      const pitchTorque = gScene * this._comLocalZ * Math.cos(this._pitch)
      // Effective moment of inertia (distributed body, simplified)
      const pitchI      = Math.max(1.0, this._pitchExtent * this._pitchExtent * 0.25)
      this._pitchVel   += (pitchTorque / pitchI) * dt
      this._pitchVel   *= Math.exp(-5.0 * dt)   // structural + air damping

      // Ground contact: far end of robot body hits floor at _maxPitch
      if (Math.abs(this._pitch) >= this._maxPitch) {
        this._pitch = Math.sign(this._pitch || this._pitchVel) * this._maxPitch
        if (Math.sign(this._pitchVel) === Math.sign(this._pitch)) this._pitchVel = 0
      }
      this._pitch              += this._pitchVel * dt
      this.rootGroup.rotation.x = this._pitch
    }

    // ── Pitch+roll-aware ground clamp ────────────────────────────────────────
    // rootGroup can have both X-rotation (pitch) and Z-rotation (roll).
    // World Y of a local point (lx, ly, lz) with XYZ Euler (Rx then Rz):
    //   worldY = rootGroup.y + lx·sinR + (ly·cosP − lz·sinP)·cosR
    // Minimise over the bounding box by choosing the worst-case lx and lz corner.
    {
      const sinP = Math.sin(this._pitch)
      const cosP = Math.cos(this._pitch)
      const sinR = Math.sin(this._roll)
      const cosR = Math.cos(this._roll)
      const lxC  = sinR >= 0 ? this._robotMinLocalX : this._robotMaxLocalX
      const lzC  = sinP * cosR >= 0 ? this._robotMaxLocalZ : this._robotMinLocalZ
      const lowestWorldY = this.rootGroup.position.y
        + lxC * sinR
        + (this._robotMinY * cosP - lzC * sinP) * cosR
      if (lowestWorldY < 0) {
        this.rootGroup.position.y -= lowestWorldY
        if (this._vy < 0) this._vy = 0
      }
    }

    // ── Wheeled path (requires Arduino code to be running) ───────────────────
    if (!simulationManager.isRunning()) return
    if (!this._leftIds.length || !this._rightIds.length) return

    // ── Compute velocities from motor PWM via the differential-drive model ───
    const mSpeeds = simulationManager.motorSpeeds
    const avg = (ids) =>
      ids.reduce((s, id) => s + (mSpeeds[id] ?? 0), 0) / ids.length

    const leftPWM  = avg(this._leftIds)
    const rightPWM = avg(this._rightIds)
    // (Do NOT early-return on zero PWM — PhysicsIntegrator needs to apply rolling friction)

    const { v, omega } = this._drive.compute(leftPWM, rightPWM)

    // ── Physics path — Rapier kinematic body ─────────────────────────────────
    let body = physicsManager.getBody(DRIVE_BODY_ID)

    // Lazy body creation if Rapier became ready after enter()
    if (!body && physicsManager.ready) {
      body = physicsManager.createRobotBody(DRIVE_BODY_ID, {
        x: this.rootGroup.position.x,
        y: 0,
        z: this.rootGroup.position.z,
      })
      // Sync body rotation to current rootGroup yaw
      if (body) {
        this._q.setFromEuler(new THREE.Euler(0, this.rootGroup.rotation.y, 0))
        body.setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w }, false)
      }
    }

    if (body) {
      // Read the body's current yaw so linvel is always world-aligned
      const rq  = body.rotation()
      this._q.set(rq.x, rq.y, rq.z, rq.w)
      this._euler.setFromQuaternion(this._q, 'YXZ')
      const yaw = this._euler.y + this._yawOffset

      // ── Physics integration ─────────────────────────────────────────────
      const integrator = this._integrator
      const { v: pV, omega: pOmega } = integrator
        ? integrator.step(v, omega, dt, yaw, physEnv)
        : { v, omega }

      // Y linvel is 0 in the Rapier body — vertical movement is handled manually
      // above so the kinematic body stays at a fixed Y for correct XZ collision.
      body.setLinvel({ x: -pV * Math.sin(yaw), y: 0, z: -pV * Math.cos(yaw) }, true)
      body.setAngvel({ x: 0, y: pOmega, z: 0 }, true)

      physicsManager.step(dt)

      // Read XZ position + yaw back from Rapier (obstacle contacts already applied)
      const pos  = body.translation()
      const rot  = body.rotation()
      this._q.set(rot.x, rot.y, rot.z, rot.w)
      this._euler.setFromQuaternion(this._q, 'YXZ')

      this.rootGroup.position.set(pos.x, this.rootGroup.position.y, pos.z)
      this.rootGroup.rotation.y = this._euler.y
    } else {
      // ── Fallback: direct kinematic integration (Rapier not ready) ────────
      const yaw = this.rootGroup.rotation.y + this._yawOffset
      const integrator = this._integrator
      const { v: pV, omega: pOmega } = integrator
        ? integrator.step(v, omega, dt, yaw, physEnv)
        : { v, omega }
      this.rootGroup.position.x -= pV * Math.sin(yaw) * dt
      this.rootGroup.position.z -= pV * Math.cos(yaw) * dt
      this.rootGroup.rotation.y += pOmega * dt
    }
  }
  _stepLegged(dt) {
    const physState = usePhysicsStore.getState()
    const { speed, turn } = physState.leggedControl ?? { speed: 0, turn: 0 }
    const physEnv = {
      gravity:         physState.gravity,
      airDensity:      physState.airDensity,
      rollingFriction: physState.rollingFriction,
      wind:            physState.wind,
    }

    // Skip auto-gait when Arduino code is running — user's myServo.write() takes over
    const skipGait = simulationManager.isRunning()

    const { v: targetV, omega: targetOmega } =
      this._leggedSystem.step(dt, speed, turn, skipGait, physEnv, this.objectMgr)

    let body = physicsManager.getBody(DRIVE_BODY_ID)
    if (!body && physicsManager.ready) {
      body = physicsManager.createRobotBody(DRIVE_BODY_ID, {
        x: this.rootGroup.position.x,
        y: 0,
        z: this.rootGroup.position.z,
      })
      if (body) {
        this._q.setFromEuler(new THREE.Euler(0, this.rootGroup.rotation.y, 0))
        body.setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w }, false)
      }
    }

    // ── Gravity ────────────────────────────────────────────────────────────
    const groundY2  = -this._robotMinY
    const gravAccel = physEnv.gravity / SCENE_TO_M
    this._vy = Math.max(this._vy + gravAccel * dt, -MAX_V)
    const newY = this.rootGroup.position.y + this._vy * dt
    if (newY <= groundY2) { this._vy = 0; this.rootGroup.position.y = groundY2 }
    else                   { this.rootGroup.position.y = newY }

    if (body) {
      const rq = body.rotation()
      this._q.set(rq.x, rq.y, rq.z, rq.w)
      this._euler.setFromQuaternion(this._q, 'YXZ')
      const yaw = this._euler.y + this._yawOffset
      this._leggedSystem.setBodyYaw(yaw)

      body.setLinvel({ x: -targetV * Math.sin(yaw), y: 0, z: -targetV * Math.cos(yaw) }, true)
      body.setAngvel({ x: 0, y: targetOmega, z: 0 }, true)
      physicsManager.step(dt)

      const pos = body.translation()
      const rot = body.rotation()
      this._q.set(rot.x, rot.y, rot.z, rot.w)
      this._euler.setFromQuaternion(this._q, 'YXZ')
      this.rootGroup.position.set(pos.x, this.rootGroup.position.y, pos.z)
      this.rootGroup.rotation.y = this._euler.y
    } else {
      const yaw = this.rootGroup.rotation.y + this._yawOffset
      this._leggedSystem.setBodyYaw(yaw)
      this.rootGroup.position.x -= targetV * Math.sin(yaw) * dt
      this.rootGroup.position.z -= targetV * Math.cos(yaw) * dt
      this.rootGroup.rotation.y += targetOmega * dt
    }
  }
}

export const driveManager = new DriveManager()
