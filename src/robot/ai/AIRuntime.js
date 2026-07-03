import { useRobotStore } from '../../stores/robotStore.js'
import { simulationManager } from '../../managers/SimulationManager.js'
import { objectManager } from '../../managers/ObjectManager.js'
import { AI_BEHAVIORS } from './behaviors.js'

// ── AI Runtime (Stage 7) ─────────────────────────────────────────────────────
// An alternative driver to firmware: per-blueprint AI behaviors read the robot's
// sensors and write drive commands into simulationManager.motorSpeeds — the SAME
// channel DriveManager reads — so the robot moves without any physics changes.
//
// DriveManager calls tick(dt, driveGroups) each frame and gates its wheeled path
// on aiRuntime.isActive() so AI-driven robots run even when no firmware is.
const clampPWM = (v) => Math.max(-255, Math.min(255, v || 0))

// AI selection lives on the blueprint (blueprint.aiModules = [{ key }]), so it
// saves / loads / undoes with the project. The runtime just reads it each frame.
function behaviorKeyOf(bp) { return bp?.aiModules?.[0]?.key ?? 'idle' }

class AIRuntime {
  constructor() { this._phase = 0 }

  isActive() {
    return Object.values(useRobotStore.getState().blueprints)
      .some(bp => behaviorKeyOf(bp) !== 'idle')
  }

  // groups = { leftIds, rightIds } from DriveManager (the drive motor split).
  tick(dt, groups) {
    const left  = groups?.leftIds ?? []
    const right = groups?.rightIds ?? []
    if (!left.length && !right.length) return

    this._phase += dt
    for (const bp of Object.values(useRobotStore.getState().blueprints)) {
      const key = behaviorKeyOf(bp)
      const beh = AI_BEHAVIORS[key]
      if (!beh || key === 'idle') continue

      // Forward range from the robot's first range sensor (ultrasonic/IR).
      const rangeSensor = (bp.sensors ?? []).find(s => s.role === 'range' || s.role === 'ir')
      let range = null, hasRange = false
      if (rangeSensor) {
        hasRange = true
        const d = objectManager.senseDistance?.(rangeSensor.componentId)
        range = (d == null) ? null : d * 5   // scene units → cm (1u = 5cm)
      }

      const cmd = beh.fn({ dt, phase: this._phase, range, hasRange, nearCm: 30 })
      for (const id of left)  simulationManager.motorSpeeds[id] = clampPWM(cmd.left)
      for (const id of right) simulationManager.motorSpeeds[id] = clampPWM(cmd.right)
    }
  }
}

export const aiRuntime = new AIRuntime()
