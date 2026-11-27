import { memo } from 'react'
import Icon from '../ui/Icon.jsx'
import { useUiStore } from '../../stores/uiStore.js'
import { NAV, locatePanel, defaultPanelOf } from './nav.js'

// Remembers the last panel used under each parent, so returning to CAD lands
// on the same tab the user left (session-only, module scope).
const lastPanelOf = {}

/** Level-1 navigation: the five parents. Always visible, narrow. */
function NavRail() {
  const activePanel = useUiStore((s) => s.activePanel)
  const panelOpen   = useUiStore((s) => s.panelOpen)
  const { parent: activeParent } = locatePanel(activePanel)
  lastPanelOf[activeParent.id] = activePanel

  const open = (p) => {
    const ui = useUiStore.getState()
    // Clicking the section you're already in keeps it open (closing is the panel's ×).
    if (p.id === activeParent.id && ui.panelOpen) return
    ui.setActivePanel(lastPanelOf[p.id] ?? defaultPanelOf(p))
  }

  return (
    <nav aria-label="Main navigation"
      className="shrink-0 w-[64px] flex flex-col items-stretch gap-0.5 py-2 px-1.5 overflow-y-auto"
      style={{ background: 'rgb(var(--g-900))', borderLeft: '1px solid rgb(var(--g-700))' }}>
      {NAV.map((p) => {
        const active = p.id === activeParent.id
        const lit = active && panelOpen
        return (
          <button
            key={p.id}
            data-tour={`nav-${p.id}`}
            onClick={() => open(p)}
            title={p.label}
            aria-label={p.label}
            aria-pressed={active}
            className="ui-nav-btn relative w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md"
            style={lit
              ? { background: 'rgb(var(--a-600) / 0.10)', color: 'rgb(var(--a-700))' }
              : active
                ? { color: 'rgb(var(--g-100))' }
                : { color: 'rgb(var(--g-500))' }}
          >
            {lit && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: 'rgb(var(--a-600))' }} />}
            <Icon name={p.icon} size={18} />
            <span className="text-[10.5px] font-medium leading-none">{p.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export default memo(NavRail)
