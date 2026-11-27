// @vitest-environment jsdom
// Tinkercad "Align": Constructa's smart alignment snaps a dragged object into
// line with its neighbours (AlignmentManager — the real drag path).
import { describe, it, expect } from 'vitest'
import { Scene, Mesh, BoxGeometry, MeshBasicMaterial } from 'three'
import { alignmentManager } from '../../src/managers/AlignmentManager.js'

// jsdom has no 2D canvas; the guide's label sprite only needs a context to draw into.
const noop = () => {}
const ctx = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (t, k) => (k in t ? t[k] : noop), set: () => true })
HTMLCanvasElement.prototype.getContext = function () { return ctx }
globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}

describe('tool:Align', () => {
  it('placement: dragging near another object snaps it into line', () => {
    const scene = new Scene()
    alignmentManager.init(scene, null, null)                     // no camera → 0.3-unit snap threshold
    const fixed = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()); fixed.position.set(0, 1, 0)
    const moving = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()); moving.position.set(3.15, 1, 0.12)
    scene.add(fixed, moving)
    alignmentManager.beginDrag(moving, [fixed])
    alignmentManager.update(moving, { axis: 'XZ' })
    // z 0.12 is within 0.3 of the fixed box's centre plane → snapped to z = 0.
    expect(moving.position.z).toBeCloseTo(0, 5)
    alignmentManager.endDrag()
  })
  it('placement: an object far away is left where it is', () => {
    const scene = new Scene()
    alignmentManager.init(scene, null, null)
    const fixed = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
    const moving = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()); moving.position.set(3.15, 0, 0.9)
    scene.add(fixed, moving)
    alignmentManager.beginDrag(moving, [fixed]); alignmentManager.update(moving, { axis: 'XZ' })
    expect(moving.position.z).toBeCloseTo(0.9, 5)
    alignmentManager.endDrag()
  })
})
