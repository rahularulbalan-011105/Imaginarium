import { useState, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'
import ConnectionMenu from './ConnectionMenu.jsx'
import { ELEC_TYPES, PIN_DEFS, pinRole, wireStyle, friendlyPin, isDuplicate, ROLE_COLORS } from '../utils/wiring.js'

// ─────────────────────────────────────────────────────────────────────────────
// Pick a Pin — click a pin, click another, Connect. Reads and writes the single
// electronicsStore.connections list (the Workbench and the 3D view use the same
// list, and the 3D wires follow it via wireManager.syncFromStore).
// Each wire shows in its role colour (red power · black GND · signal colours) on
// the pins it joins; right-click a wire (or a wired pin) → Edit / Delete.
// ─────────────────────────────────────────────────────────────────────────────

const COMP_ICONS = { arduino: '🟢', subo: '🟣', motor: '⚙', motor_bo: '⚙', motor_dc: '🔧', led: '💡', servo: '🔩', ir_sensor: '👁', ultrasonic: '📡', buzzer: '🔔', oled: '📺', gas_sensor: '💨', color_sensor: '🎨', ldr_sensor: '🔆', dht11: '🌡' }
const ROLE_DOT = { power: ROLE_COLORS.power, gnd: ROLE_COLORS.gnd, signal: '#f97316' }

export default function WiringPanel() {
  const objects     = useSceneStore(s => s.objects)
  const connections = useElectronicsStore(s => s.connections)
  const addWireConnection    = useElectronicsStore(s => s.addWireConnection)
  const updateWireConnection = useElectronicsStore(s => s.updateWireConnection)
  const { snapshot } = useHistory()

  const elecObjects = objects.filter(o => ELEC_TYPES.has(o.type))

  // 'idle' → 'source' (first pin picked) → 'confirm' (both picked)
  // 'reconnect' = re-pointing one end of an existing wire (from the Edit menu)
  const [mode, setMode]     = useState('idle')
  const [srcPin, setSrcPin] = useState(null)
  const [dstPin, setDstPin] = useState(null)
  const [reconnect, setReconnect] = useState(null)   // { connId, end }
  const [menu, setMenu]     = useState(null)         // { connId, x, y }

  // Mirror the in-progress wire into the store so the guided coach can point its
  // arrow at the next pin / the Connect button as the user wires.
  const setWireDraft = useElectronicsStore(s => s.setWireDraft)
  useEffect(() => { setWireDraft({ mode, srcPin, dstPin }) }, [mode, srcPin, dstPin, setWireDraft])

  const reset = () => { setMode('idle'); setSrcPin(null); setDstPin(null); setReconnect(null) }

  // pinId → [connId] (a pin can fan out to any number of wires)
  const wiresAt = {}
  for (const [connId, c] of Object.entries(connections)) {
    (wiresAt[c.fromPinId] ??= []).push(connId)
    ;(wiresAt[c.toPinId] ??= []).push(connId)
  }

  const handlePinClick = (compId, pinName) => {
    const pinId = `${compId}:${pinName}`
    if (mode === 'reconnect' && reconnect) {
      const c = connections[reconnect.connId]
      const other = reconnect.end === 'fromPinId' ? c?.toPinId : c?.fromPinId
      if (c && pinId !== other && !isDuplicate(connections, pinId, other)) {
        updateWireConnection(reconnect.connId, { [reconnect.end]: pinId })
        snapshot('reconnect wire')
      }
      reset()
      return
    }
    if (mode === 'idle') { setSrcPin(pinId); setMode('source') }
    else if (mode === 'source') {
      if (pinId === srcPin) { reset(); return }   // clicking the same pin cancels
      setDstPin(pinId)
      setMode('confirm')
    }
  }

  const connect = useCallback(() => {
    if (!srcPin || !dstPin) return
    // Only an identical duplicate is rejected — GND/5V fan out freely.
    if (!isDuplicate(connections, srcPin, dstPin)) {
      addWireConnection(srcPin, dstPin, uuidv4())   // 3D wire follows via syncFromStore
      snapshot('wire')
    }
    reset()
  }, [srcPin, dstPin, connections, addWireConnection, snapshot])

  const openMenu = (connId) => (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ connId, x: e.clientX, y: e.clientY }) }
  const startReconnect = (connId, end) => { setMode('reconnect'); setReconnect({ connId, end }); setSrcPin(null); setDstPin(null) }

  if (elecObjects.length === 0) {
    return (
      <div className="p-4 text-center py-10">
        <div className="text-3xl mb-2 opacity-30">⚡</div>
        <div className="text-xs text-gray-500">No electronics in scene.<br />Add an Arduino, Motor, Servo, or LED from ELEC → Elec first.</div>
      </div>
    )
  }

  // ── Confirm new connection ─────────────────────────────────────────────────
  if (mode === 'confirm') {
    const preview = wireStyle('preview', { fromPinId: srcPin, toPinId: dstPin })
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="ui-section-title">Confirm connection</div>
        <div className="ui-card p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: preview.color }} />
            <span className="font-medium" style={{ color: 'rgb(var(--g-100))' }}>{friendlyPin(srcPin, objects)}</span>
          </div>
          <div className="my-1 ml-1.5 h-4 w-0.5 rounded" style={{ background: preview.color }} aria-hidden="true" />
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: preview.color }} />
            <span className="font-medium" style={{ color: 'rgb(var(--g-100))' }}>{friendlyPin(dstPin, objects)}</span>
          </div>
          <div className="text-[10px] mt-2" style={{ color: 'rgb(var(--g-400))' }}>{preview.label} wire — colour set automatically (change it later with right-click → Edit).</div>
        </div>
        <button onClick={connect} data-tour="wire-connect" className="ui-btn ui-btn-primary w-full !py-2">⚡ Connect</button>
        <button onClick={reset} className="ui-btn w-full">Cancel</button>
      </div>
    )
  }

  // ── Idle / picking ────────────────────────────────────────────────────────
  const reconnectConn = reconnect && connections[reconnect.connId]
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2.5">
        {mode === 'idle' && (
          <>
            <div className="ui-section-title">① Pick a pin to start a wire</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--g-400))' }}>Right-click a wire to edit or delete it.</div>
          </>
        )}
        {mode === 'source' && (
          <>
            <div className="ui-section-title">② Pick the other pin</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'rgb(var(--g-200))' }}>From {friendlyPin(srcPin, objects)}</div>
            <button onClick={reset} className="text-[10px] mt-1 ui-icon-btn rounded px-1">← Cancel</button>
          </>
        )}
        {mode === 'reconnect' && reconnectConn && (
          <>
            <div className="ui-section-title">Pick the new {reconnect.end === 'fromPinId' ? 'start' : 'end'} pin</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'rgb(var(--g-200))' }}>
              Keeps {friendlyPin(reconnect.end === 'fromPinId' ? reconnectConn.toPinId : reconnectConn.fromPinId, objects)}
            </div>
            <button onClick={reset} className="text-[10px] mt-1 ui-icon-btn rounded px-1">← Cancel</button>
          </>
        )}
        <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: 'rgb(var(--g-400))' }} aria-label="Wire colour legend">
          <Legend color={ROLE_COLORS.power} label="Power" /><Legend color={ROLE_COLORS.gnd} label="GND" /><Legend color="#f97316" label="Signal" />
        </div>
      </div>

      <div className="px-3 pb-3 space-y-2.5">
        {elecObjects.map(comp => {
          const pins = PIN_DEFS[comp.type] ?? []
          return (
            <div key={comp.id} className="ui-card overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgb(var(--g-700) / 0.45)' }}>
                <span className="text-base">{COMP_ICONS[comp.type] ?? '📦'}</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight truncate" style={{ color: 'rgb(var(--g-100))' }}>{comp.name}</div>
                  <div className="text-[9px] capitalize leading-tight" style={{ color: 'rgb(var(--g-500))' }}>{comp.type.replace('_', ' ')}</div>
                </div>
              </div>
              <div className="px-2 py-1.5">
                {pins.map(pin => {
                  const pinId = `${comp.id}:${pin}`
                  const wires = wiresAt[pinId] ?? []
                  const selected = pinId === srcPin || pinId === dstPin
                  const role = pinRole(pin)
                  return (
                    <div key={pin} className="flex items-center gap-1.5 py-0.5 min-h-[28px]">
                      <button
                        data-tour={`pin-${pinId}`}
                        onClick={() => handlePinClick(comp.id, pin)}
                        onContextMenu={wires.length ? openMenu(wires[0]) : undefined}
                        title={mode === 'idle' ? `Start a wire at ${pin}` : `Connect to ${pin}`}
                        aria-label={`${comp.name} pin ${pin}${wires.length ? `, ${wires.length} wire${wires.length > 1 ? 's' : ''}` : ''}`}
                        className="shrink-0 w-[72px] flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-[10px] font-mono font-semibold border transition-colors"
                        style={selected
                          ? { background: 'rgb(var(--a-600))', borderColor: 'rgb(var(--a-600))', color: '#fff' }
                          : { background: 'rgb(var(--g-800))', borderColor: wires.length ? 'rgb(var(--a-600) / 0.35)' : 'transparent', color: 'rgb(var(--g-200))' }}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: selected ? '#fff' : ROLE_DOT[role] }} aria-hidden="true" />
                        {pin}
                      </button>
                      <div className="flex-1 min-w-0 flex flex-wrap gap-1">
                        {wires.map(connId => {
                          const c = connections[connId]
                          const st = wireStyle(connId, c)
                          const other = c.fromPinId === pinId ? c.toPinId : c.fromPinId
                          return (
                            <button key={connId}
                              data-tour={`conn-cut-${connId}`}
                              onClick={openMenu(connId)} onContextMenu={openMenu(connId)}
                              title={`${st.label} wire to ${friendlyPin(other, objects)} — click or right-click to edit / delete`}
                              className="max-w-full flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-md text-[9.5px] font-medium hover:brightness-95"
                              style={{ background: 'rgb(var(--g-800))', color: 'rgb(var(--g-200))' }}>
                              <span className="w-4 h-[3px] rounded-full shrink-0" style={{ background: st.color }} aria-hidden="true" />
                              <span className="truncate">{friendlyPin(other, objects)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {menu && <ConnectionMenu {...menu} onClose={() => setMenu(null)} onReconnect={startReconnect} />}
    </div>
  )
}

function Legend({ color, label }) {
  return <span className="flex items-center gap-1"><span className="w-4 h-[3px] rounded-full" style={{ background: color }} />{label}</span>
}
