import { classifyComponent } from './componentRegistry.js'
import { createBlueprint } from './RobotBlueprint.js'

// ── Auto-blueprint (Stage 8) ─────────────────────────────────────────────────
// The classifier that turns a set of scene objects into a blueprint. Used by:
//   • the Robot wizard (RobotPanel) to PRE-FILL a blueprint the user can edit, and
//   • DriveManager to AUTO-BUILD an ephemeral blueprint at Simulate time when a
//     robot has no explicit one — so the execution path is ALWAYS selected by a
//     blueprint's locomotion, never by inspecting geometry/type in the engine.
// This is the single home of the "what kind of robot is this?" heuristic.

/** Map member component types → actuators / sensors / controller (via the registry). */
export function scanCapabilities(memberIds, byId) {
  const actuators = [], sensors = []
  let controller = null
  for (const id of memberIds) {
    const o = byId[id]; if (!o) continue
    const c = classifyComponent(o.type)
    if (!c) continue
    if      (c.category === 'actuator')   actuators.push({ role: c.role, componentId: id, type: o.type })
    else if (c.category === 'sensor')     sensors.push({ role: c.role, componentId: id, type: o.type })
    else if (c.category === 'controller') controller = { type: o.type, componentId: id }
    // 'output' (led/buzzer/oled) and unknown types are ignored.
  }
  return { actuators, sensors, controller }
}

/** Default locomotion from the scan (servos → legs, drive motors → wheels). */
export function suggestLocomotion(actuators) {
  if (actuators.some(a => a.type === 'servo')) return 'legs'
  if (actuators.some(a => a.role === 'drive')) return 'wheels'
  return 'wheels'
}

/**
 * Build an EPHEMERAL blueprint for a set of scene objects (not stored). Used by
 * DriveManager when a robot has no explicit blueprint, so simulation always has
 * a blueprint to select the execution path + resolve physics modules from.
 */
export function autoBlueprintForObjects(objects) {
  const byId = Object.fromEntries(objects.map(o => [o.id, o]))
  const memberIds = objects.map(o => o.id)
  const { actuators, sensors, controller } = scanCapabilities(memberIds, byId)
  // No actuators → 'none' (passive: just falls under physics), matching the old
  // "0 motors, no legs → freefall" behavior. Otherwise the usual heuristic.
  const type = actuators.length > 0 ? suggestLocomotion(actuators) : 'none'
  return createBlueprint({
    members: memberIds,
    locomotion: { type, params: {} },
    actuators, sensors, controller,
    metadata: { auto: true },
  })
}
