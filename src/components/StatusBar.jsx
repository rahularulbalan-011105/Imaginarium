import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useEffect, useState } from 'react'

// Shown only while the Claude (MCP) bridge is switched on (src/mcp/mcpBridge.js).
const MCP_LABEL = {
  connected:  ['Claude connected', 'bg-green-500'],
  connecting: ['Claude: connecting…', 'bg-amber-400'],
  waiting:    ['Claude: waiting for the MCP server', 'bg-gray-500'],
  replaced:   ['Claude: connected in another tab', 'bg-gray-500'],
}
function McpStatus() {
  const [st, setSt] = useState(null)
  useEffect(() => {
    const on = (e) => setSt(e.detail)
    window.addEventListener('constructa:mcp-status', on)
    return () => window.removeEventListener('constructa:mcp-status', on)
  }, [])
  const l = MCP_LABEL[st]
  if (!l) return null
  return (
    <span className="flex items-center gap-1.5" title="Claude can edit this project through the Constructa MCP server (docs/MCP.md)">
      <span className={`w-1.5 h-1.5 rounded-full ${l[1]}`} />
      <span className="text-gray-300">{l[0]}</span>
    </span>
  )
}

export default function StatusBar() {
  const objectCount = useSceneStore((s) => s.objects.length)
  const selectedId = useSceneStore((s) => s.selectedId)
  const selectedObj = useSceneStore((s) => s.objects.find((o) => o.id === selectedId))
  const transformMode = useUiStore((s) => s.transformMode)

  return (
    <div className="flex items-center gap-4 px-4 h-7 text-[11px] text-gray-500 shrink-0"
      style={{ background: 'rgb(var(--g-900))', borderTop: '1px solid rgb(var(--g-700))' }}>
      <span>Objects: <span className="text-gray-300">{objectCount}</span></span>
      {selectedObj ? (
        <>
          <span className="text-gray-600">·</span>
          <span>
            Selected: <span className="text-gray-300">{selectedObj.name}</span>
          </span>
        </>
      ) : (
        <span>No selection</span>
      )}
      <McpStatus />
      <span className="ml-auto">
        W move · E rotate · R scale · F fit · Del delete · Ctrl+Z undo
      </span>
    </div>
  )
}
