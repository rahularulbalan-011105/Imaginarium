import { memo, lazy, Suspense } from 'react'
import { useUiStore } from '../../stores/uiStore.js'
import CodeEditor from '../CodeEditor.jsx'
import WiringWorkbench from '../WiringWorkbench.jsx'
import PanelErrorBoundary from '../PanelErrorBoundary.jsx'

// Blockly (~700 KB) loads only when Block Coding is opened.
const BlocksPanel = lazy(() => import('../BlocksPanel.jsx'))

/**
 * Panels that need the big area (C++ editor, wiring Workbench) render here, ON
 * TOP of the 3D viewport — the viewport stays mounted underneath, so the scene,
 * simulation and camera keep running and nothing re-initialises on switch back.
 */
function CenterWorkspace() {
  const activePanel = useUiStore((s) => s.activePanel)
  const codeLayout  = useUiStore((s) => s.codeLayout)
  const setActivePanel = useUiStore((s) => s.setActivePanel)

  if (activePanel === 'code' || activePanel === 'blocks') {
    // 'split' keeps the 3D view visible on the right (watch the robot run).
    const split = codeLayout === 'split'
    return (
      <div className="absolute top-0 left-0 bottom-0 z-[25] flex flex-col"
        style={{ right: split ? '45%' : 0, background: 'rgb(var(--g-900))', borderRight: split ? '1px solid rgb(var(--g-700))' : 'none' }}>
        {activePanel === 'code'
          ? <PanelErrorBoundary label="C++ Coding"><CodeEditor full /></PanelErrorBoundary>
          : <PanelErrorBoundary label="Block Coding">
              <Suspense fallback={<div className="p-4 text-xs" style={{ color: 'rgb(var(--g-500))' }}>Loading Block Coding…</div>}>
                <BlocksPanel workspace />
              </Suspense>
            </PanelErrorBoundary>}
      </div>
    )
  }
  if (activePanel === 'workbench') {
    return (
      <div className="absolute inset-0 z-[25]">
        <WiringWorkbench embedded onClose={() => setActivePanel('wiring')} />
      </div>
    )
  }
  return null
}

export default memo(CenterWorkspace)
