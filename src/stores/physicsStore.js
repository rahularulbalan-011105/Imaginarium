import { create } from 'zustand'
import { ENVIRONMENTS } from '../managers/physics/EnvironmentConfig.js'
import { DEFAULT_WORLD_CONFIG, migrateProjectPhysics, sparse } from '../managers/physics/robotics/config.js'
import { DEBUG_LAYERS } from '../managers/physics/robotics/DebugDraw.js'

const _earth = ENVIRONMENTS.earth

export const usePhysicsStore = create((set, get) => ({
  environment:     'earth',
  gravity:         _earth.gravity,
  airDensity:      _earth.airDensity,
  groundFriction:  _earth.groundFriction,
  rollingFriction: _earth.rollingFriction,

  // Wind: direction unit vector (x,z) + speed (m/s) + turbulence factor (0-1)
  wind: { x: 0, z: -1, speed: 0, turbulence: 0 },

  groundType: 'concrete',

  // ── Articulated-physics world settings (saved with the project) ─────────────
  worldPhysics: {
    timestep:         DEFAULT_WORLD_CONFIG.timestep,
    solverIterations: DEFAULT_WORLD_CONFIG.solverIterations,
    terrain:          { ...DEFAULT_WORLD_CONFIG.terrain },
  },
  // Debug-overlay layers (UI preference; not saved with the project).
  debugLayers: { ...DEBUG_LAYERS },

  /** Config handed to the physics runtime at simulation start. */
  worldPhysicsConfig() {
    const s = get()
    return {
      ...s.worldPhysics,
      terrain: { ...s.worldPhysics.terrain },
      gravityPreset: 'custom',
      customGravity: s.gravity,
    }
  },
  setWorldPhysics(patch) {
    set(s => ({ worldPhysics: { ...s.worldPhysics, ...patch, terrain: { ...s.worldPhysics.terrain, ...(patch.terrain ?? {}) } } }))
  },
  setDebugLayers(patch) { set(s => ({ debugLayers: { ...s.debugLayers, ...patch } })) },
  /** Custom gravity (m/s², negative = down). */
  setCustomGravity(g) {
    if (!Number.isFinite(g)) return
    set({ environment: 'custom', gravity: g })
  },

  /** Project save: world physics block (sparse — only non-defaults). */
  serializePhysics() {
    const s = get()
    const block = {
      gravityPreset: ENVIRONMENTS[s.environment] ? s.environment : 'custom',
      customGravity: s.gravity,
      timestep: s.worldPhysics.timestep,
      solverIterations: s.worldPhysics.solverIterations,
      terrain: s.worldPhysics.terrain,
    }
    return { version: DEFAULT_WORLD_CONFIG.version, ...sparse(block, DEFAULT_WORLD_CONFIG) }
  },
  /** Project load (old projects without physics get defaults). */
  loadPhysics(projectData) {
    const w = migrateProjectPhysics(projectData)
    const env = w.gravityPreset === 'custom' ? null : (w.gravityPreset === 'zero_g' ? 'zero_g' : w.gravityPreset)
    if (env && ENVIRONMENTS[env]) get().setEnvironment(env)
    else set({ environment: 'custom', gravity: Number(w.customGravity) || -9.81 })
    set({ worldPhysics: { timestep: w.timestep, solverIterations: w.solverIterations, terrain: { ...w.terrain } } })
  },

  setEnvironment(env) {
    const p = ENVIRONMENTS[env] ?? ENVIRONMENTS.earth
    set({
      environment:     env,
      gravity:         p.gravity,
      airDensity:      p.airDensity,
      groundFriction:  p.groundFriction,
      rollingFriction: p.rollingFriction,
    })
  },

  setWind(x, z, speed, turbulence = 0) {
    set({ wind: { x, z, speed, turbulence } })
  },

  setGroundType(type) { set({ groundType: type }) },

  // Legged robot controls (set by DrivePanel arrow keys / buttons)
  isLeggedRobot:   false,
  leggedControl:   { speed: 0, turn: 0 },
  leggedGaitType:  'auto',
  setIsLeggedRobot: (v)           => set({ isLeggedRobot: v }),
  setLeggedControl: (speed, turn) => set({ leggedControl: { speed, turn } }),
  setLeggedGaitType: (type)       => set({ leggedGaitType: type }),
}))
