import { lazy, Suspense, memo } from 'react'
import Icon from '../ui/Icon.jsx'
import { useUiStore } from '../../stores/uiStore.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { NAV, locatePanel } from './nav.js'
import PanelErrorBoundary from '../PanelErrorBoundary.jsx'
import PanelHint from '../onboarding/PanelHint.jsx'
import PropertiesPanel from '../PropertiesPanel.jsx'
import ObjectList from '../ObjectList.jsx'
import BooleanPanel, { isBooleanCandidate } from '../BooleanPanel.jsx'
import AssetLibrary from '../AssetLibrary.jsx'
import ElectronicsLibrary from '../ElectronicsLibrary.jsx'
import MechanicalLibrary from '../MechanicalLibrary.jsx'
import JointPanel from '../JointPanel.jsx'
import WiringPanel from '../WiringPanel.jsx'
import RobotPanel from '../RobotPanel.jsx'
import SimulationPanel from '../SimulationPanel.jsx'
import SettingsPanel from '../SettingsPanel.jsx'

// Heavy, rarely-first-used panels load on demand (Blockly alone is ~1 MB) — so
// opening CAD never pulls Blockly or the physics panel.
const BlocksPanel  = lazy(() => import('../BlocksPanel.jsx'))
const PhysicsPanel = lazy(() => import('../PhysicsPanel.jsx'))
const PanelFallback = () => <div className="p-4 text-xs" style={{ color: 'rgb(var(--g-500))' }}>Loading…</div>

/** Centred, intentional empty state for a panel. */
export function Placeholder({ icon, title, children, actions }) {
  return (
    <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center gap-3 px-6 py-10">
      {icon && (
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgb(var(--a-600) / 0.1)', color: 'rgb(var(--a-600))' }}>
          <Icon name={icon} size={22} />
        </div>
      )}
      {title && <div className="text-sm font-semibold" style={{ color: 'rgb(var(--g-100))' }}>{title}</div>}
      <div className="text-xs leading-relaxed max-w-[240px]" style={{ color: 'rgb(var(--g-400))' }}>{children}</div>
      {actions && <div className="flex flex-wrap justify-center gap-2 mt-1">{actions}</div>}
    </div>
  )
}

const pill = (active) => active
  ? { background: 'rgb(var(--a-600))', color: '#fff', borderColor: 'rgb(var(--a-600))' }
  : { background: 'rgb(var(--g-800))', color: 'rgb(var(--g-300))', borderColor: 'transparent' }

function SubToggle({ options, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgb(var(--g-800))' }}>
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-colors"
          style={value === o.id
            ? { background: 'rgb(var(--g-900))', color: 'rgb(var(--a-600))', boxShadow: '0 1px 3px rgb(0 0 0 / 0.08)' }
            : { color: 'rgb(var(--g-400))' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Body({ panel }) {
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const selectedId  = useSceneStore((s) => s.selectedId)
  const secondaryId = useSceneStore((s) => s.secondaryId)
  const bothBoolean = useSceneStore((s) => {
    if (!s.secondaryId) return false
    const a = s.objects.find(o => o.id === s.selectedId), b = s.objects.find(o => o.id === s.secondaryId)
    return isBooleanCandidate(a) && isBooleanCandidate(b)
  })

  switch (panel) {
    case 'library':    return <AssetLibrary />
    case 'properties': return <PropertiesPanel />
    case 'objects':    return <ObjectList />
    case 'boolean':
      return bothBoolean
        ? <BooleanPanel selectedId={selectedId} secondaryId={secondaryId} />
        : <Placeholder icon="boolean" title="Boolean">Select one shape, then <b>Shift+click</b> a second shape to union, subtract or intersect them.</Placeholder>

    case 'electronics': return <ElectronicsLibrary />
    case 'mechanical':
    case 'joints':
      return (
        <>
          <MechanicalLibrary />
          <div className="ui-section-title mx-3 mt-2" id="joints-section">Joints</div>
          <JointPanel />
        </>
      )
    case 'wiring':
    case 'workbench':
      return (
        <div className="flex flex-col min-h-0">
          <div className="px-3 pt-3">
            <SubToggle label="Wiring view" value={panel}
              options={[{ id: 'workbench', label: 'Workbench' }, { id: 'wiring', label: 'Pick a Pin' }]}
              onChange={setActivePanel} />
          </div>
          {panel === 'wiring'
            ? <WiringPanel />
            : <Placeholder icon="zap" title="Workbench">
                Your board and parts are drawn as 2D components in the main workspace. Drag from one pin to another to wire them.
                Every wire is the same wire shown in <b>Pick a Pin</b> and in 3D.
              </Placeholder>}
        </div>
      )

    case 'blocks':
      return <PanelErrorBoundary label="Blocks"><Suspense fallback={<PanelFallback />}><BlocksPanel /></Suspense></PanelErrorBoundary>
    case 'code':
      return <CodeSide />

    case 'simhome':
      return (
        <Placeholder icon="play" title="Simulate"
          actions={[
            ['robot', 'Robot'], ['physics', 'Physics'], ['sim', 'Simulator'],
          ].map(([id, l]) => (
            <button key={id} onClick={() => setActivePanel(id)} className="ui-btn">{l}</button>
          ))}>
          Make sure all these robot and physics are right before you simulate your robot.
        </Placeholder>
      )
    case 'sim':     return <PanelErrorBoundary label="Simulation"><SimulationPanel /></PanelErrorBoundary>
    case 'robot':   return <RobotPanel />
    case 'physics': return <PanelErrorBoundary label="Physics"><Suspense fallback={<PanelFallback />}><PhysicsPanel /></Suspense></PanelErrorBoundary>
    case 'settings': return <SettingsPanel />
    default:         return <PropertiesPanel />
  }
}

// The C++ editor itself fills the main workspace; the side panel holds its layout controls.
function CodeSide() {
  const codeLayout = useUiStore((s) => s.codeLayout)
  const setCodeLayout = useUiStore((s) => s.setCodeLayout)
  return (
    <div className="p-3 flex flex-col gap-3">
      <Placeholder icon="code" title="C++ Coding">
        The Arduino editor is open in the main workspace. Block Coding writes into this same sketch.
      </Placeholder>
      <SubToggle label="Editor layout" value={codeLayout}
        options={[{ id: 'full', label: 'Full editor' }, { id: 'split', label: 'Split with 3D' }]}
        onChange={setCodeLayout} />
    </div>
  )
}

/** Level-2 options for the active parent + the active panel's content. */
function ContextPanel({ width }) {
  const activePanel = useUiStore((s) => s.activePanel)
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)
  const { parent, tab } = locatePanel(activePanel)
  const showTabs = parent.tabs.length > 1

  return (
    <section data-tour="panel" aria-label={`${parent.label} panel`}
      className="ui-context-panel shrink-0 min-h-0 flex flex-col my-2 ml-1 rounded-2xl overflow-hidden"
      style={{ width, background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700) / 0.55)', boxShadow: '0 6px 24px rgb(15 23 42 / 0.07)' }}>
      <header className="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2.5" style={{ borderBottom: '1px solid rgb(var(--g-700) / 0.45)' }}>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'rgb(var(--a-600) / 0.12)', color: 'rgb(var(--a-600))' }}>
            <Icon name={parent.icon} size={15} />
          </span>
          <span className="text-[13px] font-bold tracking-wide" style={{ color: 'rgb(var(--g-100))' }}>{parent.label}</span>
          {tab && showTabs && <span className="text-[11px]" style={{ color: 'rgb(var(--g-500))' }}>/ {tab.label}</span>}
          <button onClick={() => setPanelOpen(false)} title="Close panel" aria-label="Close panel"
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center ui-icon-btn">
            <Icon name="close" size={14} />
          </button>
        </div>
        {showTabs && (
          <div role="tablist" aria-label={`${parent.label} sections`} className="flex flex-wrap gap-1">
            {parent.tabs.map((t) => {
              const active = tab?.id === t.id
              return (
                <button key={t.id} role="tab" aria-selected={active} data-tour={`tab-${t.panels[0]}`}
                  onClick={() => !active && setActivePanel(t.panels[0])}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors"
                  style={pill(active)}>
                  {t.label}
                </button>
              )
            })}
          </div>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <PanelHint panelId={activePanel} />
        <Body panel={activePanel} />
      </div>
    </section>
  )
}

export default memo(ContextPanel)
export { NAV }
