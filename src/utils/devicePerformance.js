// Device performance profile + quality presets + adaptive render resolution.
//
// Privacy: only what rendering decisions need is read, it stays in this tab, and
// nothing is stored or sent. The GPU string (when the browser exposes it) is only
// substring-matched into a coarse class (software / integrated / discrete).

export const PROFILES = ['low', 'medium', 'high']

// The effective quality in force (set by SceneManager.applyQuality) — lets other
// systems (physics, telemetry, effects) read it without importing the renderer.
let _current = null
export function setCurrentQuality(q) { _current = q }
export function getCurrentQuality() { return _current }

// What each profile means. `physicsMinTimestep` is a FLOOR on the robotics step
// (low-end devices may run 120 Hz instead of 240 Hz); correctness settings such as
// servo limits are never touched.
export const QUALITY_PRESETS = {
  low:    { minPixelRatio: 0.6,  maxPixelRatio: 1.0, shadows: false, shadowMapSize: 512,  antialias: false, effects: 'low',    physicsMinTimestep: 1 / 120, telemetryHz: 5 },
  medium: { minPixelRatio: 0.75, maxPixelRatio: 1.5, shadows: true,  shadowMapSize: 1024, antialias: true,  effects: 'medium', physicsMinTimestep: 1 / 240, telemetryHz: 10 },
  high:   { minPixelRatio: 1.0,  maxPixelRatio: 2.0, shadows: true,  shadowMapSize: 2048, antialias: true,  effects: 'high',   physicsMinTimestep: 1 / 240, telemetryHz: 10 },
}

/** Capability snapshot (safe everywhere: every field degrades to a default). */
export function readCapabilities(gl = null) {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  const win = typeof window !== 'undefined' ? window : {}
  const caps = {
    cores:       Number(nav.hardwareConcurrency) || 4,
    memoryGB:    Number(nav.deviceMemory) || null,           // Chromium only
    dpr:         Number(win.devicePixelRatio) || 1,
    screenPx:    win.screen ? win.screen.width * win.screen.height : 1920 * 1080,
    mobile:      !!(nav.userAgentData?.mobile ?? /Mobi|Android/i.test(nav.userAgent || '')),
    webgl2:      false,
    maxTexture:  0,
    gpuClass:    'unknown',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined' && !!win.crossOriginIsolated,
    webrtc:      typeof RTCPeerConnection !== 'undefined',
    indexedDB:   typeof indexedDB !== 'undefined',
  }
  try {
    let ctx = gl
    if (!ctx && typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      ctx = c.getContext('webgl2') || c.getContext('webgl')
    }
    if (ctx) {
      caps.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext
      caps.maxTexture = ctx.getParameter(ctx.MAX_TEXTURE_SIZE) || 0
      const ext = ctx.getExtension('WEBGL_debug_renderer_info')
      const name = String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER) || '').toLowerCase()
      caps.gpuClass =
        /swiftshader|llvmpipe|software|basic render/.test(name) ? 'software'
        : /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a/.test(name) ? 'discrete'
        : /apple m\d|apple gpu/.test(name) ? 'discrete'          // Apple silicon GPUs are strong
        : /intel|uhd|iris|mali|adreno|powervr|radeon|vega/.test(name) ? 'integrated'
        : 'unknown'
    }
  } catch { /* no WebGL → leave defaults; the app shows a compatibility message */ }
  return caps
}

/** Classify into low / medium / high from capabilities. */
export function classify(caps) {
  if (caps.gpuClass === 'software') return 'low'
  let score = 0
  score += caps.cores >= 8 ? 2 : caps.cores >= 4 ? 1 : 0
  if (caps.memoryGB != null) score += caps.memoryGB >= 8 ? 2 : caps.memoryGB >= 4 ? 1 : -1
  score += caps.gpuClass === 'discrete' ? 2 : caps.gpuClass === 'integrated' ? 0 : 1
  if (caps.maxTexture && caps.maxTexture < 8192) score -= 1
  if (!caps.webgl2) score -= 2
  if (caps.mobile) score -= 2
  // A huge high-DPI screen on a modest GPU is the classic laptop trap.
  if (caps.dpr >= 2 && caps.gpuClass !== 'discrete') score -= 1
  return score >= 4 ? 'high' : score >= 1 ? 'medium' : 'low'
}

/** Resolve the effective quality settings from the user's choice + overrides. */
export function resolveQuality(choice, detected, overrides = {}) {
  const profile = PROFILES.includes(choice) ? choice : detected
  const q = { profile, auto: !PROFILES.includes(choice), ...QUALITY_PRESETS[profile] }
  if (overrides.renderScale != null) { q.fixedPixelRatio = Math.max(0.5, Math.min(2, overrides.renderScale)) }
  if (overrides.shadows != null) q.shadows = !!overrides.shadows
  if (overrides.antialias != null) q.antialias = !!overrides.antialias
  if (overrides.effects) q.effects = overrides.effects
  if (overrides.telemetryHz) q.telemetryHz = overrides.telemetryHz
  if (overrides.physicsQuality === 'high') q.physicsMinTimestep = 1 / 240
  if (overrides.physicsQuality === 'low') q.physicsMinTimestep = 1 / 120
  return q
}

/**
 * Adaptive render resolution with hysteresis. Feed it the time between rendered
 * frames while the scene is actively animating; it returns the pixel ratio to
 * use. Drops fast when the GPU can't keep up, recovers slowly, never oscillates.
 */
export class AdaptiveResolution {
  constructor({ min = 0.75, max = 1.5, start = max, targetFps = 60 } = {}) {
    this.min = min; this.max = max
    this.ratio = Math.min(max, Math.max(min, start))
    this.budget = 1000 / targetFps
    this.avg = this.budget
    this._slow = 0; this._fast = 0
  }
  setRange(min, max) {
    this.min = min; this.max = max
    this.ratio = Math.min(max, Math.max(min, this.ratio))
  }
  /** @param frameMs time since the previous rendered frame. Returns the new ratio (or the same). */
  sample(frameMs) {
    if (!(frameMs > 0) || frameMs > 250) return this.ratio          // tab switch / hitch: ignore
    this.avg += (frameMs - this.avg) * 0.1                            // EMA over ~10 frames
    if (this.avg > this.budget * 1.25) { this._slow++; this._fast = 0 }        // < ~48 fps
    else if (this.avg < this.budget * 1.05) { this._fast++; this._slow = 0 }   // ≥ ~57 fps
    else { this._slow = 0; this._fast = 0 }
    if (this._slow >= 45 && this.ratio > this.min) {                  // ~0.75 s consistently slow
      this.ratio = Math.max(this.min, +(this.ratio - 0.1).toFixed(2)); this._slow = 0
    } else if (this._fast >= 240 && this.ratio < this.max) {          // ~4 s consistently fast
      this.ratio = Math.min(this.max, +(this.ratio + 0.05).toFixed(2)); this._fast = 0
    }
    return this.ratio
  }
}
