import { create } from 'zustand'
import { migrateBlueprint } from '../robot/RobotBlueprint.js'

// Robot blueprints, keyed by blueprint id. Serialized into the project file
// (project.robots.blueprints) and restored on load. This is the authoritative,
// metadata-driven description of each robot — geometry is never inspected to
// decide behaviour.
export const useRobotStore = create((set, get) => ({
  blueprints: {},   // id → RobotBlueprint

  addBlueprint: (bp) => set(s => ({ blueprints: { ...s.blueprints, [bp.id]: bp } })),

  updateBlueprint: (id, patch) => set(s =>
    s.blueprints[id] ? { blueprints: { ...s.blueprints, [id]: { ...s.blueprints[id], ...patch } } } : s),

  removeBlueprint: (id) => set(s => {
    const next = { ...s.blueprints }; delete next[id]; return { blueprints: next }
  }),

  // bulk restore (load / undo) — migrate any older (v1) blueprints to the
  // current schema so loaded projects gain links/joints/power/metadata defaults.
  setBlueprints: (blueprints) => set({
    blueprints: Object.fromEntries(
      Object.entries(blueprints ?? {}).map(([id, bp]) => [id, migrateBlueprint(bp)])
    ),
  }),

  // The blueprint that governs a given set of object ids (root match first, then
  // membership). Returns null when none of the objects belong to a robot.
  blueprintForObjects: (objectIds) => {
    const idset = objectIds instanceof Set ? objectIds : new Set(objectIds)
    const bps = Object.values(get().blueprints)
    return bps.find(b => b.rootId && idset.has(b.rootId))
        ?? bps.find(b => (b.members ?? []).some(m => idset.has(m)))
        ?? null
  },
}))
