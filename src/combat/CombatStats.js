import { totalMass } from '../managers/physics/MassCalculator.js'
import { assemblyMembers } from '../utils/robotAssembly.js'
import { useSceneStore } from '../stores/sceneStore.js'

// ─────────────────────────────────────────────────────────────────────────────
// CombatStats — derive a robot's combat stat block from its REAL mass.
//
// One place that turns "an assembly" into { class, mass, hp layers, mobility,
// resistances }, so weapons/AI/HUD all read the same numbers. Mass comes from
// the existing MassCalculator (volume × material density + fixed electronics
// mass), so a big metal robot is genuinely a heavy, and a small plastic one is a
// light. Stats scale continuously with mass; the class label is just a bucket.
// ─────────────────────────────────────────────────────────────────────────────

export const ROBOT_CLASSES = ['light', 'medium', 'heavy']

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function classForMass(kg) {
  if (kg < 2)  return 'light'
  if (kg < 8)  return 'medium'
  return 'heavy'
}

// Compute the stat block for the assembly rooted at `rootId`.
export function computeRobotStats(rootId) {
  const byId = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
  const objs = assemblyMembers(rootId).map(id => byId.get(id)).filter(Boolean)
  const mass = Math.max(0.3, totalMass(objs))          // kg
  const cls  = classForMass(mass)

  return {
    class: cls,
    mass,                                               // fed to the Rapier body
    // Health layers: heavier robots carry more armor + core.
    armorMax:     Math.round(clamp(40 + mass * 12, 40, 400)),
    coreMax:      Math.round(clamp(60 + mass * 8,  60, 300)),
    heatMax:      100,
    stabilityMax: 100,
    // Mobility: heavier robots are slower and turn lazier — but all robots turn
    // noticeably faster than before (responsive steering while keeping weight).
    maxSpeed:  clamp(20 - mass * 0.7, 9, 20),           // su/s
    accelGain: clamp(0.66 - mass * 0.01, 0.4, 0.66),    // velocity-error correction/frame
    turnRate:  clamp(5.4 - mass * 0.09, 3.2, 5.4),      // rad/s target yaw rate (was 1.6–3.2)
    // Resistances (0..1): heavier robots resist knockback + explosions (Stage 4+).
    recoilResist:    clamp(mass / 20, 0.05, 0.9),
    explosionResist: clamp(mass / 25, 0.05, 0.85),
  }
}
