// Shared plumbing for catalogue parts: the Wire (I²C) bus and sockets.
import { describe, it, expect } from 'vitest'
import { Group, Mesh, BoxGeometry } from 'three'
import { loadParts, registerParts } from '../../src/parts/registry.js'
import { definePart } from '../../src/parts/definePart.js'
import { createKit } from '../../src/parts/testkit.js'
import { runSketch } from '../../src/parts/sketchRunner.js'
import { computePlugs, snapOffset } from '../../src/parts/plugging.js'

await loadParts()
const model = () => { const g = new Group(); g.add(new Mesh(new BoxGeometry(1, 0.2, 1))); g.add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2))); return g }
// A minimal I²C device: answers at 0x20 when powered and wired; stores what it is sent; returns 0xA5.
registerParts([definePart({
  type: 't_i2c', label: 'T', category: 'ics', desc: 't', purpose: 't', spec: { dims_mm: { w: 10, h: 2, d: 10 }, mass_kg: 0.001 },
  pins: ['VCC', 'GND', 'SDA', 'SCL'].map((name, i) => ({ name, kind: name === 'GND' ? 'gnd' : name === 'VCC' ? 'power' : 'digital', x: i * 0.254, y: 0, z: 0 })),
  build: model,
  sim: {
    initState: () => ({ got: [] }),
    i2c: {
      address: (api) => (api.vpin('VCC') > 2 && api.boardPin('SDA') === 18 && api.boardPin('SCL') === 19 ? 0x20 : null),
      write: (bytes, api) => { api.state.got.push(...bytes) },
      read: () => [0xa5],
    },
  },
}), definePart({
  type: 't_socket', label: 'S', category: 'mcu', desc: 's', purpose: 's', spec: { dims_mm: { w: 10, h: 2, d: 10 }, mass_kg: 0.001 },
  pins: [{ name: 'S0', kind: 'digital', x: 0, y: 0, z: 0 }, { name: 'H0', kind: 'digital', x: 0.3, y: 0, z: 0 }],
  internal: [['S0', 'H0']],
  socket: { accepts: 'microbit', slot: { x: 0, y: 1, z: 0 }, radius: 1, pairs: [['P0', 'S0']] },
  build: model,
})])

describe('I²C bus through Wire', () => {
  const sketch = `#include <Wire.h>
void setup() { Serial.begin(9600); Wire.begin();
  Wire.beginTransmission(0x20); Wire.write(0x3C); Wire.write(7); Serial.println(Wire.endTransmission());
  Wire.requestFrom(0x20, 1); Serial.println(Wire.read());
  Wire.beginTransmission(0x21); Serial.println(Wire.endTransmission()); }
void loop() { delay(50); }`
  it('a powered, wired device receives writes, answers reads, and an empty address NACKs', async () => {
    const kit = createKit()
    kit.scene({ U: 'arduino', D: 't_i2c' }, [['D:VCC', 'U:5V'], ['D:GND', 'U:GND1'], ['D:SDA', 'U:SDA'], ['D:SCL', 'U:SCL']])
    const s = runSketch(kit, sketch); await s.run(120); s.stop()
    expect(kit.partState('D').got).toEqual([0x3c, 7])
    expect(s.out.join('')).toBe('0\n165\n2\n')            // ACK · 0xA5 · NACK
  })
  it('an unpowered device does not answer (NACK, nothing received)', async () => {
    const kit = createKit()
    kit.scene({ U: 'arduino', D: 't_i2c' }, [['D:GND', 'U:GND1'], ['D:SDA', 'U:SDA'], ['D:SCL', 'U:SCL']])
    const s = runSketch(kit, sketch); await s.run(120); s.stop()
    expect(kit.partState('D').got).toEqual([])
    expect(s.out.join('').startsWith('2\n')).toBe(true)
  })
})

describe('sockets', () => {
  const T = { rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
  it('a micro:bit seated in the slot plugs through the socket pairs; away from it, nothing', () => {
    const sock = { id: 'S', type: 't_socket', position: { x: 5, y: 0, z: 0 }, ...T }
    expect(computePlugs([sock, { id: 'M', type: 'microbit', position: { x: 5.2, y: 1, z: 0.1 }, ...T }])).toEqual([{ fromPinId: 'M:P0', toPinId: 'S:S0' }])
    expect(computePlugs([sock, { id: 'M', type: 'microbit', position: { x: 9, y: 1, z: 0 }, ...T }])).toEqual([])
  })
  it('it snaps exactly onto the slot', () => {
    const off = snapOffset({ id: 'M', type: 'microbit', position: { x: 5.2, y: 1, z: 0.1 }, ...T }, [{ id: 'S', type: 't_socket', position: { x: 5, y: 0, z: 0 }, ...T }])
    expect(off.x).toBeCloseTo(-0.2); expect(off.z).toBeCloseTo(-0.1); expect(off.y).toBeCloseTo(0)
  })
  it('seated, the micro:bit pin reaches the socket header through its internal join', () => {
    const kit = createKit({ board: 'microbit' })
    kit.scene({ M: 'microbit', S: 't_socket', R: { type: 'resistor', resistance: 1000 } }, [['M:P0', 'S:S0'], ['S:H0', 'R:1'], ['R:2', 'M:GND']])
    kit.pinMode(0, 'output'); kit.write(0, 1); kit.step(0.02)
    expect(kit.state('R').current).toBeCloseTo(3.3 / 1025, 5)
  })
})
