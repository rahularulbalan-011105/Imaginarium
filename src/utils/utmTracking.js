// ─────────────────────────────────────────────────────────────────────────────
// utmTracking — backend-free visit analytics for the deployed app.
//
// Captures ONE record per browser tab-session with the full schema:
//   timestamp · source · campaign · ref · landing_page · country · device_type
//   is_returning_visitor · popup_action · session_duration (+ medium/term/content).
//
// The record is written to localStorage immediately (the bundled
// /utm-dashboard.html reads it), enriched with country asynchronously, and sent
// ONCE to the collector at session end (pagehide / tab hidden) so it carries the
// final session_duration and popup_action. Set COLLECTOR_ENDPOINT to a Google
// Apps Script Web-app URL to aggregate across visitors (see docs/UTM-SETUP.md).
// ─────────────────────────────────────────────────────────────────────────────

const STORE_KEY       = 'utm_visits_v1'
const FIRST_TOUCH_KEY = 'utm_first_touch_v1'
const RETURN_KEY      = 'utm_visitor_v1'      // presence → returning visitor
const SESSION_FLAG    = 'utm_logged_session'  // one record per tab-session
const MAX_VISITS      = 1000

const COLLECTOR_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxgWlc_0ZkVdtNGznRm1pCRmKZes18Yrm_XzgDknByKcRfiHxfNh6lfgM0EWIi2SKc0sw/exec'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

let _session = null      // current session's mutable record
let _startMs = 0
let _sent = false

// ── helpers ───────────────────────────────────────────────────────────────────
function safeParse(json, fb) { try { const v = JSON.parse(json); return v ?? fb } catch { return fb } }
function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() }
function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } }

function deviceType() {
  const ua = navigator.userAgent || ''
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean')
    return navigator.userAgentData.mobile ? 'mobile' : 'desktop'
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

function isReturning() {
  try { const seen = localStorage.getItem(RETURN_KEY); localStorage.setItem(RETURN_KEY, '1'); return !!seen }
  catch { return false }
}

// Infer a source from the referrer host when there's no utm_source.
function referrerSource() {
  try {
    const h = new URL(document.referrer).hostname.replace(/^www\./, '')
    if (!h) return '(direct)'
    if (h.includes('instagram')) return 'instagram'
    if (h.includes('linkedin')) return 'linkedin'
    if (h.includes('whatsapp') || h.includes('wa.me')) return 'whatsapp'
    if (h.includes('twitter') || h.includes('x.com') || h === 't.co') return 'twitter'
    if (h.includes('facebook') || h.startsWith('fb.') || h.includes('fb.me')) return 'facebook'
    if (h.includes('youtube') || h.includes('youtu.be')) return 'youtube'
    if (h.includes('google')) return 'google'
    return h
  } catch { return '(direct)' }
}

// Best-effort country via a free, no-key, CORS-enabled IP geolocation service.
function lookupCountry() {
  return fetch('https://ipwho.is/', { cache: 'no-store' })
    .then(r => r.json())
    .then(d => (d && d.success !== false) ? (d.country || d.country_code || '') : '')
    .catch(() => '')
}

function readUtmParams(search) {
  const params = new URLSearchParams(search)
  const utm = {}
  for (const k of UTM_KEYS) { const v = params.get(k); if (v) utm[k] = v.slice(0, 200) }
  return utm
}

export function getVisits() { return safeParse(localStorage.getItem(STORE_KEY), []) }
export function getFirstTouch() { return safeParse(localStorage.getItem(FIRST_TOUCH_KEY), null) }
export function clearVisits() { localStorage.removeItem(STORE_KEY); localStorage.removeItem(FIRST_TOUCH_KEY) }

// Insert-or-update the current session's record in localStorage (by id).
function localUpsert(rec) {
  try {
    const arr = getVisits()
    const i = arr.findIndex(v => v.id === rec.id)
    if (i >= 0) arr[i] = { ...rec }; else arr.push({ ...rec })
    while (arr.length > MAX_VISITS) arr.shift()
    localStorage.setItem(STORE_KEY, JSON.stringify(arr))
  } catch { /* storage full/blocked */ }
}

// Send as text/plain (a "simple" request) so there's NO CORS preflight.
function sendToServer(rec) {
  if (!COLLECTOR_ENDPOINT) return
  try {
    const payload = JSON.stringify(rec)
    if (navigator.sendBeacon) navigator.sendBeacon(COLLECTOR_ENDPOINT, new Blob([payload], { type: 'text/plain;charset=UTF-8' }))
    else fetch(COLLECTOR_ENDPOINT, { method: 'POST', body: payload, mode: 'no-cors', keepalive: true })
  } catch { /* best-effort */ }
}

// ── public: capture the visit (call once at startup) ──────────────────────────
export function captureUTM() {
  if (typeof window === 'undefined') return null
  try { if (sessionStorage.getItem(SESSION_FLAG)) return null; sessionStorage.setItem(SESSION_FLAG, '1') } catch { /* private mode */ }

  const utm = readUtmParams(window.location.search)
  const params = new URLSearchParams(window.location.search)
  const tagged = Object.keys(utm).length > 0

  _session = {
    id: makeId(),
    ts: new Date().toISOString(),
    source: utm.utm_source || (document.referrer ? referrerSource() : '(direct)'),
    medium: utm.utm_medium || (tagged ? '(not set)' : '(none)'),
    campaign: utm.utm_campaign || '(not set)',
    term: utm.utm_term || '',
    content: utm.utm_content || '',
    ref: (params.get('ref') || '').slice(0, 80),
    tagged,
    referrer: document.referrer || '',
    landing: window.location.pathname + window.location.search,
    country: '',
    device_type: deviceType(),
    is_returning_visitor: isReturning(),
    popup_action: 'ignore',
    session_duration: 0,
    ua: navigator.userAgent,
    language: navigator.language || '',
    timezone: tz(),
  }
  _startMs = nowMs()
  localUpsert(_session)

  lookupCountry().then(c => { if (_session && c) { _session.country = c; localUpsert(_session) } })

  // Finalize (duration + popup_action + country) and send once at session end.
  const finalize = () => {
    if (_sent || !_session) return
    _sent = true
    _session.session_duration = Math.round((nowMs() - _startMs) / 1000)
    localUpsert(_session)
    sendToServer(_session)
  }
  window.addEventListener('pagehide', finalize)
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') finalize() })
  setTimeout(finalize, 15 * 60 * 1000)   // fallback if exit events never fire

  if (!getFirstTouch()) { try { localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(_session)) } catch { /* ignore */ } }

  return _session
}

// Record how the Discord popup was handled: 'join' | 'dismiss' | 'ignore'.
export function recordPopupAction(action) {
  if (!_session) return
  _session.popup_action = action
  _session.session_duration = Math.round((nowMs() - _startMs) / 1000)
  localUpsert(_session)
}

// Build a campaign URL from a base + utm fields (used by the dashboard builder).
export function buildUtmUrl(baseUrl, fields) {
  let url
  try { url = new URL(baseUrl) } catch { return '' }
  for (const k of UTM_KEYS) { const v = fields[k]; if (v) url.searchParams.set(k, v); else url.searchParams.delete(k) }
  if (fields.ref) url.searchParams.set('ref', fields.ref); else url.searchParams.delete('ref')
  return url.toString()
}
