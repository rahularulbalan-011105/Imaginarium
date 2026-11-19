// Run ▶ from the code editors (C++ / Block Coding) must put the robot under the
// simulator — otherwise the sketch runs but nothing drives the body: walk()/turn()
// and legged/wheeled motion only happen inside driveManager.step(), which runs
// only while simulation mode (uiStore.simActive) is on.
import { driveManager, preparePhysics } from './DriveManager.js'
import { useUiStore } from '../stores/uiStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { trackEvent } from '../utils/utmTracking.js'

// Parts that make a robot move. A sketch with none of these (LED blink, sensor
// readout…) runs without entering simulation, exactly as before.
const ACTUATORS = new Set(['servo', 'motor', 'motor_bo', 'motor_dc'])

const entered = () => !!(driveManager.rootGroup || driveManager._useRapierFreefall || driveManager._articulated)
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))

/**
 * Enter simulation mode if the scene has actuators and it isn't on yet.
 * Resolves once driveManager has actually entered (App's simActive effect
 * calls enter() after React commits), so the sketch starts on a live robot.
 */
export async function enterSimForCode() {
  if (useUiStore.getState().simActive) return
  if (!useSceneStore.getState().objects.some((o) => ACTUATORS.has(o.type))) return
  trackEvent('sim_started', { from: 'code_run' })
  await preparePhysics()
  useUiStore.getState().setSimActive(true)
  for (let i = 0; i < 60 && !entered(); i++) await nextFrame()
}
