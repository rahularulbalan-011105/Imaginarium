// Module sensors (PIR · flame · soil · rain · sound · touch · BMP280 ·
// accelerometer · gyroscope · Hall): pin tables, 3D models, wiring, the real
// module polarities, the I²C bus, the sandbox libraries and the example sketches.
import { describe, it, expect, beforeAll } from 'vitest'
import vm from 'node:vm'
import * as THREE from 'three'
import { PIN_DEFS as WIRING_PINS, ELEC_TYPES } from '../../src/utils/wiring.js'
import { buildSensorInputMap, isSensorPowered, isSupplyPinName, isGroundPinName, SENSOR_TYPES } from '../../src/stores/electronicsStore.js'
import { i2cSensorWiring } from '../../src/utils/i2cSensors.js'
import * as sim from '../../src/arduino/sensorSim.js'
import { createMotionTracker } from '../../src/arduino/motionSim.js'
import { bootstrapHtml } from '../../src/managers/sketchSandbox.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { SENSOR_EXAMPLES } from '../../src/arduino/sensorExamples.js'
import { shapeOf } from '../../src/components/WiringWorkbench.jsx'

const TYPES = ['pir_sensor', 'flame_sensor', 'soil_moisture', 'rain_sensor', 'sound_sensor', 'touch_sensor', 'bmp280', 'accelerometer', 'gyroscope', 'hall_sensor']
const conns = (pairs) => Object.fromEntries(pairs.map(([a, b], i) => [`c${i}`, { fromPinId: a, toPinId: b }]))
const deps = { isSupply: isSupplyPinName, isGround: isGroundPinName }

// The models draw silkscreen on a canvas; Node has none, so give them a no-op one.
let factory
beforeAll(async () => {
  const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 5 }) : () => {}), set: () => true })
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) }
  factory = await import('../../src/utils/electronicsFactory.js')
})

describe('pin tables', () => {
  it('every new type is registered for wiring and as a sensor', () => {
    for (const t of TYPES) {
      expect(ELEC_TYPES.has(t), t).toBe(true)
      expect(SENSOR_TYPES.has(t), t).toBe(true)
    }
  })
  it('the 3D pins and the wiring panel list the same pins in the same order', () => {
    for (const t of TYPES) expect(Object.keys(factory.PIN_DEFS[t]), t).toEqual(WIRING_PINS[t])
  })
  it('real module pinouts', () => {
    expect(WIRING_PINS.pir_sensor).toEqual(['VCC', 'OUT', 'GND'])
    expect(WIRING_PINS.sound_sensor).toEqual(['AO', 'GND', 'VCC', 'DO'])
    expect(WIRING_PINS.bmp280).toEqual(['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'])
    expect(WIRING_PINS.accelerometer).toEqual(['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'])
  })
  it('header pins are on a 2.54 mm pitch', () => {
    for (const t of TYPES) {
      const xs = Object.values(factory.PIN_DEFS[t]).map((p) => p.x)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(0.254, 6)
    }
  })
  it('the workbench draws each module with its pins', () => {
    for (const t of TYPES) {
      const shape = shapeOf(t)
      expect(Object.keys(shape.pins ?? {}).length || shape.pins.length, t).toBe(WIRING_PINS[t].length)
    }
  })
})

describe('3D models', () => {
  it('builds every module at its real size (1 unit = 1 cm)', () => {
    const size = (t) => new THREE.Box3().setFromObject(factory.createModuleSensorGroup(t)).getSize(new THREE.Vector3())
    const pir = size('pir_sensor')
    expect(pir.x).toBeCloseTo(3.2, 1)                          // HC-SR501 32 × 24 mm
    expect(pir.z).toBeCloseTo(2.4, 1)
    expect(size('accelerometer').x).toBeCloseTo(2.1, 1)        // GY-521 21 mm
    expect(size('bmp280').x).toBeCloseTo(1.5, 1)               // GY-BMP280 15 mm
    expect(size('soil_moisture').z).toBeGreaterThan(10)        // probe + lead + comparator
  })
  it('every pin sphere sits on the tip of a real header pin', () => {
    for (const t of TYPES) {
      const g = factory.createModuleSensorGroup(t)
      g.updateMatrixWorld(true)
      const golds = []
      g.traverse((c) => { if (c.isMesh && c.material?.color?.getHex() === 0xd4a017 && c.geometry.type === 'BoxGeometry') golds.push(new THREE.Box3().setFromObject(c).expandByScalar(0.03)) })
      for (const [name, p] of Object.entries(factory.PIN_DEFS[t])) {
        const hit = golds.some((b) => b.containsPoint(new THREE.Vector3(p.x, p.y, p.z)))
        expect(hit, `${t}:${name}`).toBe(true)
      }
    }
  })
  it('the board is the only outlined mesh and the modules have their LEDs', () => {
    const g = factory.createModuleSensorGroup('flame_sensor')
    const outlined = []
    g.traverse((c) => { if (c.isMesh && !c.userData.noOutline) outlined.push(c.name) })
    expect(outlined).toEqual(['pcb'])
    expect(g.userData.moduleLeds.pwr).toBeTruthy()
    expect(g.userData.moduleLeds.sig).toBeTruthy()
  })
})

describe('wiring → controller inputs', () => {
  const arduinoFlame = conns([['F:VCC', 'A:5V'], ['F:GND', 'A:GND1'], ['F:DO', 'A:D3'], ['F:AO', 'A:D4']])
  const objs = [{ id: 'A', type: 'arduino' }, { id: 'F', type: 'flame_sensor' }]
  it('DO and AO each feed their pin once powered', () => {
    expect(isSensorPowered(arduinoFlame, objs, 'F')).toBe(true)
    const map = buildSensorInputMap(arduinoFlame, objs)
    expect(map[3]).toMatchObject({ id: 'F', pin: 'DO' })
    expect(map[4]).toMatchObject({ id: 'F', pin: 'AO' })
  })
  it('no ground → reads as dead', () => {
    const c = conns([['F:VCC', 'A:5V'], ['F:DO', 'A:D3']])
    expect(buildSensorInputMap(c, objs)[3]).toBeUndefined()
  })
})

describe('real module polarities', () => {
  const store = (v) => ({ sensorValues: v })
  it('flame: DO LOW on a flame, AO falls', () => {
    const none = sim.moduleLevel(store({}), 'flame_sensor', 'f')
    const fire = sim.moduleLevel(store({ f: 90 }), 'flame_sensor', 'f')
    expect(sim.moduleDigital('flame_sensor', none)).toBe(1)
    expect(sim.moduleDigital('flame_sensor', fire)).toBe(0)
    expect(sim.moduleAnalogRaw('flame_sensor', fire)).toBeLessThan(sim.moduleAnalogRaw('flame_sensor', none) - 500)
  })
  it('soil: ~1023 dry, low when soaked, DO LOW when wet', () => {
    expect(sim.moduleAnalogRaw('soil_moisture', 0)).toBeGreaterThan(1000)
    expect(sim.moduleAnalogRaw('soil_moisture', 100)).toBeLessThan(300)
    expect(sim.moduleDigital('soil_moisture', 80)).toBe(0)
    expect(sim.moduleDigital('soil_moisture', 10)).toBe(1)
  })
  it('rain DO LOW when wet · sound DO HIGH when loud · AO centred ~512 when quiet', () => {
    expect(sim.moduleDigital('rain_sensor', 60)).toBe(0)
    expect(sim.moduleDigital('sound_sensor', 80)).toBe(1)
    expect(sim.moduleDigital('sound_sensor', 5)).toBe(0)
    expect(Math.abs(sim.moduleAnalogRaw('sound_sensor', 0) - 512)).toBeLessThan(10)
  })
  it('PIR / touch HIGH when active · Hall LOW on a magnet', () => {
    expect(sim.moduleDigital('pir_sensor', 1)).toBe(1)
    expect(sim.moduleDigital('touch_sensor', 1)).toBe(1)
    expect(sim.moduleDigital('hall_sensor', 1)).toBe(0)
    expect(sim.moduleDigital('hall_sensor', 0)).toBe(1)
  })
  it('a disconnected module reads 0', () => {
    expect(sim.moduleLevel(store({ f: 90 }), 'flame_sensor', null)).toBeNull()
    expect(sim.moduleDigital('flame_sensor', null)).toBe(0)
    expect(sim.moduleAnalogRaw('flame_sensor', null)).toBe(0)
  })
})

describe('I²C bus', () => {
  const base = [['B:VCC', 'A:5V'], ['B:GND', 'A:GND1'], ['B:SDA', 'A:SDA'], ['B:SCL', 'A:SCL']]
  const objs = [{ id: 'A', type: 'arduino' }, { id: 'B', type: 'bmp280' }, { id: 'M', type: 'accelerometer' }]
  it('a powered BMP280 on SDA/SCL answers at 0x76; SDO → VCC moves it to 0x77', () => {
    expect(i2cSensorWiring(conns(base), objs, deps).B).toMatchObject({ kind: 'bmp280', addr: 0x76, sda: true, scl: true, powered: true, swapped: false })
    expect(i2cSensorWiring(conns([...base, ['B:SDO', 'A:5V']]), objs, deps).B.addr).toBe(0x77)
  })
  it('swapped lines are caught', () => {
    const w = i2cSensorWiring(conns([['B:VCC', 'A:5V'], ['B:GND', 'A:GND1'], ['B:SDA', 'A:SCL'], ['B:SCL', 'A:SDA']]), objs, deps).B
    expect(w.swapped).toBe(true)
  })
  it('MPU6050 at 0x68, AD0 → VCC → 0x69; ESP32 uses GPIO21/22', () => {
    const m = [['M:VCC', 'A:5V'], ['M:GND', 'A:GND1'], ['M:SDA', 'A:SDA'], ['M:SCL', 'A:SCL']]
    expect(i2cSensorWiring(conns(m), objs, deps).M).toMatchObject({ kind: 'mpu6050', addr: 0x68, powered: true })
    expect(i2cSensorWiring(conns([...m, ['M:AD0', 'A:5V']]), objs, deps).M.addr).toBe(0x69)
    const e = [{ id: 'E', type: 'esp32' }, { id: 'M', type: 'gyroscope' }]
    const ew = i2cSensorWiring(conns([['M:VCC', 'E:3V3'], ['M:GND', 'E:GND1'], ['M:SDA', 'E:GPIO21'], ['M:SCL', 'E:GPIO22']]), e, deps).M
    expect(ew.sda && ew.scl && ew.powered).toBe(true)
  })
})

describe('sensor physics', () => {
  it('BMP280: sea level ≈ 1013 hPa, lower up high', () => {
    expect(sim.pressureAtAltitude(0)).toBeCloseTo(101325, 0)
    expect(sim.pressureAtAltitude(1000) / 100).toBeCloseTo(898.7, 0)
  })
  it('a flat, still MPU6050 reads (0, 0, 1 g); tilt moves gravity onto Y', () => {
    const flat = sim.accelFromTilt(0, 0)
    expect([flat.x, flat.y, flat.z].map((v) => +v.toFixed(3))).toEqual([-0, 0, 1].map((v) => +v.toFixed(3)))
    expect(sim.accelFromTilt(30, 0).y).toBeCloseTo(0.5, 3)
  })
  it('scene motion: a part rolled 90° about X feels gravity on chip −Y… and its spin on the gyro', () => {
    const track = createMotionTracker()
    const o = new THREE.Object3D()
    expect(track('m', o, 0).accel.z).toBeCloseTo(1, 6)
    // Spin about local +Y (chip Z) at 90 °/s for several frames.
    let r
    for (let i = 1; i <= 30; i++) { o.rotation.y = (Math.PI / 2) * (i * 0.02); r = track('m', o, i * 20) }
    expect(r.gyro.z).toBeGreaterThan(80)
    expect(r.gyro.z).toBeLessThan(100)
    expect(r.accel.z).toBeCloseTo(1, 1)
  })
})

// ── the sandbox runtime: Adafruit_BMP280 + MPU6050_light ────────────────────
function sandbox() {
  const js = bootstrapHtml('', '').match(/<script>([\s\S]*)<\/script>/)[1]
  const serial = []
  const ctx = vm.createContext({
    parent: { postMessage: (m) => { if (m?.t === 'out' && m.f === 'serial') serial.push(m.a[0]) } },
    addEventListener: () => {}, performance, setTimeout, console,
  })
  vm.runInContext(js, ctx)
  return { serial, run: (src) => vm.runInContext(src, ctx) }
}

describe('sandbox libraries', () => {
  const bus = JSON.stringify([
    { kind: 'bmp280', addr: 0x76, temp: 21.5, pressure: 95000 },
    { kind: 'mpu6050', addr: 0x68, ax: 0, ay: 0.5, az: 0.866, gx: 1, gy: 2, gz: 45, temp: 28 },
  ])
  it('Adafruit_BMP280: the board answers only at its own address', () => {
    const { run, serial } = sandbox()
    run(`IN = { aread:{}, dread:{}, pulse:{}, enc:{}, lib:{}, i2c: ${bus} }`)
    expect(run('var b = new Adafruit_BMP280(); b.begin()')).toBe(false)          // library default 0x77
    expect(serial.join('')).toMatch(/0x76/)                                     // and the hint says where it is
    expect(run('b.begin(0x76)')).toBe(true)
    expect(run('b.readPressure()')).toBe(95000)
    expect(run('b.readTemperature()')).toBe(21.5)
    expect(run('b.readAltitude(1013.25)')).toBeCloseTo(540, -1)
  })
  it('MPU6050_light: begin() = 0, readings in g and °/s, angles from the filter', () => {
    const { run } = sandbox()
    run(`IN = { aread:{}, dread:{}, pulse:{}, enc:{}, lib:{}, i2c: ${bus} }`)
    expect(run('var m = new MPU6050(Wire); m.begin()')).toBe(0)
    run('m.update()')
    expect(run('m.getAccY()')).toBeCloseTo(0.5, 6)
    expect(run('m.getGyroZ()')).toBe(45)
    expect(run('m.getAngleX()')).toBeCloseTo(30, 0)                            // 30° tilt from the accelerometer
    run('m.calcOffsets(); m.update()')
    expect(run('m.getGyroZ()')).toBeCloseTo(0, 6)
  })
  it('no MPU6050 on the bus → begin() returns a non-zero status', () => {
    const { run } = sandbox()
    run('IN = { aread:{}, dread:{}, pulse:{}, enc:{}, lib:{}, i2c: [] }')
    expect(run('var m = new MPU6050(Wire); m.begin()')).toBe(2)
  })
})

describe('example sketches', () => {
  it('each passes the compiler checks and transpiles', () => {
    const names = new Set(['Adafruit_BMP280', 'MPU6050', 'Wire'])
    for (const { label, code } of SENSOR_EXAMPLES) {
      const diag = analyzeArduino(code)
      expect(diag.errors, `${label}: ${JSON.stringify(diag.errors)}`).toEqual([])
      const { error } = parseAndTranspile(code, names)
      expect(error, label).toBeFalsy()
    }
  })
})
