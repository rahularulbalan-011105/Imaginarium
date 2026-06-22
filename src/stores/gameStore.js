import { create } from 'zustand'

// Per-player control config (remappable keys + which side is "forward").
// `front`: +z (default) | +x | -z | -x — fixes "W drives sideways" when the
// robot's modelled front isn't its +Z face.
const DEFAULT_CONTROLS = {
  p1: { up: 'w', down: 's', left: 'a', right: 'd', front: '+z' },
  p2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', front: '+z' },
}
const CTRL_KEY = 'subo.controls'
function loadControls() {
  try { const s = JSON.parse(localStorage.getItem(CTRL_KEY)); if (s?.p1 && s?.p2) return s } catch (_) {}
  return DEFAULT_CONTROLS
}
function saveControls(c) { try { localStorage.setItem(CTRL_KEY, JSON.stringify(c)) } catch (_) {} }

// Robo-Sumo battle state. BattleManager owns the simulation and pushes live
// values here (hp/status) for the HUD; the UI sets up players and start/stop.
export const useGameStore = create((set) => ({
  battleActive: false,
  mode: 'local',          // 'local' | 'online'
  p1Id: null,             // local mode: the two robots
  p2Id: null,

  // ── Online (WebRTC via PeerJS) ──
  role: null,             // 'host' | 'guest'
  connState: 'idle',      // idle | waiting | connecting | connected | closed | error
  roomCode: '',
  netError: '',
  myRobotId: null,        // this client's robot
  oppName: '',            // opponent's robot name
  oppReady: false,        // opponent has selected a robot

  status: 'setup',        // setup | countdown | fighting | roundover | matchover
  round: 1,
  lives: { p1: 3, p2: 3 },
  hp:    { p1: 100, p2: 100 },
  message: '',
  winner: null,           // 'p1' | 'p2' | null

  controls: loadControls(),
  setControl: (player, action, value) => set(s => {
    const c = { ...s.controls, [player]: { ...s.controls[player], [action]: value } }
    saveControls(c)
    return { controls: c }
  }),
  resetControls: () => { saveControls(DEFAULT_CONTROLS); return set({ controls: DEFAULT_CONTROLS }) },

  setMode: (mode) => set({ mode }),
  setP1: (id) => set({ p1Id: id }),
  setP2: (id) => set({ p2Id: id }),
  setMyRobot: (id) => set({ myRobotId: id }),
  setBattleActive: (v) => set({ battleActive: v }),

  // BattleManager / NetworkManager → HUD
  sync: (partial) => set(partial),

  resetMatch: () => set({
    status: 'setup', round: 1, winner: null, message: '',
    lives: { p1: 3, p2: 3 }, hp: { p1: 100, p2: 100 },
  }),
}))
