// Constructa Analytics dashboard (utm-dashboard.html). Reads the collector's
// cx_events / cx_links tabs (key-protected, JSONP) and renders everything from
// the pure functions in analyze.js.
import { COLLECTOR_ENDPOINT } from '../utils/utmTracking.js'
import { parseRows, resolveIdentities, analyze, linkStats, makeExcluder, buildCampaignUrl, slug, resolveRange } from './analyze.js'
import { createGlobe } from './globe.js'

const $ = (id) => document.getElementById(id)
const KEY_LS = 'cx_dash_key', EXCL_LS = 'cx_dash_exclude'
const ls = { get: (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } } }

let KEY = ls.get(KEY_LS)
let EVENTS = [], LINKS = []
let RESULT = null

// ── data ────────────────────────────────────────────────────────────────────
// The dashboard key is NEVER put in a URL: query strings end up in Google's
// request logs and in Referer headers. Each read carries a timestamp plus
// HMAC-SHA256(timestamp, key); the collector recomputes it and accepts a ±5 min
// window, so a captured signature is useless shortly afterwards.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function signedParams() {
  const ts = String(Date.now())
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return { ts, sig: b64url(await crypto.subtle.sign('HMAC', k, enc.encode(ts))) }
}

// Cookie-free fetch: when the browser is signed in to Google (often several
// accounts), a credentialed request to an Apps Script web app gets an HTML
// sign-in page instead of data. There is deliberately NO JSONP fallback — JSONP
// executes the response as script, which would hand the page to anyone who could
// impersonate the collector.
async function getJson(params) {
  const auth = params.what === 'ping' ? {} : await signedParams()
  const r = await fetch(COLLECTOR_ENDPOINT + '?' + new URLSearchParams({ ...params, ...auth, _: Date.now() }),
    { credentials: 'omit', cache: 'no-store', redirect: 'follow' })
  const text = await r.text()
  try { return JSON.parse(text) } catch {
    throw new Error(`The collector answered with a non-JSON page (HTTP ${r.status}): ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`)
  }
}

async function load() {
  const st = $('gateStatus')
  st.className = 'status'; st.textContent = 'Loading…'
  $('refresh').disabled = true
  try {
    const [ev, lk] = await Promise.all([getJson({ what: 'events' }), getJson({ what: 'links' })])
    if (Array.isArray(ev)) throw new Error('The collector is still the old version — paste docs/utm-collector.gs into Apps Script and deploy a new version.')
    if (!ev.ok) {
      if (ev.error === 'bad key') { const p = await getJson({ what: 'ping' }).catch(() => null); throw new Error(p && !p.keySet ? 'No key set yet — run the "setup" function in Apps Script.' : 'Wrong dashboard key.') }
      throw new Error(ev.error || 'Collector error')
    }
    EVENTS = resolveIdentities(parseRows(ev.headers, ev.rows))
    LINKS = lk.ok ? lk.rows : []
    ls.set(KEY_LS, KEY)
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden'); $('topbar').classList.remove('hidden')
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString()
    fillFilterOptions()
    render()
  } catch (e) {
    $('gate').classList.remove('hidden'); $('app').classList.add('hidden'); $('topbar').classList.add('hidden')
    st.className = 'status err'; st.textContent = e.message
  } finally { $('refresh').disabled = false }
}

// ── formatting ──────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtDate = (ms) => ms ? new Date(ms).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const fmtDur = (s) => { s = Math.round(s || 0); if (!s) return '0m'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : (m ? `${m}m` : `${s}s`) }
const pct = (a, b) => b ? Math.round((a / b) * 100) + '%' : '—'
const num = (n) => (n || 0).toLocaleString()

// ── filters ─────────────────────────────────────────────────────────────────
function opts() {
  const choice = $('f_range').value, custom = choice === 'custom'
  $('f_custom_from').classList.toggle('hidden', !custom)
  $('f_custom_to').classList.toggle('hidden', !custom)
  $('f_to').min = $('f_from').value || ''          // the picker itself refuses an end before the start
  const r = resolveRange(choice, $('f_from').value, $('f_to').value)
  $('f_err').textContent = r.error || ''
  if (r.error) return { error: r.error }
  return { from: r.from, to: r.to, source: $('f_source').value, campaign: $('f_campaign').value, exclude: makeExcluder($('f_exclude').value) }
}

// "1 Oct – 15 Oct 2026" / "Today" … for the copy feedback.
function periodLabel() {
  const sel = $('f_range')
  if (sel.value !== 'custom') return sel.options[sel.selectedIndex].text.toLowerCase()
  const f = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${f($('f_from').value)} – ${f($('f_to').value)}`
}

async function copyNewEmails() {
  const st = $('u_copy_status')
  if (!RESULT) { st.className = 'status err'; st.textContent = 'Fix the date range first.'; return }
  const emails = [...new Set(RESULT.newUsers.map(u => u.email))]    // already unique; belt and braces
  if (!emails.length) { st.className = 'status'; st.textContent = `No new sign-ups in ${periodLabel()} with the current filters — nothing copied.`; return }
  await copy(emails.join('\n'), $('u_copy'))
  st.className = 'status ok'
  st.textContent = `Copied ${emails.length} email${emails.length === 1 ? '' : 's'} (new sign-ups, ${periodLabel()}) — one per line, ready to paste into Excel or Sheets.`
}

function fillFilterOptions() {
  const fill = (sel, values, all) => {
    const cur = sel.value
    sel.innerHTML = `<option value="">${all}</option>` + [...values].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')
    if (values.has(cur)) sel.value = cur
  }
  fill($('f_source'), new Set(EVENTS.filter(e => e.env === 'prod').map(e => e.source)), 'All sources')
  fill($('f_campaign'), new Set(EVENTS.filter(e => e.env === 'prod' && e.campaign).map(e => e.campaign)), 'All campaigns')
}

// ── tables ──────────────────────────────────────────────────────────────────
function table(el, cols, rows, { onClick, sortState } = {}) {
  const st = sortState || {}
  const sorted = st.key ? [...rows].sort((a, b) => {
    const x = a[st.key], y = b[st.key]
    const c = typeof x === 'number' || typeof y === 'number' ? (x ?? -1) - (y ?? -1) : String(x ?? '').localeCompare(String(y ?? ''))
    return st.dir * c
  }) : rows
  el.innerHTML = `<thead><tr>${cols.map(c => `<th class="${c.n ? 'n' : ''}" data-k="${c.k}">${esc(c.t)}${st.key === c.k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>` +
    `<tbody>${sorted.length ? sorted.map((r, i) => `<tr data-i="${i}" class="${onClick ? 'click' : ''}">${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="muted">No data yet.</td></tr>`}</tbody>`
  if (sortState) el.querySelectorAll('th').forEach(th => th.onclick = () => {
    const k = th.dataset.k
    sortState.dir = sortState.key === k ? -sortState.dir : -1
    sortState.key = k
    render()
  })
  if (onClick) el.querySelectorAll('tbody tr[data-i]').forEach(tr => tr.onclick = () => onClick(sorted[Number(tr.dataset.i)]))
}

const sortSources = { key: '', dir: -1 }, sortUsers = { key: '', dir: -1 }, sortLinks = { key: '', dir: -1 }
const sortPlaces = { key: '', dir: -1 }

// ── visitor globe ───────────────────────────────────────────────────────────
let GLOBE = null
function globe() {
  if (GLOBE) return GLOBE
  const tip = $('globeTip')
  GLOBE = createGlobe($('globe'), {
    onHover: (place, at) => {
      if (!place) { tip.style.display = 'none'; return }
      tip.innerHTML = `<b>${esc(place.city)}</b>${place.country && place.country !== place.city ? ', ' + esc(place.country) : ''}`
        + `<br>${num(place.visitors)} visitor${place.visitors === 1 ? '' : 's'} · ${num(place.events)} events`
        + (place.users ? `<br>${num(place.users)} signed-in user${place.users === 1 ? '' : 's'}` : '')
      tip.style.display = 'block'
      // Keep the card inside the stage.
      const stage = tip.parentElement.getBoundingClientRect()
      const w = tip.offsetWidth, h = tip.offsetHeight
      tip.style.left = Math.max(6, Math.min(stage.width - w - 6, at.x + 14)) + 'px'
      tip.style.top = Math.max(6, Math.min(stage.height - h - 6, at.y - h - 12)) + 'px'
    },
  })
  $('g_spin').onchange = (e) => GLOBE.setAutoSpin(e.target.checked)
  return GLOBE
}

function renderPlaces(result) {
  const places = result.places
  const located = result.totals.locatedVisitors
  const total = result.totals.visitors
  globe().setPlaces(places)
  $('globeLegend').textContent = places.length
    ? `${num(places.length)} place${places.length === 1 ? '' : 's'} · ${num(located)} of ${num(total)} visitors located`
    : 'No location data in this period'
  table($('t_places'), [
    { k: 'city', t: 'Place', f: r => `<b>${esc(r.city)}</b>${r.exact ? '' : ' <span class="muted" title="Zone not in the lookup table — positioned by continent">≈</span>'}` },
    { k: 'country', t: 'Country' },
    { k: 'visitors', t: 'Visitors', n: 1, f: r => num(r.visitors) },
    { k: 'users', t: 'Users', n: 1, f: r => num(r.users) },
    { k: 'events', t: 'Events', n: 1, f: r => num(r.events) },
  ], places, { sortState: sortPlaces, onClick: (r) => { $('g_spin').checked = false; globe().focus(r) } })
}

function render() {
  const o = opts()
  $('u_copy_status').textContent = ''
  if (o.error) {
    // Never leave numbers from the previous period on screen (or copyable).
    RESULT = null
    $('u_copy').disabled = true
    $('kpis').innerHTML = `<div class="card"><div class="l">Choose a valid date range to see the numbers.</div></div>`
    for (const id of ['t_sources', 't_users', 't_events', 't_places']) $(id).innerHTML = ''
    if (GLOBE) GLOBE.setPlaces([])
    $('globeLegend').textContent = ''
    $('userCount').textContent = ''
    return
  }
  $('u_copy').disabled = false
  RESULT = analyze(EVENTS, o)
  const { totals: T, sources, users } = RESULT

  $('kpis').innerHTML = [
    ['Visitors', T.visitors, 'unique browsers'],
    ['Landing visits', T.landingVisits, `${pct(T.ctaClicks, T.landingVisits)} clicked “Try free”`],
    ['Sign-ups', T.signups, 'new accounts'],
    ['Workshop users', T.workshopUsers, 'emails that opened the workshop'],
    ['Active builders', T.builders, `${pct(T.builders, T.workshopUsers)} of workshop users`],
    ['Time building', fmtDur(T.activeSecs), T.workshopUsers ? `avg ${fmtDur(T.activeSecs / T.workshopUsers)} / user` : ''],
    ['Code runs', T.codeRuns, `${num(T.sims)} simulations`],
    ['Update-list emails', T.updates, '“Keep me posted” form'],
    ['Countries', RESULT.countries.length, RESULT.places.length ? `${RESULT.places.length} place${RESULT.places.length === 1 ? '' : 's'} on the globe` : 'no location data yet'],
  ].map(([l, v, s]) => `<div class="card"><div class="v">${typeof v === 'number' ? num(v) : esc(v)}</div><div class="l">${l}</div><div class="s">${esc(s)}</div></div>`).join('')

  const maxV = Math.max(1, ...sources.map(s => s.visitors))
  table($('t_sources'), [
    { k: 'source', t: 'Source', f: r => `<b>${esc(r.source)}</b>` },
    { k: 'visitors', t: 'Visitors', n: 1, f: r => `${num(r.visitors)} <span class="bar" style="width:${Math.round(50 * r.visitors / maxV)}px"></span>` },
    { k: 'landingVisits', t: 'Landing visits', n: 1, f: r => num(r.landingVisits) },
    { k: 'ctaClicks', t: 'Try-free clicks', n: 1, f: r => num(r.ctaClicks) },
    { k: 'signups', t: 'Sign-ups', n: 1, f: r => num(r.signups) },
    { k: 'workshopUsers', t: 'Workshop users', n: 1, f: r => num(r.workshopUsers) },
    { k: 'builders', t: 'Active builders', n: 1, f: r => num(r.builders) },
    { k: 'activeSecs', t: 'Avg time / user', n: 1, f: r => r.workshopUsers ? fmtDur(r.activeSecs / r.workshopUsers) : '—' },
    { k: 'codeRuns', t: 'Code runs', n: 1, f: r => num(r.codeRuns) },
    { k: 'sims', t: 'Simulations', n: 1, f: r => num(r.sims) },
    { k: 'updates', t: 'Update emails', n: 1, f: r => num(r.updates) },
  ], sources, { sortState: sortSources })

  const q = $('u_q').value.trim().toLowerCase()
  const shown = q ? users.filter(u => [u.email, u.source, u.medium, u.campaign, u.content].join(' ').includes(q)) : users
  $('userCount').textContent = `(${shown.length})`
  table($('t_users'), USER_COLS, shown, { sortState: sortUsers, onClick: openUser })

  table($('t_events'), [
    { k: 'received', t: 'Time', f: r => fmtDate(r.received) },
    { k: 'app', t: 'Where', f: r => `<span class="tag">${r.app === 'editor' ? 'workshop' : 'landing'}</span>` },
    { k: 'event', t: 'Event' },
    { k: 'who', t: 'Email', f: r => r.who ? esc(r.who) : '<span class="muted">anonymous</span>' },
    { k: 'source', t: 'Source' }, { k: 'campaign', t: 'Campaign' }, { k: 'device', t: 'Device' },
    { k: 'meta', t: 'Details', f: r => detail(r) },
  ], RESULT.ranged.slice(-300).reverse())

  renderPlaces(RESULT)

  const stats = linkStats(RESULT.events, RESULT.people, LINKS)
  $('linkCount').textContent = `(${stats.length})`
  table($('t_links'), [
    { k: 'label', t: 'Label', f: r => `<b>${esc(r.label || '—')}</b>` },
    { k: 'source', t: 'Source' }, { k: 'medium', t: 'Medium' }, { k: 'campaign', t: 'Campaign' }, { k: 'content', t: 'Content' },
    { k: 'visitors', t: 'Visitors', n: 1 }, { k: 'signups', t: 'Sign-ups', n: 1 },
    { k: 'workshopUsers', t: 'Workshop users', n: 1 }, { k: 'builders', t: 'Active builders', n: 1 },
    { k: 'url', t: 'Link', f: r => `<button class="ghost" data-copy="${esc(r.url)}" style="padding:3px 9px;font-size:11px">Copy</button>` },
    { k: 'saved', t: 'Saved', f: r => fmtDate(Date.parse(r.saved)) },
  ], stats, { sortState: sortLinks })
  $('t_links').querySelectorAll('[data-copy]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); copy(b.dataset.copy, b) })
}

const USER_COLS = [
  { k: 'email', t: 'Email', f: r => `<b>${esc(r.email)}</b>` },
  { k: 'source', t: 'Source', f: r => `${esc(r.source)} <span class="muted" title="Attributed from the ${esc(r.basis)}" style="font-size:10px">${r.basis === 'sign-up' ? '' : '(first visit)'}</span>` },
  { k: 'medium', t: 'Medium' }, { k: 'campaign', t: 'Campaign' }, { k: 'content', t: 'Content' },
  { k: 'signupAt', t: 'Signed up', f: r => r.signupAt ? fmtDate(r.signupAt) : '<span class="muted">—</span>' },
  { k: 'firstSeen', t: 'First seen', f: r => fmtDate(r.firstSeen) },
  { k: 'lastSeen', t: 'Last seen', f: r => fmtDate(r.lastSeen) },
  { k: 'sessions', t: 'Workshop visits', n: 1 }, { k: 'activeSecs', t: 'Time building', n: 1, f: r => fmtDur(r.activeSecs) },
  { k: 'shapes', t: 'Parts added', n: 1 }, { k: 'presets', t: 'Presets', n: 1 }, { k: 'codeRuns', t: 'Code runs', n: 1 },
  { k: 'sims', t: 'Sims', n: 1 }, { k: 'battles', t: 'Battles', n: 1 }, { k: 'saves', t: 'Saves', n: 1 }, { k: 'exports', t: 'Exports / shares', n: 1 },
  { k: 'tutorialStep', t: 'Tutorial', n: 1, f: r => r.tutorialDone ? '✓ done' : (r.tutorialStep ? 'step ' + r.tutorialStep : '—') },
  { k: 'lastEvent', t: 'Last action' },
]

function detail(e) {
  const bits = []
  if (e.event === 'session_time') bits.push(fmtDur(e.value) + ' active (total this visit)')
  if (e.meta) for (const [k, v] of Object.entries(e.meta)) bits.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  if (e.event === 'landing_view' && e.referrer) bits.push('from ' + e.referrer)
  return `<span class="muted">${esc(bits.join(' · ').slice(0, 160))}</span>`
}

function openUser(u) {
  const p = RESULT.people.get(u.email)
  $('dlgTitle').textContent = u.email
  const head = `<p class="hint">Source <b>${esc(u.source)}</b>${u.medium ? ' / ' + esc(u.medium) : ''}${u.campaign ? ' · campaign <b>' + esc(u.campaign) + '</b>' : ''}${u.content ? ' · ' + esc(u.content) : ''} — taken from their ${esc(u.basis)}. All-time timeline (${p.evs.length} events):</p>`
  const t = document.createElement('table')
  $('dlgBody').innerHTML = head + '<div class="scroll tbl-wrap" id="dlgTbl"></div>'
  $('dlgTbl').appendChild(t)
  table(t, [
    { k: 'received', t: 'Time', f: r => fmtDate(r.received) },
    { k: 'app', t: 'Where', f: r => `<span class="tag">${r.app === 'editor' ? 'workshop' : 'landing'}</span>` },
    { k: 'event', t: 'Event' }, { k: 'source', t: 'Arrived via' }, { k: 'device', t: 'Device' },
    { k: 'meta', t: 'Details', f: r => detail(r) },
  ], [...p.evs].reverse())
  $('dlg').showModal()
}

function downloadUsersCsv() {
  if (!RESULT) return
  const cols = ['email', 'source', 'medium', 'campaign', 'content', 'ref', 'basis', 'signupAt', 'firstSeen', 'lastSeen', 'sessions', 'activeSecs',
    'shapes', 'presets', 'codeRuns', 'sims', 'battles', 'saves', 'exports', 'tutorialStep', 'tutorialDone', 'lastEvent']
  const iso = (v) => v ? new Date(v).toISOString() : ''
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const lines = [cols.join(',')].concat(RESULT.users.map(u => cols.map(c => cell(/At$|Seen$/.test(c) ? iso(u[c]) : u[c])).join(',')))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  a.download = `constructa-users-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ── link generator ─────────────────────────────────────────────────────────
const SOURCES = [
  ['whatsapp', 'WhatsApp', 'chat'], ['instagram', 'Instagram', 'social'], ['youtube', 'YouTube', 'video'],
  ['linkedin', 'LinkedIn', 'social'], ['facebook', 'Facebook', 'social'], ['twitter', 'X / Twitter', 'social'],
  ['telegram', 'Telegram', 'chat'], ['email', 'Email', 'email'], ['reddit', 'Reddit', 'social'],
  ['google', 'Google Ads', 'cpc'], ['qr', 'QR / poster', 'offline'], ['school', 'School / partner', 'partner'],
]

function genUrl() {
  const f = { source: $('g_source').value, medium: $('g_medium').value, campaign: $('g_campaign').value, content: $('g_content').value, ref: $('g_ref').value }
  const ready = slug(f.source) && slug(f.campaign)
  const url = ready ? buildCampaignUrl($('g_base').value, f) : ''
  $('g_url').textContent = url || 'Pick a source and type a campaign name.'
  $('g_copy').disabled = $('g_save').disabled = !url
  document.querySelectorAll('#g_sources .chip').forEach(c => c.classList.toggle('on', c.dataset.s === slug(f.source)))
  return { url, f }
}

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text) } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
  }
  const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = old }, 1400)
}

async function saveLink() {
  const { url, f } = genUrl()
  if (!url) return
  const st = $('g_status')
  const rec = { type: 'cx_link', key: KEY, label: $('g_label').value.trim() || `${f.source} · ${f.campaign}`, url, base: $('g_base').value,
    source: slug(f.source), medium: slug(f.medium), campaign: slug(f.campaign), content: slug(f.content), term: '', ref: slug(f.ref) }
  try {
    await fetch(COLLECTOR_ENDPOINT, { method: 'POST', mode: 'no-cors', body: JSON.stringify(rec), headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
    st.className = 'status ok'; st.textContent = 'Saved. Refreshing the list…'
    const lk = await getJson({ what: 'links' })
    if (lk.ok) { LINKS = lk.rows; render() }
    st.textContent = 'Saved ✓'
  } catch (e) { st.className = 'status err'; st.textContent = 'Could not save: ' + e.message }
}

// ── wire up ──────────────────────────────────────────────────────────────────
$('g_sources').innerHTML = SOURCES.map(([s, l]) => `<span class="chip" data-s="${s}">${l}</span>`).join('')
$('g_sources').querySelectorAll('.chip').forEach(c => c.onclick = () => {
  const def = SOURCES.find(x => x[0] === c.dataset.s)
  $('g_source').value = def[0]; $('g_medium').value = def[2]; genUrl()
})
;['g_base', 'g_source', 'g_medium', 'g_campaign', 'g_content', 'g_ref'].forEach(id => $(id).addEventListener('input', genUrl))
$('g_copy').onclick = () => copy(genUrl().url, $('g_copy'))
$('g_save').onclick = saveLink

$('f_exclude').value = ls.get(EXCL_LS)
// First switch to Custom: start from the last 7 days (local dates) instead of an error.
$('f_range').addEventListener('change', () => {
  if ($('f_range').value !== 'custom' || $('f_from').value || $('f_to').value) return
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = new Date(), start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
  $('f_from').value = ymd(start); $('f_to').value = ymd(today)
})
;['f_range', 'f_source', 'f_campaign', 'f_from', 'f_to'].forEach(id => $(id).addEventListener('change', render))
$('f_exclude').addEventListener('input', () => { ls.set(EXCL_LS, $('f_exclude').value); render() })
$('u_q').addEventListener('input', render)
$('u_csv').onclick = downloadUsersCsv
$('u_copy').onclick = copyNewEmails
$('dlgClose').onclick = () => $('dlg').close()
$('refresh').onclick = load
$('logout').onclick = () => { ls.set(KEY_LS, ''); KEY = ''; $('key').value = ''; $('gate').classList.remove('hidden'); $('app').classList.add('hidden'); $('topbar').classList.add('hidden'); $('gateStatus').textContent = '' }
$('unlock').onclick = () => { KEY = $('key').value.trim(); if (KEY) load() }
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('unlock').click() })

if (KEY) load()
