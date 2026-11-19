// The legged code templates must compile cleanly (same pre-flight check as Run)
// and transpile — a broken template is the first thing a beginner meets.
import { describe, it, expect } from 'vitest'
import { LEGGED_TEMPLATES } from '../../src/utils/leggedTemplates.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'

describe('legged code templates', () => {
  for (const t of LEGGED_TEMPLATES) {
    it(`${t.label}: compiles with no errors or warnings and transpiles`, () => {
      const r = analyzeArduino(t.code, { board: 'arduino' })
      expect(r.errors ?? r.diagnostics?.filter(d => d.severity === 'error') ?? []).toEqual([])
      expect(r.ok).toBe(true)
      expect(r.warnings ?? []).toEqual([])
      expect(() => parseAndTranspile(t.code)).not.toThrow()
    })
  }

  it('2-leg forward/back never turns; the full-movement ones cover all 8 moves', () => {
    const [fb, biped, quad] = LEGGED_TEMPLATES
    expect(fb.code).not.toMatch(/\bturn\(/)
    for (const t of [biped, quad]) {
      for (const m of ['forward()', 'backward()', 'turnLeft()', 'turnRight()',
        'forwardLeft()', 'forwardRight()', 'backwardLeft()', 'backwardRight()']) expect(t.code).toContain(m)
    }
  })
})
