import * as THREE from 'three'

export function createGeometry(type) {
  switch (type) {
    // ── current shape set ──────────────────────────────────────────────────
    case 'cylinder':     return new THREE.CylinderGeometry(1, 1, 2, 32)
    case 'cone':         return new THREE.ConeGeometry(1, 2, 32)
    case 'box':          return new THREE.BoxGeometry(2, 2, 2)
    case 'sphere':       return new THREE.SphereGeometry(1, 32, 32)
    case 'tetrahedron':  return new THREE.TetrahedronGeometry(1.3, 0)
    case 'pyramid':      return new THREE.ConeGeometry(1.2, 2, 4)       // square pyramid
    case 'pentpyramid':  return new THREE.ConeGeometry(1.2, 2, 5)       // pentagonal pyramid
    case 'octahedron':   return new THREE.OctahedronGeometry(1.3, 0)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(1.2, 0)
    case 'rectprism':    return new THREE.BoxGeometry(3, 1.5, 2)        // rectangular prism
    // ── legacy types (kept so saved projects still load) ──────────────────
    case 'torus':        return new THREE.TorusGeometry(1, 0.4, 16, 100)
    case 'plane':        return new THREE.PlaneGeometry(3, 3)
    case 'capsule':      return new THREE.CapsuleGeometry(0.6, 1.2, 4, 16)
    case 'prism':        return new THREE.CylinderGeometry(1, 1, 2, 3)
    case 'diamond':      return new THREE.OctahedronGeometry(1.2, 0)
    case 'hexagon':      return new THREE.CylinderGeometry(1, 1, 2, 6)
    case 'star':         return new THREE.TorusKnotGeometry(0.7, 0.25, 64, 8, 2, 3)
    case 'gear':         return createSpurGearGeometry()
    default:             return new THREE.BoxGeometry(2, 2, 2)
  }
}

/**
 * Apply a cylindrical bend deformation to a BufferGeometry in-place.
 * The geometry is bent along `bAxis` and curves toward the first perpendicular axis.
 * Original positions are saved in geometry.userData.origPos on the first call.
 */
export function applyBendDeform(geometry, angleDeg, bAxis = 'y') {
  const pos = geometry.attributes.position
  if (!pos) return

  if (geometry.userData.currentBend     === angleDeg &&
      geometry.userData.currentBendAxis === bAxis) return
  geometry.userData.currentBend     = angleDeg
  geometry.userData.currentBendAxis = bAxis

  if (!geometry.userData.origPos) {
    geometry.userData.origPos = new Float32Array(pos.array.buffer.slice())
  }
  const orig = geometry.userData.origPos

  if (angleDeg === 0) {
    pos.array.set(orig)
    pos.needsUpdate = true
    geometry.computeVertexNormals()
    return
  }

  const idxH = bAxis === 'x' ? 0 : bAxis === 'y' ? 1 : 2
  let minH = Infinity, maxH = -Infinity
  for (let i = idxH; i < orig.length; i += 3) {
    if (orig[i] < minH) minH = orig[i]
    if (orig[i] > maxH) maxH = orig[i]
  }
  const H = maxH - minH
  if (H < 1e-4) return

  const θ = angleDeg * Math.PI / 180
  const R = H / θ   // radius of neutral axis (negative angle = reverse curve)

  for (let i = 0; i < pos.array.length; i += 3) {
    const ox = orig[i], oy = orig[i + 1], oz = orig[i + 2]
    // Map to (h, a, b): h = height along bend axis, a = displacement axis, b = unchanged
    let h, a, b
    if      (bAxis === 'y') { h = oy; a = oz; b = ox }
    else if (bAxis === 'z') { h = oz; a = ox; b = oy }
    else                    { h = ox; a = oy; b = oz }

    const alpha = ((h - minH) / H) * θ
    const Reff  = R - a

    const h_new = minH + Reff * Math.sin(alpha)
    const a_new = R   - Reff * Math.cos(alpha)
    const b_new = b

    if      (bAxis === 'y') { pos.array[i] = b_new; pos.array[i + 1] = h_new; pos.array[i + 2] = a_new }
    else if (bAxis === 'z') { pos.array[i] = a_new; pos.array[i + 1] = b_new; pos.array[i + 2] = h_new }
    else                    { pos.array[i] = h_new; pos.array[i + 1] = a_new; pos.array[i + 2] = b_new }
  }

  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

// ── Spur Gear ─────────────────────────────────────────────────────────────────
export function createSpurGearGeometry({ teeth = 12, module: mod = 0.25, faceWidth = 0.5, bore = 0 } = {}) {
  const pitchR = (teeth * mod) / 2
  const outerR = pitchR + mod
  const rootR  = Math.max(mod * 0.25, pitchR - 1.25 * mod)

  const toothAng = (2 * Math.PI) / teeth
  const halfGap  = toothAng * 0.28

  const pts = []
  for (let i = 0; i < teeth; i++) {
    const base = i * toothAng
    pts.push(new THREE.Vector2(rootR * Math.cos(base + halfGap),                          rootR * Math.sin(base + halfGap)))
    pts.push(new THREE.Vector2(outerR * Math.cos(base + halfGap + 0.025),                 outerR * Math.sin(base + halfGap + 0.025)))
    pts.push(new THREE.Vector2(outerR * Math.cos(base + toothAng * 0.5),                  outerR * Math.sin(base + toothAng * 0.5)))
    pts.push(new THREE.Vector2(outerR * Math.cos(base + toothAng - halfGap - 0.025),      outerR * Math.sin(base + toothAng - halfGap - 0.025)))
    pts.push(new THREE.Vector2(rootR * Math.cos(base + toothAng - halfGap),               rootR * Math.sin(base + toothAng - halfGap)))
  }

  const shape = new THREE.Shape(pts)

  // bore=0 → solid gear; bore>0 → shaft hole with radius = bore * rootR (clamped 0.05–0.9)
  if (bore > 0) {
    const boreR  = Math.min(rootR * 0.9, Math.max(0.05, bore * rootR))
    const holePts = []
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2
      holePts.push(new THREE.Vector2(boreR * Math.cos(a), boreR * Math.sin(a)))
    }
    shape.holes.push(new THREE.Path(holePts))
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: faceWidth, bevelEnabled: false })
  geo.translate(0, 0, -faceWidth / 2)
  geo.rotateX(-Math.PI / 2)
  geo.computeVertexNormals()
  return geo
}

// ── Bolt (hex head + cylindrical shaft) ───────────────────────────────────────
export function createBoltGroup(color = '#aaaaaa') {
  const group  = new THREE.Group()
  const mkMat  = () => new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.25 })
  const headH  = 0.28, headR = 0.30
  const shaftH = 0.85, shaftR = 0.15

  const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 6), mkMat())
  head.position.y = shaftH * 0.5 + headH * 0.5
  head.castShadow = true
  group.add(head)

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR * 0.9, shaftH, 14), mkMat())
  shaft.castShadow = true
  group.add(shaft)

  return group
}

// ── Screw (disc head + threaded shaft) ────────────────────────────────────────
export function createScrewGroup(color = '#aaaaaa') {
  const group  = new THREE.Group()
  const mkMat  = () => new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.25 })
  const headH  = 0.18, headR = 0.32
  const shaftH = 0.85, shaftR = 0.12, tipH = 0.12

  const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 32), mkMat())
  head.position.y = shaftH * 0.5 + headH * 0.5
  head.castShadow = true
  group.add(head)

  const threadCount = 9
  const steps = threadCount * 6
  const thrPts = [new THREE.Vector2(0, -shaftH / 2 - tipH)]
  thrPts.push(new THREE.Vector2(shaftR, -shaftH / 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = t * shaftH - shaftH / 2
    const bump = 0.022 * Math.abs(Math.sin(t * threadCount * Math.PI))
    thrPts.push(new THREE.Vector2(shaftR + bump, y))
  }

  const shaft = new THREE.Mesh(new THREE.LatheGeometry(thrPts, 20), mkMat())
  shaft.castShadow = true
  group.add(shaft)

  return group
}

export function createMaterial(color = '#3b82f6', materialType = 'standard') {
  switch (materialType) {
    case 'metallic':
      return new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.2 })
    case 'transparent':
      return new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45, roughness: 0.3 })
    default:
      return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.65 })
  }
}
