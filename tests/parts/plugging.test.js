// Breadboard plugging: legs over holes become connections; near-misses snap
// onto the 2.54 mm grid; a part away from the board plugs nothing.
import { describe, it, expect } from 'vitest'
import { loadParts } from '../../src/parts/registry.js'
import { computePlugs, snapOffset } from '../../src/parts/plugging.js'
import { createKit } from '../../src/parts/testkit.js'

await loadParts()
const board = { id: 'BB', type: 'breadboard_half', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
// Hole 10e of a 30-column half board: x = (10 − 15.5)·2.54 mm, z = +1.5 pitch.
const x10 = (10 - 15.5) * 0.254, zE = 0.254 * 1.5
const resistorAt = (x, y, z, rotY = 0) => ({ id: 'R', type: 'resistor', resistance: 330, position: { x, y, z }, rotation: { x: 0, y: rotY, z: 0 }, scale: { x: 1, y: 1, z: 1 } })

describe('breadboard plugging', () => {
  it('a resistor sitting on the board plugs both legs into the holes under them', () => {
    // Resistor legs are ±0.508 cm (4 pitches) from its centre: centred on column 12 → legs in 10e and 14e.
    const plugs = computePlugs([board, resistorAt(x10 + 0.508, 0.85, zE)])
    expect(plugs).toEqual([{ fromPinId: 'R:1', toPinId: 'BB:10e' }, { fromPinId: 'R:2', toPinId: 'BB:14e' }])
  })
  it('a rotated part plugs along the column (legs in 10a and 10e … no: one strip shorts it)', () => {
    // Rotated 90°: both legs in column 10 (rows e and a−? 4 pitches apart = rows e → a is 4 pitches).
    const plugs = computePlugs([board, resistorAt(x10, 0.85, zE + 0.508, Math.PI / 2)])
    expect(plugs.map(p => p.toPinId).sort()).toEqual(['BB:10a', 'BB:10e'])
  })
  it('a part floating above the board, or off it, plugs nothing', () => {
    expect(computePlugs([board, resistorAt(x10 + 0.508, 3, zE)])).toEqual([])
    expect(computePlugs([board, resistorAt(40, 0.85, 0)])).toEqual([])
  })
  it('a part dropped 1 mm off the grid snaps exactly onto it', () => {
    const off = snapOffset(resistorAt(x10 + 0.508 + 0.1, 0.9, zE - 0.06), [board])
    expect(off.x).toBeCloseTo(-0.1, 4); expect(off.z).toBeCloseTo(0.06, 4); expect(off.y).toBeCloseTo(-0.05, 4)
  })
  it('plugged legs conduct through the strips in the solver', () => {
    const kit = createKit()
    kit.scene({ U: 'arduino', BB: 'breadboard_half', R: { type: 'resistor', resistance: 1000 } },
      [['R:1', 'BB:10e'], ['R:2', 'BB:14e'], ['U:5V', 'BB:10a'], ['U:GND1', 'BB:14b']])
    kit.step(0.02)
    expect(kit.state('R').voltage).toBeCloseTo(5, 2)
  })
})
