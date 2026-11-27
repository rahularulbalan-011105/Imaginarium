// Browser half of the Constructa MCP server: what each MCP tool actually does,
// against the live editor. tools/mcp/constructa-mcp.mjs (Node) owns the tool
// names, descriptions and argument schemas and forwards each call here over the
// local WebSocket bridge (src/mcp/mcpBridge.js).
//
// Every edit goes through the same store actions the UI uses and is recorded
// with recordSnapshot(), so anything Claude does is one Ctrl+Z away and is
// saved/autosaved like a user edit.
import { v4 as uuidv4 } from 'uuid'
import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { recordSnapshot, undo, redo } from '../managers/history/editorDispatch.js'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { ensureModels, hasModel, isModelLoaded, modelKeyOf } from '../utils/modelLoader.js'
import { variantOverrides } from '../utils/componentVariants.js'
import { PIN_DEFS, ELEC_TYPES, pinRole, isDuplicate } from '../utils/wiring.js'
import { analyzeArduino } from '../utils/arduinoDiagnostics.js'
import { runSketch, stopSketch, getSketchOutput, clearSketchOutput, currentBoard } from '../managers/sketchRunner.js'
import { CATEGORIES } from '../components/ElectronicsLibrary.jsx'

// Plain CAD shapes (geometryFactory.createGeometry) Claude may add besides electronics.
export const SHAPES = ['box', 'rectprism', 'cylinder', 'sphere', 'cone', 'pyramid', 'pentpyramid', 'tetrahedron',
  'octahedron', 'dodecahedron', 'torus', 'capsule', 'prism', 'hexagon', 'diamond', 'plane', 'wheel', 'caster', 'gear']

// Parts with a horn / shaft that attach_part can mount things on (ObjectManager SHAFT_TYPES).
const SHAFT_TYPES = ['motor', 'motor_bo', 'motor_dc', 'motor_enc', 'servo', 'servo_cr', 'stepper']

const r2d = (r) => Math.round((r * 180 / Math.PI) * 100) / 100
const d2r = (d) => (d * Math.PI) / 180
const round = (v) => Math.round(v * 1000) / 1000
const vec = (v) => (v ? { x: round(v.x), y: round(v.y), z: round(v.z) } : undefined)

class ToolError extends Error {}
const fail = (msg) => { throw new ToolError(msg) }

const objects = () => useSceneStore.getState().objects

/** Find a part by id or (case-insensitive) name. */
function findPart(ref) {
  if (!ref) fail('No part given.')
  const list = objects()
  const hit = list.find((o) => o.id === ref) ?? list.find((o) => (o.name ?? '').toLowerCase() === String(ref).toLowerCase())
  if (!hit) fail(`No part "${ref}". Call get_scene to see the parts and their ids.`)
  return hit
}

/** "Arduino_1:D9" / "<id>:D9" → { part, pin, pinId }. */
function resolvePin(ref) {
  const s = String(ref ?? '')
  const i = s.lastIndexOf(':')
  if (i < 1) fail(`Pin "${s}" must look like "<part name or id>:<PIN>", e.g. "Arduino_1:D9".`)
  const part = findPart(s.slice(0, i))
  const want = s.slice(i + 1)
  const pins = PIN_DEFS[part.type]
  if (!pins) fail(`${part.name} (${part.type}) has no pins to wire.`)
  const pin = pins.find((p) => p === want) ?? pins.find((p) => p.toLowerCase() === want.toLowerCase())
  if (!pin) fail(`${part.name} has no pin "${want}". Its pins: ${pins.join(', ')}.`)
  return { part, pin, pinId: `${part.id}:${pin}` }
}

function describePart(o) {
  return {
    id: o.id, name: o.name, type: o.type,
    ...(o.variant ? { variant: o.variant } : {}),
    position: vec(o.position),
    rotation_deg: o.rotation ? { x: r2d(o.rotation.x), y: r2d(o.rotation.y), z: r2d(o.rotation.z) } : undefined,
    scale: vec(o.scale),
    ...(o.color ? { color: o.color } : {}),
    ...(PIN_DEFS[o.type] ? { pins: PIN_DEFS[o.type] } : {}),
    ...attachedTo(o.id),
    ...(o.physics?.mass > 0 ? { mass_kg: o.physics.mass } : {}),
  }
}

function attachedTo(id) {
  const mid = useElectronicsStore.getState().attachments[id]
  if (!mid) return {}
  return { attached_to: objects().find((x) => x.id === mid)?.name ?? mid }
}

function describeWires() {
  const byId = new Map(objects().map((o) => [o.id, o.name]))
  const label = (pinId) => { const [id, pin] = pinId.split(':'); return `${byId.get(id) ?? id}:${pin}` }
  return Object.entries(useElectronicsStore.getState().connections).map(([id, c]) => ({
    id, from: label(c.fromPinId), to: label(c.toPinId),
  }))
}

function catalog() {
  const parts = []
  for (const cat of CATEGORIES) for (const it of cat.items) {
    parts.push({
      type: it.type, ...(it.variant ? { variant: it.variant } : {}), label: it.label, category: cat.label,
      description: it.purpose ?? it.desc, ...(PIN_DEFS[it.type] ? { pins: PIN_DEFS[it.type] } : {}),
    })
  }
  return { electronics: parts, shapes: SHAPES }
}

function diagSummary(report) {
  const line = (d) => ({ line: d.line, col: d.col, message: d.message, ...(d.suggestion ? { suggestion: d.suggestion } : {}) })
  return {
    ok: report.ok,
    errors: (report.errors ?? []).map(line),
    warnings: (report.warnings ?? []).map(line),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Tool handlers ────────────────────────────────────────────────────────────
// Each returns plain JSON, or { __image: { data, mimeType }, ...json } for an image.
export const TOOLS = {
  get_scene() {
    const es = useElectronicsStore.getState()
    return {
      board: currentBoard(),
      parts: objects().map(describePart),
      wires: describeWires(),
      code_lines: (es.code ?? '').split('\n').length,
      sketch_running: !!es.simulation?.running,
      simulator_on: !!useUiStore.getState().simActive,
    }
  },

  list_parts() { return catalog() },

  async add_part({ type, variant, name, position, rotation_deg }) {
    const known = catalog().electronics.some((p) => p.type === type && (!variant || p.variant === variant))
    if (!known && !SHAPES.includes(type)) fail(`Unknown part type "${type}"${variant ? ` / variant "${variant}"` : ''}. Call list_parts for the catalog.`)
    const mk = modelKeyOf(type)
    if (!isModelLoaded(mk) && hasModel(mk)) await ensureModels([mk])     // pins anchor to the real board
    const overrides = variant ? variantOverrides(variant, objects()) : undefined
    const obj = useSceneStore.getState().addObject(type, position, overrides)
    const patch = {}
    if (name) patch.name = name
    if (rotation_deg) patch.rotation = { x: d2r(rotation_deg.x ?? 0), y: d2r(rotation_deg.y ?? 0), z: d2r(rotation_deg.z ?? 0) }
    if (Object.keys(patch).length) useSceneStore.getState().updateObject(obj.id, patch)
    recordSnapshot('Claude: add part')
    return describePart(objects().find((o) => o.id === obj.id))
  },

  update_part({ part, name, position, rotation_deg, scale, color, mass_kg }) {
    const o = findPart(part)
    const patch = {}
    // Physics weight override (Physics → Body → mass): a printed, hollow part
    // weighs far less than the solid volume × density estimate. null clears it.
    if (mass_kg !== undefined) {
      if (mass_kg !== null && !(mass_kg > 0)) fail('mass_kg must be a positive number of kilograms (or null to use the estimate).')
      const phys = { ...(o.physics ?? {}) }
      if (mass_kg === null) delete phys.mass
      else phys.mass = mass_kg
      patch.physics = phys
    }
    if (name) patch.name = name
    if (position) patch.position = { ...o.position, ...position }
    if (rotation_deg) {
      const cur = { x: r2d(o.rotation.x), y: r2d(o.rotation.y), z: r2d(o.rotation.z), ...rotation_deg }
      patch.rotation = { x: d2r(cur.x), y: d2r(cur.y), z: d2r(cur.z) }
    }
    if (scale) {
      if (ELEC_TYPES.has(o.type)) fail('Electronics keep their real size; only plain shapes can be scaled.')
      patch.scale = { ...o.scale, ...scale }
    }
    if (color) patch.color = color
    if (!Object.keys(patch).length) fail('Nothing to change.')
    useSceneStore.getState().updateObject(o.id, patch)
    recordSnapshot('Claude: edit part')
    return describePart(objects().find((x) => x.id === o.id))
  },

  // Fix a part onto a servo horn / motor shaft WHERE IT IS (no snapping), the
  // way a limb hangs off a joint: it then turns with the horn, and the physics
  // engine treats it as the link that joint drives. Chains are allowed (the knee
  // servo rides on the hip horn, the shin on the knee horn, …).
  attach_part({ part, to }) {
    const o = findPart(part)
    const m = findPart(to)
    if (!SHAFT_TYPES.includes(m.type)) fail(`"${m.name}" has no horn or shaft. Attach to a servo, 360° servo, motor or stepper.`)
    if (o.id === m.id) fail('A part cannot be attached to itself.')
    const att = useElectronicsStore.getState().attachments
    for (let id = m.id, n = 0; id && n < 64; id = att[id], n++) {
      if (id === o.id) fail(`"${m.name}" already rides on "${o.name}" — attaching back would make a loop.`)
    }
    if (att[o.id] === m.id) return { attached: o.name, to: m.name, unchanged: true }
    if (att[o.id]) { objectManager.detachMeshFromRotor(o.id); useElectronicsStore.getState().detachFromMotor(o.id) }
    if (!objectManager.reattachAtWorld(o.id, m.id)) fail(`"${m.name}" is still loading — try again in a moment.`)
    useElectronicsStore.getState().attachToMotor(o.id, m.id)
    recordSnapshot('Claude: attach part')
    sceneManager.requestRender?.()
    return { attached: o.name, to: m.name }
  },

  detach_part({ part }) {
    const o = findPart(part)
    if (!useElectronicsStore.getState().attachments[o.id]) fail(`"${o.name}" is not attached to anything.`)
    const p = objectManager.detachMeshFromRotor(o.id)
    useElectronicsStore.getState().detachFromMotor(o.id)
    if (p) useSceneStore.getState().updateObject(o.id, { position: { x: p.x, y: p.y, z: p.z } })
    recordSnapshot('Claude: detach part')
    sceneManager.requestRender?.()
    return { detached: o.name }
  },

  delete_part({ part }) {
    const o = findPart(part)
    useElectronicsStore.getState().removeConnectionsFor(o.id)
    useSceneStore.getState().removeObject(o.id)
    recordSnapshot('Claude: delete part')
    return { deleted: o.name }
  },

  get_pins({ part }) {
    const o = findPart(part)
    const pins = PIN_DEFS[o.type]
    if (!pins) return { part: o.name, pins: [] }
    const used = new Map()
    for (const w of describeWires()) {
      if (w.from.startsWith(`${o.name}:`)) used.set(w.from.split(':')[1], w.to)
      if (w.to.startsWith(`${o.name}:`)) used.set(w.to.split(':')[1], w.from)
    }
    return { part: o.name, pins: pins.map((p) => ({ pin: p, role: pinRole(p), ...(used.has(p) ? { wired_to: used.get(p) } : {}) })) }
  },

  connect({ from, to }) {
    const a = resolvePin(from), b = resolvePin(to)
    if (a.part.id === b.part.id) fail('Both ends are on the same part.')
    const conns = useElectronicsStore.getState().connections
    if (isDuplicate(conns, a.pinId, b.pinId)) fail(`${a.part.name}:${a.pin} and ${b.part.name}:${b.pin} are already wired.`)
    const id = uuidv4()
    useElectronicsStore.getState().addWireConnection(a.pinId, b.pinId, id)
    recordSnapshot('Claude: wire')
    return { id, from: `${a.part.name}:${a.pin}`, to: `${b.part.name}:${b.pin}` }
  },

  disconnect({ wire, from, to }) {
    const conns = useElectronicsStore.getState().connections
    let id = wire && conns[wire] ? wire : null
    if (!id && from) {
      const a = resolvePin(from).pinId, b = to ? resolvePin(to).pinId : null
      id = Object.keys(conns).find((k) => {
        const c = conns[k], ends = [c.fromPinId, c.toPinId]
        return ends.includes(a) && (!b || ends.includes(b))
      })
    }
    if (!id) fail('No such wire. Call get_scene to see the wires and their ids.')
    useElectronicsStore.getState().removeWireConnection(id)
    recordSnapshot('Claude: unwire')
    return { removed: id }
  },

  get_code() { return { board: currentBoard(), code: useElectronicsStore.getState().code ?? '' } },

  set_code({ code }) {
    useElectronicsStore.getState().setCode(code)
    const report = analyzeArduino(code, { board: currentBoard() })
    return { saved: true, lines: code.split('\n').length, check: diagSummary(report) }
  },

  check_code({ code }) {
    const src = code ?? useElectronicsStore.getState().code ?? ''
    return { board: currentBoard(), ...diagSummary(analyzeArduino(src, { board: currentBoard() })) }
  },

  async run_code({ code, wait_ms = 2000 }) {
    if (code != null) useElectronicsStore.getState().setCode(code)
    if (useElectronicsStore.getState().simulation?.running) stopSketch()
    const res = await runSketch(useElectronicsStore.getState().code)
    if (!res.ok) {
      return {
        running: false,
        ...(res.report ? { check: diagSummary(res.report) } : {}),
        ...(res.error ? { error: res.error } : {}),
      }
    }
    await sleep(Math.max(0, Math.min(15000, wait_ms)))
    const out = getSketchOutput()
    return {
      running: !!useElectronicsStore.getState().simulation?.running,
      serial: out.serial,
      ...(out.runtimeError ? { runtime_error: out.runtimeError } : {}),
      ...(res.report.warnings?.length ? { warnings: diagSummary(res.report).warnings } : {}),
    }
  },

  // Same as the drive HUD's Exit: stop the sketch AND leave drive mode. Stopping
  // only the sketch left the robot parked mid-drive with its parts re-parented,
  // so later edits landed relative to the moving robot.
  stop_code() {
    stopSketch()
    const ui = useUiStore.getState()
    if (ui.simActive) ui.setSimActive(false)
    return { stopped: true, simulator_on: false }
  },

  get_serial({ clear = false }) {
    const out = getSketchOutput()
    if (clear) clearSketchOutput()
    return {
      running: !!useElectronicsStore.getState().simulation?.running,
      serial: out.serial,
      ...(out.runtimeError ? { runtime_error: out.runtimeError } : {}),
    }
  },

  screenshot({ view, max_width = 1024 }) {
    const { renderer, scene, camera } = sceneManager
    if (!renderer) fail('The 3D view is not ready.')
    if (view) sceneManager.setView(view)
    // Render and read back in the same task — the canvas has no preserved
    // drawing buffer, so this is the only point where its pixels are valid.
    renderer.render(scene, camera)
    const src = renderer.domElement
    const k = Math.min(1, max_width / src.width)
    const c = document.createElement('canvas')
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k)
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
    sceneManager.requestRender()
    const data = c.toDataURL('image/jpeg', 0.85).split(',')[1]
    return { __image: { data, mimeType: 'image/jpeg' }, width: c.width, height: c.height, ...(view ? { view } : {}) }
  },

  undo() { return { undone: !!undo() } },
  redo() { return { redone: !!redo() } },
}

/** Run one tool call; always resolves to { ok, result } or { ok: false, error }. */
export async function callTool(name, args) {
  const fn = TOOLS[name]
  if (!fn) return { ok: false, error: `Unknown tool "${name}".` }
  try {
    return { ok: true, result: await fn(args ?? {}) }
  } catch (e) {
    return { ok: false, error: e instanceof ToolError ? e.message : `${name} failed: ${e?.message ?? e}` }
  }
}
