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
import { robotRuntime } from '../robot/RobotRuntime.js'
import { buildAssemblies } from '../utils/robotAssembly.js'

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

    // Rapier freefall mode — non-wheeled, non-legged objects
    this._rapierBodies      = new Map()   // rootId → { body, mesh, halfY, lCtr, compound }
    this._savedPositions    = new Map()   // obj.id → { position, quaternion } at enter()
    this._freefallSkip      = new Set()   // bonded child ids that follow a compound body
    this._useRapierFreefall = false

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

  get isActive() { return !!this.rootGroup || this._useRapierFreefall }

  /**
   * Compute Rapier body parameters for a mesh.
   *
   * Returns { worldCtr, lCtr, wq, hx, hy, hz } where:
   *   worldCtr — world-space center of the Rapier collider (local bbox rotated to world)
   *   lCtr     — local offset of the collider center from the mesh's world origin
   *              (needed in step() to recover mesh.position from Rapier translation)
   *   wq       — world quaternion for the Rapier body
   *   hx/hy/hz — LOCAL bbox half-extents (geometry-space × mesh scale, before rotation)
   *
   * Using local bbox for both position AND half-extents is critical:
   *   • AABB center is wrong for rotated meshes (AABB grows with rotation).
   *   • AABB half-extents inflate the collider for rotated / bent meshes, causing
   *     objects to float or collide at wrong heights.
   */
  _bodyParamsForMesh(mesh) {
    mesh.updateMatrixWorld(true)
    const wq = new THREE.Quaternion(); mesh.getWorldQuaternion(wq)
    const wp = new THREE.Vector3();    mesh.getWorldPosition(wp)
    let hx, hy, hz, lCtr, worldCtr

    if (mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const lb = mesh.geometry.boundingBox
      hx = (lb.max.x - lb.min.x) * 0.5 * Math.abs(mesh.scale.x)
      hy = (lb.max.y - lb.min.y) * 0.5 * Math.abs(mesh.scale.y)
      hz = (lb.max.z - lb.min.z) * 0.5 * Math.abs(mesh.scale.z)
      // Center of local bbox in geometry-scale space (mesh origin = 0,0,0)
      lCtr = new THREE.Vector3(
        (lb.min.x + lb.max.x) * 0.5 * mesh.scale.x,
        (lb.min.y + lb.max.y) * 0.5 * mesh.scale.y,
        (lb.min.z + lb.max.z) * 0.5 * mesh.scale.z
      )
      // Rotate local center into world space, then offset from mesh world origin
      worldCtr = lCtr.clone().applyQuaternion(wq).add(wp)
    } else {
      // Group / GLTF model: fall back to AABB with identity rotation so the
      // axis-aligned extents are used directly (no double-rotation).
      const bb = new THREE.Box3().setFromObject(mesh)
      if (bb.isEmpty()) return null
      const sz = new THREE.Vector3(); bb.getSize(sz)
      hx = sz.x * 0.5; hy = sz.y * 0.5; hz = sz.z * 0.5
      worldCtr = new THREE.Vector3(); bb.getCenter(worldCtr)
      lCtr     = worldCtr.clone().sub(wp)   // offset from mesh origin
      wq.set(0, 0, 0, 1)                    // identity — no double-rotation
    }
    return { worldCtr, lCtr, wq, hx: Math.max(0.01, hx), hy: Math.max(0.01, hy), hz: Math.max(0.01, hz) }
  }

  // Build compound-body parts for a bonded assembly: one box collider per member,
  // expressed in the ROOT's local frame. The body is created at the root's world
  // pose, so the root mesh follows the body directly and bonded children follow the
  // root via the normal bond propagation.
  _assemblyCompound(rootMesh, memberMeshes) {
    rootMesh.updateMatrixWorld(true)
    const rootPos  = rootMesh.getWorldPosition(new THREE.Vector3())
    const rootQuat = rootMesh.getWorldQuaternion(new THREE.Quaternion())
    const rootInv  = new THREE.Matrix4().compose(rootPos, rootQuat, new THREE.Vector3(1, 1, 1)).invert()
    const parts = []
    for (const m of memberMeshes) {
      const p = this._bodyParamsForMesh(m)
      if (!p) continue
      const cLocal = p.worldCtr.clone().applyMatrix4(rootInv)            // collider centre in root frame
      const relQ   = rootQuat.clone().invert().multiply(p.wq)            // collider rotation rel to root
      parts.push({
        halfExtents: { x: p.hx, y: p.hy, z: p.hz },
        offset:      { x: cLocal.x, y: cLocal.y, z: cLocal.z },
        rotation:    { x: relQ.x, y: relQ.y, z: relQ.z, w: relQ.w },
      })
    }
    return { rootPos, rootQuat, parts }
  }

  // Sync one freefall body → its mesh. Compound (welded-group) bodies map straight
  // to the root mesh; single bodies recover the mesh origin from the collider centre
  // and get a hard floor guard against numerical drift.
  _syncFreefallBody(entry) {
    const { body, mesh, halfY, lCtr, compound } = entry
    const pos = body.translation()
    const rot = body.rotation()
    const q   = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
    if (compound) {
      mesh.position.set(pos.x, pos.y, pos.z)
      mesh.quaternion.copy(q)
      return
    }
    const safeY = Math.max(pos.y, halfY)
    if (safeY !== pos.y) {
      body.setTranslation({ x: pos.x, y: safeY, z: pos.z }, true)
      const vel = body.linvel()
      if (vel.y < 0) body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true)
      pos.y = safeY
    }
    const rc = lCtr.clone().applyQuaternion(q)
    mesh.position.set(pos.x - rc.x, pos.y - rc.y, pos.z - rc.z)
    mesh.quaternion.copy(q)
  }


  enter(objects) {
    if (!this.scene || this.rootGroup || this._useRapierFreefall) return

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

    // ── Metadata-driven path selection ───────────────────────────────────────
    // If these objects belong to a Robot Blueprint, its locomotion type SELECTS
    // the execution path ('wheeled' | 'legged' | 'freefall') — geometry is NOT
    // inspected to decide. No blueprint → forcedPath is null → legacy auto-detect
    // (so every existing project keeps working unchanged).
    const forcedPath = robotRuntime.execPathForObjects(topLevel.map(o => o.id))
    if (forcedPath) console.log('[Drive] blueprint locomotion → path:', forcedPath)

    // Bonded (surface-welded) parts fall as ONE rigid body — a Rapier COMPOUND
    // body (a collider per part) so the weld tumbles and lands on a real face,
    // not as independent bodies (which let welded pieces dip below the floor).

    // ── Step 1: identify motors in world space and compute axle midpoint ──────
    //
    // The rootGroup pivot MUST be the midpoint of the wheel axle, not the
    // centroid of all objects.  Using the centroid shifts the rotation axis
    // away from the axle and makes spin-in-place look like a planetary orbit.
    const motors = topLevel.filter(o => MOTOR_TYPES.has(o.type))
    let pivotX = 0, pivotZ = 0

    if (motors.length >= 2 && forcedPath !== 'legged' && forcedPath !== 'freefall') {
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

      // Split left/right along the SHORTER axis (a vehicle's track is narrower
      // than its wheelbase), so "forward" runs along the LONGER axis — the way
      // the chassis actually points. Splitting along the longer axis (the old
      // behaviour) put forward perpendicular, so a robot longer than it is wide
      // drove sideways.
      const splitByX = zSpread >= xSpread   // long axis is Z → separate left/right by X
      const sorted = [...motorWorldPos].sort(
        splitByX ? (a, b) => a.x - b.x : (a, b) => a.z - b.z
      )
      const half = Math.max(1, Math.floor(sorted.length / 2))
      this._leftIds  = sorted.slice(0, half).map(m => m.id)
      this._rightIds = sorted.slice(-half).map(m => m.id)

      // Use the CENTROID of each side (not a single corner motor) so the axle
      // vector — and the forward heading derived from it — stays correct even
      // when the chassis is rotated off-grid or the layout is nearly square.
      const centroid = (ids) => {
        const ps = motorWorldPos.filter(m => ids.includes(m.id))
        if (!ps.length) return null
        return {
          x: ps.reduce((s, m) => s + m.x, 0) / ps.length,
          z: ps.reduce((s, m) => s + m.z, 0) / ps.length,
        }
      }
      const lPos = centroid(this._leftIds)
      const rPos = centroid(this._rightIds)

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
      this.wheelbase  = 3.0
      this._yawOffset = 0
      this._drive.wheelbase = 3.0

      if (motors.length === 1) {
        // Single-motor robot: assign the motor as both left and right so the
        // robot moves straight when code writes to it.  This also keeps
        // _leftIds non-empty, which prevents the non-wheeled tipping block
        // from running and causing the robot to flip over.
        this._leftIds  = [motors[0].id]
        this._rightIds = [motors[0].id]
        const m0 = this.objectMgr.getMesh(motors[0].id)
        if (m0) {
          m0.updateMatrixWorld(true)
          const mp = new THREE.Vector3()
          m0.getWorldPosition(mp)
          pivotX = mp.x
          pivotZ = mp.z
        }
      } else {
        this._leftIds  = []
        this._rightIds = []

        // Pivot = centroid of objects in the lowest-Y layer (the physical support/fulcrum).
        // For a seesaw (platform resting on a cube), this anchors the pivot at the
        // cube so _comLocalX is measured from the real support point, not the
        // centroid of all centers (which would make the seesaw appear balanced).
        let lowestBottomY = Infinity
        for (const obj of topLevel) {
          const mesh = this.objectMgr.getMesh(obj.id)
          if (!mesh) continue
          mesh.updateMatrixWorld(true)
          const bb = new THREE.Box3().setFromObject(mesh)
          if (!bb.isEmpty()) lowestBottomY = Math.min(lowestBottomY, bb.min.y)
        }
        let n = 0
        for (const obj of topLevel) {
          const mesh = this.objectMgr.getMesh(obj.id)
          if (!mesh) continue
          const bb = new THREE.Box3().setFromObject(mesh)
          if (bb.isEmpty()) continue
          if (bb.min.y <= lowestBottomY + 0.05) {
            const ctr = bb.getCenter(new THREE.Vector3())
            pivotX += ctr.x; pivotZ += ctr.z; n++
          }
        }
        if (n > 0) { pivotX /= n; pivotZ /= n }
      }
    }

    // ── Step 1b: detect legged robot ─────────────────────────────────────────
    // If there are no drive motors but servos have attached arm objects → legged robot
    const { attachments } = useElectronicsStore.getState()
    if (forcedPath === 'legged' || (forcedPath == null && motors.length < 2)) {
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

    // ── Rapier freefall — objects with no motor (no wheels) ──────────────────
    // Each object gets its own Rapier dynamic body. Rapier handles gravity,
    // tipping, stacking and object-to-object collisions — no hand-written
    // physics needed. Falls back to the rootGroup path only if Rapier isn't
    // ready yet (first ~1 s of app startup).
    // Robots with ≥1 motor always use the rootGroup path so the wheel and
    // chassis stay as one unified rigid body (no Rapier contact explosions).
    if ((forcedPath === 'freefall' || (forcedPath == null && motors.length === 0 && !this._isLegged)) && physicsManager.ready) {
      physicsManager.setGravity(gravity)   // ensure correct environment gravity

      // Snapshot design-time positions so exit() can restore them.
      // Without this, stop→start runs simulation from the already-settled state
      // and nothing appears to move on the second (and later) runs.
      this._savedPositions.clear()
      for (const obj of topLevel) {
        const mesh = this.objectMgr.getMesh(obj.id)
        if (mesh) {
          this._savedPositions.set(obj.id, {
            position:   mesh.position.clone(),
            quaternion: mesh.quaternion.clone(),
          })
        }
      }

      // Enroll one body per ASSEMBLY: a welded group → a single compound body;
      // a loose object → its own simple body. Bonded child members get no body
      // (they follow the root via bonds).
      this._freefallSkip = new Set()
      const topIdSet = new Set(topLevel.map(o => o.id))
      for (const a of buildAssemblies()) {
        const memberIds = a.memberIds.filter(id => topIdSet.has(id))
        if (!memberIds.length) continue
        const rootId   = memberIds.includes(a.rootId) ? a.rootId : memberIds[0]
        const rootMesh = this.objectMgr.getMesh(rootId)
        if (!rootMesh || rootMesh.parent !== this.scene) continue
        const memberMeshes = memberIds.map(id => this.objectMgr.getMesh(id)).filter(Boolean)

        if (memberMeshes.length <= 1) {
          const p = this._bodyParamsForMesh(rootMesh)
          if (!p) continue
          const { worldCtr, lCtr, wq, hx, hy, hz } = p
          worldCtr.y += 0.05
          const body = physicsManager.createDynamicBody(
            'free_' + rootId,
            { x: worldCtr.x, y: worldCtr.y, z: worldCtr.z },
            { x: wq.x, y: wq.y, z: wq.z, w: wq.w },
            { x: hx, y: hy, z: hz }
          )
          if (body) this._rapierBodies.set(rootId, { body, mesh: rootMesh, halfY: hy, lCtr, compound: false })
        } else {
          const c = this._assemblyCompound(rootMesh, memberMeshes)
          if (!c.parts.length) continue
          const body = physicsManager.createCompoundBody(
            'free_' + rootId,
            { x: c.rootPos.x, y: c.rootPos.y + 0.05, z: c.rootPos.z },
            { x: c.rootQuat.x, y: c.rootQuat.y, z: c.rootQuat.z, w: c.rootQuat.w },
            c.parts
          )
          if (body) this._rapierBodies.set(rootId, { body, mesh: rootMesh, halfY: 0, lCtr: new THREE.Vector3(), compound: true })
          for (const id of memberIds) if (id !== rootId) this._freefallSkip.add(id)
        }
      }

      // Static colliders for standalone obstacles
      for (const obj of standaloneObjects) {
        const mesh = this.objectMgr.getMesh(obj.id)
        if (!mesh) continue
        mesh.updateMatrixWorld(true)
        const box  = new THREE.Box3().setFromObject(mesh)
        const ctr2 = new THREE.Vector3(); box.getCenter(ctr2)
        const half = new THREE.Vector3(); box.getSize(half).multiplyScalar(0.5)
        physicsManager.createStaticObstacle(
          'obs_' + obj.id, ctr2,
          { x: Math.max(0.1, half.x), y: Math.max(0.1, half.y), z: Math.max(0.1, half.z) }
        )
        this._obstacleIds.push('obs_' + obj.id)
      }

      this._useRapierFreefall = true

      // Pre-warm: run 15 Rapier steps at 1 ms with zero gravity so any initial
      // contact violations (overlapping stacked objects, corner penetrations) are
      // resolved with small position corrections rather than large velocity
      // impulses.  After pre-warm, sync mesh positions to the clean start state.
      physicsManager.setGravity(0)
      for (let i = 0; i < 15; i++) physicsManager.step(0.001)
      physicsManager.setGravity(gravity)
      for (const [, { body, mesh: m, halfY: hy2, lCtr: lc }] of this._rapierBodies) {
        const pos = body.translation()
        const rot = body.rotation()
        const q   = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        const safeY = Math.max(pos.y, hy2)
        if (safeY !== pos.y) body.setTranslation({ x: pos.x, y: safeY, z: pos.z }, true)
        const rc = lc.clone().applyQuaternion(q)
        m.position.set(pos.x - rc.x, safeY - rc.y, pos.z - rc.z)
        m.quaternion.copy(q)
      }
      for (const [, entry] of this._rapierBodies) this._syncFreefallBody(entry)

      this._lastTime = null
      return   // skip rootGroup creation entirely
    }

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

    // ── Legged: store knee-servo rest transforms relative to their arms ─────────
    // Knee servos are siblings of arms in rootGroup, but must follow the arm tip
    // when the hip servo rotates. We capture the design-time relative matrix here
    // so _stepLegged() can re-apply it every frame after hip animation.
    if (this._isLegged && this._leggedSystem) {
      for (const leg of this._leggedSystem.legs) {
        if (!leg.kneeServoId) continue
        const armMesh  = this.objectMgr.getMesh(leg.armId)
        const kneeMesh = this.objectMgr.getMesh(leg.kneeServoId)
        if (armMesh && kneeMesh) {
          armMesh.updateMatrixWorld(true)
          kneeMesh.updateMatrixWorld(true)
          // Knee's world transform expressed in arm-local space
          leg._kneeRestMatrix = armMesh.matrixWorld.clone().invert().multiply(kneeMesh.matrixWorld)
        }
      }
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
    // Skip for 1-motor robots: the wheel's 90° design rotation would be extracted
    // into rootGroup, immediately tilting the whole robot 90° sideways.
    if (motors.length === 0 && !this._isLegged) {
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
    if (!this.rootGroup && !this._useRapierFreefall) return

    // ── Rapier freefall cleanup ───────────────────────────────────────────────
    if (this._useRapierFreefall) {
      for (const [objId] of this._rapierBodies) physicsManager.removeBody('free_' + objId)
      // Restore EVERY object (incl. bonded children that had no body of their own)
      // to its design-time pose so the next run starts from the authored state.
      for (const [objId, saved] of this._savedPositions) {
        const mesh = this.objectMgr.getMesh(objId)
        if (!saved || !mesh) continue
        mesh.position.copy(saved.position)
        mesh.quaternion.copy(saved.quaternion)
        if (updateObject) {
          const e = new THREE.Euler().setFromQuaternion(saved.quaternion)
          updateObject(objId, {
            position: { x: saved.position.x, y: saved.position.y, z: saved.position.z },
            rotation: { x: e.x, y: e.y, z: e.z },
          })
        }
      }
      for (const id of this._obstacleIds) physicsManager.removeBody(id)
      this._obstacleIds = []
      this._rapierBodies.clear()
      this._savedPositions.clear()
      this._freefallSkip = new Set()
      this._useRapierFreefall = false
      this._lastTime = null
      return
    }

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
    if (!this.rootGroup && !this._useRapierFreefall) return

    const now = performance.now() / 1000
    const dt  = this._lastTime !== null ? Math.min(now - this._lastTime, 0.05) : 0
    this._lastTime = now
    if (dt === 0) return

    // ── Rapier freefall path ──────────────────────────────────────────────────
    // Each object is a Rapier dynamic body — gravity, tipping, stacking and
    // object-to-object collisions are all handled by the physics engine.
    if (this._useRapierFreefall) {
      const gravity = usePhysicsStore.getState().gravity
      physicsManager.setGravity(gravity)

      // Dynamically enroll loose objects added to the scene since sim started.
      // Bonded child members (followed via bonds inside a compound body) are skipped.
      for (const obj of useSceneStore.getState().objects) {
        if (this._rapierBodies.has(obj.id) || this._freefallSkip?.has(obj.id) || obj.visible === false) continue
        const mesh = this.objectMgr.getMesh(obj.id)
        if (!mesh) continue
        const p = this._bodyParamsForMesh(mesh)
        if (!p) continue
        const { worldCtr, lCtr, wq, hx, hy, hz } = p
        const halfY = hy
        worldCtr.y += 0.05
        const body = physicsManager.createDynamicBody(
          'free_' + obj.id,
          { x: worldCtr.x, y: worldCtr.y, z: worldCtr.z },
          { x: wq.x, y: wq.y, z: wq.z, w: wq.w },
          { x: hx, y: hy, z: hz }
        )
        if (body) this._rapierBodies.set(obj.id, { body, mesh, halfY: hy, lCtr, compound: false })
      }

      physicsManager.step(dt)

      for (const [, { body, mesh, halfY, lCtr }] of this._rapierBodies) {
        const pos = body.translation()
        const rot = body.rotation()
        const q   = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        // Hard floor clamp: Rapier's ground collider handles this, but we guard
        // against numerical drift so the mesh never visually clips through y=0.
        const safeY = Math.max(pos.y, halfY)
        if (safeY !== pos.y) {
          body.setTranslation({ x: pos.x, y: safeY, z: pos.z }, true)
          const vel = body.linvel()
          if (vel.y < 0) body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true)
          pos.y = safeY
        }
        // Rapier drives the collider centre.  Recover the mesh origin by
        // un-applying the local centre offset in the body's current orientation.
        const rc = lCtr.clone().applyQuaternion(q)
        mesh.position.set(pos.x - rc.x, pos.y - rc.y, pos.z - rc.z)
        mesh.quaternion.copy(q)
      }
      for (const [, entry] of this._rapierBodies) this._syncFreefallBody(entry)
      return
    }

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
      // Dynamic COM: recalculate every frame so objects added after simulation
      // starts are immediately reflected. Uses equal-weight averaging (each
      // object counts once regardless of volume) so a small cube placed
      // asymmetrically on a large platform has its full gravitational effect.
      {
        const allObjs = useSceneStore.getState().objects
        let sumX = 0, sumZ = 0, n = 0
        for (const obj of allObjs) {
          if (obj.visible === false) continue
          const mesh = this.objectMgr.getMesh(obj.id)
          if (!mesh) continue
          let lx, lz
          if (mesh.parent === this.rootGroup) {
            lx = mesh.position.x
            lz = mesh.position.z
          } else {
            const lp = this.rootGroup.worldToLocal(
              mesh.getWorldPosition(new THREE.Vector3())
            )
            lx = lp.x; lz = lp.z
          }
          sumX += lx; sumZ += lz; n++
        }
        if (n > 0) {
          this._comLocalX = sumX / n
          this._comLocalZ = sumZ / n
        }
      }

      // Non-wheeled physics: two independent torque sources are combined.
      //
      // 1. COM-tipping: COM is offset from the pivot in X or Z → gravity tips
      //    the object toward the heavy side (seesaw, asymmetric assembly).
      //
      // 2. Settling: restoring spring torque (−g·arm·sin θ) brings a tilted
      //    object back to flat. Blended away when COM offset is large.
      //
      // tipRatio ≈ 0  → symmetric → settling wins → lands flat
      // tipRatio ≈ 1  → lopsided  → tipping wins  → heavy side falls
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
      const isGrounded = lowestY <= 0.05   // tipping only once nearly touching the floor

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
    // ── Ground clamp ─────────────────────────────────────────────────────────
    if (this._leftIds.length > 0) {
      // Drop until the robot's LOWEST point (e.g. wheel bottoms) rests on the
      // floor, so a robot built floating in the air falls and lands on its wheels
      // instead of being pinned at its design height. A robot built already on the
      // grid has _robotMinY ≈ 0, so this stays a no-op for the common case.
      const groundY = -this._robotMinY
      if (this.rootGroup.position.y < groundY) {
        this.rootGroup.position.y = groundY
        if (this._vy < 0) this._vy = 0
      }
    } else {
      // Non-wheeled / bonded rigid group: drop straight down until the ACTUAL
      // lowest point of the assembly rests on the grid. Using the real bounding box
      // (not a full-box corner estimate) stops an L-shaped or tilted weld from
      // hovering above — or sinking below — the floor.
      const box = new THREE.Box3().setFromObject(this.rootGroup)
      if (!box.isEmpty() && box.min.y < 0) {
        this.rootGroup.position.y -= box.min.y   // lift so lowest point sits at y = 0
        if (this._vy < 0) this._vy = 0
        // Settle: bleed off tipping velocity once it's resting on the floor.
        this._pitchVel *= 0.5
        this._rollVel  *= 0.5
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

    // Skip auto-gait when code is running (Servo.write takes over) OR when no
    // movement is commanded (legs rest in place until arrow keys / D-pad are held).
    const skipGait = simulationManager.isRunning() || (speed === 0 && turn === 0)

    const { v: targetV, omega: targetOmega } =
      this._leggedSystem.step(dt, speed, turn, skipGait, physEnv, this.objectMgr)

    // Sync knee servo positions to follow their arm tips.
    // Hip servo animation (above) rotated each arm inside its rotorGroup.
    // The knee servo is a rootGroup sibling — it must be repositioned every frame
    // so it stays welded to the arm tip and the foot rotates around the right point.
    {
      this.rootGroup.updateMatrixWorld(true)
      const _rootInv = this.rootGroup.matrixWorld.clone().invert()
      const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3()
      for (const leg of this._leggedSystem.legs) {
        if (!leg.kneeServoId || !leg._kneeRestMatrix) continue
        const armMesh  = this.objectMgr.getMesh(leg.armId)
        const kneeMesh = this.objectMgr.getMesh(leg.kneeServoId)
        if (!armMesh || !kneeMesh) continue
        armMesh.updateMatrixWorld(true)
        // arm's current world × design-time knee offset → knee's desired world transform
        const worldKnee = armMesh.matrixWorld.clone().multiply(leg._kneeRestMatrix)
        // Convert to rootGroup-local so setting kneeMesh.position is correct
        worldKnee.premultiply(_rootInv).decompose(_p, _q, _s)
        kneeMesh.position.copy(_p)
        kneeMesh.quaternion.copy(_q)
      }
    }

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
