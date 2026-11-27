import { useEffect, useState } from 'react'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { simulationManager } from '../managers/SimulationManager.js'
import { getPart } from '../parts/registry.js'
import { propOf } from '../parts/definePart.js'

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue-part UI, driven entirely by each part's definition (src/parts):
//   <PartSimControls>   in the simulation bar — the part's sim.controls
//                       (hold a pushbutton, flip a switch, turn a knob, press a
//                       keypad key) + its live readout (a multimeter's display).
//                       Values live in electronicsStore.sensorValues['id:key'].
//   <PartProperties>    in Properties — the part's editable props (resistance,
//                       LED colour, battery voltage …), with units and limits.
// ─────────────────────────────────────────────────────────────────────────────

const ctlKey = (id, key) => `${id}:${key}`

function useReadout(obj, part) {
  const [text, setText] = useState(null)
  useEffect(() => {
    if (!part?.sim?.readout) return
    const t = setInterval(() => {
      const br = simulationManager._circuit
      const solved = br?.sim?.stateOf(obj.id) ?? null
      const state = br?.partState?.[obj.id] ?? null
      try { setText(part.sim.readout({ solved, state }, obj)) } catch { setText(null) }
    }, 120)
    return () => clearInterval(t)
  }, [obj, part])
  return text
}

function Control({ obj, c, values, set }) {
  const k = ctlKey(obj.id, c.key)
  // A control tied to a prop (c.prop) starts from the object's own value.
  const v = values[k] ?? (c.prop ? propOf(getPart(obj.type), obj, c.prop) : undefined) ?? c.default ?? 0
  const base = 'px-2 py-1 rounded text-[10px] font-semibold transition-colors select-none'
  if (c.kind === 'button') {
    return (
      <button onPointerDown={() => set(k, 1)} onPointerUp={() => set(k, 0)} onPointerLeave={() => v && set(k, 0)}
        aria-pressed={!!v} className={`${base} ${v ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
        {v ? (c.onLabel ?? 'Pressed') : (c.label ?? 'Hold to press')}
      </button>
    )
  }
  if (c.kind === 'toggle') {
    return (
      <button onClick={() => set(k, v ? 0 : 1)} aria-pressed={!!v}
        className={`${base} ${v ? 'bg-cyan-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
        {(c.label ?? '')}{c.label ? ': ' : ''}{v ? (c.onLabel ?? 'ON') : (c.offLabel ?? 'OFF')}
      </button>
    )
  }
  if (c.kind === 'slider') {
    return (
      <label className="flex items-center gap-1.5 text-[10px] text-gray-300">
        <span>{c.label}</span>
        <input type="range" min={c.min} max={c.max} step={c.step ?? 1} value={v}
          onChange={(e) => set(k, Number(e.target.value))} className="w-24 accent-orange-500" aria-label={`${obj.name} ${c.label}`} />
        <span className="font-mono w-14">{c.format ? c.format(v) : `${v}${c.unit ? ' ' + c.unit : ''}`}</span>
      </label>
    )
  }
  if (c.kind === 'keypad' || c.kind === 'buttons') {
    // Grid of momentary keys; the value is the key held (or '').
    const rows = c.rows
    return (
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${rows[0].length}, minmax(0, 1fr))` }} role="group" aria-label={`${obj.name} keys`}>
        {rows.flat().map((label) => (
          <button key={label} onPointerDown={() => set(k, label)} onPointerUp={() => set(k, '')} onPointerLeave={() => v === label && set(k, '')}
            className={`w-7 h-6 rounded text-[10px] font-bold ${v === label ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}>{label}</button>
        ))}
      </div>
    )
  }
  return null
}

export function PartSimControls({ obj }) {
  const part = getPart(obj.type)
  const values = useElectronicsStore(s => s.sensorValues)
  const set = useElectronicsStore(s => s.setSensorValue)
  const readout = useReadout(obj, part)
  const controls = part?.sim?.controls ?? []
  if (!part || (!controls.length && !part.sim.readout)) return null
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[9px] text-gray-500">{part.icon ?? '◆'} {obj.name}{readout ? <span className="font-mono text-gray-300"> · {readout}</span> : null}</div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {controls.map(c => <Control key={c.key} obj={obj} c={c} values={values} set={set} />)}
      </div>
    </div>
  )
}

/** Does this object have anything to show in the simulation bar? */
export function hasSimControls(obj) {
  const p = getPart(obj.type)
  return !!p && ((p.sim?.controls?.length ?? 0) > 0 || !!p.sim?.readout)
}

export function PartProperties({ obj, update, snapshot }) {
  const part = getPart(obj.type)
  if (!part || !Object.keys(part.props ?? {}).length) return null
  const row = 'flex items-center justify-between gap-2 py-0.5'
  return (
    <div className="px-3 py-2 space-y-1" data-tour="part-props">
      <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'rgb(var(--g-400))' }}>{part.label}</div>
      {part.spec?.summary && <div className="text-[10px] leading-snug" style={{ color: 'rgb(var(--g-500))' }}>{part.spec.summary}</div>}
      {Object.entries(part.props).map(([key, p]) => {
        const v = propOf(part, obj, key)
        const commit = (val) => { update({ [key]: val }); snapshot?.() }
        const label = <span className="text-[11px]" style={{ color: 'rgb(var(--g-300))' }}>{p.label ?? key}{p.unit ? ` (${p.unit})` : ''}</span>
        if (p.type === 'select') return (
          <label key={key} className={row}>{label}
            <select value={String(v)} onChange={(e) => commit(p.options.find(o => String(o.value) === e.target.value)?.value)}
              className="text-[11px] bg-gray-800 border border-gray-700 rounded px-1 py-0.5" style={{ color: 'rgb(var(--g-200))' }}>
              {p.options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
            </select>
          </label>
        )
        if (p.type === 'color') return (
          <label key={key} className={row}>{label}<input type="color" value={v} onChange={(e) => commit(e.target.value)} /></label>
        )
        if (p.type === 'bool') return (
          <label key={key} className={row}>{label}<input type="checkbox" checked={!!v} onChange={(e) => commit(e.target.checked)} /></label>
        )
        if (p.type === 'text') return (
          <label key={key} className={row}>{label}<input type="text" value={v ?? ''} maxLength={p.maxLength ?? 64} onChange={(e) => commit(e.target.value)}
            className="w-28 text-[11px] bg-gray-800 border border-gray-700 rounded px-1 py-0.5" style={{ color: 'rgb(var(--g-200))' }} /></label>
        )
        return (
          <label key={key} className={row}>{label}
            <input type="number" value={v} min={p.min} max={p.max} step={p.step ?? 'any'}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                // Out-of-range values are clamped to the part's real limits.
                commit(Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n)))
              }}
              className="w-24 text-[11px] bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-right" style={{ color: 'rgb(var(--g-200))' }} />
          </label>
        )
      })}
    </div>
  )
}
