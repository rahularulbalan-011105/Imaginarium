// Surface-patch selection. The Connect prompt only appears when exactly two
// patches are selected on two DIFFERENT objects, so anything that quietly puts
// two patches on one object makes the feature look broken.
import { describe, it, expect, beforeEach } from 'vitest'
import { useSurfaceStore } from '../../src/stores/surfaceStore.js'

let n = 0
/** A patch as buildFacePatch() would produce it. */
const patch = (objectId, normal = [0, 1, 0], center = [0, 1, 0]) => ({
  id: `p${++n}`,
  objectId,
  localNormal: { x: normal[0], y: normal[1], z: normal[2] },
  localCenter: { x: center[0], y: center[1], z: center[2] },
  localTangent: { x: 1, y: 0, z: 0 },
  width: 1,
  height: 1,
})

const S = () => useSurfaceStore.getState()
/** What SurfaceAttachPrompt computes to decide whether to offer Connect. */
const canAttach = () => {
  const { patches, selectedIds } = S()
  const sel = selectedIds.map(id => patches[id]).filter(Boolean)
  return sel.length === 2 && sel[0].objectId !== sel[1].objectId
}

beforeEach(() => useSurfaceStore.setState({ patches: {}, selectedIds: [] }))

describe('surface patch selection', () => {
  it('re-clicking the same face reuses its patch instead of stacking a second one', () => {
    const first = patch('boxA')
    S().addOrSelectPatch(first)
    // Same face, fresh id — what buildFacePatch returns when pick() missed.
    S().addOrSelectPatch({ ...first, id: 'other-id' })

    expect(Object.keys(S().patches)).toHaveLength(1)
    expect(S().selectedIds).toEqual([first.id])
  })

  it('two faces on different parts can be connected', () => {
    S().addOrSelectPatch(patch('boxA'))
    S().addOrSelectPatch(patch('boxB'))
    expect(S().selectedIds).toHaveLength(2)
    expect(canAttach()).toBe(true)
  })

  it('the duplicate-patch case no longer blocks Connect (the reported bug)', () => {
    const face = patch('boxA')
    S().addOrSelectPatch(face)
    S().addOrSelectPatch({ ...face, id: 'dupe' })   // pick() missed; used to add a 2nd patch on boxA
    S().addOrSelectPatch(patch('boxB'))
    // Before the fix the selection was [boxA-patch, boxA-dupe] and Connect never showed.
    expect(canAttach()).toBe(true)
  })

  it('keeps genuinely different faces of one part apart', () => {
    S().addOrSelectPatch(patch('boxA', [0, 1, 0], [0, 1, 0]))    // top
    S().addOrSelectPatch(patch('boxA', [1, 0, 0], [1, 0, 0]))    // side
    expect(Object.keys(S().patches)).toHaveLength(2)
    // Two faces of the SAME part still cannot be joined — that is by design,
    // and the prompt now explains it rather than rendering nothing.
    expect(canAttach()).toBe(false)
  })

  it('selecting an already-selected face is a no-op, not a deselect', () => {
    const face = patch('boxA')
    S().addOrSelectPatch(face)
    S().addOrSelectPatch({ ...face, id: 'again' })
    expect(S().selectedIds).toEqual([face.id])
  })

  it('a third face replaces the older selection, keeping two', () => {
    S().addOrSelectPatch(patch('boxA'))
    const second = patch('boxB')
    S().addOrSelectPatch(second)
    const third = patch('boxC')
    S().addOrSelectPatch(third)
    expect(S().selectedIds).toEqual([second.id, third.id])
    expect(canAttach()).toBe(true)
  })

  it('removing a patch drops it from the selection', () => {
    const a = patch('boxA')
    S().addOrSelectPatch(a)
    S().addOrSelectPatch(patch('boxB'))
    S().removePatch(a.id)
    expect(S().selectedIds).not.toContain(a.id)
    expect(canAttach()).toBe(false)
  })
})
