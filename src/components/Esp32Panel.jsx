import { useEffect, useState } from 'react'
import { simulationManager } from '../managers/SimulationManager.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { esp32LinkAvailable, esp32LinkReason } from '../managers/esp32Link.js'

// ─────────────────────────────────────────────────────────────────────────────
// ESP32 section of the Simulation tab.
//
// Everything here is driven by the ONE runtime on simulationManager.esp32,
// polled at 5 Hz (firmware can touch that state every loop iteration, so it must
// never drive React directly). Control VALUES live in electronicsStore, because
// they are user input and change slowly.
//
// Wi-Fi and Bluetooth shown here are SIMULATED — a board running in a browser
// tab has no radio. The badges say so, and nothing here ever claims a real
// device is attached.
// ─────────────────────────────────────────────────────────────────────────────

const WIFI_TEXT = { 0: 'idle', 1: 'no such network', 3: 'connected', 4: 'failed', 6: 'disconnected' }

export default function Esp32Panel() {
  const [rev, setRev] = useState(0)
  const controls = useElectronicsStore(s => s.esp32Controls)
  const setControl = useElectronicsStore(s => s.setEsp32Control)
  const mode = useElectronicsStore(s => s.esp32Mode)
  const setMode = useElectronicsStore(s => s.setEsp32Mode)
  const pushSerial = useElectronicsStore(s => s.pushEsp32SerialIn)
  const [tab, setTab] = useState('controls')

  // Poll the runtime instead of subscribing: a chatty sketch cannot storm React.
  useEffect(() => {
    const id = setInterval(() => setRev(simulationManager.esp32?.rev ?? 0), 200)
    return () => clearInterval(id)
  }, [])
  void rev

  const E = simulationManager.esp32
  if (!E) return null
  const defs = E.controlDefs ?? []
  const errs = E.controlErrors ?? []
  const running = E.firmware === 'running'

  const groups = {}
  for (const c of defs) (groups[c.group ?? ''] ??= []).push(c)

  return (
    <div className="border-t border-gray-800/60 bg-gray-950/70 px-4 py-2">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="font-bold tracking-wider text-sky-300">ESP32 DevKit V1</span>
        <Badge tone={mode === 'hw' ? 'amber' : 'sky'}>{mode === 'hw' ? 'HARDWARE' : 'SIMULATED'}</Badge>
        <Badge tone={running ? 'green' : 'gray'}>{running ? 'firmware running' : 'firmware idle'}</Badge>
        <div className="ml-auto flex items-center gap-1">
          {['controls', 'network', 'log'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 capitalize transition-colors ${tab === t ? 'bg-sky-700/60 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {errs.length > 0 && (
        <div className="mt-1.5 rounded border border-red-700/50 bg-red-950/40 px-2 py-1 text-[10px] text-red-300">
          {errs.slice(0, 3).map((e, i) => <div key={i}>line {e.line}: {e.message}{e.hint ? ` — ${e.hint}` : ''}</div>)}
        </div>
      )}

      {/* ── program-defined controls ─────────────────────────────────────── */}
      {tab === 'controls' && (
        defs.length === 0 ? (
          <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
            No controls declared. Add a line like{' '}
            <code className="rounded bg-gray-800 px-1 text-sky-300">{'// @control slider speed 0 255'}</code>{' '}
            to your sketch and press Run — the control appears here and{' '}
            <code className="rounded bg-gray-800 px-1 text-sky-300">controlValue("speed")</code> reads it.
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {Object.entries(groups).map(([g, list]) => (
              <div key={g}>
                {g && <div className="mb-1 text-[9px] uppercase tracking-wider text-gray-500">{g}</div>}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {list.map(c => (
                    <Control key={c.id} c={c}
                      value={c.type === 'readout' ? (E.readouts[c.id] ?? 0) : (controls[c.id] ?? c.value ?? 0)}
                      onChange={(v) => setControl(c.id, v)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Wi-Fi + Bluetooth ────────────────────────────────────────────── */}
      {tab === 'network' && (
        <div className="mt-2 flex flex-col gap-2 text-[10px]">
          <div className="rounded border border-gray-700/60 p-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-300">Wi-Fi</span>
              <Badge tone="sky">SIMULATED</Badge>
              <Badge tone={E.wifi.status === 3 ? 'green' : E.wifi.connecting ? 'amber' : 'gray'}>
                {E.wifi.connecting ? 'connecting…' : (WIFI_TEXT[E.wifi.status] ?? '—')}
              </Badge>
              {E.wifi.ap && <Badge tone="violet">access point</Badge>}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 text-gray-400">
              <Row k="SSID" v={E.wifi.ssid || '—'} />
              <Row k="IP" v={E.wifi.ap ? E.wifi.apIp : E.wifi.ip} />
              <Row k="RSSI" v={E.wifi.rssi ? `${E.wifi.rssi} dBm` : '—'} />
              <Row k="MAC" v={E.wifi.mac} />
            </div>
            <p className="mt-1 text-[9px] leading-snug text-gray-500">
              The sketch drives this with WiFi.begin() / softAP(). It is a simulated network — no radio is involved.
            </p>
          </div>

          <div className="rounded border border-gray-700/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-gray-300">Bluetooth</span>
              <Badge tone="sky">SIMULATED</Badge>
              <Badge tone={E.ble.connected ? 'green' : 'gray'}>{E.ble.connected ? 'central connected' : 'no client'}</Badge>
              {E.ble.kind && <span className="text-gray-500">{E.ble.kind === 'ble' ? 'BLE UART' : 'Classic SPP'} · “{E.ble.name}”</span>}
              <button onClick={() => simulationManager.esp32SetBleConnected(!E.ble.connected)}
                className="ml-auto rounded border border-gray-600 px-2 py-0.5 text-gray-300 hover:bg-gray-800">
                {E.ble.connected ? 'Disconnect' : 'Connect a phone (simulated)'}
              </button>
            </div>
            <SendBox placeholder="Send to the board over Bluetooth…"
              onSend={(t) => simulationManager.esp32Receive('ble', t)} />
          </div>

          <div className="rounded border border-gray-700/60 p-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-300">Real hardware</span>
              <Badge tone={esp32LinkAvailable() ? 'amber' : 'gray'}>
                {esp32LinkAvailable() ? 'Web Serial available' : 'unavailable'}
              </Badge>
            </div>
            <p className="mt-1 text-[9px] leading-snug text-gray-500">{esp32LinkReason()}</p>
            <label className="mt-1 flex items-center gap-1.5 text-gray-400">
              <input type="checkbox" checked={mode === 'hw'} onChange={e => setMode(e.target.checked ? 'hw' : 'sim')} />
              Treat this board as real hardware
            </label>
          </div>
        </div>
      )}

      {/* ── log + serial input ───────────────────────────────────────────── */}
      {tab === 'log' && (
        <div className="mt-2 text-[10px]">
          <div className="max-h-24 overflow-y-auto rounded bg-gray-950 p-1.5 font-mono text-[9px] leading-relaxed text-gray-300">
            {E.log.length === 0 && <span className="text-gray-600">No network or Bluetooth activity yet.</span>}
            {E.log.slice(-40).map((l, i) => (
              <div key={i}><span className="text-gray-600">{l.ch}</span> {l.text}</div>
            ))}
          </div>
          <SendBox placeholder="Send to Serial.read()…" onSend={(t) => pushSerial(t)} />
        </div>
      )}
    </div>
  )
}

function Control({ c, value, onChange }) {
  const box = 'rounded border border-gray-700/60 bg-gray-900/60 px-2 py-1.5'
  const label = (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold text-gray-200">{c.label}</span>
      {c.pin != null && <span className="text-[9px] text-sky-400">GPIO{c.pin}</span>}
    </div>
  )
  if (c.type === 'button') {
    return (
      <div className={box}>
        {label}
        <button
          onPointerDown={() => onChange(1)} onPointerUp={() => onChange(0)} onPointerLeave={() => onChange(0)}
          className={`mt-1 w-full rounded px-2 py-1 text-[10px] font-bold transition-colors ${value ? 'bg-sky-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}>
          {value ? 'held' : 'press & hold'}
        </button>
      </div>
    )
  }
  if (c.type === 'toggle') {
    return (
      <div className={box}>
        {label}
        <button onClick={() => onChange(value ? 0 : 1)}
          className={`mt-1 w-full rounded px-2 py-1 text-[10px] font-bold transition-colors ${value ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
          {value ? 'ON' : 'OFF'}
        </button>
      </div>
    )
  }
  if (c.type === 'slider') {
    return (
      <div className={box}>
        <div className="flex items-baseline justify-between">{label}<span className="text-[10px] font-mono text-sky-300">{value}{c.unit ?? ''}</span></div>
        <input type="range" min={c.min} max={c.max} step={c.step} value={value}
          onChange={e => onChange(Number(e.target.value))} className="mt-1 w-full accent-sky-500" />
      </div>
    )
  }
  if (c.type === 'number') {
    return (
      <div className={box}>
        {label}
        <input type="number" min={c.min} max={c.max} step={c.step} value={value}
          onChange={e => onChange(Math.max(c.min, Math.min(c.max, Number(e.target.value) || 0)))}
          className="mt-1 w-full rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-100 outline-none" />
      </div>
    )
  }
  if (c.type === 'select') {
    return (
      <div className={box}>
        {label}
        <select value={value} onChange={e => onChange(Number(e.target.value))}
          className="mt-1 w-full rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-100 outline-none">
          {c.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
        </select>
      </div>
    )
  }
  // readout
  return (
    <div className={box}>
      <div className="flex items-baseline justify-between">
        {label}
        <span className="font-mono text-[12px] text-green-300">{typeof value === 'number' ? (Math.round(value * 100) / 100) : value}{c.unit ? ` ${c.unit}` : ''}</span>
      </div>
    </div>
  )
}

function SendBox({ placeholder, onSend }) {
  const [v, setV] = useState('')
  const go = () => { if (!v) return; onSend(v); setV('') }
  return (
    <div className="mt-1.5 flex gap-1">
      <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }}
        placeholder={placeholder}
        className="flex-1 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-100 outline-none placeholder:text-gray-600" />
      <button onClick={go} className="rounded bg-gray-700 px-2 py-0.5 text-[10px] text-gray-200 hover:bg-gray-600">Send</button>
    </div>
  )
}

function Badge({ tone, children }) {
  const tones = {
    sky: 'bg-sky-900/60 text-sky-300 border-sky-700/60',
    green: 'bg-green-900/50 text-green-300 border-green-700/60',
    amber: 'bg-amber-900/50 text-amber-300 border-amber-700/60',
    violet: 'bg-violet-900/50 text-violet-300 border-violet-700/60',
    gray: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  return <span className={`rounded border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide ${tones[tone] ?? tones.gray}`}>{children}</span>
}

const Row = ({ k, v }) => (
  <div className="flex justify-between gap-2"><span className="text-gray-500">{k}</span><span className="font-mono text-gray-300">{v}</span></div>
)
