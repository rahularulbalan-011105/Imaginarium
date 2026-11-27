#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Constructa MCP server — lets Claude (Claude Desktop, Claude Code, any MCP
// client) build in an open Constructa editor: read the scene, add parts, wire
// pins, write + run Arduino/ESP32 sketches, read Serial, take screenshots.
//
//   Claude ──MCP over stdio──▶ this process ──ws://127.0.0.1:7341──▶ Constructa tab
//
// The editor connects to us (a web page cannot listen), once it has been opened
// with `?mcp` in the URL. Each tool call is forwarded to the tab and executed by
// src/mcp/tools.js against the live stores — the same actions as the UI, each
// one undoable. Setup: docs/MCP.md.
//
// Env: CONSTRUCTA_MCP_PORT (default 7341)
//      CONSTRUCTA_MCP_ORIGINS  extra allowed page origins, comma-separated
// stdout is the MCP channel — log ONLY to stderr.
// ─────────────────────────────────────────────────────────────────────────────
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WebSocketServer } from 'ws'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.CONSTRUCTA_MCP_PORT) || 7341
const log = (...a) => console.error('[constructa-mcp]', ...a)

// Only Constructa pages may attach: a random website open in the same browser
// must not be able to receive Claude's tool calls. Non-browser clients send no
// Origin and are refused too.
const ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
  /^https:\/\/constructa\.atumx\.in$/,
  /^file:\/\/$/, /^null$/,                                   // Electron shell
  ...String(process.env.CONSTRUCTA_MCP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((o) => new RegExp(`^${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
]
const originOk = (o) => !!o && ORIGINS.some((re) => re.test(o))

// ── Bridge to the editor tab ─────────────────────────────────────────────────
let tab = null              // the one connected editor (newest wins)
let tabUrl = null
let listenError = null
const pending = new Map()   // id → { resolve, timer }

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, verifyClient: ({ origin }) => originOk(origin) })
wss.on('listening', () => log(`waiting for Constructa on ws://127.0.0.1:${PORT}`))
wss.on('error', (e) => {
  listenError = e.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use — probably another Constructa MCP server (e.g. Claude Desktop and Claude Code both running it). Close the other one, or set CONSTRUCTA_MCP_PORT and open Constructa with ?mcp=<port>.`
    : `Bridge failed: ${e.message}`
  log(listenError)
})
wss.on('connection', (sock) => {
  if (tab) { try { tab.close(4001, 'replaced by a newer Constructa tab') } catch { /* ignore */ } }
  tab = sock; tabUrl = null
  log('Constructa connected')
  sock.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch { return }
    if (msg.type === 'hello') { tabUrl = msg.url; return }
    if (msg.type === 'result' && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg)
    }
  })
  sock.on('close', () => {
    if (tab !== sock) return
    tab = null; log('Constructa disconnected')
    for (const [id, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'Constructa disconnected (tab closed or reloaded) during the call.' }); pending.delete(id) }
  })
})

const NOT_CONNECTED = () => listenError ?? (
  'Constructa is not connected. Open the editor with ?mcp in the address, e.g. ' +
  `http://localhost:5173/Imaginarium/?mcp (or https://constructa.atumx.in/?mcp)${PORT !== 7341 ? ` — use ?mcp=${PORT}` : ''}. ` +
  'The status bar shows "Claude connected" when it is linked. Then retry.')

function callTab(tool, args, timeoutMs = 45000) {
  if (!tab || tab.readyState !== 1) return Promise.resolve({ ok: false, error: NOT_CONNECTED() })
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: `${tool} timed out after ${timeoutMs / 1000}s.` }) }, timeoutMs)
    pending.set(id, { resolve, timer })
    tab.send(JSON.stringify({ type: 'call', id, tool, args }))
  })
}

// Tab reply → MCP tool result.
function toResult(res) {
  if (!res.ok) return { isError: true, content: [{ type: 'text', text: res.error }] }
  const { __image, ...rest } = res.result ?? {}
  const content = []
  if (__image) content.push({ type: 'image', data: __image.data, mimeType: __image.mimeType })
  content.push({ type: 'text', text: JSON.stringify(rest, null, 2) })
  return { content }
}

// ── Tools ────────────────────────────────────────────────────────────────────
const server = new McpServer({ name: 'constructa', version: '1.0.0' }, {
  instructions: [
    'Constructa is a browser 3D robotics studio: CAD shapes, electronics (Arduino Uno, ESP32, SUBO boards, servos, motors, sensors, displays, drivers), wiring, and an Arduino C++ simulator.',
    'Units: 1 scene unit = 1 cm; +y is up; rotations are in degrees. Parts are referred to by name (e.g. "Arduino_1") or id.',
    'Typical flow: get_scene → list_parts → add_part → get_pins → connect → set_code / check_code → run_code → get_serial / screenshot.',
    'Every edit is undoable by the user (Ctrl+Z) and by the undo tool. Wire power and ground as well as signals: VCC/5V to the board supply and GND to GND.',
  ].join('\n'),
})

const xyz = z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() })
const partRef = z.string().describe('Part name (e.g. "Arduino_1") or id, as given by get_scene')
const reg = (name, description, inputSchema, timeoutMs) =>
  server.registerTool(name, { description, inputSchema }, async (args) => toResult(await callTool(name, args, timeoutMs)))
const callTool = (name, args, timeoutMs) => callTab(name, args, timeoutMs)

server.registerTool('constructa_status', {
  description: 'Check whether an open Constructa editor is linked to this server.',
  inputSchema: {},
}, async () => ({ content: [{ type: 'text', text: JSON.stringify(
  tab ? { connected: true, editor: tabUrl } : { connected: false, how_to_connect: NOT_CONNECTED() }, null, 2) }] }))

reg('get_scene', 'Everything in the open project: parts (id, name, type, position cm, rotation degrees, pins), wires, which board the code compiles for, and whether a sketch / the simulator is running.', {})
reg('list_parts', 'Catalog of parts that add_part accepts: electronics (type, optional variant, description, pin names) and plain CAD shapes.', {})
reg('add_part', 'Add a part to the scene. Electronics load their real 3D model and pins. Returns the new part with its name and pins.', {
  type: z.string().describe('Part type from list_parts, e.g. "arduino", "esp32", "servo", "tft28", "box"'),
  variant: z.string().optional().describe('Variant from list_parts, e.g. "sg90" for a servo'),
  name: z.string().optional().describe('Name to give it (default: auto, e.g. Servo_2)'),
  position: xyz.optional().describe('Position in cm; default: a free spot for that kind of part'),
  rotation_deg: xyz.optional(),
})
reg('update_part', 'Move, rotate, rename, recolour, set the physics weight of, or (plain shapes only) scale a part. Omitted fields are unchanged. An attached part keeps its mounted transform: detach_part it first to move or scale it.', {
  part: partRef,
  name: z.string().optional(),
  position: xyz.optional().describe('cm'),
  rotation_deg: xyz.optional(),
  scale: xyz.optional(),
  color: z.string().optional().describe('CSS hex colour, e.g. "#ff8800"'),
  mass_kg: z.number().positive().nullable().optional().describe('Physics weight override in kg (Physics → Body → mass). Use it for hollow / 3D-printed parts, which weigh far less than the solid-volume estimate. null = back to the estimate.'),
})
reg('attach_part', 'Fix a part onto a servo horn or motor shaft exactly where it is now, so it turns with that joint (a limb on a servo, a wheel on a motor). Chains are fine: attach the knee servo to the hip servo, then the shin to the knee servo. get_scene shows attached_to.', {
  part: partRef.describe('The part to mount, e.g. "Thigh_L"'),
  to: z.string().describe('The servo / motor / stepper it rides on, e.g. "Hip_L"'),
})
reg('detach_part', 'Undo attach_part: free a part from the horn or shaft it is mounted on, leaving it where it is.', { part: partRef })
reg('delete_part', 'Remove a part and every wire attached to it.', { part: partRef })
reg('get_pins', 'A part\'s pins, each with its role (power / gnd / signal) and what it is wired to.', { part: partRef })
reg('connect', 'Wire one pin to another, e.g. from "Arduino_1:D9" to "Servo_1:SIGNAL".', {
  from: z.string().describe('"<part>:<PIN>"'),
  to: z.string().describe('"<part>:<PIN>"'),
})
reg('disconnect', 'Remove a wire, by its id (from get_scene) or by its end pin(s).', {
  wire: z.string().optional(),
  from: z.string().optional().describe('"<part>:<PIN>" — removes the wire on this pin (to: narrows it)'),
  to: z.string().optional(),
})
reg('get_code', 'The sketch currently in the code editor, and the board it compiles for.', {})
reg('set_code', 'Replace the sketch in the code editor (Arduino C++). Returns a compile check.', { code: z.string() })
reg('check_code', 'Compile-check a sketch (default: the one in the editor) the way Run does: errors with line/column and suggestions, and warnings.', {
  code: z.string().optional(),
})
reg('run_code', 'Compile and run the sketch (optionally replacing it first) in the simulator, wait, then return the Serial output so far. Stops a sketch that is already running. A robot with servos/motors enters the physics simulator automatically.', {
  code: z.string().optional(),
  wait_ms: z.number().int().min(0).max(15000).optional().describe('How long to let it run before reporting (default 2000)'),
}, 60000)
reg('stop_code', 'Stop the running sketch.', {})
reg('get_serial', 'Serial monitor output of the running (or last) sketch, plus any runtime error.', {
  clear: z.boolean().optional().describe('Clear the buffer after reading'),
})
reg('screenshot', 'Image of the 3D viewport. Optionally snap the camera to a view first.', {
  view: z.enum(['home', 'top', 'front', 'back', 'left', 'right', 'bottom']).optional(),
  max_width: z.number().int().min(256).max(2048).optional(),
})
reg('undo', 'Undo the last edit (the same as Ctrl+Z in the editor).', {})
reg('redo', 'Redo the last undone edit.', {})

await server.connect(new StdioServerTransport())
log('MCP server ready (stdio)')

const shutdown = () => { try { wss.close() } catch { /* ignore */ } process.exit(0) }
process.stdin.on('close', shutdown)
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
