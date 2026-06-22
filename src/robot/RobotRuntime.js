import { useRobotStore } from '../stores/robotStore.js'
import { resolveModuleKeys } from './ModuleLoader.js'
import { execPathFor } from './RobotBlueprint.js'

// Bridges blueprints into the simulation. In this slice it is the metadata
// AUTHORITY that DriveManager consults: given the objects being simulated, it
// returns the governing blueprint, the execution path its locomotion type maps
// to, and the resolved module set. (Per-module stepping is a later stage; the
// existing tuned physics still executes, now SELECTED by metadata not geometry.)
class RobotRuntime {
  blueprintForObjects(objectIds) {
    return useRobotStore.getState().blueprintForObjects(objectIds)
  }

  // 'wheeled' | 'legged' | 'freefall' | null  (null → no blueprint → legacy auto-detect)
  execPathForObjects(objectIds) {
    const bp = this.blueprintForObjects(objectIds)
    return bp ? execPathFor(bp) : null
  }

  modulesForObjects(objectIds) {
    const bp = this.blueprintForObjects(objectIds)
    return bp ? resolveModuleKeys(bp) : []
  }
}

export const robotRuntime = new RobotRuntime()
