// "Debug the Puppy Robot" — a guided repair mission.
//   Loads public/projects/puppy-robot.json (a deliberately-broken rover) and walks
//   the user through fixing TWO real bugs, narrated by the puppy itself:
//     Bug 1 · a missing semicolon in the Arduino code  → won't compile
//     Bug 2 · the LEFT motor's TERM_A pin has no wire   → robot spins in circles
//
// Same step shape as coachSteps.js (why/how/cta/selector/fallback/detect/toolTip).
// New detect types used here (implemented in GuidedCoach.jsx):
//   'codeRan'         → the ▶ Run button was clicked this step (constructa:code-run)
//   'codeCompiles'    → analyzeArduino(code).ok === true (the ; was added)
//   'motorSignalFixed'→ every motor now has its TERM_A pin wired (left motor rejoined)

// Correct fix for Bug 2: the LEFT motor's TERM_A must join the Arduino's D3 pin
// (the RIGHT motor is already on D3 — sharing pin 3 makes both wheels drive together).
// Dynamic arrow: point at the un-wired motor's TERM_A, then D3, then Connect —
// following the WiringPanel's idle → source → confirm state machine (elec.wireDraft).
function wiringFixSelector(scene, elec) {
  const arduino = scene.objects.find((o) => o.type === 'arduino' || o.type === 'subo')
  const motors  = scene.objects.filter((o) => ['motor_bo', 'motor', 'motor_dc'].includes(o.type))
  if (!arduino || motors.length === 0) return 'tab-wiring'
  const conns = Object.values(elec.connections || {})
  const termAWired = (m) => conns.some((c) => c.fromPinId === `${m.id}:TERM_A` || c.toPinId === `${m.id}:TERM_A`)
  const broken = motors.find((m) => !termAWired(m))
  if (!broken) return 'wire-connect'                     // already fixed → last anchor
  const draft = elec.wireDraft || {}
  const aPin  = `${broken.id}:TERM_A`
  const d3    = `${arduino.id}:D3`
  if (draft.mode === 'confirm') return 'wire-connect'    // both pins chosen → point at ⚡ Connect
  if (draft.mode === 'source')  return draft.srcPin === aPin ? `pin-${d3}` : `pin-${aPin}`
  return `pin-${aPin}`                                   // idle → start at TERM_A
}

export const DEBUG_STEPS = [
  // ── Intro ────────────────────────────────────────────────────────────────
  {
    id: 'debug-greet', selector: 'viewport', icon: '🐶',
    title: 'Meet Puppy',
    why: "Woof! I'm PUPPY 🐶 — a little rover with two drive motors, an ultrasonic nose 📡, an IR eye 👁️, a servo tail, and an Arduino brain. But something's wrong with me… I can't drive straight! Will you help fix me?",
    how: "Let's run me in the simulator, spot what's wrong, and get me rolling.",
    cta: "Let's fix you, Puppy! 🔧",
    success: "Yes! Let's debug! 🐾",
    detect: { type: 'ack' },
  },

  // ── Discover the bug in simulation ───────────────────────────────────────
  {
    id: 'debug-open-sim', selector: 'tab-sim', icon: '🎮',
    title: 'Take me for a drive',
    why: "Let's see how I drive — open the simulator and we'll spot what's wrong.",
    how: 'Open the Sim tab on the right rail.',
    cta: 'Open the Sim panel.',
    success: "Simulator ready. Let's roll! 🎮",
    detect: { type: 'panel', value: 'sim' },
  },
  {
    id: 'debug-start-sim', selector: 'simulate', fallback: 'tab-sim', icon: '🚀',
    title: 'Start the simulation',
    why: "Drop me into the world — click ▶ Start Simulation.",
    how: 'Click ▶ Start Simulation.',
    cta: 'Start the simulation.',
    success: "I'm alive in the arena! Now run my code… 🚀",
    detect: { type: 'simActive' },
  },
  {
    id: 'debug-run-in-sim', selector: 'sim-run-code', fallback: 'tab-sim', icon: '▶',
    title: 'Run my code — watch closely',
    why: "Now hit ▶ Run Code down in the bottom-left simulation bar, and keep your eyes on me. Let's see how I drive…",
    how: 'Click ▶ Run Code (bottom-left of the viewport) and watch me try to move.',
    cta: 'Click ▶ Run Code.',
    success: "…something's off, right? 👀",
    detect: { type: 'codeRunning' },
  },
  {
    id: 'debug-observe-circle', selector: 'sim-exit', fallback: 'sim-run-code', icon: '🌀',
    title: 'Oops — I only spin!',
    why: "Argh! 🌀 I just spin in circles — my LEFT wheel isn't turning! Only ONE motor is getting a signal. That's a wiring bug: my left motor has no signal wire. Let's leave the sim and open the hood.",
    how: 'Click ✕ Exit Simulation (bottom-left) so we can rewire.',
    cta: 'Exit the simulation.',
    success: "Out of the sim. To the wiring bench! 🔧",
    detect: { type: 'simStopped' },
  },

  // ── Bug 2 · fix the wiring ───────────────────────────────────────────────
  {
    id: 'debug-open-wiring', selector: 'tab-wiring', icon: '🔌',
    title: 'Open my wiring',
    why: "Let's look under my hood. Open the Wiring tab — then the Wiring Workbench to see every connection.",
    how: 'Open the Wiring tab (and its drag-to-connect Workbench).',
    cta: 'Open the Wiring panel.',
    success: "There's my wiring. Spot the problem? 🔍",
    detect: { type: 'panel', value: 'wiring' },
  },
  {
    id: 'debug-connect-left', selector: wiringFixSelector, fallback: 'tab-wiring', icon: '⚡',
    title: 'Connect the LEFT motor',
    why: "See it? My LEFT motor's TERM_A pin is a dead end — no wire, no signal, so that wheel never spins. My RIGHT motor already runs to D3, so wire my LEFT TERM_A to that same D3 pin and both wheels will drive together.",
    how: 'Click LEFT motor TERM_A → then Arduino D3 → then ⚡ Connect.',
    cta: 'Wire LEFT TERM_A → D3.',
    success: "Connected! Both motors have signal now — let's test it! ⚡🎉",
    detect: { type: 'motorSignalFixed' },
    toolTip: { tool: 'Wiring', text: 'Pick the first pin, then the second, then Connect — the wire snaps in.' },
  },

  // ── Verify the fix ───────────────────────────────────────────────────────
  {
    id: 'debug-open-sim-2', selector: 'tab-sim', icon: '🎮',
    title: 'Test the fix',
    why: "Moment of truth — back to the simulator to see if I drive straight now.",
    how: 'Open the Sim tab again.',
    cta: 'Open the Sim panel.',
    success: "Here we go! 🎮",
    detect: { type: 'panel', value: 'sim' },
  },
  {
    id: 'debug-start-sim-2', selector: 'simulate', fallback: 'tab-sim', icon: '🚀',
    title: 'Start the simulation',
    why: "Click ▶ Start Simulation one more time.",
    how: 'Click ▶ Start Simulation.',
    cta: 'Start the simulation.',
    success: "I'm in the arena! Run my code… 🚀",
    detect: { type: 'simActive' },
  },
  {
    id: 'debug-run-2', selector: 'sim-run-code', fallback: 'tab-sim', icon: '▶',
    title: 'Run my code — go go go!',
    why: "Hit ▶ Run Code (bottom-left) and watch me GO!",
    how: 'Click ▶ Run Code in the bottom-left bar and watch me drive.',
    cta: 'Click ▶ Run Code.',
    success: "Look at me go! 🐕💨",
    detect: { type: 'codeRunning' },
  },
  {
    id: 'debug-victory', selector: 'viewport', icon: '🏆',
    title: 'HURRAY — you fixed me!',
    why: "HURRAAY! 🎉🐶 Both wheels spin and I drive STRAIGHT! You found my dead motor wire and fixed it. You're a real robot doctor. 🩺 Woof woof — thank you!",
    how: "Debugging done — you found the bug and fixed it.",
    cta: 'Mission complete! 🏆',
    success: "You did it! 🎉🐾",
    detect: { type: 'ack' },
  },
  {
    id: 'debug-credit', selector: 'viewport', icon: '🤖', showCredit: true,
    title: 'Credits',
    why: "This robot was created by Mr Zabir.",
    how: 'Meet the creator, then continue.',
    cta: 'Continue',
    success: '',
    detect: { type: 'creditClosed' },
  },
  {
    id: 'debug-find-learn', selector: 'menu-tour', fallback: 'help', icon: '🧭',
    exitSim: true, clearScene: true, openLearn: true, auto: 7000,
    title: 'Take the grand tour!',
    why: "Nice work! 🎉 Now let me show you around — take the Product Tour for a quick highlight of every panel. You'll find it (and more) under 🎓 Learn anytime.",
    how: 'Open 🎓 Learn → Show Product Tour.',
    cta: 'Product Tour lives under 🎓 Learn',
    success: "Enjoy the tour! 👋",
    detect: { type: 'ack' },
  },
]
