// ── Component Registry ───────────────────────────────────────────────────────
// Stage 3 of the digital-twin migration.
//
// Single source of truth for a robot COMPONENT's metadata: its category, its
// blueprint role, the physics/simulation modules it enables, and (for later
// stages) its electrical spec. This consolidates capability knowledge that was
// previously hardcoded in two places — ModuleLoader.CAPABILITY_MODULES and
// RobotPanel.scanCapabilities — into one declarative table.
//
// SCOPE / NON-GOALS for this stage (kept behaviour-neutral):
//   • Pin layouts stay in electronicsFactory.PIN_DEFS (keyed by the same `type`).
//   • Mesh creation stays in ObjectManager.createMesh.
//   • Mass stays in MassCalculator.
// Those will reference the registry in later stages; for now the registry only
// owns the capability/role/module metadata the blueprint + module systems read.
//
// Adding a new component type later = one registerComponent() call, no engine edits.

/**
 * @typedef {Object} ComponentDefinition
 * @property {string} type            scene-object type key (matches PIN_DEFS / createMesh)
 * @property {'controller'|'actuator'|'sensor'|'output'|'structure'} category
 * @property {string} label           friendly name
 * @property {string} [icon]
 * @property {string} [role]          blueprint role ('drive'|'servo'|'range'|'ir'|'gas'|'controller'|…)
 * @property {string[]} physicsModules  module keys this component enables (ModuleLoader)
 * @property {Object} capabilities    { actuator?, sensor?, mobility?, controller?, output? }
 * @property {Object} [electrical]    { voltage?, currentDraw_mA?, logic? }  (reserved for power stage)
 */

import { onPartsRegistered } from '../parts/registry.js'

const REGISTRY = {}

/** Register (or override) a component definition. */
export function registerComponent(def) {
  if (!def || !def.type) return
  REGISTRY[def.type] = { physicsModules: [], capabilities: {}, ...def }
}

export function getComponentDef(type)        { return REGISTRY[type] ?? null }
export function allComponents()              { return Object.values(REGISTRY) }
export function componentsByCategory(cat)    { return allComponents().filter(c => c.category === cat) }

/** Physics/simulation module keys a component type enables (used by ModuleLoader). */
export function physicsModulesFor(type)      { return getComponentDef(type)?.physicsModules ?? [] }

/** Blueprint classification used by the wizard scan ({category, role}) or null. */
export function classifyComponent(type) {
  const d = getComponentDef(type)
  if (!d) return null
  return { category: d.category, role: d.role ?? d.category }
}

// ── Built-in components ───────────────────────────────────────────────────────
// These reproduce EXACTLY the previous hardcoded mappings:
//   ModuleLoader.CAPABILITY_MODULES  +  RobotPanel.scanCapabilities roles.

// Controllers
registerComponent({ type: 'arduino', category: 'controller', label: 'Arduino', icon: '🟢', role: 'controller', capabilities: { controller: true }, electrical: { voltage: 5 } })
registerComponent({ type: 'subo',    category: 'controller', label: 'SUBO',    icon: '🟣', role: 'controller', capabilities: { controller: true }, electrical: { voltage: 3.3 } })

// Actuators — drive motors (rolling mobility)
const DRIVE = ['WheelPhysics', 'DrivePhysics']
registerComponent({ type: 'motor',    category: 'actuator', label: 'Motor',    icon: '⚙', role: 'drive', physicsModules: DRIVE, capabilities: { actuator: 'rotational', mobility: 'rolling' } })
registerComponent({ type: 'motor_bo', category: 'actuator', label: 'BO Motor', icon: '⚙', role: 'drive', physicsModules: DRIVE, capabilities: { actuator: 'rotational', mobility: 'rolling' } })
registerComponent({ type: 'motor_dc', category: 'actuator', label: 'DC Motor', icon: '🔧', role: 'drive', physicsModules: DRIVE, capabilities: { actuator: 'rotational', mobility: 'rolling' } })
// Continuous-rotation servo: a drive motor driven by Servo.write (utils/continuousServo.js).
registerComponent({ type: 'servo_cr', category: 'actuator', label: 'Continuous Servo', icon: '🔄', role: 'drive', physicsModules: DRIVE, capabilities: { actuator: 'rotational', mobility: 'rolling' }, electrical: { voltage: 5 } })
registerComponent({ type: 'motor_enc', category: 'actuator', label: 'Encoder Motor', icon: '🎯', role: 'drive', physicsModules: DRIVE, capabilities: { actuator: 'rotational', mobility: 'rolling', sensor: 'encoder' } })
registerComponent({ type: 'dc_motor', category: 'actuator', label: 'DC Motor', icon: '🔧', role: 'drive', physicsModules: DRIVE, capabilities: { actuator: 'rotational', mobility: 'rolling' } }) // alias key

// Actuators — servo (articulated)
registerComponent({ type: 'servo', category: 'actuator', label: 'Servo', icon: '🔩', role: 'servo', physicsModules: ['ServoPhysics', 'JointConstraints'], capabilities: { actuator: 'rotational' } })

// Motor drivers — sit between the controller and the drive motors; no physics of
// their own (the motors they feed carry the drive modules). Logic: utils/l298n.js.
registerComponent({ type: 'l298n', category: 'driver', label: 'L298N Driver', icon: '🎛', role: 'driver', capabilities: { driver: 'dual-h-bridge' }, electrical: { voltage: 12 } })
registerComponent({ type: 'pca9685', category: 'driver', label: 'PCA9685 Servo Driver', icon: '🎚', role: 'driver', capabilities: { driver: 'pwm-16ch', bus: 'i2c' }, electrical: { voltage: 5 } })
registerComponent({ type: 'uln2003', category: 'driver', label: 'ULN2003 Driver', icon: '🟩', role: 'driver', capabilities: { driver: 'darlington-array' }, electrical: { voltage: 5 } })

// Stepper — positional rotation driven by coil steps (utils/stepper.js). No
// physics modules: it turns its shaft (and what's attached) to an exact angle.
registerComponent({ type: 'stepper', category: 'actuator', label: 'Stepper 28BYJ-48', icon: '🌀', role: 'stepper', capabilities: { actuator: 'rotational' }, electrical: { voltage: 5 } })

// Outputs
registerComponent({ type: 'gripper', category: 'output', label: 'Servo Gripper', icon: '🦾', role: 'gripper', capabilities: { output: 'grasp', actuator: 'servo' } })
registerComponent({ type: 'led',    category: 'output', label: 'LED',    icon: '💡', role: 'output', capabilities: { output: 'light' } })
registerComponent({ type: 'buzzer', category: 'output', label: 'Buzzer', icon: '🔊', role: 'output', capabilities: { output: 'audio' } })
registerComponent({ type: 'oled',   category: 'output', label: 'OLED',   icon: '🖵', role: 'output', capabilities: { output: 'display' } })

// Sensors
registerComponent({ type: 'ultrasonic', category: 'sensor', label: 'Ultrasonic', icon: '📡', role: 'range', physicsModules: ['RangeSensorSim'], capabilities: { sensor: 'range' } })
registerComponent({ type: 'ir_sensor',  category: 'sensor', label: 'IR Sensor',  icon: '🔆', role: 'ir',    physicsModules: ['RangeSensorSim'], capabilities: { sensor: 'proximity' } })
registerComponent({ type: 'ir',         category: 'sensor', label: 'IR Sensor',  icon: '🔆', role: 'ir',    physicsModules: ['RangeSensorSim'], capabilities: { sensor: 'proximity' } }) // alias key
registerComponent({ type: 'gas_sensor', category: 'sensor', label: 'Gas Sensor', icon: '🟤', role: 'gas',   physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'gas' } })
registerComponent({ type: 'gas',        category: 'sensor', label: 'Gas Sensor', icon: '🟤', role: 'gas',   physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'gas' } }) // alias key
registerComponent({ type: 'pir_sensor',    category: 'sensor', label: 'PIR Sensor',        icon: '🚶', role: 'motion',   physicsModules: ['RangeSensorSim'],  capabilities: { sensor: 'motion' } })
registerComponent({ type: 'flame_sensor',  category: 'sensor', label: 'Flame Sensor',      icon: '🔥', role: 'flame',    physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'flame' } })
registerComponent({ type: 'soil_moisture', category: 'sensor', label: 'Soil Moisture',     icon: '🌱', role: 'moisture', physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'moisture' } })
registerComponent({ type: 'rain_sensor',   category: 'sensor', label: 'Rain Sensor',       icon: '🌧', role: 'rain',     physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'rain' } })
registerComponent({ type: 'sound_sensor',  category: 'sensor', label: 'Sound Sensor',      icon: '🎤', role: 'sound',    physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'sound' } })
registerComponent({ type: 'touch_sensor',  category: 'sensor', label: 'Touch Sensor',      icon: '👆', role: 'touch',    physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'touch' } })
registerComponent({ type: 'bmp280',        category: 'sensor', label: 'Pressure Sensor',   icon: '🎈', role: 'pressure', physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'pressure', bus: 'i2c' } })
registerComponent({ type: 'accelerometer', category: 'sensor', label: 'Accelerometer',     icon: '📐', role: 'imu',      physicsModules: ['IMUSim'],          capabilities: { sensor: 'acceleration', bus: 'i2c' } })
registerComponent({ type: 'gyroscope',     category: 'sensor', label: 'Gyroscope',         icon: '🌀', role: 'imu',      physicsModules: ['IMUSim'],          capabilities: { sensor: 'rotation', bus: 'i2c' } })
registerComponent({ type: 'hall_sensor',   category: 'sensor', label: 'Hall Effect',       icon: '🧲', role: 'magnet',   physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'magnetic' } })
registerComponent({ type: 'imu',        category: 'sensor', label: 'IMU',        icon: '🧭', role: 'imu',   physicsModules: ['IMUSim'],         capabilities: { sensor: 'orientation' } })

// ── Typical current draw (mA) ─────────────────────────────────────────────────
// Used by PowerSystem to estimate total draw vs the battery budget (Stage 6).
// Rough running figures — refine per real component later.
const DRAW_mA = {
  arduino: 50, subo: 80,
  motor: 250, motor_bo: 250, motor_enc: 260, motor_dc: 250, dc_motor: 250,
  servo: 150,
  gripper: 150, // its servo; ~650 mA while squeezing at stall (SG90)
  servo_cr: 150, // FS90R running, no load ~100–150 mA
  l298n: 36,   // logic quiescent current (datasheet); the motors' draw is counted on the motors
  stepper: 240, // 28BYJ-48 5 V: ~120 mA per coil, two coils on in full step
  uln2003: 5,
  pca9685: 10, // chip only; the servos' draw is counted on the servos
  led: 20, buzzer: 30, oled: 20,
  ultrasonic: 15, ir_sensor: 25, ir: 25, gas_sensor: 150, gas: 150, imu: 10,
  pir_sensor: 1, flame_sensor: 15, soil_moisture: 35, rain_sensor: 15, sound_sensor: 5, touch_sensor: 2,
  bmp280: 1, accelerometer: 4, gyroscope: 4, hall_sensor: 5,
}
for (const [type, mA] of Object.entries(DRAW_mA)) {
  const d = getComponentDef(type)
  if (d) d.electrical = { ...(d.electrical ?? {}), currentDraw_mA: mA }
}

// ── Catalogue parts (src/parts) ───────────────────────────────────────────────
const ROLE_OF_CAT = { mcu: 'controller', sensors: 'sensor', input: 'sensor', lights: 'output', displays: 'output', actuators: 'actuator', drivers: 'driver', power: 'power' }
const CAT_OF = { mcu: 'controller', sensors: 'sensor', input: 'sensor', actuators: 'actuator', drivers: 'driver', lights: 'output', displays: 'output' }
onPartsRegistered((p) => {
  if (getComponentDef(p.type)) return
  registerComponent({ type: p.type, category: CAT_OF[p.category] ?? 'structure', label: p.label, icon: p.icon, role: ROLE_OF_CAT[p.category] ?? p.category,
    capabilities: p.capabilities ?? {}, electrical: { voltage: p.spec?.vcc, currentDraw_mA: p.currentDraw_mA ?? 0 } })
})
