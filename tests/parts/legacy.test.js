// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// The per-aspect contract for the parts that existed BEFORE the catalogue
// (Uno, LED, servo, motors, piezo, the PIR / ultrasonic / soil / gas modules).
// Same aspects as tests/parts/catalog.test.js, run against their real code:
// electronicsFactory models and pin tables, the scene store, the circuit
// solver's legacy adapters, arduino/sensorSim.js, Blockly, and the GLB assets
// they are drawn with. Describe titles "legacy:<Tinkercad name>" feed the
// dashboard.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { Scene, Box3, Vector3 } from 'three'
import * as Blockly from 'blockly'
import { loadParts } from '../../src/parts/registry.js'
import { objectManager } from '../../src/managers/ObjectManager.js'
import { PIN_DEFS as PIN_3D, addPinSpheresToGroup } from '../../src/utils/electronicsFactory.js'
import { PIN_DEFS as WIRE_PINS, pinRole } from '../../src/utils/wiring.js'
import { useSceneStore } from '../../src/stores/sceneStore.js'
import { buildPinToComponentMap, buildSensorInputMap } from '../../src/stores/electronicsStore.js'
import { buildNets } from '../../src/circuit/CircuitSim.js'
import { createKit } from '../../src/parts/testkit.js'
import { runSketch } from '../../src/parts/sketchRunner.js'
import { ultrasonicCm, ultrasonicEchoUs, irDetects, gasDigital, moduleAnalogRaw, moduleDigital, moduleLevel } from '../../src/arduino/sensorSim.js'
import { arduinoGenerator } from '../../src/blockly/arduinoGenerator.js'
import { defineArduinoBlocks } from '../../src/blockly/arduinoBlocks.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'

await loadParts()
objectManager.init(new Scene())
// jsdom has no 2D canvas. Some part models print their silkscreen text onto a
// canvas texture; a no-op context lets them build (the geometry under test is
// real — only the texture's pixels are skipped).
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {}
  const ctx = new Proxy({ measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createLinearGradient: () => ({ addColorStop: noop }) },
    { get: (t, k) => (k in t ? t[k] : noop), set: () => true })
  HTMLCanvasElement.prototype.getContext = function () { return ctx }
}

/** A real glTF 2.0 binary with meshes, and its extent from the POSITION accessors' min/max. */
function glbInfo(file) {
  const path = `public/models/${file}.glb`
  expect(existsSync(path), `${path} exists`).toBe(true)
  const buf = readFileSync(path)
  expect(buf.toString('ascii', 0, 4), 'glTF magic').toBe('glTF')
  expect(buf.readUInt32LE(4), 'glTF version').toBe(2)
  const jsonLen = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen))
  const prims = (gltf.meshes ?? []).flatMap(m => m.primitives)
  const ext = prims.map(p => gltf.accessors[p.attributes.POSITION]).filter(a => a?.min && a?.max)
    .map(a => Math.max(...a.max.map((v, i) => v - a.min[i])))
  return { meshes: gltf.meshes?.length ?? 0, prims: prims.length, maxExtent: Math.max(0, ...ext) }
}
function compiles(code) {
  expect(analyzeArduino(code, { board: 'arduino' }).errors.map(e => `${e.line}: ${e.message}`), code).toEqual([])
  expect(parseAndTranspile(code, new Set()).error, code).toBeFalsy()
}
function blockCode(type, setup) {
  defineArduinoBlocks()
  const ws = new Blockly.Workspace()
  const top = ws.newBlock('arduino_setup_loop'), b = ws.newBlock(type)
  setup?.(b, ws)
  if (b.outputConnection) { const pr = ws.newBlock('arduino_serial_print'); pr.getInput('VALUE').connection.connect(b.outputConnection); top.getInput('LOOP').connection.connect(pr.previousConnection) }
  else top.getInput('LOOP').connection.connect(b.previousConnection)
  const code = arduinoGenerator.workspaceToCode(ws); ws.dispose(); return code
}
const num = (ws, v) => { const n = ws.newBlock('math_number'); n.setFieldValue(String(v), 'NUM'); return n }

const ITEMS = [
  {
    name: 'Arduino Uno R3', type: 'arduino', glb: 'arduino_uno', pins: 28,
    sim(kit) {
      kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 1000 } }, [['U:D13', 'R:1'], ['R:2', 'U:GND1']])
      kit.pinMode(13, 'output'); kit.write(13, 1); kit.step(0.02)
      kit.near(kit.state('R').current, 5 / 1025, 2e-5, 'D13 HIGH drives 5 V through its ≈25 Ω output')
      kit.near(kit.pinVoltage(13), 5 * 1000 / 1025, 0.01)
    },
    code: () => compiles(blockCode('arduino_digitalwrite')),
  },
  {
    name: 'LED', type: 'led', glb: 'led', pins: 2,
    sim(kit) {
      kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 220 }, L: 'led' }, [['U:D9', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND1']])
      kit.pinMode(9, 'output'); kit.write(9, 1); kit.step(0.02)
      // (5 − ≈1.9 V red) / (220 + 25 + 8) Ω ≈ 12 mA → ≈ 60 % of the 20 mA rating.
      kit.between(kit.state('L').current, 0.011, 0.0135, 'LED current through 220 Ω'); kit.between(kit.led.L, 130, 175)
    },
    code: () => compiles(blockCode('arduino_digitalwrite')),
  },
  {
    name: 'Piezo', type: 'buzzer', glb: 'buzzer', pins: 2,
    sim(kit) {
      kit.scene({ U: 'arduino', Q: 'npn_transistor', RB: { type: 'resistor', resistance: 1000 }, Z: 'buzzer' },
        [['U:D8', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'Z:SIGNAL'], ['Z:GND', 'Q:C']])
      kit.pinMode(8, 'output'); kit.write(8, 1); kit.step(0.02)
      kit.equal(kit.beep.Z, true, 'sounds when the transistor switches it on')
      kit.write(8, 0); kit.step(0.02)
      kit.equal(kit.beep.Z, false, 'silent when off')
    },
    code: () => compiles('void setup() { pinMode(8, OUTPUT); }\nvoid loop() { tone(8, 440, 200); delay(300); noTone(8); }'),
  },
  ...[['DC Motor', 'motor_dc', 'motor_dc'], ['Hobby Gearmotor', 'motor_bo', 'motor_bo']].map(([name, type, glb]) => ({
    name, type, glb, pins: 2,
    sim(kit) {
      kit.scene({ U: 'arduino', Q: 'npn_transistor', RB: { type: 'resistor', resistance: 470 }, M: type },
        [['U:D3', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'M:TERM_A'], ['M:TERM_B', 'Q:C']])
      kit.pinMode(3, 'output'); kit.write(3, 1); kit.step(0.02)
      kit.ok(kit.motor.M > 150, `runs when switched on (speed ${kit.motor.M})`)
      kit.write(3, 0); kit.step(0.02)
      kit.ok(Math.abs(kit.motor.M) < 3, 'stops when off')
    },
    code: () => compiles('void setup() { pinMode(3, OUTPUT); }\nvoid loop() { analogWrite(3, 180); delay(500); analogWrite(3, 0); delay(500); }'),
  })),
  ...['Micro Servo', 'Positional Micro Servo'].map((name) => ({
    name, type: 'servo', glb: 'servo', pins: 3,
    async sim(kit) {
      kit.scene({ U: 'arduino', S: 'servo' }, [['U:D9', 'S:SIGNAL'], ['S:VCC', 'U:5V'], ['S:GND', 'U:GND1']])
      const s = runSketch(kit, '#include <Servo.h>\nServo s;\nvoid setup() { s.attach(9); s.write(45); }\nvoid loop() { delay(20); }')
      await s.run(80); s.stop()
      kit.equal(kit.servo[9], 45, 'Servo.write(45) reaches the servo on pin 9')
    },
    code: () => compiles(blockCode('arduino_servo_write', (b, ws) => b.getInput('ANGLE').connection.connect(num(ws, 90).outputConnection))),
  })),
  {
    name: 'PIR Sensor', type: 'pir_sensor', glb: null, pins: 3,
    sim(kit) {
      void kit
      // HC-SR501: OUT HIGH while it sees motion, LOW otherwise (sensorSim, used by SimulationManager).
      expect(moduleDigital('pir_sensor', moduleLevel({ sensorValues: { P: 1 } }, 'pir_sensor', 'P'))).toBe(1)
      expect(moduleDigital('pir_sensor', moduleLevel({ sensorValues: { P: 0 } }, 'pir_sensor', 'P'))).toBe(0)
      expect(moduleDigital('pir_sensor', null), 'unpowered reads LOW').toBe(0)
    },
    code: () => compiles(blockCode('sensor_pir_motion')),
  },
  {
    name: 'Ultrasonic Distance Sensor (4-pin)', type: 'ultrasonic', glb: 'ultrasonic', pins: 4,
    sim() {
      // 20 units = 100 cm → echo 100 · 58 = 5800 µs; nothing in range → 400 cm (its max).
      expect(ultrasonicCm(20)).toBe(100); expect(ultrasonicEchoUs(100)).toBe(5800)
      expect(ultrasonicCm(null)).toBe(400); expect(ultrasonicCm(500)).toBe(400)
      // The classic sketch's conversion recovers the distance from the echo.
      expect(Math.round(ultrasonicEchoUs(ultrasonicCm(7)) / 58)).toBe(35)
      // The neighbouring IR obstacle module trips within 30 cm.
      expect(irDetects(6)).toBe(1); expect(irDetects(7)).toBe(0)
    },
    code: () => compiles('const int trig = 9, echo = 10;\nvoid setup() { Serial.begin(9600); pinMode(trig, OUTPUT); pinMode(echo, INPUT); }\nvoid loop() { digitalWrite(trig, LOW); delayMicroseconds(2); digitalWrite(trig, HIGH); delayMicroseconds(10); digitalWrite(trig, LOW); long d = pulseIn(echo, HIGH) / 58; Serial.println(d); delay(100); }'),
  },
  {
    name: 'Soil Moisture Sensor', type: 'soil_moisture', glb: null, pins: 4,
    sim() {
      // AO = 1015 − 7.65 · moisture %; DO goes LOW once wetter than the 40 % trim-pot threshold.
      expect(moduleAnalogRaw('soil_moisture', 0)).toBe(1015)
      expect(moduleAnalogRaw('soil_moisture', 30)).toBe(Math.round(1015 - 30 * 7.65))
      expect(moduleDigital('soil_moisture', 30)).toBe(1); expect(moduleDigital('soil_moisture', 60)).toBe(0)
    },
    code: () => compiles(blockCode('sensor_soil_moisture')),
  },
  {
    name: 'Gas Sensor', type: 'gas_sensor', glb: 'gas_sensor', pins: 4,
    sim() {
      // MQ module: the DO comparator trips above mid-scale.
      expect(gasDigital(300)).toBe(0); expect(gasDigital(513)).toBe(1); expect(gasDigital(512)).toBe(0)
    },
    code: () => compiles('void setup() { Serial.begin(9600); }\nvoid loop() { int v = analogRead(A0); if (v > 512) { Serial.println("gas!"); } delay(200); }'),
  },
]

for (const item of ITEMS) {
  describe(`legacy:${item.name}`, () => {
    it('model', () => {
      if (item.glb) {
        const g = glbInfo(item.glb)
        expect(g.meshes, 'the GLB has meshes').toBeGreaterThan(0)
        expect(g.maxExtent, 'and real geometry').toBeGreaterThan(0)
      }
      const o = { id: `M_${item.type}`, type: item.type, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff0000' }
      const mesh = objectManager.createMesh(o)
      const size = new Box3().setFromObject(mesh).getSize(new Vector3())
      expect(size.length(), 'the scene object has a size').toBeGreaterThan(0)
      objectManager.removeMesh(o.id)
    })
    it('pins', () => {
      const names = WIRE_PINS[item.type]
      expect(names.length).toBe(item.pins)
      const defs3d = PIN_3D[item.type]
      // The Arduino's 3D pins are placed on its GLB at load time; the static table is the fallback.
      expect(new Set(Object.keys(defs3d))).toEqual(new Set(names))
      for (const d of Object.values(defs3d)) for (const a of ['x', 'y', 'z']) expect(Number.isFinite(d[a])).toBe(true)
      const g = new Scene(); g.userData = {}
      addPinSpheresToGroup(g, 'X', item.type)
      let n = 0; g.traverse(c => { if (c.userData.isPinSphere) n++ })
      expect(n).toBe(item.pins)
    })
    it('placement', () => {
      const store = useSceneStore.getState()
      const o = store.addObject(item.type)
      store.updateObject(o.id, { position: { x: 2, y: o.position.y, z: 1 }, rotation: { x: 0, y: 1.2, z: 0 } })
      const m = useSceneStore.getState().objects.find(x => x.id === o.id)
      expect([m.position.x, m.rotation.y]).toEqual([2, 1.2])
      useSceneStore.getState().removeObject(o.id)
      expect(useSceneStore.getState().objects.some(x => x.id === o.id)).toBe(false)
    })
    it('wiring', () => {
      for (const p of WIRE_PINS[item.type]) expect(['power', 'gnd', 'signal']).toContain(pinRole(p))
      if (item.type !== 'arduino') {
        // Wire its drive / output pin to D7: the two pins form one net, and the
        // simulator's pin map routes D7 to this part (actuators) or reads it (sensors).
        const sig = { led: 'ANODE', buzzer: 'SIGNAL', motor_dc: 'TERM_A', motor_bo: 'TERM_A', servo: 'SIGNAL',
          pir_sensor: 'OUT', ultrasonic: 'ECHO', soil_moisture: 'AO', gas_sensor: 'AO' }[item.type]
        const objs = [{ id: 'U', type: 'arduino' }, { id: 'X', type: item.type }]
        const conns = { w: { fromPinId: 'U:D7', toPinId: `X:${sig}` }, v: { fromPinId: 'X:VCC', toPinId: 'U:5V' }, g: { fromPinId: 'X:GND', toPinId: 'U:GND1' } }
        const uf = buildNets(objs, conns)
        expect(uf.find(`X:${sig}`)).toBe(uf.find('U:D7'))
        if (['led', 'buzzer', 'motor_dc', 'motor_bo', 'servo'].includes(item.type)) {
          expect(buildPinToComponentMap(conns, objs)[7]?.some(c => c.id === 'X'), 'D7 drives it').toBe(true)
        } else {
          expect(buildSensorInputMap(conns, objs)[7]?.id, 'D7 reads it (powered)').toBe('X')
          // …and an unpowered sensor reads as disconnected, like the real module.
          expect(buildSensorInputMap({ w: conns.w }, objs)[7]).toBeUndefined()
        }
      }
    })
    it('simulation', async () => { await item.sim(createKit()) })
    it('codegen', () => item.code())
    it('saveload', () => {
      const store = useSceneStore.getState()
      const o = store.addObject(item.type)
      const back = JSON.parse(JSON.stringify(useSceneStore.getState().objects.find(x => x.id === o.id)))
      expect(back).toEqual(useSceneStore.getState().objects.find(x => x.id === o.id))
      const m1 = objectManager.createMesh({ ...back, id: `S_${item.type}` })
      let pins = 0; m1.traverse(c => { if (c.userData.isPinSphere) pins++ })
      objectManager.removeMesh(`S_${item.type}`)
      useSceneStore.getState().removeObject(o.id)
      expect(m1.isObject3D).toBe(true)
      void pins
    })
  })
}
