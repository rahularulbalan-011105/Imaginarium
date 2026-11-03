import { describe, it, expect } from 'vitest'
import { parseRows, resolveIdentities, makeExcluder } from '../../src/dashboard/analyze.js'
import { parseAds, adsReport, adsRange, dayMs, dailySeries } from '../../src/dashboard/adsAnalyze.js'

const H = ['received', 'env', 'eid', 'app', 'event', 'email', 'vid', 'sid', 'source', 'medium', 'campaign', 'content', 'term', 'ref', 'referrer', 'page', 'device', 'value', 'meta', 'client_ts']
let n = 0
// Local-time event on 2026-10-<day> at <hour>:00.
function row(day, hour, app, event, o = {}) {
  return [new Date(2026, 9, day, hour).toISOString(), o.env || 'prod', 'e' + (++n), app, event, o.email || '', o.vid || '', o.sid || '',
    o.source || '(direct)', o.medium || '', o.campaign || '', o.content || '', o.term || '', '', '', '', 'desktop', o.value ?? '', '', '']
}
const AD1 = { source: 'google', medium: 'cpc', campaign: '111', content: '901', term: 'robot kit for kids' }
const BARE = { source: 'google', medium: 'cpc' }                 // gclid only, no suffix
const ORGANIC = { source: 'google', medium: 'referral' }

const ADS = {
  daily: {
    headers: ['date', 'campaign_id', 'campaign', 'status', 'channel', 'impressions', 'clicks', 'cost', 'conversions', 'conv_value'],
    rows: [
      ['2026-10-10', '111', 'Robots – Search', 'ENABLED', 'SEARCH', '1000', '50', '500', '2', '0'],
      ['2026-10-11', '111', 'Robots – Search', 'ENABLED', 'SEARCH', '1000', '30', '300', '1', '0'],
      ['2026-10-11', '222', 'Brand', 'PAUSED', 'SEARCH', '200', '20', '100', '0', '0'],
      ['2026-09-01', '111', 'Old name', 'ENABLED', 'SEARCH', '10', '1', '9', '0', '0'],
    ],
  },
  keywords: {
    headers: ['date', 'campaign_id', 'ad_group_id', 'ad_group', 'keyword', 'match_type', 'impressions', 'clicks', 'cost', 'conversions'],
    rows: [
      ['2026-10-10', '111', '901', 'Kits', 'Robot Kit For Kids', 'PHRASE', '600', '40', '400', '2'],
      ['2026-10-11', '111', '901', 'Kits', 'robot kit for kids', 'PHRASE', '400', '20', '200', '1'],
    ],
  },
  terms: { headers: ['date', 'campaign_id', 'search_term', 'impressions', 'clicks', 'cost', 'conversions'], rows: [['2026-10-10', '111', 'robot kit', '100', '10', '90', '0']] },
  meta: { headers: ['synced', 'account', 'customer_id', 'currency', 'time_zone', 'days'], rows: [['2026-10-12T00:00:00Z', 'AtumX', '123', 'INR', 'Asia/Kolkata', '90']] },
}

function events() {
  return resolveIdentities(parseRows(H, [
    // Asha: ad click → sign-up → builds
    row(10, 9, 'landing', 'landing_view', { vid: 'vA', sid: 'lA', ...AD1 }),
    row(10, 9, 'landing', 'signup', { vid: 'vA', sid: 'lA', email: 'asha@x.com', ...AD1 }),
    row(10, 10, 'editor', 'editor_open', { vid: 'vA', sid: 'sA', email: 'asha@x.com', ...AD1 }),
    row(10, 10, 'editor', 'code_run', { vid: 'vA', sid: 'sA', email: 'asha@x.com', ...AD1 }),
    // Ben: bare gclid click → sign-up, never opens the workshop
    row(11, 9, 'landing', 'landing_view', { vid: 'vB', sid: 'lB', ...BARE }),
    row(11, 9, 'landing', 'signup', { vid: 'vB', sid: 'lB', email: 'ben@x.com', ...BARE }),
    // Organic Google visitor who signs up — must NOT count as an ad sign-up
    row(11, 12, 'landing', 'landing_view', { vid: 'vC', sid: 'lC', ...ORGANIC }),
    row(11, 12, 'landing', 'signup', { vid: 'vC', sid: 'lC', email: 'chen@x.com', ...ORGANIC }),
    // Internal tester through an ad
    row(11, 13, 'landing', 'landing_view', { vid: 'vT', sid: 'lT', ...AD1 }),
    row(11, 13, 'landing', 'signup', { vid: 'vT', sid: 'lT', email: 'me@atumx.in', ...AD1 }),
  ]))
}

const OCT10 = new Date(2026, 9, 10).getTime(), OCT12 = new Date(2026, 9, 12).getTime()
const report = (o = {}) => adsReport(parseAds(ADS), events(), { from: OCT10, to: OCT12, exclude: makeExcluder('@atumx.in'), now: OCT12, ...o })

describe('parseAds', () => {
  it('types numbers and turns dates into local midnights', () => {
    const a = parseAds(ADS)
    expect(a.daily[0].cost).toBe(500)
    expect(a.daily[0].day).toBe(OCT10)
    expect(a.meta.currency).toBe('INR')
  })
  it('treats missing tabs as empty (Ads Script not set up yet)', () => {
    const a = parseAds({ daily: { headers: [], rows: [] } })
    expect(a.daily).toEqual([]); expect(a.keywords).toEqual([]); expect(a.meta).toBe(null)
  })
  it('drops rows without a valid date', () => {
    expect(dayMs('')).toBeNaN()
    expect(parseAds({ daily: { headers: ['date', 'cost'], rows: [['x', '5']] } }).daily).toEqual([])
  })
})

describe('adsReport', () => {
  it('totals Google numbers for the window only', () => {
    const t = report().totals
    expect(t.cost).toBe(900); expect(t.clicks).toBe(100); expect(t.impressions).toBe(2200); expect(t.conversions).toBe(3)
    expect(t.ctr).toBeCloseTo(100 / 2200); expect(t.cpc).toBe(9)
  })
  it('counts only paid Google visitors as ad sign-ups, minus internal emails', () => {
    const t = report().totals
    expect(t.signups).toBe(2)               // asha + ben; not chen (organic), not me@atumx.in
    expect(t.visitors).toBe(2)
    expect(t.builders).toBe(1)
    expect(t.costPerSignup).toBe(450)
    expect(t.costPerBuilder).toBe(900)
  })
  it('joins campaigns on id and keeps untagged ad clicks visible', () => {
    const c = Object.fromEntries(report().campaigns.map(x => [x.id, x]))
    expect(c['111']).toMatchObject({ name: 'Robots – Search', cost: 800, signups: 1, builders: 1, costPerSignup: 800 })
    expect(c['222']).toMatchObject({ name: 'Brand', cost: 100, signups: 0, costPerSignup: null })
    expect(c['']).toMatchObject({ name: '(no campaign tag)', cost: 0, signups: 1, costPerSignup: null })
  })
  it('filters everything to one campaign', () => {
    const r = report({ campaign: '222' })
    expect(r.totals.cost).toBe(100); expect(r.totals.signups).toBe(0); expect(r.signups).toEqual([])
  })
  it('matches sign-ups to keywords by ad group + keyword, case-insensitively', () => {
    const [k] = report().keywords
    expect(k).toMatchObject({ keyword: 'Robot Kit For Kids', clicks: 60, cost: 600, signups: 1, costPerSignup: 600 })
  })
  it('lists the ad sign-ups with what they did', () => {
    const s = report().signups
    expect(s.map(x => x.email)).toEqual(['ben@x.com', 'asha@x.com'])
    expect(s[1]).toMatchObject({ campaign: 'Robots – Search', keyword: 'robot kit for kids', openedWorkshop: true, built: true })
    expect(s[0]).toMatchObject({ campaign: '(no campaign tag)', openedWorkshop: false })
  })
})

describe('adsRange / dailySeries', () => {
  it('presets are whole calendar days ending today', () => {
    const now = new Date(2026, 9, 12, 15).getTime()
    expect(adsRange('1', '', '', now).from).toBe(new Date(2026, 9, 12).getTime())
    expect(adsRange('7', '', '', now).from).toBe(new Date(2026, 9, 6).getTime())
    expect(adsRange('custom', '2026-10-10', '2026-10-11', now)).toEqual({ from: OCT10, to: OCT12 })
  })
  it('has one entry per day, gaps included', () => {
    const r = report()
    expect(r.series.map(d => [d.cost, d.signups])).toEqual([[500, 1], [400, 1]])
    const s = dailySeries([], [{ signupAt: OCT10 + 3600e3 }], new Date(2026, 9, 8).getTime(), OCT12, OCT12)
    expect(s.map(d => d.signups)).toEqual([0, 0, 1, 0])
  })
})
