import { describe, it, expect } from 'vitest'
import { parseRows, resolveIdentities, analyze, linkStats, makeExcluder, buildCampaignUrl, resolveRange, liveSnapshot, LIVE_WINDOW_MS } from '../../src/dashboard/analyze.js'

const H = ['received', 'env', 'eid', 'app', 'event', 'email', 'vid', 'sid', 'source', 'medium', 'campaign', 'content', 'term', 'ref', 'referrer', 'page', 'device', 'value', 'meta', 'client_ts']
let n = 0
const T0 = Date.parse('2026-10-01T10:00:00Z')
// row(minutesAfterT0, app, event, {email, vid, sid, source, medium, campaign, content, value, meta, env})
function row(min, app, event, o = {}) {
  return [new Date(T0 + min * 60000).toISOString(), o.env || 'prod', o.eid || 'e' + (++n), app, event, o.email || '', o.vid || '', o.sid || '',
    o.source || '(direct)', o.medium || '', o.campaign || '', o.content || '', '', '', '', '', 'desktop',
    o.value ?? '', o.meta ? JSON.stringify(o.meta) : '', '']
}
const WA = { source: 'whatsapp', medium: 'chat', campaign: 'launch', content: 'group-a' }
const IG = { source: 'instagram', medium: 'social', campaign: 'launch' }

function fixture() {
  return [
    // Alice: WhatsApp → landing → try free → sign-up → workshop, builds, 2 tab-sessions of time
    row(0, 'landing', 'landing_view', { vid: 'vA', sid: 'lA', ...WA }),
    row(1, 'landing', 'cta_click', { vid: 'vA', sid: 'lA', ...WA }),
    row(2, 'landing', 'signup', { vid: 'vA', sid: 'lA', email: 'alice@x.com', ...WA }),
    row(3, 'editor', 'editor_open', { vid: 'vA', sid: 'sA1', email: 'alice@x.com', ...WA }),
    row(4, 'editor', 'shape_added', { vid: 'vA', sid: 'sA1', email: 'alice@x.com', ...WA }),
    row(5, 'editor', 'code_run', { vid: 'vA', sid: 'sA1', email: 'alice@x.com', ...WA }),
    row(6, 'editor', 'session_time', { vid: 'vA', sid: 'sA1', email: 'alice@x.com', value: 120, ...WA }),
    row(9, 'editor', 'session_time', { vid: 'vA', sid: 'sA1', email: 'alice@x.com', value: 300, ...WA }),   // cumulative → 300 not 420
    row(20, 'editor', 'editor_open', { vid: 'vA', sid: 'sA2', email: 'alice@x.com', ...WA }),
    row(25, 'editor', 'session_time', { vid: 'vA', sid: 'sA2', email: 'alice@x.com', value: 60, ...WA }),
    // Later Alice comes back through an Instagram post — she stays a WhatsApp sign-up
    row(30, 'landing', 'landing_view', { vid: 'vA', sid: 'lA2', ...IG }),

    // Bob: Instagram, visits landing anonymously, signs up, opens workshop, never builds
    row(40, 'landing', 'landing_view', { vid: 'vB', sid: 'lB', ...IG }),
    row(41, 'landing', 'signup', { vid: 'vB', sid: 'lB', email: 'BOB@Y.com', ...IG }),
    row(42, 'editor', 'editor_open', { vid: 'vB', sid: 'sB', email: 'bob@y.com', ...IG }),

    // Anonymous Instagram visitor who bounces
    row(50, 'landing', 'landing_view', { vid: 'vC', sid: 'lC', ...IG }),

    // Shared school computer: two different people on the same browser (vid)
    row(60, 'editor', 'editor_open', { vid: 'vS', sid: 'sS1', email: 'kid1@s.com' }),
    row(61, 'editor', 'editor_open', { vid: 'vS', sid: 'sS2', email: 'kid2@s.com' }),
    row(62, 'editor', 'shape_added', { vid: 'vS', sid: 'sS3' }),             // anonymous, ambiguous browser

    // Test traffic + an internal tester
    row(70, 'editor', 'editor_open', { vid: 'vT', sid: 'sT', email: 'dev@x.com', env: 'test' }),
    row(71, 'editor', 'editor_open', { vid: 'vI', sid: 'sI', email: 'me@atumx.in', ...WA }),
    // duplicate delivery of one event
    row(5, 'editor', 'code_run', { vid: 'vA', sid: 'sA1', email: 'alice@x.com', eid: 'dup', ...WA }),
    row(5, 'editor', 'code_run', { vid: 'vA', sid: 'sA1', email: 'alice@x.com', eid: 'dup', ...WA }),
  ]
}

const load = () => resolveIdentities(parseRows(H, fixture()))
const opts = { exclude: makeExcluder('@atumx.in') }

describe('dashboard analytics', () => {
  it('drops duplicate events and normalises email case', () => {
    const ev = load()
    expect(ev.filter(e => e.eid === 'dup')).toHaveLength(1)
    expect(ev.some(e => e.email === 'bob@y.com' && e.event === 'signup')).toBe(true)
  })

  it('links anonymous events to a person only when the browser is unambiguous', () => {
    const ev = load()
    expect(ev.find(e => e.sid === 'lB' && e.event === 'landing_view').who).toBe('bob@y.com')
    expect(ev.find(e => e.sid === 'lC').who).toBe('')
    expect(ev.find(e => e.sid === 'sS3').who).toBe('')       // shared computer → not guessed
  })

  it('counts the funnel per source correctly', () => {
    const r = analyze(load(), opts)
    const wa = r.sources.find(s => s.source === 'whatsapp')
    const ig = r.sources.find(s => s.source === 'instagram')
    expect(wa).toMatchObject({ visitors: 1, landingVisits: 1, ctaClicks: 1, signups: 1, workshopUsers: 1, builders: 1, codeRuns: 2, activeSecs: 360 })
    // Instagram: visits from Alice (return visit), Bob and the anonymous visitor; only Bob signed up there
    expect(ig).toMatchObject({ visitors: 3, landingVisits: 3, signups: 1, workshopUsers: 1, builders: 0 })
    expect(r.totals).toMatchObject({ signups: 2, builders: 1, workshopUsers: 4 })   // the kid's anonymous shape is not credited to anyone
  })

  it('excludes test traffic and internal emails', () => {
    const r = analyze(load(), opts)
    const emails = r.users.map(u => u.email)
    expect(emails).not.toContain('dev@x.com')
    expect(emails).not.toContain('me@atumx.in')
    expect(emails.sort()).toEqual(['alice@x.com', 'bob@y.com', 'kid1@s.com', 'kid2@s.com'])
  })

  it('gives each user their sign-up source and per-user activity', () => {
    const r = analyze(load(), opts)
    const alice = r.users.find(u => u.email === 'alice@x.com')
    expect(alice).toMatchObject({ source: 'whatsapp', campaign: 'launch', content: 'group-a', basis: 'sign-up', sessions: 2, activeSecs: 360, shapes: 1, codeRuns: 2 })
    const kid = r.users.find(u => u.email === 'kid1@s.com')
    expect(kid).toMatchObject({ source: '(direct)', basis: 'first visit', shapes: 0 })
  })

  it('respects the date range and source filter', () => {
    const r = analyze(load(), { ...opts, from: T0 + 35 * 60000 })
    expect(r.users.map(u => u.email)).not.toContain('alice@x.com')
    const f = analyze(load(), { ...opts, source: 'instagram' })
    expect(f.users.map(u => u.email)).toEqual(['bob@y.com'])
  })

  it('computes per-link results', () => {
    const r = analyze(load(), opts)
    const [wa, ig] = linkStats(r.events, r.people, [{ ...WA }, { ...IG, content: '' }])
    expect(wa).toMatchObject({ visitors: 1, signups: 1, workshopUsers: 1, builders: 1 })
    expect(ig).toMatchObject({ visitors: 3, signups: 1, workshopUsers: 1, builders: 0 })
  })

  it('resolves the existing period presets exactly as before', () => {
    const now = new Date(2026, 9, 15, 14, 30).getTime()           // 15 Oct 2026 14:30 local
    expect(resolveRange('1', '', '', now)).toEqual({ from: new Date(2026, 9, 15).getTime(), to: Infinity })
    expect(resolveRange('7', '', '', now)).toEqual({ from: now - 7 * 86400000, to: Infinity })
    expect(resolveRange('30', '', '', now)).toEqual({ from: now - 30 * 86400000, to: Infinity })
    expect(resolveRange('0', '', '', now)).toEqual({ from: 0, to: Infinity })
  })

  it('resolves "live" to a rolling in-app window', () => {
    const now = new Date(2026, 9, 15, 14, 30).getTime()
    expect(resolveRange('live', '', '', now)).toEqual({ from: now - LIVE_WINDOW_MS, to: Infinity, live: true })
  })

  it('live: counts only people inside the editor, only within the window', () => {
    const now = T0 + 100 * 60000                       // "now" = T0 + 100 min
    const mins = (m) => (now - m * 60000 - T0) / 60000  // m minutes ago, as a row offset
    const rows = [
      row(mins(2), 'editor', 'session_time', { vid: 'vLive', sid: 's1', email: 'live@x.com', value: 300 }),
      row(mins(4), 'editor', 'shape_added', { vid: 'vLive2', sid: 's2' }),
      row(mins(3), 'landing', 'landing_view', { vid: 'vLanding', sid: 's3' }),   // on the site, not in the app
      row(mins(45), 'editor', 'session_time', { vid: 'vGone', sid: 's4', value: 900 }), // left long ago
    ]
    const snap = liveSnapshot(resolveIdentities(parseRows(H, rows)), { now })
    expect(snap.visitors).toBe(2)        // vLive + vLive2; not the landing visitor, not the one who left
    expect(snap.users).toBe(1)           // only one of them is signed in
    expect(snap.since).toBe(now - LIVE_WINDOW_MS)
  })

  it('live: an empty window is zero, not a crash', () => {
    const snap = liveSnapshot(resolveIdentities(parseRows(H, fixture())), { now: T0 + 10 * 86400000 })
    expect(snap.visitors).toBe(0)
    expect(snap.places).toEqual([])
  })

  it('analyze in live mode ignores landing traffic', () => {
    const evs = resolveIdentities(parseRows(H, fixture()))
    const all = analyze(evs, { from: 0, to: Infinity })
    const live = analyze(evs, { from: 0, to: Infinity, live: true })
    expect(live.totals.landingVisits).toBe(0)
    expect(all.totals.landingVisits).toBeGreaterThan(0)
  })

  it('custom range: whole local days, both ends inclusive', () => {
    const r = resolveRange('custom', '2026-10-01', '2026-10-15')
    expect(r.from).toBe(new Date(2026, 9, 1).getTime())
    expect(r.to).toBe(new Date(2026, 9, 16).getTime())             // midnight after the end day
    const one = resolveRange('custom', '2026-10-05', '2026-10-05')  // a single day is valid
    expect(one.to - one.from).toBeGreaterThanOrEqual(23 * 3600000)
    expect(resolveRange('custom', '2026-10-31', '2026-10-31').to).toBe(new Date(2026, 10, 1).getTime())   // month end
  })

  it('custom range: rejects a reversed or incomplete range', () => {
    expect(resolveRange('custom', '2026-10-15', '2026-10-01').error).toMatch(/earlier/)
    expect(resolveRange('custom', '2026-10-15', '').error).toMatch(/both/)
    expect(resolveRange('custom', '', '').error).toMatch(/both/)
  })

  it('new-user emails: only sign-ups inside the range, de-duplicated, filters respected', () => {
    // Bob signs up twice (form resubmitted, different case) — must appear once.
    const rows = [...fixture(), row(43, 'landing', 'signup', { vid: 'vB', sid: 'lB', email: 'Bob@Y.com', ...IG }),
      row(44, 'landing', 'signup', { vid: 'vT', sid: 'sT2', email: 'tester@atumx.in', ...IG })]
    const ev = resolveIdentities(parseRows(H, rows))
    const all = analyze(ev, opts).newUsers.map(u => u.email)
    expect(all).toEqual(['alice@x.com', 'bob@y.com'])              // kid1/kid2 never signed up; internal excluded
    // Range [T0+30min, T0+60min): Alice signed up at +2 min → out; Bob at +41 → in
    const r = analyze(ev, { ...opts, from: T0 + 30 * 60000, to: T0 + 60 * 60000 }).newUsers.map(u => u.email)
    expect(r).toEqual(['bob@y.com'])
    // Boundary: to is exclusive, from inclusive
    expect(analyze(ev, { ...opts, from: T0 + 2 * 60000, to: T0 + 41 * 60000 }).newUsers.map(u => u.email)).toEqual(['alice@x.com'])
    // Source filter applies too
    expect(analyze(ev, { ...opts, source: 'whatsapp' }).newUsers.map(u => u.email)).toEqual(['alice@x.com'])
    // Empty result
    expect(analyze(ev, { ...opts, from: T0 + 100 * 60000 }).newUsers).toEqual([])
  })

  it('builds normalised campaign URLs', () => {
    expect(buildCampaignUrl('https://constructa-page.atumx.in/', { source: 'WhatsApp', medium: 'chat', campaign: 'Diwali Launch', content: '' }))
      .toBe('https://constructa-page.atumx.in/?utm_source=whatsapp&utm_medium=chat&utm_campaign=diwali-launch')
    expect(buildCampaignUrl('https://constructa.atumx.in/?app=1', { source: 'qr', campaign: 'expo' }))
      .toBe('https://constructa.atumx.in/?app=1&utm_source=qr&utm_campaign=expo')
  })
})
