// Unit bridge between SI (what robot specs are written in) and the shared Rapier
// world, which runs in SCENE UNITS (1 su = SCENE_TO_M metres, gravity in su/s²).
//
// Masses are real kilograms in both systems, so:
//   length  : m        → su      ×(1/L)
//   force   : N        → kg·su/s²  ×(1/L)
//   torque  : N·m      → kg·su²/s² ×(1/L²)
//   inertia : kg·m²    → kg·su²    ×(1/L²)
// Angles and angular velocities are unit-free.
import { SCENE_TO_M } from '../EnvironmentConfig.js'

export const L = SCENE_TO_M
export const M_TO_SU = 1 / L

export const lengthToSU  = (m)   => m / L
export const lengthToM   = (su)  => su * L
export const forceToSU   = (n)   => n / L
export const forceToN    = (f)   => f * L
export const torqueToSU  = (nm)  => nm / (L * L)
export const torqueToNm  = (t)   => t * L * L
export const inertiaToSU = (kgm2) => kgm2 / (L * L)
export const inertiaToSI = (i)   => i * L * L
export const accelToSU   = (ms2) => ms2 / L
export const accelToSI   = (a)   => a * L
