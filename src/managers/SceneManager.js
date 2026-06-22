import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { objectManager } from './ObjectManager.js'
import { wireManager } from './WireManager.js'

class SceneManager {
  constructor() {
    this.scene = null
    this.renderer = null
    this.camera = null
    this.orbitControls = null
    this.transformControls = null
    this.grid = null
    this.axes = null
    this.animationId = null
    this.onTransformChange = null
    this.onDraggingChanged = null
  }

  init(canvas, width, height) {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xffffff)
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.008)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 10000)
    this.camera.position.set(12, 10, 12)
    this.camera.lookAt(0, 0, 0)

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    this.scene.add(ambient)

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.0)
    sun.position.set(15, 25, 15)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 0.1
    sun.shadow.camera.far = 200
    sun.shadow.camera.left = -30
    sun.shadow.camera.right = 30
    sun.shadow.camera.top = 30
    sun.shadow.camera.bottom = -30
    this.scene.add(sun)

    const fill = new THREE.DirectionalLight(0x8090cc, 0.4)
    fill.position.set(-10, 5, -15)
    this.scene.add(fill)

    // Grid
    this.grid = new THREE.GridHelper(60, 60, 0xaaaaaa, 0xcccccc)
    this.grid.position.y = 0
    this.scene.add(this.grid)

    // Axes
    this.axes = new THREE.AxesHelper(6)
    this.scene.add(this.axes)

    // OrbitControls
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.06
    this.orbitControls.minDistance = 0.5
    this.orbitControls.maxDistance = 500

    // TransformControls — smaller, elegant gizmo
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
    this.transformControls.size = 0.25
    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.orbitControls.enabled = !e.value
      if (this.onDraggingChanged) this.onDraggingChanged(e.value)
    })
    this.transformControls.addEventListener('objectChange', () => {
      if (this.onTransformChange) this.onTransformChange()
    })
    this.scene.add(this.transformControls)

    objectManager.init(this.scene)
    wireManager.init(this.scene, this.camera)
    this._startLoop()
    return this
  }

  // Injected by App so the loop can drive motor animation without a circular import
  onAnimationTick = null

  _startLoop() {
    const tick = () => {
      this.animationId = requestAnimationFrame(tick)
      this.orbitControls?.update()
      this._updateGizmoScale()
      try { wireManager.update() } catch (_) { /* never block motor tick */ }
      try { objectManager.updateWires() } catch (_) { /* never block motor tick */ }
      try { if (this.onAnimationTick) this.onAnimationTick() } catch (e) { console.error('[tick]', e) }
      this.renderer.render(this.scene, this.camera)
    }
    tick()
  }

  // Keep the transform gizmo a constant apparent screen size by scaling with
  // the camera-to-object distance. Without this, arrows look huge when zoomed
  // in and tiny when zoomed out.
  _updateGizmoScale() {
    const tc = this.transformControls
    if (!tc?.object) return
    const dist = this.camera.position.distanceTo(tc.object.position)
    // ~14% of the distance gives a compact, professional-looking gizmo.
    // Clamp so it never becomes invisible or overwhelmingly large.
    tc.size = Math.max(0.15, Math.min(0.6, dist * 0.07))
  }

  stopLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  resize(width, height) {
    if (!this.camera || !this.renderer) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  attachTransformTo(mesh) {
    if (mesh) this.transformControls.attach(mesh)
    else this.transformControls.detach()
  }

  detachTransform() {
    this.transformControls.detach()
  }

  setTransformMode(mode) {
    if (this.transformControls) this.transformControls.setMode(mode)
  }

  setGridVisible(v) { if (this.grid) this.grid.visible = v }
  setAxesVisible(v) { if (this.axes) this.axes.visible = v }

  resetCamera() {
    this.camera.position.set(12, 10, 12)
    this.orbitControls.target.set(0, 0, 0)
    this.orbitControls.update()
  }

  // Snap the camera to a standard orthographic-style view, preserving the
  // current target and zoom distance.
  setView(name) {
    if (!this.camera || !this.orbitControls) return
    const target = this.orbitControls.target
    const dist = this.camera.position.distanceTo(target) || 20

    // Unit direction FROM target TO camera for each named view
    const dirs = {
      top:    [0,  1,  0],
      bottom: [0, -1,  0],
      front:  [0,  0,  1],
      back:   [0,  0, -1],
      right:  [1,  0,  0],
      left:   [-1, 0,  0],
      home:   [0.62, 0.52, 0.62],   // iso 3/4 view
    }
    const d = dirs[name] ?? dirs.home
    const len = Math.hypot(d[0], d[1], d[2])
    this.camera.position.set(
      target.x + (d[0] / len) * dist,
      target.y + (d[1] / len) * dist,
      target.z + (d[2] / len) * dist,
    )
    // Looking straight down/up needs an explicit up vector to avoid gimbal flip
    this.camera.up.set(0, 1, 0)
    if (name === 'top')    this.camera.up.set(0, 0, -1)
    if (name === 'bottom') this.camera.up.set(0, 0,  1)
    this.camera.lookAt(target)
    this.orbitControls.update()
  }

  // Name of the view the camera is currently closest to, or 'Perspective'.
  getViewLabel() {
    if (!this.camera || !this.orbitControls) return 'Perspective'
    const dir = this.camera.position.clone().sub(this.orbitControls.target).normalize()
    const axes = [
      ['Top',    new THREE.Vector3(0,  1,  0)],
      ['Bottom', new THREE.Vector3(0, -1,  0)],
      ['Front',  new THREE.Vector3(0,  0,  1)],
      ['Back',   new THREE.Vector3(0,  0, -1)],
      ['Right',  new THREE.Vector3(1,  0,  0)],
      ['Left',   new THREE.Vector3(-1, 0,  0)],
    ]
    for (const [label, v] of axes) {
      if (dir.dot(v) > 0.998) return label   // within ~3.6° of a pure axis
    }
    return 'Perspective'
  }

  fitToView(objectId) {
    const mesh = objectManager.getMesh(objectId)
    if (!mesh) return
    const box = new THREE.Box3().setFromObject(mesh)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const dist = Math.max(size.x, size.y, size.z) * 2.5
    const dir = this.camera.position.clone().sub(this.orbitControls.target).normalize()
    this.camera.position.copy(center).addScaledVector(dir, dist)
    this.orbitControls.target.copy(center)
    this.orbitControls.update()
  }

  pickObject(event, canvasBounds) {
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2(
      ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
      -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1
    )
    raycaster.setFromCamera(mouse, this.camera)
    // recursive=true so Group children are tested; skip wire lines and patch meshes
    const allObjects = objectManager.getAllMeshes().filter(o => !o.userData.isWire)
    const hits = raycaster.intersectObjects(allObjects, true)
      .filter(h => !h.object.userData.isPatchMesh)
    if (hits.length === 0) return null

    // Prefer non-plane hits — a plane is almost always a floor/surface, and objects
    // placed on it should be selectable even when their bases touch the plane.
    const resolve = (hit) => {
      const id = objectManager.resolveId(hit.object)
      return id ? objectManager.getMesh(id) : hit.object
    }
    for (const hit of hits) {
      const root = resolve(hit)
      if (root?.userData.type !== 'plane') return root
    }
    return resolve(hits[0])
  }

  // Raycast against one specific object and return the hit point AND face normal
  // both expressed in that object's local space. Returns null on miss.
  pickSurfacePoint(event, canvasBounds, targetMesh) {
    if (!targetMesh || !this.camera) return null
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2(
      ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
      -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1
    )
    raycaster.setFromCamera(mouse, this.camera)

    const candidates = []
    targetMesh.traverse(c => {
      if (c.isMesh && !c.userData.isPinSphere && !c.userData.isPinLabel && !c.userData.isAttachMarker)
        candidates.push(c)
    })
    const hits = raycaster.intersectObjects(candidates, false)
    if (!hits.length) return null

    const hit = hits[0]

    // Hit point in targetMesh local space
    const localPoint = targetMesh.worldToLocal(hit.point.clone())

    // Face normal: hit.face.normal is in the sub-mesh geometry's local space.
    // Transform → world → targetMesh local so it's expressed relative to the root.
    let localNormal = null
    if (hit.face && hit.object.isMesh) {
      const n = hit.face.normal.clone().normalize()
      // to world space via the sub-mesh's normal matrix
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
      n.applyMatrix3(normalMatrix).normalize()
      // to targetMesh local space
      const tq = new THREE.Quaternion()
      targetMesh.getWorldQuaternion(tq)
      n.applyQuaternion(tq.invert())
      localNormal = n
    }

    return { point: localPoint, normal: localNormal }
  }

  // Raycast and classify the clicked spot as a corner / edge / face of the hit
  // object (Fusion-style joint origin). Returns world-space feature info or null.
  pickFeature(event, canvasBounds) {
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2(
      ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
      -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1
    )
    raycaster.setFromCamera(mouse, this.camera)
    const allObjects = objectManager.getAllMeshes().filter(o => !o.userData.isWire && !o.userData.isJointHelper)
    const hits = raycaster.intersectObjects(allObjects, true)
      .filter(h => !h.object.userData.isPatchMesh && !h.object.userData.isPinSphere && !h.object.userData.isAttachMarker)
    if (!hits.length) return null

    const hit = hits[0]
    const objectId = objectManager.resolveId(hit.object)
    if (!objectId) return null
    const rootMesh = objectManager.getMesh(objectId)
    if (!rootMesh) return null

    // Local-space extents of the hit sub-mesh (fall back to whole-object box)
    const subMesh = hit.object.isMesh ? hit.object : rootMesh
    let geom = subMesh.geometry
    if (geom && !geom.boundingBox) geom.computeBoundingBox()

    // Hit point in the sub-mesh's local space
    const local = subMesh.worldToLocal(hit.point.clone())

    let min, max
    if (geom?.boundingBox) {
      min = geom.boundingBox.min; max = geom.boundingBox.max
    } else {
      const b = new THREE.Box3().setFromObject(subMesh)
      const c = subMesh.worldToLocal(b.getCenter(new THREE.Vector3()))
      const s = b.getSize(new THREE.Vector3())
      min = new THREE.Vector3(c.x - s.x / 2, c.y - s.y / 2, c.z - s.z / 2)
      max = new THREE.Vector3(c.x + s.x / 2, c.y + s.y / 2, c.z + s.z / 2)
    }

    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5)
    const ext = new THREE.Vector3((max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2)

    // For each axis decide if the click sits near that face (within ~30% of the half-extent)
    const axes = ['x', 'y', 'z']
    const rel = new THREE.Vector3().subVectors(local, center)
    const atExtent = {}, sign = {}
    for (const a of axes) {
      const e = ext[a] || 0.0001
      const tol = Math.max(0.18, e * 0.32)
      atExtent[a] = (e - Math.abs(rel[a])) < tol
      sign[a] = rel[a] >= 0 ? 1 : -1
    }
    const hotAxes = axes.filter(a => atExtent[a])

    // Build the snapped feature point in local space + a direction
    const featLocal = center.clone()
    let kind, dirLocal = null
    if (hotAxes.length >= 3) {
      kind = 'corner'
      for (const a of axes) featLocal[a] = center[a] + sign[a] * ext[a]
    } else if (hotAxes.length === 2) {
      kind = 'edge'
      for (const a of hotAxes) featLocal[a] = center[a] + sign[a] * ext[a]
      const freeAxis = axes.find(a => !atExtent[a])
      dirLocal = new THREE.Vector3(freeAxis === 'x' ? 1 : 0, freeAxis === 'y' ? 1 : 0, freeAxis === 'z' ? 1 : 0)
    } else {
      kind = 'face'
      const faceAxis = hotAxes[0] ?? 'y'
      featLocal[faceAxis] = center[faceAxis] + sign[faceAxis] * ext[faceAxis]
      dirLocal = new THREE.Vector3(faceAxis === 'x' ? sign.x : 0, faceAxis === 'y' ? sign.y : 0, faceAxis === 'z' ? sign.z : 0)
    }

    // To world space
    const worldPoint = subMesh.localToWorld(featLocal.clone())
    let worldDir = null
    if (dirLocal) {
      const q = new THREE.Quaternion()
      subMesh.getWorldQuaternion(q)
      worldDir = dirLocal.clone().applyQuaternion(q).normalize()
    }

    return {
      objectId,
      kind,                                                    // 'corner' | 'edge' | 'face'
      point:  { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
      dir:    worldDir ? { x: worldDir.x, y: worldDir.y, z: worldDir.z } : null,
    }
  }

  dispose() {
    this.stopLoop()
    this.orbitControls?.dispose()
    this.transformControls?.dispose()
    this.renderer?.dispose()
    objectManager.clearAll()
  }
}

export const sceneManager = new SceneManager()
