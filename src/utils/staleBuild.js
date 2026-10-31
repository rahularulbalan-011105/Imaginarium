// ─────────────────────────────────────────────────────────────────────────────
// Surviving a deploy with the tab open.
//
// Every chunk filename carries a content hash, and a deploy replaces the whole
// `assets/` tree — the previous build's files are gone. A tab opened before the
// deploy still holds the OLD module graph, so the next lazy import asks for
// `PhysicsPanel-<old hash>.js` and gets a 404. That surfaces at the call site
// as "Physics crashed" or "Operation failed: Failed to fetch dynamically
// imported module…", which blames the feature for what is really a deploy.
//
// A missing chunk cannot be fetched by any other means, so the only cure is to
// reload onto the new build. We never do that on our own: a reload mid-edit
// would throw away anything the 30 s autosave hasn't written yet. We recognise
// the failure, say plainly what happened, and let the user press the button.
// ─────────────────────────────────────────────────────────────────────────────

// Each engine words a failed module fetch differently, and none of them expose
// a status code — the message is all we get.
const PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chrome / Edge
  /error loading dynamically imported module/i,   // Firefox
  /importing a module script failed/i,            // Safari
  /unable to preload css/i,                       // Vite's CSS preload helper
]

/** Did this error come from a chunk that no longer exists on the server? */
export function isStaleBuildError(err) {
  const msg = String(err?.message ?? err ?? '')
  return PATTERNS.some((re) => re.test(msg))
}

const EVENT = 'constructa:stale-build'
let flagged = false

/** True once anything in this tab has hit a missing chunk. */
export function isStaleBuild() { return flagged }

/** Record that this build is gone and raise the notice — once per tab. */
export function reportStaleBuild() {
  if (!flagged) {
    flagged = true
    try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* no window */ }
  }
  return true
}

/**
 * Call from a catch block: returns true (and raises the notice) when the error
 * was a missing chunk, false when it was a genuine fault the caller should
 * report itself.
 */
export function noteIfStale(err) {
  return isStaleBuildError(err) ? reportStaleBuild() : false
}

export function onStaleBuild(fn) {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/**
 * Reload onto the current deploy. `location.reload()` alone can be served the
 * same cached index.html that named the missing chunks (GitHub Pages sends
 * max-age=600), which would land us straight back here — so refresh the cache
 * entry first, then reload.
 */
export async function reloadForNewBuild() {
  try { await fetch(window.location.href, { cache: 'reload', credentials: 'same-origin' }) }
  catch { /* offline or blocked: a plain reload is still the best we can do */ }
  window.location.reload()
}

/**
 * Catch the failures that never reach a call site's try/catch: Vite fires
 * `vite:preloadError` when a preloaded chunk 404s, and a lazy() import that
 * nothing awaited lands in unhandledrejection.
 */
export function installStaleBuildWatch() {
  if (typeof window === 'undefined') return
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault() // otherwise Vite rethrows and the page dies silently
    reportStaleBuild()
  })
  window.addEventListener('unhandledrejection', (e) => { noteIfStale(e?.reason) })
}
