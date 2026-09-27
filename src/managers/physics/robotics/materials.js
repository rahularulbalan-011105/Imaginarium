// Material system: per-collider friction/restitution/density.
//
// Rapier's contact solver has ONE Coulomb coefficient per contact, not separate
// static/dynamic values. We recover the static→kinetic distinction for feet in
// ContactSystem: each step a foot collider is given its static coefficient while
// it sticks and min(μd_foot, μd_surface) while it slips; with the Min combine rule
// that yields exactly μs_pair when sticking and μd_pair when slipping.

export const MATERIALS = {
  concrete: { name: 'concrete', staticFriction: 0.9,  dynamicFriction: 0.7,  restitution: 0.05, density: 2400 },
  metal:    { name: 'metal',    staticFriction: 0.6,  dynamicFriction: 0.45, restitution: 0.15, density: 7800 },
  rubber:   { name: 'rubber',   staticFriction: 1.0,  dynamicFriction: 0.8,  restitution: 0.1,  density: 1200 },
  plastic:  { name: 'plastic',  staticFriction: 0.5,  dynamicFriction: 0.35, restitution: 0.2,  density: 1200 },
  wood:     { name: 'wood',     staticFriction: 0.6,  dynamicFriction: 0.45, restitution: 0.15, density: 700 },
  grass:    { name: 'grass',    staticFriction: 0.55, dynamicFriction: 0.4,  restitution: 0.02, density: 1000 },
  mud:      { name: 'mud',      staticFriction: 0.4,  dynamicFriction: 0.25, restitution: 0.0,  density: 1600 },
  sand:     { name: 'sand',     staticFriction: 0.6,  dynamicFriction: 0.45, restitution: 0.0,  density: 1600 },
  ice:      { name: 'ice',      staticFriction: 0.1,  dynamicFriction: 0.03, restitution: 0.05, density: 917 },
}

export const DEFAULT_LINK_MATERIAL = 'plastic'
export const DEFAULT_FOOT_MATERIAL = 'rubber'
export const DEFAULT_GROUND_MATERIAL = 'concrete'

const _custom = new Map()

/** Register (or overwrite) a custom material. Returns the normalised material. */
export function registerMaterial(m) {
  const mat = normalizeMaterial(m)
  _custom.set(mat.name, mat)
  return mat
}

export function normalizeMaterial(m) {
  const s = Math.max(0, Number(m?.staticFriction ?? 0.6))
  return {
    name:            String(m?.name ?? 'custom'),
    staticFriction:  s,
    // Kinetic friction can never exceed static friction.
    dynamicFriction: Math.min(s, Math.max(0, Number(m?.dynamicFriction ?? s * 0.8))),
    restitution:     Math.min(1, Math.max(0, Number(m?.restitution ?? 0.1))),
    density:         Math.max(1, Number(m?.density ?? 1000)),
  }
}

/**
 * Resolve a material reference: a preset/registered name, or an inline object
 * (an inline object is how per-object custom materials are persisted).
 */
export function getMaterial(ref) {
  if (ref && typeof ref === 'object') return normalizeMaterial(ref)
  return _custom.get(ref) ?? MATERIALS[ref] ?? MATERIALS[DEFAULT_LINK_MATERIAL]
}

/** Pair coefficients the way the solver sees them (Min combine rule). */
export function pairFriction(a, b, slipping) {
  const A = getMaterial(a), B = getMaterial(b)
  return slipping
    ? Math.min(A.dynamicFriction, B.dynamicFriction)
    : Math.min(A.staticFriction, B.staticFriction)
}

/** Apply a material to a Rapier ColliderDesc (before creation). */
export function applyMaterialToDesc(R, desc, ref) {
  const m = getMaterial(ref)
  desc.setFriction(m.staticFriction)
  desc.setRestitution(m.restitution)
  desc.setFrictionCombineRule(R.CoefficientCombineRule.Min)
  return m
}
