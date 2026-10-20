import { useState, useRef, useEffect, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useHistory } from '../hooks/useHistory.js'
import ConnectionMenu from './ConnectionMenu.jsx'
import Icon from './ui/Icon.jsx'
import { ELEC_TYPES, PIN_DEFS, pinRole, wireStyle, isDuplicate, ROLE_COLORS } from '../utils/wiring.js'
import { ESP32_PINS } from '../utils/esp32Board.js'

// ─────────────────────────────────────────────────────────────────────────────
// Wiring Workbench — every electronics part drawn as a 2D component (board,
// servo, motor, LED, sensor module…) with its real pins on its edges. Drag from
// one pin to another to wire them; wires attach to the actual pin positions.
// Reads/writes the single electronicsStore.connections list — the same wires as
// Pick a Pin and the 3D view. Right-click (or click) a wire → Edit / Delete.
// Lives in the main workspace (CenterWorkspace) when ELEC → Wiring → Workbench.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_DOT = { power: ROLE_COLORS.power, gnd: ROLE_COLORS.gnd, signal: '#f97316' }

// Pins evenly spread along one edge of a w×h body.
function edge(pins, side, w, h, from = 0.12, to = 0.88) {
  const n = pins.length
  return pins.map((pin, i) => {
    const t = n === 1 ? 0.5 : from + (to - from) * (i / (n - 1))
    if (side === 'top')    return { pin, x: w * t, y: 0, side }
    if (side === 'bottom') return { pin, x: w * t, y: h, side }
    if (side === 'left')   return { pin, x: 0, y: h * t, side }
    return { pin, x: w, y: h * t, side }
  })
}

// ── 2D component art (inline SVG, cheap) ─────────────────────────────────────
function Board({ w, h, fill, label, sub }) {
  return (
    <>
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="12" fill={fill} stroke="rgb(0 0 0 / 0.25)" strokeWidth="1.5" />
      {[[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="3.2" fill="rgb(255 255 255 / 0.55)" />)}
      <rect x="1" y={h * 0.38} width="26" height="30" rx="3" fill="#cbd5e1" stroke="#94a3b8" />
      <rect x={w * 0.42} y={h * 0.42} width={w * 0.3} height="20" rx="2" fill="#111827" />
      <text x={w / 2} y={h * 0.33} textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" letterSpacing="2">{label}</text>
      {sub && <text x={w * 0.57} y={h * 0.42 + 14} textAnchor="middle" fontSize="9" fontWeight="700" fill="#e5e7eb">{sub}</text>}
      <rect x="12" y="7" width={w - 24} height="12" rx="3" fill="rgb(0 0 0 / 0.35)" />
      <rect x="12" y={h - 19} width={w - 24} height="12" rx="3" fill="rgb(0 0 0 / 0.35)" />
    </>
  )
}
function Module({ w, h, fill = '#1d4ed8', children }) {
  return (
    <>
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="10" fill={fill} stroke="rgb(0 0 0 / 0.25)" strokeWidth="1.5" />
      <rect x="8" y={h - 16} width={w - 16} height="10" rx="3" fill="rgb(0 0 0 / 0.3)" />
      {children}
    </>
  )
}

// ESP32 DevKit V1 — drawn the way the board actually looks (dark PCB, RF shield
// with its meander antenna, USB at the bottom, EN/BOOT buttons) and, crucially,
// with the header split 15 pins LEFT / 15 RIGHT exactly as on the hardware. The
// sides come from the same board table the 3D model and the validator use.
function Esp32Art({ w, h }) {
  const shieldW = w * 0.56, shieldX = (w - shieldW) / 2, shieldY = 28, shieldH = 74
  return (
    <>
      {/* PCB */}
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="9" fill="#1b2430" stroke="#0b1016" strokeWidth="1.5" />
      <rect x="3" y="3" width={w - 6} height={h - 6} rx="7" fill="none" stroke="rgb(255 255 255 / 0.06)" />
      {/* header strips under the pins */}
      <rect x="4" y="18" width="15" height={h - 70} rx="3" fill="#0f1620" />
      <rect x={w - 19} y="18" width="15" height={h - 70} rx="3" fill="#0f1620" />
      {/* mounting holes */}
      {[[9, 10], [w - 9, 10], [9, h - 10], [w - 9, h - 10]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3" fill="#0b1016" stroke="rgb(255 255 255 / 0.18)" />
      ))}
      {/* meander antenna at the very top, then the RF shield */}
      <path d={`M${shieldX + 6} 20 h7 v-9 h7 v9 h7 v-9 h7 v9 h7 v-9 h7 v9 h7`}
        fill="none" stroke="#c9a227" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x={shieldX} y={shieldY} width={shieldW} height={shieldH} rx="4" fill="#b8bfc9" stroke="#8a929d" />
      <rect x={shieldX + 4} y={shieldY + 4} width={shieldW - 8} height={shieldH - 8} rx="2" fill="none" stroke="#9aa2ad" />
      <text x={w / 2} y={shieldY + shieldH / 2 + 3} textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#4b5563" letterSpacing="0.5">ESP-WROOM-32</text>
      {/* crystal + regulator + LEDs */}
      <rect x={w / 2 - 26} y={shieldY + shieldH + 8} width="20" height="10" rx="2" fill="#9ca3af" />
      <rect x={w / 2 + 6} y={shieldY + shieldH + 8} width="20" height="10" rx="2" fill="#374151" />
      <circle cx={w / 2 - 14} cy={shieldY + shieldH + 28} r="3" fill="#ef4444" />
      <circle cx={w / 2 + 14} cy={shieldY + shieldH + 28} r="3" fill="#3b82f6" />
      <text x={w / 2 - 14} y={shieldY + shieldH + 40} textAnchor="middle" fontSize="5.5" fill="#9ca3af">PWR</text>
      <text x={w / 2 + 14} y={shieldY + shieldH + 40} textAnchor="middle" fontSize="5.5" fill="#9ca3af">IO2</text>
      {/* USB-serial chip */}
      <rect x={w / 2 - 14} y={h - 86} width="28" height="18" rx="2" fill="#111827" stroke="#374151" />
      {/* EN / BOOT buttons */}
      <rect x={w / 2 - 44} y={h - 60} width="22" height="16" rx="3" fill="#2f3845" stroke="#4b5563" />
      <rect x={w / 2 + 22} y={h - 60} width="22" height="16" rx="3" fill="#2f3845" stroke="#4b5563" />
      <text x={w / 2 - 33} y={h - 34} textAnchor="middle" fontSize="6" fill="#9ca3af">EN</text>
      <text x={w / 2 + 33} y={h - 34} textAnchor="middle" fontSize="6" fill="#9ca3af">BOOT</text>
      {/* micro-USB */}
      <rect x={w / 2 - 17} y={h - 22} width="34" height="16" rx="2" fill="#c7ccd4" stroke="#8a929d" />
      <rect x={w / 2 - 12} y={h - 18} width="24" height="8" rx="1" fill="#6b7280" />
      <text x={w / 2} y={h - 96} textAnchor="middle" fontSize="9" fontWeight="800" fill="#e5e7eb" letterSpacing="1.5">ESP32</text>
    </>
  )
}

const SHAPES = {
  esp32: () => {
    const left = ESP32_PINS.filter(p => p.side === 'left').map(p => p.name)
    const right = ESP32_PINS.filter(p => p.side === 'right').map(p => p.name)
    const w = 150, h = 26 + Math.max(left.length, right.length) * 17 + 60
    // Pads run down the header strips, not across the whole edge.
    const column = (names, x) => names.map((pin, i) => ({ pin, x, y: 26 + i * 17, side: x === 0 ? 'left' : 'right' }))
    return {
      w, h, title: 'ESP32',
      art: <Esp32Art w={w} h={h} />,
      pins: [...column(left, 0), ...column(right, w)],
    }
  },
  arduino: () => {
    const w = 280, h = 150, pins = PIN_DEFS.arduino
    return { w, h, title: 'ARDUINO', art: <Board w={w} h={h} fill="#0f8f96" label="ARDUINO" sub="UNO" />,
      pins: [...edge(pins.slice(0, 10), 'top', w, h, 0.1, 0.9), ...edge(pins.slice(10), 'bottom', w, h, 0.35, 0.65)] }
  },
  subo: () => {
    const w = 320, h = 160, pins = PIN_DEFS.subo
    return { w, h, title: 'SUBO', art: <Board w={w} h={h} fill="#7c3aed" label="SUBO" sub="ESP32-S3" />,
      pins: [...edge(pins.slice(0, 12), 'top', w, h, 0.07, 0.93), ...edge(pins.slice(12), 'bottom', w, h, 0.07, 0.93)] }
  },
  servo: () => {
    const w = 150, h = 78
    return { w, h, title: 'SERVO', pins: edge(PIN_DEFS.servo, 'bottom', w, h, 0.25, 0.75), art: (
      <>
        <rect x="1" y="12" width={w - 2} height={h - 13} rx="9" fill="#2563eb" stroke="rgb(0 0 0 / 0.25)" strokeWidth="1.5" />
        <rect x="-0" y="24" width="12" height="18" rx="3" fill="#1e40af" /><rect x={w - 12} y="24" width="12" height="18" rx="3" fill="#1e40af" />
        <circle cx={w * 0.7} cy="14" r="12" fill="#f8fafc" stroke="#94a3b8" /><rect x={w * 0.7 - 22} y="10" width="44" height="8" rx="4" fill="#f8fafc" stroke="#94a3b8" />
        <circle cx={w * 0.7} cy="14" r="3" fill="#64748b" />
        <text x={w * 0.36} y="46" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff" letterSpacing="1.5">SERVO</text>
      </>
    ) }
  },
  motor: (type) => {
    const w = 150, h = 74, bo = type === 'motor_bo'
    return { w, h, title: bo ? 'BO MOTOR' : 'DC MOTOR', pins: edge(PIN_DEFS[type], 'left', w, h, 0.3, 0.7), art: (
      <>
        <rect x="10" y="8" width={w * 0.62} height={h - 16} rx="10" fill={bo ? '#facc15' : '#cbd5e1'} stroke="rgb(0 0 0 / 0.25)" strokeWidth="1.5" />
        <rect x={w * 0.62 + 6} y="20" width={w * 0.2} height={h - 40} rx="5" fill={bo ? '#eab308' : '#94a3b8'} />
        <rect x={w * 0.82 + 4} y={h / 2 - 4} width={w * 0.14} height="8" rx="2" fill="#475569" />
        <text x={w * 0.33 + 6} y={h / 2 + 4} textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#1f2937">{bo ? 'BO MOTOR' : 'DC MOTOR'}</text>
      </>
    ) }
  },
  led: () => {
    const w = 64, h = 96
    return { w, h, title: 'LED', pins: edge(PIN_DEFS.led, 'bottom', w, h, 0.3, 0.7), art: (
      <>
        <path d={`M14 54 V30 a18 18 0 0 1 36 0 V54 Z`} fill="#ef4444" stroke="rgb(0 0 0 / 0.25)" strokeWidth="1.5" />
        <rect x="9" y="52" width="46" height="8" rx="2" fill="#dc2626" />
        <path d="M23 26 q4 -8 12 -6" stroke="#fff" strokeOpacity="0.7" strokeWidth="3" fill="none" strokeLinecap="round" />
        <line x1={w * 0.3} y1="60" x2={w * 0.3} y2={h} stroke="#94a3b8" strokeWidth="2.5" /><line x1={w * 0.7} y1="60" x2={w * 0.7} y2={h - 8} stroke="#94a3b8" strokeWidth="2.5" />
      </>
    ) }
  },
  module: (type) => {
    const pins = PIN_DEFS[type]
    const w = Math.max(120, 30 + pins.length * 26), h = 92
    const T = { ultrasonic: 'ULTRASONIC', ir_sensor: 'IR SENSOR', oled: 'OLED', buzzer: 'BUZZER', gas_sensor: 'GAS', color_sensor: 'COLOR', ldr_sensor: 'LDR', dht11: 'DHT11' }[type] ?? type.toUpperCase()
    const fill = { oled: '#1e3a8a', buzzer: '#111827', dht11: '#0369a1', gas_sensor: '#0f766e' }[type] ?? '#1d4ed8'
    const cx = w / 2
    const face = {
      ultrasonic: <><circle cx={cx - 26} cy="36" r="19" fill="#e5e7eb" stroke="#94a3b8" /><circle cx={cx + 26} cy="36" r="19" fill="#e5e7eb" stroke="#94a3b8" /><circle cx={cx - 26} cy="36" r="9" fill="#64748b" /><circle cx={cx + 26} cy="36" r="9" fill="#64748b" /></>,
      oled: <rect x="14" y="12" width={w - 28} height="44" rx="4" fill="#020617" stroke="#334155" />,
      buzzer: <><circle cx={cx} cy="38" r="26" fill="#1f2937" stroke="#4b5563" /><circle cx={cx} cy="38" r="4" fill="#9ca3af" /></>,
      ir_sensor: <><circle cx={cx - 14} cy="30" r="10" fill="#e5e7eb" /><circle cx={cx + 14} cy="30" r="10" fill="#111827" /></>,
      gas_sensor: <><circle cx={cx} cy="36" r="24" fill="#cbd5e1" stroke="#94a3b8" /><circle cx={cx} cy="36" r="15" fill="none" stroke="#64748b" strokeDasharray="2 3" strokeWidth="3" /></>,
      dht11: <rect x={cx - 24} y="10" width="48" height="50" rx="5" fill="#bae6fd" stroke="#0284c7" />,
      ldr_sensor: <><circle cx={cx} cy="34" r="16" fill="#fde68a" stroke="#d97706" /><path d={`M${cx - 10} 34 q3 -8 6 0 t6 0 t6 0`} stroke="#b45309" strokeWidth="2" fill="none" /></>,
      color_sensor: <>{[-14, 14].map(dx => [-12, 12].map(dy => <circle key={`${dx}${dy}`} cx={cx + dx} cy={34 + dy} r="6" fill="#fff" stroke="#94a3b8" />))}</>,
    }[type]
    return { w, h, title: T, pins: edge(pins, 'bottom', w, h, 0.12, 0.88), art: (
      <Module w={w} h={h} fill={fill}>
        {face}
        <text x={cx} y={h - 22} textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" letterSpacing="1">{T}</text>
      </Module>
    ) }
  },
}
// Exported for tests: every wireable type must get a real shape whose pins match
// PIN_DEFS, so a newly added board can't silently fall back to the generic
// module art (which is how the ESP32 first appeared: one blue box, 30 pins on
// a single edge).
export function shapeOf(type) {
  if (type === 'arduino') return SHAPES.arduino()
  if (type === 'subo') return SHAPES.subo()
  if (type === 'esp32') return SHAPES.esp32()
  if (type === 'servo') return SHAPES.servo()
  if (type === 'motor' || type === 'motor_bo' || type === 'motor_dc') return SHAPES.motor(type)
  if (type === 'led') return SHAPES.led()
  return SHAPES.module(type)
}

// Card positions survive leaving and re-opening the Workbench (session only).
const savedPos = new Map()
const LABEL_PAD = 22   // room for pin labels outside the body

export default function WiringWorkbench({ onClose, embedded = false }) {
  const objects     = useSceneStore(s => s.objects)
  const connections = useElectronicsStore(s => s.connections)
  const addWire     = useElectronicsStore(s => s.addWireConnection)
  const updateWire  = useElectronicsStore(s => s.updateWireConnection)
  const { snapshot } = useHistory()

  const comps = useMemo(() => objects.filter(o => ELEC_TYPES.has(o.type)), [objects])
  const shapes = useMemo(() => Object.fromEntries(comps.map(c => [c.id, shapeOf(c.type)])), [comps])

  const surfRef = useRef(null)
  const drag    = useRef(null)      // { type:'card'|'wire', … }
  const [pos, setPos] = useState(() => Object.fromEntries(savedPos))
  const [tmp, setTmp] = useState(null)        // live wire { x1,y1,x2,y2 }
  const [menu, setMenu] = useState(null)      // { connId, x, y }
  const [reconnect, setReconnect] = useState(null)   // { connId, end }

  // Auto-layout: boards on the left, parts flowing to the right.
  useEffect(() => {
    setPos(prev => {
      const next = { ...prev }
      const boards = comps.filter(c => c.type === 'arduino' || c.type === 'subo')
      const parts  = comps.filter(c => c.type !== 'arduino' && c.type !== 'subo')
      let by = 60
      for (const c of boards) if (!next[c.id]) { next[c.id] = { x: 50, y: by }; by += shapes[c.id].h + 110 }
      let i = Object.keys(prev).filter(id => parts.some(p => p.id === id)).length
      for (const c of parts) if (!next[c.id]) { next[c.id] = { x: 450 + (i % 3) * 210, y: 60 + Math.floor(i / 3) * 170 }; i++ }
      for (const [id, p] of Object.entries(next)) savedPos.set(id, p)
      return next
    })
  }, [comps, shapes])

  const pinXY = (compId, pin) => {
    const s = shapes[compId], p = pos[compId]
    const def = s?.pins.find(q => q.pin === pin)
    if (!def || !p) return null
    return { x: p.x + LABEL_PAD + def.x, y: p.y + LABEL_PAD + def.y, side: def.side }
  }

  const relXY = (e) => {
    const r = surfRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left + surfRef.current.scrollLeft, y: e.clientY - r.top + surfRef.current.scrollTop }
  }

  const onMove = (e) => {
    const d = drag.current; if (!d) return
    const { x, y } = relXY(e)
    if (d.type === 'card') {
      const np = { x: Math.max(0, x - d.ox), y: Math.max(0, y - d.oy) }
      savedPos.set(d.id, np)
      setPos(p => ({ ...p, [d.id]: np }))
    } else if (d.type === 'wire') setTmp(t => t && { ...t, x2: x, y2: y })
  }
  const onUp = () => { if (drag.current?.type === 'wire') setTmp(null); drag.current = null }

  const startCard = (id) => (e) => {
    if (e.button !== 0) return
    const { x, y } = relXY(e)
    drag.current = { type: 'card', id, ox: x - pos[id].x, oy: y - pos[id].y }
  }
  const pinDown = (compId, pin) => (e) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const pinId = `${compId}:${pin}`
    if (reconnect) {
      const c = connections[reconnect.connId]
      const other = reconnect.end === 'fromPinId' ? c?.toPinId : c?.fromPinId
      if (c && pinId !== other && !isDuplicate(connections, pinId, other)) { updateWire(reconnect.connId, { [reconnect.end]: pinId }); snapshot('reconnect wire') }
      setReconnect(null)
      return
    }
    const pp = pinXY(compId, pin); if (!pp) return
    drag.current = { type: 'wire', fromPinId: pinId }
    setTmp({ x1: pp.x, y1: pp.y, x2: pp.x, y2: pp.y })
  }
  const pinUp = (compId, pin) => (e) => {
    e.stopPropagation()
    const d = drag.current
    if (d?.type === 'wire') {
      const from = d.fromPinId, to = `${compId}:${pin}`
      if (from !== to && !isDuplicate(connections, from, to)) { addWire(from, to, uuidv4()); snapshot('wire') }
      drag.current = null; setTmp(null)
    }
  }

  const openMenu = (connId) => (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ connId, x: e.clientX, y: e.clientY }) }

  const connList = Object.entries(connections)
  // Canvas size so scrolling reaches every card.
  const extent = Object.entries(pos).reduce((m, [id, p]) => {
    const s = shapes[id]; if (!s) return m
    return { w: Math.max(m.w, p.x + s.w + 2 * LABEL_PAD + 60), h: Math.max(m.h, p.y + s.h + 2 * LABEL_PAD + 60) }
  }, { w: 0, h: 0 })

  // Wire path: leave each pin along its edge's outward normal, then curve.
  const wirePath = (a, b) => {
    const k = 50
    const n = (s) => ({ top: [0, -k], bottom: [0, k], left: [-k, 0], right: [k, 0] }[s] ?? [0, 0])
    const [ax, ay] = n(a.side), [bx, by] = n(b.side)
    return `M ${a.x} ${a.y} C ${a.x + ax} ${a.y + ay}, ${b.x + bx} ${b.y + by}, ${b.x} ${b.y}`
  }

  return (
    <div className={`${embedded ? 'absolute' : 'fixed z-50'} inset-0 flex flex-col`} style={{ background: 'rgb(var(--g-950))' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 h-11 shrink-0" style={{ background: 'rgb(var(--g-900))', borderBottom: '1px solid rgb(var(--g-700) / 0.55)' }}>
        <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'rgb(var(--g-100))' }}>
          <span style={{ color: 'rgb(var(--a-600))' }}><Icon name="zap" size={15} /></span> Workbench
        </span>
        <span className="text-[11px] hidden lg:inline" style={{ color: 'rgb(var(--g-400))' }}>
          {reconnect ? 'Click the new pin for this wire (Esc to cancel)' : 'Drag from a pin to another pin to wire · drag a part to move it · right-click a wire to edit or delete'}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-3 text-[10px]" style={{ color: 'rgb(var(--g-400))' }}>
          <Dot c={ROLE_COLORS.power} l="Power" /><Dot c={ROLE_COLORS.gnd} l="GND" /><Dot c="#f97316" l="Signal" />
        </span>
        <span className="text-[11px]" style={{ color: 'rgb(var(--g-400))' }}>{comps.length} parts · {connList.length} wires</span>
        <button onClick={onClose} className="ui-btn ui-btn-primary">Done</button>
      </div>

      {/* Canvas */}
      <div
        ref={surfRef}
        className="relative flex-1 overflow-auto select-none"
        style={{ backgroundImage: 'radial-gradient(rgb(var(--g-600) / 0.35) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onKeyDown={(e) => { if (e.key === 'Escape') { setReconnect(null); onUp() } }}
        tabIndex={-1}
      >
        <div style={{ width: extent.w, height: extent.h, position: 'relative' }}>
          {comps.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none" style={{ color: 'rgb(var(--g-500))', width: '100%', minHeight: 300 }}>
              Add electronics (Arduino, motors, sensors…) from ELEC → Elec to wire them here.
            </div>
          )}

          {/* Parts */}
          {comps.map(c => {
            const p = pos[c.id], s = shapes[c.id]; if (!p || !s) return null
            return (
              <div key={c.id} className="absolute" style={{ left: p.x, top: p.y, width: s.w + 2 * LABEL_PAD, height: s.h + 2 * LABEL_PAD }}>
                <svg width={s.w} height={s.h} style={{ position: 'absolute', left: LABEL_PAD, top: LABEL_PAD, overflow: 'visible', cursor: 'grab', filter: 'drop-shadow(0 3px 6px rgb(15 23 42 / 0.18))' }}
                  onMouseDown={startCard(c.id)} role="img" aria-label={`${c.name} (${s.title})`}>
                  {s.art}
                </svg>
                <div className="absolute text-[10px] font-semibold truncate pointer-events-none" style={{ left: LABEL_PAD, top: LABEL_PAD + s.h + (s.pins.some(q => q.side === 'bottom') ? 26 : 6), width: s.w, textAlign: 'center', color: 'rgb(var(--g-300))' }}>
                  {c.name}
                </div>
                {s.pins.map(({ pin, x, y, side }) => {
                  const role = pinRole(pin)
                  const lx = side === 'left' ? -4 : side === 'right' ? 4 : 0
                  const ly = side === 'top' ? -11 : side === 'bottom' ? 11 : 0
                  return (
                    <div key={pin}>
                      <button
                        onMouseDown={pinDown(c.id, pin)}
                        onMouseUp={pinUp(c.id, pin)}
                        title={`${c.name} · ${pin} — drag to another pin to connect`}
                        aria-label={`${c.name} pin ${pin}`}
                        className="absolute rounded-full transition-transform hover:scale-125"
                        style={{
                          left: LABEL_PAD + x - 6, top: LABEL_PAD + y - 6, width: 12, height: 12,
                          background: ROLE_DOT[role], border: '2px solid #fff', cursor: 'crosshair',
                          boxShadow: reconnect ? '0 0 0 3px rgb(var(--a-600) / 0.45)' : '0 1px 3px rgb(0 0 0 / 0.35)',
                        }}
                      />
                      <span className="absolute text-[8.5px] font-mono font-semibold pointer-events-none whitespace-nowrap"
                        style={{
                          left: LABEL_PAD + x + lx, top: LABEL_PAD + y + ly,
                          transform: side === 'left' ? 'translate(-100%, -50%)' : side === 'right' ? 'translate(0, -50%)' : 'translate(-50%, -50%)',
                          color: 'rgb(var(--g-300))',
                        }}>
                        {pin}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* Wires — above the parts, clickable only on the stroke */}
          <svg className="absolute inset-0" width={extent.w} height={extent.h} style={{ pointerEvents: 'none', overflow: 'visible' }}>
            {connList.map(([id, c]) => {
              const [fa, fp] = (c.fromPinId ?? '').split(':')
              const [ta, tp] = (c.toPinId ?? '').split(':')
              const a = pinXY(fa, fp), b = pinXY(ta, tp)
              if (!a || !b) return null
              const st = wireStyle(id, c)
              const d = wirePath(a, b)
              return (
                <g key={id} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={openMenu(id)} onContextMenu={openMenu(id)}>
                  <title>{`${st.label} wire — click or right-click to edit / delete`}</title>
                  <path d={d} fill="none" stroke="transparent" strokeWidth="14" />
                  <path d={d} fill="none" stroke="#fff" strokeWidth="5.5" strokeOpacity="0.85" />
                  <path d={d} fill="none" stroke={st.color} strokeWidth="3" strokeLinecap="round" />
                </g>
              )
            })}
            {tmp && <path d={`M ${tmp.x1} ${tmp.y1} L ${tmp.x2} ${tmp.y2}`} fill="none" stroke="rgb(var(--a-600))" strokeWidth="2.5" strokeDasharray="6 4" />}
          </svg>
        </div>
      </div>

      {menu && <ConnectionMenu {...menu} onClose={() => setMenu(null)} onReconnect={(connId, end) => setReconnect({ connId, end })} />}
    </div>
  )
}

function Dot({ c, l }) {
  return <span className="flex items-center gap-1"><span className="w-4 h-[3px] rounded-full" style={{ background: c }} />{l}</span>
}
