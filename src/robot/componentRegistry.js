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
registerComponent({ type: 'dc_motor', category: 'actuator', label: 'DC Motor', icon: '🔧', role: 'drive', physicsModules: DRIVE, capabilities: { actuator: 'rotational', mobility: 'rolling' } }) // alias key

// Actuators — servo (articulated)
registerComponent({ type: 'servo', category: 'actuator', label: 'Servo', icon: '🔩', role: 'servo', physicsModules: ['ServoPhysics', 'JointConstraints'], capabilities: { actuator: 'rotational' } })

// Outputs
registerComponent({ type: 'led',    category: 'output', label: 'LED',    icon: '💡', role: 'output', capabilities: { output: 'light' } })
registerComponent({ type: 'buzzer', category: 'output', label: 'Buzzer', icon: '🔊', role: 'output', capabilities: { output: 'audio' } })
registerComponent({ type: 'oled',   category: 'output', label: 'OLED',   icon: '🖵', role: 'output', capabilities: { output: 'display' } })

// Sensors
registerComponent({ type: 'ultrasonic', category: 'sensor', label: 'Ultrasonic', icon: '📡', role: 'range', physicsModules: ['RangeSensorSim'], capabilities: { sensor: 'range' } })
registerComponent({ type: 'ir_sensor',  category: 'sensor', label: 'IR Sensor',  icon: '🔆', role: 'ir',    physicsModules: ['RangeSensorSim'], capabilities: { sensor: 'proximity' } })
registerComponent({ type: 'ir',         category: 'sensor', label: 'IR Sensor',  icon: '🔆', role: 'ir',    physicsModules: ['RangeSensorSim'], capabilities: { sensor: 'proximity' } }) // alias key
registerComponent({ type: 'gas_sensor', category: 'sensor', label: 'Gas Sensor', icon: '🟤', role: 'gas',   physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'gas' } })
registerComponent({ type: 'gas',        category: 'sensor', label: 'Gas Sensor', icon: '🟤', role: 'gas',   physicsModules: ['AnalogSensorSim'], capabilities: { sensor: 'gas' } }) // alias key
registerComponent({ type: 'imu',        category: 'sensor', label: 'IMU',        icon: '🧭', role: 'imu',   physicsModules: ['IMUSim'],         capabilities: { sensor: 'orientation' } })
