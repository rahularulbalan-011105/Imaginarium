// Every catalogue part's sketch library joins the sandbox runtime (one script).
// It must parse, use only allow-listed message channels, and never reach for
// the page (the sandbox's opaque origin + CSP are the real wall; this keeps the
// libraries honest so a regression is caught in review, not in production).
import { describe, it, expect } from 'vitest'
import { transformSync } from 'esbuild'
import { loadParts, allParts } from '../../src/parts/registry.js'
import { bootstrapHtml, OUT_CALLS } from '../../src/managers/sketchSandbox.js'
import { partSandboxRuntime, partSandboxConsts } from '../../src/circuit/simBridge.js'

await loadParts()
const script = (html) => html.match(/<script>([\s\S]*)<\/script>/)[1]

describe('catalogue sandbox libraries', () => {
  const runtime = partSandboxRuntime()
  it('the combined runtime (all part libraries + consts) is valid JavaScript', () => {
    const html = bootstrapHtml('async function setup(){}\nasync function loop(){ await delay(1) }', partSandboxConsts(), runtime)
    expect(() => transformSync(script(html), { loader: 'js' })).not.toThrow()
  })
  it('libraries only talk to the parent through allow-listed channels', () => {
    const used = new Set([...runtime.matchAll(/send\('([A-Za-z0-9_]+)'/g)].map(m => m[1]))
    expect([...used].filter(n => !OUT_CALLS.has(n))).toEqual([])
  })
  it('no library touches the page, the network or storage', () => {
    for (const p of allParts()) {
      const src = p.code?.sandbox ?? ''
      expect(src, p.type).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|eval|Function|localStorage|indexedDB|document|window|top|opener|importScripts)\b\s*[.(]/)
    }
  })
  it('each library class is defined by exactly one part', () => {
    const owner = new Map()
    for (const p of allParts()) for (const m of (p.code?.sandbox ?? '').matchAll(/^function ([A-Za-z_]\w*)\s*\(/gm)) {
      expect(owner.has(m[1]) ? `${m[1]} defined by ${owner.get(m[1])} and ${p.type}` : null).toBeNull()
      owner.set(m[1], p.type)
    }
  })
})
