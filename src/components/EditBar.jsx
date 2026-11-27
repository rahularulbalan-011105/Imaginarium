import { memo, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSceneStore, selectedIdsOf } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import * as edit from '../managers/editActions.js'
import { useOverlay } from './ui/overlay.js'
import Icon from './ui/Icon.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// EditBar — Tinkercad's edit actions as one row under the tool toolbar:
//   Copy · Paste · Duplicate · Delete | Group · Ungroup | Align · Mirror | Lock · Hide · Show all
// Buttons enable themselves from the selection; each calls the same action as
// its keyboard shortcut (managers/editActions.js).
// ─────────────────────────────────────────────────────────────────────────────

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const K = isMac ? '⌘' : 'Ctrl+'

function Btn({ icon, title, onClick, disabled, active }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title} aria-pressed={active ? true : undefined}
      className="ui-tool disabled:opacity-30 disabled:pointer-events-none">
      <Icon name={icon} size={17} />
    </button>
  )
}
const Sep = () => <span className="ui-tool-sep" aria-hidden="true" />

// A small menu that opens under its button and closes on an outside click / Esc.
function Popover({ icon, title, disabled, children, id }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOverlay(id, open)
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc) }
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  return (
    <div className="relative" ref={ref}>
      <Btn icon={icon} title={title} disabled={disabled} active={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="absolute left-0 top-full mt-1.5 p-2 rounded-lg z-40"
          style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 8px 24px rgb(0 0 0 / 0.14)' }}
          onClick={(e) => { if (e.target.closest('[data-close]')) setOpen(false) }}>
          {children}
        </div>
      )}
    </div>
  )
}

const ALIGN_ROWS = [
  ['x', 'Left to right', ['Left', 'Centre', 'Right']],
  ['z', 'Back to front', ['Back', 'Centre', 'Front']],
  ['y', 'Up and down',   ['Bottom', 'Middle', 'Top']],
]

function EditBar() {
  const objs = useSceneStore(useShallow((s) => selectedIdsOf(s).map((id) => s.objects.find((o) => o.id === id)).filter(Boolean)))
  const anyHidden = useSceneStore((s) => s.objects.some((o) => o.visible === false))
  const clip = edit.useClipboard((s) => s.count)
  const simActive = useUiStore((s) => s.simActive)
  if (simActive) return null

  const n = objs.length
  const allLocked = n > 0 && objs.every((o) => o.locked)
  const canUngroup = n === 1 && Array.isArray(objs[0]?.groupMembers) && objs[0].groupMembers.length > 0

  return (
    <div role="toolbar" aria-label="Edit actions" data-tour="edit-bar"
      className="absolute z-20 top-[60px] left-3 flex items-center gap-0.5 p-1 rounded-lg pointer-events-auto"
      style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 1px 3px rgb(0 0 0 / 0.08)' }}>
      <Btn icon="copy" title={`Copy (${K}C)`} disabled={!n} onClick={edit.copySelection} />
      <Btn icon="paste" title={`Paste (${K}V)`} disabled={!clip} onClick={edit.paste} />
      <Btn icon="duplicate" title={`Duplicate (${K}D). Move the copy, then duplicate again to repeat the step.`} disabled={!n} onClick={edit.duplicateSelection} />
      <Btn icon="trash" title="Delete (Del)" disabled={!n} onClick={edit.deleteSelection} />
      <Sep />
      <Btn icon="group" title={`Group (${K}G): joins solids, cuts holes. Select 2 or more.`} disabled={n < 2} onClick={edit.groupSelection} />
      <Btn icon="ungroup" title={`Ungroup (${K}Shift+G)`} disabled={!canUngroup} onClick={edit.ungroupSelection} />
      <Sep />
      <Popover id="align-menu" icon="align" title="Align: line up 2 or more parts" disabled={n < 2}>
        <div className="flex flex-col gap-2 w-[248px]">
          {ALIGN_ROWS.map(([axis, label, names]) => (
            <div key={axis}>
              <div className="text-[11px] mb-1" style={{ color: 'rgb(var(--g-500))' }}>{label}</div>
              <div className="grid grid-cols-3 gap-1">
                {['min', 'center', 'max'].map((w, i) => (
                  <button key={w} data-close className="ui-btn" style={{ height: 28 }} onClick={() => edit.alignSelection(axis, w)}>{names[i]}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Popover>
      <Popover id="mirror-menu" icon="mirror" title="Mirror: flip the selection" disabled={!n}>
        <div className="flex flex-col gap-1 w-[200px]">
          <button data-close className="ui-btn justify-start" onClick={() => edit.mirrorSelection('x')}>Flip left ↔ right</button>
          <button data-close className="ui-btn justify-start" onClick={() => edit.mirrorSelection('z')}>Flip front ↔ back</button>
          <button data-close className="ui-btn justify-start" onClick={() => edit.mirrorSelection('y')}>Flip upside down</button>
          <div className="text-[11px] mt-1 leading-snug" style={{ color: 'rgb(var(--g-500))' }}>Boards and sensors are not flipped (their pins would end up mirrored).</div>
        </div>
      </Popover>
      <Sep />
      <Btn icon={allLocked ? 'unlock' : 'lock'} title={allLocked ? `Unlock (${K}L)` : `Lock (${K}L): stops it being moved or resized`} disabled={!n} active={allLocked} onClick={edit.toggleLockSelection} />
      <Btn icon="eyeOff" title={`Hide (${K}Shift+H)`} disabled={!n} onClick={edit.hideSelection} />
      <Btn icon="eye" title="Show all hidden parts" disabled={!anyHidden} onClick={edit.showAll} />
    </div>
  )
}

export default memo(EditBar)
