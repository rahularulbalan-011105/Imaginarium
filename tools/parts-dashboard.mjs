#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Parts test dashboard — `npm run test:dashboard`
//
// Runs the whole vitest suite with the JSON reporter, then joins the results
// with the Tinkercad catalogue (src/parts/tinkercadCatalog.js) into ONE static
// page: docs/parts-test-dashboard.html.
//
// Statuses are read from real test results, never assumed:
//   PASS        the aspect's test(s) ran and passed
//   FAIL        at least one of the aspect's tests failed
//   NOT TESTED  the aspect applies but has no test (an it.todo), or the
//               catalogue item is not implemented yet
//   N/A         the aspect does not apply (e.g. code generation for a resistor)
//
// Catalogue tests: tests/parts/catalog.test.js (describe "part:<type> | label |
// category | tinkercad", tests "model" "pins" "placement" "wiring"
// "simulation: …" "codegen: …" "saveload"). 3D shapes/tools:
// tests/shapes/*.test.js (describe "shape:<Tinkercad name>" / "tool:<name>").
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(tmpdir(), `constructa-vitest-${process.pid}.json`)
try {
  execSync(`npx vitest run --reporter=json --outputFile="${out}"`, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
} catch { /* failing tests still write the report */ }
const report = JSON.parse(readFileSync(out, 'utf8'))
const { TINKERCAD_CATALOG } = await import(pathToFileURL(join(root, 'src/parts/tinkercadCatalog.js')).href)

const ASPECTS = ['model', 'placement', 'pins', 'wiring', 'simulation', 'codegen', 'saveload']
const ASPECT_LABEL = { model: 'Model rendering', placement: 'Placement & editing', pins: 'Pin configuration', wiring: 'Wiring', simulation: 'Simulation', codegen: 'Code generation', saveload: 'Save & load' }

// Collect results per group (describe title) and aspect.
const groups = new Map()           // title → { aspects: {aspect: [status…]}, tests: [...] }
let suiteTotals = { passed: 0, failed: 0, todo: 0, files: 0, failedFiles: [] }
for (const file of report.testResults) {
  suiteTotals.files++
  if (file.status === 'failed') suiteTotals.failedFiles.push(file.name.replace(/^.*[\\/]tests[\\/]/, 'tests/'))
  for (const t of file.assertionResults) {
    if (t.status === 'passed') suiteTotals.passed++
    else if (t.status === 'failed') suiteTotals.failed++
    else suiteTotals.todo++
    const title = t.ancestorTitles?.[0]
    if (!title) continue
    if (!groups.has(title)) groups.set(title, { aspects: {}, tests: [] })
    const g = groups.get(title)
    const aspect = t.title.split(':')[0].trim()
    ;(g.aspects[aspect] ??= []).push(t.status)
    g.tests.push({ title: t.title, status: t.status, msg: (t.failureMessages ?? []).join('\n').split('\n')[0] })
  }
}
const statusOf = (list) => {
  if (!list?.length) return 'NA'
  if (list.includes('failed')) return 'FAIL'
  if (list.every(s => s === 'passed')) return 'PASS'
  if (list.some(s => s === 'passed')) return list.some(s => s === 'todo' || s === 'pending' || s === 'skipped') ? 'PARTIAL' : 'PASS'
  return 'NOT TESTED'
}

// Catalogue parts from describe titles.
const parts = []
for (const [title, g] of groups) {
  const m = title.match(/^part:(\S+) \| (.*?) \| (\S+) \| (.*)$/)
  if (m) parts.push({ type: m[1], label: m[2], category: m[3], tinkercad: m[4], g })
}
const byTinkercad = new Map()
for (const p of parts) for (const n of p.tinkercad.split(/\s*;\s*/)) byTinkercad.set(n, [...(byTinkercad.get(n) ?? []), p])

const rows = TINKERCAD_CATALOG.map((e) => {
  // An entry is credited through its official name or any of its `match` names.
  const names = [e.name, ...(e.match ?? [])]
  const impl = [...new Set(names.flatMap(n => byTinkercad.get(n) ?? []))]
  // 3D items read shape:/tool: groups; pre-existing circuit parts read legacy: groups.
  const keys = names.flatMap(n => [`shape:${n}`, `tool:${n}`, `legacy:${n}`])
  const found = keys.map(k => groups.get(k)).filter(Boolean)
  const sg = found.length ? { aspects: Object.fromEntries(ASPECTS.map(a => [a, found.flatMap(g => g.aspects[a] ?? [])])), tests: found.flatMap(g => g.tests) } : null
  let kind, aspects
  if (impl.length) {
    kind = 'catalogue'
    aspects = Object.fromEntries(ASPECTS.map(a => [a, statusOf(impl.flatMap(p => p.g.aspects[a] ?? []))]))
  } else if (sg) {
    kind = 'tested'
    aspects = Object.fromEntries(ASPECTS.map(a => [a, statusOf(sg.aspects[a])]))
  } else if (e.legacy) {
    kind = 'existing'
    aspects = Object.fromEntries(ASPECTS.map(a => [a, 'NOT TESTED']))
  } else {
    kind = 'missing'
    aspects = Object.fromEntries(ASPECTS.map(a => [a, 'NOT TESTED']))
  }
  const tests = impl.flatMap(p => p.g.tests.map(t => ({ ...t, title: `${p.type} › ${t.title}` }))).concat(sg?.tests ?? [])
  return { ...e, kind, aspects, impl: impl.map(p => p.type), tests }
})
// Catalogue parts that are not in the Tinkercad list (Constructa extras).
const extras = parts.filter(p => !TINKERCAD_CATALOG.some(e => !e.extra && [e.name, ...(e.match ?? [])].some(n => p.tinkercad.split(/\s*;\s*/).includes(n))))

// Coverage counts only official Tinkercad entries; Constructa extras are listed but never counted.
const official = rows.filter(r => !r.extra)
const counts = { total: official.length, done: official.filter(r => r.kind === 'catalogue' || r.kind === 'tested').length,
  existing: official.filter(r => r.kind === 'existing').length, missing: official.filter(r => r.kind === 'missing').length,
  circuits: official.filter(r => r.area === 'circuits').length, circuitsDone: official.filter(r => r.area === 'circuits' && (r.kind === 'catalogue' || r.kind === 'tested')).length,
  d3: official.filter(r => r.area === '3d').length, d3Done: official.filter(r => r.area === '3d' && (r.kind === 'catalogue' || r.kind === 'tested')).length }
let cells = { PASS: 0, FAIL: 0, 'NOT TESTED': 0, PARTIAL: 0, NA: 0 }
for (const r of official) for (const a of ASPECTS) cells[r.aspects[a]]++

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const badge = (s) => `<span class="b b-${s.replace(' ', '')}">${s === 'NA' ? 'N/A' : s}</span>`
const KIND = { catalogue: 'Implemented', tested: 'Implemented', existing: 'Pre-existing (no contract test)', missing: 'Not implemented' }

const rowHtml = (r) => `
<tr class="k-${r.kind}" data-area="${r.area}" data-kind="${r.kind}" data-text="${esc((r.name + ' ' + r.group + ' ' + r.impl.join(' ')).toLowerCase())}">
  <td><div class="nm">${esc(r.name)}${r.verify ? ' <span class="vf" title="Least certain catalogue entry — check against Tinkercad\'s in-app search">verify</span>' : ''}</div>
      <div class="sub">${esc(r.group)}${r.impl.length ? ' · <code>' + r.impl.map(esc).join('</code> <code>') + '</code>' : r.legacy ? ' · <code>' + r.legacy.map(esc).join('</code> <code>') + '</code>' : ''}</div></td>
  <td><span class="kind">${KIND[r.kind]}</span></td>
  ${ASPECTS.map(a => `<td>${badge(r.aspects[a])}</td>`).join('')}
  <td>${r.tests.length ? `<details><summary>${r.tests.length}</summary><ul>${r.tests.map(t => `<li class="t-${t.status}">${esc(t.title)}${t.msg ? `<div class="err">${esc(t.msg)}</div>` : ''}</li>`).join('')}</ul></details>` : '—'}</td>
</tr>`

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parts Test Dashboard</title>
<style>
:root { --bg:#f7f7f5; --fg:#1c1c1a; --mute:#6b6b66; --line:#e2e2dd; --card:#ffffff;
  --pass:#15803d; --passbg:#dcfce7; --fail:#b91c1c; --failbg:#fee2e2; --nt:#92400e; --ntbg:#fef3c7; --na:#6b6b66; --nabg:#efefec; --acc:#ea580c; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141413; --fg:#ececea; --mute:#9a9a94; --line:#2c2c2a; --card:#1c1c1b;
  --pass:#4ade80; --passbg:#14321f; --fail:#f87171; --failbg:#3b1515; --nt:#fbbf24; --ntbg:#3a2a0b; --na:#9a9a94; --nabg:#262624; } }
:root[data-theme="dark"] { --bg:#141413; --fg:#ececea; --mute:#9a9a94; --line:#2c2c2a; --card:#1c1c1b;
  --pass:#4ade80; --passbg:#14321f; --fail:#f87171; --failbg:#3b1515; --nt:#fbbf24; --ntbg:#3a2a0b; --na:#9a9a94; --nabg:#262624; }
* { box-sizing: border-box } body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 48px }
h1 { font-size: 22px; margin: 0 0 4px } .lede { color: var(--mute); margin: 0 0 20px; max-width: 78ch }
.stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px }
.stat b { display:block; font-size: 22px; font-variant-numeric: tabular-nums } .stat span { color:var(--mute); font-size:12px }
.bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin: 8px 0 12px }
.bar input { flex: 1 1 220px; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--fg) }
.bar button { padding:6px 10px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; font-size:12px }
.bar button[aria-pressed="true"] { border-color: var(--acc); color: var(--acc) }
.wrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--card) }
table { border-collapse: collapse; width:100%; min-width: 980px } th, td { padding: 8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align: top }
th { font-size:12px; color:var(--mute); font-weight:600; position: sticky; top: 0; background: var(--card) }
.nm { font-weight:600 } .sub { color:var(--mute); font-size:12px } code { font-size:11px; background:var(--nabg); padding:1px 4px; border-radius:4px }
.kind { font-size:12px } tr.k-missing .kind { color: var(--nt) } tr.k-existing .kind { color: var(--mute) }
.b { display:inline-block; font-size:11px; font-weight:700; padding:2px 7px; border-radius:999px; white-space:nowrap }
.b-PASS { color:var(--pass); background:var(--passbg) } .b-FAIL { color:var(--fail); background:var(--failbg) }
.b-NOTTESTED, .b-PARTIAL { color:var(--nt); background:var(--ntbg) } .b-NA { color:var(--na); background:var(--nabg) }
.vf { font-size:10px; font-weight:600; color:var(--nt); border:1px solid currentColor; border-radius:4px; padding:0 3px }
details summary { cursor:pointer; color: var(--acc) } details ul { margin: 6px 0 0; padding-left: 16px; font-size:12px }
li.t-passed::marker { color: var(--pass) } li.t-failed { color: var(--fail) } li.t-todo { color: var(--nt) }
.err { font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap }
h2 { font-size: 16px; margin: 28px 0 8px } .note { color:var(--mute); font-size:12px; margin-top: 12px; max-width: 90ch }
</style></head>
<body><main>
<h1>Parts test dashboard</h1>
<p class="lede">Every Tinkercad Circuits component and 3D Design shape or tool, against what Constructa implements, with the real result of each automated test. Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from <code>npm run test:dashboard</code>.</p>
<div class="stats">
  <div class="stat"><b>${counts.done} / ${counts.total}</b><span>official Tinkercad items implemented and under test</span></div>
  <div class="stat"><b>${counts.circuitsDone} / ${counts.circuits}</b><span>Circuits components</span></div>
  <div class="stat"><b>${counts.d3Done} / ${counts.d3}</b><span>3D Design shapes and tools</span></div>
  <div class="stat"><b>${counts.existing}</b><span>pre-existing parts (own test suites)</span></div>
  <div class="stat"><b>${counts.missing}</b><span>not implemented yet</span></div>
  <div class="stat"><b>${cells.PASS}</b><span>aspect checks passing</span></div>
  <div class="stat"><b>${cells.FAIL}</b><span>aspect checks failing</span></div>
  <div class="stat"><b>${cells['NOT TESTED'] + cells.PARTIAL}</b><span>aspects not (fully) tested</span></div>
  <div class="stat"><b>${suiteTotals.passed} / ${suiteTotals.passed + suiteTotals.failed}</b><span>tests passing in the whole suite (${suiteTotals.files} files)</span></div>
</div>
<div class="bar">
  <input type="search" id="q" placeholder="Filter by name, group or type…" aria-label="Filter rows">
  <button data-f="all" aria-pressed="true">All</button><button data-f="circuits">Circuits</button><button data-f="3d">3D Design</button>
  <button data-f="missing">Not implemented</button><button data-f="fail">Has failures</button>
</div>
<div class="wrap"><table>
<thead><tr><th>Tinkercad item</th><th>Status</th>${ASPECTS.map(a => `<th>${ASPECT_LABEL[a]}</th>`).join('')}<th>Tests</th></tr></thead>
<tbody id="rows">${rows.map(rowHtml).join('')}</tbody></table></div>
${extras.length ? `<h2>Constructa parts beyond the Tinkercad list</h2><div class="wrap"><table><thead><tr><th>Part</th><th>Category</th>${ASPECTS.map(a => `<th>${ASPECT_LABEL[a]}</th>`).join('')}</tr></thead><tbody>
${extras.map(p => `<tr><td><div class="nm">${esc(p.label)}</div><div class="sub"><code>${esc(p.type)}</code></div></td><td>${esc(p.category)}</td>${ASPECTS.map(a => `<td>${badge(statusOf(p.g.aspects[a]))}</td>`).join('')}</tr>`).join('')}
</tbody></table></div>` : ''}
<p class="note">Pre-existing parts (Arduino, LED, servo, motors, the module sensors …) were built before the catalogue and are covered by their own suites in <code>tests/components</code>, <code>tests/esp32</code> and others${suiteTotals.failedFiles.length ? ` (failing files: ${suiteTotals.failedFiles.map(esc).join(', ')})` : ', all of which pass'}; the per-aspect catalogue contract does not run against them, so their cells read NOT TESTED. "Model rendering" builds each model headlessly and checks its size against the real part's datasheet dimensions; it does not take a GPU screenshot.</p>
</main>
<script>
const q = document.getElementById('q'); let f = 'all'
const apply = () => { const t = q.value.trim().toLowerCase()
  for (const tr of document.querySelectorAll('#rows tr')) {
    const okF = f === 'all' || tr.dataset.area === f || tr.dataset.kind === f || (f === 'fail' && tr.querySelector('.b-FAIL'))
    tr.hidden = !(okF && (!t || tr.dataset.text.includes(t))) } }
q.addEventListener('input', apply)
for (const b of document.querySelectorAll('.bar button')) b.addEventListener('click', () => {
  f = b.dataset.f; for (const x of document.querySelectorAll('.bar button')) x.setAttribute('aria-pressed', String(x === b)); apply() })
</script></body></html>`

mkdirSync(join(root, 'docs'), { recursive: true })
writeFileSync(join(root, 'docs/parts-test-dashboard.html'), html)
console.log(`dashboard: ${counts.done}/${counts.total} implemented (circuits ${counts.circuitsDone}/${counts.circuits}, 3D ${counts.d3Done}/${counts.d3}) · ${cells.PASS} pass · ${cells.FAIL} fail · ${cells['NOT TESTED'] + cells.PARTIAL} not tested → docs/parts-test-dashboard.html`)
if (suiteTotals.failed) process.exitCode = 1
