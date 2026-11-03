// Signed reads from the analytics collector (docs/utm-collector.gs), shared by
// utm-dashboard.html and ads-dashboard.html.
import { COLLECTOR_ENDPOINT } from '../utils/utmTracking.js'

// The dashboard key is NEVER put in a URL: query strings end up in Google's
// request logs and in Referer headers. Each read carries a timestamp plus
// HMAC-SHA256(timestamp, key); the collector recomputes it and accepts a ±5 min
// window, so a captured signature is useless shortly afterwards.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function signedParams(key) {
  const ts = String(Date.now())
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return { ts, sig: b64url(await crypto.subtle.sign('HMAC', k, enc.encode(ts))) }
}

// Cookie-free fetch: when the browser is signed in to Google (often several
// accounts), a credentialed request to an Apps Script web app gets an HTML
// sign-in page instead of data. There is deliberately NO JSONP fallback — JSONP
// executes the response as script, which would hand the page to anyone who could
// impersonate the collector.
export async function getJson(params, key) {
  const auth = params.what === 'ping' ? {} : await signedParams(key)
  const r = await fetch(COLLECTOR_ENDPOINT + '?' + new URLSearchParams({ ...params, ...auth, _: Date.now() }),
    { credentials: 'omit', cache: 'no-store', redirect: 'follow' })
  const text = await r.text()
  try { return JSON.parse(text) } catch {
    throw new Error(`The collector answered with a non-JSON page (HTTP ${r.status}): ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`)
  }
}

/** Turn a failed read into the message the key gate shows. */
export async function readError(res) {
  if (res.error === 'bad key') {
    const p = await getJson({ what: 'ping' }).catch(() => null)
    return p && !p.keySet ? 'No key set yet — run the "setup" function in Apps Script.' : 'Wrong dashboard key.'
  }
  return res.error || 'Collector error'
}
