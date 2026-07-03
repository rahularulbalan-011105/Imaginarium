import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'

// ─────────────────────────────────────────────────────────────────────────────
// MechanicalLibrary — the dedicated "Mechanical" section of the right workspace.
// Where mechanical parts are CREATED (moved out of the floating toolbox and the
// Library so there's no duplication). PRESENTATION ONLY: each part calls the
// same sceneStore.addObject action the old UI used.
// ─────────────────────────────────────────────────────────────────────────────

const PARTS = [
  { type: 'gear',  label: 'Spur Gear', icon: '⚙',  desc: 'Mesh two to transfer motion' },
  { type: 'bolt',  label: 'Bolt',      icon: '🔩', desc: 'Fastener part' },
  { type: 'screw', label: 'Screw',     icon: '🪛', desc: 'Fastener part' },
  { type: 'star',  label: 'Star Knot', icon: '★',  desc: 'Decorative part' },
]

export default function MechanicalLibrary() {
  const addObject = useSceneStore((s) => s.addObject)
  const { snapshot } = useHistory()
  const addPart = (type) => { addObject(type); snapshot() }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2">
      <div className="text-[9px] text-orange-500 uppercase tracking-wider mb-1.5 font-semibold px-1">Mechanical</div>
      <div className="flex flex-col gap-1">
        {PARTS.map(({ type, label, icon, desc }) => (
          <button
            key={type}
            onClick={() => addPart(type)}
            title={label}
            className="group flex items-center gap-2.5 w-full px-2 py-2 rounded-lg bg-gray-800/70 border border-transparent hover:border-orange-500/40 hover:bg-orange-500/10 transition-all duration-150 text-left"
          >
            <span className="text-lg leading-none shrink-0">{icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium leading-tight truncate" style={{ color: 'rgb(var(--g-200))' }}>{label}</span>
              <span className="block text-[10px] leading-tight truncate" style={{ color: 'rgb(var(--g-400))' }}>{desc}</span>
            </span>
            <span className="text-[14px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ color: 'rgb(var(--a-400))' }}>＋</span>
          </button>
        ))}
      </div>
    </div>
  )
}
