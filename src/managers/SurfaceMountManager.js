import * as THREE from 'three'
import { sceneManager } from './SceneManager.js'
import { objectManager } from './ObjectManager.js'
import { recordSnapshot } from './history/editorDispatch.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { weaponForType, isWeaponType } from '../combat/weaponRegistry.js'
import { loadWeaponModel } from '../utils/modelLoader.js'
import { raycastFirst, prepareSurfaceRaycast } from '../utils/surfaceRaycast.js'
import { assemblyRootOf } from '../utils/robotAssembly.js'
import { robotFrame } from '../combat/robotFront.js'

// ─────────────────────────────────────────────────────────────────────────────
// SurfaceMountManager — drag a part onto a robot and snap it flush to the
// actual surface under the cursor (CAD-style), then weld it with a rigid bond.
//
//   pointer → SceneManager.pickSurfaceHit (real mesh, point + world normal)
//           → no robot surface under the pointer? proximity snap: the nearest
//             robot surface within SNAP_PX (how undersides / near-misses work)
//           → target validation → solve(): surface alignment × manual offset
//             + flush offset
//           → support probes (base must rest on the surface, nothing in the
//             way); a base hanging off an edge is slid back onto the face
//           → ghost + footprint preview (transient, no store writes)
//           → commit: rigidStore bond { attach: 'surface' } + one undo step
//
// Manual rotation (pointer sessions — click-to-place and the re-mount drag;
// an HTML5 drag gets no key/wheel events): Q/E or the wheel spin the part about
// the surface normal, Z/C tilt it, X resets. It's an OFFSET on top of the
// automatic alignment, so it survives moving to another face; a re-mount
// starts from the part's current hand-set offset.
//
// Persistence is the existing bond system: relativeMatrix = the part's pose in
// its parent's local space, propagated every frame (so it follows the robot),
// saved/loaded/exported/undone like any bond, and grouped into the robot by
// buildAssemblies() for Battle. contactLocalNormal/Center make the existing
// "Rotate on attached surface" controls work on mounted parts.
//
// A part is mountable when it has a mount spec: weapons read theirs from
// weaponRegistry (`mount`); other part types can registerMountSpec() later.
// ─────────────────────────────────────────────────────────────────────────────

export const PART_DRAG_MIME = 'application/x-constructa-part'

const AXES = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
}

const _extraSpecs = {}
const _specCache = new Map()

/** Register a mount spec for a non-weapon part type: { up, forward, base? }. */
export function registerMountSpec(type, spec) { _extraSpecs[type] = spec; _specCache.delete(type) }

/** Normalised mount spec ({ up, forward, side: Vector3, base }) or null. */
export function mountSpecFor(type) {
  if (_specCache.has(type)) return _specCache.get(type)
  const raw = _extraSpecs[type] ?? weaponForType(type)?.mount ?? null
  let spec = null
  if (raw && AXES[raw.up] && AXES[raw.forward]) {
    const up = new THREE.Vector3(...AXES[raw.up])
    const forward = new THREE.Vector3(...AXES[raw.forward])
    if (Math.abs(up.dot(forward)) < 1e-6) {
      spec = {
        up, forward,
        side: new THREE.Vector3().crossVectors(forward, up),   // right-handed (F, U, S)
        base: THREE.MathUtils.clamp(raw.base ?? 0.5, 0.05, 1),
      }
    }
  }
  _specCache.set(type, spec)
  return spec
}

export function isSurfaceMountable(type) { return !!mountSpecFor(type) }

// Preview colours — cyan = the app's surface-attach colour, red = invalid.
const COLOR = { attach: 0x06b6d4, free: 0x94a3b8, invalid: 0xef4444 }
const EPS = 0.002                        // hairline lift so coplanar faces don't z-fight
const SUPPORT_NORMAL_DOT = Math.cos(THREE.MathUtils.degToRad(30))
const REF_ENTER_UP = 0.97                // hysteresis for the roll reference (see solve)
const REF_LEAVE_UP = 0.93
const SNAP_PX = 36                       // proximity snap reach, screen pixels
const SNAP_KEEP_PX = 52                  // …and the reach to KEEP a proximity target (hysteresis)
const SPIN_STEP = Math.PI / 12           // Q/E / wheel: 15° (Shift: 5°)
const FINE_STEP = Math.PI / 36
const FIT_STEPS = 8                      // edge fitting: slide attempts

const v3 = (o) => new THREE.Vector3(o.x, o.y, o.z)
const xyz = (v) => ({ x: v.x, y: v.y, z: v.z })

// Axis-aligned precise (vertex) bounds of a part in its own local frame. The
// loose Box3 of some GLBs is far larger than the visible model (rocket pod:
// 3.5 vs 1.05), which would make parts float — so always use precise bounds.
function localPreciseBox(preview) {
  preview.position.set(0, 0, 0); preview.quaternion.identity(); preview.scale.set(1, 1, 1)
  preview.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(preview, true)
  return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)) : box
}

// ── The mount solver (pure) ──────────────────────────────────────────────────
// point/normal: world contact + unit surface normal. refQuat: frame giving the
// robot's forward (+Z) and up (+Y). box: part-local precise bounds; scale: the
// part's scale. keepForward (optional world vector) preserves an existing roll.
// refState.useUp carries the roll-reference choice between frames.
//
// Orientation: R maps local (forward, up, side) → world (f, n, s) — a proper
// rotation built from two orthonormal bases, so up is exactly the normal and
// roll is fully determined. f = the robot's forward projected onto the surface;
// on faces nearly facing forward/back (where that projection vanishes) the
// robot's up is used instead, with hysteresis so the choice never flickers.
//
// Offset: the part's lowest point along -up (from its bounds, scaled) sits on
// the surface, and its footprint centre sits under the cursor — independent of
// where the model's origin happens to be.
export function solveMount({ point, normal, refQuat, spec, box, scale, keepForward = null, refState = {}, manual = null }) {
  const n = normal.clone().normalize()
  let ref
  if (keepForward) {
    ref = keepForward.clone()
  } else {
    // On faces that look along the robot's forward axis (front / rear) the
    // forward projection vanishes; lay the part ACROSS the face (robot right)
    // there — a barrel standing upright on a short front plate never fits.
    const fz = new THREE.Vector3(0, 0, 1).applyQuaternion(refQuat)
    const fx = new THREE.Vector3(1, 0, 0).applyQuaternion(refQuat)
    const a = Math.abs(n.dot(fz))
    if (refState.useUp) { if (a < REF_LEAVE_UP) refState.useUp = false }
    else if (a > REF_ENTER_UP) refState.useUp = true
    ref = refState.useUp ? fx : fz
  }
  const f = ref.addScaledVector(n, -ref.dot(n))
  if (f.lengthSq() < 1e-8) {                       // degenerate: any tangent will do
    f.set(1, 0, 0).addScaledVector(n, -n.x)
    if (f.lengthSq() < 1e-8) f.set(0, 0, 1).addScaledVector(n, -n.z)
  }
  f.normalize()
  const s = new THREE.Vector3().crossVectors(f, n)
  const R = new THREE.Matrix4().makeBasis(f, n, s)
    .multiply(new THREE.Matrix4().makeBasis(spec.forward, spec.up, spec.side).transpose())
  const auto = new THREE.Quaternion().setFromRotationMatrix(R)

  const S = new THREE.Vector3(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
  const min = box.min.clone().multiply(S), max = box.max.clone().multiply(S)
  const size = max.clone().sub(min)
  const center = min.clone().add(max).multiplyScalar(0.5)
  const out = {
    autoQuaternion: auto, normal: n, forward: f, side: s,
    halfForward: Math.abs(size.dot(spec.forward)) / 2,
    halfSide: Math.abs(size.dot(spec.side)) / 2,
    height: Math.abs(size.dot(spec.up)),
  }
  if (manual && Math.abs(manual.w) < 1 - 1e-9) {
    // Final = surface alignment × manual offset (offset in the part's frame).
    // Seat: lowest corner along the normal on the surface, centre over the point.
    seatWithOrientation(out, auto.clone().multiply(manual), point, n, box, scale)
    // Footprint follows the spin about the normal (tilt keeps the same pad).
    const fw = spec.forward.clone().applyQuaternion(out.quaternion)
    fw.addScaledVector(n, -fw.dot(n))
    if (fw.lengthSq() > 1e-6) { out.forward = fw.normalize(); out.side = new THREE.Vector3().crossVectors(out.forward, n) }
    return out
  }
  // support of the scaled box along -up (up is a signed unit axis)
  const lowUp = spec.up.dot(new THREE.Vector3(
    spec.up.x >= 0 ? min.x : max.x, spec.up.y >= 0 ? min.y : max.y, spec.up.z >= 0 ? min.z : max.z))
  const drop = -lowUp                                           // origin height above contact
  const lateral = center.clone().addScaledVector(spec.up, -center.dot(spec.up))
  out.quaternion = auto
  out.position = point.clone()
    .addScaledVector(n, drop + EPS)
    .sub(lateral.applyQuaternion(auto))
  return out
}

const USER_TURN_EPS = 0.01   // rad — below this a part is still in its auto-snap pose

// Re-seat `sol` with a given orientation: lowest point of the scaled box along
// -normal sits on the contact plane, box centre over the contact point (the
// same rule solveMount uses for its own orientation).
function seatWithOrientation(sol, quaternion, point, normal, box, scale) {
  const S = new THREE.Vector3(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
  const min = box.min.clone().multiply(S), max = box.max.clone().multiply(S)
  let low = Infinity
  const c = new THREE.Vector3()
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyQuaternion(quaternion)
    low = Math.min(low, c.dot(normal))
  }
  const center = min.add(max).multiplyScalar(0.5).applyQuaternion(quaternion)
  const lateral = center.addScaledVector(normal, -center.dot(normal))
  sol.quaternion = quaternion.clone()
  sol.position = point.clone().addScaledVector(normal, -low + EPS).sub(lateral)
}

const STATUS_TEXT = {
  attach: (t, click) => `${click ? 'Click' : 'Release'} to mount on ${t}`,
  free: (t, click) => `${click ? 'Click' : 'Release'} to place it on the ground`,
  overhang: () => 'Too close to the edge — the base would hang off',
  blocked: () => 'Something is already in that spot',
  reject: (t) => `Can't mount on ${t} — pick a structural part`,
  none: () => 'Point at a robot part to mount',
}

class SurfaceMountManager {
  constructor() {
    this.active = null
    this.pendingType = null
    this.onStatus = null          // (status | null) → void   (Viewport hint chip)
    this._ready = new Map()       // type → Promise (model load)
    this._raf = 0
  }

  get isActive() { return !!this.active }

  /** Start loading a part's model ahead of a drag (called on dragstart). */
  prepare(type) {
    this.pendingType = type
    return this._prepare(type)
  }

  _prepare(type) {
    if (!this._ready.has(type)) {
      const p = weaponForType(type) ? loadWeaponModel(type).catch(() => null) : Promise.resolve(null)
      const entry = p.then(() => { entry.done = true })
      entry.done = false
      this._ready.set(type, entry)
    }
    return this._ready.get(type)
  }

  // ── Session ───────────────────────────────────────────────────────────────
  // New part: begin({ type, bounds }). Existing part: begin({ objectId, bounds }).
  begin({ type = null, objectId = null, bounds }) {
    if (this.active?.committing) return false
    this._stopFrame()
    this._teardown()
    const scene = sceneManager.scene
    if (!scene || !bounds) return false
    let obj = null
    if (objectId) {
      obj = useSceneStore.getState().objects.find(o => o.id === objectId)
      if (!obj) return false
      type = obj.type
    }
    const spec = type ? mountSpecFor(type) : null
    if (!spec) return false

    // Everything that moves with the part (it + its bond descendants) must never
    // be a mount target, or we'd create a cycle / mount it onto itself.
    const moving = new Set(objectId ? [objectId] : [])
    if (objectId) {
      const bonds = useRigidStore.getState().getBonds()
      for (let grew = true; grew;) {
        grew = false
        for (const b of bonds) if (moving.has(b.parentId) && !moving.has(b.childId)) { moving.add(b.childId); grew = true }
      }
    }
    const roots = objectManager.getAllMeshes().filter(m => !moving.has(m.userData.id))
    const rootInfo = roots.map(m => ({
      id: m.userData.id,
      box: new THREE.Box3().setFromObject(m),
      meshes: sceneManager.surfaceCandidates([m]),
    }))
    // Proximity-snap hosts: valid structural parts, each with its precise box in
    // its own frame (oriented box in world → follows any robot rotation).
    const hosts = []
    for (const r of rootInfo) {
      if (!r.meshes.length || this._verdict(r.id) !== 'ok') continue
      const root = objectManager.getMesh(r.id)
      if (!root) continue
      root.updateMatrixWorld(true)
      const inv = root.matrixWorld.clone().invert()
      const lb = new THREE.Box3()
      for (const m of r.meshes) {
        const g = m.geometry
        if (!g.boundingBox) g.computeBoundingBox()
        if (!g.boundingBox || g.boundingBox.isEmpty()) continue
        lb.union(g.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)))
      }
      if (!lb.isEmpty()) hosts.push({ id: r.id, meshes: r.meshes, box: lb, world: root.matrixWorld.clone(), inv, normalMat: new THREE.Matrix3().getNormalMatrix(root.matrixWorld) })
    }

    prepareSurfaceRaycast(rootInfo.flatMap(r => r.meshes))   // one-time per geometry

    const realMesh = objectId ? objectManager.getMesh(objectId) : null
    // Re-mounting: the gizmo would stay behind on the hidden original.
    const tc = objectId ? sceneManager.transformControls : null
    const gizmoWasVisible = tc ? tc.visible : null
    if (tc) tc.visible = false
    const a = this.active = {
      type, objectId, obj, spec, bounds, moving, realMesh, gizmoWasVisible,
      realWasVisible: realMesh ? realMesh.visible : true,
      scale: obj ? { ...obj.scale } : { x: 1, y: 1, z: 1 },
      candidates: rootInfo.flatMap(r => r.meshes),
      rootInfo, hosts,
      refState: {},
      manual: objectId ? this._currentOffset(objectId, spec) : new THREE.Quaternion(),
      near: null,                 // sticky proximity target { id }
      ghost: null, box: null, indicator: this._makeIndicator(),
      last: null, result: null, statusKey: null,
      ready: this._prepare(type),
    }
    scene.add(a.indicator)
    this._buildGhost()
    if (!a.box) { this._teardown(); return false }
    if (!a.ready.done) {
      a.ready.then(() => {
        if (this.active !== a) return
        this._buildGhost()          // swap placeholder → real model, re-measure
        this._process()
      })
    }
    return true
  }

  // Click-to-place: the part follows the pointer over the viewport (same solver
  // and preview as a drag), keys rotate it, a click confirms (the Viewport
  // routes pointer/keys while `placing`).
  async startPlacement(type) {
    if (!mountSpecFor(type)) return false
    this.prepare(type)
    const canvas = sceneManager.renderer?.domElement
    if (!canvas) return false
    const ok = this.begin({ type, bounds: canvas.getBoundingClientRect() })
    if (ok) { this.active.placing = true; this.active.statusKey = null; this._process() }
    return ok
  }

  get placing() { return !!this.active?.placing }
  get pointerSession() { return !!this.active && (this.active.placing || !!this.active.objectId) }

  /** Manual rotation offset: 'spin' (about the surface normal) | 'tilt' | 'reset'. */
  rotate(kind, dir = 1, fine = false) {
    const a = this.active
    if (!a) return
    if (kind === 'reset') a.manual.identity()
    else {
      const axis = kind === 'tilt' ? a.spec.side : a.spec.up
      a.manual.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dir * (fine ? FINE_STEP : SPIN_STEP))).normalize()
    }
    // a.manual is in the part frame (final = auto × manual): premultiplying a
    // turn about the part's up / side axis = a world turn about the surface
    // normal / tangent, whatever the current offset is.
    if (a.last) this._process()
  }

  // The part's current hand-set rotation relative to where the auto alignment
  // would put it on its present mount — so a re-mount keeps it.
  _currentOffset(objectId, spec) {
    const mesh = objectManager.getMesh(objectId)
    if (!mesh) return new THREE.Quaternion()
    mesh.updateMatrixWorld(true)
    const cur = mesh.getWorldQuaternion(new THREE.Quaternion())
    const b = useRigidStore.getState().getBonds().find(x => x.childId === objectId && x.contactLocalNormal)
    const parent = b ? objectManager.getMesh(b.parentId) : null
    let n, refQuat
    if (parent) {
      parent.updateMatrixWorld(true)
      refQuat = parent.getWorldQuaternion(new THREE.Quaternion())
      n = v3(b.contactLocalNormal).applyQuaternion(refQuat).normalize()
    } else { n = spec.up.clone().applyQuaternion(cur); refQuat = new THREE.Quaternion() }
    const unit = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
    const auto = solveMount({ point: new THREE.Vector3(), normal: n, refQuat, spec, box: unit, scale: { x: 1, y: 1, z: 1 }, refState: {} }).autoQuaternion
    const off = auto.invert().multiply(cur).normalize()
    return off
  }

  update(clientX, clientY) {
    const a = this.active
    if (!a) return
    a.last = { clientX, clientY }
    if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this._process() })
  }

  /** Pointer left the viewport: hide the preview but keep the session. */
  hide() {
    const a = this.active
    if (!a) return
    a.last = null
    this._process()
  }

  cancel() {
    this.pendingType = null
    // A drop that is waiting for its model to finish loading owns the session.
    if (!this.active || this.active.committing) return
    this._stopFrame()
    this._teardown()
    this._notify(null)
  }

  /** Drop / release. Resolves true when something was placed or mounted. */
  async commit() {
    const a = this.active
    if (!a || a.committing) { this.pendingType = null; return false }
    this._stopFrame()
    this._process()
    // First drag of a type: its model may still be loading — the offset must be
    // measured on the real model, so wait for it and re-solve before applying.
    if (!a.ready.done) {
      a.committing = true
      await a.ready
      a.committing = false
      if (this.active !== a) return false
      this._buildGhost()
      this._process()
    }
    const res = a.result
    this.lastManualAngle = 2 * Math.acos(Math.min(1, Math.abs(a.manual.w)))
    this._teardown()
    this.pendingType = null
    this._notify(null)
    if (!res || (res.status !== 'attach' && res.status !== 'free')) return false
    this._apply(a, res)
    return true
  }

  _stopFrame() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0 }
  }

  // ── Per-frame work ────────────────────────────────────────────────────────
  _process() {
    const a = this.active
    if (!a) return
    let res = { status: 'none' }
    if (a.last) {
      let hit = sceneManager.pickSurfaceHit(a.last, a.bounds, a.candidates)
      let verdict = hit?.rootId ? this._verdict(hit.rootId) : null
      // Nothing mountable under the pointer (floor, empty space, the gap under
      // the chassis): snap to the nearest robot surface if it's close on screen.
      if (verdict !== 'ok' && hit?.ray) {
        const near = this._nearSurface(a, hit.ray, hit.rootId ? hit.distance : Infinity)
        if (near) { hit = near; verdict = 'ok' }
      }
      if (hit?.rootId) {
        const target = objectManager.getMesh(hit.rootId)
        if (verdict === 'ground' || !target) {
          res = this._solveFree(a, hit.point, hit.normal)
        } else {
          res = this._mountOn(a, hit, verdict)
          // The part under the pointer can't take it (a wheel, a too-small
          // face, …): the nearest surface within reach that CAN wins.
          if (res.status !== 'attach' && !hit.proximity && hit.ray) {
            const near = this._nearSurface(a, hit.ray, Infinity, hit.rootId)
            const alt = near ? this._mountOn(a, near, 'ok') : null
            if (alt?.status === 'attach') { res = alt; hit = near }
          }
        }
      } else if (hit?.ray) {
        const p = hit.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
        if (p) res = this._solveFree(a, p, new THREE.Vector3(0, 1, 0))
      }
    }
    a.near = res.proximity ? { id: res.targetId } : null
    a.result = res
    this._render(a, res)
    const name = res.targetId ? (useSceneStore.getState().objects.find(o => o.id === res.targetId)?.name ?? 'part') : ''
    const ptr = !!(a.placing || a.objectId)
    const key = res.status + '|' + name + '|' + ptr
    if (key !== a.statusKey) {
      a.statusKey = key
      const hint = ptr ? ' · Q/E spin · Z/C tilt · X reset · Esc cancel' : ''
      this._notify({
        status: res.status,
        ok: res.status === 'attach' || res.status === 'free',
        text: STATUS_TEXT[res.status](name, !!a.placing) + hint,
      })
    }
    sceneManager.requestRender()
  }

  // Solve + validate a mount on `hit` (point, normal, rootId); edge fitting
  // slides an overhanging base back onto the face.
  _mountOn(a, hit, verdict) {
    const target = objectManager.getMesh(hit.rootId)
    // Reference frame for the auto alignment: the ROBOT's frame (its declared
    // front = +Z, roll/pitch kept — robotFront.js), so a weapon lands pointing
    // down the nose, not along whichever way the host part happens to face.
    const refQuat = robotFrame(assemblyRootOf(hit.rootId)) ?? target.getWorldQuaternion(new THREE.Quaternion())
    const solve = (point) => solveMount({ point, normal: hit.normal, refQuat, spec: a.spec, box: a.box, scale: a.scale, refState: a.refState, manual: a.manual })
    let point = hit.point, sol = solve(point)
    let probe = verdict === 'ok' ? this._probe(a, sol, point, hit.rootId) : { status: 'reject' }
    if (probe.status === 'overhang') {
      const fit = this._fit(a, sol, point, hit.rootId, probe, solve)
      if (fit) { point = fit.point; sol = fit.sol; probe = fit.probe }
    }
    return { status: probe.status === 'ok' ? 'attach' : probe.status, sol, point, targetId: hit.rootId, proximity: !!hit.proximity }
  }

  _solveFree(a, point, normal) {
    const sol = solveMount({ point, normal, refQuat: new THREE.Quaternion(), spec: a.spec, box: a.box, scale: a.scale, refState: {}, manual: a.manual })
    return { status: 'free', sol, point, targetId: null }
  }

  // Nearest robot surface to a ray that missed every robot: per host, the point
  // of its oriented box closest to the ray (convex in t → ternary search), the
  // box face it lies on, then a ray back onto the REAL mesh there for the true
  // point + normal. Only within SNAP_PX on screen (SNAP_KEEP_PX for the host
  // already snapped to, so the target doesn't flicker). `before` = distance to
  // a non-mountable hit (floor plane) — a surface must be no farther away.
  _nearSurface(a, ray, before = Infinity, excludeId = null) {
    const cam = sceneManager.camera
    if (!cam || !a.hosts?.length) return null
    const B = a.bounds, toPx = (v) => { const p = v.clone().project(cam); return new THREE.Vector2((p.x + 1) / 2 * B.width, (1 - p.y) / 2 * B.height) }
    const tMax = Math.min(400, Number.isFinite(before) ? before + 2 : 400)
    let best = null
    for (const h of a.hosts) {
      if (h.id === excludeId) continue
      const o = ray.origin.clone().applyMatrix4(h.inv)
      const d = ray.origin.clone().add(ray.direction).applyMatrix4(h.inv).sub(o)
      const pAt = (t) => o.clone().addScaledVector(d, t)
      const gapW = (t) => { const p = pAt(t), q = p.clone().clamp(h.box.min, h.box.max); return p.applyMatrix4(h.world).distanceTo(q.applyMatrix4(h.world)) }
      let lo = 0, hi = tMax
      for (let i = 0; i < 48; i++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
        if (gapW(m1) < gapW(m2)) hi = m2; else lo = m1
      }
      const t = (lo + hi) / 2
      const p = pAt(t)
      const q = p.clone().clamp(h.box.min, h.box.max)
      if (p.distanceToSquared(q) < 1e-10) continue        // ray passes through the box but missed the mesh
      const px = toPx(p.clone().applyMatrix4(h.world)).distanceTo(toPx(q.clone().applyMatrix4(h.world)))
      const reach = a.near?.id === h.id ? SNAP_KEEP_PX : SNAP_PX
      if (px > reach || (best && px >= best.px)) continue
      // Which face: the axis the ray point lies furthest outside on (in world units).
      let axis = 0, sign = 1, far = -1
      for (let i = 0; i < 3; i++) {
        const k = 'xyz'[i], out = p[k] < h.box.min[k] ? p[k] - h.box.min[k] : p[k] > h.box.max[k] ? p[k] - h.box.max[k] : 0
        const w = Math.abs(out) * new THREE.Vector3().setComponent(i, 1).applyMatrix3(h.normalMat).length()
        if (out !== 0 && w > far) { far = w; axis = i; sign = Math.sign(out) }
      }
      const nLocal = new THREE.Vector3().setComponent(axis, sign)
      const nWorld = nLocal.clone().applyMatrix3(h.normalMat).normalize()
      const qWorld = q.clone().applyMatrix4(h.world)
      const reachW = a.box.getSize(new THREE.Vector3()).length() + 1
      const rc = new THREE.Raycaster(qWorld.clone().addScaledVector(nWorld, reachW), nWorld.clone().negate(), 0, reachW * 2)
      const hit = raycastFirst(rc, h.meshes)
      if (!hit) continue
      const fn = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
      if (fn.dot(nWorld) < 0) fn.negate()
      best = { px, rootId: h.id, object: hit.object, point: hit.point.clone(), normal: fn, faceNormal: fn.clone(), ray, proximity: true }
    }
    return best
  }

  // Slide an overhanging footprint back onto the face: step away from the
  // probes that found no support, re-resolving the surface point under the
  // footprint centre each time. Bounded to about half the footprint so the
  // part never wanders far from the pointer.
  _fit(a, sol, point, targetId, probe, solve) {
    const maxShift = Math.max(sol.halfForward, sol.halfSide) * a.spec.base * 1.6
    const n = sol.normal
    let p = point.clone(), s = sol, pr = probe
    const target = a.rootInfo.find(r => r.id === targetId)
    if (!target) return null
    let len = Math.max(0.05, Math.max(s.halfForward, s.halfSide) * a.spec.base * 0.3)
    let prev = null
    for (let i = 0; i < FIT_STEPS && pr.status === 'overhang'; i++) {
      if (!pr.away || pr.away.lengthSq() < 1e-8) return null
      const dirAway = pr.away.clone().normalize()
      if (prev && dirAway.dot(prev) < 0) len *= 0.5        // overshot a narrow face → finer steps
      prev = dirAway
      const cand = p.clone().addScaledVector(dirAway, len)
      if (cand.distanceTo(point) > maxShift) return null
      // the surface point under the shifted centre, on the same face
      const rc = new THREE.Raycaster(cand.clone().addScaledVector(n, 0.5), n.clone().negate(), 0, 1)
      const h = raycastFirst(rc, target.meshes)
      if (!h) return null
      const fn = h.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize()
      if (Math.abs(fn.dot(n)) < SUPPORT_NORMAL_DOT) return null
      p = h.point.clone()
      s = solve(p)
      pr = this._probe(a, s, p, targetId)
    }
    return pr.status === 'ok' ? { point: p, sol: s, probe: pr } : null
  }

  // Which scene objects a part may mount on: structure only. Electronics boards,
  // other weapons and parts spinning on a motor shaft are not valid hosts.
  _verdict(rootId) {
    const obj = useSceneStore.getState().objects.find(o => o.id === rootId)
    if (!obj) return 'reject'
    if (obj.type === 'plane') return 'ground'
    if (isWeaponType(obj.type) || objectManager.isElectronicsType(obj.type)) return 'reject'
    if (useElectronicsStore.getState().attachments?.[rootId]) return 'reject'
    return 'ok'
  }

  // Support probes over the part's base footprint (a 3×3 grid). Each ray starts
  // above the surface, clear of the part's height, and looks back down the
  // normal. Every probe must land on the same plane (within a tolerance that
  // allows gently curved hosts); an early hit means something occupies the
  // spot, no/late hit means the base hangs off an edge or over a hole.
  _probe(a, sol, point, targetId) {
    const bF = sol.halfForward * a.spec.base
    const bS = sol.halfSide * a.spec.base
    const lift = sol.height + 0.05
    const tol = Math.max(0.05, 0.15 * Math.max(bF, bS))
    const dir = sol.normal.clone().negate()

    const origins = []
    for (const u of [-1, 0, 1]) for (const w of [-1, 0, 1]) {
      origins.push(point.clone()
        .addScaledVector(sol.forward, u * bF)
        .addScaledVector(sol.side, w * bS)
        .addScaledVector(sol.normal, lift))
    }
    // Only test objects near the footprint column.
    const column = new THREE.Box3().setFromPoints(origins)
    for (const o of origins) column.expandByPoint(o.clone().addScaledVector(dir, lift + tol))
    const meshes = []
    for (const r of a.rootInfo) if (r.box.intersectsBox(column)) meshes.push(...r.meshes)

    const rc = new THREE.Raycaster()
    rc.far = lift + tol
    const away = new THREE.Vector3()      // direction back onto the face (from unsupported probes)
    let overhang = false
    for (let i = 0; i < origins.length; i++) {
      const o = origins[i]
      rc.set(o, dir)
      const hit = raycastFirst(rc, meshes)
      const off = o.clone().addScaledVector(sol.normal, -lift).sub(point)
      let supported = !!hit
      if (hit) {
        if (hit.distance < lift - tol) return { status: 'blocked' }
        const fn = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
        if (fn.dot(dir) > 0) fn.negate()
        if (fn.dot(sol.normal) < SUPPORT_NORMAL_DOT) supported = false
        else {
          const id = objectManager.resolveId(hit.object)
          if (id !== targetId && this._verdict(id) !== 'ok') return { status: 'blocked' }
        }
      }
      if (!supported) { overhang = true; away.sub(off) }
    }
    return overhang ? { status: 'overhang', away } : { status: 'ok' }
  }

  // ── Preview visuals ───────────────────────────────────────────────────────
  _buildGhost() {
    const a = this.active
    if (!a) return
    if (a.ghost) this._disposeGhost(a.ghost)
    const ghost = objectManager.buildMountPreview(a.type)
    if (!ghost) return
    a.box = localPreciseBox(ghost)
    ghost.userData.isMountPreview = true
    ghost.traverse(c => {
      c.raycast = () => {}
      if (!c.isMesh) return
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      c.material = mats.map(m => {
        const g = m.clone()
        g.transparent = true
        g.opacity = 0.6
        g.depthWrite = false
        return g
      })
      if (c.material.length === 1) c.material = c.material[0]
      c.castShadow = false
    })
    ghost.visible = false
    a.ghost = ghost
    a.ghostColor = null
    sceneManager.scene.add(ghost)
  }

  _makeIndicator() {
    const group = new THREE.Group()
    group.userData.isMountPreview = true
    const mat = () => new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false })
    // footprint outline in the (forward, side) plane; scaled per frame
    const loop = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, -1),
        new THREE.Vector3(1, 0, 1), new THREE.Vector3(-1, 0, 1),
      ]),
      mat(),
    )
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.16, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }),
    )
    for (const o of [loop, ring]) { o.renderOrder = 998; o.raycast = () => {}; group.add(o) }
    group.userData.loop = loop
    group.visible = false
    return group
  }

  _render(a, res) {
    const { ghost, indicator } = a
    if (a.realMesh && a.realMesh.visible) a.realMesh.visible = false
    if (!res.sol) {
      if (ghost) ghost.visible = false
      indicator.visible = false
      return
    }
    const { sol } = res
    const color = res.status === 'attach' ? COLOR.attach : res.status === 'free' ? COLOR.free : COLOR.invalid
    if (ghost) {
      ghost.position.copy(sol.position)
      ghost.quaternion.copy(sol.quaternion)
      ghost.scale.set(a.scale.x, a.scale.y, a.scale.z)
      ghost.visible = true
      if (a.ghostColor !== color) {
        a.ghostColor = color
        ghost.traverse(c => {
          if (!c.isMesh) return
          for (const m of Array.isArray(c.material) ? c.material : [c.material]) {
            if (m.emissive) { m.emissive.setHex(color); m.emissiveIntensity = res.status === 'free' ? 0.15 : 0.45 }
          }
        })
      }
    }
    // Footprint: basis (forward → x, normal → y, side → z), just above the surface.
    indicator.position.copy(res.point).addScaledVector(sol.normal, EPS * 4)
    indicator.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sol.forward, sol.normal, sol.side))
    indicator.userData.loop.scale.set(
      Math.max(sol.halfForward * a.spec.base, 0.05), 1, Math.max(sol.halfSide * a.spec.base, 0.05))
    indicator.traverse(c => { if (c.material?.color) c.material.color.setHex(color) })
    indicator.visible = true
  }

  _disposeGhost(ghost) {
    ghost.removeFromParent()
    ghost.traverse(c => {
      if (!c.isMesh) return
      for (const m of Array.isArray(c.material) ? c.material : [c.material]) m?.dispose?.()
    })
  }

  _teardown() {
    const a = this.active
    if (!a) return
    if (a.ghost) this._disposeGhost(a.ghost)
    a.indicator.removeFromParent()
    a.indicator.traverse(c => { c.geometry?.dispose(); c.material?.dispose() })
    if (a.realMesh) a.realMesh.visible = a.realWasVisible
    if (a.gizmoWasVisible !== null && sceneManager.transformControls) sceneManager.transformControls.visible = a.gizmoWasVisible
    this.active = null
    sceneManager.requestRender()
  }

  _notify(status) {
    try { this.onStatus?.(status) } catch (_) { /* UI only */ }
  }

  // ── Commit ────────────────────────────────────────────────────────────────
  _apply(a, res) {
    const scene = useSceneStore.getState()
    const rigid = useRigidStore.getState()
    const { sol } = res
    const e = new THREE.Euler().setFromQuaternion(sol.quaternion)
    const position = xyz(sol.position)
    const rotation = { x: e.x, y: e.y, z: e.z }

    let id = a.objectId
    if (!id) {
      id = scene.addObject(a.type, position).id           // same defaults as a Library click
    } else {
      // Re-mount: the previous attachment is replaced, never duplicated.
      for (const b of rigid.getBonds()) if (b.childId === id) rigid.removeBond(b.id)
    }
    scene.updateObject(id, { position, rotation })
    const mesh = objectManager.getMesh(id)
    if (mesh) {
      mesh.position.copy(sol.position)
      mesh.quaternion.copy(sol.quaternion)
      mesh.updateMatrixWorld(true)
    }

    if (res.status === 'attach') {
      this._bond(res.targetId, id, sol, res.point)
    }
    scene.selectObject(id)
    recordSnapshot(res.status === 'attach' ? 'mount' : 'place')
  }

  _bond(parentId, childId, sol, point) {
    const parent = objectManager.getMesh(parentId)
    if (!parent) return
    parent.updateMatrixWorld(true)
    const e = new THREE.Euler().setFromQuaternion(sol.quaternion)
    const rel = objectManager.computeChildRelativeMatrix(parentId, sol.position, { x: e.x, y: e.y, z: e.z })
    // Contact frame in the PARENT's local space (same convention as patch bonds).
    const inv = parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    const localNormal = sol.normal.clone().applyQuaternion(inv).normalize()
    const localCenter = parent.worldToLocal(point.clone())
    useRigidStore.getState().addBond(parentId, childId, rel, xyz(localNormal), xyz(localCenter), { attach: 'surface' })
  }

  // After a host part is rescaled, its surface-mounted parts would float or sink
  // (the bond scales their offset too). Re-seat them flush on the same contact
  // spot, keeping each part's current roll. Returns true if anything changed.
  reseatMountsOn(parentId) {
    const rigid = useRigidStore.getState()
    const bonds = rigid.getBonds().filter(b =>
      b.parentId === parentId && b.attach === 'surface' && b.contactLocalNormal && b.contactLocalCenter)
    const parent = objectManager.getMesh(parentId)
    if (!bonds.length || !parent) return false
    parent.updateMatrixWorld(true)
    const pq = parent.getWorldQuaternion(new THREE.Quaternion())
    const scene = useSceneStore.getState()
    let changed = false
    for (const b of bonds) {
      const child = scene.objects.find(o => o.id === b.childId)
      const childMesh = objectManager.getMesh(b.childId)
      const spec = child ? mountSpecFor(child.type) : null
      const preview = spec ? objectManager.buildMountPreview(child.type) : null
      if (!childMesh || !preview) continue
      const point = v3(b.contactLocalCenter).applyMatrix4(parent.matrixWorld)
      const normal = v3(b.contactLocalNormal).applyQuaternion(pq).normalize()
      const keepForward = spec.forward.clone().applyQuaternion(childMesh.getWorldQuaternion(new THREE.Quaternion()))
      const box = localPreciseBox(preview)
      const sol = solveMount({ point, normal, refQuat: pq, spec, box, scale: child.scale, keepForward })
      // A part the user turned by hand (tilted off the auto-snap pose) keeps
      // that turn: only its seat is redone, flush on the same contact spot.
      const cur = childMesh.getWorldQuaternion(new THREE.Quaternion())
      if (sol.quaternion.angleTo(cur) > USER_TURN_EPS) seatWithOrientation(sol, cur, point, normal, box, child.scale)
      const e = new THREE.Euler().setFromQuaternion(sol.quaternion)
      const rotation = { x: e.x, y: e.y, z: e.z }
      scene.updateObject(b.childId, { position: xyz(sol.position), rotation })
      childMesh.position.copy(sol.position)
      childMesh.quaternion.copy(sol.quaternion)
      childMesh.updateMatrixWorld(true)
      const rel = objectManager.computeChildRelativeMatrix(parentId, sol.position, rotation)
      if (rel) rigid.updateBond(b.id, { relativeMatrix: rel })
      changed = true
    }
    if (changed) sceneManager.requestRender()
    return changed
  }
}

export const surfaceMountManager = new SurfaceMountManager()
