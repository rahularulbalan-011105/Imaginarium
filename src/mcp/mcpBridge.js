// Connects this Constructa tab to the local Constructa MCP server
// (tools/mcp/constructa-mcp.mjs), which Claude Desktop / Claude Code start.
//
//   Claude ──MCP (stdio)──▶ constructa-mcp ──ws://127.0.0.1:7341──▶ this tab ──▶ src/mcp/tools.js
//
// The server listens; the tab dials out (a page cannot listen for connections).
// Messages are JSON:
//   server → tab  { type: 'call', id, tool, args }
//   tab → server  { type: 'hello', app, url }  /  { type: 'result', id, ok, result | error }
import { callTool } from './tools.js'

let ws = null
let timer = null
let delay = 1000
let stopped = false
let status = 'off'

function setStatus(s) {
  status = s
  window.dispatchEvent(new CustomEvent('constructa:mcp-status', { detail: s }))
}
export function getMcpStatus() { return status }

function connect(port) {
  if (stopped) return
  setStatus('connecting')
  let sock
  try { sock = new WebSocket(`ws://127.0.0.1:${port}`) } catch { return retry(port) }
  ws = sock
  sock.onopen = () => {
    delay = 1000
    setStatus('connected')
    sock.send(JSON.stringify({ type: 'hello', app: 'constructa', url: location.href }))
  }
  sock.onmessage = async (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg?.type !== 'call' || !msg.id) return
    const res = await callTool(msg.tool, msg.args)
    if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'result', id: msg.id, ...res }))
  }
  sock.onclose = (ev) => {
    if (ws === sock) ws = null
    // 4001 = another Constructa tab took over the connection: don't fight it.
    if (ev.code === 4001) { setStatus('replaced'); return }
    retry(port)
  }
  sock.onerror = () => { /* onclose follows */ }
}

function retry(port) {
  if (stopped) return
  setStatus('waiting')                         // server not running yet (Claude not open)
  clearTimeout(timer)
  timer = setTimeout(() => { timer = null; connect(port) }, delay)
  delay = Math.min(delay * 2, 15000)
}

export function startMcpBridge(port) {
  stopped = false
  if (ws || timer) return
  connect(port)
}

// Vite hot-reload re-runs this module (e.g. after an edit to tools.js), and the
// new copy dials in again. Close the old copy's socket quietly first — otherwise
// the server hands the connection to the new copy, the old one gets code 4001
// and the status bar wrongly says "connected in another tab".
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopped = true
    clearTimeout(timer); timer = null
    if (ws) { ws.onclose = null; try { ws.close() } catch { /* ignore */ } ws = null }
  })
}

export function stopMcpBridge() {
  stopped = true
  clearTimeout(timer); timer = null
  if (ws) { try { ws.close() } catch { /* ignore */ } ws = null }
  setStatus('off')
}
