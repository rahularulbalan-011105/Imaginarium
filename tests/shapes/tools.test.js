// Tinkercad 3D Design tools: Workplane · Ruler · Notes.
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { workplaneFromHit, placeOnWorkplane, workplanePlane, rulerReadings, applyRulerEdit } from '../../src/utils/workplane.js'
import { useToolsStore } from '../../src/stores/toolsStore.js'
import { useSceneStore } from '../../src/stores/sceneStore.js'
import { printableObjects } from '../../src/utils/printExport.js'

describe('tool:Workplane', () => {
  it('model: a picked face becomes a plane through that point along its normal', () => {
    const wp = workplaneFromHit({ x: 2, y: 1, z: 0 }, { x: 1, y: 0, z: 0 })   // the +X face of a box
    const pl = workplanePlane(wp)
    expect(pl.distanceToPoint(new Vector3(2, 5, -3))).toBeCloseTo(0)
    expect(pl.distanceToPoint(new Vector3(3, 1, 0))).toBeCloseTo(1)
    expect(workplaneFromHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull()
  })
  it('placement: new objects are created ON the workplane, standing along its normal', () => {
    useToolsStore.getState().setWorkplane(workplaneFromHit({ x: 2, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }))
    const o = useSceneStore.getState().addObject('box')
    // Default floor spot (x 0, y 1, z 0 for the first box) → 1 unit out from the face.
    expect(o.position.x).toBeCloseTo(3); expect(o.position.y).toBeCloseTo(1); expect(o.position.z).toBeCloseTo(0)
    // Its +Y now points along +X (rotated −90° about Z).
    expect(o.rotation.z).toBeCloseTo(-Math.PI / 2)
    useSceneStore.getState().removeObject(o.id)
    useToolsStore.getState().setWorkplane(null)
    const p = useSceneStore.getState().addObject('box')
    expect(p.rotation).toEqual({ x: 0, y: 0, z: 0 })
    useSceneStore.getState().removeObject(p.id)
  })
  it('saveload: a workplane is plain data', () => {
    const wp = workplaneFromHit({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: -1 })
    expect(placeOnWorkplane(JSON.parse(JSON.stringify(wp)), { x: 1, y: 0, z: 0 })).toEqual(placeOnWorkplane(wp, { x: 1, y: 0, z: 0 }))
  })
})

describe('tool:Ruler', () => {
  const box = { min: { x: 1, y: 0, z: -2 }, max: { x: 3, y: 4, z: 1 } }
  it('model: reads the offset of the box corner from the ruler and the size', () => {
    expect(rulerReadings(box, { x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: -2, w: 2, h: 4, d: 3 })
  })
  it('placement: typing an offset moves the object; typing a size resizes it from the ruler side', () => {
    const obj = { position: { x: 2, y: 2, z: -0.5 }, scale: { x: 1, y: 1, z: 1 } }
    const mv = applyRulerEdit('x', 5, obj, box, { x: 0, y: 0, z: 0 })
    expect(mv.position.x).toBeCloseTo(6)                    // corner 1 → 5: +4
    const rs = applyRulerEdit('w', 4, obj, box, { x: 0, y: 0, z: 0 })
    expect(rs.scale.x).toBeCloseTo(2)
    // The near corner stays put: new min = pos + (min − pos)·k after the shift.
    const newMin = rs.position.x + (box.min.x - obj.position.x) * 2
    expect(newMin).toBeCloseTo(box.min.x)
    expect(applyRulerEdit('w', -1, obj, box, { x: 0, y: 0, z: 0 })).toBeNull()
  })
})

describe('tool:Notes', () => {
  it('placement: a note is an object with text that is never printed', () => {
    const n = useSceneStore.getState().addObject('note', { x: 1, y: 2, z: 3 }, { noteText: 'Glue here' })
    expect(n.noteText).toBe('Glue here')
    expect(printableObjects(useSceneStore.getState().objects).some(o => o.id === n.id)).toBe(false)
    useSceneStore.getState().removeObject(n.id)
  })
  it('saveload: the text survives a JSON round trip', () => {
    const n = useSceneStore.getState().addObject('note', undefined, { noteText: 'Hello' })
    expect(JSON.parse(JSON.stringify(n)).noteText).toBe('Hello')
    useSceneStore.getState().removeObject(n.id)
  })
})
