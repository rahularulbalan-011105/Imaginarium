# Authoring catalogue parts

Every Tinkercad-equivalent electronics part lives in one file:
`src/parts/catalog/<folder>/<name>.part.js`. The file default-exports `definePart({...})`
(or an array of them, for a family such as NeoPixel ring sizes). Nothing else in the app
needs editing: the registry (`src/parts/registry.js`) feeds the scene store, 3D pins,
both wiring views, the library (search and filters), mass and power, the circuit solver,
the sketch sandbox, compiler diagnostics and Blockly.

Read these first: `src/parts/definePart.js` (the schema), `src/parts/model.js` (model
kit), `src/circuit/mna.js` (circuit elements), and the two reference parts
`catalog/basic/resistor.part.js` and `catalog/input/pushbutton.part.js`.

## 1. Real part, real size

- Units: **1 scene unit = 1 cm**. Y is up and the part's underside sits at y = 0.
  Through-hole legs end at y = 0, which is where breadboard holes are.
- `spec.dims_mm = { w, h, d }` is the real datasheet size: `w` along X, `h` the height
  along Y, `d` along Z. A test builds the model and checks its bounding box against these
  numbers (±12 %, or `spec.dimsTolerance`).
- Build recognisable geometry from `model.js`: `pcb`, `header`/`headerTips` (2.54 mm),
  `dip`/`dipPins` (300 mil DIP), `lead`, `cyl`, `box`, `textPlane`. Use more than two
  meshes. Import any extra three.js classes by name (`import { Group } from 'three'`).
  Never pass the `THREE` namespace around as a value: that pulls all of three.js into
  the startup bundle.
- Name meshes the simulation animates (`cap`, `seg_a`, `glow` …) and find them in
  `sim.visual` with `root.getObjectByName`.

## 2. Pins

`pins: [{ name, kind, x, y, z, r?, label?, ldy? }]`
- `kind`: `power | gnd | digital | analog | pwm | passive`.
- `name` is the wiring id that is saved in projects, so never rename it later. Use the
  datasheet's pin names (`VCC`, `GND`, `RS`, `DIN`, `1a` …).
- Put pins where the real leg, pad or header tip is. A test checks that every pin lies
  on the model.
- `internal: [['1a', '1b'], …]` lists pins that are the same copper inside the part
  (a switch's paired legs, every hole in a breadboard row).
- For dense grids, set `noLabel: true` on pins (a label sprite per hole is too heavy).

## 3. Properties

`props: { key: { type: 'number'|'select'|'color'|'bool'|'text', default, min, max, unit, label, options } }`.
New objects start with the defaults, and Properties shows an editor for each prop
(values outside min/max are clamped). List the keys that change the model in
`rebuildOn`.

## 4. Simulation (no fake results)

There are three mechanisms. Use whichever the real part needs.

**a. Circuit (analog, the MNA solver).** `sim.circuit(api)` stamps real elements and
returns handles:
`api.pin(name)` → node · `api.node()` → internal node · `api.add(el)` · `api.prop(k)` ·
`api.control(k)` (sim-bar control value) · `api.t` (seconds).
Elements from `mna.js` are: `resistor`, `vsource(pos, neg, V, rInt)`, `isource`,
`capacitor`, `inductor`, `diode`/`addDiode` (with `Rs`), `bjt`, `mosfet`, `sw`, `opamp`.
Their fields (`el.R`, `el.V`, `el.closed`, `el.I`) can change each step.
- `sim.beforeStep(h, api, dt)` runs before every solve: set switch states from
  controls, time-varying source voltages, and digital outputs.
- `sim.solved(h, api)` returns the part's state after each frame. It can read
  `api.vpin(name)`, `api.v(node)` and `api.cur(el)`, and raise problems with
  `api.issue(key, 'error'|'warning', title, detail)` / `api.clearIssue(key)`, for
  example over-current, reverse polarity or over-voltage.
- Set `sim.transient: true` (and optionally `sim.maxDt`) for time-dependent parts
  (555, function generator, RC timing). The solver then sub-steps every frame.

**b. Digital edges.** `sim.onPin(api, { pin, level })` is called on every board-pin
edge. Return a function to commit after every chip has sampled the edge (clocked
logic). `sim.onClockBit(api, { data, clock, bit })` receives each bit of `shiftOut()`.
`sim.drives(state, obj)` returns `{ pinName: 0|1|null }` for outputs that drive their net
logically. `api.level(name)` gives a net's logic level and `api.boardPin(name)` gives the
board pin number a part pin is wired to (or null). In `sim.circuit`, the api also has
`api.boardPin(name)` and `api.duty(name)` (the PWM duty of the board pin driving that net). PWM
is switched, not averaged: time-based circuits see the real 490/980 Hz waveform, DC circuits are
solved at 16 phases and each part's `solved()` state is averaged over them, so read averaged
quantities from your state, not instantaneous pin voltages.

**c. Library-level (LCD, NeoPixel, Keypad, IR).** For parts a sketch talks to through
an Arduino library:
- `code.sandbox` is JavaScript source added to the sketch sandbox, in the same scope as
  `digitalWrite`. Define the library class with the real API names. It forwards calls
  with `__part('<type>', 'fn', [args])` and reads parent data with `__partIn('<type>')`.
- `sim.calls = { fn(args, api) { … } }` is the parent-side handler. It runs for every
  part of that type. Check the wiring yourself (for example, the LCD compares the
  sketch's RS/EN pins with `api.boardPin('RS')`) and write to `api.state`.
- Library handlers (`sim.calls`) can also call `api.issue(...)` / `api.clearIssue(key)`.
- `sim.input(api)` returns data for `IN.parts[type][objId]`, such as the key held or the
  IR code. `sim.initState(obj)` gives the per-run state. `sim.pulse(api)` returns
  `{ boardPin: µs }` for `pulseIn()`.
- `code = { includes, classes, consts, functions: { name: arity }, sandbox, sandboxConsts, example }`
  makes the compiler diagnostics accept the library.

Sandbox rules: ES5 (`var`, `function`, prototypes), no backticks, prefix private helpers
`__<type>_`. One library class belongs to exactly one part file. Methods that take time
on real hardware are fine to make instant.

**Visuals.** `sim.visual(root, { solved, state, off }, obj)` updates the 3D model every
frame (glow, text, segments, rotation). It is called with `off: true` when the
simulation stops; restore the unpowered look then. Use `setGlow(mesh, color, 0…1)`.
Run-time inputs go in `sim.controls`: `{ key, kind: 'button'|'toggle'|'slider'|'keypad'|'buttons', label, min, max, step, unit, rows }`.
`sim.readout({ solved, state }, obj)` returns a short live text, such as a multimeter's
display.

## 5. Blockly

`blockly.blocks` is a list of Blockly JSON definitions; prefix each type with
`part_<type>_`. `blockly.generators[type](block, gen, H)` emits Arduino C++. `H.include(gen, '<Lib.h>')`
adds an include, `H.define(gen, key, line)` a global, and `H.setup(gen, key, line)` a
once-only `setup()` line. `H.Order` holds the precedences. The generated C++ must pass
`analyzeArduino` and the transpiler; the catalogue tests check this for every block.

## 6. Tests (required)

`tests: [{ name, run(kit, { runSketch }) }]` scenarios run in `tests/parts/catalog.test.js`
against the real simulation path (`src/parts/testkit.js`):

```js
kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 1000 } }, [['R:1', 'U:D13'], ['R:2', 'U:GND1']])
kit.pinMode(13, 'output'); kit.write(13, 1); kit.step(0.02)
kit.near(kit.state('R').current, 5 / 1025, 2e-5)
// end-to-end through the real transpiler + sandbox runtime:
const s = runSketch(kit, cppSource); await s.run(150); … s.stop()
```

Assertions are `kit.ok`, `kit.equal`, `kit.near` and `kit.between`. You can also check
`kit.state(id)`, `kit.partState(id)`, `kit.led[id]`, `kit.hasIssue('id:key')` and
`kit.mesh(id)` (for visuals). Uno pin numbers: D0–D13 = 0–13 and A0–A5 = 14–19.
Board pins: `5V`, `3V3`, `GND1`/`GND2`/`GND3`, `VIN`, `SDA`/`SCL` (= A4/A5).

Expected values come from the datasheet or a hand calculation, not from whatever the
code happens to output. Every part with a simulation needs at least one scenario; one
that drives it from a C++ sketch (`runSketch`) is best. Run only your part:
`npx vitest run tests/parts -t "part:<type> "`.

The dashboard (`npm run test:dashboard`) shows each part as PASS / FAIL / NOT TESTED per
aspect. Set `tinkercad:` to the exact name in `src/parts/tinkercadCatalog.js`
(separate several with `;`).
