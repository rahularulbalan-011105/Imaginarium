// Supabase browser client for the Constructa editor.
//
// The editor lives on a different subdomain than the dashboard, so it does not
// share the dashboard's localStorage session. Instead it receives a one-time
// session handoff via the URL fragment (see CloudProjectManager) and then keeps
// its own persisted session here.
//
// Uses the same "new" opaque publishable key (`sb_publishable_…`) scheme as the
// landing app: those keys are NOT bearer JWTs, so the default `Authorization`
// header must be stripped and sent only as `apikey`. Once a real user session is
// set, Supabase sends the user's access token as the bearer, which we keep.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

function isOpaqueKey(v) {
  return typeof v === 'string' && (v.startsWith('sb_publishable_') || v.startsWith('sb_secret_'))
}

function makeFetch(key) {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    )
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v))
    // Strip the anon bearer for opaque keys (kept for real user access tokens).
    if (isOpaqueKey(key) && headers.get('Authorization') === `Bearer ${key}`) {
      headers.delete('Authorization')
    }
    headers.set('apikey', key)
    return fetch(input, { ...init, headers })
  }
}

let _client = null

/** Lazily create the client. Returns null if env vars are absent (cloud sync off). */
export function getSupabase() {
  if (!cloudConfigured) return null
  if (_client) return _client
  _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: makeFetch(SUPABASE_KEY) },
    auth: {
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // we handle the handoff ourselves
    },
  })
  return _client
}

export const SUPABASE_REST = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : null
export const SUPABASE_APIKEY = SUPABASE_KEY
