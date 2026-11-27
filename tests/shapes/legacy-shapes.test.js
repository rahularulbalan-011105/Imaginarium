// The Tinkercad 3D Design shapes and tools that Constructa already had before
// the catalogue work: Box · Cylinder · Sphere · Roof · Cone · Torus · Pyramid ·
// Text · Box Hole · Cylinder Hole, and Align · Mirror · Group / Ungroup ·
// Duplicate · Hole / Solid. Real app paths: geometryFactory, sceneStore actions,
// csg.runBoolean via groupSelected, AlignmentManager, utils/mirror.
import { describe, it, expect } from 'vitest'
import { Scene, Vector3, Box3, Mesh, BoxGeometry, MeshBasicMaterial, BufferGeometryLoader } from 'three'
import { createGeometry, createTextGeometry } from '../../src/utils/geometryFactory.js'
import { useSceneStore } from '../../src/stores/sceneStore.js'
import { objectManager } from '../../src/managers/ObjectManager.js'
import { mirrorPatch } from '../../src/utils/mirror.js'
import { loadCSG } from '../../src/utils/csgLib.js'

await loadCSG()
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}
objectManager.init(new Scene())

function isWatertight(geo) {
  const pos = geo.attributes.position, idx = geo.index
  const key = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => Math.round(v * 1e4)).join(',')
  const tri = idx ? idx.count / 3 : pos.count / 3
  const at = (t, k) => key(idx ? idx.getX(t * 3 + k) : t * 3 + k)
  const edges = new Map()
  for (let t = 0; t < tri; t++) {
    const v = [at(t, 0), at(t, 1), at(t, 2)]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3], k = a < b ? a + '|' + b : b + '|' + a; edges.set(k, (edges.get(k) ?? 0) + 1) }
  }
  return [...edges.values()].every(n => n === 2)
}
function volume(geo) {
  const p = geo.attributes.position, idx = geo.index, n = idx ? idx.count : p.count
  const v = (k) => { const i = idx ? idx.getX(k) : k; return new Vector3(p.getX(i), p.getY(i), p.getZ(i)) }
  let s = 0; for (let k = 0; k < n; k += 3) s += v(k).dot(v(k + 1).cross(v(k + 2))) / 6
  return Math.abs(s)
}
const size = (g) => { g.computeBoundingBox(); return g.boundingBox.getSize(new Vector3()) }
const T0 = { rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }

// Tinkercad name → type, exact volume of the primitive (closed-form where it has one).
const SHAPES = [
  ['Box', 'box', 8, (s) => expect([s.x, s.y, s.z]).toEqual([2, 2, 2])],
  ['Cylinder', 'cylinder', Math.PI * 2, (s) => { expect(s.y).toBeCloseTo(2); expect(s.x).toBeCloseTo(2, 1) }],
  ['Sphere', 'sphere', (4 / 3) * Math.PI, (s) => expect(s.x).toBeCloseTo(2, 1)],
  ['Roof', 'prism', null, (s) => expect(s.y).toBeCloseTo(2)],
  ['Cone', 'cone', Math.PI * 2 / 3, (s) => expect(s.y).toBeCloseTo(2)],
  ['Torus', 'torus', 2 * Math.PI * Math.PI * 1 * 0.16, (s) => expect(s.x).toBeCloseTo(2.8, 1)],
  ['Pyramid', 'pyramid', null, (s) => expect(s.y).toBeCloseTo(2)],
]

for (const [name, type, vol, checkSize] of SHAPES) {
  describe(`shape:${name}`, () => {
    it('model: a closed solid of the right size (and volume, within tessellation error)', () => {
      const g = createGeometry(type)
      expect(isWatertight(g)).toBe(true)
      checkSize(size(g))
      if (vol) expect(Math.abs(volume(g) - vol) / vol).toBeLessThan(0.03)
    })
    it('placement: add, move, rotate, resize, delete', () => {
      const s = useSceneStore.getState(), o = s.addObject(type)
      s.updateObject(o.id, { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0.5, y: 0, z: 0 }, scale: { x: 3, y: 1, z: 1 } })
      const m = useSceneStore.getState().objects.find(x => x.id === o.id)
      expect([m.position.y, m.rotation.x, m.scale.x]).toEqual([2, 0.5, 3])
      useSceneStore.getState().removeObject(o.id)
    })
    it('saveload: the saved object rebuilds the same geometry', () => {
      const o = useSceneStore.getState().addObject(type)
      const back = JSON.parse(JSON.stringify(o))
      expect(createGeometry(back.type).attributes.position.count).toBe(createGeometry(type).attributes.position.count)
      useSceneStore.getState().removeObject(o.id)
    })
  })
}

describe('shape:Text', () => {
  it('model: a solid of the typed text, larger for longer text', () => {
    const a = createTextGeometry('A', 1, 0.4), ab = createTextGeometry('ABC', 1, 0.4)
    expect(a.attributes.position.count).toBeGreaterThan(20)
    expect(size(ab).x).toBeGreaterThan(size(a).x * 2)
    expect(size(a).z).toBeCloseTo(0.4, 1)
  })
  it('placement: a Text object starts with editable content', () => {
    const o = useSceneStore.getState().addObject('text')
    expect(o.textContent).toBe('Text')
    useSceneStore.getState().updateObject(o.id, { textContent: 'Hi' })
    expect(useSceneStore.getState().objects.find(x => x.id === o.id).textContent).toBe('Hi')
    useSceneStore.getState().removeObject(o.id)
  })
  it('saveload: content, size and height survive a round trip', () => {
    const o = useSceneStore.getState().addObject('text', undefined, { textContent: 'Robot' })
    const back = JSON.parse(JSON.stringify(o))
    expect([back.textContent, back.textSize, back.textHeight]).toEqual(['Robot', 1, 0.4])
    useSceneStore.getState().removeObject(o.id)
  })
})

/** Put two objects in the scene + ObjectManager, select both, group them. */
function groupPair(a, b) {
  const s = useSceneStore.getState()
  for (const o of [a, b]) { s.insertObject(o); objectManager.createMesh(o) }
  s.selectObject(a.id); s.setSecondaryId(b.id)
  return s.groupSelected()
}
const solid = (id, type, extra = {}) => ({ id, type, name: id, position: { x: 0, y: 0, z: 0 }, ...T0, color: '#888888', material: 'standard', visible: true, ...extra })

for (const [name, holeType] of [['Box Hole', 'box'], ['Cylinder Hole', 'cylinder']]) {
  describe(`shape:${name}`, () => {
    it('model: a hole shape cuts its volume out of a solid when grouped', () => {
      const block = solid(`blk_${holeType}`, 'box', { scale: { x: 2, y: 1, z: 2 } })               // 4 × 2 × 4 = 32
      const hole = solid(`hole_${holeType}`, holeType, { scale: { x: 0.5, y: 2, z: 0.5 }, isHole: true })
      const g = groupPair(block, hole)
      expect(g, 'group created').toBeTruthy()
      const v = volume(new BufferGeometryLoader().parse(g.geometryJSON))
      // Box hole: 1 × 2 × 1 = 2 removed → 30. Cylinder hole: π·0.5²·2 ≈ 1.571 removed → 30.43.
      const expected = holeType === 'box' ? 30 : 32 - Math.PI * 0.25 * 2
      expect(v).toBeCloseTo(expected, 1)
      useSceneStore.getState().removeObject(g.id)
    })
    it('placement: toggling Hole / Solid flips the object', () => {
      const s = useSceneStore.getState(), o = s.addObject(holeType)
      s.toggleHole(o.id); expect(useSceneStore.getState().objects.find(x => x.id === o.id).isHole).toBe(true)
      s.toggleHole(o.id); expect(useSceneStore.getState().objects.find(x => x.id === o.id).isHole).toBe(false)
      s.removeObject(o.id)
    })
    it('saveload: the hole flag is saved', () => {
      const o = useSceneStore.getState().addObject(holeType, undefined, { isHole: true })
      expect(JSON.parse(JSON.stringify(o)).isHole).toBe(true)
      useSceneStore.getState().removeObject(o.id)
    })
  })
}

describe('tool:Hole / Solid', () => {
  it('placement: two solids union; a solid and a hole subtract', () => {
    const u = groupPair(solid('u1', 'box'), solid('u2', 'box', { position: { x: 1, y: 0, z: 0 } }))
    expect(volume(new BufferGeometryLoader().parse(u.geometryJSON))).toBeCloseTo(12, 1)      // 8 + 8 − 4 overlap
    const d = groupPair(solid('d1', 'box'), solid('d2', 'box', { position: { x: 1, y: 0, z: 0 }, isHole: true }))
    expect(volume(new BufferGeometryLoader().parse(d.geometryJSON))).toBeCloseTo(4, 1)       // 8 − 4
    useSceneStore.getState().removeObject(u.id); useSceneStore.getState().removeObject(d.id)
  })
})

describe('tool:Group / Ungroup', () => {
  it('placement: grouping replaces both parts with one; ungrouping restores them', () => {
    const before = useSceneStore.getState().objects.length
    const g = groupPair(solid('g1', 'sphere'), solid('g2', 'cylinder', { position: { x: 0.5, y: 0, z: 0 } }))
    expect(useSceneStore.getState().objects.length).toBe(before + 1)
    expect(g.groupMembers.map(m => m.id).sort()).toEqual(['g1', 'g2'])
    objectManager.createMesh(g)
    useSceneStore.getState().selectObject(g.id)
    useSceneStore.getState().ungroupSelected()
    const types = useSceneStore.getState().objects.filter(o => o.type === 'sphere' || o.type === 'cylinder').map(o => o.type).sort()
    expect(types).toEqual(['cylinder', 'sphere'])
  })
  it('saveload: a group keeps its members (so it can be ungrouped after reloading)', () => {
    const g = groupPair(solid('h1', 'box'), solid('h2', 'box', { position: { x: 1.5, y: 0, z: 0 } }))
    const back = JSON.parse(JSON.stringify(g))
    expect(back.groupMembers.length).toBe(2); expect(back.geometryJSON).toBeTruthy()
    useSceneStore.getState().removeObject(g.id)
  })
})

describe('tool:Duplicate', () => {
  it('placement: duplicates an object with its properties, as a separate object', () => {
    const s = useSceneStore.getState(), o = s.addObject('cone')
    s.updateObject(o.id, { color: '#123456', scale: { x: 2, y: 1, z: 1 } })
    const before = useSceneStore.getState().objects.length
    s.duplicateObject(o.id)
    const objs = useSceneStore.getState().objects
    expect(objs.length).toBe(before + 1)
    const copy = objs[objs.length - 1]
    expect(copy.id).not.toBe(o.id)
    expect([copy.type, copy.color, copy.scale.x]).toEqual(['cone', '#123456', 2])
  })
})

describe('tool:Mirror / Flip', () => {
  it('placement: mirroring reflects the position and negates the scale on that axis', () => {
    const p = mirrorPatch({ position: { x: 3, y: 1, z: -2 }, scale: { x: 1, y: 2, z: 1 } }, 'x')
    expect(p).toEqual({ position: { x: -3, y: 1, z: -2 }, scale: { x: -1, y: 2, z: 1 } })
    expect(mirrorPatch({ position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, 'w')).toBeNull()
  })
  it('model: a mirrored mesh is the reflection (same size, mirrored bounding box)', () => {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    const p = mirrorPatch({ position: { x: 2, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, 'x')
    m.position.set(p.position.x, p.position.y, p.position.z); m.scale.set(p.scale.x, p.scale.y, p.scale.z); m.updateMatrixWorld()
    const b = new Box3().setFromObject(m)
    expect(b.min.x).toBeCloseTo(-2.5); expect(b.max.x).toBeCloseTo(-1.5)
  })
})
