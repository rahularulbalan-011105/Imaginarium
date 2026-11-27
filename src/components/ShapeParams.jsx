import { SHAPE_PARAMS } from '../utils/shapes3d.js'

// Properties editor for the parametric Tinkercad shapes (polygon sides, tube
// wall, star points, segment counts, scribble thickness). Values are clamped to
// each parameter's range; ObjectManager rebuilds the geometry on change.
export default function ShapeParams({ obj, update, snapshot }) {
  const params = SHAPE_PARAMS[obj?.type]
  if (!params || !Object.keys(params).length) return null
  return (
    <div className="px-3 py-2 space-y-1" data-tour="shape-params">
      <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'rgb(var(--g-400))' }}>Shape</div>
      {Object.entries(params).map(([key, p]) => {
        const v = obj[key] ?? p.default
        return (
          <label key={key} className="flex items-center gap-2 py-0.5">
            <span className="text-[11px] w-24 shrink-0" style={{ color: 'rgb(var(--g-300))' }}>{p.label}</span>
            <input type="range" min={p.min} max={p.max} step={p.step} value={v}
              onChange={(e) => update({ [key]: Number(e.target.value) })} onPointerUp={() => snapshot?.()}
              className="flex-1 accent-orange-500" aria-label={p.label} />
            <input type="number" min={p.min} max={p.max} step={p.step} value={v}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) { update({ [key]: Math.min(p.max, Math.max(p.min, n)) }); snapshot?.() } }}
              className="w-14 text-[11px] bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-right" style={{ color: 'rgb(var(--g-200))' }} />
          </label>
        )
      })}
    </div>
  )
}
