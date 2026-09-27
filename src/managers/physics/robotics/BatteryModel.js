// Battery / power-bus model: open-circuit voltage from state of charge, internal
// resistance (voltage sag under load), a supply current limit, depletion, and
// brownout with hysteresis.
//
//   V_terminal = OCV(SOC) − I · R_int
//   dSOC/dt    = −I / capacity
//
// If the actuators demand more than `maxCurrent`, the bus is current-limited:
// `supplyScale` (<1) is fed back to the actuators, which lowers their available
// torque — the robot gets weaker instead of drawing impossible current.

// Per-cell OCV curves (SOC → volts), piecewise linear.
const OCV = {
  lipo:     [[0, 3.0], [0.05, 3.3], [0.1, 3.5], [0.2, 3.65], [0.5, 3.8], [0.8, 3.95], [0.9, 4.05], [1, 4.2]],
  liion:    [[0, 3.0], [0.05, 3.25], [0.1, 3.45], [0.2, 3.6], [0.5, 3.72], [0.8, 3.9], [0.9, 4.0], [1, 4.2]],
  nimh:     [[0, 0.8], [0.03, 1.05], [0.05, 1.1], [0.1, 1.18], [0.5, 1.24], [0.9, 1.3], [1, 1.4]],
  alkaline: [[0, 0.9], [0.1, 1.1], [0.5, 1.3], [1, 1.55]],
}
const NOMINAL_CELL = { lipo: 3.7, liion: 3.6, nimh: 1.2, alkaline: 1.5 }

export const DEFAULT_BATTERY = {
  chemistry:        'nimh',
  cells:            4,       // 4×NiMH = 4.8 V nominal (typical hobby-servo pack)
  capacity_mAh:     2000,
  internalResistance: 0.12, // Ω (whole pack)
  maxCurrent:       10,      // A   supply/BMS current limit
  brownoutVoltage:  3.4,     // V   MCU/servo-driver brownout threshold
  brownoutHysteresis: 0.3,   // V
  initialSoc:       1.0,
  cutoffSoc:        0.0,
}

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i]
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    }
  }
  return table[table.length - 1][1]
}

export class BatteryModel {
  constructor(spec = {}) {
    this.spec = { ...DEFAULT_BATTERY, ...spec }
    if (!OCV[this.spec.chemistry]) this.spec.chemistry = 'nimh'
    this.soc          = Math.min(1, Math.max(0, this.spec.initialSoc))
    this.current      = 0
    this.voltage      = this.ocv()
    this.power        = 0
    this.energyUsed_J = 0
    this.chargeUsed_mAh = 0
    this.brownout     = false
    this.currentLimited = false
    this.supplyScale  = 1
  }

  get nominalVoltage() { return NOMINAL_CELL[this.spec.chemistry] * this.spec.cells }

  ocv() { return interp(OCV[this.spec.chemistry], this.soc) * this.spec.cells }

  /**
   * Advance the pack by h seconds with `demandA` amps requested by the loads.
   * Returns the terminal voltage the loads will see next step.
   */
  step(h, demandA) {
    const s = this.spec
    const demand = Math.max(0, demandA)
    const capacity_As = Math.max(1e-6, s.capacity_mAh * 3.6)

    if (this.soc <= s.cutoffSoc + 1e-9) {
      // Exhausted pack: it cannot source current, so the bus collapses and every
      // load browns out. Actuators then produce no torque.
      this.current = 0; this.supplyScale = 0; this.currentLimited = demand > 0
      this.voltage = 0; this.power = 0; this.brownout = true
      return this.voltage
    }

    this.currentLimited = demand > s.maxCurrent
    this.current = Math.min(demand, s.maxCurrent)
    // Feed the limit back so next step's actuators can only pull what's available.
    this.supplyScale = this.currentLimited ? s.maxCurrent / demand : 1

    this.soc = Math.max(s.cutoffSoc, this.soc - this.current * h / capacity_As)
    this.chargeUsed_mAh += this.current * h / 3.6
    this.voltage = Math.max(0, this.ocv() - this.current * s.internalResistance)
    this.power = this.voltage * this.current
    this.energyUsed_J += this.power * h

    if (!this.brownout && this.voltage < s.brownoutVoltage) this.brownout = true
    else if (this.brownout && this.voltage > s.brownoutVoltage + s.brownoutHysteresis) this.brownout = false
    return this.voltage
  }

  /** Terminal voltage at a hypothetical load (used for sensor reads). */
  readVoltage() { return this.voltage }

  reset() {
    this.soc = this.spec.initialSoc; this.current = 0; this.voltage = this.ocv()
    this.power = 0; this.energyUsed_J = 0; this.chargeUsed_mAh = 0
    this.brownout = false; this.currentLimited = false; this.supplyScale = 1
  }
}
