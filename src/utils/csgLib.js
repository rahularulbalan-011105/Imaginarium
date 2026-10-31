// On-demand CSG engine. three-bvh-csg (+ three-mesh-bvh) is ~300 KB and only
// needed for Boolean / Group / Ungroup / Extrude-merge / Slice, so it is not on
// the startup path: it is preloaded at idle after boot and every user-facing
// CSG action awaits `loadCSG()` first. csg.js / sliceTool.js then read the
// library synchronously via `csgLib()`.
let _lib = null
let _promise = null

export function loadCSG() {
  // Don't keep a REJECTED promise: a failed load would then be permanent for
  // the tab, so even a transient network blip could never be retried. (After a
  // deploy the retry fails too — staleBuild turns that into a reload prompt.)
  if (!_promise) {
    _promise = import('three-bvh-csg')
      .then((m) => { _lib = m; return m })
      .catch((e) => { _promise = null; throw e })
  }
  return _promise
}

export function csgReady() { return !!_lib }

/** The loaded three-bvh-csg module. Callers must have awaited loadCSG(). */
export function csgLib() {
  if (!_lib) throw new Error('CSG engine not loaded yet — await loadCSG() first')
  return _lib
}
