import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// CompilerOutput — Arduino-IDE / PlatformIO-style compiler report panel.
//
// Renders the result of analyzeArduino(): a red failure list (errors first, then
// warnings), or a green "Compilation Successful" summary with build stats. Each
// diagnostic shows type · file:line:col · message · code snippet with a caret
// under the offending token · suggestion · expandable explanation, and is
// clickable to jump to its location in the editor.
//
// Purely presentational — reused by CodeEditor and BlocksPanel.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_TITLE = {
  'missing-semicolon': 'Syntax Error', 'missing-bracket': 'Syntax Error', 'unmatched-bracket': 'Syntax Error',
  'mismatched-bracket': 'Syntax Error', 'unterminated-string': 'Syntax Error', 'unterminated-char': 'Syntax Error',
  'empty-char': 'Syntax Error', 'unterminated-comment': 'Syntax Error', 'invalid-number': 'Syntax Error', 'stray-char': 'Syntax Error',
  'unknown-function': 'Undeclared Identifier', 'unknown-identifier': 'Undeclared Identifier',
  'arg-count': 'Argument Error', 'type-mismatch': 'Type Error',
  'invalid-pin': 'Pin Error', 'board-mismatch': 'Board Error',
  'duplicate-function': 'Redeclaration', 'duplicate-variable': 'Redeclaration',
  'invalid-include': 'Include Error', 'unknown-include': 'Include Warning',
  'assign-in-condition': 'Warning', 'div-zero': 'Warning', 'always-true': 'Warning',
  'infinite-loop': 'Warning', 'unused-variable': 'Warning', 'dead-code': 'Warning',
}
const titleFor = (d) => KIND_TITLE[d.kind] || (d.severity === 'warning' ? 'Warning' : 'Error')

function DiagCard({ d, onJump }) {
  const [open, setOpen] = useState(false)
  const isErr = d.severity === 'error'
  const c = isErr
    ? { bar: '#ef4444', bg: 'rgba(127,29,29,0.22)', border: 'rgba(185,28,28,0.5)', tint: '#fca5a5', icon: '✕' }
    : { bar: '#f59e0b', bg: 'rgba(120,80,10,0.20)', border: 'rgba(180,120,20,0.5)', tint: '#fcd34d', icon: '⚠' }
  const gutter = `${d.line} | `
  return (
    <div style={{ borderLeft: `3px solid ${c.bar}`, background: c.bg, border: `1px solid ${c.border}`, borderLeftWidth: 3, borderRadius: 6, padding: '6px 8px', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ color: c.bar, fontWeight: 800 }}>{c.icon}</span>
        <span style={{ color: c.tint, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>{titleFor(d)}</span>
        <button
          onClick={() => onJump?.(d.line, d.col)}
          title="Jump to this line"
          style={{ fontFamily: 'monospace', fontSize: 10, color: '#93c5fd', background: 'none', border: 'none', cursor: onJump ? 'pointer' : 'default', textDecoration: onJump ? 'underline' : 'none', padding: 0 }}
        >
          {d.file}:{d.line}:{d.col}
        </button>
        {(d.explain) && (
          <button onClick={() => setOpen(o => !o)} style={{ marginLeft: 'auto', fontSize: 9, color: 'rgb(var(--g-500))', background: 'none', border: 'none', cursor: 'pointer' }}>
            {open ? '▾ details' : '▸ details'}
          </button>
        )}
      </div>
      <div style={{ color: isErr ? '#fecaca' : '#fde68a', fontSize: 11, marginTop: 3, lineHeight: 1.35 }}>{d.message}</div>
      {d.snippet != null && (
        <pre style={{ margin: '5px 0 0', fontFamily: "'Fira Code','Consolas',monospace", fontSize: 10.5, color: 'rgb(var(--g-300))', background: 'rgba(0,0,0,0.28)', borderRadius: 4, padding: '5px 7px', overflowX: 'auto', whiteSpace: 'pre' }}>
{gutter}{d.snippet}
{'\n'}{' '.repeat(gutter.length)}<span style={{ color: c.bar }}>{d.caret}</span>
        </pre>
      )}
      {d.suggestion && (
        <div style={{ fontSize: 10.5, color: '#86efac', marginTop: 4 }}>💡 {d.suggestion}</div>
      )}
      {open && d.explain && (
        <div style={{ fontSize: 10, color: 'rgb(var(--g-400))', marginTop: 4, lineHeight: 1.4, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 4 }}>{d.explain}</div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 5, padding: '4px 7px', minWidth: 62 }}>
      <div style={{ fontSize: 8.5, color: 'rgb(var(--g-500))', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--g-200))' }}>{value}</div>
    </div>
  )
}

export default function CompilerOutput({ result, onJump }) {
  if (!result) return null
  const { errors = [], warnings = [], stats } = result
  const failed = errors.length > 0

  return (
    <div style={{ maxHeight: 260, overflowY: 'auto' }} className="mx-3 mb-2 shrink-0">
      {failed ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f87171', fontWeight: 700, fontSize: 11, marginBottom: 6 }}>
          <span>✕</span> Compilation failed — {errors.length} error{errors.length === 1 ? '' : 's'}
          {warnings.length > 0 && <span style={{ color: '#fbbf24' }}>· {warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>}
        </div>
      ) : (
        <div style={{ border: '1px solid rgba(22,163,74,0.5)', background: 'rgba(20,83,45,0.2)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
            <span>✓</span> Compilation Successful
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#86efac', fontWeight: 600 }}>Ready to Execute ▶</span>
          </div>
          {stats && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Stat label="Lines" value={stats.lines} />
              <Stat label="Functions" value={stats.functions} />
              <Stat label="Variables" value={stats.variables} />
              <Stat label="Libraries" value={stats.libraries} />
              <Stat label="Warnings" value={stats.warnings} />
              <Stat label="Time" value={`${stats.timeMs} ms`} />
            </div>
          )}
        </div>
      )}

      {errors.map((d, i) => <DiagCard key={'e' + i} d={d} onJump={onJump} />)}
      {warnings.map((d, i) => <DiagCard key={'w' + i} d={d} onJump={onJump} />)}
    </div>
  )
}
