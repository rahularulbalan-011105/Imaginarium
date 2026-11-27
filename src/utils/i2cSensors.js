// ─────────────────────────────────────────────────────────────────────────────
// i2cSensors — the BMP280 and MPU6050 boards on the I²C bus.
//
// Unlike the digital/analog modules these don't feed a numbered pin: they sit
// on SDA/SCL and answer at an address. This works out, for each such part:
//   kind     — 'bmp280' | 'mpu6050' (accelerometer and gyroscope are both a GY-521)
//   addr     — BMP280: 0x76 (SDO low / open, the GY-BMP280 default) · 0x77 (SDO → VCC)
//              MPU6050: 0x68 (AD0 low / open, the GY-521 default)  · 0x69 (AD0 → VCC)
//   sda/scl  — that line reaches the controller's I²C pin (directly or through
//              another I²C part on the same bus)
//   swapped  — SDA went to the board's SCL (or the other way round)
//   powered  — VCC on a controller supply pin and GND on a controller ground
// Board I²C pins come from the same table the PCA9685 uses (utils/pca9685.js).
// ─────────────────────────────────────────────────────────────────────────────
import { BOARD_I2C } from './pca9685.js'

export const I2C_SENSOR_KIND = { bmp280: 'bmp280', accelerometer: 'mpu6050', gyroscope: 'mpu6050' }
export const I2C_SENSOR_TYPES = new Set(Object.keys(I2C_SENSOR_KIND))
const ADDR = { bmp280: [0x76, 0x77, 'SDO'], mpu6050: [0x68, 0x69, 'AD0'] }
const BOARDS = new Set(Object.keys(BOARD_I2C))

/** Union-find over wired pins → the pins on the same net as a given pin. */
function netMembers(connections) {
  const parent = new Map()
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a) } return a }
  for (const { fromPinId, toPinId } of Object.values(connections ?? {})) {
    for (const p of [fromPinId, toPinId]) if (!parent.has(p)) parent.set(p, p)
    const ra = find(fromPinId), rb = find(toPinId)
    if (ra !== rb) parent.set(ra, rb)
  }
  const groups = new Map()
  for (const p of parent.keys()) { const r = find(p); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p) }
  return (pinId) => (parent.has(pinId) ? groups.get(find(pinId)) : [])
}

/** { [partId]: { kind, type, addr, sda, scl, swapped, powered } } */
export function i2cSensorWiring(connections, objects, { isSupply, isGround }) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const members = netMembers(connections)
  const pinsOn = (pinId) => members(pinId).map((p) => { const [id, pin] = p.split(':'); return { id, pin, type: byId.get(id)?.type } })
  const boardHas = (pinId, line) => pinsOn(pinId).some(({ type, pin }) => {
    if (!BOARDS.has(type)) return false
    const want = BOARD_I2C[type][line]
    return want ? want.includes(pin) : /^IO\d+$/.test(pin)
  })
  const strict = (pinId, line) => pinsOn(pinId).some(({ type, pin }) => BOARD_I2C[type]?.[line]?.includes(pin))
  const touches = (pinId, test) => pinsOn(pinId).some((p) => BOARDS.has(p.type) && test(p.pin))
  const out = {}
  for (const o of objects) {
    const kind = I2C_SENSOR_KIND[o.type]
    if (!kind) continue
    const id = o.id
    const [lo, hi, selPin] = ADDR[kind]
    out[id] = {
      kind, type: o.type,
      addr: touches(`${id}:${selPin}`, isSupply) ? hi : lo,
      sda: boardHas(`${id}:SDA`, 'SDA'),
      scl: boardHas(`${id}:SCL`, 'SCL'),
      swapped: strict(`${id}:SDA`, 'SCL') || strict(`${id}:SCL`, 'SDA'),
      powered: touches(`${id}:VCC`, isSupply) && touches(`${id}:GND`, isGround),
    }
  }
  return out
}
