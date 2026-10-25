// @vitest-environment jsdom
// The reported symptom was the Connect prompt "not appearing". Every state below
// used to render nothing at all, so these assert the tool now says where it is.
import { describe, it, expect, beforeEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import SurfaceAttachPrompt from '../../src/components/SurfaceAttachPrompt.jsx'
import { useSurfaceStore } from '../../src/stores/surfaceStore.js'
import { useUiStore } from '../../src/stores/uiStore.js'
import { useSceneStore } from '../../src/stores/sceneStore.js'

let n = 0
const patch = (objectId, normal = [0, 1, 0], center = [0, 1, 0]) => ({
  id: `p${++n}`,
  objectId,
  localNormal: { x: normal[0], y: normal[1], z: normal[2] },
  localCenter: { x: center[0], y: center[1], z: center[2] },
  localTangent: { x: 1, y: 0, z: 0 },
  width: 1, height: 1,
})

// A real client render, not renderToStaticMarkup: zustand serves
// getInitialState() during server rendering, so an SSR pass would ignore every
// setState below and always show the component's empty state.
// createElement, not JSX: vitest's include is tests/**/*.test.js, and .js files
// are not put through the JSX transform here.
global.IS_REACT_ACT_ENVIRONMENT = true
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(createElement(SurfaceAttachPrompt)) })
  const html = host.innerHTML
  act(() => root.unmount())
  host.remove()
  return html
}
const select = (...ps) => {
  useSurfaceStore.setState({ patches: {}, selectedIds: [] })
  for (const p of ps) useSurfaceStore.getState().addOrSelectPatch(p)
}

beforeEach(() => {
  useSurfaceStore.setState({ patches: {}, selectedIds: [] })
  useUiStore.setState({ surfaceToolActive: true })
  useSceneStore.setState({
    objects: [
      { id: 'boxA', name: 'Chassis' },
      { id: 'boxB', name: 'Arduino' },
    ],
  })
})

describe('SurfaceAttachPrompt', () => {
  it('says nothing while the Surface tool is off', () => {
    useUiStore.setState({ surfaceToolActive: false })
    select(patch('boxA'), patch('boxB'))
    expect(render()).toBe('')
  })

  it('prompts for the first surface when nothing is picked', () => {
    expect(render()).toContain('Click a face to pick the first surface')
  })

  it('asks for a second face on another part after one pick', () => {
    select(patch('boxA'))
    expect(render()).toContain('Now click a face on a different part')
  })

  it('explains the same-part case instead of rendering nothing', () => {
    // Two faces of one part: the old component returned null here, which is the
    // "it just doesn't appear" the bug report described.
    select(patch('boxA', [0, 1, 0], [0, 1, 0]), patch('boxA', [1, 0, 0], [1, 0, 0]))
    const html = render()
    expect(html).not.toBe('')
    expect(html).toContain('same part')
  })

  it('offers Connect, naming both parts, once two parts are picked', () => {
    select(patch('boxA'), patch('boxB'))
    const html = render()
    expect(html).toContain('Connect Surfaces')
    expect(html).toContain('Chassis')
    expect(html).toContain('Arduino')
  })
})
