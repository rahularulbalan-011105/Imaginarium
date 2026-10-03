// On-demand CSG engine. three-bvh-csg (+ three-mesh-bvh) is ~300 KB and only
// needed for Boolean / Group / Ungroup / Extrude-merge / Slice, so it is not on
// the startup path: it is preloaded at idle after boot and every user-facing
// CSG action awaits `loadCSG()` first. csg.js / sliceTool.js then read the
// library synchronously via `csgLib()`.
let _lib = null
let _promise = null

export function loadCSG() {
  if (!_promise) _promise = import('three-bvh-csg').then((m) => { _lib = m; return m })
  return _promise
}

export function csgReady() { return !!_lib }

/** The loaded three-bvh-csg module. Callers must have awaited loadCSG(). */
export function csgLib() {
  if (!_lib) throw new Error('CSG engine not loaded yet — await loadCSG() first')
  return _lib
}
