// Bundle / asset regression budget. Run after `npm run build`:
//   npm run check:bundle
// Fails (exit 1) when the startup JS grows past budget, when a heavy library
// leaks back into the startup path, or when the shipped models bloat.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'dist'
const BUDGET = {
  startupJsGzKB: 470,        // everything index.html loads before the workspace (measured 434 KB)
  modelsTotalMB: 12,         // public/models after tools/optimize-models.mjs (measured 8.2 MB)
  modelMaxMB: 3,             // any single GLB
}
// Chunks that must stay lazy (loaded on demand, never at startup).
const LAZY = ['BlocksPanel', 'rapier', 'ArticulatedSession', 'PhysicsPanel']

if (!existsSync(join(DIST, 'index.html'))) { console.error('dist/index.html missing — run `npm run build` first'); process.exit(1) }
const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="[^"]*\/(assets\/[^"]+\.js)"/g)].map(m => m[1])
const assets = readdirSync(join(DIST, 'assets'))
const fails = []
const kb = (n) => (n / 1024).toFixed(1)

let startupGz = 0
for (const f of initial) {
  const gz = gzipSync(readFileSync(join(DIST, f))).length
  startupGz += gz
  console.log(`startup  ${f.padEnd(44)} ${kb(gz).padStart(7)} KB gz`)
  const leaked = LAZY.find(n => f.includes(n))
  if (leaked) fails.push(`${leaked} is loaded at startup (${f})`)
}
console.log(`startup JS total: ${kb(startupGz)} KB gz (budget ${BUDGET.startupJsGzKB})`)
if (startupGz / 1024 > BUDGET.startupJsGzKB) fails.push(`startup JS ${kb(startupGz)} KB gz > ${BUDGET.startupJsGzKB} KB`)
for (const n of LAZY) if (!assets.some(a => a.startsWith(n + '-') && a.endsWith('.js'))) fails.push(`lazy chunk "${n}" not found — was it merged into main?`)

const modelsDir = join(DIST, 'models')
if (existsSync(modelsDir)) {
  let total = 0
  for (const f of readdirSync(modelsDir).filter(f => f.endsWith('.glb'))) {
    const s = statSync(join(modelsDir, f)).size
    total += s
    if (s / 1048576 > BUDGET.modelMaxMB) fails.push(`models/${f} is ${(s / 1048576).toFixed(1)} MB > ${BUDGET.modelMaxMB} MB (run node tools/optimize-models.mjs)`)
  }
  console.log(`models total: ${(total / 1048576).toFixed(1)} MB (budget ${BUDGET.modelsTotalMB})`)
  if (total / 1048576 > BUDGET.modelsTotalMB) fails.push(`models total ${(total / 1048576).toFixed(1)} MB > ${BUDGET.modelsTotalMB} MB`)
}

if (fails.length) { console.error('\nBUDGET FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('\nBudget OK')
