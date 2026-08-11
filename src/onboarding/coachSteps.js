// Guided-coach script — narrated by the robot being built.
//   why  → the robot talking (short, human, rendered as a 🤖 speech bubble)
//   how  → the concise instruction
//   cta  → the one-line goal
//   selector → PRIMARY anchor (card placement + main arrow), a data-tour id
//   arrows   → OPTIONAL extra data-tour ids to also point at (multi-tool steps)
//   toolTip  → { tool, text } small "what this tool does" note (shown even on video steps)
//   detect   → read-only state rule; the coach waits for the real action
//
// detect.type: 'ack' | 'objectType'(+count) | 'bigWheels' | 'panel' | 'connection'(+count)
//   | 'attachPointPicked'(+count) | 'attached'(+count) | 'bond'(+count) | 'flatChassis'
//   | 'codeRunning' | 'simActive' | 'simStopped'
//
// Videos (public/tutorial/): filmed steps play a clip in the card; others show text.

// Correct wiring plan for Step 9 and its wrong-connection detector.
//   Motor 1: TERM_A → D5, TERM_B → GND      Motor 2: TERM_A → D6, TERM_B → GND
// Returns { ready, wrong: [connId…], missing: [reqWire…], allDone, arduino }.
// A connection is WRONG if it isn't one of the four planned wires.
export function wiringReport(scene, elec) {
  const motors = scene.objects.filter((o) => ['motor_bo', 'motor', 'motor_dc'].includes(o.type))
  const arduino = scene.objects.find((o) => o.type === 'arduino' || o.type === 'subo')
  if (!motors[0] || !motors[1] || !arduino) return { ready: false, wrong: [], missing: [], allDone: false }
  const a = arduino.id
  const gnds = [`${a}:GND1`, `${a}:GND2`, `${a}:GND`]
  // Both motors' TERM_A → D3 (matches the "Motor ramp" code template, pin 3);
  // both TERM_B → any GND.
  const required = [
    { key: 'm1a', motor: `${motors[0].id}:TERM_A`, ard: `${a}:D3`, arduPin: 'D3',   label: 'Motor 1 TERM_A → D3' },
    { key: 'm1b', motor: `${motors[0].id}:TERM_B`, gnd: true,      arduPin: 'GND1', label: 'Motor 1 TERM_B → GND' },
    { key: 'm2a', motor: `${motors[1].id}:TERM_A`, ard: `${a}:D3`, arduPin: 'D3',   label: 'Motor 2 TERM_A → D3' },
    { key: 'm2b', motor: `${motors[1].id}:TERM_B`, gnd: true,      arduPin: 'GND2', label: 'Motor 2 TERM_B → GND' },
  ]
  const conns = Object.entries(elec.connections || {}).map(([id, c]) => ({ id, x: c.fromPinId, y: c.toPinId }))
  const met = new Set()
  const wrong = []
  for (const c of conns) {
    let matched = null
    for (const r of required) {
      const other = c.x === r.motor ? c.y : (c.y === r.motor ? c.x : null)
      if (!other) continue
      if (r.gnd ? gnds.includes(other) : other === r.ard) { matched = r.key; break }
    }
    if (matched) met.add(matched); else wrong.push(c.id)
  }
  const missing = required.filter((r) => !met.has(r.key))
  return { ready: true, wrong, missing, allDone: wrong.length === 0 && missing.length === 0, arduino }
}

// ── "Build your first robot" — a REAL, working 2-wheel rover ──────────────────
export const COACH_STEPS = [
  {
    id: 'mission-start', selector: 'viewport', icon: '🤖',
    title: 'Meet your robot',
    why: "Hi! I'm your robot — well, I will be, once you build me. Ready?",
    how: "We'll build my body, add motors and wheels, give me a brain, wire me up, and drive me.",
    cta: "Yes, let's do this! 🚀",
    success: "Let's go! 🚀",
    detect: { type: 'ack' },
  },
  {
    id: 'add-chassis', selector: 'shape-box', fallback: 'tab-library', icon: '⬛',
    title: 'Step 1 — Give me a body',
    why: "First things first: I need a BODY. Something solid to bolt all my parts onto. Any body. Even a cube. I'm not picky.",
    how: 'Open the Library and click Cube.',
    cta: 'Add a Cube.',
    success: "A body! Sure, it's a cube — but it's MY cube. Now let's shape it. ⬛",
    detect: { type: 'objectType', any: ['box'] },
  },
  {
    id: 'flatten-chassis', selector: 'mode-scale', icon: '⤢', demo: 'scale',
    title: 'Step 2 — Flatten me out',
    why: "A bit boxy, aren't I? Squash me into a wide, thin chassis so my parts have room.",
    how: 'Use the Scale tool — make length & width above 4, thickness about 0.5. (Or Props → Dimensions.)',
    toolTip: { tool: 'Scale', text: 'Resizes the selected object — drag the handles to stretch or shrink it.' },
    cta: 'Wide & flat: L/W > 4, thickness ~0.5.',
    success: "Now THAT'S a chassis. ⤢",
    detect: { type: 'flatChassis' },
  },
  {
    // Point at the BO Motor button; until the Elec panel is open, fall back to
    // the Elec rail tab so the arrow first leads the user THERE, then to the motor.
    id: 'add-motors', selector: 'elec-motor_bo', fallback: 'tab-electronics', icon: '⚙',
    title: 'Step 3 — Give me muscles',
    why: 'I need TWO motors — one per side — so I can drive AND steer. One alone just spins me in circles.',
    how: 'Open the Elec section, then click BO Motor twice. Drop one on each side of me.',
    cta: 'Add TWO motors, one per side.',
    success: 'Twin engines! I can feel the power. ⚙⚙',
    detect: { type: 'objectType', any: ['motor', 'motor_bo', 'motor_dc'], count: 2 },
  },
  {
    // Arrow → the "Connect Surfaces" bond button once 2 surfaces are picked;
    // otherwise → the Surface tool.
    id: 'bond-motor', selector: 'surface-bond', fallback: 'tool-surface', icon: '🧲',
    title: 'Step 4 — Bolt my motors on',
    why: "My motors are just resting there — one bump and they're gone! Bond them to my body.",
    how: 'Turn on the Surface tool, then: 1) click a face on the CHASSIS, 2) click the touching face on the MOTOR, 3) hit ⊕ Connect Surfaces. Do this for BOTH motors.',
    toolTip: { tool: 'Surface', text: 'Bonds parts together — pick a face on each part, then Connect Surfaces.' },
    cta: 'Chassis face → motor face → Connect Surfaces. Both motors.',
    success: "Locked on. We're one robot now. 🧲",
    detect: { type: 'bond', count: 2 },
  },
  {
    // Arrow points at the Cylinder button until 2 cylinders exist, then at the
    // Scale tool (this step's real goal is scaling them into wheels).
    id: 'add-wheels', icon: '⭕', exitTools: true,
    // Three-phase arrow:
    //   < 2 cylinders            → Cylinder button (fallback: Library tab)
    //   2 cylinders ON chassis   → Move tool (drag them clear first)
    //   2 cylinders OFF chassis  → Scale tool (resize into wheels)
    selector: (s) => {
      const cyls = s.objects.filter((o) => o.type === 'cylinder')
      if (cyls.length < 2) return 'shape-cylinder'
      const box = s.objects.find((o) => o.type === 'box')
      if (!box) return 'mode-scale'
      // AABB overlap in XZ: box base half-extent = scale (BoxGeometry half = 1);
      // cylinder radius = max(scale.x, scale.z) (CylinderGeometry radius = 1).
      const clear = (c) => {
        const bhx = Math.abs(box.scale.x), bhz = Math.abs(box.scale.z)
        const cr  = Math.max(Math.abs(c.scale.x), Math.abs(c.scale.z))
        const overX = Math.abs(c.position.x - box.position.x) < bhx + cr
        const overZ = Math.abs(c.position.z - box.position.z) < bhz + cr
        return !(overX && overZ)   // clear = not overlapping the chassis footprint
      }
      return cyls.every(clear) ? 'mode-scale' : 'mode-translate'
    },
    fallback: 'tab-library',
    title: 'Step 5 — I need wheels',
    why: 'Motors with nothing to spin?! Give me two chunky wheels — cylinders, scaled up nice and big.',
    how: 'Click Cylinder twice. Drag each one AWAY from the chassis first (they spawn on top of it), then Scale each up to ~1.5–2× and park one by each motor.',
    cta: 'Move both cylinders off the chassis, then scale them into wheels.',
    detect: { type: 'bigWheels', count: 2, min: 2.6 },
    success: 'Look at those wheels. 😍⭕⭕',
  },
  {
    id: 'attach-both', selector: 'pick-attach', fallback: 'tab-properties', icon: '◎',
    title: 'Step 6 — Mark where my wheels go',
    why: 'Each wheel needs to know exactly where it meets my motor shaft. Open my Props and mark the spot.',
    how: 'Open Props, select a wheel, click ◎ Pick Attachment Point, then click the exact spot on the wheel. Do both.',
    cta: 'Select the circle, then pick a point — on both wheels.',
    success: 'X marks the spot — twice! ◎◎',
    detect: { type: 'attachPointPicked', count: 2 },
  },
  {
    id: 'attach-wheels', selector: 'attach-motor', fallback: 'tab-properties', icon: '🔩',
    title: 'Step 7 — Pop my wheels on',
    why: "Now snap those wheels onto my shafts — this is when I finally look like a real robot!",
    how: 'With a wheel selected, click “Attach to Motor…” (or the ✓ Attach prompt). Do both wheels.',
    cta: 'Attach both wheels to their motors.',
    success: 'Wheels on! I can taste the open road. 🔩🚗',
    detect: { type: 'attached', count: 2 },
  },
  {
    // Corrective aside (un-numbered, ack) — fix a wheel that mounted inside the body.
    id: 'fix-wheel-y', selector: 'shaft-pos-y', fallback: 'tab-properties', icon: '🩹',
    title: 'Wheel stuck inside me?',
    why: "If a wheel ended up sunk into my body, no worries — just nudge it out along the Y axis.",
    how: 'Click the sunken wheel, then in Props → Fine position, lower its Y until the wheel sits clear of the chassis. (Skip if both wheels already look right.)',
    cta: 'Fixed it (or all good)? — Continue →',
    success: 'Wheels sitting pretty. 🩹',
    detect: { type: 'ack' },
  },
  {
    id: 'add-brain', selector: 'elec-arduino', fallback: 'tab-electronics', icon: '🧠',
    title: 'Step 8 — Give me a brain',
    why: "I've got no thoughts in my head — mostly because I have no head. Drop an Arduino on me!",
    how: 'In the Elec section, click Arduino and place it on my chassis.',
    cta: 'Add an Arduino.',
    success: 'Now I can think! 🧠',
    detect: { type: 'objectType', any: ['arduino', 'subo'] },
  },
  {
    // Pin-by-pin guided sequence. Walks: motor TERM → Arduino pin → Connect, for
    // all 4 wires. Uses the live wire-draft (idle/source/confirm) + connection
    // count to point at the exact next thing. Pins match the code (D5, D6).
    //   wire 1: Motor1 TERM_A → D5    wire 2: Motor1 TERM_B → GND1
    //   wire 3: Motor2 TERM_A → D6    wire 4: Motor2 TERM_B → GND2
    id: 'wire-all', icon: '🔌', fallback: 'tab-wiring',
    selector: (scene, elec) => {
      const rep = wiringReport(scene, elec)
      if (!rep.ready) return 'tab-wiring'
      // A wrong wire exists → point at its ✂ Cut button so the user removes it.
      if (rep.wrong.length) return `conn-cut-${rep.wrong[0]}`
      const next = rep.missing[0]
      if (!next) return 'wire-connect'
      const draft = elec.wireDraft || { mode: 'idle' }
      if (draft.mode === 'confirm') return 'wire-connect'                 // both picked → Connect
      if (draft.mode === 'source')  return `pin-${rep.arduino.id}:${next.arduPin}` // motor picked → Arduino pin
      return `pin-${next.motor}`                                          // start → the correct motor terminal
    },
    title: 'Step 9 — Wire me up',
    why: "My brain can't reach my motors yet — connect us! Each motor needs a signal pin AND a ground.",
    how: 'Follow the arrow: click a motor TERM, then the Arduino pin, then ⚡ Connect. BOTH motors: TERM_A → D3, TERM_B → GND. Wire it wrong and I’ll flag it — the arrow will point at the wire to cut.',
    cta: 'TERM A → pin → Connect, then TERM B → GND → Connect — both motors.',
    success: 'I can feel my motors! 🔌⚡',
    detect: { type: 'wiredCorrectly' },
  },
  {
    id: 'open-code', selector: 'tab-code', icon: '{ }',
    title: 'Step 10 — Teach me',
    why: "I'm built and wired… and standing perfectly still, because nobody told me what to DO!",
    how: 'Open the { } Code tab. (Prefer no typing? Blocks works too.)',
    cta: 'Open the Code tab.',
    success: 'Ready for orders. { }',
    detect: { type: 'panel', value: 'code' },
  },
  {
    id: 'run-code', selector: 'code-run', icon: '▶',
    title: 'Step 11 — Upload my orders',
    why: 'Give me a program telling my D3 motors how fast to spin — then hit Run!',
    how: 'Load the "Motor ramp" Template (it uses pin 3) — or write analogWrite(3, 200); — then click ▶ Run.',
    cta: 'Load the motor template and click ▶ Run.',
    success: 'Orders received! ▶',
    detect: { type: 'codeRunning' },
  },
  {
    id: 'drive-it', selector: 'simulate', fallback: 'tab-sim', icon: '🚗',
    title: 'Step 12 — Bring me to life',
    why: "This is the moment! Start the simulation, grab the controls, and let's GO!",
    how: 'Open the Sim section, click ▶ Start Simulation, and steer me with the arrow keys!',
    cta: 'Start Simulation and drive me!',
    success: "I'M ALIVE!! Look at me GO! 🚗💨",
    detect: { type: 'simActive' },
  },
  {
    id: 'mission-done', selector: 'simulate', icon: '🏆',
    title: 'You built me! 🏆',
    why: 'From a lonely cube to a driving, thinking robot — YOU did that. Thank you!',
    how: 'Stop Simulation to keep editing. Next: add sensors so I can SEE, try Blocks, or enter me in a Battle. 👀',
    cta: 'Click ⏹ Stop Simulation to finish.',
    success: 'Tutorial complete — now go build my siblings! 🎉',
    detect: { type: 'simStopped' },
  },
]
