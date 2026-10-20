import * as THREE from 'three'
import { sceneManager } from './SceneManager.js'
import { objectManager } from './ObjectManager.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { assemblyMembers } from '../utils/robotAssembly.js'
import { robotHeading } from '../combat/robotFront.js'

// ─────────────────────────────────────────────────────────────────────────────
// FrontIndicator — the editor's "this way is forward" arrow for a robot.
//
// One arrow, drawn from the robot's centre out past its front face along the
// declared front (robotFront.js), with a FRONT tag at the tip. Editor-only
// (hidden in simulation / battle), never raycastable, no store writes. Shown for
// the selected robot root (Viewport) or the robot picked in the Battle panel
// (pin); re-aimed on every transform change so it follows drags.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR = 0x06b6d4
const UP = new THREE.Vector3(0, 1, 0)

class FrontIndicator {
  constructor() {
    this._group = null
    this._rootId = null       // currently shown root
    this._pinned = null       // Battle panel's pick
    this._selected = null     // viewport selection
    this._suppressed = false  // sim / battle on
  }

  _build() {
    const g = new THREE.Group()
    g.userData.isFrontIndicator = true
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1, COLOR, 0.45, 0.28)
    arrow.line.material.depthTest = false; arrow.cone.material.depthTest = false
    arrow.line.material.transparent = arrow.cone.material.transparent = true
    arrow.line.material.opacity = 0.95; arrow.cone.material.opacity = 0.95
    arrow.line.renderOrder = arrow.cone.renderOrder = 997
    arrow.line.material.linewidth = 2
    // Tag
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48
    const ctx = cv.getContext('2d')
    ctx.fillStyle = 'rgba(6,182,212,0.92)'; ctx.beginPath(); ctx.roundRect(4, 4, 120, 40, 10); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('FRONT', 64, 25)
    const tex = new THREE.CanvasTexture(cv)
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
    tag.scale.set(1.2, 0.45, 1); tag.renderOrder = 998
    g.add(arrow); g.add(tag)
    g.userData.arrow = arrow; g.userData.tag = tag
    g.traverse(c => { c.raycast = () => {} })
    g.visible = false
    sceneManager.scene?.add(g)
    return g
  }

  /** The viewport's selection changed. */
  select(rootId) { this._selected = rootId; this._sync() }
  /** The Battle panel's pick (null to release). */
  pin(rootId) { this._pinned = rootId; this._sync() }
  /** Hide while simulation / battle own the robot. */
  suppress(v) { this._suppressed = !!v; this._sync() }

  _sync() {
    const id = this._suppressed ? null : (this._selected || this._pinned)
    this._rootId = id
    this.update()
  }

  /** Re-aim from the live meshes (cheap; call after a drag / store change). */
  update() {
    if (!sceneManager.scene) return
    if (!this._group) this._group = this._build()
    const g = this._group
    const id = this._rootId
    const heading = id ? robotHeading(id) : null
    if (!heading) { if (g.visible) { g.visible = false; sceneManager.requestRender() } return }
    // Assembly bounds → arrow from the centre to just past the front face.
    const box = new THREE.Box3()
    for (const mid of assemblyMembers(id)) { const m = objectManager.getMesh(mid); if (m) { m.updateWorldMatrix(true, true); box.expandByObject(m, true) } }
    if (box.isEmpty()) { g.visible = false; return }
    const c = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const a = heading.axis
    const reach = Math.abs(size.x * a.x) / 2 + Math.abs(size.z * a.z) / 2
    const len = reach + 1.2
    const arrow = g.userData.arrow
    arrow.position.copy(c)
    arrow.setDirection(a)
    arrow.setLength(len, 0.45, 0.28)
    g.userData.tag.position.copy(c).addScaledVector(a, len + 0.5).addScaledVector(UP, 0.25)
    g.visible = true
    sceneManager.requestRender()
  }

  dispose() { if (this._group) { this._group.removeFromParent(); this._group = null } }
}

export const frontIndicator = new FrontIndicator()
