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
  tracks: 'wheeled',     // until TrackPhysics lands
  legs:   'legged',
  rotors: 'freefall',    // until RotorPhysics lands
  marine: 'freefall',    // until BuoyancyPhysics lands
  hybrid: 'wheeled',
}

export function createBlueprint(overrides = {}) {
  return {
    id:            overrides.id ?? overrides.rootId ?? uuid(),
    robotName:     overrides.robotName ?? 'Robot',
    robotCategory: overrides.robotCategory ?? 'robot',
    rootId:        overrides.rootId ?? null,        // base link (chassis) object id
    members:       overrides.members ?? null,       // null = derive from assembly (bonds+attachments)
    locomotion:    { type: 'wheels', params: {}, ...(overrides.locomotion ?? {}) },
    actuators:     overrides.actuators ?? [],       // [{ role, componentId, type }]
    sensors:       overrides.sensors ?? [],         // [{ role, componentId, type }]
    controller:    overrides.controller ?? null,    // { type, componentId }
    battery:       overrides.battery ?? null,       // { type, voltage, capacity_mAh }
    modules:       overrides.modules ?? [],         // cache only — recomputed by ModuleLoader
    version:       1,
  }
}

export function validateBlueprint(bp) {
  return !!bp && typeof bp === 'object' && LOCOMOTION_TYPES.includes(bp.locomotion?.type)
}

// Which existing execution path a blueprint maps to (used by DriveManager).
export function execPathFor(bp) {
  return LOCOMOTION_EXEC[bp?.locomotion?.type] ?? null
}
