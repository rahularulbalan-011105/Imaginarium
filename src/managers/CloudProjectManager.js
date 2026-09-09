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

const DEBOUNCE_MS = 900

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

function startAutoSave() {
  if (S.readOnly) return
  const schedule = () => scheduleSave()
  S.unsub.push(useSceneStore.subscribe(schedule))
  S.unsub.push(useElectronicsStore.subscribe(schedule))
  window.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)
}

function scheduleSave() {
  if (S.readOnly || !S.projectId) return
  if (S.status !== 'saving') setStatus('dirty')
  clearTimeout(S.timer)
  S.timer = setTimeout(runSave, DEBOUNCE_MS)
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

  S.saving = true
  setStatus('saving')
  const supabase = getSupabase()
  try {
    const { error } = await supabase
      .from('projects')
      .update({ content: snap })
      .eq('id', S.projectId)
    if (error) throw error
    S.lastSerialized = serialized
    setStatus('saved')
  } catch (e) {
    console.warn('[cloud] save failed:', e?.message ?? e)
    setStatus('error')
  } finally {
    S.saving = false
    if (S.pending) {
      S.pending = false
      scheduleSave()
    }
  }
}

/** Force a save now (used by the "Retry" button). */
export function retrySave() {
  clearTimeout(S.timer)
  runSave()
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
