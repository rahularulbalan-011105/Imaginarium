// Physics configuration: defaults, resolution and project migration.
//
// Where configuration lives (so it rides the EXISTING save/load + undo paths):
//   • per object   obj.physics = { material, mass, collider, servo, joint, encoder }
//                  → objects are saved verbatim and are an undo slice.
//   • per robot    rootObj.physics.robot = { model, forward, gait, balance, power, imu }
//                  → stored on the assembly's root object, so it works for
//                    auto-blueprints too (they are ephemeral, never persisted).
//   • world        project.physics = { gravity, timestep, solverIterations, terrain }
//                  → a new top-level snapshot key, migrated with defaults.
// Everything is SPARSE: only overrides are stored; absent = default. Old projects
// (no `physics` anywhere) therefore load unchanged and behave with defaults.
import { DEFAULT_GAIT } from './gait.js'
import { DEFAULT_BALANCE } from './balance.js'
import { DEFAULT_BATTERY } from './BatteryModel.js'
import { DEFAULT_IMU, DEFAULT_ENCODER } from './sensors.js'
import { DEFAULT_THERMAL } from './ThermalModel.js'
import { DEFAULT_SERVO_PRESET } from './ServoActuator.js'

export const PHYSICS_CONFIG_VERSION = 1

export const DEFAULT_WORLD_PHYSICS = {
  timestep:         1 / 240,   // s — servo PD + light links need a small fixed step
  maxSubsteps:      8,         // per rendered frame (beyond this the sim slows, never explodes)
  solverIterations: 8,
  gravity:          -9.81,     // m/s² along Y
}

export const DEBUG_LAYERS = {
  colliders: false,   // Rapier collision shapes + joint frames (world.debugRender)
  com:       true,    // centre of mass (and its ground projection)
  support:   true,    // support polygon, coloured by stability state
  contacts:  true,    // foot contact points + normals
  forces:    false,   // ground reaction force vectors
  joints:    false,   // joint axes, coloured by actuator temperature / stall
  velocity:  false,   // link velocity vectors
}

export const GRAVITY_PRESETS = { earth: -9.80665, moon: -1.62, mars: -3.72, zero_g: 0 }

export const DEFAULT_WORLD_CONFIG = {
  version:          PHYSICS_CONFIG_VERSION,
  gravityPreset:    'earth',          // earth | moon | mars | zero_g | custom
  customGravity:    -9.81,            // m/s² (used when gravityPreset === 'custom')
  timestep:         DEFAULT_WORLD_PHYSICS.timestep,
  solverIterations: DEFAULT_WORLD_PHYSICS.solverIterations,
  terrain:          { type: 'flat', material: 'concrete' },
}

export const DEFAULT_ROBOT_CONFIG = {
  model:    'articulated',            // 'articulated' (joint physics) | 'kinematic' (legacy)
  forward:  '-z',                     // robot's forward axis in its authored pose
  gait:     { ...DEFAULT_GAIT },
  balance:  { ...DEFAULT_BALANCE },
  power:    { ...DEFAULT_BATTERY },
  imu:      { ...DEFAULT_IMU },
}

export const DEFAULT_SERVO_CONFIG = {
  preset:   DEFAULT_SERVO_PRESET,
  thermal:  { ...DEFAULT_THERMAL },
  encoder:  { ...DEFAULT_ENCODER, enabled: true },
}

export const DEFAULT_JOINT_CONFIG = {
  minAngleDeg: -90,                   // servo 0°   → −90°
  maxAngleDeg:  90,                   // servo 180° → +90°
  damping:      0.0005,               // N·m·s/rad
  friction:     0.002,                // N·m
}

export const COLLIDER_SHAPES = ['auto', 'box', 'sphere', 'cylinder', 'capsule', 'convex', 'mesh']

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

/** Deep merge of plain objects (arrays and non-objects replace). */
export function deepMerge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over
  const out = { ...(isObj(base) ? base : {}) }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  return out
}

export const FORWARD_AXES = {
  '-z': { x: 0, y: 0, z: -1 }, '+z': { x: 0, y: 0, z: 1 },
  '-x': { x: -1, y: 0, z: 0 }, '+x': { x: 1, y: 0, z: 0 },
}

export function resolveWorldConfig(project) {
  return deepMerge(DEFAULT_WORLD_CONFIG, project?.physics ?? {})
}

export function gravityOf(worldCfg) {
  const c = resolveWorldConfig({ physics: worldCfg })
  return c.gravityPreset === 'custom' ? Number(c.customGravity) || 0 : (GRAVITY_PRESETS[c.gravityPreset] ?? GRAVITY_PRESETS.earth)
}

export function resolveRobotConfig(rootObj, blueprint = null) {
  // Blueprint power (legacy field) seeds the pack; the root object's overrides win.
  const bpPower = blueprint?.power?.voltage ? {
    ...(blueprint.power.capacity_mAh ? { capacity_mAh: blueprint.power.capacity_mAh } : {}),
  } : {}
  const merged = deepMerge(deepMerge(DEFAULT_ROBOT_CONFIG, { power: bpPower }), rootObj?.physics?.robot ?? {})
  merged.forwardVector = FORWARD_AXES[merged.forward] ?? FORWARD_AXES['-z']
  return merged
}

export function resolveServoConfig(obj) {
  return deepMerge(DEFAULT_SERVO_CONFIG, obj?.physics?.servo ?? {})
}

export function resolveJointConfig(obj) {
  return deepMerge(DEFAULT_JOINT_CONFIG, obj?.physics?.joint ?? {})
}

export function resolveObjectPhysics(obj) {
  const p = obj?.physics ?? {}
  return {
    material: p.material ?? null,            // null → auto (plastic; rubber for feet)
    mass:     Number.isFinite(p.mass) && p.mass > 0 ? p.mass : null,   // kg; null → volume × density
    collider: COLLIDER_SHAPES.includes(p.collider) ? p.collider : 'auto',
  }
}

/**
 * Project migration. Accepts any saved project (with or without physics) and
 * returns the world physics block to use. Never mutates the input.
 */
export function migrateProjectPhysics(project) {
  const raw = project?.physics
  if (!raw) return { ...DEFAULT_WORLD_CONFIG, terrain: { ...DEFAULT_WORLD_CONFIG.terrain } }
  const merged = deepMerge(DEFAULT_WORLD_CONFIG, raw)
  merged.version = PHYSICS_CONFIG_VERSION
  if (!['earth', 'moon', 'mars', 'zero_g', 'custom'].includes(merged.gravityPreset)) merged.gravityPreset = 'earth'
  merged.timestep = Math.min(1 / 30, Math.max(1 / 2000, Number(merged.timestep) || DEFAULT_WORLD_CONFIG.timestep))
  merged.solverIterations = Math.max(1, Math.min(64, merged.solverIterations | 0 || DEFAULT_WORLD_CONFIG.solverIterations))
  return merged
}

/** Strip values equal to their defaults so saved projects stay small and diff-able. */
export function sparse(value, defaults) {
  if (!isObj(value)) return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const s = sparse(v, defaults?.[k])
    if (s !== undefined && !(isObj(s) && Object.keys(s).length === 0)) out[k] = s
  }
  return out
}
