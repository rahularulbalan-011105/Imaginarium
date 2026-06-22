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

export const COACH_STEPS = [
  // ── Camera controls (each is a single direct skill) ────────────────────────
  {
    id: 'cam-orbit', selector: 'viewport', icon: '🎥',
    title: 'Orbit the camera',
    why: 'Seeing your design from every angle helps you place parts accurately.',
    how: 'Press and hold the LEFT mouse button on an empty area, then drag to spin the view.',
    cta: 'Try it now — drag on empty space.',
    success: 'Nice! You just orbited the camera. 🎉',
    detect: { type: 'cam', mode: 'orbit' },
  },
  {
    id: 'cam-zoom', selector: 'viewport', icon: '🔍',
    title: 'Zoom the camera',
    why: 'Zoom in for fine detail, out to see the whole build.',
    how: 'Roll the mouse wheel up to zoom in, down to zoom out.',
    cta: 'Scroll the mouse wheel now.',
    success: 'Perfect — that’s zoom. 🔍',
    detect: { type: 'cam', mode: 'zoom' },
  },
  {
    id: 'cam-pan', selector: 'viewport', icon: '✋',
    title: 'Pan the camera',
    why: 'Panning slides the view sideways without rotating it.',
    how: 'Press and hold the RIGHT mouse button, then drag.',
    cta: 'Try panning now — right-drag.',
    success: 'Great, you can pan! ✋',
    detect: { type: 'cam', mode: 'pan' },
  },

  // ── Create & select ─────────────────────────────────────────────────────────
  {
    id: 'add-cube', selector: 'shape-box', icon: '⬛',
    title: 'Add a cube',
    why: 'Cubes are basic building blocks for robots, vehicles, and custom parts.',
    how: 'This button drops a cube into the scene.',
    shortcut: '3',
    cta: 'Click the highlighted Cube button now.',
    success: 'You created your first object! 🎉',
    detect: { type: 'objectType', any: ['box'] },
  },
  {
    id: 'select-cube', selector: 'viewport', icon: '🖱️',
    title: 'Select the cube',
    why: 'You must select an object before you can use a tool on it.',
    how: 'Click directly on the cube in the 3D view. A selected object shows colored arrows.',
    cta: 'Click the cube to select it.',
    success: 'Selected! Those arrows are the transform gizmo. 👍',
    detect: { type: 'select' },
  },

  // ── Move: activate, then use ────────────────────────────────────────────────
  {
    id: 'activate-move', selector: 'mode-translate', icon: '✛',
    title: 'Activate the Move tool',
    why: 'A tool decides what dragging does. The Move tool makes dragging reposition objects.',
    how: 'Click the Move tool in the toolbar, or press W. (Move is the default, so it may already be active.)',
    shortcut: 'W',
    cta: 'Select the Move tool — click it or press W.',
    success: 'Move tool is active. ✛',
    detect: { type: 'activate', mode: 'translate' },
  },
  {
    id: 'move-cube', selector: 'viewport', icon: '✛', demo: 'move',
    title: 'Move the cube',
    why: 'Moving positions parts exactly where you want them in your build.',
    how: 'Drag one of the colored arrows on the cube. Each arrow slides it along one axis.',
    cta: 'Drag an arrow to move the cube.',
    success: 'You moved the cube! 🚀',
    detect: { type: 'moved' },
  },

  // ── Rotate: activate, then use ──────────────────────────────────────────────
  {
    id: 'activate-rotate', selector: 'mode-rotate', icon: '↻',
    title: 'Activate the Rotate tool',
    why: 'Rotating changes orientation — wheels, arms and sensors all need the right angle.',
    how: 'Click the Rotate tool in the toolbar, or press E.',
    shortcut: 'E',
    cta: 'Select the Rotate tool — click it or press E.',
    success: 'Rotate tool is active. ↻',
    detect: { type: 'activate', mode: 'rotate' },
  },
  {
    id: 'rotate-cube', selector: 'viewport', icon: '↻', demo: 'rotate',
    title: 'Rotate the cube',
    why: 'Setting the right angle makes parts line up and mechanisms work.',
    how: 'Drag one of the rings around the cube to spin it.',
    cta: 'Drag a ring to rotate the cube.',
    success: 'You rotated the cube! ↻',
    detect: { type: 'rotated' },
  },

  // ── Scale: activate, then use ───────────────────────────────────────────────
  {
    id: 'activate-scale', selector: 'mode-scale', icon: '⤢',
    title: 'Activate the Scale tool',
    why: 'Scaling resizes parts so everything fits together.',
    how: 'Click the Scale tool in the toolbar, or press R.',
    shortcut: 'R',
    cta: 'Select the Scale tool — click it or press R.',
    success: 'Scale tool is active. ⤢',
    detect: { type: 'activate', mode: 'scale' },
  },
  {
    id: 'scale-cube', selector: 'viewport', icon: '⤢', demo: 'scale',
    title: 'Resize the cube',
    why: 'Resizing tailors a part to the exact size your design needs.',
    how: 'Drag one of the corner/face handles on the cube to make it bigger or smaller.',
    cta: 'Drag a handle to resize the cube.',
    success: 'You resized it! You now know Move, Rotate & Scale. 📏',
    detect: { type: 'scaled' },
  },

  // ── Electronics: Arduino (add → select → inspect → understand) ──────────────
  {
    id: 'add-arduino', selector: 'elec-arduino', icon: '🟢',
    title: 'Add an Arduino',
    why: 'The Arduino is the “brain” — it runs your program and controls the other parts.',
    how: 'This adds an Arduino board to the scene.',
    cta: 'Click the highlighted Arduino button.',
    success: 'Brain added! 🧠',
    detect: { type: 'objectType', any: ['arduino', 'subo'] },
  },
  {
    id: 'select-arduino', selector: 'viewport', icon: '🖱️',
    title: 'Select the Arduino',
    why: 'Selecting a component lets you inspect and configure it.',
    how: 'Click the Arduino board in the 3D view.',
    cta: 'Click the Arduino to select it.',
    success: 'Arduino selected. 👍',
    detect: { type: 'selectType', any: ['arduino', 'subo'] },
  },
  {
    id: 'open-properties', selector: 'tab-properties', icon: '🛠️',
    title: 'Open the Properties panel',
    why: 'Properties shows everything about the selected part and lets you configure it.',
    how: 'Click the Properties tab on the right. It now reflects the selected Arduino.',
    cta: 'Open the Properties tab.',
    success: 'Properties panel open. 🛠️',
    detect: { type: 'panel', value: 'properties' },
  },
  {
    id: 'understand-arduino', selector: 'panel', icon: '🧠',
    title: 'What the Arduino controls',
    why: 'The Arduino sends signals out on its pins. Anything wired to a pin can be driven by your code.',
    how: 'A motor on a pin spins when your code sets that pin; an LED lights the same way. The Arduino orchestrates them all.',
    cta: 'Read this, then click Continue.',
    success: 'Now you understand the brain. 🧠',
    detect: { type: 'ack' },
  },

  // ── Electronics: Motor (add → understand) ──────────────────────────────────
  {
    id: 'add-motor', selector: 'elec-motor_bo', icon: '⚙',
    title: 'Add a motor',
    why: 'Motors create movement — they spin wheels, arms and propellers.',
    how: 'This adds a motor to the scene.',
    cta: 'Click the highlighted Motor button.',
    success: 'Motor ready! ⚙',
    detect: { type: 'objectType', any: ['motor', 'motor_bo', 'motor_dc'] },
  },
  {
    id: 'understand-motor', selector: 'panel', icon: '⚙',
    title: 'What the motor does',
    why: 'A motor turns electrical signals into spinning movement.',
    how: 'To make it move you’ll wire it to the Arduino, then tell the Arduino how fast to drive it — that’s the next two steps.',
    cta: 'Read this, then click Continue.',
    success: 'Got it — wire it, then program it. ⚙',
    detect: { type: 'ack' },
  },

  // ── Wiring (open → connect) ────────────────────────────────────────────────
  {
    id: 'open-wiring', selector: 'tab-wiring', icon: '⚡',
    title: 'Open the Wiring panel',
    why: 'Components only work once connected. This panel makes the connections.',
    how: 'Open the Wiring tab to see every component’s pins.',
    cta: 'Click the ⚡ Wiring tab.',
    success: 'This is the Wiring panel. ⚡',
    detect: { type: 'panel', value: 'wiring' },
  },
  {
    id: 'connect', selector: 'panel', icon: '🔌',
    title: 'Connect two components',
    why: 'A wire lets power and signals flow between parts — the motor needs this to hear the Arduino.',
    how: 'Click a pin on one component, then a pin on another, to join them with a wire.',
    cta: 'Make one connection between two pins.',
    success: 'Connected! Power and signals can flow. ⚡',
    detect: { type: 'connection' },
  },

  // ── Programming panels ─────────────────────────────────────────────────────
  {
    id: 'open-blocks', selector: 'tab-blocks', icon: '🧩',
    title: 'Open the Blocks panel',
    why: 'Visual programming lets you build logic by snapping blocks — no typing.',
    how: 'Open the Blocks tab to program with drag-and-drop. It writes the code for you.',
    cta: 'Click the 🧩 Blocks tab.',
    success: 'Visual programming lives here. 🧩',
    detect: { type: 'panel', value: 'blocks' },
  },
  {
    id: 'open-code', selector: 'tab-code', icon: '{ }',
    title: 'Open the Code panel',
    why: 'Code gives you full control over how components behave.',
    how: 'Open the Code tab to write Arduino C++ — the Templates menu gives you a head start.',
    cta: 'Click the { } Code tab.',
    success: 'This is where Arduino code goes. { }',
    detect: { type: 'panel', value: 'code' },
  },

  // ── Understand & run the code (distinct from simulation) ───────────────────
  {
    id: 'understand-code', selector: 'panel', icon: '🧠',
    title: 'What the code does',
    why: 'Code is the list of instructions your Arduino follows — it decides when motors spin, LEDs light, and how fast.',
    how: 'The editor holds Arduino C++. The Templates menu has ready-made examples (Motor ramp, Servo sweep, LED blink).',
    cta: 'Tip: load a Template, then click Continue.',
    success: 'Code = your robot’s instructions. 🧠',
    detect: { type: 'ack' },
  },
  {
    id: 'run-code', selector: 'code-run', icon: '▶',
    title: 'Run the code',
    why: 'The controller must execute its instructions before it can drive anything. Running code is NOT the same as running a simulation.',
    how: 'Press ▶ Run in the Code panel. (If the editor is empty, load a Template first.)',
    cta: 'Click ▶ Run to execute the program.',
    success: 'Code is running! Components now respond. ▶',
    detect: { type: 'codeRunning' },
  },
  {
    id: 'observe-result', selector: 'viewport', icon: '👀',
    title: 'Observe the result',
    why: 'The program is executing now. Components controlled by your code respond to its instructions.',
    how: 'If your code drives a motor, servo, or LED, watch it move or light up in the 3D view.',
    cta: 'Watch for a moment, then click Continue.',
    success: 'That’s your code controlling hardware. 👀',
    detect: { type: 'ack' },
  },

  // ── Simulation: physics + environment (distinct from code execution) ───────
  {
    id: 'start-sim', selector: 'simulate', icon: '▶',
    title: 'Start the simulation',
    why: 'Simulation is different from running code: it applies physics and environment — gravity, friction, wind — so you can test how the whole build behaves.',
    how: 'Click the Simulate button (▶) at the bottom of the toolbar.',
    cta: 'Click ▶ Simulate to enter simulation mode.',
    success: 'Simulation running with physics! ▶',
    detect: { type: 'simActive' },
  },
  {
    id: 'observe-sim', selector: 'viewport', icon: '🌍',
    title: 'Observe the simulation',
    why: 'Now physics acts on top of your running code — this is how the robot would behave in the real world.',
    how: 'Notice gravity, friction, and momentum affecting the parts as they move.',
    cta: 'Watch for a moment, then click Continue.',
    success: 'Code + physics = your build, alive. 🤖',
    detect: { type: 'ack' },
  },
  {
    id: 'stop-sim', selector: 'simulate', icon: '⏹',
    title: 'Stop the simulation',
    why: 'Stopping simulation returns you to editing — nothing is lost. (Code execution and simulation are separate; this stops the physics simulation.)',
    how: 'Click the Simulate button again (it now shows ⏹ Stop) to exit simulation mode.',
    cta: 'Click ⏹ to stop the simulation.',
    success: 'Back to editing. You finished the tutorial! 🎉',
    detect: { type: 'simStopped' },
  },
]
