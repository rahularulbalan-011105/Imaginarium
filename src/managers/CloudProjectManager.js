// CloudProjectManager — bridges the Constructa editor to the Supabase-backed
// dashboard. It:
//   1. consumes a one-time session handoff from the URL fragment (#cs=…),
//   2. loads a project (?project=<id>) or a read-only share (?share=<token>)
//      into the scene via the existing `constructa:load-project` event,
//   3. auto-saves the editor snapshot back to Supabase (debounced, single-flight
//      so out-of-order writes can never clobber a newer version),
//   4. flushes a final save when the tab is hidden/closed,
//   5. broadcasts status via `constructa:cloud-status` for the CloudSaveBar.
//
// If Supabase env vars are absent, every entry point is a no-op — the editor
// runs exactly as before.
import { getSupabase, cloudConfigured, SUPABASE_REST, SUPABASE_APIKEY } from '../lib/supabaseClient.js'
import { buildProjectSnapshot } from '../utils/helpers.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'

const DASHBOARD_URL =
  import.meta.env.VITE_DASHBOARD_URL || 'https://constructa-page.atumx.in/dashboard'

// Auto-save pacing — deliberately gentle so many concurrent editors don't hammer
// the database. Wait this long after the last edit before writing…
const DEBOUNCE_MS = 3000
// …and never write more often than this, even during continuous editing.
const MIN_SAVE_GAP_MS = 5000
// On repeated failures (e.g. server 504s), back off exponentially instead of
// retrying in a tight loop — capped so we still recover promptly once it's back.
const BASE_BACKOFF_MS = 4000
const MAX_BACKOFF_MS = 60000

const S = {
  active: false,
  projectId: null,
  shareToken: null,
  readOnly: false,
  title: '',
  status: 'idle', // idle | loading | saving | saved | dirty | error | auth | readonly
  accessToken: null,
  saving: false,
  pending: false,
  lastSerialized: null,
  lastStructuralKey: '',
  lastSaveAt: 0,
  failCount: 0,
  timer: null,
  unsub: [],
  started: false,
}

/** Is the editor currently in dashboard/cloud mode? (project or share in the URL) */
export function isCloudMode() {
  if (typeof window === 'undefined') return false
  const p = new URLSearchParams(window.location.search)
  return p.has('project') || p.has('share')
}

function setStatus(status, extra = {}) {
  S.status = status
  window.dispatchEvent(
    new CustomEvent('constructa:cloud-status', {
      detail: { status, title: S.title, readOnly: S.readOnly, ...extra },
    }),
  )
}

// ── Boot ──────────────────────────────────────────────────────────────────────

export async function initCloudSync() {
  if (S.started) return
  S.started = true
  if (!cloudConfigured || !isCloudMode()) return

  const supabase = getSupabase()
  if (!supabase) return
  S.active = true
  setStatus('loading')

  // 1) Session handoff from the fragment, then wipe it from the URL/history.
  await consumeSessionHandoff(supabase)

  // Keep a synchronous copy of the access token for keepalive flush on unload.
  try {
    const { data } = await supabase.auth.getSession()
    S.accessToken = data.session?.access_token ?? null
  } catch { /* ignore */ }
  supabase.auth.onAuthStateChange((_e, session) => {
    S.accessToken = session?.access_token ?? null
  })

  const params = new URLSearchParams(window.location.search)
  S.projectId = params.get('project')
  S.shareToken = params.get('share')
  S.readOnly = params.get('ro') === '1' || Boolean(S.shareToken)

  if (S.shareToken) {
    await loadShared(supabase, S.shareToken)
  } else if (S.projectId) {
    await loadProject(supabase, S.projectId)
  }
}

async function consumeSessionHandoff(supabase) {
  const hash = window.location.hash || ''
  const m = /[#&]cs=([^&]+)/.exec(hash)
  if (!m) return
  try {
    const decoded = JSON.parse(atob(decodeURIComponent(m[1])))
    if (decoded?.at && decoded?.rt) {
      await supabase.auth.setSession({ access_token: decoded.at, refresh_token: decoded.rt })
    }
  } catch (e) {
    console.warn('[cloud] session handoff failed:', e?.message ?? e)
  } finally {
    // Strip the fragment so the tokens never linger in the address bar / history.
    const clean = window.location.pathname + window.location.search
    window.history.replaceState(null, '', clean)
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────

function applyContent(content) {
  const snap = content && typeof content === 'object' ? content : null
  // Remember what we loaded so the first auto-save doesn't rewrite an identical body.
  S.lastSerialized = safeSerialize(snap ?? { version: '1.1', objects: [] })
  // A valid snapshot has an `objects` array; dispatch even when empty (fresh canvas).
  window.dispatchEvent(
    new CustomEvent('constructa:load-project', {
      detail: snap && Array.isArray(snap.objects) ? snap : { version: '1.1', objects: [] },
    }),
  )
}

async function loadProject(supabase, id) {
  try {
    const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) {
      // RLS filtered it out, or the handoff didn't land → not signed in for this project.
      setStatus('auth')
      return
    }
    S.title = data.title || 'Untitled robot'
    applyContent(data.content)
    if (S.readOnly) {
      setStatus('readonly')
    } else {
      startAutoSave()
      setStatus('saved')
    }
  } catch (e) {
    console.warn('[cloud] loadProject failed:', e?.message ?? e)
    setStatus('error')
  }
}

async function loadShared(supabase, token) {
  try {
    const { data, error } = await supabase.rpc('get_shared_project', { share_token: token })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      setStatus('error', { message: 'This share link is invalid or expired.' })
      return
    }
    S.title = row.title || 'Shared robot'
    S.readOnly = true
    applyContent(row.content)
    setStatus('readonly')
  } catch (e) {
    console.warn('[cloud] loadShared failed:', e?.message ?? e)
    setStatus('error')
  }
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

// A cheap "structural" fingerprint: object COUNT, wire count, attachment count,
// and code length. It changes when you add/remove an object, wire, attach a part,
// or edit code — but NOT when you merely drag/rotate/scale/recolour something.
function structuralKey() {
  const s = useSceneStore.getState()
  const e = useElectronicsStore.getState()
  return [
    s.objects.length,
    e.connections?.length ?? 0,
    Object.keys(e.attachments || {}).length,
    (e.code || '').length,
  ].join(':')
}

function startAutoSave() {
  if (S.readOnly) return
  S.lastStructuralKey = structuralKey()
  // Only auto-save on STRUCTURAL changes (add/remove object, wiring, attach/detach,
  // code edit) — not on every drag/rotate/colour tweak. That slashes how often we
  // write. Fine-grained edits (moves, colours, renames) are still persisted by the
  // full-snapshot flush on tab-hide / close / "Back to Dashboard".
  const onChange = () => {
    const key = structuralKey()
    if (key === S.lastStructuralKey) return
    S.lastStructuralKey = key
    scheduleSave()
  }
  S.unsub.push(useSceneStore.subscribe(onChange))
  S.unsub.push(useElectronicsStore.subscribe(onChange))
  window.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)
}

function scheduleSave() {
  if (S.readOnly || !S.projectId) return
  if (S.status !== 'saving') setStatus('dirty')
  clearTimeout(S.timer)
  // Exponential backoff while failing, and never sooner than MIN_SAVE_GAP_MS
  // after the previous write — so a burst of edits (or a down server) can't turn
  // into a flood of requests.
  const backoff = S.failCount > 0
    ? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (S.failCount - 1))
    : 0
  const sinceLast = performance.now() - S.lastSaveAt
  const wait = Math.max(DEBOUNCE_MS + backoff, MIN_SAVE_GAP_MS - sinceLast, 0)
  S.timer = setTimeout(runSave, wait)
}

function currentSnapshot() {
  return buildProjectSnapshot(useSceneStore.getState(), useElectronicsStore.getState())
}

function safeSerialize(o) {
  try {
    return JSON.stringify(o)
  } catch {
    return null
  }
}

function snapIsEmpty(snap) {
  return !snap || !Array.isArray(snap.objects) || snap.objects.length === 0
}

// Did the last thing we persisted actually contain objects? Used to refuse an
// empty-scene overwrite (a transient wipe should never clobber a real project).
function prevHadObjects() {
  try {
    const prev = JSON.parse(S.lastSerialized || '{}')
    return Array.isArray(prev.objects) && prev.objects.length > 0
  } catch {
    return false
  }
}

// Single-flight with a trailing re-run: only ever ONE update is in flight, and
// if changes arrive while it's running we save again afterwards with the latest
// snapshot. This makes an out-of-order overwrite impossible — the last write wins.
async function runSave() {
  if (S.readOnly || !S.projectId) return
  if (S.saving) {
    S.pending = true
    return
  }
  const snap = currentSnapshot()
  const serialized = safeSerialize(snap)
  if (serialized && serialized === S.lastSerialized) {
    setStatus('saved')
    return
  }

  // SAFETY: never overwrite a project that had content with a suddenly-empty scene.
  // (Guards against a transient/half-loaded scene wiping good data.)
  if (snapIsEmpty(snap) && prevHadObjects()) {
    console.warn('[cloud] refused to overwrite a non-empty project with an empty scene')
    return
  }

  S.saving = true
  setStatus('saving')
  const supabase = getSupabase()
  try {
    // .select('id') lets us CONFIRM the write actually applied. A 504/timeout throws
    // here; an RLS/permission miss returns 0 rows — both must count as failures so we
    // never think we saved when we didn't.
    const { data, error } = await supabase
      .from('projects')
      .update({ content: snap })
      .eq('id', S.projectId)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('save did not persist (0 rows updated)')
    S.lastSerialized = serialized
    S.failCount = 0
    setStatus('saved')
  } catch (e) {
    console.warn('[cloud] save failed:', e?.message ?? e)
    S.failCount++
    setStatus('error')
  } finally {
    S.saving = false
    S.lastSaveAt = performance.now()
    if (S.pending) {
      S.pending = false
      scheduleSave()
    } else if (S.failCount > 0) {
      // The failed write still holds unsaved changes — retry later with backoff
      // (scheduleSave computes the delay), never in a tight loop.
      scheduleSave()
    }
  }
}

/** Force a save now (used by the "Retry" button). */
export function retrySave() {
  clearTimeout(S.timer)
  runSave()
}

/** Manual save — writes the full current state (incl. moves/colours) immediately. */
export function saveNow() {
  if (S.readOnly || !S.projectId) return
  clearTimeout(S.timer)
  runSave()
}

/** True while the editor is in an editable cloud project (for the Save button). */
export function canSave() {
  return S.active && !S.readOnly && !!S.projectId
}

function onHide(e) {
  if (document.visibilityState === 'hidden' || e?.type === 'pagehide') flushKeepalive()
}

// Best-effort synchronous save when the tab is closing. Uses fetch keepalive so
// the request survives page teardown (sendBeacon can't send a PATCH with auth).
function flushKeepalive() {
  if (S.readOnly || !S.projectId || !SUPABASE_REST || !S.accessToken) return
  const snap = currentSnapshot()
  const serialized = safeSerialize(snap)
  if (serialized && serialized === S.lastSerialized) return
  // Same safety net as runSave: don't let a teardown flush wipe a real project.
  if (snapIsEmpty(snap) && prevHadObjects()) return
  try {
    fetch(`${SUPABASE_REST}/projects?id=eq.${S.projectId}`, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        apikey: SUPABASE_APIKEY,
        Authorization: `Bearer ${S.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ content: snap }),
    })
    S.lastSerialized = serialized
  } catch { /* nothing more we can do during unload */ }
}

// ── Navigation ────────────────────────────────────────────────────────────────

export function backToDashboard() {
  flushKeepalive()
  window.location.href = DASHBOARD_URL
}

export function getCloudState() {
  return { active: S.active, status: S.status, title: S.title, readOnly: S.readOnly }
}
