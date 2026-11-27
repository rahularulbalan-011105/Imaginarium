import { memo, useEffect, useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { useAnyOverlay } from './ui/overlay.js'
import { SHAPE_COLORS } from '../utils/shapeColors.js'
import Icon from './ui/Icon.jsx'
import * as edit from '../managers/editActions.js'
import { PIN_DEFS } from '../utils/electronicsFactory.js'

// ─────────────────────────────────────────────────────────────────────────────
// SelectionInspector — the small card that appears in the 3D view whenever
// something is selected (Tinkercad's shape inspector). It covers the edits made
// most often — rename, colour, solid/hole, duplicate, delete — so the common
// path never needs the side panel. "More settings" opens Design → Edit for
// everything else. It stays out of the way: hidden while simulating, while the
// Edit tab is already showing the same object, and under any popup/overlay.
// Every control calls the same store action the Edit tab uses.
// ─────────────────────────────────────────────────────────────────────────────

const SWATCHES = ['#e5483f', '#f39c1f', '#f2c330', '#46a74b', '#2bb3a3', '#2f86d6', '#3f5bd6', '#8e44ad', '#d84a8b', '#6c7a89', '#f4f4f5', '#27272a']

// Types that are plain geometry (colour + solid/hole make sense for them).
const isShapeType = (t) => t in SHAPE_COLORS || t === 'csg' || t === 'text' || t === 'gear' || t === 'model'

function SelectionInspector() {
  const obj = useSceneStore((s) => s.objects.find((o) => o.id === s.selectedId))
  const twoSelected = useSceneStore((s) => !!s.secondaryId)
  const updateObject = useSceneStore((s) => s.updateObject)
  const toggleHole = useSceneStore((s) => s.toggleHole)
  const simActive = useUiStore((s) => s.simActive)
  const editOpen = useUiStore((s) => s.panelOpen && s.activePanel === 'properties')
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const anyOverlay = useAnyOverlay()
  const { snapshot } = useHistory()
  const [name, setName] = useState('')
  useEffect(() => { setName(obj?.name ?? '') }, [obj?.id, obj?.name])

  if (!obj || simActive || editOpen || twoSelected) return null
  const shape = isShapeType(obj.type)

  const commitName = () => {
    const n = name.trim()
    if (n && n !== obj.name) { updateObject(obj.id, { name: n }); snapshot() } else setName(obj.name)
  }
  const setColor = (c) => { updateObject(obj.id, { color: c }); snapshot() }

  return (
    <div
      role="dialog" aria-label={`${obj.name} settings`}
      className="absolute right-3 top-[116px] w-[232px] rounded-lg pointer-events-auto"
      style={{
        zIndex: 25, opacity: anyOverlay ? 0 : 1, transition: 'opacity 150ms ease',
        visibility: anyOverlay ? 'hidden' : 'visible',
        background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 6px 20px rgb(0 0 0 / 0.10)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Name + quick actions */}
      <div className="flex items-center gap-1 pl-2 pr-1 h-10" style={{ borderBottom: '1px solid rgb(var(--g-700))' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(obj.name); e.currentTarget.blur() } e.stopPropagation() }}
          aria-label="Name"
          title="Rename"
          className="flex-1 min-w-0 h-7 px-1.5 rounded-md bg-transparent text-[13px] font-semibold border border-transparent hover:border-gray-600 focus:border-gray-500 focus:outline-none"
        />
        <button onClick={edit.toggleLockSelection} title={obj.locked ? 'Unlock (Ctrl+L)' : 'Lock (Ctrl+L)'} aria-label={obj.locked ? 'Unlock' : 'Lock'}
          aria-pressed={!!obj.locked} className="w-7 h-7 flex items-center justify-center ui-icon-btn"
          style={obj.locked ? { color: 'rgb(var(--a-700))' } : undefined}><Icon name={obj.locked ? 'lock' : 'unlock'} size={15} /></button>
        <button onClick={edit.duplicateSelection} title="Duplicate (Ctrl+D)" aria-label="Duplicate"
          className="w-7 h-7 flex items-center justify-center ui-icon-btn"><Icon name="duplicate" size={15} /></button>
        <button onClick={edit.deleteSelection} title="Delete (Del)" aria-label="Delete"
          className="w-7 h-7 flex items-center justify-center ui-icon-btn hover:!text-red-600"><Icon name="trash" size={15} /></button>
      </div>

      <div className="p-2.5 flex flex-col gap-2.5">
        {shape && (
          <>
            {/* Solid / Hole — the Tinkercad idea: a hole cuts itself out of what it's grouped with */}
            {obj.type !== 'model' && <div className="ui-seg" role="tablist" aria-label="Solid or hole">
              <button role="tab" aria-selected={!obj.isHole} onClick={() => { if (obj.isHole) { toggleHole(obj.id); snapshot() } }}>Solid</button>
              <button role="tab" aria-selected={!!obj.isHole} onClick={() => { if (!obj.isHole) { toggleHole(obj.id); snapshot() } }}
                title="A hole cuts itself out of the shapes you group it with">Hole</button>
            </div>}
            {!obj.isHole && (
              <div>
                <div className="text-[11px] mb-1.5" style={{ color: 'rgb(var(--g-500))' }}>Colour</div>
                <div className="grid grid-cols-6 gap-1.5">
                  {SWATCHES.map((c) => {
                    const on = (obj.color ?? '').toLowerCase() === c
                    return (
                      <button key={c} onClick={() => setColor(c)} title={c} aria-label={`Colour ${c}`} aria-pressed={on}
                        className="h-6 rounded-md"
                        style={{ background: c, boxShadow: on ? '0 0 0 2px rgb(var(--g-900)), 0 0 0 4px rgb(var(--a-600))' : 'inset 0 0 0 1px rgb(0 0 0 / 0.12)' }} />
                    )
                  })}
                </div>
                <label className="mt-2 flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'rgb(var(--g-500))' }}>
                  <input type="color" value={obj.color ?? '#888888'} onChange={(e) => updateObject(obj.id, { color: e.target.value })}
                    onBlur={() => snapshot()} className="w-6 h-6 rounded border-0 p-0 bg-transparent cursor-pointer" />
                  Pick any colour
                </label>
              </div>
            )}
          </>
        )}
        {!shape && PIN_DEFS[obj.type] && (
          <div className="text-[12px] leading-snug" style={{ color: 'rgb(var(--g-500))' }}>
            Drag the arrows to place it. Connect its pins in <button className="underline hover:no-underline" style={{ color: 'rgb(var(--g-200))' }}
              onClick={() => setActivePanel('workbench')}>Build → Wiring</button>.
          </div>
        )}
        <button onClick={() => setActivePanel('properties')} className="ui-btn w-full">
          More settings
        </button>
      </div>
    </div>
  )
}

export default memo(SelectionInspector)
