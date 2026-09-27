// Centre of mass, support polygon and static-stability classification.
// The result is REPORTED (to balance/gait/telemetry); nothing here moves the robot.

/** COM = Σ mᵢ rᵢ / Σ mᵢ ; returns { com, velocity, mass } (world). */
export function centerOfMass(parts, out = { com: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mass: 0 }) {
  let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0
  for (const p of parts) {
    const m = p.mass
    if (!(m > 0)) continue
    M += m
    cx += m * p.com.x; cy += m * p.com.y; cz += m * p.com.z
    if (p.velocity) { vx += m * p.velocity.x; vy += m * p.velocity.y; vz += m * p.velocity.z }
  }
  out.mass = M
  if (M > 0) {
    out.com.x = cx / M; out.com.y = cy / M; out.com.z = cz / M
    out.velocity.x = vx / M; out.velocity.y = vy / M; out.velocity.z = vz / M
  }
  return out
}

/** 2-D convex hull (Andrew's monotone chain), points {x, y}. CCW, no duplicates. */
export function convexHull2D(points) {
  const pts = points.map(p => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y)
  const uniq = []
  for (const p of pts) {
    const q = uniq[uniq.length - 1]
    if (!q || Math.abs(q.x - p.x) > 1e-9 || Math.abs(q.y - p.y) > 1e-9) uniq.push(p)
  }
  if (uniq.length < 3) return uniq
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = [], upper = []
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop(); lower.pop()
  return lower.concat(upper)
}

function distPointSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const L2 = dx * dx + dy * dy
  let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Signed stability margin of point p w.r.t. a CCW convex polygon:
 * > 0 inside (distance to the nearest edge), < 0 outside. Degenerate supports
 * (a line or a point) have no interior, so the margin is ≤ 0 there.
 */
export function supportMargin(p, hull) {
  if (!hull || hull.length === 0) return -Infinity
  if (hull.length === 1) return -Math.hypot(p.x - hull[0].x, p.y - hull[0].y)
  if (hull.length === 2) return -distPointSegment(p, hull[0], hull[1])
  let inside = true, minD = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross < 0) inside = false
    minD = Math.min(minD, distPointSegment(p, a, b))
  }
  return inside ? minD : -minD
}

/**
 * Support polygon from grounded foot contact points and COM projected along
 * gravity (−Y). All in world units.
 * @returns { hull, margin, state: 'stable'|'marginal'|'unstable', centroid }
 */
export function analyzeSupport(com, footPoints, marginThreshold) {
  const pts = footPoints.map(f => ({ x: f.x, y: f.z }))
  const hull = convexHull2D(pts)
  const c = { x: com.x, y: com.z }
  const margin = supportMargin(c, hull)
  let state = 'unstable'
  if (margin > marginThreshold) state = 'stable'
  else if (margin >= 0 && hull.length >= 3) state = 'marginal'
  let cx = 0, cz = 0
  for (const h of hull) { cx += h.x; cz += h.y }
  const centroid = hull.length ? { x: cx / hull.length, z: cz / hull.length } : null
  return { hull: hull.map(h => ({ x: h.x, z: h.y })), margin, state, centroid }
}
