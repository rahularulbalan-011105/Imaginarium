// Guided-coach script. Each step anchors to a real element (via its data-tour
// attribute), explains WHY + HOW, and defines a read-only `detect` rule so the
// coach waits for the user to actually perform the action before advancing.
//
// detect.type:
//   'cam'        — camera move; mode: 'orbit' | 'zoom' | 'pan'
//   'objectType' — ≥ `count` objects of one of `any` types exist (count default 1)
//   'select' | 'selectType' — selection
//   'activate'   — transformMode === mode (toolbar OR keyboard)
//   'moved' | 'rotated' | 'scaled' — selected object's transform changed
//   'panel'      — the right panel shows `value`
//   'connection' — ≥ `count` NEW wire connections were made (count default 1)
//   'attach'     — a part was attached to a motor shaft (electronicsStore.attachments)
//   'bond'       — a surface bond joined two parts (rigidStore.bonds)
//   'codeRunning'| 'simActive' | 'simStopped'
//   'ack'        — an understanding beat; advances on the “Continue” button
//
// `demo` ('move' | 'rotate' | 'scale') shows a small animated illustration.

// ── "Build your first robot" mission — a REAL, working 2-wheel rover ──────────
// Chassis → shape it → motors → bond to chassis → wheels → attach → brain →
// wire BOTH motors → code → drive. Every step detects real state, so the tutorial
// actually produces a robot that moves (not a pile of loose parts).
export const COACH_STEPS = [
  {
    id: 'mission-start', selector: 'viewport', icon: '🤖',
    title: "Let's build a real robot!",
    why: 'The best way to learn Constructa is to build a working robot end to end.',
    how: "We'll make a 2-wheel rover: a chassis, two motors bonded on, wheels, a brain, wiring, code — then drive it. Follow the highlights!",
    cta: 'Click Continue to start building.',
    success: "Let's go! 🚀",
    detect: { type: 'ack' },
  },
  {
    id: 'add-chassis', selector: 'shape-box', icon: '⬛',
    title: 'Step 1 — Add the chassis',
    why: 'Every robot needs a base body that everything mounts onto.',
    how: 'In the Library section, click Cube (or press 3).',
    shortcut: '3',
    cta: 'Add a Cube.',
    success: 'There is your robot body! ⬛',
    detect: { type: 'objectType', any: ['box'] },
  },
  {
    id: 'flatten-chassis', selector: 'viewport', icon: '⤢', demo: 'scale',
    title: 'Step 2 — Make a BIG flat chassis',
    why: 'A real chassis is a large flat plate so motors + brain have room to sit — and so you can draw surfaces on it later.',
    how: 'Select the cube and press R (Scale). Make the LENGTH and WIDTH bigger than 4, and the THICKNESS (height) less than 3. Easiest way: open Properties → Dimensions and type W, D above 4 and H below 3.',
    shortcut: 'R',
    cta: 'Length & width > 4, thickness < 3 (a big flat plate).',
    success: 'Perfect — a big flat chassis with room to build! ⤢',
    detect: { type: 'flatChassis' },
  },
  {
    id: 'add-motors', selector: 'elec-motor_bo', icon: '⚙',
    title: 'Step 3 — Add two motors',
    why: 'Two motors = differential drive: the robot can go forward AND steer.',
    how: 'In the Elec section, click BO Motor twice. Move them to the left and right edges of the chassis.',
    cta: 'Add TWO motors and place them on the sides.',
    success: 'Two motors mounted! ⚙⚙',
    detect: { type: 'objectType', any: ['motor', 'motor_bo', 'motor_dc'], count: 2 },
  },
  {
    id: 'bond-motor', selector: 'viewport', icon: '🧲',
    title: 'Step 4 — Surface-attach BOTH motors',
    why: 'Bonding fixes each motor to the body so the whole thing moves as one robot.',
    how: 'Click the Surface tool (top-left toolbox). Then DRAW a small rectangle on a face of the motor, and DRAW another on the chassis where they meet — a prompt appears to Bond them. Repeat for the SECOND motor. (Both motors must be attached to continue.)',
    cta: 'Draw a surface on each motor + the chassis and Bond — do BOTH motors.',
    success: 'Both motors bonded to the body! 🧲',
    detect: { type: 'bond', count: 2 },
  },
  {
    id: 'add-wheels', selector: 'tab-library', icon: '⭕',
    title: 'Step 5 — Add two wheels',
    why: 'You need one wheel per motor to roll the robot.',
    how: 'In the Library section, click Cylinder TWICE to add two wheels. Move each next to a motor.',
    cta: 'Add TWO Cylinders as wheels.',
    success: 'Two wheels ready! ⭕⭕',
    detect: { type: 'objectType', any: ['cylinder'], count: 2 },
  },
  {
    id: 'open-props', selector: 'tab-properties', icon: '🛠️',
    title: 'Step 6 — Open the Props tab',
    why: 'The Properties (Props) panel is where you set each wheel’s attachment point.',
    how: 'Click a wheel to select it, then open the Props tab on the right rail.',
    cta: 'Select a wheel and open the Props tab.',
    success: 'Props panel open. 🛠️',
    detect: { type: 'panel', value: 'properties' },
  },
  {
    id: 'pick-attach', selector: 'pick-attach', icon: '◎',
    title: 'Step 7 — Pick the attachment point on BOTH wheels',
    why: 'The attachment point is the exact spot on the wheel that connects to the motor shaft.',
    how: 'Click ◎ Pick Attachment Point, then click the spot on the wheel where it meets the motor. Then select the OTHER wheel and do the same — both wheels need a point.',
    cta: 'Pick the attachment point on BOTH wheels.',
    success: 'Both wheels have their attachment point! ◎',
    detect: { type: 'attachPoint', count: 2 },
  },
  {
    id: 'add-brain', selector: 'elec-arduino', icon: '🧠',
    title: 'Step 8 — Add the brain',
    why: 'The Arduino runs your code and drives the motors.',
    how: 'In the Elec section, click Arduino. Place it on the chassis.',
    cta: 'Add an Arduino.',
    success: 'Brain installed! 🧠',
    detect: { type: 'objectType', any: ['arduino', 'subo'] },
  },
  {
    id: 'open-wiring', selector: 'tab-wiring', icon: '⚡',
    title: 'Step 9 — Open Wiring',
    why: 'Motors only spin once wired to the brain.',
    how: 'Click the ⚡ Wiring tab.',
    cta: 'Open the Wiring panel.',
    success: 'This is where you connect parts. ⚡',
    detect: { type: 'panel', value: 'wiring' },
  },
  {
    id: 'wire-both', selector: 'panel', icon: '🔌',
    title: 'Step 10 — Wire BOTH motors',
    why: 'A robot needs both wheels driven. Wire each motor to its own pin so your code can control both.',
    how: 'Wire the left motor to pin D5 and the right motor to pin D6 (drag motor pin → Arduino pin). That’s two wires — one per motor.',
    cta: 'Connect both motors to the Arduino (2 wires).',
    success: 'Both motors wired to the brain! 🔌',
    detect: { type: 'connection', count: 2 },
  },
  {
    id: 'open-code', selector: 'tab-code', icon: '{ }',
    title: 'Step 11 — Open the Code panel',
    why: 'Code tells the Arduino how fast to spin each motor.',
    how: 'Open the { } Code tab. (Prefer no typing? The Blocks tab does the same with drag-and-drop.)',
    cta: 'Open the Code tab.',
    success: 'Your robot’s instructions live here. { }',
    detect: { type: 'panel', value: 'code' },
  },
  {
    id: 'run-code', selector: 'code-run', icon: '▶',
    title: 'Step 12 — Program & run it',
    why: 'The brain must run its program to drive the motors — and the pins in the code must match your wiring (D5 & D6).',
    how: 'Load a motor Template (or write analogWrite(5, 200); analogWrite(6, 200);), then click ▶ Run.',
    cta: 'Load a motor template and click ▶ Run.',
    success: 'Code running — motors have orders! ▶',
    detect: { type: 'codeRunning' },
  },
  {
    id: 'drive-it', selector: 'simulate', icon: '🚗',
    title: 'Step 13 — Bring it to life',
    why: 'Simulation adds real physics so your rover actually drives.',
    how: 'Open the Sim section and click Start Simulation (▶). Then use the arrow keys / drive HUD to steer!',
    cta: 'Start Simulation and drive your robot.',
    success: 'It’s ALIVE — your robot drives! 🚗💨',
    detect: { type: 'simActive' },
  },
  {
    id: 'mission-done', selector: 'simulate', icon: '🏆',
    title: 'You built a working robot! 🏆',
    why: 'Chassis → motors → wheels → brain → wiring → code → drive: that’s the full Constructa workflow.',
    how: 'Click Stop Simulation to keep editing. Next: add sensors, try Blocks coding, or build a battle-bot in the Arena!',
    cta: 'Click ⏹ Stop Simulation to finish.',
    success: 'Tutorial complete — go build something awesome! 🎉',
    detect: { type: 'simStopped' },
  },
]
