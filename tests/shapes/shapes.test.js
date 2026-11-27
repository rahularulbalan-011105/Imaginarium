// Tinkercad 3D Design shapes — one describe per catalogue name (the parts
// dashboard reads "shape:<Tinkercad name>" and the aspect test titles).
import { describe, it, expect } from 'vitest'
import { Vector3, Scene, BufferGeometryLoader } from 'three'
import { objectManager } from '../../src/managers/ObjectManager.js'
import { createGeometry, SHAPE_TYPES } from '../../src/utils/geometryFactory.js'
import { SHAPE_PARAMS, shapeDefaults, shapeParamKey, strokeToOutline } from '../../src/utils/shapes3d.js'
import { useSceneStore } from '../../src/stores/sceneStore.js'
import { runBoolean } from '../../src/utils/csg.js'
import { loadCSG } from '../../src/utils/csgLib.js'

// Is the mesh closed? Every edge must be shared by exactly two triangles (after
// welding coincident vertices) — required for CSG, mass and 3D printing.
function isWatertight(geo) {
  const pos = geo.attributes.position, idx = geo.index
  const key = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => Math.round(v * 1e4)).join(',')
  const tri = idx ? idx.count / 3 : pos.count / 3
  const at = (t, k) => key(idx ? idx.getX(t * 3 + k) : t * 3 + k)
  const edges = new Map()
  for (let t = 0; t < tri; t++) {
    const v = [at(t, 0), at(t, 1), at(t, 2)]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue           // degenerate (pole) triangle
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], k = a < b ? a + '|' + b : b + '|' + a
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  return [...edges.values()].every(n => n === 2)
}
// Enclosed volume of a closed triangle mesh (divergence theorem: Σ signed tetrahedra).
function volume(geo) {
  const p = geo.attributes.position, idx = geo.index, n = idx ? idx.count : p.count
  const v = (k) => { const i = idx ? idx.getX(k) : k; return new Vector3(p.getX(i), p.getY(i), p.getZ(i)) }
  let s = 0
  for (let k = 0; k < n; k += 3) s += v(k).dot(v(k + 1).cross(v(k + 2))) / 6
  return Math.abs(s)
}
const size = (g) => { g.computeBoundingBox(); return g.boundingBox.getSize(new Vector3()) }

const SHAPES = [
  ['Half Sphere', 'half_sphere', (s) => { expect(s.x).toBeCloseTo(2.4, 1); expect(s.y).toBeCloseTo(1.2, 1) }],
  ['Paraboloid', 'paraboloid', (s) => { expect(s.x).toBeCloseTo(2, 1); expect(s.y).toBeCloseTo(2, 1) }],
  ['Round Roof', 'round_roof', (s) => { expect(s.x).toBeCloseTo(2, 1); expect(s.y).toBeCloseTo(1, 1); expect(s.z).toBeCloseTo(2, 1) }],
  ['Wedge', 'wedge', (s) => { expect(s.x).toBeCloseTo(2, 2); expect(s.y).toBeCloseTo(2, 2); expect(s.z).toBeCloseTo(2, 2) }],
  ['Tube', 'tube', (s) => { expect(s.x).toBeCloseTo(2, 1); expect(s.y).toBeCloseTo(2, 2) }],
  ['Polygon', 'polygon', (s) => { expect(s.y).toBeCloseTo(2, 2) }],
  ['Icosahedron', 'icosahedron', (s) => { expect(s.x).toBeGreaterThan(1.9) }],
  ['Star', 'star_shape', (s) => { expect(s.y).toBeCloseTo(0.6, 2) }],
  ['Heart', 'heart', (s) => { expect(s.x).toBeCloseTo(2.1, 1); expect(s.y).toBeCloseTo(0.6, 2) }],
  ['Scribble', 'scribble', (s) => { expect(s.y).toBeCloseTo(0.6, 2) }],
]

await loadCSG()

for (const [name, type, checkSize] of SHAPES) {
  describe(`shape:${name}`, () => {
    it('model: builds a closed solid at the expected size', () => {
      expect(SHAPE_TYPES.has(type)).toBe(true)
      const g = createGeometry(type, shapeDefaults(type))
      expect(g.attributes.position.count).toBeGreaterThan(8)
      expect(isWatertight(g), 'watertight').toBe(true)
      checkSize(size(g))
    })
    it('placement: add, move, rotate, resize, delete', () => {
      const store = useSceneStore.getState()
      const o = store.addObject(type)
      for (const [k, p] of Object.entries(SHAPE_PARAMS[type])) expect(o[k]).toBe(p.default)
      store.updateObject(o.id, { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 1, z: 0 }, scale: { x: 2, y: 1, z: 3 } })
      const m = useSceneStore.getState().objects.find(x => x.id === o.id)
      expect([m.position.z, m.rotation.y, m.scale.z]).toEqual([3, 1, 3])
      useSceneStore.getState().removeObject(o.id)
      expect(useSceneStore.getState().objects.find(x => x.id === o.id)).toBeUndefined()
    })
    it('placement: grouping it with a hole (Boolean subtract) removes material', () => {
      // Through the app's own path: ObjectManager meshes → csg.runBoolean().
      objectManager.init(new Scene())
      const cx = type === 'tube' ? 0.87 : 0          // a tube is hollow in the middle: cut through its wall
      const a = { id: `A_${type}`, type, ...shapeDefaults(type), position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#888888', material: 'standard' }
      const b = { id: `B_${type}`, type: 'box', position: { x: cx, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.04, y: 3, z: 0.04 }, color: '#888888', material: 'standard', isHole: true }
      objectManager.createMesh(a); objectManager.createMesh(b)
      const v0 = volume(createGeometry(type, a))
      const res = runBoolean(a.id, b.id, 'subtract')
      expect(res, 'Boolean produced a result').toBeTruthy()
      const v1 = volume(new BufferGeometryLoader().parse(res.geometryJSON))
      expect(v1, 'material was removed').toBeLessThan(v0 * 0.9995)
      expect(v1, 'most of the solid remains').toBeGreaterThan(v0 * 0.8)
      objectManager.removeMesh(a.id); objectManager.removeMesh(b.id)
    })
    it('saveload: parameters survive a JSON round trip and rebuild the same shape', () => {
      const o = { type, ...shapeDefaults(type), ...(type === 'scribble' ? { scribblePoints: [[0, 1], [1, -1], [-1, -1]] } : {}) }
      const back = JSON.parse(JSON.stringify(o))
      expect(shapeParamKey(type, back)).toBe(shapeParamKey(type, o))
      expect(createGeometry(type, back).attributes.position.count).toBe(createGeometry(type, o).attributes.position.count)
    })
    if (Object.keys(SHAPE_PARAMS[type]).length) {
      it('model: parameters change the geometry within their limits', () => {
        for (const [k, p] of Object.entries(SHAPE_PARAMS[type])) {
          const lo = createGeometry(type, { ...shapeDefaults(type), [k]: p.min })
          const hi = createGeometry(type, { ...shapeDefaults(type), [k]: p.max })
          expect(isWatertight(lo) && isWatertight(hi), `${k} extremes stay watertight`).toBe(true)
          expect(shapeParamKey(type, { [k]: p.max + 100 })).toBe(shapeParamKey(type, { [k]: p.max }))   // clamped
        }
      })
    }
  })
}

describe('shape:Scribble', () => {
  it('model: a freehand stroke becomes a clean normalised outline', () => {
    const stroke = Array.from({ length: 200 }, (_, i) => { const a = (i / 200) * Math.PI * 2; return [200 + 100 * Math.cos(a), 150 + 60 * Math.sin(a)] })
    const out = strokeToOutline(stroke)
    expect(out.length).toBeGreaterThan(8); expect(out.length).toBeLessThan(120)
    for (const [x, y] of out) { expect(Math.abs(x)).toBeLessThanOrEqual(1.0001); expect(Math.abs(y)).toBeLessThanOrEqual(1.0001) }
    expect(isWatertight(createGeometry('scribble', { scribblePoints: out, thickness: 0.6 }))).toBe(true)
  })
})
