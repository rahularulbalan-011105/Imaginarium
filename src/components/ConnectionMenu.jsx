import { useEffect, useRef, useState } from 'react'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { useHistory } from '../hooks/useHistory.js'
import { useOverlay } from './ui/overlay.js'
import Icon from './ui/Icon.jsx'
import { wireStyle, friendlyPin, ROLE_COLORS, SIGNAL_COLORS } from '../utils/wiring.js'

/**
 * Right-click menu for one wire — shared by Pick a Pin and the Workbench, and
 * acting on the single electronicsStore connection record (never a copy).
 *   Edit   → colour (or back to the automatic role colour) / reconnect one end
 *   Delete → removes the wire everywhere (2D views + 3D)
 * `onReconnect(connId, end)` lets the host view take the next pin click.
 */
export default function ConnectionMenu({ connId, x, y, onClose, onReconnect }) {
  const conn = useElectronicsStore((s) => s.connections[connId])
  const objects = useSceneStore((s) => s.objects)
  const { snapshot } = useHistory()
  const [editing, setEditing] = useState(false)
  const ref = useRef(null)
  useOverlay('connection-menu', !!conn)

  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key) }
  }, [onClose])

  if (!conn) return null
  const st = wireStyle(connId, conn)

  const setColor = (color) => {
    useElectronicsStore.getState().updateWireConnection(connId, { color: color ?? undefined })
    snapshot('wire colour')
  }
  const remove = () => {
    objectManager.removeWire?.(connId)                      // legacy line, if any
    useElectronicsStore.getState().removeWireConnection(connId)
    snapshot('delete wire')
    onClose()
  }

  // Keep the menu on-screen.
  const W = 232
  const left = Math.min(x, window.innerWidth - W - 8)
  const top = Math.min(y, window.innerHeight - (editing ? 250 : 130) - 8)

  return (
    <div ref={ref} role="menu" aria-label="Connection actions"
      className="fixed z-[60] rounded-2xl p-1.5 shadow-2xl"
      style={{ left, top, width: W, background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700) / 0.6)' }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: st.color, border: '1px solid rgb(0 0 0 / 0.15)' }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgb(var(--g-400))' }}>{st.label} wire</span>
        </div>
        <div className="text-[11px] font-medium truncate" style={{ color: 'rgb(var(--g-100))' }}>{friendlyPin(conn.fromPinId, objects)}</div>
        <div className="text-[11px] truncate" style={{ color: 'rgb(var(--g-400))' }}>→ {friendlyPin(conn.toPinId, objects)}</div>
      </div>

      <button role="menuitem" onClick={() => setEditing((v) => !v)} aria-expanded={editing}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold ui-icon-btn" style={{ color: 'rgb(var(--g-200))' }}>
        <Icon name="edit" size={14} /> Edit Connection
      </button>

      {editing && (
        <div className="px-2.5 pb-2 pt-1 flex flex-col gap-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgb(var(--g-500))' }}>Colour</div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setColor(null)} title="Automatic — red for power, black for GND, a signal colour otherwise"
                className="h-6 px-2 rounded-full text-[10px] font-semibold border"
                style={!conn.color ? { borderColor: 'rgb(var(--a-600))', color: 'rgb(var(--a-600))' } : { borderColor: 'rgb(var(--g-700))', color: 'rgb(var(--g-400))' }}>
                Auto
              </button>
              {[ROLE_COLORS.power, ROLE_COLORS.gnd, ...SIGNAL_COLORS].map((c) => (
                <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`} title={c}
                  className="w-6 h-6 rounded-full"
                  style={{ background: c, boxShadow: conn.color === c ? '0 0 0 2px rgb(var(--g-900)), 0 0 0 4px rgb(var(--a-600))' : '0 0 0 1px rgb(0 0 0 / 0.12)' }} />
              ))}
            </div>
          </div>
          {onReconnect && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgb(var(--g-500))' }}>Reconnect</div>
              <div className="flex gap-1.5">
                <button className="ui-btn flex-1 !px-1" onClick={() => { onReconnect(connId, 'fromPinId'); onClose() }}>Move start</button>
                <button className="ui-btn flex-1 !px-1" onClick={() => { onReconnect(connId, 'toPinId'); onClose() }}>Move end</button>
              </div>
            </div>
          )}
        </div>
      )}

      <button role="menuitem" onClick={remove}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold transition-colors hover:bg-red-500/10" style={{ color: '#dc2626' }}>
        <Icon name="trash" size={14} /> Delete
      </button>
    </div>
  )
}
