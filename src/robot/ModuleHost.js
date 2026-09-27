import { loadModules } from './ModuleLoader.js'
import { MODULE_REGISTRY } from './modules.js'

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
    // Stable sort by declared pipeline stage (gait → balance → IK → servo → joint).
    this.modules = loadModules(blueprint)
      .map((m, i) => ({ m, i, st: m?.constructor?.stage ?? 50 }))
      .sort((a, b) => a.st - b.st || a.i - b.i)
      .map(x => x.m)
    for (const m of this.modules) {
      try { m.enter?.(this._ctx) } catch (e) { console.error('[ModuleHost] enter failed:', m?.constructor?.key, e) }
    }
    this.active = this.modules.length > 0
    return this.active
  }

  hasModule(key) { return this.modules.some(m => m?.constructor?.key === key) }

  // Guarantee a module is present (e.g. joint dynamics are intrinsic to any
  // articulated body, whatever its locomotion capability). Inserted in stage order.
  ensureModule(key) {
    if (this.hasModule(key)) return false
    const C = MODULE_REGISTRY[key]
    if (!C) return false
    const m = new C()
    try { m.enter?.(this._ctx) } catch (e) { console.error('[ModuleHost] enter failed:', key, e) }
    const st = C.stage ?? 50
    const at = this.modules.findIndex(x => (x?.constructor?.stage ?? 50) > st)
    if (at < 0) this.modules.push(m); else this.modules.splice(at, 0, m)
    this.active = true
    return true
  }

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
