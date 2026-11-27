import { lazy, Suspense, memo } from 'react'
import Icon from '../ui/Icon.jsx'
import { useUiStore } from '../../stores/uiStore.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { NAV, locatePanel } from './nav.js'
import PanelErrorBoundary from '../PanelErrorBoundary.jsx'
import PanelHint from '../onboarding/PanelHint.jsx'
import Placeholder from '../ui/Placeholder.jsx'
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
const PhysicsPanel = lazy(() => import('../PhysicsPanel.jsx'))
const PanelFallback = () => <div className="p-4 text-xs" style={{ color: 'rgb(var(--g-500))' }}>Loading…</div>

function SubToggle({ options, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="ui-seg">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>
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
        : <Placeholder title="Combine two shapes">Click one shape, then <b>Shift+click</b> a second one. You can then join them, cut one out of the other, or keep only where they overlap.</Placeholder>

    case 'electronics': return <ElectronicsLibrary />
    case 'mechanical':
    case 'joints':
      return (
        <>
          <MechanicalLibrary />
          <div className="ui-section-title mx-3 mt-4 mb-1" id="joints-section">Joints</div>
          <JointPanel />
        </>
      )
    case 'wiring':
    case 'workbench':
      return (
        <div className="flex flex-col min-h-0">
          <div className="px-3 pt-3">
            <SubToggle label="Wiring view" value={panel}
              options={[{ id: 'workbench', label: 'Workbench' }, { id: 'wiring', label: 'Pin list' }]}
              onChange={setActivePanel} />
          </div>
          {panel === 'wiring'
            ? <WiringPanel />
            : <Placeholder title="Workbench">
                Your board and parts are drawn flat in the main area. Drag from one pin to another to connect them.
                The same wires show up in <b>Pin list</b>.
              </Placeholder>}
        </div>
      )

    case 'blocks':
      return <CodeSide kind="blocks" />
    case 'code':
      return <CodeSide kind="code" />

    case 'simhome':
      return (
        <Placeholder title="Simulate"
          actions={<>
            <button onClick={() => setActivePanel('sim')} className="ui-btn ui-btn-primary">Run simulation</button>
            <button onClick={() => setActivePanel('robot')} className="ui-btn">Robot settings</button>
            <button onClick={() => setActivePanel('physics')} className="ui-btn">Physics</button>
          </>}>
          Run your robot in a physics world. If it doesn't move the way you expect, check its robot and physics settings.
        </Placeholder>
      )
    case 'sim':     return <PanelErrorBoundary label="Simulation"><SimulationPanel /></PanelErrorBoundary>
    case 'robot':   return <RobotPanel />
    case 'physics': return <PanelErrorBoundary label="Physics"><Suspense fallback={<PanelFallback />}><PhysicsPanel /></Suspense></PanelErrorBoundary>
    case 'settings': return <SettingsPanel />
    default:         return <PropertiesPanel />
  }
}

// Block Coding and the C++ editor fill the main workspace; the side panel holds
// the explanation + layout switch (full editor, or split with the 3D view).
function CodeSide({ kind }) {
  const codeLayout = useUiStore((s) => s.codeLayout)
  const setCodeLayout = useUiStore((s) => s.setCodeLayout)
  return (
    <div className="flex flex-col gap-1 pb-3">
      {kind === 'code'
        ? <Placeholder title="C++">The Arduino editor is open in the main area. Blocks write into this same sketch.</Placeholder>
        : <Placeholder title="Blocks">Snap blocks together in the main area. <b>Run blocks</b> runs them; <b>Use in C++</b> copies the code they make into the C++ tab.</Placeholder>}
      <div className="px-4"><SubToggle label="Editor layout" value={codeLayout}
        options={[{ id: 'full', label: 'Full editor' }, { id: 'split', label: 'Split with 3D' }]}
        onChange={setCodeLayout} /></div>
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
      className="ui-context-panel shrink-0 min-h-0 flex flex-col overflow-hidden"
      style={{ width, background: 'rgb(var(--g-900))', borderLeft: '1px solid rgb(var(--g-700))' }}>
      <header className="shrink-0">
        <div className="flex items-center gap-2 h-11 pl-4 pr-2">
          <span className="text-[14px] font-semibold" style={{ color: 'rgb(var(--g-50))' }}>{parent.label}</span>
          <button onClick={() => setPanelOpen(false)} title="Close panel" aria-label="Close panel"
            className="ml-auto w-7 h-7 flex items-center justify-center ui-icon-btn">
            <Icon name="close" size={14} />
          </button>
        </div>
        {showTabs ? (
          <div role="tablist" aria-label={`${parent.label} sections`} className="ui-tabs">
            {parent.tabs.map((t) => {
              const active = tab?.id === t.id
              return (
                <button key={t.id} role="tab" aria-selected={active} data-tour={`tab-${t.panels[0]}`}
                  onClick={() => !active && setActivePanel(t.panels[0])}
                  className="ui-tab">
                  {t.label}
                </button>
              )
            })}
          </div>
        ) : <div style={{ borderBottom: '1px solid rgb(var(--g-700))' }} />}
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
