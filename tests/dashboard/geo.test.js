// Visitor-location tests: the time-zone lookup, the per-place aggregation, and
// the contract between the collector's columns and the dashboard's parser.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { placeOfZone, countryOfLang, placesOf, countriesOf } from '../../src/dashboard/geo.js'
import { parseRows, resolveIdentities, analyze } from '../../src/dashboard/analyze.js'
import { LAND_RINGS } from '../../src/dashboard/world-land.js'

describe('time zone → place', () => {
  it('resolves the zones our visitors actually report', () => {
    const kol = placeOfZone('Asia/Kolkata')
    expect(kol).toMatchObject({ city: 'Kolkata', country: 'India', cc: 'IN', exact: true })
    expect(kol.lat).toBeCloseTo(22.57, 1)
    expect(placeOfZone('Asia/Calcutta').country).toBe('India')   // legacy alias
    expect(placeOfZone('America/New_York')).toMatchObject({ country: 'United States', exact: true })
    expect(placeOfZone('Europe/London')).toMatchObject({ country: 'United Kingdom', exact: true })
  })

  it('never drops a visitor whose zone is not in the table', () => {
    const p = placeOfZone('Asia/Srednekolymsk')
    expect(p.exact).toBe(false)
    expect(p.city).toBe('Srednekolymsk')
    expect(p.country).toBe('Asia')          // continent anchor, so it still plots
    expect(Number.isFinite(p.lat)).toBe(true)
    const deep = placeOfZone('America/Argentina/Ushuaia')
    expect(deep.city).toBe('Ushuaia')
  })

  it('handles a missing zone without throwing', () => {
    for (const bad of [undefined, null, '', '   ']) {
      const p = placeOfZone(bad)
      expect(p.lat).toBe(null)
      expect(p.city).toBe('Unknown')
    }
  })

  it('every table entry has plausible coordinates', () => {
    // Walk a representative sample through the public API.
    for (const tz of ['Asia/Tokyo', 'Africa/Lagos', 'Australia/Perth', 'America/Sao_Paulo', 'Europe/Berlin']) {
      const p = placeOfZone(tz)
      expect(p.exact, tz).toBe(true)
      expect(Math.abs(p.lat), tz).toBeLessThanOrEqual(90)
      expect(Math.abs(p.lon), tz).toBeLessThanOrEqual(180)
    }
  })

  it('reads the country out of a language tag', () => {
    expect(countryOfLang('en-IN')).toBe('IN')
    expect(countryOfLang('pt-BR')).toBe('BR')
    expect(countryOfLang('en')).toBe('')
    expect(countryOfLang('')).toBe('')
  })
})

describe('places aggregation', () => {
  const evs = [
    { tz: 'Asia/Kolkata', vid: 'v1', who: 'a@x.com' },
    { tz: 'Asia/Kolkata', vid: 'v1', who: 'a@x.com' },   // same browser again
    { tz: 'Asia/Kolkata', vid: 'v2', who: '' },
    { tz: 'Europe/London', vid: 'v3', who: 'b@x.com' },
    { tz: '', vid: 'v4', who: '' },                       // no zone → not plotted
  ]

  it('counts each visitor once per place', () => {
    const places = placesOf(evs)
    expect(places).toHaveLength(2)
    const india = places.find(p => p.country === 'India')
    expect(india.visitors).toBe(2)     // v1 and v2, not three events
    expect(india.events).toBe(3)
    expect(india.users).toBe(1)
    expect(places[0].visitors).toBeGreaterThanOrEqual(places[1].visitors)   // sorted
  })

  it('folds places into countries', () => {
    const c = countriesOf(placesOf([...evs, { tz: 'Asia/Calcutta', vid: 'v9', who: '' }]))
    expect(c[0].country).toBe('India')
    expect(c[0].visitors).toBe(3)
    expect(c.map(r => r.country)).toContain('United Kingdom')
  })
})

describe('collector ↔ dashboard column contract', () => {
  const gs = readFileSync('docs/utm-collector.gs', 'utf8')
  const headers = JSON.parse(
    /var EVENT_HEADERS = (\[[^\]]*\])/.exec(gs)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'),
  )

  it('ships the location columns last, so older rows keep their meaning', () => {
    expect(headers.slice(0, 20)).toEqual([
      'received', 'env', 'eid', 'app', 'event', 'email', 'vid', 'sid',
      'source', 'medium', 'campaign', 'content', 'term', 'ref', 'referrer',
      'page', 'device', 'value', 'meta', 'client_ts',
    ])
    expect(headers.slice(20)).toEqual(['tz', 'lang'])
  })

  it('writes exactly one value per column', () => {
    const body = /tab_\(EVENTS_TAB, EVENT_HEADERS\)\.appendRow\(\[([\s\S]*?)\]\);/.exec(gs)[1]
    // Count top-level commas (ignore those inside calls, strings and comments).
    const cleaned = body.replace(/\/\/[^\n]*/g, '').replace(/'[^']*'/g, "''")
    let depth = 0, fields = 1
    for (const ch of cleaned) {
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
      else if (ch === ',' && depth === 0) fields++
    }
    expect(fields).toBe(headers.length)
  })

  it('parses a row that has the new columns, and one that does not', () => {
    const withGeo = ['2026-10-20T10:00:00Z', 'prod', 'e1', 'editor', 'editor_open', 'a@x.com', 'v1', 's1',
      'whatsapp', 'chat', 'launch', '', '', '', '', '/', 'desktop', '', '', '', 'Asia/Kolkata', 'en-IN']
    const legacy = ['2026-10-20T10:05:00Z', 'prod', 'e2', 'editor', 'editor_open', 'b@x.com', 'v2', 's2',
      'whatsapp', 'chat', 'launch', '', '', '', '', '/', 'desktop', '', '', '']
    const parsed = parseRows(headers, [withGeo, legacy])
    expect(parsed).toHaveLength(2)
    expect(parsed[0].tz).toBe('Asia/Kolkata')
    expect(parsed[0].lang).toBe('en-IN')
    expect(parsed[1].tz).toBe('')          // pre-location row, not a crash
  })

  it('analyze() reports the places and an honest located share', () => {
    const rows = [
      ['2026-10-20T10:00:00Z', 'prod', 'e1', 'editor', 'editor_open', 'a@x.com', 'v1', 's1', 'whatsapp', '', '', '', '', '', '', '/', 'desktop', '', '', '', 'Asia/Kolkata', 'en-IN'],
      ['2026-10-20T10:01:00Z', 'prod', 'e2', 'editor', 'editor_open', 'b@x.com', 'v2', 's2', 'whatsapp', '', '', '', '', '', '', '/', 'desktop', '', '', '', 'Europe/London', 'en-GB'],
      ['2026-10-20T10:02:00Z', 'prod', 'e3', 'editor', 'editor_open', 'c@x.com', 'v3', 's3', 'whatsapp', '', '', '', '', '', '', '/', 'desktop', '', '', ''],
    ]
    const r = analyze(resolveIdentities(parseRows(headers, rows)), {})
    expect(r.totals.visitors).toBe(3)
    expect(r.totals.locatedVisitors).toBe(2)       // the third row carries no zone
    expect(r.places.map(p => p.country).sort()).toEqual(['India', 'United Kingdom'])
    expect(r.countries).toHaveLength(2)
  })
})

describe('globe land data', () => {
  it('is a set of flat lon/lat rings inside the world', () => {
    expect(LAND_RINGS.length).toBeGreaterThan(50)
    for (const ring of LAND_RINGS) {
      expect(ring.length % 2).toBe(0)
      for (let i = 0; i < ring.length; i += 2) {
        expect(Math.abs(ring[i])).toBeLessThanOrEqual(180.1)
        expect(Math.abs(ring[i + 1])).toBeLessThanOrEqual(90.1)
      }
    }
  })
})
