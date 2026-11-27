// Is the Claude (MCP) bridge switched on in this browser?
//
// Off by default. Opening Constructa once with `?mcp` (or `?mcp=7341` for a
// non-default port) switches it on and remembers it; `?mcp=0` switches it off.
// Kept tiny and dependency-free so the startup bundle only pays for this check —
// the bridge itself is a lazy chunk (src/mcp/mcpBridge.js).
const KEY = 'constructa.mcp.v1'
export const DEFAULT_MCP_PORT = 7341

export function readMcpSetting() {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { /* private mode etc. */ }
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.has('mcp')) {
      const v = q.get('mcp')
      saved = v === '0' || v === 'off' ? { enabled: false } : { enabled: true, port: Number(v) > 0 ? Number(v) : DEFAULT_MCP_PORT }
      try { localStorage.setItem(KEY, JSON.stringify(saved)) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { enabled: !!saved?.enabled, port: saved?.port ?? DEFAULT_MCP_PORT }
}

export function saveMcpSetting(setting) {
  try { localStorage.setItem(KEY, JSON.stringify(setting)) } catch { /* ignore */ }
}
