// Tinkercad-style handles on the selected part (transformMode === 'handles'):
//
//   white squares  — 4 bottom corners resize width + depth (Shift = keep
//                    proportions), 4 bottom edge-middles resize one side,
//                    the top square resizes height. The opposite side stays put.
//   black cone     — lift the part up / down.
//   curved arrows  — turn it about its own X / Y / Z axis (snaps to the turn-snap
//                    step, else 22.5°; Shift = free).
//
// Everything works in the part's own rotated frame, so a turned part still
// resizes along its own sides. Sizes snap to the move-snap step. One undo step
// per drag. Wired parts (boards, sensors, motors…) can be lifted and turned but
// not resized, exactly like the scale gizmo.
import * as THREE from 'three'
import { create } from 'zustand'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { sceneManager } from './SceneManager.js'
import { objectManager } from './ObjectManager.js'
import { recordSnapshot } from './history/editorDispatch.js'
import { isNonPhysical } from './physics/robotics/sceneGraph.js'
import { PIN_DEFS } from '../utils/electronicsFactory.js'

/** Live read-out while a handle is dragged (shown in the 3D view's toast). */
export const useHandleDrag = create(() => ({ label: null }))

const WHITE = 0xffffff, ORANGE = 0xf97316, INK = 0x1f2937
const noResize = (o) => !!PIN_DEFS[o.type] || ['subo', 'esp32', 'wheel', 'caster'].includes(o.type) || o.type.startsWith('weapon_')

function mat(color) {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 1 })
}

class HandlesManager {
  constructor() {
    this.group = null
    this.targetId = null
    this.handles = []          // meshes with userData.handle = { kind, ... }
    this.hover = null
    this.drag = null
    this._ray = new THREE.Raycaster()
  }

  init() {
    if (this.group || !sceneManager.scene) return
    this.group = new THREE.Group()
    this.group.name = 'tinkercad-handles'
    this.group.userData.isHelper = true
    this.group.visible = false
    sceneManager.scene.add(this.group)
    sceneManager.orbitControls?.addEventListener('change', () => this._layout())
    useSceneStore.subscribe((s, prev) => { if (s.objects !== prev.objects && this.targetId && !this.drag) this._layout() })
  }

  dispose() {
    if (!this.group) return
    this.group.removeFromParent()
    this.group.traverse((n) => { n.geometry?.dispose?.(); n.material?.dispose?.() })
    this.group = null; this.handles = []; this.targetId = null
  }

  /** Show handles on one part (or none). */
  setTarget(id) {
    if (!this.group) this.init()
    if (!this.group) return
    if (id === this.targetId && this.handles.length) { this._layout(); return }
    this.targetId = id
    this._build()
    this._layout()
  }

  get active() { return !!this.drag }

  // ── Build the handle meshes (sizes are unit; _layout scales them) ──────────
  _build() {
    for (const h of this.handles) { h.removeFromParent(); h.geometry.dispose(); h.material.dispose() }
    this.handles = []
    const obj = this._obj()
    if (!obj) { this.group.visible = false; return }
    const add = (geo, color, handle) => {
      const m = new THREE.Mesh(geo, mat(color))
      m.renderOrder = 1000
      m.userData.handle = handle
      m.userData.baseColor = color
      this.group.add(m); this.handles.push(m)
      return m
    }
    const square = () => new THREE.BoxGeometry(1, 1, 1)
    if (!noResize(obj)) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const h = add(square(), WHITE, { kind: 'corner', sx, sz })
        h.add(new THREE.LineSegments(new THREE.EdgesGeometry(h.geometry), new THREE.LineBasicMaterial({ color: INK, depthTest: false })))
      }
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const h = add(square(), WHITE, { kind: 'side', sx, sz })
        h.add(new THREE.LineSegments(new THREE.EdgesGeometry(h.geometry), new THREE.LineBasicMaterial({ color: INK, depthTest: false })))
      }
      const top = add(square(), WHITE, { kind: 'top' })
      top.add(new THREE.LineSegments(new THREE.EdgesGeometry(top.geometry), new THREE.LineBasicMaterial({ color: INK, depthTest: false })))
    }
    const cone = new THREE.ConeGeometry(0.5, 1.2, 20)
    add(cone, INK, { kind: 'lift' })
    // Curved double arrows around the part, one per axis: an arc (re-shaped in
    // _layout to hug the part and face the camera) with a cone at each end.
    for (const axis of ['y', 'x', 'z']) {
      const g = new THREE.Group()
      const arc = new THREE.Mesh(new THREE.BufferGeometry(), mat(INK))
      const tipA = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 12), mat(INK))
      const tipB = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 12), mat(INK))
      for (const p of [arc, tipA, tipB]) { p.renderOrder = 1000; p.userData.handle = { kind: 'rotate', axis }; p.userData.baseColor = INK; g.add(p); this.handles.push(p) }
      g.userData.rotateAxis = axis
      g.userData.parts = { arc, tipA, tipB }
      this.group.add(g)
    }
  }

  _obj() { return this.targetId ? useSceneStore.getState().objects.find((o) => o.id === this.targetId) : null }

  // The part's frame without scale (position + rotation) and its box in that frame.
  _frame() {
    const mesh = objectManager.getMesh(this.targetId)
    if (!mesh) return null
    mesh.updateMatrixWorld(true)
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3()
    mesh.matrixWorld.decompose(pos, quat, scl)
    const R = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1))
    const Rinv = R.clone().invert()
    const box = new THREE.Box3(), m = new THREE.Matrix4(), v = new THREE.Vector3()
    const shown = (n) => { for (let p = n; p && p !== mesh.parent; p = p.parent) if (!p.visible) return false; return true }
    mesh.traverse((n) => {
      if (!n.isMesh || isNonPhysical(n) || !n.geometry || !shown(n)) return
      if (n !== mesh && n.userData?.id && n.userData.id !== this.targetId) return   // another part riding on this one
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox()
      const bb = n.geometry.boundingBox
      m.multiplyMatrices(Rinv, n.matrixWorld)
      for (let i = 0; i < 8; i++) box.expandByPoint(v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m))
    })
    if (box.isEmpty()) return null
    return { R, Rinv, quat, pos, box }
  }

  // ── Place + size every handle (screen-constant size) ───────────────────────
  _layout() {
    if (!this.group) return
    const f = this.targetId && this._frame()
    if (!f || !this.handles.length) { this.group.visible = false; sceneManager.requestRender?.(100); return }
    const { R, box } = f
    const cam = sceneManager.camera
    const px = (p) => p.distanceTo(cam.position) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.034   // ≈ 11 px
    const W = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(R)
    const mid = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const lo = box.min, hi = box.max
    for (const h of this.handles) {
      const k = h.userData.handle
      if (k.kind === 'corner') {
        const p = W(k.sx > 0 ? hi.x : lo.x, lo.y, k.sz > 0 ? hi.z : lo.z)
        h.position.copy(p); h.quaternion.copy(f.quat); h.scale.setScalar(px(p))
      } else if (k.kind === 'side') {
        const p = W(k.sx ? (k.sx > 0 ? hi.x : lo.x) : mid.x, lo.y, k.sz ? (k.sz > 0 ? hi.z : lo.z) : mid.z)
        h.position.copy(p); h.quaternion.copy(f.quat); h.scale.setScalar(px(p) * 0.8)
      } else if (k.kind === 'top') {
        const p = W(mid.x, hi.y, mid.z)
        h.position.copy(p); h.quaternion.copy(f.quat); h.scale.setScalar(px(p))
      } else if (k.kind === 'lift') {
        const base = W(mid.x, hi.y, mid.z)
        const s = px(base)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat)
        h.position.copy(base).addScaledVector(up, s * 3.2)
        h.quaternion.copy(f.quat); h.scale.setScalar(s * 1.3)
      }
    }
    // Rotation arrows: a 70° arc around the part's middle in the plane of each
    // axis, just outside the box, on the side facing the camera. The arc lies
    // in the group's XY plane; the group is turned so that plane is the axis plane.
    const centerW = W(mid.x, mid.y, mid.z)
    const camLocal = cam.position.clone().applyMatrix4(f.Rinv).sub(mid)
    const unit = px(centerW)
    for (const g of this.group.children) {
      const axis = g.userData.rotateAxis
      if (!axis) continue
      // plane basis (u, v) in the part frame + the 2D camera direction in it
      const [u, v, half] = axis === 'y' ? ['x', 'z', Math.hypot(size.x, size.z) / 2]
        : axis === 'x' ? ['y', 'z', Math.hypot(size.y, size.z) / 2]
        : ['x', 'y', Math.hypot(size.x, size.y) / 2]
      const r = half + unit * 2.2
      const span = THREE.MathUtils.degToRad(70)
      const face = Math.atan2(camLocal[v], camLocal[u])
      const a0 = face - span / 2 + (axis === 'y' ? Math.PI / 2.6 : 0)   // keep the Y arc off the X/Z arcs
      const { arc, tipA, tipB } = g.userData.parts
      arc.geometry.dispose()
      arc.geometry = new THREE.TorusGeometry(r, unit * 0.16, 6, 28, span)
      arc.rotation.set(0, 0, a0)
      const tip = (m, t, dir) => {
        m.position.set(r * Math.cos(t), r * Math.sin(t), 0)
        const tangent = new THREE.Vector3(-Math.sin(t), Math.cos(t), 0).multiplyScalar(dir)
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)
        m.scale.setScalar(unit * 0.9)
      }
      tip(tipA, a0, -1)
      tip(tipB, a0 + span, 1)
      // Map the group's XY plane onto the (u, v) plane of the part frame.
      const basis = new THREE.Matrix4()
      const e = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }
      basis.makeBasis(e[u], e[v], e[u].clone().cross(e[v]))
      g.position.copy(centerW)
      g.quaternion.copy(f.quat).multiply(new THREE.Quaternion().setFromRotationMatrix(basis))
      g.scale.setScalar(1)
    }
    this.group.visible = true
    sceneManager.requestRender?.(100)
  }

  _pick(e, bounds) {
    if (!this.group?.visible) return null
    const ndc = new THREE.Vector2(((e.clientX - bounds.left) / bounds.width) * 2 - 1, -((e.clientY - bounds.top) / bounds.height) * 2 + 1)
    this._ray.setFromCamera(ndc, sceneManager.camera)
    const hit = this._ray.intersectObjects(this.handles, false)[0]
    return hit ? hit.object : null
  }

  _setHover(h) {
    if (this.hover === h) return
    const paint = (m, c) => {
      const k = m.userData.handle
      const group = k.kind === 'rotate' ? this.handles.filter((x) => x.userData.handle.kind === 'rotate' && x.userData.handle.axis === k.axis) : [m]
      for (const x of group) x.material.color.setHex(c ?? x.userData.baseColor)
    }
    if (this.hover) paint(this.hover, null)
    this.hover = h
    if (h) paint(h, ORANGE)
    sceneManager.requestRender?.(100)
  }

  // ── Pointer: called by the Viewport ────────────────────────────────────────
  /** Returns true when the press landed on a handle (the drag has started). */
  pointerDown(e, bounds) {
    const h = this._pick(e, bounds)
    if (!h) return false
    const obj = this._obj(), f = this._frame()
    if (!obj || !f) return false
    const k = h.userData.handle
    const cam = sceneManager.camera
    const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat)
    let plane
    if (k.kind === 'corner' || k.kind === 'side') {
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(yAxis, h.position)
    } else if (k.kind === 'top' || k.kind === 'lift') {
      // A plane containing the part's up axis, turned to face the camera.
      const toCam = cam.position.clone().sub(h.position)
      const n = toCam.sub(yAxis.clone().multiplyScalar(toCam.dot(yAxis))).normalize()
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.lengthSq() ? n : new THREE.Vector3(0, 0, 1), h.position)
    } else {
      const axisW = new THREE.Vector3(k.axis === 'x' ? 1 : 0, k.axis === 'y' ? 1 : 0, k.axis === 'z' ? 1 : 0).applyQuaternion(f.quat)
      const center = f.box.getCenter(new THREE.Vector3()).applyMatrix4(f.R)
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisW, center)
      this.drag = { k, axisW, center }
    }
    const start = this._hit(e, bounds, plane)
    if (!start) { this.drag = null; return false }
    this.drag = {
      ...(this.drag ?? {}), k, plane, start, f, yAxis,
      obj: JSON.parse(JSON.stringify({ position: obj.position, rotation: obj.rotation, scale: obj.scale })),
      shift: e.shiftKey,
    }
    if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = false
    this._setHover(h)
    return true
  }

  pointerMove(e, bounds) {
    if (!this.drag) { this._setHover(this._pick(e, bounds)); return !!this.hover }
    const d = this.drag
    const p = this._hit(e, bounds, d.plane)
    if (!p) return true
    const ui = useUiStore.getState()
    const step = ui.snapTranslate > 0 ? ui.snapTranslate : 0.1
    const snapLen = (v) => Math.max(step, Math.round(v / step) * step)
    const { f, k } = d
    const s0 = d.obj.scale, P0 = new THREE.Vector3(d.obj.position.x, d.obj.position.y, d.obj.position.z)
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.obj.rotation.x, d.obj.rotation.y, d.obj.rotation.z))
    let next = null

    if (k.kind === 'corner' || k.kind === 'side' || k.kind === 'top') {
      // Work in the part's rotated frame, coordinates relative to its origin.
      const local = p.clone().applyMatrix4(f.Rinv)
      const lo = f.box.min, hi = f.box.max
      const fac = { x: 1, y: 1, z: 1 }, anchor = { x: 0, y: lo.y, z: 0 }
      const axisFac = (ax, sign) => {
        const fixed = sign > 0 ? lo[ax] : hi[ax]
        const old = hi[ax] - lo[ax]
        const now = snapLen(Math.abs(local[ax] - fixed))
        anchor[ax] = fixed
        return old > 1e-6 ? now / old : 1
      }
      if (k.kind === 'top') {
        fac.y = snapLen(Math.max(local.y - lo.y, 0)) / Math.max(hi.y - lo.y, 1e-6)
      } else {
        if (k.sx) fac.x = axisFac('x', k.sx)
        if (k.sz) fac.z = axisFac('z', k.sz)
        if (e.shiftKey && k.kind === 'corner') { const u = Math.max(fac.x, fac.z); fac.x = fac.y = fac.z = u; anchor.y = lo.y }
      }
      // Scaling about the origin moves the anchor; shift the part to pin it.
      const dLocal = new THREE.Vector3(anchor.x * (1 - fac.x), anchor.y * (1 - fac.y), anchor.z * (1 - fac.z))
      const P = P0.clone().add(dLocal.applyQuaternion(f.quat))
      next = { position: { x: P.x, y: P.y, z: P.z }, scale: { x: s0.x * fac.x, y: s0.y * fac.y, z: s0.z * fac.z } }
      const sz = f.box.getSize(new THREE.Vector3())
      const r2 = (v) => Math.round(v * 100) / 100
      useHandleDrag.setState({ label: `Size ${r2(sz.x * fac.x)} × ${r2(sz.z * fac.z)} × ${r2(sz.y * fac.y)} (W × D × H)` })
    } else if (k.kind === 'lift') {
      const dy = Math.round(p.clone().sub(d.start).dot(d.yAxis) / step) * step
      const P = P0.clone().addScaledVector(d.yAxis, dy)
      next = { position: { x: P.x, y: P.y, z: P.z } }
      useHandleDrag.setState({ label: `Lift ${dy >= 0 ? '+' : ''}${Math.round(dy * 100) / 100}` })
    } else {
      const a = d.start.clone().sub(d.center), b = p.clone().sub(d.center)
      let ang = Math.atan2(a.clone().cross(b).dot(d.axisW), a.dot(b))
      const snapDeg = e.shiftKey ? 1 : (ui.snapRotateDeg > 0 ? ui.snapRotateDeg : 22.5)
      ang = THREE.MathUtils.degToRad(Math.round(THREE.MathUtils.radToDeg(ang) / snapDeg) * snapDeg)
      const qd = new THREE.Quaternion().setFromAxisAngle(d.axisW, ang)
      const q = qd.clone().multiply(q0)
      const P = d.center.clone().add(P0.clone().sub(d.center).applyQuaternion(qd))   // turn about the box centre
      const eu = new THREE.Euler().setFromQuaternion(q)
      next = { position: { x: P.x, y: P.y, z: P.z }, rotation: { x: eu.x, y: eu.y, z: eu.z } }
      useHandleDrag.setState({ label: `Turn ${Math.round(THREE.MathUtils.radToDeg(ang))}°` })
    }
    if (next) {
      useSceneStore.getState().updateObject(this.targetId, next)
      const mesh = objectManager.getMesh(this.targetId)
      if (mesh) {
        if (next.position) mesh.position.set(next.position.x, next.position.y, next.position.z)
        if (next.rotation) mesh.rotation.set(next.rotation.x, next.rotation.y, next.rotation.z)
        if (next.scale) mesh.scale.set(next.scale.x, next.scale.y, next.scale.z)
        mesh.updateMatrixWorld(true)
      }
      this._layout()
    }
    return true
  }

  pointerUp() {
    if (!this.drag) return false
    this.drag = null
    useHandleDrag.setState({ label: null })
    if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
    // A bonded child keeps its bond: refresh the bond's offset to the new pose.
    const o = this._obj()
    if (o) {
      for (const b of useRigidStore.getState().getBonds()) {
        if (b.childId !== o.id) continue
        const rel = objectManager.computeChildRelativeMatrix(b.parentId, o.position, o.rotation)
        if (rel) useRigidStore.getState().updateBond(b.id, { relativeMatrix: rel })
      }
    }
    recordSnapshot('Resize / move / turn')
    this._layout()
    return true
  }

  _hit(e, bounds, plane) {
    const ndc = new THREE.Vector2(((e.clientX - bounds.left) / bounds.width) * 2 - 1, -((e.clientY - bounds.top) / bounds.height) * 2 + 1)
    this._ray.setFromCamera(ndc, sceneManager.camera)
    const p = new THREE.Vector3()
    return this._ray.ray.intersectPlane(plane, p) ? p : null
  }
}

export const handlesManager = new HandlesManager()
