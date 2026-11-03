// Pure analytics for ads-dashboard.html (no DOM) — unit-tested in
// tests/dashboard/adsAnalyze.test.js.
//
// Two data sets meet here:
//   • Google Ads' own numbers (spend, impressions, clicks, Google-counted
//     conversions), copied into the ads_* tabs by docs/google-ads-script.js;
//   • our funnel from cx_events, narrowed to visitors who arrived from an ad
//     (source "google" / medium "cpc": the Final URL suffix, or a bare gclid).
// They join on the Google Ads campaign id, which the suffix puts in utm_campaign,
// and on ad group id (utm_content) + keyword (utm_term) for keywords.
import { analyze, resolveRange, BUILD_EVENTS } from './analyze.js'

export const AD_SOURCE = 'google'
export const AD_MEDIUM = 'cpc'
const NUMERIC = ['impressions', 'clicks', 'cost', 'conversions', 'conv_value']
const lc = (v) => String(v ?? '').trim().toLowerCase()

/** 'yyyy-MM-dd' → local midnight (ms), so ad days filter with the same ranges as events. */
export function dayMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''))
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN
}

function objects(t) {
  if (!t || !t.headers || !t.headers.length) return []
  return (t.rows || []).map(r => Object.fromEntries(t.headers.map((h, i) => [h, r[i]])))
}

/** The collector's { daily, keywords, terms, meta } tables → typed rows. */
export function parseAds(ads) {
  const typed = (t) => objects(t).map(r => {
    const o = { ...r, campaign_id: String(r.campaign_id ?? ''), day: dayMs(r.date) }
    for (const k of NUMERIC) if (k in o) o[k] = Number(o[k]) || 0
    if ('ad_group_id' in o) o.ad_group_id = String(o.ad_group_id ?? '')
    return o
  }).filter(r => Number.isFinite(r.day))
  return {
    daily: typed(ads?.daily), keywords: typed(ads?.keywords), terms: typed(ads?.terms),
    meta: objects(ads?.meta)[0] || null,
  }
}

/**
 * Period → { from, to }. Ad spend comes in whole days, so every preset is a run
 * of whole calendar days ending today ("7" = today and the 6 days before), and
 * the funnel numbers use exactly the same window. 'custom' / '0' as resolveRange.
 */
export function adsRange(choice, start = '', end = '', now = Date.now()) {
  if (choice === 'custom' || choice === '0') return resolveRange(choice, start, end, now)
  const days = Math.max(1, Number(choice) || 1)
  const d = new Date(now)
  return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1)).getTime(), to: Infinity }
}

const ratio = (a, b) => (b ? a / b : null)

/**
 * Main aggregation.
 * opts: { from, to, campaign (id, optional), exclude(email)→bool, now }
 */
export function adsReport(ads, events, opts = {}) {
  const from = opts.from || 0, to = opts.to ?? Infinity
  const excluded = opts.exclude || (() => false)
  const inDays = (r) => r.day >= from && r.day < to && (!opts.campaign || r.campaign_id === opts.campaign)

  // ── Google Ads side ──
  const names = new Map()           // campaign id → latest name / status / channel
  for (const r of [...ads.daily].sort((a, b) => a.day - b.day)) names.set(r.campaign_id, r)
  const daily = ads.daily.filter(inDays)
  const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0)

  // ── our funnel, ad visitors only ──
  const ours = analyze(events, { from, to, exclude: opts.exclude, source: AD_SOURCE, medium: AD_MEDIUM, campaign: opts.campaign })
  const isAdVisit = (e) => e.source === AD_SOURCE && e.medium === AD_MEDIUM
  const personAttr = (e) => (e.who && ours.people.get(e.who)?.attr) || e

  // Per campaign id. '' = an ad click that arrived without the campaign suffix.
  const camps = new Map()
  const camp = (id) => {
    let c = camps.get(id)
    if (!c) camps.set(id, c = { id, vids: new Set(), signups: new Set(), workshop: new Set(), builders: new Set(), impressions: 0, clicks: 0, cost: 0, conversions: 0 })
    return c
  }
  for (const r of daily) {
    const c = camp(r.campaign_id)
    c.impressions += r.impressions; c.clicks += r.clicks; c.cost += r.cost; c.conversions += r.conversions
  }
  // Visits follow the source of THAT visit; people metrics follow the person.
  const visitVids = new Set()
  for (const e of events) {
    if (e.env !== 'prod' || excluded(e.who) || e.received < from || e.received >= to) continue
    if (!isAdVisit(e) || (opts.campaign && e.campaign !== opts.campaign)) continue
    if (e.vid && (e.event === 'landing_view' || e.event === 'editor_open')) { camp(e.campaign).vids.add(e.vid); visitVids.add(e.vid) }
  }
  for (const e of ours.ranged) {
    if (!e.who) continue
    const c = camp(personAttr(e).campaign)
    if (e.event === 'signup') c.signups.add(e.who)
    if (e.event === 'editor_open') c.workshop.add(e.who)
    if (BUILD_EVENTS.has(e.event)) c.builders.add(e.who)
  }

  const campaigns = [...camps.values()].map(c => {
    const n = names.get(c.id)
    return {
      id: c.id, name: c.id ? (n?.campaign || `Campaign ${c.id}`) : '(no campaign tag)', status: n?.status || '', channel: n?.channel || '',
      impressions: c.impressions, clicks: c.clicks, cost: c.cost, conversions: c.conversions,
      ctr: ratio(c.clicks, c.impressions), cpc: ratio(c.cost, c.clicks),
      visitors: c.vids.size, signups: c.signups.size, workshopUsers: c.workshop.size, builders: c.builders.size,
      // Untagged clicks have no spend of their own (it sits in the real campaigns), so no ratio.
      costPerSignup: c.id && c.signups.size ? c.cost / c.signups.size : null,
      costPerBuilder: c.id && c.builders.size ? c.cost / c.builders.size : null,
    }
  }).sort((a, b) => b.cost - a.cost || b.signups - a.signups)

  const cost = sum(daily, 'cost'), clicks = sum(daily, 'clicks'), impressions = sum(daily, 'impressions')
  const T = ours.totals
  const totals = {
    cost, clicks, impressions, conversions: sum(daily, 'conversions'),
    ctr: ratio(clicks, impressions), cpc: ratio(cost, clicks),
    visitors: visitVids.size, signups: T.signups, workshopUsers: T.workshopUsers, builders: T.builders, activeSecs: T.activeSecs,
    clickToSignup: ratio(T.signups, clicks),
    costPerSignup: T.signups ? cost / T.signups : null,
    costPerBuilder: T.builders ? cost / T.builders : null,
  }

  // ── sign-ups from ads, with the keyword they came through ──
  const signups = []
  for (const p of ours.people.values()) {
    const s = p.evs.find(e => e.event === 'signup')
    if (!s || s.received < from || s.received >= to || !isAdVisit(s)) continue
    if (opts.campaign && s.campaign !== opts.campaign) continue
    const did = (set) => p.evs.some(e => set.has(e.event))
    signups.push({
      email: p.email, signupAt: s.received, campaignId: s.campaign, campaign: names.get(s.campaign)?.campaign || s.campaign || '(no campaign tag)',
      adGroupId: s.content, keyword: lc(s.term),
      openedWorkshop: p.evs.some(e => e.event === 'editor_open'), built: did(BUILD_EVENTS),
    })
  }
  signups.sort((a, b) => b.signupAt - a.signupAt)

  // ── keywords: Google's numbers + our sign-ups (ad group id + keyword text) ──
  const kwKey = (adGroup, kw) => `${adGroup}|${lc(kw)}`
  const kw = new Map()
  for (const r of ads.keywords.filter(inDays)) {
    const k = kwKey(r.ad_group_id, r.keyword)
    let o = kw.get(k)
    if (!o) kw.set(k, o = { keyword: r.keyword, matchType: r.match_type, adGroup: r.ad_group, campaignId: r.campaign_id,
      campaign: names.get(r.campaign_id)?.campaign || r.campaign_id, impressions: 0, clicks: 0, cost: 0, conversions: 0, signups: 0 })
    o.impressions += r.impressions; o.clicks += r.clicks; o.cost += r.cost; o.conversions += r.conversions
  }
  for (const s of signups) { const o = kw.get(kwKey(s.adGroupId, s.keyword)); if (o) o.signups++ }
  const keywords = [...kw.values()].map(o => ({ ...o, ctr: ratio(o.clicks, o.impressions), cpc: ratio(o.cost, o.clicks),
    costPerSignup: o.signups ? o.cost / o.signups : null })).sort((a, b) => b.cost - a.cost)

  // ── search terms (Google's numbers only: the click URL never carries the query) ──
  const st = new Map()
  for (const r of ads.terms.filter(inDays)) {
    const k = lc(r.search_term)
    let o = st.get(k)
    if (!o) st.set(k, o = { term: r.search_term, impressions: 0, clicks: 0, cost: 0, conversions: 0 })
    o.impressions += r.impressions; o.clicks += r.clicks; o.cost += r.cost; o.conversions += r.conversions
  }
  const terms = [...st.values()].map(o => ({ ...o, ctr: ratio(o.clicks, o.impressions), cpc: ratio(o.cost, o.clicks) }))
    .sort((a, b) => b.cost - a.cost)

  return { totals, campaigns, keywords, terms, signups, series: dailySeries(daily, signups, from, to, opts.now) }
}

/** One entry per calendar day in the window: spend and clicks from Ads, sign-ups from us. */
export function dailySeries(daily, signups, from, to, now = Date.now()) {
  const dayOf = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  const known = [...daily.map(r => r.day), ...signups.map(s => dayOf(s.signupAt))]
  if (!known.length) return []
  // The whole window (empty days included, so gaps read as gaps); all-time starts at the first data.
  const first = dayOf(from || Math.min(...known))
  const last = dayOf(to === Infinity ? now : Math.min(to - 1, now))
  const out = []
  const at = new Map()
  for (let d = new Date(first); d.getTime() <= last; d.setDate(d.getDate() + 1)) {
    const o = { day: d.getTime(), cost: 0, clicks: 0, signups: 0 }
    out.push(o); at.set(o.day, o)
  }
  for (const r of daily) { const o = at.get(r.day); if (o) { o.cost += r.cost; o.clicks += r.clicks } }
  for (const s of signups) { const o = at.get(dayOf(s.signupAt)); if (o) o.signups++ }
  return out
}
