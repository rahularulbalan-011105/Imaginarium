// Lumped first-order thermal model for an actuator (motor + case):
//   C · dT/dt = P_heat − (T − T_ambient) / R_th
// Above `deratingStart` the available torque falls linearly; at `maxTemp` the
// actuator shuts down (thermal cut-out) until it cools below `recoverTemp`.

export const DEFAULT_THERMAL = {
  ambient:       25,    // °C
  heatCapacity:  8,     // J/K   (small hobby-servo motor + case)
  thermalResistance: 25, // K/W  (case → air)
  deratingStart: 70,    // °C
  maxTemp:       90,    // °C   cut-out
  recoverTemp:   75,    // °C   re-enable after cut-out
  minDerate:     0.3,   // torque fraction just before cut-out
  shutdownOnOverheat: true,
}

export class ThermalModel {
  constructor(spec = {}) {
    this.spec = { ...DEFAULT_THERMAL, ...spec }
    this.temperature = this.spec.ambient
    this.overheated  = false
    this.heatPower   = 0
  }

  /** Advance by h seconds with `pHeat` watts dissipated. */
  step(h, pHeat) {
    const s = this.spec
    this.heatPower = Math.max(0, pHeat)
    const cooling = (this.temperature - s.ambient) / Math.max(1e-6, s.thermalResistance)
    this.temperature += h * (this.heatPower - cooling) / Math.max(1e-6, s.heatCapacity)
    if (s.shutdownOnOverheat) {
      if (!this.overheated && this.temperature >= s.maxTemp)   this.overheated = true
      else if (this.overheated && this.temperature <= s.recoverTemp) this.overheated = false
    }
    return this.temperature
  }

  /** Torque capability multiplier from temperature (0…1). */
  derate() {
    const s = this.spec
    if (this.overheated) return 0
    if (this.temperature <= s.deratingStart) return 1
    const t = (this.temperature - s.deratingStart) / Math.max(1e-6, s.maxTemp - s.deratingStart)
    return Math.max(s.minDerate, 1 - t * (1 - s.minDerate))
  }

  reset() { this.temperature = this.spec.ambient; this.overheated = false; this.heatPower = 0 }
}
