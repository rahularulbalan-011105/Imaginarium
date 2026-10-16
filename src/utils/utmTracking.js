// ─────────────────────────────────────────────────────────────────────────────
// utmTracking — editor side of the Constructa analytics funnel (v2).
//
// The landing site (constructa-page.atumx.in) and the editor share ONE event
// stream (docs/utm-collector.gs → "cx_events" tab), joined in utm-dashboard.html:
//   • vid   — visitor id. Created on the landing page and handed to the editor in
//             the URL (?cx_vid=…), so landing visits and editor work link up.
//   • email — from the Supabase login (setLoginEmail) or the editor email gate.
//   • attribution — utm_source/medium/campaign/content/term + ref, captured on
//             arrival and kept (last non-direct touch) so it is never lost.
//
// Events are buffered until the user's email is known (or 8 s pass), so the
// email column is filled in on every event the user produces.
// ─────────────────────────────────────────────────────────────────────────────

export const COLLECTOR_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxgWlc_0ZkVdtNGznRm1pCRmKZes18Yrm_XzgDknByKcRfiHxfNh6lfgM0EWIi2SKc0sw/exec'

const ATTR_KEY  = 'cx_attr_v2'
const VID_KEY   = 'cx_vid'
const EMAIL_KEY = 'cx_email'
const SID_KEY   = 'cx_sid'
const UTM_KEYS  = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IDENTITY_WAIT_MS = 8000

let _attr = null
let _vid = ''
let _sid = ''
let _email = ''
let _identityReady = false
let _queue = []
let _activeMs = 0
let _visibleSince = 0
let _lastSentActive = 0
let _started = false
const _emailListeners = new Set()

// ── helpers ───────────────────────────────────────────────────────────────────
function lsGet(k) { try { return localStorage.getItem(k) } catch { return null } }
function lsSet(k, v) { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
function ssGet(k) { try { return sessionStorage.getItem(k) } catch { return null } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v) } catch { /* private mode */ } }
function makeId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) }
function nowMs() { return performance?.now ? performance.now() : Date.now() }

export function isValidEmail(e) { return EMAIL_RE.test(String(e || '').trim()) }
function cleanEmail(e) { const c = String(e || '').trim().toLowerCase().slice(0, 160); return isValidEmail(c) ? c : '' }

function deviceType() {
  const ua = navigator.userAgent || ''
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean')
    return navigator.userAgentData.mobile ? 'mobile' : 'desktop'
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

// Source name from an external referrer (null for our own sites / none).
export function sourceFromReferrer(ref) {
  try {
    if (!ref) return null
    const h = new URL(ref).hostname.toLowerCase().replace(/^www\./, '')
    if (!h || /constructa|atumx/.test(h)) return null
    if (h.includes('instagram')) return 'instagram'
    if (h.includes('youtube') || h.includes('youtu.be')) return 'youtube'
    if (h.includes('whatsapp') || h.includes('wa.me')) return 'whatsapp'
    if (h.includes('facebook') || h.startsWith('fb.') || h.includes('fb.me')) return 'facebook'
    if (h.includes('linkedin') || h === 'lnkd.in') return 'linkedin'
    if (h.includes('twitter') || h === 'x.com' || h === 't.co') return 'twitter'
    if (h.includes('reddit')) return 'reddit'
    if (h === 't.me' || h.includes('telegram')) return 'telegram'
    if (h.includes('google')) return 'google'
    if (h.includes('bing')) return 'bing'
    return h
  } catch { return null }
}

// Attribution for this arrival: explicit UTM > external referrer > stored > direct.
function resolveAttribution(params) {
  const stored = (() => { try { return JSON.parse(lsGet(ATTR_KEY) || 'null') } catch { return null } })()
  let fresh = null
  if (params.get('utm_source')) {
    fresh = {}
    for (const k of UTM_KEYS) fresh[k.slice(4)] = (params.get(k) || '').slice(0, 120)
    fresh.ref = (params.get('ref') || '').slice(0, 80)
    fresh.referrer = (params.get('cx_ref') || document.referrer || '').slice(0, 300)
  } else {
    const inferred = sourceFromReferrer(document.referrer)
    if (inferred) fresh = { source: inferred, medium: 'referral', campaign: '', content: '', term: '', ref: (params.get('ref') || '').slice(0, 80), referrer: document.referrer.slice(0, 300) }
  }
  if (fresh) { lsSet(ATTR_KEY, JSON.stringify(fresh)); return fresh }
  if (stored && stored.source) return stored
  return { source: '(direct)', medium: '', campaign: '', content: '', term: '', ref: '', referrer: '' }
}

// Dev servers, benchmarks and local previews never write to the production sheet.
const IS_LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)

function send(rec) {
  if (IS_LOCAL) return
  try {
    const payload = JSON.stringify(rec)
    if (navigator.sendBeacon && navigator.sendBeacon(COLLECTOR_ENDPOINT, new Blob([payload], { type: 'text/plain;charset=UTF-8' }))) return
    fetch(COLLECTOR_ENDPOINT, { method: 'POST', body: payload, mode: 'no-cors', keepalive: true }).catch(() => { /* offline */ })
  } catch { /* best-effort */ }
}

function build(event, meta, value) {
  const a = _attr || {}
  return {
    type: 'cx', app: 'editor', event, eid: makeId('e'), ts: new Date().toISOString(),
    vid: _vid, sid: _sid, email: _email,
    source: a.source || '(direct)', medium: a.medium || '', campaign: a.campaign || '',
    content: a.content || '', term: a.term || '', ref: a.ref || '', referrer: a.referrer || '',
    page: location.pathname + location.search.replace(/([?&])(cx_vid|cx_ref)=[^&]*/g, '$1').slice(0, 300),
    host: location.hostname, device: deviceType(),
    value: value ?? '', meta: meta && Object.keys(meta).length ? meta : undefined,
  }
}

function flush() {
  const q = _queue; _queue = []
  for (const rec of q) { if (!rec.email) rec.email = _email; send(rec) }
}

function markIdentityReady() {
  if (_identityReady) return
  _identityReady = true
  flush()
}

function activeSecs() {
  const live = document.visibilityState !== 'hidden' ? nowMs() - _visibleSince : 0
  return Math.round((_activeMs + live) / 1000)
}

// Cumulative active (tab-visible) seconds this tab-session; dashboard keeps the max.
function sendSessionTime(force) {
  const secs = activeSecs()
  if (secs <= _lastSentActive || (!force && secs - _lastSentActive < 15)) return
  _lastSentActive = secs
  const rec = build('session_time', null, secs)
  if (_identityReady) send(rec); else { rec.email = _email; send(rec) }   // never hold back the final ping
}

// ── public API ────────────────────────────────────────────────────────────────

/** Call once at startup (main.jsx) before the app renders. */
export function captureUTM() {
  if (typeof window === 'undefined' || _started) return
  _started = true
  const params = new URLSearchParams(location.search)

  _attr = resolveAttribution(params)
  const urlVid = (params.get('cx_vid') || '').replace(/[^\w-]/g, '').slice(0, 40)
  _vid = urlVid || lsGet(VID_KEY) || makeId('v')
  lsSet(VID_KEY, _vid)
  _sid = ssGet(SID_KEY) || makeId('s')
  ssSet(SID_KEY, _sid)
  _email = cleanEmail(lsGet(EMAIL_KEY))
  if (_email) _identityReady = true
  else setTimeout(markIdentityReady, IDENTITY_WAIT_MS)

  // Remove the hand-off params so a copied/shared URL doesn't carry this visitor's id.
  if (params.has('cx_vid') || params.has('cx_ref')) {
    params.delete('cx_vid'); params.delete('cx_ref')
    const qs = params.toString()
    history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash)
  }

  trackEvent('editor_open')

  _visibleSince = nowMs()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { _activeMs += nowMs() - _visibleSince; sendSessionTime(true) }
    else _visibleSince = nowMs()
  })
  window.addEventListener('pagehide', () => { flush(); sendSessionTime(true) })
  setInterval(() => { if (document.visibilityState !== 'hidden') sendSessionTime(false) }, 5 * 60 * 1000)
}

/** Fire a named activity event (must be listed in the collector's EVENTS). */
export function trackEvent(name, meta = {}, value) {
  if (!name || !_started) return
  const rec = build(String(name).slice(0, 60), meta, value)
  if (_identityReady) send(rec); else _queue.push(rec)
}

/** The logged-in (Supabase) email — authoritative; overrides a gate email. */
export function setLoginEmail(email) {
  const clean = cleanEmail(email)
  if (!clean) return
  const changed = clean !== _email
  _email = clean
  lsSet(EMAIL_KEY, clean)
  if (changed) _emailListeners.forEach(fn => { try { fn(clean) } catch { /* ignore */ } })
  markIdentityReady()
}

/** Email typed into the editor's email gate. */
export function setGateEmail(email) {
  const clean = cleanEmail(email)
  if (!clean) return false
  setLoginEmail(clean)
  trackEvent('email_entered')
  return true
}

export function getKnownEmail() { return _email }
export function onEmailChange(fn) { _emailListeners.add(fn); return () => _emailListeners.delete(fn) }

/** How the community popup was handled: 'join_whatsapp' | 'dismiss'. */
export function recordPopupAction(action) {
  if (action === 'dismiss') trackEvent('popup_dismiss')
}

/** Legacy save-time email prompt → same identity path as the gate. */
export function submitEmail(email) { return setGateEmail(email) }
