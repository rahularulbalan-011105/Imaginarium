// Client-side project sharing: pack a full project snapshot into the URL hash so
// a design can be opened from a link with no backend. Uses gzip (CompressionStream)
// when available and falls back to raw base64 otherwise.

function bytesToBase64Url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(b64) {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function gzip(bytes) {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(bytes); writer.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(bytes); writer.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

// Encode a project snapshot to a hash payload string (with a 2-char codec tag).
export async function encodeProject(snapshot) {
  const json  = JSON.stringify(snapshot)
  const bytes = new TextEncoder().encode(json)
  if (typeof CompressionStream !== 'undefined') {
    return 'g:' + bytesToBase64Url(await gzip(bytes))
  }
  return 'r:' + bytesToBase64Url(bytes)
}

export async function decodeProject(payload) {
  const tag = payload.slice(0, 2)
  let bytes = base64UrlToBytes(payload.slice(2))
  if (tag === 'g:') bytes = await gunzip(bytes)
  return JSON.parse(new TextDecoder().decode(bytes))
}

// Build a full shareable URL for the current snapshot.
export async function buildShareUrl(snapshot) {
  const payload = await encodeProject(snapshot)
  const base = window.location.origin + window.location.pathname
  return { url: `${base}#share=${payload}`, payload }
}

// If the page was opened with a #share=… payload, decode and return the project.
// Returns null when there's nothing to load (or it fails to parse).
export async function readShareFromHash() {
  const m = /[#&]share=([^&]+)/.exec(window.location.hash)
  if (!m) return null
  try {
    return await decodeProject(m[1])
  } catch (e) {
    console.warn('[share] failed to decode shared project:', e)
    return null
  }
}

// Remove the share payload from the address bar after loading it.
export function clearShareHash() {
  if (/[#&]share=/.test(window.location.hash)) {
    history.replaceState(null, '', window.location.origin + window.location.pathname)
  }
}
