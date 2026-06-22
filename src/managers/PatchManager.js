import * as THREE from 'three'

const IDLE_COLOR  = 0x00aaff
const SEL_COLOR   = 0xffaa00
const DRAW_COLOR  = 0x00eeff
const HANDLE_R    = 0.07

class PatchManager {
  constructor() {
    this.scene     = null
    this.camera    = null
    this.objectMgr = null
    // patchId → { plane, border, handles[] }
    this._meshes   = new Map()
    // active draw stroke
    this._draw     = null
    // active move/resize drag
    this._interact = null
    // extrude hover preview Group (world-space, not parented to an object)
    this._extrudeHover = null
    // callbacks set by Viewport
    this.onPatchCreated  = null  // (patch) => void
    this.onPatchUpdated  = null  // (id, updates) => void
    this.onPatchSelected = null  // (id) => void
  }

  init(scene, camera, objectMgr) {
    this.scene     = scene
    this.camera    = camera
    this.objectMgr = objectMgr
  }

  get isDrawing()  { return !!this._draw }
  get isDragging() { return !!this._interact }

  // ── Draw new patch by holding + dragging ────────────────────────────────

  startDraw(event, bounds) {
    const hit = this._raycastScene(event, bounds)
    if (!hit) return false

    const { objectId, point, faceNormal } = hit

    // Build orthonormal frame on the surface
    const up = Math.abs(faceNormal.y) < 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0)
    const tangent   = up.clone().cross(faceNormal).normalize()
    const bitangent = new THREE.Vector3().crossVectors(faceNormal, tangent).normalize()

    const projPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(faceNormal, point)
    const preview   = new THREE.Group()
    preview.userData.isPatchMesh = true
    this.scene.add(preview)

    this._draw = { objectId, projPlane, faceNormal, tangent, bitangent, startWorld: point.clone(), preview }
    return true
  }

  updateDraw(event, bounds) {
    if (!this._draw) return
    const cur = this._project(event, bounds, this._draw.projPlane)
    if (cur) this._refreshPreview(cur)
  }

  endDraw(event, bounds) {
    if (!this._draw) return null
    const cur   = this._project(event, bounds, this._draw.projPlane)
    const patch = cur ? this._buildPatch(cur) : null
    this._clearDraw()
    return patch
  }

  cancelDraw() { this._clearDraw() }

  // ── Click a face → auto-detect the entire face extent and highlight it ──
  buildFacePatch(event, bounds) {
    const info = this._detectFace(event, bounds)
    if (!info) return null
    const { objectId, faceNormal, faceTangent, faceBitangent, faceCenterWorld, faceWidth, faceHeight } = info

    const om = this.objectMgr.getMesh(objectId)
    if (!om) return null
    om.updateMatrixWorld(true)

    const invM = new THREE.Matrix4().copy(om.matrixWorld).invert()
    const wq   = new THREE.Quaternion(); om.getWorldQuaternion(wq)
    const invQ = wq.clone().invert()

    const localCenter  = faceCenterWorld.clone().applyMatrix4(invM)
    const localNormal  = faceNormal.clone().applyQuaternion(invQ).normalize()
    const localTangent = faceTangent.clone().applyQuaternion(invQ).normalize()

    return {
      id: crypto.randomUUID(),
      objectId,
      localCenter:  { x: localCenter.x,  y: localCenter.y,  z: localCenter.z  },
      localNormal:  { x: localNormal.x,  y: localNormal.y,  z: localNormal.z  },
      localTangent: { x: localTangent.x, y: localTangent.y, z: localTangent.z },
      width:  Math.max(faceWidth, 0.05),
      height: Math.max(faceHeight, 0.05),
    }
  }

  // ── Extrude tool: returns world-space face data for the clicked face ──────
  getFaceInfo(event, bounds) {
    return this._detectFace(event, bounds)
  }

  // Show a teal highlight over the face under the cursor (extrude hover preview)
  showExtrudeHover(event, bounds) {
    const info = this._detectFace(event, bounds)
    if (!info) { this.clearExtrudeHover(); return }
    const { faceNormal, faceTangent, faceBitangent, faceCenterWorld, faceWidth, faceHeight } = info

    this.clearExtrudeHover()

    const rotM = new THREE.Matrix4().makeBasis(faceTangent, faceBitangent, faceNormal)
    const q    = new THREE.Quaternion().setFromRotationMatrix(rotM)
    const pos  = faceCenterWorld.clone().addScaledVector(faceNormal, 0.005)

    const geo  = new THREE.PlaneGeometry(faceWidth, faceHeight)
    const mesh = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: false }))
    mesh.position.copy(pos); mesh.quaternion.copy(q)
    mesh.userData.isPatchMesh = true

    const bdr = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: false }))
    bdr.position.copy(pos); bdr.quaternion.copy(q)
    bdr.userData.isPatchMesh = true

    const g = new THREE.Group()
    g.userData.isPatchMesh = true
    g.add(mesh, bdr)
    this.scene.add(g)
    this._extrudeHover = g
  }

  clearExtrudeHover() {
    if (!this._extrudeHover) return
    this._extrudeHover.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose() })
    this.scene.remove(this._extrudeHover)
    this._extrudeHover = null
  }

  // ── Interact: move or resize an existing patch ──────────────────────────

  startInteract(event, bounds, patchId, type, handleIdx, patch) {
    const dragPlane = this._dragPlane(patch)
    const cur = this._project(event, bounds, dragPlane)
    if (!cur) return false
    this._interact = { patchId, type, handleIdx, dragPlane, prevWorld: cur, patch: { ...patch } }
    return true
  }

  updateInteract(event, bounds) {
    if (!this._interact) return null
    const { patchId, type, handleIdx, dragPlane, prevWorld, patch } = this._interact
    const cur = this._project(event, bounds, dragPlane)
    if (!cur) return null

    const delta = cur.clone().sub(prevWorld)
    this._interact.prevWorld = cur

    const om = this.objectMgr.getMesh(patch.objectId)
    if (!om) return null
    om.updateMatrixWorld(true)

    const wq    = new THREE.Quaternion(); om.getWorldQuaternion(wq)
    const invQ  = wq.clone().invert()
    const invM  = new THREE.Matrix4().copy(om.matrixWorld).invert()

    if (type === 'move') {
      const worldCtr = new THREE.Vector3(patch.localCenter.x, patch.localCenter.y, patch.localCenter.z)
        .applyMatrix4(om.matrixWorld).add(delta)
      const newLc   = worldCtr.applyMatrix4(invM)
      const updates = { localCenter: { x: newLc.x, y: newLc.y, z: newLc.z } }
      this._interact.patch = { ...patch, ...updates }
      return { id: patchId, updates }
    }

    if (type === 'resize') {
      const lt = new THREE.Vector3(patch.localTangent.x, patch.localTangent.y, patch.localTangent.z).normalize()
      const ln = new THREE.Vector3(patch.localNormal.x,  patch.localNormal.y,  patch.localNormal.z).normalize()
      const lb = new THREE.Vector3().crossVectors(ln, lt).normalize()

      const ld = delta.clone().applyQuaternion(invQ)
      const du = ld.dot(lt)
      const dv = ld.dot(lb)
      // corner sign map: [−−, +−, ++, −+]
      const signs = [[-1,-1],[1,-1],[1,1],[-1,1]]
      const [su, sv] = signs[handleIdx]

      const updates = {
        width:  Math.max(0.1, patch.width  + su * du * 2),
        height: Math.max(0.1, patch.height + sv * dv * 2),
      }
      this._interact.patch = { ...patch, ...updates }
      return { id: patchId, updates }
    }

    return null
  }

  endInteract() { this._interact = null }

  // ── Pick a patch plane or handle at a mouse position ────────────────────

  // Returns { patchId, type: 'plane'|'handle', handleIdx? } or null
  pick(event, bounds) {
    const rc      = this._rc(event, bounds)
    const targets = []
    for (const [patchId, m] of this._meshes) {
      targets.push({ mesh: m.plane, patchId, type: 'plane' })
      m.handles.forEach((h, i) => targets.push({ mesh: h, patchId, type: 'handle', handleIdx: i }))
    }
    const hits = rc.intersectObjects(targets.map(t => t.mesh), false)
    if (!hits.length) return null
    return targets.find(t => t.mesh === hits[0].object) ?? null
  }

  // ── Sync patches store → Three.js objects ──────────────────────────────

  sync(patches, selectedIds) {
    const selSet = new Set(selectedIds)
    for (const id of [...this._meshes.keys()]) {
      if (!patches[id]) this._remove(id)
    }
    for (const patch of Object.values(patches)) {
      const sel = selSet.has(patch.id)
      if (this._meshes.has(patch.id)) this._update(patch, sel)
      else this._add(patch, sel)
    }
  }

  setVisible(visible) {
    for (const m of this._meshes.values()) {
      if (m.plane)  m.plane.visible  = visible
      if (m.border) m.border.visible = visible
      m.handles?.forEach(h => { h.visible = visible })
    }
  }

  dispose() {
    this._clearDraw()
    this.clearExtrudeHover()
    for (const id of [...this._meshes.keys()]) this._remove(id)
  }

  // ── Private ─────────────────────────────────────────────────────────────

  _add(patch, sel) {
    const m = this._buildMeshes(patch, sel)
    if (m) this._meshes.set(patch.id, m)
  }

  _update(patch, sel) { this._remove(patch.id); this._add(patch, sel) }

  _remove(id) {
    const m = this._meshes.get(id)
    if (!m) return
    const drop = o => { o.removeFromParent(); o.geometry?.dispose(); o.material?.dispose() }
    drop(m.plane); drop(m.border); m.handles.forEach(drop)
    this._meshes.delete(id)
  }

  _buildMeshes(patch, sel) {
    const om = this.objectMgr.getMesh(patch.objectId)
    if (!om) return null

    om.updateMatrixWorld(true)

    const lc = new THREE.Vector3(patch.localCenter.x, patch.localCenter.y, patch.localCenter.z)
    const ln = new THREE.Vector3(patch.localNormal.x,  patch.localNormal.y,  patch.localNormal.z).normalize()
    const lt = new THREE.Vector3(patch.localTangent.x, patch.localTangent.y, patch.localTangent.z).normalize()
    const lb = new THREE.Vector3().crossVectors(ln, lt).normalize()

    // Convert world-space W/H → local-space geometry size so that the patch
    // looks the same world size regardless of parent object scale.
    const ws     = new THREE.Vector3(); om.getWorldScale(ws)
    const tScale = new THREE.Vector3(lt.x * ws.x, lt.y * ws.y, lt.z * ws.z).length() || 1
    const bScale = new THREE.Vector3(lb.x * ws.x, lb.y * ws.y, lb.z * ws.z).length() || 1
    const localW = patch.width  / tScale
    const localH = patch.height / bScale

    // Small offset along normal to avoid z-fighting
    const pos  = lc.clone().addScaledVector(ln, 0.005)
    const rotM = new THREE.Matrix4().makeBasis(lt, lb, ln)
    const q    = new THREE.Quaternion().setFromRotationMatrix(rotM)

    const color   = sel ? SEL_COLOR  : IDLE_COLOR
    const opacity = sel ? 0.55 : 0.30
    const bcolor  = sel ? 0xff7700 : 0x0099ff

    const geo   = new THREE.PlaneGeometry(localW, localH)
    const plane = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false }))
    plane.position.copy(pos); plane.quaternion.copy(q)
    plane.userData.isPatchMesh = true; plane.userData.patchId = patch.id

    const border = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: bcolor, depthTest: false }))
    border.position.copy(pos); border.quaternion.copy(q)
    border.userData.isPatchMesh = true

    const hw = localW / 2, hh = localH / 2
    const cornerOffsets = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]
    const handles = cornerOffsets.map(([cu, cv], i) => {
      const h = new THREE.Mesh(
        new THREE.SphereGeometry(HANDLE_R, 8, 8),
        new THREE.MeshBasicMaterial({ color: sel ? 0xffaa00 : 0x44aaff, depthTest: false }))
      h.position.copy(pos).addScaledVector(lt, cu).addScaledVector(lb, cv)
      h.userData.isPatchMesh = true
      h.userData.patchId     = patch.id
      h.userData.isHandle    = true
      h.userData.handleIdx   = i
      om.add(h)
      return h
    })

    om.add(plane); om.add(border)
    return { plane, border, handles }
  }

  // Preview mesh shown while drawing (world-space Group, not parented to object)
  _refreshPreview(curWorld) {
    const d = this._draw; if (!d) return
    const g = d.preview
    while (g.children.length) {
      const c = g.children[0]; g.remove(c); c.geometry?.dispose(); c.material?.dispose()
    }
    const delta = curWorld.clone().sub(d.startWorld)
    const u = delta.dot(d.tangent), v = delta.dot(d.bitangent)
    const w = Math.max(Math.abs(u), 0.01), h = Math.max(Math.abs(v), 0.01)
    const ctr = d.startWorld.clone()
      .addScaledVector(d.tangent, u / 2).addScaledVector(d.bitangent, v / 2)
      .addScaledVector(d.faceNormal, 0.008)

    const rotM = new THREE.Matrix4().makeBasis(d.tangent, d.bitangent, d.faceNormal)
    const q    = new THREE.Quaternion().setFromRotationMatrix(rotM)
    const geo  = new THREE.PlaneGeometry(w, h)

    const plane = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ color: DRAW_COLOR, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false }))
    plane.position.copy(ctr); plane.quaternion.copy(q)

    const bdr = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: DRAW_COLOR, depthTest: false }))
    bdr.position.copy(ctr); bdr.quaternion.copy(q)

    g.add(plane); g.add(bdr)
  }

  _buildPatch(curWorld) {
    const d = this._draw; if (!d) return null
    const { objectId, faceNormal, tangent, bitangent, startWorld } = d
    const delta = curWorld.clone().sub(startWorld)
    const u = delta.dot(tangent), v = delta.dot(bitangent)
    if (Math.abs(u) < 0.05 && Math.abs(v) < 0.05) return null

    const w   = Math.max(Math.abs(u), 0.1)
    const h   = Math.max(Math.abs(v), 0.1)
    const ctr = startWorld.clone()
      .addScaledVector(tangent, u / 2).addScaledVector(bitangent, v / 2)

    const om = this.objectMgr.getMesh(objectId)
    if (!om) return null
    om.updateMatrixWorld(true)

    const invM = new THREE.Matrix4().copy(om.matrixWorld).invert()
    const wq   = new THREE.Quaternion(); om.getWorldQuaternion(wq)
    const invQ = wq.clone().invert()

    const localCenter  = ctr.clone().applyMatrix4(invM)
    const localNormal  = faceNormal.clone().applyQuaternion(invQ)
    const localTangent = tangent.clone().applyQuaternion(invQ)

    return {
      id: crypto.randomUUID(),
      objectId,
      localCenter:  { x: localCenter.x,  y: localCenter.y,  z: localCenter.z  },
      localNormal:  { x: localNormal.x,  y: localNormal.y,  z: localNormal.z  },
      localTangent: { x: localTangent.x, y: localTangent.y, z: localTangent.z },
      // Store world-space dimensions so patches on differently-scaled objects
      // show the same number when they look the same size on screen.
      width:  w,
      height: h,
    }
  }

  _clearDraw() {
    if (!this._draw) return
    const g = this._draw.preview
    g?.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose() })
    if (g) this.scene?.remove(g)
    this._draw = null
  }

  _dragPlane(patch) {
    const om = this.objectMgr.getMesh(patch.objectId)
    if (!om) return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    om.updateMatrixWorld(true)
    const wq = new THREE.Quaternion(); om.getWorldQuaternion(wq)
    const wn = new THREE.Vector3(patch.localNormal.x, patch.localNormal.y, patch.localNormal.z)
      .applyQuaternion(wq).normalize()
    const wc = new THREE.Vector3(patch.localCenter.x, patch.localCenter.y, patch.localCenter.z)
      .applyMatrix4(om.matrixWorld)
    return new THREE.Plane().setFromNormalAndCoplanarPoint(wn, wc)
  }

  // ── Core face detection: returns world-space face geometry data ──────────
  // Shared by buildFacePatch (patch creation) and getFaceInfo (extrude tool).
  _detectFace(event, bounds) {
    const hit = this._raycastScene(event, bounds)
    if (!hit) return null
    const { objectId, point, faceNormal } = hit

    const om = this.objectMgr.getMesh(objectId)
    if (!om) return null
    om.updateMatrixWorld(true)

    const up        = Math.abs(faceNormal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const tangent   = up.clone().cross(faceNormal).normalize()
    const bitangent = new THREE.Vector3().crossVectors(faceNormal, tangent).normalize()

    const DOT_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(20))
    const coplanarVerts = []

    om.traverse(child => {
      if (!child.isMesh || !child.geometry) return
      if (child.userData.isPatchMesh || child.userData.isPinSphere || child.userData.isAttachMarker) return
      child.updateMatrixWorld(true)
      const pos = child.geometry.attributes.position
      const idx = child.geometry.index
      const getV = i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld)
      const count = idx ? idx.count : pos.count
      for (let i = 0; i < count; i += 3) {
        const a = idx ? idx.getX(i) : i
        const b = idx ? idx.getX(i + 1) : i + 1
        const c = idx ? idx.getX(i + 2) : i + 2
        const v0 = getV(a), v1 = getV(b), v2 = getV(c)
        const triN = new THREE.Vector3()
          .crossVectors(v1.clone().sub(v0), v2.clone().sub(v0)).normalize()
        if (triN.dot(faceNormal) >= DOT_THRESHOLD) coplanarVerts.push(v0, v1, v2)
      }
    })

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    const d = point.dot(faceNormal)
    for (const v of coplanarVerts) {
      const u = v.dot(tangent), vv = v.dot(bitangent)
      if (u  < minU) minU = u; if (u  > maxU) maxU = u
      if (vv < minV) minV = vv; if (vv > maxV) maxV = vv
    }
    const w = (coplanarVerts.length > 0 && isFinite(minU)) ? maxU - minU : 1.2
    const h = (coplanarVerts.length > 0 && isFinite(minV)) ? maxV - minV : 1.2
    const faceCenterWorld = new THREE.Vector3()
      .addScaledVector(tangent,    (minU + maxU) / 2)
      .addScaledVector(bitangent,  (minV + maxV) / 2)
      .addScaledVector(faceNormal, d)

    return {
      objectId,
      faceNormal:    faceNormal.clone(),
      faceTangent:   tangent.clone(),
      faceBitangent: bitangent.clone(),
      faceCenterWorld,
      faceWidth:  Math.max(w, 0.05),
      faceHeight: Math.max(h, 0.05),
    }
  }

  _raycastScene(event, bounds) {
    const rc = this._rc(event, bounds)
    const candidates = []
    for (const m of (this.objectMgr?.getAllMeshes() ?? [])) {
      m.traverse(c => {
        if (c.isMesh && !c.userData.isPatchMesh && !c.userData.isPinSphere && !c.userData.isAttachMarker)
          candidates.push(c)
      })
    }
    const hits = rc.intersectObjects(candidates, false)
    if (!hits.length || !hits[0].face) return null
    const hit    = hits[0]
    const rootId = hit.object.userData.rootId || hit.object.userData.id
    if (!rootId) return null
    const om = this.objectMgr?.getMesh(rootId)
    if (!om) return null
    const nm         = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
    const faceNormal = hit.face.normal.clone().applyMatrix3(nm).normalize()
    return { objectId: rootId, point: hit.point.clone(), faceNormal }
  }

  _project(event, bounds, plane) {
    const r = this._rc(event, bounds)
    const t = new THREE.Vector3()
    return r.ray.intersectPlane(plane, t) ? t : null
  }

  _rc(event, bounds) {
    const r = new THREE.Raycaster()
    r.setFromCamera(new THREE.Vector2(
      ((event.clientX - bounds.left)  / bounds.width)  * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    ), this.camera)
    return r
  }
}

export const patchManager = new PatchManager()
