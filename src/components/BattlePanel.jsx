import { useState, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { battleManager } from '../managers/BattleManager.js'
import { robotOptions } from '../utils/robotAssembly.js'

function HPBar({ side, name, hp, lives, color, you }) {
  return (
    <div className="pointer-events-none" style={{ width: 260 }}>
      <div className="flex items-center gap-2" style={{ flexDirection: side === 'left' ? 'row' : 'row-reverse' }}>
        <span className="text-xs font-bold text-white drop-shadow">{name}{you ? ' (you)' : ''}</span>
        <span className="text-[11px]">{'❤'.repeat(lives)}<span className="opacity-30">{'❤'.repeat(Math.max(0, 3 - lives))}</span></span>
      </div>
      <div className="h-3 mt-1 rounded-full bg-black/50 border border-white/30 overflow-hidden">
        <div className="h-full transition-all duration-150"
          style={{ width: `${hp}%`, background: color, marginLeft: side === 'right' ? 'auto' : 0 }} />
      </div>
    </div>
  )
}

export default function BattlePanel() {
  const objects = useSceneStore(s => s.objects)
  // re-subscribe so the assembly list refreshes when bonds/attachments change
  useRigidStore(s => s.bonds)
  useElectronicsStore(s => s.attachments)
  const g = useGameStore()
  const { battleActive, mode, p1Id, p2Id, setP1, setP2, status, round, lives, hp, message,
          role, connState, roomCode, netError, myRobotId, oppName, oppReady } = g
  const [joinCode, setJoinCode] = useState('')

  // One entry per assembled robot (chassis + bonded parts + wheels), not per part
  const candidates = robotOptions()
  const exit = () => battleManager.stop()

  // ── Active battle: just controls + HUD ──
  if (battleActive) {
    return (
      <>
        <div className="flex flex-col gap-2 p-3">
          <div className="text-[10px] text-red-400 uppercase tracking-wider font-semibold">⚔ Battle — Round {round}</div>
          {/* Change the nose live — no need to exit the match */}
          {mode === 'online'
            ? <LiveFront title="Your nose" slot="p1" accent="#22c55e" />
            : <>
                <LiveFront title="P1 nose" slot="p1" accent="#22c55e" />
                <LiveFront title="P2 nose" slot="p2" accent="#ef4444" />
              </>}
          <button onClick={exit} className="w-full py-2 rounded-lg text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-gray-100">■ Exit Battle</button>
        </div>
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="absolute top-3 left-4"><HPBar side="left"  name={mode === 'online' ? 'Host' : 'P1'} hp={hp.p1} lives={lives.p1} color="#22c55e" you={mode === 'online' && role === 'host'} /></div>
          <div className="absolute top-3 right-4"><HPBar side="right" name={mode === 'online' ? 'Challenger' : 'P2'} hp={hp.p2} lives={lives.p2} color="#ef4444" you={mode === 'online' && role === 'guest'} /></div>
          {message && status !== 'loading' && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 text-center">
              <div className={`px-5 py-2 rounded-xl font-extrabold tracking-wide shadow-2xl ${status === 'matchover' ? 'text-2xl text-indigo-300 bg-black/70' : 'text-lg text-white bg-black/55'}`}>{message}</div>
            </div>
          )}
          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="w-12 h-12 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
              <div className="mt-4 text-lg font-bold text-white">Loading opponent…</div>
              <div className="mt-1 text-xs text-gray-400">Building {oppName || 'the challenger'}'s robot</div>
            </div>
          )}
          {status === 'matchover' && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-auto">
              <button onClick={exit} className="px-5 py-2.5 rounded-lg text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl">✓ Done</button>
            </div>
          )}
        </div>
      </>
    )
  }

  // ── Setup ──
  const setMyRobot = (id) => { useGameStore.getState().setMyRobot(id); if (battleManager && connState === 'connected') battleManager.sendHello() }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] text-red-400 uppercase tracking-wider font-semibold">⚔ Robo Sumo — Battle</div>

      {/* Mode switch */}
      <div className="flex gap-1">
        {[['local', 'Same PC'], ['online', '🌐 Online']].map(([m, label]) => (
          <button key={m} onClick={() => useGameStore.getState().setMode(m)}
            className={`flex-1 py-1.5 rounded text-[11px] font-semibold border transition-colors ${
              mode === m ? 'bg-red-700/60 border-red-500 text-white' : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'local' ? (
        <>
          <PlayerPick label="Player 1 (WASD)" value={p1Id} onChange={setP1} candidates={candidates} accent="#22c55e" />
          <PlayerPick label="Player 2 (Arrow keys)" value={p2Id} onChange={setP2} candidates={candidates} accent="#ef4444" />
          <button onClick={() => { useGameStore.getState().resetMatch(); battleManager.startLocal(p1Id, p2Id) }}
            disabled={!(p1Id && p2Id && p1Id !== p2Id)}
            className="w-full py-2.5 mt-1 rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(90deg,#ef4444,#b91c1c)', color: 'white' }}>⚔ Start Battle</button>
          <ControlsLegend online={false} />
        </>
      ) : (
        <>
          {/* Connection */}
          {connState === 'idle' || connState === 'error' || connState === 'closed' ? (
            <div className="flex flex-col gap-2">
              <button onClick={() => { useGameStore.getState().resetMatch(); battleManager.connectHost() }}
                className="w-full py-2 rounded-lg text-xs font-bold bg-indigo-700 hover:bg-indigo-600 text-white">🏠 Host a Game</button>
              <div className="flex gap-1">
                <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="ROOM CODE"
                  className="flex-1 bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1.5 font-mono tracking-widest text-center focus:outline-none" />
                <button onClick={() => { useGameStore.getState().resetMatch(); battleManager.connectJoin(joinCode) }}
                  disabled={joinCode.length < 4}
                  className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white">Join</button>
              </div>
              {connState === 'error' && <div className="text-[10px] text-red-400">Connection error: {netError}. Check the code and retry.</div>}
              {connState === 'closed' && <div className="text-[10px] text-yellow-500">Disconnected.</div>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {role === 'host' && (
                <div className="text-center bg-gray-800/70 border border-indigo-700/40 rounded-lg p-2">
                  <div className="text-[9px] text-gray-400 uppercase tracking-wider">Room code — share it</div>
                  <div className="text-2xl font-mono font-bold tracking-[0.3em] text-indigo-300 my-1">{roomCode}</div>
                  <button onClick={() => navigator.clipboard?.writeText(roomCode)} className="text-[10px] text-gray-400 hover:text-slate-900 underline">copy</button>
                </div>
              )}
              <div className={`text-[11px] ${connState === 'connected' ? 'text-green-400' : 'text-yellow-400'}`}>
                {connState === 'waiting' && 'Waiting for opponent to join…'}
                {connState === 'connecting' && 'Connecting…'}
                {connState === 'connected' && `Connected${oppName ? ` to ${oppName}` : ''} ✓`}
              </div>

              <PlayerPick label="Your Robot" value={myRobotId} onChange={setMyRobot} candidates={candidates} accent="#22c55e" />

              {role === 'host' ? (
                <button onClick={() => battleManager.hostStart()}
                  disabled={!(connState === 'connected' && myRobotId && oppReady)}
                  className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(90deg,#ef4444,#b91c1c)', color: 'white' }}>⚔ Start Battle</button>
              ) : connState !== 'connected' ? (
                <div className="text-[11px] text-center text-yellow-400 py-1">Connecting to host…</div>
              ) : (
                <div className="text-[11px] text-center text-gray-400 py-1">
                  {myRobotId ? 'Ready — waiting for host to start…' : 'Pick your robot.'}
                </div>
              )}
              {role === 'host' && !oppReady && connState === 'connected' && <div className="text-[10px] text-gray-500 text-center">Waiting for opponent to pick a robot…</div>}
              <button onClick={() => battleManager.stop()} className="text-[10px] text-gray-500 hover:text-gray-300 mt-1">Cancel / disconnect</button>
            </div>
          )}
          <ControlsLegend online={true} />
        </>
      )}
    </div>
  )
}

const keyName = (k) => ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Space', Shift: '⇧', Control: 'Ctrl', Enter: '⏎' }[k] ?? (k || '').toUpperCase())

function KeyBind({ label, value, onBind }) {
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!listening) return
    const h = (e) => {
      e.preventDefault(); e.stopPropagation()
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      onBind(k); setListening(false)
    }
    window.addEventListener('keydown', h, { once: true, capture: true })
    return () => window.removeEventListener('keydown', h, { capture: true })
  }, [listening]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button onClick={() => setListening(true)}
      className={`flex items-center justify-between px-2 py-1 rounded border text-[10px] ${listening ? 'border-indigo-400 bg-indigo-900/30 text-indigo-200' : 'border-gray-600/50 bg-gray-800 text-gray-300 hover:border-gray-400'}`}>
      <span className="text-gray-500">{label}</span>
      <span className="font-mono font-bold">{listening ? 'press…' : keyName(value)}</span>
    </button>
  )
}

const FRONTS = [['+z', '↑'], ['+x', '→'], ['-z', '↓'], ['-x', '←']]

// Change which face is the nose during a live match (calls into BattleManager so
// the robot re-faces immediately and the change is sent to the opponent).
function LiveFront({ title, slot, accent }) {
  const front = useGameStore(s => s.controls[slot].front)
  return (
    <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded border border-gray-700/50 bg-gray-800/60">
      <span className="text-[10px]" style={{ color: accent }}>{title}</span>
      <div className="flex gap-0.5">
        {FRONTS.map(([f, arrow]) => (
          <button key={f} onClick={() => battleManager.changeFront(slot, f)}
            title="Which face drives forward"
            className={`w-6 h-6 rounded text-xs border ${front === f ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900'}`}>{arrow}</button>
        ))}
      </div>
    </div>
  )
}

function ControlsEditor({ slot, title, accent }) {
  const c = useGameStore(s => s.controls[slot])
  const setControl = useGameStore(s => s.setControl)
  return (
    <div className="border border-gray-700/50 rounded p-2">
      <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: accent }}>{title}</div>
      <div className="grid grid-cols-2 gap-1 mb-2">
        <KeyBind label="Forward" value={c.up}    onBind={k => setControl(slot, 'up', k)} />
        <KeyBind label="Back"    value={c.down}  onBind={k => setControl(slot, 'down', k)} />
        <KeyBind label="Left"    value={c.left}  onBind={k => setControl(slot, 'left', k)} />
        <KeyBind label="Right"   value={c.right} onBind={k => setControl(slot, 'right', k)} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-gray-500">Front side</span>
        <div className="flex gap-0.5">
          {FRONTS.map(([f, arrow]) => (
            <button key={f} onClick={() => setControl(slot, 'front', f)}
              title="If pressing Forward moves sideways, change this"
              className={`w-6 h-6 rounded text-xs border ${c.front === f ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900'}`}>{arrow}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ControlsLegend({ online }) {
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-gray-700/50 pt-2">
      <div className="text-[10px] text-gray-400 font-semibold">Controls — click a box, press any key to rebind</div>
      {online
        ? <ControlsEditor slot="p1" title="Your keys" accent="#22c55e" />
        : <>
            <ControlsEditor slot="p1" title="Player 1" accent="#22c55e" />
            <ControlsEditor slot="p2" title="Player 2" accent="#ef4444" />
          </>}
      <div className="text-[9px] text-gray-600">
        Set <b className="text-gray-400">Front side</b> if Forward drives sideways — it tells the game which face of your robot is the nose.
      </div>
    </div>
  )
}

function PlayerPick({ label, value, onChange, candidates, accent }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: accent }}>{label}</div>
      <select value={value ?? ''} onChange={e => onChange(e.target.value || null)}
        className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1.5 focus:outline-none"
        style={{ borderColor: value ? accent : undefined }}>
        <option value="">— select robot —</option>
        {candidates.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  )
}
