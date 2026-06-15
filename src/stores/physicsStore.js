import { create } from 'zustand'
import { ENVIRONMENTS } from '../managers/physics/EnvironmentConfig.js'

const _earth = ENVIRONMENTS.earth

export const usePhysicsStore = create((set) => ({
  environment:     'earth',
  gravity:         _earth.gravity,
  airDensity:      _earth.airDensity,
  groundFriction:  _earth.groundFriction,
  rollingFriction: _earth.rollingFriction,

  // Wind: direction unit vector (x,z) + speed (m/s) + turbulence factor (0-1)
  wind: { x: 0, z: -1, speed: 0, turbulence: 0 },

  groundType: 'concrete',

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
