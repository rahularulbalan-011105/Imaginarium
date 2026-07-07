// ─────────────────────────────────────────────────────────────────────────────
// utmTracking — lightweight, backend-free UTM capture for the deployed app.
//
// On startup it reads ?utm_source=…&utm_medium=… (etc.) from the URL, records ONE
// visit per browser tab-session, and stores it in localStorage. The bundled
// /utm-dashboard.html (same origin) reads that same store to show where traffic
// came from, plus a UTM link builder.
//
// SCOPE: this is a *client-side* tracker. localStorage is per-browser, so the
// dashboard only sees visits captured in the browser it's opened in — ideal for
// your own testing/QA of campaign links. To aggregate real visitors across
// devices you need a collector: set COLLECTOR_ENDPOINT below to a URL that
// accepts a POST (Netlify Function, Google Apps Script, Cloudflare Worker, …)
// and each visit is also beacon-sent there. Left '' = local-only, no network.
// ─────────────────────────────────────────────────────────────────────────────

const STORE_KEY       = 'utm_visits_v1'       // array of visit records
const FIRST_TOUCH_KEY = 'utm_first_touch_v1'  // first campaign that ever brought this browser
const SESSION_FLAG    = 'utm_logged_session'  // one visit per tab-session (sessionStorage)
const MAX_VISITS      = 1000                   // ring-buffer cap so storage can't grow forever

// ── SERVER COLLECTOR ──────────────────────────────────────────────────────────
// Paste your Google Apps Script Web-app URL here to aggregate clicks from ALL
// visitors (see docs/UTM-SETUP.md). '' = local-only (this browser). After
// setting it you must rebuild + redeploy for visitors to start reporting.
//   e.g. const COLLECTOR_ENDPOINT = 'https://script.google.com/macros/s/AKfy…/exec'
const COLLECTOR_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxgWlc_0ZkVdtNGznRm1pCRmKZes18Yrm_XzgDknByKcRfiHxfNh6lfgM0EWIi2SKc0sw/exec'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

function safeParse(json, fallback) {
  try { const v = JSON.parse(json); return v ?? fallback } catch { return fallback }
}

export function getVisits() {
  return safeParse(localStorage.getItem(STORE_KEY), [])
}

export function getFirstTouch() {
  return safeParse(localStorage.getItem(FIRST_TOUCH_KEY), null)
}

export function clearVisits() {
  localStorage.removeItem(STORE_KEY)
  localStorage.removeItem(FIRST_TOUCH_KEY)
}

// Read utm_* from a query string into a plain object (only keys that are present).
function readUtmParams(search) {
  const params = new URLSearchParams(search)
  const utm = {}
  for (const k of UTM_KEYS) {
    const v = params.get(k)
    if (v) utm[k] = v.slice(0, 200)   // guard against absurdly long values
  }
  return utm
}

// Capture the current page load as a visit. Call once at app startup.
// Returns the recorded visit, or null if this tab-session was already logged.
export function captureUTM() {
  if (typeof window === 'undefined') return null

  // One visit per tab-session so SPA re-renders / route changes don't inflate counts.
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return null
    sessionStorage.setItem(SESSION_FLAG, '1')
  } catch { /* private mode — fall through and just record */ }

  const utm = readUtmParams(window.location.search)
  const tagged = Object.keys(utm).length > 0

  const visit = {
    source:   utm.utm_source   || '(direct)',
    medium:   utm.utm_medium   || (tagged ? '(not set)' : '(none)'),
    campaign: utm.utm_campaign || '(not set)',
    term:     utm.utm_term     || '',
    content:  utm.utm_content  || '',
    tagged,
    referrer: document.referrer || '',
    landing:  window.location.pathname + window.location.search,
    ts:       new Date().toISOString(),
    ua:       navigator.userAgent,
  }

  // Append to the ring buffer.
  const visits = getVisits()
  visits.push(visit)
  while (visits.length > MAX_VISITS) visits.shift()
  try { localStorage.setItem(STORE_KEY, JSON.stringify(visits)) } catch { /* storage full/blocked */ }

  // First-touch attribution: remember the first campaign that ever landed here.
  if (!getFirstTouch()) {
    try { localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(visit)) } catch { /* ignore */ }
  }

  // Optional: forward to a backend collector for cross-visitor aggregation.
  // Sent as text/plain (a "simple" request) so there's NO CORS preflight —
  // Apps Script can't answer preflight, so an application/json POST would fail.
  if (COLLECTOR_ENDPOINT) {
    try {
      const payload = JSON.stringify(visit)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(COLLECTOR_ENDPOINT, new Blob([payload], { type: 'text/plain;charset=UTF-8' }))
      } else {
        fetch(COLLECTOR_ENDPOINT, { method: 'POST', body: payload, mode: 'no-cors', keepalive: true })
      }
    } catch { /* network best-effort */ }
  }

  return visit
}

// Build a campaign URL from a base + utm fields (used by the dashboard's builder).
export function buildUtmUrl(baseUrl, fields) {
  let url
  try { url = new URL(baseUrl) } catch { return '' }
  for (const k of UTM_KEYS) {
    const v = fields[k]
    if (v) url.searchParams.set(k, v)
    else   url.searchParams.delete(k)
  }
  return url.toString()
}
