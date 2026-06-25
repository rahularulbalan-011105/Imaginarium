import { MODULE_REGISTRY } from './modules.js'

// Capability-based module loading. Maps a blueprint's locomotion type AND its
// installed components to the set of physics modules that should be active.
// Declarative on purpose: a new robot type only needs entries here + module
// classes — no changes to the runtime or DriveManager.

export const LOCOMOTION_MODULES = {
  wheels: ['WheelPhysics', 'MotorPhysics', 'DifferentialDrivePhysics'],
  tracks: ['TrackPhysics', 'SlipPhysics', 'TerrainPhysics'],
  legs:   ['ServoPhysics', 'JointPhysics', 'InverseKinematics', 'BalanceSystem', 'GaitEngine'],
  rotors: ['RotorPhysics', 'FlightController', 'WindPhysics'],
  marine: ['BuoyancyPhysics', 'ThrusterPhysics', 'HydroDragPhysics'],
  hybrid: [],   // union of the sub-locomotion blocks it declares (locomotion.parts)
}

// Component type → modules it enables (component-based detection layered on top
// of the locomotion type). Keys match actuator/sensor `type` values.
export const CAPABILITY_MODULES = {
  servo:      ['ServoPhysics', 'JointConstraints'],
  dc_motor:   ['WheelPhysics', 'DrivePhysics'],
  motor:      ['WheelPhysics', 'DrivePhysics'],
  motor_bo:   ['WheelPhysics', 'DrivePhysics'],
  motor_dc:   ['WheelPhysics', 'DrivePhysics'],
  imu:        ['IMUSim'],
  ultrasonic: ['RangeSensorSim'],
  ir:         ['RangeSensorSim'],
  ir_sensor:  ['RangeSensorSim'],
  gas:        ['AnalogSensorSim'],
  gas_sensor: ['AnalogSensorSim'],
}

// Resolve the de-duplicated set of module keys for a blueprint.
export function resolveModuleKeys(blueprint) {
  const keys = new Set()
  const loco = blueprint?.locomotion?.type
  for (const k of (LOCOMOTION_MODULES[loco] ?? [])) keys.add(k)
  if (loco === 'hybrid') {
    for (const sub of (blueprint.locomotion.parts ?? [])) {
      for (const k of (LOCOMOTION_MODULES[sub] ?? [])) keys.add(k)
    }
  }
  for (const a of (blueprint?.actuators ?? [])) for (const k of (CAPABILITY_MODULES[a.type] ?? [])) keys.add(k)
  for (const s of (blueprint?.sensors ?? []))   for (const k of (CAPABILITY_MODULES[s.type] ?? [])) keys.add(k)
  return [...keys]
}

// Instantiate the modules for a blueprint (unknown keys skipped gracefully).
export function loadModules(blueprint) {
  return resolveModuleKeys(blueprint)
    .map(key => { const C = MODULE_REGISTRY[key]; return C ? new C() : null })
    .filter(Boolean)
}

export function moduleLabels(blueprint) {
  return resolveModuleKeys(blueprint).map(k => MODULE_REGISTRY[k]?.label ?? k)
}
