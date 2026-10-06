import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import * as THREE from 'three'

// Selection outline drawn as screen-space "fat" lines. Plain THREE.LineSegments
// is always 1 px in WebGL (linewidth is ignored), which is too faint to read.
export const OUTLINE_WIDTH_PX = 3

// One resolution vector shared by every outline material — SceneManager.resize
// updates it, so live outlines keep their pixel width when the viewport resizes.
const resolution = new THREE.Vector2(1, 1)
export function setOutlineResolution(w, h) { resolution.set(Math.max(1, w), Math.max(1, h)) }

// Above this many edge segments a mesh is "dense" (GLB wheels, gears, text):
// a bold line on every crease would paint it solid, so it gets fewer, thinner edges.
const DENSE_SEGMENTS = 700
const BUSY_SEGMENTS = 250    // above this, a lighter line reads better

/**
 * Fat-line outline of `geometry`'s edges (crease threshold in degrees), or null
 * when the mesh is so dense that any outline would just paint it solid (tyre
 * treads, knurling) — its simpler sibling meshes still carry the outline.
 */
export function createOutline(geometry, color, thresholdDeg = 20) {
  let edges = new THREE.EdgesGeometry(geometry, thresholdDeg)
  let width = OUTLINE_WIDTH_PX
  const segs = (g) => g.attributes.position.count / 2
  for (const deg of [60, 80, 89]) {          // keep only sharper and sharper edges
    if (segs(edges) <= DENSE_SEGMENTS) break
    edges.dispose()
    edges = new THREE.EdgesGeometry(geometry, deg)
    width = 1.5
  }
  if (segs(edges) > DENSE_SEGMENTS) { edges.dispose(); return null }
  if (segs(edges) > BUSY_SEGMENTS) width = 1.5
  const geo = new LineSegmentsGeometry().fromEdgesGeometry(edges)
  edges.dispose()
  const mat = new LineMaterial({
    color, linewidth: width, transparent: true, opacity: 0.95, depthTest: false,
    side: THREE.DoubleSide,   // mirrored parts (negative scale) flip the quads — never cull them
  })
  mat.uniforms.resolution.value = resolution
  return new LineSegments2(geo, mat)
}
