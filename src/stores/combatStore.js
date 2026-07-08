import { create } from 'zustand'

// ─────────────────────────────────────────────────────────────────────────────
// combatStore — runtime state for the physics-based Arena (co-op combat) mode.
//
// This is the HUD-facing contract, mirrored from CombatManager each frame (the
// same pattern BattleManager uses with gameStore). CombatManager owns the
// authoritative per-frame simulation; it pushes changed values here for the UI.
//
// Keyed by robot id = assembly rootId (robotAssembly.js), generalised to N
// combatants/teams from the start (unlike gameStore's hard-coded p1/p2).
//
// Stage 1 scope: armor + core HP layers, heat, stability, team, FSM state.
// Weapons/objectives/effects arrive in later stages — the actor shape already
// reserves fields for them so the HUD contract stays stable.
// ─────────────────────────────────────────────────────────────────────────────

// A fresh combat actor (per-robot state). Layers: armor absorbs first, then core.
export function makeActor({ id, name, team = 0, armorMax = 100, coreMax = 100, heatMax = 100, stabilityMax = 100 }) {
  return {
    id, name, team,
    armor: armorMax, armorMax,
    core:  coreMax,  coreMax,
    heat: 0, heatMax,
    stability: 0, stabilityMax,   // rises with hits; over max → staggered (Stage 3)
    state: 'active',              // active | staggered | overheated | downed | destroyed
    effects: [],                  // reserved: [{ type, expiresAt, magnitude }]
  }
}

export const useCombatStore = create((set) => ({
  arenaActive: false,
  status: 'idle',      // idle | loading | fighting | over
  message: '',
  winnerTeam: null,
  actors: {},          // rootId -> actor

  setArena: (v) => set({ arenaActive: v }),

  // Bulk-replace all actors (match start).
  setActors: (actors) => set({ actors }),

  // Merge a partial patch into one actor (per-frame HP/heat/etc updates).
  patchActor: (id, partial) => set((s) => {
    const cur = s.actors[id]
    if (!cur) return {}
    return { actors: { ...s.actors, [id]: { ...cur, ...partial } } }
  }),

  // Generic HUD push (status/message/winner), mirroring gameStore.sync.
  sync: (partial) => set(partial),

  reset: () => set({
    arenaActive: false, status: 'idle', message: '', winnerTeam: null, actors: {},
  }),
}))
