import * as THREE from 'three'
import {
  addPinSpheresToGroup,
  buildWireControlPoints,
  buildWireLine,
  rebuildWireLine,
} from '../utils/electronicsFactory.js'

const PIN_COLOR_HOVER   = 0xffffff
const HANDLE_RADIUS     = 0.14
const PREVIEW_COLOR     = 0x44ddff

class WireManager {
  constructor() {
    this.scene    = null
    this.camera   = null

    // id → THREE.Mesh  (pin spheres are CHILDREN of component groups)
    this.pinSpheres = new Map()
    // id → THREE.Sprite (label sprites, also children of groups)
    this.pinLabels  = new Map()

    // connId → { line, handleSphere, controlPoints [p0,p1,p2], fromPinId, toPinId, color }
    this.wires = new Map()

    // Drag state
    this._dragging      = false
    this._fromSphere    = null
    this._previewLine   = null
    this._previewMid    = new THREE.Vector3()

    // Handle drag state (reshaping an existing wire)
    this._draggingHandle = false
    this._handleConnId   = null

    // Hovered pin id
    this._hoveredPinId   = null
    // Hovered handle connId
    this._hoveredHandle  = null

    // Callbacks → set by App
    this.onWireCreated = null   // (fromPinId, toPinId, connId) => void
    this.onWireRemoved = null   // (connId) => void
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  init(scene, camera) {
    this.scene  = scene
    this.camera = camera
  }

  // ── Pin registration ───────────────────────────────────────────────────────
  registerComponent(group, componentId, type) {
    addPinSpheresToGroup(group, componentId, type)
    group.traverse(child => {
      if (child.userData.isPinSphere && child.userData.componentId === componentId) {
        this.pinSpheres.set(child.userData.pinId, child)
      }
      if (child.userData.isPinLabel && child.userData.pinId?.startsWith(componentId + ':')) {
        this.pinLabels.set(child.userData.pinId, child)
      }
    })
  }

  unregisterComponent(componentId) {
    for (const [id, sphere] of this.pinSpheres) {
      if (sphere.userData.componentId === componentId) {
        this.pinSpheres.delete(id)
      }
    }
    for (const [id] of this.pinLabels) {
      if (id.startsWith(componentId + ':')) this.pinLabels.delete(id)
    }
    // Remove any wires connected to this component
    for (const [connId, w] of this.wires) {
      const [a, b] = connId.split('→')
      if (a.startsWith(componentId) || b.startsWith(componentId)) {
        this._removeWireMesh(connId)
      }
    }
  }

  // ── Per-frame update ───────────────────────────────────────────────────────
  update() {
    const EPS_SQ = 0.0005 * 0.0005  // ~0.5 mm threshold — skip rebuild if nothing moved

    for (const [connId, w] of this.wires) {
      const p0 = new THREE.Vector3()
      const p2 = new THREE.Vector3()
      w.fromSphere.getWorldPosition(p0)
      w.toSphere.getWorldPosition(p2)
      w.controlPoints[0].copy(p0)
      w.controlPoints[2].copy(p2)

      // Recompute the arch midpoint from live pin positions.
      // Preserve user-dragged handle offset relative to the auto-midpoint.
      const autoMid = p0.clone().lerp(p2, 0.5)
      const d = p0.distanceTo(p2)
      autoMid.y = Math.max(p0.y, p2.y) + Math.min(d * 0.14, 1.2) + 0.35

      if (w.handleDragged && w.handleOffset) {
        w.controlPoints[1].copy(autoMid).add(w.handleOffset)
      } else {
        w.controlPoints[1].copy(autoMid)
      }

      // Only recreate TubeGeometry when endpoints actually moved or handle is being dragged.
      const endpointsMoved = !w._lastP0 || !w._lastP2
        || p0.distanceToSquared(w._lastP0) > EPS_SQ
        || p2.distanceToSquared(w._lastP2) > EPS_SQ
      const handleActive = this._draggingHandle && this._handleConnId === connId

      if (endpointsMoved || handleActive) {
        rebuildWireLine(w.line, w.controlPoints)
        if (!w._lastP0) w._lastP0 = new THREE.Vector3()
        if (!w._lastP2) w._lastP2 = new THREE.Vector3()
        w._lastP0.copy(p0)
        w._lastP2.copy(p2)
      }
      w.handleSphere.position.copy(w.controlPoints[1])
    }

    // Update preview wire while drawing
    if (this._dragging && this._previewLine && this._fromSphere) {
      const from = new THREE.Vector3()
      this._fromSphere.getWorldPosition(from)
      const cp = buildWireControlPoints(from, this._previewMid)
      rebuildWireLine(this._previewLine, cp)
    }
  }

  // ── Mouse handlers ─────────────────────────────────────────────────────────

  // Returns true if event was consumed (don't pass to object selection)
  onMouseMove(event, bounds) {
    const mouse = this._getMouse(event, bounds)

    // If dragging a handle
    if (this._draggingHandle && this._handleConnId) {
      const worldPos = this._raycastPlane(mouse, this.wires.get(this._handleConnId)?.controlPoints[1])
      if (worldPos) {
        this.wires.get(this._handleConnId).controlPoints[1].copy(worldPos)
      }
      return true
    }

    // If drawing a wire
    if (this._dragging) {
      const worldPos = this._raycastGroundPlane(mouse, this._fromSphere)
      if (worldPos) this._previewMid.copy(worldPos)

      // Highlight target pin if hovered
      const hitPin = this._raycastPins(mouse)
      this._setHoveredPin(hitPin)
      return true
    }

    // Normal hover: check pins and handles
    const hitPin    = this._raycastPins(mouse)
    const hitHandle = this._raycastHandles(mouse)

    this._setHoveredPin(hitPin)
    this._setHoveredHandle(hitHandle)

    return !!(hitPin || hitHandle)
  }

  onMouseDown(event, bounds) {
    const mouse = this._getMouse(event, bounds)

    // Check handle first
    const hitHandle = this._raycastHandles(mouse)
    if (hitHandle) {
      this._draggingHandle = true
      this._handleConnId   = hitHandle
      return true
    }

    // Check pin
    const hitPin = this._raycastPins(mouse)
    if (hitPin) {
      this._startDrag(hitPin)
      return true
    }

    return false
  }

  onMouseUp(event, bounds) {
    if (this._draggingHandle) {
      this._draggingHandle = false
      if (this._handleConnId) {
        const w = this.wires.get(this._handleConnId)
        if (w) {
          // Store the handle's offset from the auto-midpoint so it survives component movement
          const p0 = new THREE.Vector3()
          const p2 = new THREE.Vector3()
          w.fromSphere.getWorldPosition(p0)
          w.toSphere.getWorldPosition(p2)
          const autoMid = p0.clone().lerp(p2, 0.5)
          const d = p0.distanceTo(p2)
          autoMid.y = Math.max(p0.y, p2.y) + Math.min(d * 0.14, 1.2) + 0.35
          w.handleOffset  = w.controlPoints[1].clone().sub(autoMid)
          w.handleDragged = true
        }
      }
      this._handleConnId = null
      return true
    }

    if (!this._dragging) return false

    const mouse  = this._getMouse(event, bounds)
    const hitPin = this._raycastPins(mouse)

    if (hitPin && hitPin !== this._fromSphere) {
      this._finishWire(hitPin)
    } else {
      this._cancelDrag()
    }
    return true
  }

  onKeyDown(event) {
    if (event.key === 'Escape' && this._dragging) {
      this._cancelDrag()
      return true
    }
    return false
  }

  onContextMenu(event, bounds) {
    event.preventDefault()
    const mouse = this._getMouse(event, bounds)
    const hitHandle = this._raycastHandles(mouse)
    if (hitHandle) {
      this._removeWireMesh(hitHandle)
      return true
    }
    // Also try raycasting the wire lines directly
    const rc    = new THREE.Raycaster()
    rc.params.Line = { threshold: 0.15 }
    rc.setFromCamera(mouse, this.camera)
    const lines = [...this.wires.values()].map(w => w.line)
    if (!lines.length) return false
    const hits  = rc.intersectObjects(lines)
    if (hits.length) {
      const connId = hits[0].object.userData.connId
      if (connId) this._removeWireMesh(connId)
      return true
    }
    return false
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _startDrag(fromSphere) {
    this._dragging    = true
    this._fromSphere  = fromSphere

    const from = new THREE.Vector3()
    fromSphere.getWorldPosition(from)
    // Give the preview an initial non-degenerate shape (tiny arch above the pin)
    // so TubeGeometry never receives a zero-length curve on the first update frame.
    const cp = buildWireControlPoints(from, from.clone().add(new THREE.Vector3(0, 0, 0.01)))
    const { line } = buildWireLine(cp, PREVIEW_COLOR)
    line.material.transparent = true
    line.material.opacity = 0.55
    this.scene.add(line)
    this._previewLine = line
    this._previewMid.copy(from)
  }

  _finishWire(toSphere) {
    const fromId = this._fromSphere.userData.pinId
    const toId   = toSphere.userData.pinId
    const connId = `${fromId}→${toId}`

    // Avoid duplicates
    if (!this.wires.has(connId)) {
      const from = new THREE.Vector3()
      const to   = new THREE.Vector3()
      this._fromSphere.getWorldPosition(from)
      toSphere.getWorldPosition(to)

      const color = this._wireColor(this._fromSphere, toSphere)
      const controlPoints = buildWireControlPoints(from, to)
      const { line } = buildWireLine(controlPoints, color)
      line.userData.connId = connId
      this.scene.add(line)

      // Bend handle sphere (shown on hover)
      const handleMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x444444,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const handleSphere = new THREE.Mesh(
        new THREE.SphereGeometry(HANDLE_RADIUS, 10, 10),
        handleMat
      )
      handleSphere.position.copy(controlPoints[1])
      handleSphere.userData.isWireHandle = true
      handleSphere.userData.connId       = connId
      this.scene.add(handleSphere)

      this.wires.set(connId, {
        line, handleSphere, controlPoints,
        fromSphere: this._fromSphere,
        toSphere,
        color,
        handleDragged: false,
        handleOffset:  null,
      })

      if (this.onWireCreated) this.onWireCreated(fromId, toId, connId)
    }

    this._cancelDrag()
  }

  _cancelDrag() {
    if (this._previewLine) {
      this.scene.remove(this._previewLine)
      this._previewLine.geometry.dispose()
      this._previewLine.material.dispose()
      this._previewLine = null
    }
    this._dragging   = false
    this._fromSphere = null
  }

  _removeWireMesh(connId) {
    const w = this.wires.get(connId)
    if (!w) return
    this.scene.remove(w.line)
    this.scene.remove(w.handleSphere)
    w.line.geometry.dispose()
    w.line.material.dispose()
    w.handleSphere.geometry.dispose()
    w.handleSphere.material.dispose()
    this.wires.delete(connId)
    if (this.onWireRemoved) this.onWireRemoved(connId)
  }

  removeWire(connId) {
    this._removeWireMesh(connId)
  }

  clearAll() {
    for (const connId of [...this.wires.keys()]) this._removeWireMesh(connId)
    this.pinSpheres.clear()
  }

  // ── Raycasting ─────────────────────────────────────────────────────────────

  _raycastPins(mouse) {
    const rc = new THREE.Raycaster()
    rc.params.Points = { threshold: 0.3 }
    rc.setFromCamera(mouse, this.camera)
    const spheres = Array.from(this.pinSpheres.values())
    const hits    = rc.intersectObjects(spheres)
    return hits.length > 0 ? hits[0].object : null
  }

  _raycastHandles(mouse) {
    const rc      = new THREE.Raycaster()
    const handles = [...this.wires.values()].map(w => w.handleSphere)
    if (!handles.length) return null
    rc.setFromCamera(mouse, this.camera)
    const hits = rc.intersectObjects(handles)
    return hits.length > 0 ? hits[0].object.userData.connId : null
  }

  _raycastGroundPlane(mouse, fromSphere) {
    const fp = new THREE.Vector3()
    fromSphere.getWorldPosition(fp)
    return this._raycastPlane(mouse, fp)
  }

  _raycastPlane(mouse, referencePoint) {
    const rc     = new THREE.Raycaster()
    rc.setFromCamera(mouse, this.camera)
    // Horizontal plane at reference Y
    const plane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(referencePoint?.y ?? 0))
    const target = new THREE.Vector3()
    rc.ray.intersectPlane(plane, target)
    return target.lengthSq() > 0 ? target : null
  }

  _getMouse(event, bounds) {
    return new THREE.Vector2(
      ((event.clientX - bounds.left)  / bounds.width)  * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
  }

  // ── Hover visuals ──────────────────────────────────────────────────────────

  _setHoveredPin(sphere) {
    const id = sphere?.userData.pinId ?? null
    if (id === this._hoveredPinId) return
    // Un-hover previous
    if (this._hoveredPinId) {
      const prev = this.pinSpheres.get(this._hoveredPinId)
      if (prev) {
        prev.material.opacity = 0.55
        prev.material.emissive.set(0x000000)
        prev.scale.setScalar(1)
      }
      const prevLabel = this.pinLabels.get(this._hoveredPinId)
      if (prevLabel) prevLabel.material.opacity = 0.65
    }
    // Hover new
    if (sphere) {
      sphere.material.opacity = 1.0
      sphere.material.emissive.set(PIN_COLOR_HOVER)
      sphere.scale.setScalar(1.6)
      const label = this.pinLabels.get(id)
      if (label) label.material.opacity = 1.0
    }
    this._hoveredPinId = id
  }

  _setHoveredHandle(connId) {
    if (connId === this._hoveredHandle) return
    // Un-hover previous
    if (this._hoveredHandle) {
      const w = this.wires.get(this._hoveredHandle)
      if (w) w.handleSphere.material.opacity = 0
    }
    // Hover new
    if (connId) {
      const w = this.wires.get(connId)
      if (w) w.handleSphere.material.opacity = 0.85
    }
    this._hoveredHandle = connId
  }

  // ── Wire color by pin type ─────────────────────────────────────────────────

  _wireColor(fromSphere, toSphere) {
    const types = [fromSphere.userData.pinType, toSphere.userData.pinType]
    if (types.includes('gnd'))   return 0x222222
    if (types.includes('power')) return 0xee2222
    if (types.includes('pwm'))   return 0xff8800
    return 0xffcc00
  }

  get isDragging() { return this._dragging || this._draggingHandle }

  // Returns true if the pointer is over any interactive wire element (pin or handle).
  // Called from the Viewport's capture-phase native listener to block OrbitControls.
  isInteractiveAt(event, bounds) {
    const mouse = this._getMouse(event, bounds)
    return this._raycastPins(mouse) !== null || this._raycastHandles(mouse) !== null
  }

  // Public cancel — useful for Escape key or mouseLeave
  cancelDrag() { this._cancelDrag() }
}

export const wireManager = new WireManager()
