// Physics debug overlay (Three.js). Draws what the physics engine actually
// has — Rapier's own collider/joint wireframes plus robot state — and nothing in
// normal CAD mode. Geometry buffers are allocated once and reused every frame.
import * as THREE from 'three'

export const DEBUG_LAYERS = {
  colliders: false,   // Rapier collision shapes + joint frames (world.debugRender)
  com:       true,    // centre of mass (and its ground projection)
  support:   true,    // support polygon, coloured by stability state
  contacts:  true,    // foot contact points + normals
  forces:    false,   // ground reaction force vectors
  joints:    false,   // joint axes, coloured by actuator temperature / stall
  velocity:  false,   // link velocity vectors
}

const STATE_COLOR = { stable: 0x22c55e, marginal: 0xf59e0b, unstable: 0xef4444 }

class LinePool {
  constructor(max, parent) {
    this.max = max
    this.pos = new Float32Array(max * 6)
    this.col = new Float32Array(max * 6)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }))
    this.mesh.renderOrder = 999
    this.mesh.frustumCulled = false
    parent.add(this.mesh)
    this.n = 0
    this._c = new THREE.Color()
  }
  begin() { this.n = 0 }
  line(ax, ay, az, bx, by, bz, color) {
    if (this.n >= this.max) return
    const i = this.n * 6
    this.pos[i] = ax; this.pos[i + 1] = ay; this.pos[i + 2] = az
    this.pos[i + 3] = bx; this.pos[i + 4] = by; this.pos[i + 5] = bz
    this._c.set(color)
    this.col[i] = this.col[i + 3] = this._c.r; this.col[i + 1] = this.col[i + 4] = this._c.g; this.col[i + 2] = this.col[i + 5] = this._c.b
    this.n++
  }
  end() {
    const g = this.mesh.geometry
    g.setDrawRange(0, this.n * 2)
    g.attributes.position.needsUpdate = true
    g.attributes.color.needsUpdate = true
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose() }
}

export class PhysicsDebugDraw {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = 'physics-debug'
    scene.add(this.group)
    this.lines = new LinePool(8000, this.group)
    this.rapierLines = null
    this.com = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false }))
    this.com.renderOrder = 1000
    this.group.add(this.com)
    this.layers = { ...DEBUG_LAYERS }
  }

  setLayers(layers) { Object.assign(this.layers, layers) }

  update(robots, world) {
    const on = this.layers
    const P = this.lines
    P.begin()
    this.com.visible = false
    for (const r of robots) {
      const S = r.stability
      if (on.com) {
        this.com.visible = true
        this.com.position.set(S.com.x, S.com.y, S.com.z)
        P.line(S.com.x, S.com.y, S.com.z, S.com.x, 0.02, S.com.z, 0xff00ff)
      }
      if (on.support && S.hull?.length) {
        const c = STATE_COLOR[S.state] ?? 0xffffff
        for (let i = 0; i < S.hull.length; i++) {
          const a = S.hull[i], b = S.hull[(i + 1) % S.hull.length]
          P.line(a.x, 0.03, a.z, b.x, 0.03, b.z, c)
        }
      }
      for (const f of r.feet.values()) {
        if (!f.contact) continue
        if (on.contacts) {
          for (const p of f.points) P.line(p.x, p.y, p.z, p.x + f.normal.x * 0.8, p.y + f.normal.y * 0.8, p.z + f.normal.z * 0.8, f.slipping ? 0xef4444 : 0x38bdf8)
        }
        if (on.forces) {
          const s = 0.15      // arrow length: su per newton
          P.line(f.point.x, f.point.y, f.point.z, f.point.x + f.force.x * s, f.point.y + f.force.y * s, f.point.z + f.force.z * s, 0xfacc15)
        }
      }
      if (on.joints) {
        for (const J of r.joints.values()) {
          if (!J.axisWorld) continue
          const t = J.child.body.translation(), q = J.child.body.rotation()
          const a = new THREE.Vector3(J.a2.x, J.a2.y, J.a2.z).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(t.x, t.y, t.z))
          const A = J.actuatorId && r.actuators.get(J.actuatorId)
          let c = 0x94a3b8
          if (A) {
            const hot = Math.min(1, Math.max(0, (A.servo.temperature - 25) / 65))
            c = A.servo.stalled ? 0xef4444 : new THREE.Color(0x22c55e).lerp(new THREE.Color(0xef4444), hot).getHex()
          }
          const d = J.axisWorld
          P.line(a.x - d.x * 0.8, a.y - d.y * 0.8, a.z - d.z * 0.8, a.x + d.x * 0.8, a.y + d.y * 0.8, a.z + d.z * 0.8, c)
        }
      }
      if (on.velocity) {
        for (const Lk of r.links.values()) {
          const c = Lk.body.worldCom(), v = Lk.body.linvel()
          P.line(c.x, c.y, c.z, c.x + v.x * 0.2, c.y + v.y * 0.2, c.z + v.z * 0.2, 0xa78bfa)
        }
      }
    }
    P.end()

    // Rapier's own view of every collider/joint (exact shapes).
    if (on.colliders && world) {
      const { vertices, colors } = world.debugRender()
      if (!this.rapierLines) {
        const g = new THREE.BufferGeometry()
        this.rapierLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthTest: false }))
        this.rapierLines.frustumCulled = false
        this.rapierLines.renderOrder = 998
        this.group.add(this.rapierLines)
      }
      const g = this.rapierLines.geometry
      g.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
      this.rapierLines.material.vertexColors = true
      this.rapierLines.visible = true
    } else if (this.rapierLines) this.rapierLines.visible = false
  }

  dispose() {
    this.lines.dispose()
    if (this.rapierLines) { this.rapierLines.geometry.dispose(); this.rapierLines.material.dispose() }
    this.com.geometry.dispose(); this.com.material.dispose()
    this.group.removeFromParent()
  }
}
