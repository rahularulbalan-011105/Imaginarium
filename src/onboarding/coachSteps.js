// Guided-coach script. Each step anchors to a real element (via its data-tour
// attribute), explains WHY + HOW, and defines a read-only `detect` rule so the
// coach waits for the user to actually perform the action before advancing.
//
// Pedagogy: tool ACTIVATION and skill EXECUTION are taught as separate steps.
//   "Activate Move" → transformMode === 'translate'
//   "Move the cube" → the cube's position actually changed
//
// detect.type:
//   'cam'        — camera move; mode: 'orbit' | 'zoom' | 'pan'
//   'objectType' — an object of one of `any` types now exists
//   'select'     — anything is selected
//   'selectType' — the selected object is one of `any` types
//   'activate'   — transformMode === mode (set by toolbar OR keyboard)
//   'moved' | 'rotated' | 'scaled' — selected object's transform changed
//   'panel'      — the right panel shows `value`
//   'connection' — a new wire connection was made
//   'sim'        — a simulation is running
//   'simStopped' — simulation has been stopped
//   'ack'        — an understanding beat; advances on the “Continue” button
//
// `demo` ('move' | 'rotate' | 'scale') shows a small animated illustration.

// ── "Build your first robot" mission ─────────────────────────────────────────
// A goal-driven build (a 2-wheel rover) instead of feature exploration: every
// step adds a real part or wires/programs it, ending with a robot that drives.
// Uses only detect types the GuidedCoach implements (objectType[+count], moved,
// panel, connection, codeRunning, simActive, simStopped, ack).
export const COACH_STEPS = [
  {
    id: 'mission-start', selector: 'viewport', icon: '🤖',
    title: "Let's build your first robot!",
    why: 'The fastest way to learn Constructa is to build something real.',
    how: "We'll make a little 2-wheel rover together — add a body, a brain, motors, wire them, program it, and drive it. Follow the highlights!",
    cta: 'Ready? Click Continue to start building.',
    success: "Let's go! 🚀",
    detect: { type: 'ack' },
  },
  {
    id: 'build-body', selector: 'shape-box', icon: '⬛',
    title: 'Step 1 — Add the body',
    why: "Every robot needs a chassis — the base everything mounts on.",
    how: 'Open the Library section on the right and click Cube (or press 3). It drops in as your robot body.',
    shortcut: '3',
    cta: 'Add a Cube — your robot chassis.',
    success: 'Nice — there is your chassis! ⬛',
    detect: { type: 'objectType', any: ['box'] },
  },
  {
    id: 'build-brain', selector: 'elec-arduino', icon: '🧠',
    title: 'Step 2 — Add the brain',
    why: 'The Arduino is the brain — it runs your code and controls the motors.',
    how: 'In the Elec (Electronics) section, click Arduino. Place it on the body.',
    cta: 'Add an Arduino — the robot brain.',
    success: 'Brain installed! 🧠',
    detect: { type: 'objectType', any: ['arduino', 'subo'] },
  },
  {
    id: 'build-motors', selector: 'elec-motor_bo', icon: '⚙',
    title: 'Step 3 — Add two motors (wheels)',
    why: 'Two motors give a robot differential drive — it can go forward and turn.',
    how: 'In the Elec section, click BO Motor twice to add TWO motors.',
    cta: 'Add TWO motors.',
    success: 'Two motors ready — those are your wheels! ⚙⚙',
    detect: { type: 'objectType', any: ['motor', 'motor_bo', 'motor_dc'], count: 2 },
  },
  {
    id: 'place-motor', selector: 'viewport', icon: '✛', demo: 'move',
    title: 'Step 4 — Position a wheel',
    why: 'Parts start stacked at the center — you position them to build the shape you want.',
    how: 'Click a motor to select it, then drag one of the colored arrows to move it to the side of the body.',
    shortcut: 'W',
    cta: 'Drag a motor to the side of the chassis.',
    success: 'You positioned a wheel! Do the other side too if you like. ✛',
    detect: { type: 'moved' },
  },
  {
    id: 'open-wiring', selector: 'tab-wiring', icon: '⚡',
    title: 'Step 5 — Open Wiring',
    why: 'Motors only spin once wired to the brain. The Wiring panel makes connections.',
    how: 'Click the ⚡ Wiring tab on the right rail.',
    cta: 'Open the Wiring panel.',
    success: 'This is where you connect parts. ⚡',
    detect: { type: 'panel', value: 'wiring' },
  },
  {
    id: 'wire-motor', selector: 'panel', icon: '🔌',
    title: 'Step 6 — Wire a motor to the brain',
    why: 'A wire lets the Arduino send power/signals to the motor so your code can drive it.',
    how: 'Click a pin on a motor, then a pin on the Arduino, to join them with a wire.',
    cta: 'Connect a motor pin to an Arduino pin.',
    success: 'Wired! The brain can now reach the motor. 🔌',
    detect: { type: 'connection' },
  },
  {
    id: 'open-code', selector: 'tab-code', icon: '{ }',
    title: 'Step 7 — Open the Code panel',
    why: 'Code tells the Arduino what to do — like how fast to spin the motors.',
    how: 'Open the { } Code tab. Prefer no typing? The Blocks tab does the same with drag-and-drop.',
    cta: 'Open the Code tab.',
    success: 'This is your robot’s instructions. { }',
    detect: { type: 'panel', value: 'code' },
  },
  {
    id: 'run-code', selector: 'code-run', icon: '▶',
    title: 'Step 8 — Program & run it',
    why: 'The brain must run its program before it can drive anything.',
    how: 'Open the Templates menu, pick “Motor ramp” (or similar), then click ▶ Run.',
    cta: 'Load a Template, then click ▶ Run.',
    success: 'Code is running — your motors have orders! ▶',
    detect: { type: 'codeRunning' },
  },
  {
    id: 'drive-it', selector: 'simulate', icon: '🚗',
    title: 'Step 9 — Bring it to life',
    why: 'Simulation adds real physics (gravity, friction) so your rover actually drives.',
    how: 'Open the Sim section and click Start Simulation (▶). Watch your robot move!',
    cta: 'Start Simulation and watch it drive.',
    success: 'It’s ALIVE — your robot is driving! 🚗💨',
    detect: { type: 'simActive' },
  },
  {
    id: 'mission-done', selector: 'simulate', icon: '🏆',
    title: 'You built a robot! 🏆',
    why: 'You just designed, wired, programmed and simulated a working robot — the whole Constructa workflow.',
    how: 'Click Stop Simulation to go back to editing. Next: add sensors, try the Blocks coder, or build a battle-bot in the Arena!',
    cta: 'Click ⏹ Stop Simulation to finish.',
    success: 'Tutorial complete — go build something awesome! 🎉',
    detect: { type: 'simStopped' },
  },
]
