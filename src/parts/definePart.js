// ─────────────────────────────────────────────────────────────────────────────
// definePart — the ONE schema every catalogue part follows.
//
// A part file (src/parts/catalog/**/<name>.part.js) default-exports
// definePart({...}). The registry (registry.js) discovers every such file, so
// adding a part never edits a shared table: the scene store, ObjectManager,
// both wiring views, the library, mass/power, the circuit solver, the sketch
// sandbox, the compiler diagnostics and the Blockly toolbox all read the
// registry.
//
// Units: model + pin coordinates are in scene units where 1 unit = 1 cm (the
// convention of every electronics model in electronicsFactory.js). The real
// part's size in millimetres is recorded in `spec.dims_mm`, and a test checks
// the built model's bounding box against it.
// ─────────────────────────────────────────────────────────────────────────────

/** Library sections. Keys shared with ElectronicsLibrary's built-in groups merge into them. */
export const PART_CATEGORIES = [
  { key: 'mcu',         label: 'Microcontrollers',     color: '#3b82f6', blurb: 'Controllers that run your code.' },
  { key: 'basic',       label: 'Basic Components',     color: '#a16207', blurb: 'Resistors, capacitors, inductors and potentiometers.' },
  { key: 'semis',       label: 'Diodes & Transistors', color: '#7c3aed', blurb: 'Diodes, Zeners, BJTs and MOSFETs.' },
  { key: 'input',       label: 'Switches & Inputs',    color: '#0891b2', blurb: 'Buttons, switches and keypads you press while the circuit runs.' },
  { key: 'sensors',     label: 'Sensors',              color: '#14b8a6', blurb: 'Measure the world and report back.' },
  { key: 'lights',      label: 'Lights',               color: '#eab308', blurb: 'LEDs, RGB LEDs, NeoPixels and bulbs.' },
  { key: 'displays',    label: 'Displays',             color: '#8b5cf6', blurb: 'Show text, numbers and graphics.' },
  { key: 'actuators',   label: 'Actuators',            color: '#22c55e', blurb: 'Create movement, light or sound.' },
  { key: 'ics',         label: 'ICs & Logic',          color: '#475569', blurb: 'Timers, shift registers, logic gates, op-amps and regulators.' },
  { key: 'drivers',     label: 'Motor Drivers',        color: '#f59e0b', blurb: 'Sit between the board and the motors.' },
  { key: 'power',       label: 'Power',                color: '#dc2626', blurb: 'Batteries and supplies.' },
  { key: 'breadboards', label: 'Breadboards',          color: '#9ca3af', blurb: 'Plug parts in; each row of holes is connected inside.' },
  { key: 'instruments', label: 'Instruments',          color: '#0f766e', blurb: 'Measure voltage, current and resistance; make and watch signals.' },
  { key: 'comms',       label: 'Communication',        color: '#2563eb', blurb: 'Infrared and serial links.' },
]
export const CATEGORY_KEYS = new Set(PART_CATEGORIES.map(c => c.key))

/** Electrical kind of a pin → its 3D sphere colour and wiring role. */
export const PIN_KINDS = {
  power:   { color: 0xff2222, type: 'power' },
  gnd:     { color: 0x333333, type: 'gnd' },
  digital: { color: 0xffcc00, type: 'digital' },
  analog:  { color: 0x22cc88, type: 'analog' },
  pwm:     { color: 0xff8800, type: 'pwm' },
  passive: { color: 0xb0b7c3, type: 'digital' },   // a plain lead (resistor leg, breadboard hole)
}

const PROP_TYPES = new Set(['number', 'select', 'color', 'bool', 'text'])
const CONTROL_KINDS = new Set(['button', 'toggle', 'slider', 'keypad', 'buttons'])

/**
 * @typedef PinDef
 * @property {string} name   unique within the part ('ANODE', 'IN1', 'A1' …) — the wiring id
 * @property {number} x @property {number} y @property {number} z   local position (cm)
 * @property {keyof PIN_KINDS} kind
 * @property {string} [label] @property {number} [r] sphere radius (default 0.09)
 * @property {number} [ldy] @property {number} [ldx] label offsets
 */

/**
 * @param {object} def
 * @param {string} def.type                unique scene-object type id
 * @param {string} def.label               library name
 * @param {string} def.category            PART_CATEGORIES key
 * @param {string} [def.tinkercad]         the matching Tinkercad Circuits name (inventory)
 * @param {string} def.desc                one-line spec shown under the name
 * @param {string} def.purpose             what it does + how to wire it
 * @param {string} [def.usage]
 * @param {string} [def.icon]
 * @param {object} def.spec                { dims_mm: {w,h,d}, mass_kg, ...real ratings }
 * @param {PinDef[]|function} def.pins     pin list, or (obj) => pin list for prop-dependent parts
 * @param {(string[])[]|function} [def.internal]  groups of pins joined INSIDE the part (breadboard rows)
 * @param {object} [def.props]             editable properties { key: { type, default, … } }
 * @param {(obj) => THREE.Object3D} def.build   real-size procedural model (import three yourself)
 * @param {string[]} [def.rebuildOn]       prop keys whose change rebuilds the model
 * @param {object} [def.sim]               { circuit, solved, visual, controls, sandbox, calls, input, reset }
 * @param {object} [def.code]              { includes, classes, consts, functions, sandbox, calls }
 * @param {object} [def.blockly]           { blocks: [...json], generators: { type: fn }, toolbox: [...] }
 * @param {number} [def.currentDraw_mA]
 * @param {object} [def.spawn]             default position offset { x, y, z }
 */
export function definePart(def) {
  const errs = []
  const need = (k) => { if (def[k] == null || def[k] === '') errs.push(`missing "${k}"`) }
  ;['type', 'label', 'category', 'desc', 'purpose', 'spec', 'pins', 'build'].forEach(need)
  if (def.type && !/^[a-z][a-z0-9_]*$/.test(def.type)) errs.push(`type "${def.type}" must be snake_case`)
  if (def.category && !CATEGORY_KEYS.has(def.category)) errs.push(`unknown category "${def.category}"`)
  if (def.spec && !def.spec.dims_mm) errs.push('spec.dims_mm is required (real size)')
  if (def.spec && !(def.spec.mass_kg > 0)) errs.push('spec.mass_kg must be > 0')
  if (def.build && typeof def.build !== 'function') errs.push('build must be a function')
  for (const [k, p] of Object.entries(def.props ?? {})) {
    if (!PROP_TYPES.has(p.type)) errs.push(`prop ${k}: bad type ${p.type}`)
    if (p.type === 'select' && !(p.options?.length)) errs.push(`prop ${k}: select needs options`)
  }
  for (const c of def.sim?.controls ?? []) if (!CONTROL_KINDS.has(c.kind)) errs.push(`control ${c.key}: bad kind ${c.kind}`)
  if (Array.isArray(def.pins)) errs.push(...validatePins(def.pins))
  if (errs.length) throw new Error(`definePart(${def.type ?? '?'}): ${errs.join('; ')}`)
  return Object.freeze({ props: {}, rebuildOn: [], sim: {}, code: {}, ...def })
}

export function validatePins(pins) {
  const errs = [], seen = new Set()
  for (const p of pins) {
    if (!p.name) { errs.push('pin without name'); continue }
    if (seen.has(p.name)) errs.push(`duplicate pin ${p.name}`)
    seen.add(p.name)
    if (!PIN_KINDS[p.kind]) errs.push(`pin ${p.name}: bad kind ${p.kind}`)
    for (const a of ['x', 'y', 'z']) if (!Number.isFinite(p[a])) errs.push(`pin ${p.name}: ${a} not a number`)
  }
  return errs
}

/** Default prop values for a new object of this part. */
export function defaultProps(part) {
  return Object.fromEntries(Object.entries(part.props ?? {}).map(([k, p]) => [k, p.default]))
}

/** A part's prop value on a scene object (falls back to the default). */
export function propOf(part, obj, key) {
  const v = obj?.[key]
  return v === undefined ? part.props?.[key]?.default : v
}

/** Resolve a part's pin list for one scene object (pins may depend on props). */
export function pinsOf(part, obj) {
  return typeof part.pins === 'function' ? part.pins(obj ?? {}) : part.pins
}
export function internalOf(part, obj) {
  if (!part.internal) return []
  return typeof part.internal === 'function' ? part.internal(obj ?? {}) : part.internal
}
