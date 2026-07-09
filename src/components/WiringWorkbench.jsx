import { useState, useRef, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'

// Drag-to-connect 2D wiring workbench (Fritzing / Tinkercad-Circuits style).
// Each electronics component is a draggable card with terminal ports; drag from
// one port to another to create a wire. Wires render as coloured curves and can
// be clicked to delete. Reads/writes the same electronicsStore.connections the
// 3D wires use, so the two views stay in sync.

const ELEC_TYPES = new Set(['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo', 'ir_sensor', 'ultrasonic', 'buzzer', 'oled', 'gas_sensor'])
const PIN_DEFS = {
  arduino:  ['D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','5V','GND1','GND2'],
  subo:     ['IO1','IO2','IO3','IO4','IO5','IO6','IO7','IO8'],
  motor:    ['TERM_A','TERM_B'], motor_bo: ['TERM_A','TERM_B'], motor_dc: ['TERM_A','TERM_B'],
  led:      ['ANODE','CATHODE'], servo: ['SIGNAL','VCC','GND'],
  ir_sensor:  ['OUT','GND','VCC'], ultrasonic: ['VCC','TRIG','ECHO','GND'],
  buzzer:     ['SIGNAL','GND'], oled: ['GND','VCC','SCL','SDA'], gas_sensor: ['VCC','GND','DO','AO'],
}
const COMP_ICONS = { arduino: '🟢', subo: '🟣', motor: '⚙', motor_bo: '⚙', motor_dc: '🔧', led: '💡', servo: '🔩', ir_sensor: '👁', ultrasonic: '📡', buzzer: '🔔', oled: '📺', gas_sensor: '💨' }
const WIRE_COLORS = ['#f59e0b','#3b82f6','#22c55e','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316']

// Colour a port by its electrical role (power=red, gnd=dark, signal=amber).
function portColor(pin) {
  if (/^(5V|VCC|.*_V)$/.test(pin) || pin === 'ANODE') return '#ef4444'
  if (/^(GND|GND1|GND2|.*_G|CATHODE)$/.test(pin))      return '#334155'
  return '#f59e0b'
}

const CARD_W = 158, HEADER_H = 30, ROW_H = 22, PAD = 8

export default function WiringWorkbench({ onClose }) {
  const objects       = useSceneStore(s => s.objects)
  const connections   = useElectronicsStore(s => s.connections)
  const addWire       = useElectronicsStore(s => s.addWireConnection)
  const removeWire    = useElectronicsStore(s => s.removeWireConnection)

  const comps = objects.filter(o => ELEC_TYPES.has(o.type))
  const byId  = Object.fromEntries(comps.map(c => [c.id, c]))

  const surfRef = useRef(null)
  const drag    = useRef(null)      // { type:'card'|'wire', … }
  const [pos, setPos] = useState({})
  const [tmp, setTmp] = useState(null)   // { x1,y1,x2,y2 } live wire being dragged

  // Auto-layout any component that doesn't have a position yet (grid).
  useEffect(() => {
    setPos(prev => {
      const next = { ...prev }
      let n = Object.keys(prev).length
      for (const c of comps) {
        if (!next[c.id]) { next[c.id] = { x: 40 + (n % 4) * 200, y: 70 + Math.floor(n / 4) * 240 }; n++ }
      }
      return next
    })
  }, [comps.map(c => c.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const pinsOf = (c) => PIN_DEFS[c.type] ?? []

  const portPos = (compId, pin) => {
    const c = byId[compId]; const p = pos[compId]
    if (!c || !p) return null
    const idx = pinsOf(c).indexOf(pin)
    if (idx < 0) return null
    return { x: p.x + CARD_W, y: p.y + HEADER_H + PAD + idx * ROW_H + ROW_H / 2 }
  }

  const relXY = (e) => {
    const r = surfRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onMove = (e) => {
    const d = drag.current; if (!d) return
    const { x, y } = relXY(e)
    if (d.type === 'card') setPos(p => ({ ...p, [d.id]: { x: x - d.ox, y: y - d.oy } }))
    else if (d.type === 'wire') setTmp(t => t && { ...t, x2: x, y2: y })
  }
  const onUp = () => { if (drag.current?.type === 'wire') setTmp(null); drag.current = null }

  const startCard = (id) => (e) => {
    const { x, y } = relXY(e)
    drag.current = { type: 'card', id, ox: x - pos[id].x, oy: y - pos[id].y }
  }
  const startWire = (compId, pin) => (e) => {
    e.stopPropagation()
    const pp = portPos(compId, pin); if (!pp) return
    drag.current = { type: 'wire', fromPinId: `${compId}:${pin}` }
    setTmp({ x1: pp.x, y1: pp.y, x2: pp.x, y2: pp.y })
  }
  const endWire = (compId, pin) => (e) => {
    e.stopPropagation()
    const d = drag.current
    if (d?.type === 'wire') {
      const from = d.fromPinId, to = `${compId}:${pin}`
      const dup = Object.values(connections).some(c =>
        (c.fromPinId === from && c.toPinId === to) || (c.fromPinId === to && c.toPinId === from))
      if (from !== to && !dup) addWire(from, to, uuidv4())
      drag.current = null; setTmp(null)
    }
  }

  const connList = Object.entries(connections)

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 h-11 shrink-0 bg-gray-900 border-b border-amber-700/40">
        <span className="text-sm font-semibold text-white">🔌 Wiring Workbench</span>
        <span className="text-[11px] text-gray-400">Drag from a terminal dot to another to connect · drag a card header to move · click a wire to delete</span>
        <div className="flex-1" />
        <span className="text-[11px] text-gray-400">{comps.length} components · {connList.length} wires</span>
        <button onClick={onClose} className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white">Done</button>
      </div>

      {/* Canvas */}
      <div
        ref={surfRef}
        className="relative flex-1 overflow-auto"
        style={{ background: '#0f172a', backgroundImage: 'radial-gradient(rgba(148,163,184,0.18) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
      >
        {comps.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none">
            Add electronics components (Arduino, motors, sensors…) to wire them here.
          </div>
        )}

        {/* Wires (SVG overlay) */}
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', overflow: 'visible' }}>
          {connList.map(([id, c], i) => {
            const [fa, fp] = (c.fromPinId ?? '').split(':')
            const [ta, tp] = (c.toPinId ?? '').split(':')
            const a = portPos(fa, fp), b = portPos(ta, tp)
            if (!a || !b) return null
            const col = WIRE_COLORS[i % WIRE_COLORS.length]
            const mx = (a.x + b.x) / 2
            const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
            return (
              <g key={id} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={() => removeWire(id)}>
                <path d={d} fill="none" stroke="transparent" strokeWidth="12" />
                <path d={d} fill="none" stroke={col} strokeWidth="2.5" />
              </g>
            )
          })}
          {tmp && <path d={`M ${tmp.x1} ${tmp.y1} L ${tmp.x2} ${tmp.y2}`} fill="none" stroke="#fcd34d" strokeWidth="2.5" strokeDasharray="6 4" />}
        </svg>

        {/* Component cards */}
        {comps.map(c => {
          const p = pos[c.id]; if (!p) return null
          const pins = pinsOf(c)
          return (
            <div key={c.id} className="absolute rounded-lg shadow-xl select-none"
              style={{ left: p.x, top: p.y, width: CARD_W, background: '#1e293b', border: '1px solid rgba(245,158,11,0.35)' }}>
              <div onMouseDown={startCard(c.id)}
                className="flex items-center gap-1.5 px-2 rounded-t-lg cursor-grab active:cursor-grabbing"
                style={{ height: HEADER_H, background: 'linear-gradient(90deg,#78350f,#b45309)' }}>
                <span>{COMP_ICONS[c.type] ?? '📦'}</span>
                <span className="text-[11px] font-semibold text-white truncate">{c.name}</span>
              </div>
              <div style={{ padding: PAD }}>
                {pins.map((pin) => (
                  <div key={pin} className="flex items-center justify-between" style={{ height: ROW_H }}>
                    <span className="text-[10px] font-mono" style={{ color: '#cbd5e1' }}>{pin}</span>
                    <span
                      onMouseDown={startWire(c.id, pin)}
                      onMouseUp={endWire(c.id, pin)}
                      title={`${c.name} · ${pin} — drag to another terminal to connect`}
                      style={{
                        width: 13, height: 13, borderRadius: '50%', marginRight: -PAD - 6,
                        background: portColor(pin), border: '2px solid #0f172a', cursor: 'crosshair',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
