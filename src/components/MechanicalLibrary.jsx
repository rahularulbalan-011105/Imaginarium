import { useSceneStore } from '../stores/sceneStore.js'
import { usePlacement, placeCardProps } from '../managers/placement.js'

// ─────────────────────────────────────────────────────────────────────────────
// MechanicalLibrary — the dedicated "Mechanical" section of the right workspace.
// Where mechanical parts are CREATED (moved out of the floating toolbox and the
// Library so there's no duplication). PRESENTATION ONLY: each part calls the
// same sceneStore.addObject action the old UI used.
// ─────────────────────────────────────────────────────────────────────────────

const PARTS = [
  { type: 'wheel',  label: 'Robot Wheel', icon: '🛞', desc: 'Attach to a motor · size sets speed' },
  // Mecanum: the Wheel part with rollers (utils/mecanum.js). Two hands, as sold:
  // a robot needs two A and two B, A on front-left + rear-right.
  { type: 'wheel', key: 'mecanum-A', label: 'Mecanum Wheel A', icon: '🛞', desc: 'Rollers ↗ · front-left + rear-right', overrides: { wheelStyle: 'mecanum', rollerHand: 'A', color: '#ffd23f', tyreColor: '#1c1d21' } },
  { type: 'wheel', key: 'mecanum-B', label: 'Mecanum Wheel B', icon: '🛞', desc: 'Rollers ↖ · front-right + rear-left', overrides: { wheelStyle: 'mecanum', rollerHand: 'B', color: '#ffd23f', tyreColor: '#1c1d21' } },
  { type: 'caster', label: 'Ball Caster', icon: '⚪', desc: 'Free-rolling support wheel' },
  { type: 'gear',  label: 'Spur Gear', icon: '⚙',  desc: 'Mesh two to transfer motion' },
  { type: 'bolt',  label: 'Bolt',      icon: '🔩', desc: 'Fastener part' },
  { type: 'screw', label: 'Screw',     icon: '🪛', desc: 'Fastener part' },
  { type: 'star',  label: 'Star Knot', icon: '★',  desc: 'Decorative part' },
]

export default function MechanicalLibrary() {
  const addObject = useSceneStore((s) => s.addObject)
  const pendingKey = usePlacement((st) => st.pending?.key)

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2">
      <div className="ui-lib-head mt-1">Mechanical parts</div>
      <div className="flex flex-col gap-1">
        {PARTS.map(({ type, key, label, desc, overrides }) => (
          <button
            key={key ?? type}
            {...placeCardProps({ key: `mech:${key ?? type}`, label: label.toLowerCase(), create: () => addObject(type, undefined, overrides) }, pendingKey)}
            title={`${label}: click, then click the grid to place it (or drag it onto the grid)`}
            className="group flex items-center gap-2.5 w-full px-2 py-2 rounded-lg border border-transparent hover:bg-gray-800 aria-pressed:border-orange-500/60 aria-pressed:bg-orange-500/10 transition-colors text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium leading-tight truncate" style={{ color: 'rgb(var(--g-200))' }}>{label}</span>
              <span className="block text-[10px] leading-tight truncate" style={{ color: 'rgb(var(--g-400))' }}>{desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
