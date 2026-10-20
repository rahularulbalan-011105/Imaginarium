// ─────────────────────────────────────────────────────────────────────────────
// Where visitors are, derived from the browser's IANA time zone.
//
// WHY THE TIME ZONE AND NOT AN IP LOOKUP
//   An IP geolocation service would be more precise, but it means shipping every
//   visitor's IP address to a third party on page load — a new data processor, a
//   new key to leak, an extra request that ad-blockers eat, and a rate limit.
//   `Intl.DateTimeFormat().resolvedOptions().timeZone` is already in the browser,
//   costs nothing, leaves the page, and is not personal data on its own.
//
// WHAT IT IS AND IS NOT
//   A time zone is a REGION, not an address. "Asia/Kolkata" covers all of India,
//   so every Indian visitor is plotted on one dot at Kolkata's coordinates. Read
//   the globe as "which parts of the world are people coming from", never as
//   "where this person lives". The dashboard labels it that way.
//
// The table below maps the zones a browser actually reports to an anchor city,
// its country and its coordinates. Unknown zones still resolve: the city name is
// taken from the zone itself and the continent gives a rough position, so a new
// or renamed zone shows up in the right part of the world instead of vanishing.
// ─────────────────────────────────────────────────────────────────────────────

// tz → [city, countryCode, country, lat, lon]
const ZONES = {
  // ── Asia ──
  'Asia/Kolkata': ['Kolkata', 'IN', 'India', 22.57, 88.36],
  'Asia/Calcutta': ['Kolkata', 'IN', 'India', 22.57, 88.36],
  'Asia/Colombo': ['Colombo', 'LK', 'Sri Lanka', 6.93, 79.86],
  'Asia/Karachi': ['Karachi', 'PK', 'Pakistan', 24.86, 67.01],
  'Asia/Dhaka': ['Dhaka', 'BD', 'Bangladesh', 23.81, 90.41],
  'Asia/Kathmandu': ['Kathmandu', 'NP', 'Nepal', 27.72, 85.32],
  'Asia/Thimphu': ['Thimphu', 'BT', 'Bhutan', 27.47, 89.64],
  'Asia/Kabul': ['Kabul', 'AF', 'Afghanistan', 34.53, 69.17],
  'Asia/Dubai': ['Dubai', 'AE', 'United Arab Emirates', 25.2, 55.27],
  'Asia/Qatar': ['Doha', 'QA', 'Qatar', 25.29, 51.53],
  'Asia/Riyadh': ['Riyadh', 'SA', 'Saudi Arabia', 24.71, 46.68],
  'Asia/Kuwait': ['Kuwait City', 'KW', 'Kuwait', 29.38, 47.99],
  'Asia/Bahrain': ['Manama', 'BH', 'Bahrain', 26.23, 50.59],
  'Asia/Muscat': ['Muscat', 'OM', 'Oman', 23.59, 58.41],
  'Asia/Tehran': ['Tehran', 'IR', 'Iran', 35.69, 51.39],
  'Asia/Baghdad': ['Baghdad', 'IQ', 'Iraq', 33.31, 44.37],
  'Asia/Jerusalem': ['Jerusalem', 'IL', 'Israel', 31.78, 35.22],
  'Asia/Amman': ['Amman', 'JO', 'Jordan', 31.95, 35.93],
  'Asia/Beirut': ['Beirut', 'LB', 'Lebanon', 33.89, 35.5],
  'Asia/Istanbul': ['Istanbul', 'TR', 'Türkiye', 41.01, 28.98],
  'Europe/Istanbul': ['Istanbul', 'TR', 'Türkiye', 41.01, 28.98],
  'Asia/Tashkent': ['Tashkent', 'UZ', 'Uzbekistan', 41.3, 69.24],
  'Asia/Almaty': ['Almaty', 'KZ', 'Kazakhstan', 43.24, 76.89],
  'Asia/Baku': ['Baku', 'AZ', 'Azerbaijan', 40.41, 49.87],
  'Asia/Tbilisi': ['Tbilisi', 'GE', 'Georgia', 41.72, 44.78],
  'Asia/Yerevan': ['Yerevan', 'AM', 'Armenia', 40.18, 44.51],
  'Asia/Bangkok': ['Bangkok', 'TH', 'Thailand', 13.76, 100.5],
  'Asia/Ho_Chi_Minh': ['Ho Chi Minh City', 'VN', 'Vietnam', 10.82, 106.63],
  'Asia/Saigon': ['Ho Chi Minh City', 'VN', 'Vietnam', 10.82, 106.63],
  'Asia/Phnom_Penh': ['Phnom Penh', 'KH', 'Cambodia', 11.56, 104.92],
  'Asia/Vientiane': ['Vientiane', 'LA', 'Laos', 17.97, 102.63],
  'Asia/Yangon': ['Yangon', 'MM', 'Myanmar', 16.87, 96.2],
  'Asia/Singapore': ['Singapore', 'SG', 'Singapore', 1.35, 103.82],
  'Asia/Kuala_Lumpur': ['Kuala Lumpur', 'MY', 'Malaysia', 3.14, 101.69],
  'Asia/Jakarta': ['Jakarta', 'ID', 'Indonesia', -6.21, 106.85],
  'Asia/Makassar': ['Makassar', 'ID', 'Indonesia', -5.15, 119.43],
  'Asia/Manila': ['Manila', 'PH', 'Philippines', 14.6, 120.98],
  'Asia/Hong_Kong': ['Hong Kong', 'HK', 'Hong Kong', 22.32, 114.17],
  'Asia/Taipei': ['Taipei', 'TW', 'Taiwan', 25.03, 121.57],
  'Asia/Shanghai': ['Shanghai', 'CN', 'China', 31.23, 121.47],
  'Asia/Chongqing': ['Chongqing', 'CN', 'China', 29.56, 106.55],
  'Asia/Urumqi': ['Ürümqi', 'CN', 'China', 43.83, 87.62],
  'Asia/Seoul': ['Seoul', 'KR', 'South Korea', 37.57, 126.98],
  'Asia/Tokyo': ['Tokyo', 'JP', 'Japan', 35.68, 139.69],
  'Asia/Ulaanbaatar': ['Ulaanbaatar', 'MN', 'Mongolia', 47.89, 106.91],
  'Asia/Yekaterinburg': ['Yekaterinburg', 'RU', 'Russia', 56.84, 60.65],
  'Asia/Novosibirsk': ['Novosibirsk', 'RU', 'Russia', 55.01, 82.94],
  'Asia/Vladivostok': ['Vladivostok', 'RU', 'Russia', 43.12, 131.89],
  // ── Europe ──
  'Europe/London': ['London', 'GB', 'United Kingdom', 51.51, -0.13],
  'Europe/Dublin': ['Dublin', 'IE', 'Ireland', 53.35, -6.26],
  'Europe/Lisbon': ['Lisbon', 'PT', 'Portugal', 38.72, -9.14],
  'Europe/Madrid': ['Madrid', 'ES', 'Spain', 40.42, -3.7],
  'Europe/Paris': ['Paris', 'FR', 'France', 48.86, 2.35],
  'Europe/Brussels': ['Brussels', 'BE', 'Belgium', 50.85, 4.35],
  'Europe/Amsterdam': ['Amsterdam', 'NL', 'Netherlands', 52.37, 4.9],
  'Europe/Berlin': ['Berlin', 'DE', 'Germany', 52.52, 13.41],
  'Europe/Zurich': ['Zurich', 'CH', 'Switzerland', 47.38, 8.54],
  'Europe/Vienna': ['Vienna', 'AT', 'Austria', 48.21, 16.37],
  'Europe/Rome': ['Rome', 'IT', 'Italy', 41.9, 12.5],
  'Europe/Athens': ['Athens', 'GR', 'Greece', 37.98, 23.73],
  'Europe/Prague': ['Prague', 'CZ', 'Czechia', 50.08, 14.44],
  'Europe/Warsaw': ['Warsaw', 'PL', 'Poland', 52.23, 21.01],
  'Europe/Budapest': ['Budapest', 'HU', 'Hungary', 47.5, 19.04],
  'Europe/Bucharest': ['Bucharest', 'RO', 'Romania', 44.43, 26.1],
  'Europe/Sofia': ['Sofia', 'BG', 'Bulgaria', 42.7, 23.32],
  'Europe/Belgrade': ['Belgrade', 'RS', 'Serbia', 44.79, 20.45],
  'Europe/Zagreb': ['Zagreb', 'HR', 'Croatia', 45.81, 15.98],
  'Europe/Copenhagen': ['Copenhagen', 'DK', 'Denmark', 55.68, 12.57],
  'Europe/Oslo': ['Oslo', 'NO', 'Norway', 59.91, 10.75],
  'Europe/Stockholm': ['Stockholm', 'SE', 'Sweden', 59.33, 18.07],
  'Europe/Helsinki': ['Helsinki', 'FI', 'Finland', 60.17, 24.94],
  'Europe/Tallinn': ['Tallinn', 'EE', 'Estonia', 59.44, 24.75],
  'Europe/Riga': ['Riga', 'LV', 'Latvia', 56.95, 24.11],
  'Europe/Vilnius': ['Vilnius', 'LT', 'Lithuania', 54.69, 25.28],
  'Europe/Kiev': ['Kyiv', 'UA', 'Ukraine', 50.45, 30.52],
  'Europe/Kyiv': ['Kyiv', 'UA', 'Ukraine', 50.45, 30.52],
  'Europe/Minsk': ['Minsk', 'BY', 'Belarus', 53.9, 27.57],
  'Europe/Moscow': ['Moscow', 'RU', 'Russia', 55.76, 37.62],
  // ── Africa ──
  'Africa/Cairo': ['Cairo', 'EG', 'Egypt', 30.04, 31.24],
  'Africa/Casablanca': ['Casablanca', 'MA', 'Morocco', 33.57, -7.59],
  'Africa/Algiers': ['Algiers', 'DZ', 'Algeria', 36.75, 3.06],
  'Africa/Tunis': ['Tunis', 'TN', 'Tunisia', 36.81, 10.18],
  'Africa/Tripoli': ['Tripoli', 'LY', 'Libya', 32.89, 13.19],
  'Africa/Lagos': ['Lagos', 'NG', 'Nigeria', 6.52, 3.38],
  'Africa/Accra': ['Accra', 'GH', 'Ghana', 5.6, -0.19],
  'Africa/Abidjan': ['Abidjan', 'CI', "Côte d'Ivoire", 5.36, -4.01],
  'Africa/Dakar': ['Dakar', 'SN', 'Senegal', 14.72, -17.47],
  'Africa/Nairobi': ['Nairobi', 'KE', 'Kenya', -1.29, 36.82],
  'Africa/Kampala': ['Kampala', 'UG', 'Uganda', 0.35, 32.58],
  'Africa/Dar_es_Salaam': ['Dar es Salaam', 'TZ', 'Tanzania', -6.79, 39.21],
  'Africa/Addis_Ababa': ['Addis Ababa', 'ET', 'Ethiopia', 9.01, 38.76],
  'Africa/Khartoum': ['Khartoum', 'SD', 'Sudan', 15.5, 32.56],
  'Africa/Kinshasa': ['Kinshasa', 'CD', 'DR Congo', -4.44, 15.27],
  'Africa/Luanda': ['Luanda', 'AO', 'Angola', -8.84, 13.23],
  'Africa/Harare': ['Harare', 'ZW', 'Zimbabwe', -17.83, 31.05],
  'Africa/Lusaka': ['Lusaka', 'ZM', 'Zambia', -15.39, 28.32],
  'Africa/Johannesburg': ['Johannesburg', 'ZA', 'South Africa', -26.2, 28.05],
  'Indian/Mauritius': ['Port Louis', 'MU', 'Mauritius', -20.16, 57.5],
  // ── Americas ──
  'America/New_York': ['New York', 'US', 'United States', 40.71, -74.01],
  'America/Detroit': ['Detroit', 'US', 'United States', 42.33, -83.05],
  'America/Toronto': ['Toronto', 'CA', 'Canada', 43.65, -79.38],
  'America/Montreal': ['Montreal', 'CA', 'Canada', 45.5, -73.57],
  'America/Chicago': ['Chicago', 'US', 'United States', 41.88, -87.63],
  'America/Winnipeg': ['Winnipeg', 'CA', 'Canada', 49.9, -97.14],
  'America/Denver': ['Denver', 'US', 'United States', 39.74, -104.99],
  'America/Phoenix': ['Phoenix', 'US', 'United States', 33.45, -112.07],
  'America/Edmonton': ['Edmonton', 'CA', 'Canada', 53.55, -113.49],
  'America/Los_Angeles': ['Los Angeles', 'US', 'United States', 34.05, -118.24],
  'America/Vancouver': ['Vancouver', 'CA', 'Canada', 49.28, -123.12],
  'America/Anchorage': ['Anchorage', 'US', 'United States', 61.22, -149.9],
  'Pacific/Honolulu': ['Honolulu', 'US', 'United States', 21.31, -157.86],
  'America/Mexico_City': ['Mexico City', 'MX', 'Mexico', 19.43, -99.13],
  'America/Guatemala': ['Guatemala City', 'GT', 'Guatemala', 14.63, -90.51],
  'America/Panama': ['Panama City', 'PA', 'Panama', 8.98, -79.52],
  'America/Havana': ['Havana', 'CU', 'Cuba', 23.11, -82.37],
  'America/Santo_Domingo': ['Santo Domingo', 'DO', 'Dominican Republic', 18.49, -69.93],
  'America/Puerto_Rico': ['San Juan', 'PR', 'Puerto Rico', 18.47, -66.11],
  'America/Bogota': ['Bogotá', 'CO', 'Colombia', 4.71, -74.07],
  'America/Lima': ['Lima', 'PE', 'Peru', -12.05, -77.04],
  'America/Caracas': ['Caracas', 'VE', 'Venezuela', 10.49, -66.88],
  'America/Santiago': ['Santiago', 'CL', 'Chile', -33.45, -70.67],
  'America/Argentina/Buenos_Aires': ['Buenos Aires', 'AR', 'Argentina', -34.6, -58.38],
  'America/Sao_Paulo': ['São Paulo', 'BR', 'Brazil', -23.55, -46.63],
  'America/Fortaleza': ['Fortaleza', 'BR', 'Brazil', -3.73, -38.52],
  'America/Manaus': ['Manaus', 'BR', 'Brazil', -3.12, -60.02],
  'America/Montevideo': ['Montevideo', 'UY', 'Uruguay', -34.9, -56.16],
  'America/La_Paz': ['La Paz', 'BO', 'Bolivia', -16.5, -68.15],
  'America/Asuncion': ['Asunción', 'PY', 'Paraguay', -25.26, -57.58],
  // ── Oceania ──
  'Australia/Sydney': ['Sydney', 'AU', 'Australia', -33.87, 151.21],
  'Australia/Melbourne': ['Melbourne', 'AU', 'Australia', -37.81, 144.96],
  'Australia/Brisbane': ['Brisbane', 'AU', 'Australia', -27.47, 153.03],
  'Australia/Adelaide': ['Adelaide', 'AU', 'Australia', -34.93, 138.6],
  'Australia/Perth': ['Perth', 'AU', 'Australia', -31.95, 115.86],
  'Pacific/Auckland': ['Auckland', 'NZ', 'New Zealand', -36.85, 174.76],
  'Pacific/Fiji': ['Suva', 'FJ', 'Fiji', -18.14, 178.44],
  'Pacific/Port_Moresby': ['Port Moresby', 'PG', 'Papua New Guinea', -9.44, 147.18],
}

// Rough centre of each continent, for a zone that isn't in the table.
const REGIONS = {
  Asia: ['Asia', 34.0, 100.0],
  Europe: ['Europe', 50.0, 15.0],
  Africa: ['Africa', 2.0, 21.0],
  America: ['Americas', 15.0, -90.0],
  Australia: ['Oceania', -25.0, 134.0],
  Pacific: ['Oceania', -10.0, 170.0],
  Atlantic: ['Atlantic', 35.0, -30.0],
  Indian: ['Indian Ocean', -10.0, 75.0],
  Antarctica: ['Antarctica', -75.0, 0.0],
  Arctic: ['Arctic', 78.0, 20.0],
  US: ['Americas', 39.0, -98.0],
  Canada: ['Americas', 56.0, -106.0],
  Brazil: ['Americas', -10.0, -52.0],
  Etc: ['Unknown', 0, 0],
}

/** Zone → place. Always returns something, so no visitor is silently dropped. */
export function placeOfZone(tz) {
  const zone = String(tz || '').trim()
  if (!zone) return { key: '(unknown)', city: 'Unknown', country: 'Unknown', cc: '', lat: null, lon: null, exact: false }
  const hit = ZONES[zone]
  if (hit) {
    const [city, cc, country, lat, lon] = hit
    return { key: zone, city, country, cc, lat, lon, exact: true }
  }
  // Unknown zone: the second half of an IANA name IS a place name, and the first
  // half puts it on the right continent — better than throwing the visitor away.
  const [region, ...rest] = zone.split('/')
  const city = (rest.pop() || region).replace(/_/g, ' ')
  const r = REGIONS[region]
  return r
    ? { key: zone, city, country: r[0], cc: '', lat: r[1], lon: r[2], exact: false }
    : { key: zone, city, country: 'Unknown', cc: '', lat: null, lon: null, exact: false }
}

/** Two-letter country from a BCP-47 tag ("en-IN" → "IN"); '' when absent. */
export function countryOfLang(lang) {
  const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(String(lang || ''))
  return m ? m[1].toUpperCase() : ''
}

/**
 * Where a set of events came from.
 * Counts unique visitors (vid) per place — a visitor is counted once per place,
 * so a chatty session cannot inflate a dot.
 * @returns {Array<{key,city,country,cc,lat,lon,exact,visitors,users,events}>}
 */
export function placesOf(events) {
  const by = new Map()
  for (const e of events) {
    if (!e.tz) continue
    const p = placeOfZone(e.tz)
    let row = by.get(p.key)
    if (!row) by.set(p.key, row = { ...p, vids: new Set(), emails: new Set(), events: 0 })
    row.events++
    if (e.vid) row.vids.add(e.vid)
    if (e.who) row.emails.add(e.who)
  }
  return [...by.values()]
    .map(({ vids, emails, ...r }) => ({ ...r, visitors: vids.size, users: emails.size }))
    .sort((a, b) => b.visitors - a.visitors || b.events - a.events)
}

/** Same rows folded to one per country, for the country table. */
export function countriesOf(places) {
  const by = new Map()
  for (const p of places) {
    let row = by.get(p.country)
    if (!row) by.set(p.country, row = { country: p.country, cc: p.cc, visitors: 0, users: 0, events: 0, cities: [] })
    row.visitors += p.visitors
    row.users += p.users
    row.events += p.events
    row.cities.push(p.city)
  }
  return [...by.values()].sort((a, b) => b.visitors - a.visitors)
}
