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
    // Clicking the open parent again closes the context panel (more 3D space).
    if (p.id === activeParent.id && ui.panelOpen) { ui.setPanelOpen(false); return }
    ui.setActivePanel(lastPanelOf[p.id] ?? defaultPanelOf(p))
  }

  return (
    <nav aria-label="Main navigation"
      className="shrink-0 w-[68px] flex flex-col items-stretch gap-1 py-3 px-2 overflow-y-auto"
      style={{ background: 'rgb(var(--g-900))', borderLeft: '1px solid rgb(var(--g-700) / 0.5)' }}>
      {NAV.map((p) => {
        const active = p.id === activeParent.id
        const lit = active && panelOpen
        return (
          <button
            key={p.id}
            data-tour={`nav-${p.id}`}
            onClick={() => open(p)}
            title={lit ? `${p.label} — click to close the panel` : p.label}
            aria-label={p.label}
            aria-pressed={active}
            className="ui-nav-btn relative w-full flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl"
            style={lit
              ? { background: 'rgb(var(--a-600))', color: '#fff', boxShadow: '0 4px 12px rgb(var(--a-600) / 0.28)' }
              : active
                ? { background: 'rgb(var(--a-600) / 0.12)', color: 'rgb(var(--a-600))' }
                : { color: 'rgb(var(--g-400))' }}
          >
            <Icon name={p.icon} size={19} />
            <span className="text-[9px] font-semibold tracking-wide leading-none">{p.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export default memo(NavRail)
