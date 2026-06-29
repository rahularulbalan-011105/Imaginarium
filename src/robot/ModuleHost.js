import { loadModules } from './ModuleLoader.js'

// ── ModuleHost ───────────────────────────────────────────────────────────────
// Stage 4 of the digital-twin migration. Owns the lifecycle of the physics
// modules a Robot Blueprint resolves to, and runs them over a shared `ctx`.
//
// This is the seam that replaces DriveManager's hardcoded if/else branches:
// instead of "if robot is wheeled, run this block", the host loads whatever
// modules the blueprint declares and steps them. DriveManager delegates to it
// ONLY when a blueprint exists, so blueprint-less robots keep the legacy path.
export class ModuleHost {
  constructor() {
    this.modules = []
    this._ctx    = {}
    this.active  = false
  }

  // Load + initialize the blueprint's modules. ctx carries config (wheelbase,
  // env, …) that modules read in enter()/step().
  enter(blueprint, ctx = {}) {
    this._ctx = { blueprint, output: {}, ...ctx }
    this.modules = loadModules(blueprint)
    for (const m of this.modules) {
      try { m.enter?.(this._ctx) } catch (e) { console.error('[ModuleHost] enter failed:', m?.constructor?.key, e) }
    }
    this.active = this.modules.length > 0
    return this.active
  }

  hasModule(key) { return this.modules.some(m => m?.constructor?.key === key) }

  // Step every module once over the shared ctx (extra merges in per-frame inputs).
  step(dt, extra = {}) {
    Object.assign(this._ctx, extra)
    this._ctx.output = {}
    for (const m of this.modules) {
      try { m.step?.(dt, this._ctx) } catch (e) { console.error('[ModuleHost] step failed:', m?.constructor?.key, e) }
    }
    return this._ctx.output
  }

  // Convenience for the wheeled seam: feed motor PWM, return { v, omega } | null.
  computeDrive(leftPWM, rightPWM, dt) {
    this._ctx.inputs = { ...(this._ctx.inputs ?? {}), leftPWM, rightPWM }
    this._ctx.output = {}
    for (const m of this.modules) {
      try { m.step?.(dt, this._ctx) } catch (e) { console.error('[ModuleHost] drive step failed:', m?.constructor?.key, e) }
    }
    return this._ctx.output.drive ?? null
  }

  exit() {
    for (const m of this.modules) { try { m.exit?.() } catch { /* ignore */ } }
    this.modules = []
    this.active = false
  }
}
