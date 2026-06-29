import { v4 as uuid } from 'uuid'

// RobotBlueprint — the explicit, metadata-driven definition of a robot. Robot
// behaviour (which physics modules load) is determined by THIS blueprint —
// its locomotion type + installed capabilities — NOT by inspecting geometry.
// Authored via the Robot Wizard and persisted in the project file.
//
// Hierarchy is expressed through the blueprint fields rather than a mesh tree:
//   Robot ── rootId (Chassis) · battery (Power) · controller · sensors[]
//            · actuators[] · members[] (Joints/Locomotion parts via bonds+attachments)

export const LOCOMOTION_TYPES = ['wheels', 'tracks', 'legs', 'rotors', 'marine', 'hybrid']

export const ROBOT_CATEGORIES = ['robot', 'vehicle', 'drone', 'marine', 'arm', 'custom']

// Locomotion → which existing execution path the simulator should use until a
// dedicated module exists. New types fall back to the closest working path so the
// sim never breaks while their physics modules are being built.
export const LOCOMOTION_EXEC = {
  wheels: 'wheeled',
  tracks: 'wheeled',     // skid-steer via TrackPhysics
  legs:   'legged',
  rotors: 'freefall',    // until RotorPhysics lands (Stage 6.5)
  marine: 'freefall',    // until BuoyancyPhysics lands (Stage 6.5)
  hybrid: 'wheeled',
  none:   'freefall',    // passive object (no actuators) → just physics / drop
}

export const BLUEPRINT_VERSION = 2

// Default power block. budget_mA = 0 means "no budget set" → validation passes.
const defaultPower = () => ({ batteryComponentId: null, voltage: 0, capacity_mAh: 0, budget_mA: 0 })
const defaultMeta  = () => ({ created: null, tags: [], notes: '' })

export function createBlueprint(overrides = {}) {
  return {
    id:            overrides.id ?? overrides.rootId ?? uuid(),
    robotName:     overrides.robotName ?? 'Robot',
    robotCategory: overrides.robotCategory ?? 'robot',
    rootId:        overrides.rootId ?? null,        // base link (chassis) object id
    members:       overrides.members ?? null,       // null = derive from assembly (bonds+attachments)
    links:         overrides.links ?? [],           // [{ id(objectId), parentLinkId|null }] — link tree
    joints:        overrides.joints ?? [],           // [jointId] — jointStore ids governed by this robot
    locomotion:    { type: 'wheels', params: {}, ...(overrides.locomotion ?? {}) },
    actuators:     overrides.actuators ?? [],       // [{ role, componentId, type, drivesJointId? }]
    sensors:       overrides.sensors ?? [],         // [{ role, componentId, type, mountLinkId? }]
    controller:    overrides.controller ?? null,    // { type, componentId }
    power:         { ...defaultPower(), ...(overrides.power ?? {}) }, // battery + budget_mA
    battery:       overrides.battery ?? null,       // legacy (kept for back-compat)
    electronics:   { connections: [], ...(overrides.electronics ?? {}) }, // wiring conn ids in this robot
    aiModules:     overrides.aiModules ?? [],       // [{ key, config }] — AI behaviors
    modules:       overrides.modules ?? [],         // cache only — recomputed by ModuleLoader
    metadata:      { ...defaultMeta(), ...(overrides.metadata ?? {}) },
    version:       BLUEPRINT_VERSION,
  }
}

// Upgrade an older (v1) blueprint to the current schema, filling any missing
// fields with defaults. Existing values always win. Safe to call on any object.
export function migrateBlueprint(bp) {
  if (!bp || typeof bp !== 'object') return bp
  return {
    links: [], joints: [], aiModules: [],
    power: defaultPower(), metadata: defaultMeta(),
    ...bp,
    locomotion:  { type: 'wheels', params: {}, ...(bp.locomotion ?? {}) },
    power:       { ...defaultPower(), ...(bp.power ?? {}) },
    electronics: { connections: [], ...(bp.electronics ?? {}) },
    metadata:    { ...defaultMeta(),  ...(bp.metadata ?? {}) },
    version: BLUEPRINT_VERSION,
  }
}

export function validateBlueprint(bp) {
  return !!bp && typeof bp === 'object' && LOCOMOTION_TYPES.includes(bp.locomotion?.type)
}

// Which existing execution path a blueprint maps to (used by DriveManager).
export function execPathFor(bp) {
  return LOCOMOTION_EXEC[bp?.locomotion?.type] ?? null
}
