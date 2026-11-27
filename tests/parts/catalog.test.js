// ─────────────────────────────────────────────────────────────────────────────
// Catalogue contract tests — generated for EVERY part in src/parts/catalog.
//
// Test names are the dashboard's data (tools/parts-dashboard.mjs):
//   describe `part:<type> | <label> | <category> | <tinkercad>`  →  it `model` | `placement` | `pins` | `wiring` |
//                              `simulation: <scenario>` | `codegen: <what>` | `saveload`
// An aspect that applies to a part but has no real test is registered with
// it.todo, which the dashboard shows as NOT TESTED — never as a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll } from 'vitest'
import { Box3, Vector3, Group } from 'three'
import * as Blockly from 'blockly'
import { loadParts, allParts, getPart, partPinNames } from '../../src/parts/registry.js'
import { validatePins, pinsOf, internalOf, propOf, defaultProps } from '../../src/parts/definePart.js'
import { buildPartObject, partModelKey } from '../../src/parts/buildPart.js'
import { createKit } from '../../src/parts/testkit.js'
import { runSketch } from '../../src/parts/sketchRunner.js'
import { PIN_DEFS as WIRE_PINS, pinRole } from '../../src/utils/wiring.js'
import { PIN_DEFS as PIN_3D, addPinSpheresToGroup } from '../../src/utils/electronicsFactory.js'
import { buildNets } from '../../src/circuit/CircuitSim.js'
import { useSceneStore } from '../../src/stores/sceneStore.js'
import { ELECTRONICS_TYPES } from '../../src/utils/elecTypes.js'
import { arduinoGenerator } from '../../src/blockly/arduinoGenerator.js'
import { defineArduinoBlocks } from '../../src/blockly/arduinoBlocks.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'

const parts = await loadParts()

/** Model bounding box (mm), pins excluded. */
function modelSizeMm(part, obj) {
  const root = buildPartObject(part, obj)
  root.updateMatrixWorld(true)
  const s = new Box3().setFromObject(root.children[0]).getSize(new Vector3())
  return { w: s.x * 10, h: s.y * 10, d: s.z * 10, root }
}
const tol = (part, v) => Math.max(0.8, v * (part.spec.dimsTolerance ?? 0.12))

/** Generated code for one block, placed where a beginner would place it. */
function codeForBlock(blockJson) {
  defineArduinoBlocks()
  const ws = new Blockly.Workspace()
  const top = ws.newBlock('arduino_setup_loop')
  const b = ws.newBlock(blockJson.type)
  // Fill value inputs with literal shadows of the right kind.
  for (const inp of b.inputList) {
    if (inp.type !== Blockly.inputs.inputTypes.VALUE || inp.connection.targetBlock()) continue
    const check = inp.connection.getCheck() ?? []
    const lit = check.includes('String') ? ws.newBlock('text') : ws.newBlock('math_number')
    if (lit.type === 'text') lit.setFieldValue('Hi', 'TEXT'); else lit.setFieldValue('1', 'NUM')
    inp.connection.connect(lit.outputConnection)
  }
  if (b.outputConnection) {
    const pr = ws.newBlock('arduino_serial_print')
    pr.getInput('VALUE').connection.connect(b.outputConnection)
    top.getInput('LOOP').connection.connect(pr.previousConnection)
  } else {
    top.getInput('LOOP').connection.connect(b.previousConnection)
  }
  const code = arduinoGenerator.workspaceToCode(ws)
  ws.dispose()
  return code
}

describe('catalogue', () => {
  it('has parts and every type is unique and registered as electronics', () => {
    expect(parts.length).toBeGreaterThan(0)
    expect(new Set(parts.map(p => p.type)).size).toBe(parts.length)
    for (const p of parts) expect(ELECTRONICS_TYPES.has(p.type), p.type).toBe(true)
  })
})

for (const part of parts) {
  // The describe title carries the dashboard's columns: type | label | category | Tinkercad name.
  describe(`part:${part.type} | ${part.label} | ${part.category} | ${part.tinkercad ?? '—'}`, () => {
    const obj = { id: 'X', type: part.type, ...defaultProps(part) }

    it('model', () => {
      const { w, h, d, root } = modelSizeMm(part, obj)
      const D = part.spec.dims_mm
      expect(w, 'width (mm)').toBeGreaterThan(D.w - tol(part, D.w)); expect(w).toBeLessThan(D.w + tol(part, D.w))
      expect(h, 'height (mm)').toBeGreaterThan(D.h - tol(part, D.h)); expect(h).toBeLessThan(D.h + tol(part, D.h))
      expect(d, 'depth (mm)').toBeGreaterThan(D.d - tol(part, D.d)); expect(d).toBeLessThan(D.d + tol(part, D.d))
      let meshes = 0
      root.traverse(c => { if (c.isMesh) { meshes++; expect(c.geometry.attributes.position.count, 'mesh has vertices').toBeGreaterThan(0) } })
      expect(meshes, 'model is more than one primitive').toBeGreaterThan(part.spec.minMeshes ?? 2)
    })

    it('pins', () => {
      const pins = pinsOf(part, obj)
      expect(validatePins(pins)).toEqual([])
      expect(pins.length).toBeGreaterThan(0)
      // Every pin sits on (or right at the edge of) the model.
      const root = buildPartObject(part, obj)
      const box = new Box3().setFromObject(root.children[0]).expandByScalar(part.spec.pinSlack ?? 0.35)
      for (const p of pins) expect(box.containsPoint(new Vector3(p.x, p.y, p.z)), `pin ${p.name} lies on the model`).toBe(true)
      // The wiring views and the 3D spheres agree on the pins.
      expect(WIRE_PINS[part.type]).toEqual(partPinNames(part.type))
      expect(Object.keys(PIN_3D[part.type])).toEqual(pins.map(p => p.name))
      addPinSpheresToGroup(root, 'X', part.type)
      let spheres = 0
      root.traverse(c => { if (c.userData.isPinSphere) spheres++ })
      expect(spheres).toBe(pins.length)
    })

    it('placement', () => {
      const store = useSceneStore.getState()
      const o = store.addObject(part.type)
      expect(o.type).toBe(part.type)
      for (const [k, p] of Object.entries(part.props ?? {})) expect(o[k], `default ${k}`).toEqual(p.default)
      store.updateObject(o.id, { position: { x: 3, y: o.position.y, z: -2 }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 2, y: 2, z: 2 } })
      const moved = useSceneStore.getState().objects.find(x => x.id === o.id)
      expect(moved.position.x).toBe(3); expect(moved.rotation.y).toBeCloseTo(Math.PI / 2); expect(moved.scale.x).toBe(2)
      useSceneStore.getState().removeObject(o.id)
      expect(useSceneStore.getState().objects.some(x => x.id === o.id)).toBe(false)
    })

    it('wiring', () => {
      const pins = pinsOf(part, obj)
      for (const p of pins) expect(['power', 'gnd', 'signal']).toContain(pinRole(p.name))
      // Internal joins (breadboard rows, switch legs) form real nets.
      const groups = internalOf(part, obj)
      const uf = buildNets([obj], {})
      for (const g of groups) for (const n of g) expect(uf.find(`X:${n}`)).toBe(uf.find(`X:${g[0]}`))
      // Every pin can be wired to a board pin.
      const kit = createKit()
      kit.scene({ U: 'arduino', X: obj }, pins.slice(0, 1).map(p => [`X:${p.name}`, 'U:D2']))
      expect(kit.bridge.sim.uf.find(`X:${pins[0].name}`)).toBe(kit.bridge.sim.uf.find('U:D2'))
    })

    const scenarios = part.tests ?? []
    const simulated = !!(part.sim?.circuit || part.sim?.calls || part.sim?.onPin || part.sim?.onClockBit)
    for (const sc of scenarios) {
      it(`simulation: ${sc.name}`, async () => {
        const kit = createKit({ board: sc.board ?? 'arduino' })
        await sc.run(kit, { runSketch })
      }, sc.timeout ?? 15000)
    }
    if (simulated && !scenarios.length) it.todo('simulation: no scenario written yet')

    const blocks = part.blockly?.blocks ?? []
    for (const b of blocks) {
      it(`codegen: block ${b.type}`, () => {
        const code = codeForBlock(b)
        const diag = analyzeArduino(code, { board: 'arduino' })
        expect(diag.errors.map(e => `${e.line}: ${e.message}`), code).toEqual([])
        const { error } = parseAndTranspile(code, new Set())
        expect(error, code).toBeFalsy()
      })
    }
    if (part.code?.example) {
      it('codegen: example sketch compiles and runs', async () => {
        const diag = analyzeArduino(part.code.example, { board: 'arduino' })
        expect(diag.errors.map(e => `${e.line}: ${e.message}`)).toEqual([])
        expect(parseAndTranspile(part.code.example, new Set()).error).toBeFalsy()
      })
    }
    const codeApplies = !!(part.code?.sandbox || part.code?.classes?.length)
    if (codeApplies && !blocks.length) it.todo('codegen: no Blockly block yet')

    it('saveload', () => {
      const store = useSceneStore.getState()
      const o = store.addObject(part.type)
      const saved = JSON.parse(JSON.stringify(useSceneStore.getState().objects.find(x => x.id === o.id)))
      expect(saved.type).toBe(part.type)
      for (const k of Object.keys(part.props ?? {})) expect(saved[k]).toEqual(o[k])
      // The reloaded object rebuilds to the same model + pins.
      expect(partModelKey(part, saved)).toBe(partModelKey(part, o))
      const a = buildPartObject(part, o), b = buildPartObject(part, saved)
      expect(Object.keys(b.userData.dynamicPins)).toEqual(Object.keys(a.userData.dynamicPins))
      useSceneStore.getState().removeObject(o.id)
    })
  })
}
