import { memo, lazy, Suspense, useRef, useCallback } from 'react'
import { useUiStore } from '../../stores/uiStore.js'
import { useElectronicsStore } from '../../stores/electronicsStore.js'
import Icon from '../ui/Icon.jsx'
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
const COLLAPSED_W = 40          // px — width of the collapsed edge strip
const MIN_PCT = 25, MAX_PCT = 80 // split-mode drag limits (% of the workspace)

/** Arrow tab on the pane's right edge: collapse ↔ expand. */
function EdgeTab({ collapsed, onClick }) {
  return (
    <button type="button" onClick={onClick}
      title={collapsed ? 'Show code' : 'Hide code — full 3D view'}
      aria-label={collapsed ? 'Show code panel' : 'Hide code panel'}
      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-r-md shadow-md transition-colors"
      style={{ right: -18, width: 18, height: 56, zIndex: 2, background: 'rgb(var(--g-800))', border: '1px solid rgb(var(--g-700))', borderLeft: 'none', color: 'rgb(var(--g-300))' }}>
      <Icon name="chevronRight" size={14} strokeWidth={2.25}
        style={{ transform: collapsed ? 'none' : 'rotate(180deg)', transition: 'transform 150ms' }} />
    </button>
  )
}

function CenterWorkspace() {
  const activePanel = useUiStore((s) => s.activePanel)
  const codeLayout  = useUiStore((s) => s.codeLayout)
  const codePane    = useUiStore((s) => s.codePane)
  const setCodePane = useUiStore((s) => s.setCodePane)
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const running = useElectronicsStore((s) => s.simulation.running)
  const paneRef = useRef(null)

  // Drag the right edge (split mode) — styled directly while dragging so the
  // editor doesn't re-render per pointer move; committed to the store on release.
  const startResize = useCallback((e) => {
    const pane = paneRef.current
    const host = pane?.parentElement
    if (!pane || !host) return
    e.preventDefault()
    const box = host.getBoundingClientRect()
    let pct = codePane.splitPct
    const move = (ev) => {
      pct = Math.max(MIN_PCT, Math.min(MAX_PCT, ((ev.clientX - box.left) / box.width) * 100))
      pane.style.width = `${pct}%`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      setCodePane({ splitPct: Math.round(pct) })
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [codePane.splitPct, setCodePane])

  if (activePanel === 'code' || activePanel === 'blocks') {
    // 'split' keeps the 3D view visible on the right (watch the robot run).
    const split = codeLayout === 'split'
    const collapsed = codePane.collapsed
    const toggle = () => setCodePane({ collapsed: !collapsed })
    const width = collapsed ? COLLAPSED_W : split ? `${codePane.splitPct}%` : '100%'
    const label = activePanel === 'code' ? 'C++ Code' : 'Block Code'
    return (
      <div ref={paneRef} className="absolute top-0 left-0 bottom-0 z-[25] flex flex-col"
        style={{ width, background: 'rgb(var(--g-900))', borderRight: (split || collapsed) ? '1px solid rgb(var(--g-700))' : 'none' }}>
        {/* Kept MOUNTED while collapsed: the serial log + editor state live inside. */}
        <div className="flex-1 min-h-0 flex flex-col" style={{ display: collapsed ? 'none' : 'flex' }}>
          {activePanel === 'code'
            ? <PanelErrorBoundary label="C++ Coding"><CodeEditor full /></PanelErrorBoundary>
            : <PanelErrorBoundary label="Block Coding">
                <Suspense fallback={<div className="p-4 text-xs" style={{ color: 'rgb(var(--g-500))' }}>Loading Block Coding…</div>}>
                  <BlocksPanel workspace />
                </Suspense>
              </PanelErrorBoundary>}
        </div>

        {collapsed && (
          <button type="button" onClick={toggle} title="Show code"
            className="flex-1 flex flex-col items-center gap-3 pt-4 select-none"
            style={{ color: 'rgb(var(--g-300))' }}>
            <span className="w-2 h-2 rounded-full" title={running ? 'Code running' : 'Code stopped'}
              style={{ background: running ? '#22c55e' : 'rgb(var(--g-600))' }} />
            <span className="text-[11px] font-semibold tracking-wider uppercase"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{label}</span>
          </button>
        )}

        {/* Drag handle on the right edge (split mode only). */}
        {split && !collapsed && (
          <div onPointerDown={startResize} title="Drag to resize"
            className="absolute top-0 bottom-0 cursor-col-resize hover:bg-indigo-500/40 transition-colors"
            style={{ right: -3, width: 6, zIndex: 1 }} />
        )}

        <EdgeTab collapsed={collapsed} onClick={toggle} />
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
