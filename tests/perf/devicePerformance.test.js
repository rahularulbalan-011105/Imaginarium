// Device profile classification + adaptive render resolution (pure logic).
import { describe, it, expect } from 'vitest'
import { classify, resolveQuality, AdaptiveResolution, QUALITY_PRESETS } from '../../src/utils/devicePerformance.js'

const caps = (o = {}) => ({ cores: 8, memoryGB: 8, dpr: 1, mobile: false, webgl2: true, maxTexture: 16384, gpuClass: 'integrated', ...o })

describe('device profile', () => {
  it('classifies software GL as LOW regardless of CPU', () => {
    expect(classify(caps({ gpuClass: 'software', cores: 32, memoryGB: 64 }))).toBe('low')
  })
  it('classifies a discrete-GPU workstation as HIGH', () => {
    expect(classify(caps({ gpuClass: 'discrete', cores: 16, memoryGB: 32 }))).toBe('high')
  })
  it('penalises a high-DPI screen on an integrated GPU (the laptop trap)', () => {
    const plain = classify(caps({ cores: 4, memoryGB: 8 }))
    const hidpi = classify(caps({ cores: 4, memoryGB: 8, dpr: 2 }))
    expect(['low', 'medium']).toContain(hidpi)
    expect(QUALITY_PRESETS[hidpi].maxPixelRatio).toBeLessThanOrEqual(QUALITY_PRESETS[plain].maxPixelRatio)
  })
  it('never lets devicePixelRatio be uncontrolled: every preset caps it', () => {
    for (const p of Object.values(QUALITY_PRESETS)) expect(p.maxPixelRatio).toBeLessThanOrEqual(2)
  })
  it('user choice overrides detection; overrides override the preset', () => {
    const q = resolveQuality('low', 'high', { shadows: true, renderScale: 1.25, physicsQuality: 'high' })
    expect(q.profile).toBe('low')
    expect(q.auto).toBe(false)
    expect(q.shadows).toBe(true)
    expect(q.fixedPixelRatio).toBe(1.25)
    expect(q.physicsMinTimestep).toBeCloseTo(1 / 240, 9)
    expect(resolveQuality('auto', 'medium').auto).toBe(true)
  })
})

describe('adaptive resolution', () => {
  it('lowers resolution when frames stay slow, never below min', () => {
    const a = new AdaptiveResolution({ min: 0.75, max: 1.5, start: 1.5 })
    for (let i = 0; i < 2000; i++) a.sample(33)          // ~30 fps
    expect(a.ratio).toBe(0.75)
  })
  it('recovers slowly when frames are fast, never above max', () => {
    const a = new AdaptiveResolution({ min: 0.75, max: 1.5, start: 0.75 })
    for (let i = 0; i < 240; i++) a.sample(12)
    expect(a.ratio).toBeLessThanOrEqual(0.8)             // at most one step after ~4 s
    for (let i = 0; i < 20000; i++) a.sample(12)
    expect(a.ratio).toBe(1.5)
  })
  it('does not oscillate in the dead-band', () => {
    const a = new AdaptiveResolution({ min: 0.75, max: 1.5, start: 1.2 })
    for (let i = 0; i < 5000; i++) a.sample(i % 2 ? 17.5 : 18.5)   // ~55 fps, jittery
    expect(a.ratio).toBe(1.2)
  })
  it('ignores hitches (tab switches, GC pauses)', () => {
    const a = new AdaptiveResolution({ min: 0.75, max: 1.5, start: 1.5 })
    for (let i = 0; i < 100; i++) a.sample(900)
    expect(a.ratio).toBe(1.5)
  })
})
