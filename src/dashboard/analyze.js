// Pure analytics over the collector's cx_events rows (no DOM) — unit-tested in
// tests/dashboard/analyze.test.js. Every number on the dashboard comes from here.
import { placesOf, countriesOf } from './geo.js'

export const BUILD_EVENTS = new Set([
  'shape_added', 'preset_opened', 'code_run', 'sim_started', 'battle_started',
  'arena_started', 'project_saved', 'export_json', 'share_link_created',
])

const lc = (v) => String(v ?? '').trim().toLowerCase()

/** Collector rows (arrays in EVENT_HEADERS order) → event objects, oldest first. */
export function parseRows(headers, rows) {
  const ix = Object.fromEntries(headers.map((h, i) => [h, i]))
  const out = []
  for (const r of rows) {
    const received = Date.parse(r[ix.received])
    if (!Number.isFinite(received)) continue
    let meta = null
    try { meta = r[ix.meta] ? JSON.parse(r[ix.meta]) : null } catch { meta = null }
    const value = r[ix.value] === '' || r[ix.value] == null ? null : Number(r[ix.value])
    out.push({
      received, env: r[ix.env], eid: r[ix.eid], app: r[ix.app], event: r[ix.event],
      email: lc(r[ix.email]), vid: String(r[ix.vid] || ''), sid: String(r[ix.sid] || ''),
      source: lc(r[ix.source]) || '(direct)', medium: lc(r[ix.medium]), campaign: lc(r[ix.campaign]),
      content: lc(r[ix.content]), term: lc(r[ix.term]), ref: String(r[ix.ref] || ''),
      referrer: String(r[ix.referrer] || ''), page: String(r[ix.page] || ''), device: String(r[ix.device] || ''),
      // Coarse location, as sent by the browser (IANA zone + UI language).
      // Old rows predate these columns and simply carry ''.
      tz: String(r[ix.tz] ?? ''), lang: String(r[ix.lang] ?? ''),
      value: Number.isFinite(value) ? value : null, meta,
    })
  }
  out.sort((a, b) => a.received - b.received)
  // Drop duplicates that slipped past the collector's 6 h dedupe window.
  const seen = new Set()
  return out.filter(e => (e.eid && seen.has(e.eid)) ? false : (seen.add(e.eid), true))
}

/**
 * Attach `who` (the person's email) to every event. Events without an email are
 * linked through their tab session, then their browser (vid) — but only when that
 * session/browser belongs to exactly ONE email, so shared computers never mix people.
 */
export function resolveIdentities(events) {
  const bySid = new Map(), byVid = new Map()
  const add = (m, k, e) => { if (!k) return; let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(e) }
  for (const e of events) if (e.email) { add(bySid, e.sid, e.email); add(byVid, e.vid, e.email) }
  const only = (m, k) => { const s = k && m.get(k); return s && s.size === 1 ? [...s][0] : '' }
  for (const e of events) e.who = e.email || only(bySid, e.sid) || only(byVid, e.vid)
  return events
}

export function makeExcluder(text) {
  const parts = String(text || '').split(/[,\s]+/).map(lc).filter(Boolean)
  const emails = new Set(parts.filter(p => !p.startsWith('@')))
  const domains = parts.filter(p => p.startsWith('@'))
  return (email) => !!email && (emails.has(email) || domains.some(d => email.endsWith(d)))
}

const attrOf = (e) => ({ source: e.source, medium: e.medium, campaign: e.campaign, content: e.content, ref: e.ref })

/**
 * Per-person attribution: the source they SIGNED UP through; if no sign-up was
 * recorded (accounts older than this tracking), the first non-direct source they
 * arrived from; otherwise (direct).
 */
export function userAttribution(evs) {
  const signup = evs.find(e => e.event === 'signup')
  if (signup) return { ...attrOf(signup), basis: 'sign-up' }
  const tagged = evs.find(e => e.source && e.source !== '(direct)')
  if (tagged) return { ...attrOf(tagged), basis: 'first visit' }
  return { source: '(direct)', medium: '', campaign: '', content: '', ref: '', basis: 'first visit' }
}

export function linkKey(a) { return [lc(a.source), lc(a.medium), lc(a.campaign), lc(a.content)].join('|') }

/**
 * Period filter → { from, to } in ms ([from, to), times = server receive time).
 *   '1'           today (since local midnight)          — unchanged behaviour
 *   '7' '30' '90' rolling last N×24 h                    — unchanged behaviour
 *   '0'           all time
 *   'custom'      start/end as 'YYYY-MM-DD' in the viewer's LOCAL time zone (same
 *                 as "Today"); both days inclusive → to = the local midnight after end.
 * Returns { error } instead when the custom range is incomplete or reversed.
 */
export function resolveRange(choice, start = '', end = '', now = Date.now()) {
  if (choice === 'custom') {
    const day = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? [+m[1], +m[2] - 1, +m[3]] : null }
    const a = day(start), b = day(end)
    if (!a || !b) return { error: 'Pick both a start date and an end date.' }
    const from = new Date(a[0], a[1], a[2]).getTime()
    const to = new Date(b[0], b[1], b[2] + 1).getTime()      // Date handles month ends + DST
    if (to <= from) return { error: 'The end date can’t be earlier than the start date.' }
    return { from, to }
  }
  const days = Number(choice)
  if (days === 1) { const d = new Date(now); d.setHours(0, 0, 0, 0); return { from: d.getTime(), to: Infinity } }
  if (days > 0) return { from: now - days * 86400000, to: Infinity }
  return { from: 0, to: Infinity }
}

/**
 * Main aggregation.
 * opts: { from (ms|0), to (ms|Infinity), source, campaign, exclude(email)→bool, includeTest }
 */
export function analyze(allEvents, opts = {}) {
  const from = opts.from || 0, to = opts.to ?? Infinity
  const excluded = opts.exclude || (() => false)
  const events = allEvents.filter(e => (opts.includeTest || e.env === 'prod') && !excluded(e.who))

  // People: all-time event lists + attribution.
  const people = new Map()
  for (const e of events) if (e.who) { let p = people.get(e.who); if (!p) people.set(e.who, p = { email: e.who, evs: [] }); p.evs.push(e) }
  for (const p of people.values()) {
    p.attr = userAttribution(p.evs)
    p.firstSeen = p.evs[0].received
    p.signupAt = p.evs.find(e => e.event === 'signup')?.received ?? null
  }

  const matches = (a) => (!opts.source || a.source === opts.source) && (!opts.campaign || a.campaign === opts.campaign)
  const inRange = (e) => e.received >= from && e.received < to
  const ranged = events.filter(inRange)

  // Grouping key for an event: the person's attribution if known, else the event's own.
  const attrFor = (e) => (e.who && people.get(e.who)?.attr) || attrOf(e)

  const src = new Map()
  const row = (s) => { let r = src.get(s); if (!r) src.set(s, r = { source: s, vids: new Set(), landingSids: new Set(), ctaSids: new Set(), updates: new Set(), signups: new Set(), workshop: new Set(), builders: new Set(), activeSecs: 0, codeRuns: 0, sims: 0 }); return r }

  // Active time = per tab-session max cumulative seconds (session_time is cumulative).
  const sidSecs = new Map()
  for (const e of ranged) {
    if (e.event !== 'session_time' || e.value == null) continue
    const cur = sidSecs.get(e.sid)
    if (!cur || e.value > cur.secs) sidSecs.set(e.sid, { secs: e.value, e })
  }

  for (const e of ranged) {
    // Visit metrics follow the source of THAT visit; people metrics follow the person.
    const va = attrOf(e)
    if (matches(va)) {
      const r = row(va.source)
      if (e.vid && (e.event === 'landing_view' || e.event === 'editor_open')) r.vids.add(e.vid)
      if (e.event === 'landing_view') r.landingSids.add(e.sid)
      if (e.event === 'cta_click') r.ctaSids.add(e.sid)
      if (e.event === 'updates_signup' && e.who) r.updates.add(e.who)
    }
    const a = attrFor(e)
    if (!matches(a)) continue
    const r = row(a.source)
    if (e.event === 'signup' && e.who) r.signups.add(e.who)
    if (e.event === 'editor_open' && e.who) r.workshop.add(e.who)
    if (BUILD_EVENTS.has(e.event) && e.who) r.builders.add(e.who)
    if (e.event === 'code_run') r.codeRuns++
    if (e.event === 'sim_started') r.sims++
  }
  for (const { secs, e } of sidSecs.values()) {
    const a = attrFor(e)
    if (matches(a)) row(a.source).activeSecs += secs
  }

  const sources = [...src.values()].map(r => ({
    source: r.source, visitors: r.vids.size, landingVisits: r.landingSids.size, ctaClicks: r.ctaSids.size,
    updates: r.updates.size, signups: r.signups.size, workshopUsers: r.workshop.size, builders: r.builders.size,
    activeSecs: r.activeSecs, codeRuns: r.codeRuns, sims: r.sims,
  })).sort((a, b) => b.visitors - a.visitors || b.signups - a.signups || a.source.localeCompare(b.source))

  // Totals use unions (a person can't be counted twice across sources).
  const uni = (k) => new Set([...src.values()].flatMap(r => [...r[k]])).size
  const totals = {
    visitors: uni('vids'), landingVisits: uni('landingSids'), ctaClicks: uni('ctaSids'), updates: uni('updates'),
    signups: uni('signups'), workshopUsers: uni('workshop'), builders: uni('builders'),
    activeSecs: sources.reduce((s, r) => s + r.activeSecs, 0),
    codeRuns: sources.reduce((s, r) => s + r.codeRuns, 0), sims: sources.reduce((s, r) => s + r.sims, 0),
  }

  // Users with activity in range.
  const users = []
  for (const p of people.values()) {
    if (!matches(p.attr)) continue
    const evs = p.evs.filter(inRange)
    if (!evs.length) continue
    const count = (n) => evs.filter(e => e.event === n).length
    const sids = new Set(evs.filter(e => e.event === 'editor_open').map(e => e.sid))
    let secs = 0
    for (const [sid, v] of sidSecs) if (v.e.who === p.email) secs += v.secs
    const steps = evs.filter(e => e.event === 'tutorial_step').map(e => Number(e.meta?.step) || 0)
    const last = evs[evs.length - 1]
    users.push({
      email: p.email, ...p.attr, firstSeen: p.firstSeen, lastSeen: last.received, signupAt: p.signupAt,
      sessions: sids.size, activeSecs: secs,
      shapes: count('shape_added'), presets: count('preset_opened'), codeRuns: count('code_run'), sims: count('sim_started'),
      battles: count('battle_started') + count('arena_started'), saves: count('project_saved'),
      exports: count('export_json') + count('share_link_created'),
      tutorialStep: steps.length ? Math.max(...steps) : 0, tutorialDone: count('tutorial_completed') > 0,
      lastEvent: last.event, events: evs.length,
    })
  }
  users.sort((a, b) => b.lastSeen - a.lastSeen)

  // New registrations in range: people whose recorded sign-up (account creation)
  // falls inside [from, to). One entry per person — `people` is keyed by the
  // normalised email, so the list is already de-duplicated. Same source/campaign
  // and internal-email filters as everything else.
  const newUsers = [...people.values()]
    .filter(p => p.signupAt != null && p.signupAt >= from && p.signupAt < to && matches(p.attr))
    .sort((a, b) => a.signupAt - b.signupAt)
    .map(p => ({ email: p.email, signupAt: p.signupAt, source: p.attr.source }))

  // Where the period's visitors were, from their browser time zone. Only events
  // that actually carry a zone count, so the "located" share is honest.
  const inScope = ranged.filter(e => matches(attrFor(e)))
  const places = placesOf(inScope)
  const locatedVids = new Set(inScope.filter(e => e.tz && e.vid).map(e => e.vid))
  totals.locatedVisitors = locatedVids.size

  return {
    events, ranged: inScope, sources, totals, users, newUsers, people,
    places, countries: countriesOf(places),
  }
}

/** All-time results per saved campaign link (exact source|medium|campaign|content match). */
export function linkStats(events, people, links) {
  const out = new Map(links.map(l => [linkKey(l), { vids: new Set(), signups: new Set(), workshop: new Set(), builders: new Set() }]))
  for (const e of events) {
    const s = out.get(linkKey(e))
    if (s && e.vid && (e.event === 'landing_view' || e.event === 'editor_open')) s.vids.add(e.vid)
  }
  for (const p of people.values()) {
    const s = out.get(linkKey(p.attr))
    if (!s) continue
    for (const e of p.evs) {
      if (e.event === 'signup') s.signups.add(p.email)
      if (e.event === 'editor_open') s.workshop.add(p.email)
      if (BUILD_EVENTS.has(e.event)) s.builders.add(p.email)
    }
  }
  return links.map(l => { const s = out.get(linkKey(l)); return { ...l, visitors: s.vids.size, signups: s.signups.size, workshopUsers: s.workshop.size, builders: s.builders.size } })
}

/** Normalise a UTM value the way the generator writes it: lowercase, dashes, no spaces. */
export function slug(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._\-+@]/g, '').slice(0, 80)
}

export function buildCampaignUrl(base, f) {
  let url
  try { url = new URL(base) } catch { return '' }
  const set = (k, v) => { if (v) url.searchParams.set(k, v) }
  set('utm_source', slug(f.source)); set('utm_medium', slug(f.medium)); set('utm_campaign', slug(f.campaign))
  set('utm_content', slug(f.content)); set('ref', slug(f.ref))
  return url.toString()
}
