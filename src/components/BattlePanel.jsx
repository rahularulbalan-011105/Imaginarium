import { useState, useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../stores/gameStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { battleManager } from '../managers/BattleManager.js'
import { combatManager } from '../managers/CombatManager.js'
import { robotOptions, assemblyMembers } from '../utils/robotAssembly.js'
import { useCombatStore } from '../stores/combatStore.js'
import { assessMatch } from '../combat/arenaReadiness.js'
import { readJSONFile } from '../utils/export.js'
import { trackEvent } from '../utils/utmTracking.js'
import { FRONTS as ROBOT_FRONTS, FRONT_LABEL } from '../combat/robotFront.js'
import { frontIndicator } from '../managers/FrontIndicator.js'

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
  const [showSumo, setShowSumo] = useState(false)

  // One entry per assembled robot (chassis + bonded parts + wheels), not per part.
  // Arena-only parts (the stock opponent) never show up as picks.
  const candidates = robotOptions().filter(o => !objects.find(x => x.id === o.id)?.transient)
  const exit = () => battleManager.stop()

  // ── Robo-Sumo active: just controls + HUD ──
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

  const setMyRobot = (id) => { useGameStore.getState().setMyRobot(id); if (battleManager && connState === 'connected') battleManager.sendHello() }

  return (
    <div className="flex flex-col gap-3 p-3">
      <ArenaSetup candidates={candidates} />

      {/* Robo-Sumo — the classic push-out mode, kept as is */}
      <div className="rounded-lg border border-gray-700/40 overflow-hidden bg-gray-800/30">
        <button onClick={() => setShowSumo(v => !v)} className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-gray-700/40 transition-colors">
          <span className="text-[10px] text-red-400 uppercase tracking-wider font-semibold">🥋 Robo Sumo — classic</span>
          <span className="text-[10px] text-gray-500">{showSumo ? '▾' : '▸'}</span>
        </button>
        {showSumo && (
          <div className="flex flex-col gap-3 p-2.5 pt-1">
            <div className="text-[10px] leading-snug" style={{ color: 'rgb(var(--g-500))' }}>Push the other robot out of the ring. Same PC (P1 WASD · P2 arrows) or online by room code.</div>
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
                  style={{ background: 'linear-gradient(90deg,#ef4444,#b91c1c)', color: 'white' }}>⚔ Start Sumo</button>
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
                        className="flex-1 bg-gray-800 border border-gray-600/50 rounded text-xs text-slate-800 px-2 py-1.5 font-mono tracking-widest text-center focus:outline-none" />
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
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BattleBot Arena setup — pick (or import) your robot, see whether it is battle
// ready, pick the opponent + AI difficulty, enter. During a match: a compact
// status with Pause / Restart / Exit (the HUD carries the rest).
// ─────────────────────────────────────────────────────────────────────────────
const DIFFICULTIES = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]
const LEVEL_UI = {
  ready:   { chip: 'bg-emerald-700/70 border-emerald-500 text-emerald-100', text: 'Battle ready' },
  warn:    { chip: 'bg-amber-700/60 border-amber-500 text-amber-100',       text: 'Ready — with warnings' },
  invalid: { chip: 'bg-red-800/70 border-red-500 text-red-100',             text: 'Not ready' },
}

function ArenaSetup({ candidates }) {
  const arenaActive = useCombatStore(s => s.arenaActive)
  const arenaStatus = useCombatStore(s => s.status)
  const paused = useCombatStore(s => s.paused)
  const elapsed = useCombatStore(s => s.elapsed)
  const [playerId, setPlayerId] = useState(null)
  const [opponentId, setOpponentId] = useState('stock')
  const [difficulty, setDifficulty] = useState(() => { try { return localStorage.getItem('arena.difficulty') || 'normal' } catch { return 'normal' } })
  const [importing, setImporting] = useState(false)
  const importRef = useRef(null)
  // An opponent loaded from a robot JSON file (kept in memory, spawned per match).
  const [fileOpp, setFileOpp] = useState(null)   // { name, parts, data }
  const oppImportRef = useRef(null)

  // Keep the picks valid as the scene changes; default to the biggest robot.
  useEffect(() => {
    if (!candidates.length) { if (playerId) setPlayerId(null); return }
    if (!playerId || !candidates.find(c => c.id === playerId)) {
      const biggest = [...candidates].sort((a, b) => assemblyMembers(b.id).length - assemblyMembers(a.id).length)[0]
      setPlayerId(biggest.id)
    }
    if (opponentId !== 'stock' && opponentId !== 'file' && !candidates.find(c => c.id === opponentId)) setOpponentId('stock')
  }, [candidates, playerId, opponentId])

  const match = useMemo(() => assessMatch(playerId, opponentId), [playerId, opponentId, candidates]) // eslint-disable-line react-hooks/exhaustive-deps
  const updateObject = useSceneStore(s => s.updateObject)
  // Show the FRONT arrow on the picked robot while this panel is open.
  useEffect(() => { frontIndicator.pin(arenaActive ? null : playerId); return () => frontIndicator.pin(null) }, [playerId, arenaActive])
  useEffect(() => { frontIndicator.update() }, [candidates])
  const canStart = match.level !== 'invalid' && !arenaActive

  const pickDifficulty = (d) => { setDifficulty(d); try { localStorage.setItem('arena.difficulty', d) } catch { /* private mode */ } }
  const start = () => {
    if (!canStart) return
    if (opponentId === 'file' && fileOpp) { combatManager.startArena([playerId], { difficulty, opponentData: fileOpp.data }); return }
    const ids = opponentId === 'stock' ? [playerId] : [playerId, opponentId]
    combatManager.startArena(ids, { difficulty, stock: opponentId === 'stock' })
  }
  // Import a robot JSON (the same project files Robot Builder exports). The
  // Header's loader applies it to every store exactly like File → Import JSON.
  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const data = await readJSONFile(file)
      if (!data || !Array.isArray(data.objects)) throw new Error('not a robot/project file')
      window.dispatchEvent(new CustomEvent('constructa:load-project', { detail: data }))
      setPlayerId(null)   // → re-defaults to the imported robot
      trackEvent('arena_import', { parts: data.objects.length })
    } catch (err) {
      alert(`Couldn't import that file: ${err?.message || 'invalid JSON'}. Export a robot from Robot Builder (File → Export JSON) and try again.`)
    } finally { setImporting(false) }
  }

  // Load an OPPONENT from a robot JSON: your project is left as it is; the
  // file's robot is added for each match only (like the stock bot).
  const onImportOpponent = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = await readJSONFile(file)
      if (!data || !Array.isArray(data.objects) || !data.objects.length) throw new Error('not a robot/project file')
      const roots = data.objects.filter(o => !Object.values(data.rigid?.bonds || {}).some(b => b.childId === o.id) && !(data.electronics?.attachments || {})[o.id])
      const name = (roots.find(o => Object.values(data.rigid?.bonds || {}).some(b => b.parentId === o.id)) || roots[0] || data.objects[0])?.name || data.name || file.name
      setFileOpp({ name, parts: data.objects.length, data })
      setOpponentId('file')
      trackEvent('arena_import_opponent', { parts: data.objects.length })
    } catch (err) {
      alert(`Couldn't load that opponent: ${err?.message || 'invalid JSON'}. Use a robot exported from Robot Builder (File → Export JSON).`)
    }
  }

  if (arenaActive) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-indigo-700/40 bg-indigo-950/30 p-2.5">
        <div className="text-[10px] text-indigo-300 uppercase tracking-wider font-semibold">🤖 BattleBot Arena — {arenaStatus === 'loading' ? 'deploying…' : arenaStatus === 'over' ? 'match over' : paused ? 'paused' : 'live'}</div>
        <div className="text-[11px] text-gray-300">
          {arenaStatus === 'fighting' && <>Elapsed <b className="font-mono">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</b> · AI {useCombatStore.getState().difficulty}</>}
          {arenaStatus === 'over' && 'Rematch or exit from the result screen.'}
        </div>
        <div className="flex gap-1">
          {arenaStatus === 'fighting' && (
            <button onClick={() => combatManager.togglePause()} className="flex-1 py-1.5 rounded text-[11px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-100">{paused ? '▶ Resume' : '❚❚ Pause'}</button>
          )}
          <button onClick={() => combatManager.restart()} className="flex-1 py-1.5 rounded text-[11px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-100">↻ Restart</button>
          <button onClick={() => combatManager.stop()} className="flex-1 py-1.5 rounded text-[11px] font-semibold bg-red-700 hover:bg-red-600 text-white">■ Exit</button>
        </div>
      </div>
    )
  }

  const pr = match.player
  const level = LEVEL_UI[match.level]
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[10px] text-indigo-300 uppercase tracking-wider font-semibold">🤖 BattleBot Arena</div>

      {/* Your robot */}
      <div className="flex items-end gap-1">
        <div className="flex-1"><PlayerPick label="Your robot" value={playerId} onChange={setPlayerId} candidates={candidates} accent="#22c55e" /></div>
        <button onClick={() => importRef.current?.click()} disabled={importing} title="Load a robot JSON exported from Robot Builder"
          className="px-2 py-1.5 rounded text-[10px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-100 disabled:opacity-50 whitespace-nowrap">
          {importing ? '…' : '⬆ Import JSON'}
        </button>
        <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={onImportFile} data-testid="arena-import" />
      </div>

      {/* Readiness */}
      {playerId ? (
        <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-2 flex flex-col gap-1.5" data-testid="arena-readiness" data-level={match.level}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-gray-100 truncate">{pr.name}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${level.chip}`}>{level.text}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <Stat label="parts" value={pr.parts} />
            <Stat label="weapons" value={pr.weapons.length} />
            <Stat label="class" value={pr.stats ? `${pr.stats.class} · ${pr.stats.mass.toFixed(1)} kg` : '—'} />
          </div>
          <div className="flex items-center gap-1" title="Which side of the robot is its nose (drives forward, faces the enemy). The cyan arrow in the viewport shows it.">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 w-10" title={pr.frontAuto ? 'Not set — inferred from the mounted weapons (click one to fix it)' : 'Set on the robot'}>front{pr.frontAuto ? '*' : ''}</span>
            {ROBOT_FRONTS.map(f => (
              <button key={f} data-testid={`arena-front-${f}`} onClick={() => { updateObject(playerId, { front: f }); frontIndicator.update() }}
                className={`flex-1 py-0.5 rounded text-[10px] font-semibold border ${pr.front === f ? 'bg-cyan-700/60 border-cyan-400 text-white' : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900'}`}>{FRONT_LABEL[f]}</button>
            ))}
          </div>
          <div className="text-[10px] text-gray-300">
            <span className="text-gray-500">LMB</span> {pr.primary ? pr.primary.name : <span className="text-amber-300">none</span>}
            <span className="text-gray-600"> · </span>
            <span className="text-gray-500">RMB</span> {pr.secondary?.name || 'Melee Strike'}
            {pr.weapons.length > 2 && <span className="text-gray-500"> · +{pr.weapons.length - 2} more mounted</span>}
          </div>
          {[...pr.issues, ...match.issues].map((i, k) => (
            <div key={k} className={`text-[10px] leading-snug ${i.level === 'invalid' ? 'text-red-300' : 'text-amber-300'}`}>{i.level === 'invalid' ? '✖' : '⚠'} {i.msg}</div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-700/60 p-2.5 text-[10px] text-gray-400 leading-snug">
          No robot in the scene yet. Build one (a chassis with parts bonded on, plus a ⚔ weapon from <b>Electronics → Weapons</b>) or <b>Import JSON</b> from Robot Builder.
        </div>
      )}

      {/* Opponent + difficulty */}
      <div>
        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#ef4444' }}>Opponent</div>
        <select value={opponentId ?? 'stock'} onChange={e => setOpponentId(e.target.value)} data-testid="arena-opponent"
          className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-slate-800 px-2 py-1.5 focus:outline-none" style={{ borderColor: '#ef4444' }}>
          <option value="stock">Stock bot — Scrapper (AI, auto cannon)</option>
          {fileOpp && <option value="file">{fileOpp.name} — from file (AI, {fileOpp.parts} parts)</option>}
          {candidates.filter(c => c.id !== playerId).map(o => <option key={o.id} value={o.id}>{o.name} (AI)</option>)}
        </select>
        <button onClick={() => oppImportRef.current?.click()} data-testid="arena-import-opponent-btn" title="Fight a robot from a JSON file (Robot Builder export) — your own project is not replaced"
          className="mt-1 w-full py-1 rounded text-[10px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-100">⬆ Import opponent JSON</button>
        <input ref={oppImportRef} type="file" accept=".json,application/json" className="hidden" onChange={onImportOpponent} data-testid="arena-import-opponent" />
        {match.opponent && match.opponent.issues.filter(i => i.level === 'invalid').map((i, k) => (
          <div key={k} className="text-[10px] text-red-300 mt-1">✖ Opponent: {i.msg}</div>
        ))}
      </div>
      <div className="flex gap-1">
        {DIFFICULTIES.map(([d, label]) => (
          <button key={d} onClick={() => pickDifficulty(d)} data-testid={`arena-diff-${d}`}
            className={`flex-1 py-1.5 rounded text-[11px] font-semibold border transition-colors ${
              difficulty === d ? 'bg-indigo-700/60 border-indigo-400 text-white' : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900'}`}>
            {label}
          </button>
        ))}
      </div>

      <button onClick={start} disabled={!canStart} data-tour="arena-start" data-testid="arena-start"
        className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'linear-gradient(90deg,#6366f1,#4338ca)', color: 'white' }}>
        ⚔ Enter the Arena
      </button>
      <div className="text-[10px] leading-snug px-1" style={{ color: 'rgb(var(--g-500))' }}>
        Drive with <b>WASD</b> (rebind below) · <b>LMB</b> fires the mounted weapon · <b>RMB</b> melee · <b>Esc</b> pauses · <b>F1–F4</b> camera views.
        Damage is per-part and physical: a weapon only comes off once its mount is shot through. Your saved design is never changed by a fight.
      </div>
      <ControlsEditor slot="p1" title="Your keys (arena + sumo P1)" accent="#22c55e" />
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded bg-gray-900/60 px-1.5 py-1">
      <div className="text-[8px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-gray-100 font-semibold truncate">{value}</div>
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
        className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-slate-800 px-2 py-1.5 focus:outline-none"
        style={{ borderColor: value ? accent : undefined }}>
        <option value="">— select robot —</option>
        {candidates.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  )
}

