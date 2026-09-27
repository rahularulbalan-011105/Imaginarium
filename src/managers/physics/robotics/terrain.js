// Terrain: static (or kinematic, for moving platforms) colliders with physical
// materials. The robot reacts to terrain only through contact physics.
// All dimensions in scene units (su). Deterministic (seeded) where random.
import { mulberry32 } from './sensors.js'
import { applyMaterialToDesc } from './materials.js'

export const TERRAIN_TYPES = ['flat', 'slope', 'stairs', 'uneven', 'rocks', 'gaps', 'platform']

export const DEFAULT_TERRAIN = {
  type:       'flat',
  material:   'concrete',
  center:     { x: 0, z: -12 },   // where features are placed (robots face −Z by default)
  size:       30,                 // su footprint of the feature
  angleDeg:   12,                 // slope
  steps:      5, stepHeight: 0.6, stepDepth: 3,   // stairs
  amplitude:  0.6, resolution: 32,                // uneven heightfield
  rockCount:  25, rockSize: 0.8,                  // rocks
  gapWidth:   3,                                   // gaps
  platformAmplitude: 3, platformPeriod: 4,         // moving platform (along X)
  seed:       42,
}

export function buildTerrain(R, world, spec = {}, hooks = {}) {
  const s = { ...DEFAULT_TERRAIN, ...spec }
  const bodies = [], colliders = [], platforms = []
  const register = hooks.registerMaterial ?? (() => {})
  const cx = s.center.x, cz = s.center.z

  const addFixed = (desc, pos, rot) => {
    const b = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
    if (rot) b.setRotation(rot, false)
    applyMaterialToDesc(R, desc, s.material)
    const c = world.createCollider(desc, b)
    register(c.handle, s.material)
    bodies.push(b); colliders.push(c)
    return c
  }

  switch (s.type) {
    case 'slope': {
      const a = (s.angleDeg * Math.PI) / 180, half = s.size / 2
      // Ramp rising toward −Z, its low edge flush with the ground.
      const q = { x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }
      const t = 0.5
      addFixed(R.ColliderDesc.cuboid(half, t, half),
        { x: cx, y: Math.sin(a) * half - t * Math.cos(a), z: cz }, q)
      break
    }
    case 'stairs': {
      for (let i = 0; i < s.steps; i++) {
        const h = (i + 1) * s.stepHeight
        addFixed(R.ColliderDesc.cuboid(s.size / 2, h / 2, s.stepDepth / 2),
          { x: cx, y: h / 2, z: cz + s.size / 2 - (i + 0.5) * s.stepDepth })
      }
      break
    }
    case 'uneven': {
      const n = Math.max(4, s.resolution | 0), rand = mulberry32(s.seed)
      // Smooth-ish noise: random grid + 3×3 box blur, heights ≥ 0 so the patch sits on the ground.
      const raw = Array.from({ length: (n + 1) * (n + 1) }, () => rand() * s.amplitude)
      const hts = new Float32Array((n + 1) * (n + 1))
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
        let sum = 0, k = 0
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const ii = i + di, jj = j + dj
          if (ii < 0 || jj < 0 || ii > n || jj > n) continue
          sum += raw[ii * (n + 1) + jj]; k++
        }
        // Heightfield is column-major in Rapier (index = col * nrows + row).
        hts[j * (n + 1) + i] = sum / k
      }
      addFixed(R.ColliderDesc.heightfield(n, n, hts, { x: s.size, y: 1, z: s.size }), { x: cx, y: 0.001, z: cz })
      break
    }
    case 'rocks': {
      const rand = mulberry32(s.seed)
      for (let i = 0; i < s.rockCount; i++) {
        const r = s.rockSize * (0.4 + rand() * 0.8)
        const pts = []
        for (let k = 0; k < 10; k++) {
          const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1)
          const rr = r * (0.7 + rand() * 0.3)
          pts.push(rr * Math.sin(ph) * Math.cos(th), Math.abs(rr * Math.cos(ph)) * 0.6, rr * Math.sin(ph) * Math.sin(th))
        }
        const d = R.ColliderDesc.convexHull(Float32Array.from(pts)) ?? R.ColliderDesc.ball(r * 0.5)
        addFixed(d, { x: cx + (rand() - 0.5) * s.size, y: 0, z: cz + (rand() - 0.5) * s.size })
      }
      break
    }
    case 'gaps': {
      // The base ground is disabled by the runtime; build slabs with trenches.
      const slab = s.size / 3
      for (let i = 0; i < 3; i++) {
        addFixed(R.ColliderDesc.cuboid(s.size, 1, (slab - s.gapWidth) / 2),
          { x: cx, y: -1, z: cz + s.size / 2 - (i + 0.5) * slab })
      }
      // Approach slab so robots at the origin still stand.
      addFixed(R.ColliderDesc.cuboid(s.size, 1, s.size), { x: cx, y: -1, z: cz + s.size / 2 + s.size })
      break
    }
    case 'platform': {
      const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, 0.25, cz))
      const d = R.ColliderDesc.cuboid(s.size / 4, 0.25, s.size / 4)
      applyMaterialToDesc(R, d, s.material)
      const c = world.createCollider(d, b)
      register(c.handle, s.material)
      bodies.push(b); colliders.push(c)
      platforms.push({ body: b, base: { x: cx, y: 0.25, z: cz }, amp: s.platformAmplitude, period: s.platformPeriod })
      break
    }
    default: break   // flat: the base ground (its material is set by the runtime)
  }

  return {
    spec: s, bodies, colliders,
    disablesGround: s.type === 'gaps',
    /** Moving platforms: kinematic targets, so contacts carry the robot. */
    update(t) {
      for (const p of platforms) {
        const x = p.base.x + p.amp * Math.sin((2 * Math.PI * t) / p.period)
        p.body.setNextKinematicTranslation({ x, y: p.base.y, z: p.base.z })
      }
    },
    dispose() {
      for (const b of bodies) { try { world.removeRigidBody(b) } catch { /* gone */ } }
      bodies.length = 0; colliders.length = 0; platforms.length = 0
    },
  }
}
