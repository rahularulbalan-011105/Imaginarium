import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Parse an SVG document string and extrude its filled paths into a single 3D
 * BufferGeometry, centred at the origin and normalised so its largest dimension
 * equals `targetSize` scene units. Returns null when the SVG has no fillable
 * shapes.
 */
export function svgTextToGeometry(svgText, { depth = 0.5, targetSize = 4 } = {}) {
  const data = new SVGLoader().parse(svgText)
  const geos = []
  for (const path of data.paths) {
    const shapes = SVGLoader.createShapes(path)
    for (const shape of shapes) {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
      // Normalise attributes so mergeGeometries can combine paths reliably.
      g.deleteAttribute('uv')
      geos.push(g)
    }
  }
  if (!geos.length) return null

  let geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
  if (!geo) geo = geos[0]

  // SVG's Y axis points down — flip so the artwork is upright.
  geo.scale(1, -1, 1)

  geo.computeBoundingBox()
  const size = new THREE.Vector3()
  geo.boundingBox.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const s = targetSize / maxDim
  geo.scale(s, s, s)

  geo.center()
  geo.computeBoundingBox()
  geo.computeVertexNormals()
  return geo
}
