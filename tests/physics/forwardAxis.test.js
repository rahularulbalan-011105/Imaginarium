import { describe, it, expect } from 'vitest'
import { inferForward } from '../../src/managers/physics/robotics/forwardAxis.js'

const hinge = (x, y, z) => ({ type: 'revolute', axis: { x, y, z } })
const C = { x: 0, z: 0 }
const near = (got, want) => { expect(got).not.toBeNull(); for (const k of ['x', 'y', 'z']) expect(got[k]).toBeCloseTo(want[k], 9) }

describe('inferForward', () => {
  it('hinges along Z → faces ±X; the eyes pick the side', () => {
    const j = [hinge(0, 0, -1), hinge(0, 0, 1), hinge(0, 0, 1), hinge(0, 0, -1)]   // the "walking bot"
    near(inferForward(j, C, [{ x: 3, z: 0 }]), { x: 1, y: 0, z: 0 })
    near(inferForward(j, C, [{ x: -3, z: 0 }]), { x: -1, y: 0, z: 0 })
  })

  it('hinges along X → faces ±Z; with no eyes keeps the old −Z default', () => {
    near(inferForward([hinge(1, 0, 0), hinge(-1, 0, 0)], C, []), { x: 0, y: 0, z: -1 })
  })

  it('quadruped (abduction along Z, hip+knee along X) still faces ±Z', () => {
    const leg = [hinge(0, 0, -1), hinge(1, 0, 0), hinge(1, 0, 0)]
    near(inferForward([...leg, ...leg], C, [{ x: 0, z: -5 }]), { x: 0, y: 0, z: -1 })
  })

  it('ignores vertical (yaw) joints; all-yaw gives no clue', () => {
    expect(inferForward([hinge(0, 1, 0), hinge(0, -1, 0)], C, [])).toBeNull()
    near(inferForward([hinge(0, 1, 0), hinge(0, 0, 1)], C, [{ x: -2, z: 0 }]), { x: -1, y: 0, z: 0 })
  })

  it('an eye on the centre line does not pick a side', () => {
    near(inferForward([hinge(0, 0, 1)], C, [{ x: 0.05, z: 4 }]), inferForward([hinge(0, 0, 1)], C, []))
  })
})

describe('front without eyes = away from the camera', () => {
  const hingesX = [hinge(1, 0, 0), hinge(-1, 0, 0)]          // walks along ±Z
  it('camera looking toward +Z → ↑ is +Z', () => near(inferForward(hingesX, C, [], { x: 0.3, z: 0.9 }), { x: 0, y: 0, z: 1 }))
  it('camera looking toward −Z → ↑ is −Z', () => near(inferForward(hingesX, C, [], { x: 0, z: -1 }), { x: 0, y: 0, z: -1 }))
  it('camera looking along the side axis → old −Z default', () => near(inferForward(hingesX, C, [], { x: 1, z: 0.05 }), { x: 0, y: 0, z: -1 }))
  it('eyes still win over the camera', () => near(inferForward(hingesX, C, [{ x: 0, z: -3 }], { x: 0, z: 1 }), { x: 0, y: 0, z: -1 }))
})
