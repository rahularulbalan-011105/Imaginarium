import { useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'

// ─────────────────────────────────────────────────────────────────────────────
// ElectronicsLibrary — the dedicated "Electronics" section of the right
// workspace. This is where electronics parts are CREATED (previously duplicated
// in the floating toolbox + Library). PRESENTATION ONLY: each part calls the
// same existing store action (sceneStore.addObject) the old UI used. Carries the
// `elec-*` tutorial anchors the guided coach spotlights.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    key: 'mcu', label: 'MCUs', icon: '🧠', blurb: 'Controllers that run programs.',
    items: [
      { type: 'arduino', label: 'Arduino', icon: '🟢', desc: 'Microcontroller board', purpose: 'The programmable “brain”. Runs your code and controls everything wired to it.', usage: 'robot brains · automation · reading sensors' },
      { type: 'subo',    label: 'SUBO',    icon: '🟣', desc: 'Controller w/ I/O ports', purpose: 'A controller board with built-in I/O ports for fast prototyping.', usage: 'plug-and-play wiring · prototyping' },
    ],
  },
  {
    key: 'actuators', label: 'Actuators', icon: '⚙', blurb: 'Create movement or output.',
    items: [
      { type: 'servo',    label: 'Servo Motor', icon: '🔩', desc: 'Angle control actuator', purpose: 'Rotates to a precise angle (0–180°).', usage: 'robot arms · steering · camera gimbals' },
      { type: 'motor_dc', label: 'DC Motor',    icon: '🔧', desc: 'Continuous rotation',     purpose: 'Spins continuously at a set speed.', usage: 'wheels · fans · propellers' },
      { type: 'motor_bo', label: 'BO Motor',    icon: '⚙',  desc: 'Geared drive motor',      purpose: 'A geared DC motor — high torque at low speed.', usage: 'driving robot wheels' },
      { type: 'led',      label: 'LED',         icon: '💡', desc: 'Light output',            purpose: 'A light you can switch on/off or dim from code.', usage: 'status indicators · signals' },
    ],
  },
  {
    key: 'sensors', label: 'Sensors & I/O', icon: '📡', blurb: 'Sense the world · extra outputs.',
    items: [
      { type: 'ultrasonic', label: 'Ultrasonic', icon: '📡', desc: 'Distance sensor',   purpose: 'Measures the distance to the nearest object in front of it.', usage: 'obstacle avoidance · range finding' },
      { type: 'ir_sensor',  label: 'IR Sensor',  icon: '👁', desc: 'Proximity / line',  purpose: 'Detects a nearby object or surface in front of it (near vs far).', usage: 'obstacle & edge detection · line following' },
      { type: 'gas_sensor', label: 'Gas Sensor', icon: '💨', desc: 'Gas / air quality', purpose: 'Reads a gas / air-quality level (analog value).', usage: 'gas alarms · air-quality projects' },
      { type: 'buzzer',     label: 'Buzzer',     icon: '🔔', desc: 'Sound output',       purpose: 'Beeps at a frequency you set from code.', usage: 'alerts · tones · feedback' },
      { type: 'oled',       label: 'OLED',       icon: '📺', desc: 'Text display',       purpose: 'A small screen — show text/values from code on the 3D screen.', usage: 'readouts · debug display' },
    ],
  },
]

const SOON = [
  { key: 'power',   label: 'Power',         icon: '🔋', note: 'Batteries · supplies · regulators — coming soon.' },
  { key: 'comms',   label: 'Communication', icon: '📶', note: 'WiFi · Bluetooth · RF — coming soon.' },
]

export default function ElectronicsLibrary() {
  const addObject = useSceneStore((s) => s.addObject)
  const { snapshot } = useHistory()
  const [openCats, setOpenCats] = useState({ mcu: true, actuators: true, sensors: true })
  const toggleCat = (key) => setOpenCats((o) => ({ ...o, [key]: !o[key] }))
  const addPart = (type) => { addObject(type); snapshot() }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2">
      <div className="text-[9px] text-green-500 uppercase tracking-wider mb-1.5 font-semibold px-1">Electronics</div>
      <div className="space-y-1">
        {CATEGORIES.map((cat) => {
          const open = !!openCats[cat.key]
          return (
            <div key={cat.key} className="rounded-lg border border-gray-700/40 overflow-hidden bg-gray-800/40">
              <button
                onClick={() => toggleCat(cat.key)}
                className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-gray-700/40 transition-colors"
              >
                <span className="text-sm">{cat.icon}</span>
                <span className="text-[12px] font-semibold" style={{ color: 'rgb(var(--g-200))' }}>{cat.label}</span>
                <span className="text-[10px]" style={{ color: 'rgb(var(--g-500))' }}>({cat.items.length})</span>
                <span className="ml-auto text-[10px]" style={{ color: 'rgb(var(--g-500))' }}>{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="px-1.5 pb-1.5">
                  {cat.blurb && <div className="text-[9px] mb-1 px-1" style={{ color: 'rgb(var(--g-500))' }}>{cat.blurb}</div>}
                  <div className="flex flex-col gap-1">
                    {cat.items.map(({ type, label, icon, desc, purpose, usage }) => (
                      <button
                        key={type}
                        data-tour={`elec-${type}`}
                        onClick={() => addPart(type)}
                        title={`${label}\n${purpose}\nCommonly used for: ${usage}`}
                        className="group flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg bg-gray-800/70 border border-transparent hover:border-green-500/40 hover:bg-green-500/10 transition-all duration-150 text-left"
                      >
                        <span className="text-lg leading-none shrink-0">{icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-medium leading-tight truncate" style={{ color: 'rgb(var(--g-200))' }}>{label}</span>
                          <span className="block text-[10px] leading-tight truncate" style={{ color: 'rgb(var(--g-400))' }}>{desc}</span>
                        </span>
                        <span className="text-[14px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ color: '#86efac' }}>＋</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {SOON.map((cat) => {
          const open = !!openCats[cat.key]
          return (
            <div key={cat.key} className="rounded-lg border border-gray-800/60 overflow-hidden bg-gray-900/40">
              <button
                onClick={() => toggleCat(cat.key)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-800/40 transition-colors"
                title={cat.note}
              >
                <span className="text-sm opacity-50">{cat.icon}</span>
                <span className="text-[11px] font-medium text-gray-500">{cat.label}</span>
                <span className="text-[9px] text-gray-600">(0)</span>
                <span className="ml-auto text-[8px] uppercase tracking-wider text-gray-600">soon</span>
              </button>
              {open && <div className="px-2.5 pb-2 text-[9px] text-gray-600 leading-snug">{cat.note}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
