// Constructa Ads dashboard (ads-dashboard.html). Reads the collector's ads_* tabs
// (written by docs/google-ads-script.js) plus cx_events, and renders everything
// from the pure functions in adsAnalyze.js.
import { getJson as collectorGet, readError } from './collector.js'
import { parseRows, resolveIdentities, makeExcluder } from './analyze.js'
import { parseAds, adsReport, adsRange } from './adsAnalyze.js'

const $ = (id) => document.getElementById(id)
// Same keys as utm-dashboard.html (same origin), so unlocking one unlocks both.
const KEY_LS = 'cx_dash_key', EXCL_LS = 'cx_dash_exclude'
const ls = { get: (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } } }

let KEY = ls.get(KEY_LS)
let ADS = parseAds(null), EVENTS = []
const STALE_MS = 3 * 3600 * 1000      // the script runs hourly; 3 h without a sync means it stopped

// ── data ────────────────────────────────────────────────────────────────────
const getJson = (params) => collectorGet(params, KEY)

async function load() {
  const st = $('gateStatus')
  st.className = 'status'; st.textContent = 'Loading…'
  $('refresh').disabled = true
  try {
    const [ad, ev] = await Promise.all([getJson({ what: 'ads' }), getJson({ what: 'events' })])
    if (!ev.ok) throw new Error(await readError(ev))
    if (!ad.ok) throw new Error(await readError(ad))
    // An older collector ignores what=ads and answers with the events instead.
    if (!ad.ads) throw new Error('The collector is an older version — paste docs/utm-collector.gs into Apps Script and deploy a new version.')
    ADS = parseAds(ad.ads)
    EVENTS = resolveIdentities(parseRows(ev.headers, ev.rows))
    ls.set(KEY_LS, KEY)
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden'); $('topbar').classList.remove('hidden')
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString()
    fillCampaigns()
    render()
  } catch (e) {
    $('gate').classList.remove('hidden'); $('app').classList.add('hidden'); $('topbar').classList.add('hidden')
    st.className = 'status err'; st.textContent = e.message
  } finally { $('refresh').disabled = false }
}

// ── formatting ──────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const num = (n) => (n || 0).toLocaleString()
const pct = (r) => r == null ? '—' : (r * 100).toFixed(r < 0.1 ? 1 : 0) + '%'
const fmtDate = (ms) => ms ? new Date(ms).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const fmtDay = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const fmtDur = (s) => { s = Math.round(s || 0); if (!s) return '0m'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : (m ? `${m}m` : `${s}s`) }
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }
function money(v, digits) {
  if (v == null) return '—'
  const currency = ADS.meta?.currency || 'INR'
  try { return v.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: digits ?? (Math.abs(v) < 100 ? 2 : 0) }) } catch { return currency + ' ' + v.toFixed(2) }
}

// ── filters ─────────────────────────────────────────────────────────────────
function opts() {
  const choice = $('f_range').value, custom = choice === 'custom'
  $('f_custom_from').classList.toggle('hidden', !custom)
  $('f_custom_to').classList.toggle('hidden', !custom)
  $('f_to').min = $('f_from').value || ''
  const r = adsRange(choice, $('f_from').value, $('f_to').value)
  $('f_err').textContent = r.error || ''
  if (r.error) return { error: r.error }
  return { from: r.from, to: r.to, campaign: $('f_campaign').value, exclude: makeExcluder($('f_exclude').value) }
}

function fillCampaigns() {
  const sel = $('f_campaign'), cur = sel.value
  const names = new Map()
  for (const r of [...ADS.daily].sort((a, b) => a.day - b.day)) names.set(r.campaign_id, r.campaign)
  sel.innerHTML = '<option value="">All campaigns</option>' +
    [...names].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')
  if (names.has(cur)) sel.value = cur
}

// ── tables ──────────────────────────────────────────────────────────────────
function table(el, cols, rows, sortState) {
  const st = sortState || {}
  const sorted = st.key ? [...rows].sort((a, b) => {
    const x = a[st.key], y = b[st.key]
    const c = typeof x === 'number' || typeof y === 'number' ? (x ?? -1) - (y ?? -1) : String(x ?? '').localeCompare(String(y ?? ''))
    return st.dir * c
  }) : rows
  el.innerHTML = `<thead><tr>${cols.map(c => `<th class="${c.n ? 'n' : ''}" data-k="${c.k}">${esc(c.t)}${st.key === c.k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>` +
    `<tbody>${sorted.length ? sorted.map(r => `<tr>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="muted">No data in this period.</td></tr>`}</tbody>`
  if (sortState) el.querySelectorAll('th').forEach(th => th.onclick = () => {
    const k = th.dataset.k
    sortState.dir = sortState.key === k ? -sortState.dir : -1
    sortState.key = k
    render()
  })
}
const sortCampaigns = { key: '', dir: -1 }, sortKeywords = { key: '', dir: -1 }, sortTerms = { key: '', dir: -1 }, sortSignups = { key: '', dir: -1 }

// ── charts ──────────────────────────────────────────────────────────────────
// One series each, same day axis: thin bars, 2px gap, 4px rounded top, a
// baseline, the max on the y axis, first/last day on the x axis, hover tooltip.
const W = 600, H = 160, PAD = { l: 44, r: 8, t: 8, b: 20 }
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}
function barChart(id, series, key, fmt, tipText) {
  const root = $(id), plot = root.querySelector('.plot'), tip = root.querySelector('.tip')
  if (!series.length) { plot.innerHTML = '<p class="hint">No data in this period.</p>'; return }
  const max = Math.max(...series.map(d => d[key]))
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const slot = iw / series.length, bw = Math.max(1, slot - 2)
  const bars = series.map((d, i) => {
    const x = PAD.l + i * slot + (slot - bw) / 2
    const h = max ? (d[key] / max) * ih : 0
    return `<rect class="hit" data-i="${i}" x="${PAD.l + i * slot}" y="${PAD.t}" width="${slot}" height="${ih}"></rect>` +
      (h > 0 ? `<path class="bar" data-i="${i}" d="${barPath(x, PAD.t + ih - h, bw, h)}"></path>` : '')
  }).join('')
  plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(root.querySelector('h3').textContent)} per day">
    <line class="axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}"></line>
    <text class="lbl" x="${PAD.l - 6}" y="${PAD.t + 8}" text-anchor="end">${esc(fmt(max))}</text>
    <text class="lbl" x="${PAD.l - 6}" y="${PAD.t + ih}" text-anchor="end">0</text>
    <text class="lbl" x="${PAD.l}" y="${H - 4}">${esc(fmtDay(series[0].day))}</text>
    <text class="lbl" x="${W - PAD.r}" y="${H - 4}" text-anchor="end">${esc(fmtDay(series[series.length - 1].day))}</text>
    ${bars}</svg>`
  const svg = plot.querySelector('svg')
  svg.querySelectorAll('.hit').forEach(hit => {
    hit.onmouseenter = () => {
      const i = Number(hit.dataset.i)
      svg.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on'))
      svg.querySelector(`.bar[data-i="${i}"]`)?.classList.add('on')
      tip.innerHTML = tipText(series[i])
      tip.style.display = 'block'
      const box = root.getBoundingClientRect(), hb = hit.getBoundingClientRect()
      tip.style.left = Math.max(0, Math.min(box.width - tip.offsetWidth, hb.left - box.left + hb.width / 2 - tip.offsetWidth / 2)) + 'px'
      tip.style.top = Math.max(0, hb.top - box.top - tip.offsetHeight + 8) + 'px'
    }
  })
  svg.onmouseleave = () => { tip.style.display = 'none'; svg.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on')) }
}

// ── render ──────────────────────────────────────────────────────────────────
function renderSync() {
  const el = $('sync'), m = ADS.meta
  const hasAds = !!(m || ADS.daily.length)
  $('setup').classList.toggle('hidden', hasAds)
  if (!m) { el.className = 'status warn'; el.textContent = 'Google Ads is not connected yet — showing sign-ups from ad clicks only.'; return }
  const synced = Date.parse(m.synced)
  const stale = !Number.isFinite(synced) || Date.now() - synced > STALE_MS
  el.className = 'status ' + (stale ? 'warn' : '')
  el.textContent = `Google Ads: ${m.account || 'account'} (${m.customer_id || '—'}) · ${m.currency || ''} · synced ${Number.isFinite(synced) ? ago(synced) : 'unknown'}` +
    (stale ? ' — the hourly script may have stopped; check Google Ads → Scripts.' : '') +
    (m.time_zone ? ` · ad days are in ${m.time_zone}` : '')
}

function render() {
  renderSync()
  const o = opts()
  if (o.error) {
    $('kpis').innerHTML = '<div class="card"><div class="l">Choose a valid date range to see the numbers.</div></div>'
    for (const id of ['t_campaigns', 't_keywords', 't_terms', 't_signups']) $(id).innerHTML = ''
    for (const id of ['c_cost', 'c_signups']) $(id).querySelector('.plot').innerHTML = ''
    $('signupCount').textContent = ''
    return
  }
  const R = adsReport(ADS, EVENTS, o)
  const T = R.totals
  // Before the Ads Script's first sync there is no spend at all — a dash, never "₹0 per sign-up".
  const connected = !!(ADS.meta || ADS.daily.length)
  const g = (v) => (connected ? v : null)
  const dash = (v, f) => (v == null ? '—' : f(v))

  $('kpis').innerHTML = [
    ['Spend', money(g(T.cost)), g(T.impressions) == null ? 'Google Ads not connected' : `${num(T.impressions)} impressions`],
    ['Clicks', dash(g(T.clicks), num), g(T.clicks) == null ? '' : `CTR ${pct(T.ctr)} · avg CPC ${money(T.cpc)}`],
    ['Sign-ups from ads', num(T.signups), T.clicks ? `${pct(T.clickToSignup)} of clicks` : '', true],
    ['Cost per sign-up', money(g(T.costPerSignup)), 'spend ÷ ad sign-ups', true],
    ['Active builders', num(T.builders), g(T.costPerBuilder) == null ? '' : `${money(T.costPerBuilder)} each`],
    ['Workshop users', num(T.workshopUsers), `${fmtDur(T.activeSecs)} building in total`],
    ['Ad visitors', num(T.visitors), 'browsers that landed from an ad'],
    ['Google conversions', dash(g(T.conversions), v => num(Math.round(v * 10) / 10)), 'as counted by Google Ads'],
  ].map(([l, v, s, hero]) => `<div class="card${hero ? ' hero' : ''}"><div class="v">${esc(v)}</div><div class="l">${l}</div><div class="s">${esc(s)}</div></div>`).join('')

  if (connected) barChart('c_cost', R.series, 'cost', (v) => money(v, 0),
    (d) => `<b>${esc(fmtDay(d.day))}</b><br>${esc(money(d.cost))} spent · ${num(d.clicks)} clicks`)
  else $('c_cost').querySelector('.plot').innerHTML = '<p class="hint">Spend appears here once Google Ads is connected.</p>'
  barChart('c_signups', R.series, 'signups', (v) => num(v),
    (d) => `<b>${esc(fmtDay(d.day))}</b><br>${num(d.signups)} sign-up${d.signups === 1 ? '' : 's'}`)

  // Untagged clicks (and everything before the first sync) have no Google numbers: a dash, not a zero.
  const own = (r) => connected && r.id
  table($('t_campaigns'), [
    { k: 'name', t: 'Campaign', f: r => `<b>${esc(r.name)}</b>${r.status && r.status !== 'ENABLED' ? ` <span class="tag">${esc(r.status.toLowerCase())}</span>` : ''}` },
    { k: 'channel', t: 'Type', f: r => `<span class="muted">${esc(r.channel.toLowerCase().replace(/_/g, ' '))}</span>` },
    { k: 'cost', t: 'Spend', n: 1, f: r => own(r) ? money(r.cost) : '—' },
    { k: 'impressions', t: 'Impr.', n: 1, f: r => own(r) ? num(r.impressions) : '—' },
    { k: 'clicks', t: 'Clicks', n: 1, f: r => own(r) ? num(r.clicks) : '—' },
    { k: 'ctr', t: 'CTR', n: 1, f: r => pct(r.ctr) },
    { k: 'cpc', t: 'Avg CPC', n: 1, f: r => money(r.cpc) },
    { k: 'conversions', t: 'Google conv.', n: 1, f: r => own(r) ? num(Math.round(r.conversions * 10) / 10) : '—' },
    { k: 'visitors', t: 'Visitors', n: 1, f: r => num(r.visitors) },
    { k: 'signups', t: 'Sign-ups', n: 1, f: r => num(r.signups) },
    { k: 'costPerSignup', t: 'Cost / sign-up', n: 1, f: r => money(r.costPerSignup) },
    { k: 'workshopUsers', t: 'Workshop users', n: 1, f: r => num(r.workshopUsers) },
    { k: 'builders', t: 'Builders', n: 1, f: r => num(r.builders) },
    { k: 'costPerBuilder', t: 'Cost / builder', n: 1, f: r => money(r.costPerBuilder) },
  ], R.campaigns, sortCampaigns)

  table($('t_keywords'), [
    { k: 'keyword', t: 'Keyword', f: r => `<b>${esc(r.keyword)}</b>` },
    { k: 'matchType', t: 'Match', f: r => `<span class="muted">${esc(String(r.matchType || '').toLowerCase())}</span>` },
    { k: 'adGroup', t: 'Ad group' }, { k: 'campaign', t: 'Campaign' },
    { k: 'cost', t: 'Spend', n: 1, f: r => money(r.cost) },
    { k: 'impressions', t: 'Impr.', n: 1, f: r => num(r.impressions) },
    { k: 'clicks', t: 'Clicks', n: 1, f: r => num(r.clicks) },
    { k: 'ctr', t: 'CTR', n: 1, f: r => pct(r.ctr) },
    { k: 'cpc', t: 'Avg CPC', n: 1, f: r => money(r.cpc) },
    { k: 'conversions', t: 'Google conv.', n: 1, f: r => num(Math.round(r.conversions * 10) / 10) },
    { k: 'signups', t: 'Sign-ups', n: 1, f: r => num(r.signups) },
    { k: 'costPerSignup', t: 'Cost / sign-up', n: 1, f: r => money(r.costPerSignup) },
  ], R.keywords, sortKeywords)

  table($('t_terms'), [
    { k: 'term', t: 'Search term', f: r => `<b>${esc(r.term)}</b>` },
    { k: 'cost', t: 'Spend', n: 1, f: r => money(r.cost) },
    { k: 'impressions', t: 'Impr.', n: 1, f: r => num(r.impressions) },
    { k: 'clicks', t: 'Clicks', n: 1, f: r => num(r.clicks) },
    { k: 'ctr', t: 'CTR', n: 1, f: r => pct(r.ctr) },
    { k: 'cpc', t: 'Avg CPC', n: 1, f: r => money(r.cpc) },
    { k: 'conversions', t: 'Google conv.', n: 1, f: r => num(Math.round(r.conversions * 10) / 10) },
  ], R.terms.slice(0, 100), sortTerms)

  $('signupCount').textContent = `(${R.signups.length})`
  table($('t_signups'), [
    { k: 'email', t: 'Email', f: r => `<b>${esc(r.email)}</b>` },
    { k: 'signupAt', t: 'Signed up', f: r => fmtDate(r.signupAt) },
    { k: 'campaign', t: 'Campaign' },
    { k: 'keyword', t: 'Keyword', f: r => r.keyword ? esc(r.keyword) : '<span class="muted">—</span>' },
    { k: 'openedWorkshop', t: 'Opened workshop', f: r => r.openedWorkshop ? '✓' : '<span class="muted">—</span>' },
    { k: 'built', t: 'Built something', f: r => r.built ? '✓' : '<span class="muted">—</span>' },
  ], R.signups, sortSignups)
}

// ── wire up ──────────────────────────────────────────────────────────────────
$('f_exclude').value = ls.get(EXCL_LS)
$('f_range').addEventListener('change', () => {
  if ($('f_range').value !== 'custom' || $('f_from').value || $('f_to').value) return
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = new Date(), start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
  $('f_from').value = ymd(start); $('f_to').value = ymd(today)
})
;['f_range', 'f_campaign', 'f_from', 'f_to'].forEach(id => $(id).addEventListener('change', render))
$('f_exclude').addEventListener('input', () => { ls.set(EXCL_LS, $('f_exclude').value); render() })
$('refresh').onclick = load
$('logout').onclick = () => { ls.set(KEY_LS, ''); KEY = ''; $('key').value = ''; $('gate').classList.remove('hidden'); $('app').classList.add('hidden'); $('topbar').classList.add('hidden'); $('gateStatus').textContent = '' }
$('unlock').onclick = () => { KEY = $('key').value.trim(); if (KEY) load() }
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('unlock').click() })

if (KEY) load()
