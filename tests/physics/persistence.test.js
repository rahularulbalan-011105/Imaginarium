// Save/load compatibility and undo/redo of physics configuration.
import { describe, it, expect, vi } from 'vitest'
import {
  migrateProjectPhysics, resolveWorldConfig, resolveServoConfig, resolveJointConfig,
  resolveRobotConfig, resolveObjectPhysics, gravityOf, sparse, DEFAULT_WORLD_CONFIG, DEFAULT_SERVO_CONFIG,
} from '../../src/managers/physics/robotics/config.js'

// Analytics has browser side-effects; it is irrelevant to undo/redo.
vi.mock('../../src/utils/utmTracking.js', () => ({ trackEvent: () => {}, setLoginEmail: () => {} }))

describe('save / load', () => {
  it('24. old projects (no physics) load with defaults; configs round-trip through JSON', () => {
    const legacy = { version: '1.1', objects: [{ id: 'a', type: 'box' }], settings: {} }
    const w = migrateProjectPhysics(legacy)
    expect(w).toEqual({ ...DEFAULT_WORLD_CONFIG, terrain: { ...DEFAULT_WORLD_CONFIG.terrain } })
    expect(resolveServoConfig(legacy.objects[0]).preset).toBe(DEFAULT_SERVO_CONFIG.preset)
    expect(resolveObjectPhysics(legacy.objects[0])).toEqual({ material: null, mass: null, collider: 'auto' })

    const project = {
      physics: { gravityPreset: 'moon', terrain: { type: 'stairs', material: 'wood' } },
      objects: [
        { id: 's1', type: 'servo', physics: { servo: { preset: 'mg996r', thermal: { maxTemp: 80 } }, joint: { minAngleDeg: -45 } } },
        { id: 'b1', type: 'box', physics: { material: 'rubber', mass: 0.25, collider: 'sphere', robot: { forward: '+z', gait: { type: 'crawl' } } } },
      ],
    }
    const back = JSON.parse(JSON.stringify(project))
    expect(resolveWorldConfig(back).gravityPreset).toBe('moon')
    expect(gravityOf(back.physics)).toBeCloseTo(-1.62, 5)
    const sv = resolveServoConfig(back.objects[0])
    expect(sv.preset).toBe('mg996r')
    expect(sv.thermal.maxTemp).toBe(80)
    expect(sv.thermal.recoverTemp).toBe(DEFAULT_SERVO_CONFIG.thermal.recoverTemp)   // defaults fill the rest
    expect(resolveJointConfig(back.objects[0]).minAngleDeg).toBe(-45)
    expect(resolveObjectPhysics(back.objects[1])).toEqual({ material: 'rubber', mass: 0.25, collider: 'sphere' })
    const rc = resolveRobotConfig(back.objects[1])
    expect(rc.forwardVector).toEqual({ x: 0, y: 0, z: 1 })
    expect(rc.gait.type).toBe('crawl')
    expect(rc.gait.stepHeight).toBeGreaterThan(0)
  })

  it('24b. migration sanitises bad values and sparse() stores only overrides', () => {
    const w = migrateProjectPhysics({ physics: { gravityPreset: 'jupiter', timestep: 5, solverIterations: -3 } })
    expect(w.gravityPreset).toBe('earth')
    expect(w.timestep).toBeLessThanOrEqual(1 / 30)
    expect(w.solverIterations).toBeGreaterThanOrEqual(1)
    expect(sparse({ ...DEFAULT_WORLD_CONFIG, gravityPreset: 'mars' }, DEFAULT_WORLD_CONFIG)).toEqual({ gravityPreset: 'mars' })
    expect(resolveObjectPhysics({ physics: { mass: -1, collider: 'teapot' } })).toEqual({ material: null, mass: null, collider: 'auto' })
  })
})

describe('undo / redo', () => {
  it('25. physics edits go through the command history (undo restores, redo re-applies)', async () => {
    const { useSceneStore } = await import('../../src/stores/sceneStore.js')
    const dispatch = await import('../../src/managers/history/editorDispatch.js')
    const S = useSceneStore.getState()
    S.insertObject({ id: 'srv', name: 'servo', type: 'servo', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true })
    dispatch.resetBaseline()
    const get = () => useSceneStore.getState().objects.find(o => o.id === 'srv')

    useSceneStore.getState().updateObject('srv', { physics: { servo: { preset: 'mg996r' } } })
    dispatch.recordSnapshot('Servo type')
    useSceneStore.getState().updateObject('srv', { physics: { ...get().physics, material: 'metal', mass: 0.06 } })
    dispatch.recordSnapshot('Material')
    expect(get().physics).toEqual({ servo: { preset: 'mg996r' }, material: 'metal', mass: 0.06 })

    dispatch.undo()
    expect(get().physics).toEqual({ servo: { preset: 'mg996r' } })
    dispatch.undo()
    expect(get().physics).toBeUndefined()
    dispatch.redo()
    expect(get().physics.servo.preset).toBe('mg996r')
    dispatch.redo()
    expect(get().physics.mass).toBe(0.06)
  })
})
