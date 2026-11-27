// One way to start and stop the simulation, shared by the header's Simulate
// button and SIMULATE → Run. Starting waits for the lazily loaded physics engine
// (Rapier) instead of silently falling back to kinematic physics.
import { useState, useCallback } from 'react'
import { useUiStore } from '../stores/uiStore.js'
import { physicsManager } from './physics/PhysicsManager.js'
import { preparePhysics } from './DriveManager.js'
import { trackEvent } from '../utils/utmTracking.js'

let starting = null   // in-flight start, so two quick clicks don't start twice

export async function startSimulation() {
  const ui = useUiStore.getState()
  if (ui.simActive) return
  if (!starting) {
    trackEvent('sim_started')
    starting = preparePhysics().finally(() => { starting = null })
  }
  await starting
  useUiStore.getState().setSimActive(true)
}

export function stopSimulation() {
  useUiStore.getState().setSimActive(false)
}

/** { simActive, preparing, toggle } for any Simulate / Stop button. */
export function useSimToggle() {
  const simActive = useUiStore((s) => s.simActive)
  const [preparing, setPreparing] = useState(false)
  const toggle = useCallback(async () => {
    if (useUiStore.getState().simActive) { stopSimulation(); return }
    if (!physicsManager.ready) setPreparing(true)
    try { await startSimulation() } finally { setPreparing(false) }
  }, [])
  return { simActive, preparing, toggle }
}
