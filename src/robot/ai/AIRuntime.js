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

class AIRuntime {
  constructor() {
    this._enabled = {}   // blueprintId → behavior key
    this._phase   = 0
  }

  setBehavior(blueprintId, key) {
    if (!key || key === 'idle') delete this._enabled[blueprintId]
    else this._enabled[blueprintId] = key
  }
  behaviorFor(blueprintId) { return this._enabled[blueprintId] ?? 'idle' }
  isActive() { return Object.keys(this._enabled).length > 0 }
  clear() { this._enabled = {}; this._phase = 0 }

  // groups = { leftIds, rightIds } from DriveManager (the drive motor split).
  tick(dt, groups) {
    if (!this.isActive()) return
    this._phase += dt
    const left = groups?.leftIds ?? []
    const right = groups?.rightIds ?? []
    if (!left.length && !right.length) return

    const bps = useRobotStore.getState().blueprints
    for (const [bpId, key] of Object.entries(this._enabled)) {
      const bp  = bps[bpId]
      const beh = AI_BEHAVIORS[key]
      if (!bp || !beh) continue

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
