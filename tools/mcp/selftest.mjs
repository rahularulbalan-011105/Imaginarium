// End-to-end check of the Constructa MCP server: start it exactly like Claude
// does (stdio), open the editor with ?mcp in a headless browser, then drive it
// through the MCP tools — add an Arduino + servo, wire them, run a sketch, read
// Serial, take a screenshot, undo.
//
//   npm run dev                       (in another terminal)
//   node tools/mcp/selftest.mjs       [--shot out.jpg]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const URL = process.env.DEV_URL ?? 'http://localhost:5173/Imaginarium/'
const PORT = process.env.CONSTRUCTA_MCP_PORT ?? '7349'          // not the default, so a running Claude session isn't disturbed
const shotArg = process.argv.indexOf('--shot')
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }

const client = new Client({ name: 'constructa-selftest', version: '1.0.0' })
await client.connect(new StdioClientTransport({
  command: process.execPath, args: ['tools/mcp/constructa-mcp.mjs'],
  env: { ...process.env, CONSTRUCTA_MCP_PORT: PORT }, stderr: 'inherit',
}))
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content.find((c) => c.type === 'text')?.text ?? ''
  let json = null; try { json = JSON.parse(text) } catch { /* error text */ }
  return { r, text, json, image: r.content.find((c) => c.type === 'image') }
}

const tools = (await client.listTools()).tools.map((t) => t.name)
check(tools.includes('add_part') && tools.includes('run_code') && tools.includes('screenshot'), `server lists ${tools.length} tools`)
const before = await call('get_scene')
check(before.r.isError && /not connected/i.test(before.text), 'tools explain how to connect while no editor is open')

let browser
for (const ch of ['msedge', 'chrome', undefined]) { try { browser = await chromium.launch(ch ? { channel: ch } : {}); break } catch { /* next */ } }
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(`${URL}?mcp=${PORT}`, { waitUntil: 'load' })
let status
for (let i = 0; i < 60; i++) { status = (await call('constructa_status')).json; if (status?.connected) break; await new Promise((r) => setTimeout(r, 500)) }
check(status?.connected, 'editor connected to the MCP server')
await page.waitForTimeout(1500)
check(/Claude connected/.test(await page.locator('body').innerText()), 'status bar shows "Claude connected"')

const cat = (await call('list_parts')).json
check(cat?.electronics?.some((p) => p.type === 'tft28') && cat.shapes.includes('box'), `catalog: ${cat?.electronics?.length} electronics + ${cat?.shapes?.length} shapes`)

const uno = (await call('add_part', { type: 'arduino', name: 'Uno' })).json
const servo = (await call('add_part', { type: 'servo', variant: 'sg90', name: 'Arm', position: { x: 6, y: 0.15, z: 3 }, rotation_deg: { y: 90 } })).json
check(uno?.name === 'Uno' && servo?.name === 'Arm', 'added an Arduino and an SG90 servo by name')
check(Math.abs((servo?.rotation_deg?.y ?? 0) - 90) < 0.01, 'rotation round-trips in degrees')
const bad = await call('add_part', { type: 'warp_drive' })
check(bad.r.isError && /list_parts/.test(bad.text), 'unknown part type is refused with a hint')

for (const [a, b] of [['Uno:D9', 'Arm:SIGNAL'], ['Uno:5V', 'Arm:VCC'], ['Uno:GND1', 'Arm:GND']]) {
  const w = await call('connect', { from: a, to: b })
  check(!w.r.isError, `wired ${a} → ${b}`)
}
const dup = await call('connect', { from: 'Uno:D9', to: 'Arm:SIGNAL' })
check(dup.r.isError, 'duplicate wire refused')
const badPin = await call('connect', { from: 'Uno:D99', to: 'Arm:SIGNAL' })
check(badPin.r.isError && /Its pins/.test(badPin.text), 'unknown pin refused, listing the real pins')
const pins = (await call('get_pins', { part: 'Arm' })).json
check(pins?.pins?.find((p) => p.pin === 'SIGNAL')?.wired_to === 'Uno:D9', 'get_pins reports what each pin is wired to')

const broken = (await call('check_code', { code: 'void setup() { pinMode(9, OUTPUT) }\nvoid loop() {}' })).json
check(broken && !broken.ok && broken.errors.length > 0, `check_code finds the missing ';' (${broken?.errors?.[0]?.message})`)

const sketch = `#include <Servo.h>
Servo arm;
void setup() {
  Serial.begin(9600);
  arm.attach(9);
  Serial.println("hello from claude");
}
void loop() {
  arm.write(30);  delay(300);
  arm.write(150); delay(300);
  Serial.println("swing");
}`
const run = (await call('run_code', { code: sketch, wait_ms: 2500 })).json
check(run?.running && /hello from claude/.test(run?.serial ?? ''), `run_code runs the sketch and returns Serial (${JSON.stringify((run?.serial ?? '').slice(0, 40))})`)
const ser = (await call('get_serial')).json
check(/swing/.test(ser?.serial ?? ''), 'get_serial keeps collecting while it runs')
await page.locator('nav[aria-label="Main navigation"] button[aria-label="CODE"]').first().click().catch(() => {})
await page.locator('button', { hasText: 'C++ Coding' }).first().click().catch(() => {})   // CODE opens on Block Coding
await page.waitForTimeout(800)
check(/hello from claude/.test(await page.locator('body').innerText()), 'the Code panel\'s Serial monitor shows the same output')
check(!(await call('stop_code')).r.isError, 'stop_code')

const shot = await call('screenshot', { view: 'home' })
check(shot.image?.mimeType === 'image/jpeg' && shot.image.data.length > 5000, `screenshot returns an image (${shot.json?.width}×${shot.json?.height})`)
if (shotArg > 0 && shot.image) writeFileSync(process.argv[shotArg + 1], Buffer.from(shot.image.data, 'base64'))

const scene1 = (await call('get_scene')).json
check(scene1?.parts?.length === 2 && scene1.wires.length === 3, `get_scene: ${scene1?.parts?.length} parts, ${scene1?.wires?.length} wires`)
await call('undo')
const scene2 = (await call('get_scene')).json
check(scene2?.wires?.length === 2, 'undo removes the last wire')
const del = await call('delete_part', { part: 'Arm' })
const scene3 = (await call('get_scene')).json
check(!del.r.isError && scene3.parts.length === 1 && scene3.wires.length === 0, 'delete_part removes the part and its wires')

await browser.close()
await client.close()
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
