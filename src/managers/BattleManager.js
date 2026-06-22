import * as THREE from 'three'
import { sceneManager } from './SceneManager.js'
import { objectManager } from './ObjectManager.js'
import { networkManager } from './NetworkManager.js'
import { useGameStore } from '../stores/gameStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { assemblyMembers } from '../utils/robotAssembly.js'

// ── Tunable game physics ──────────────────────────────────────────────────────
const RING_RADIUS  = 24      // bigger ring → harder to push out
const ACCEL        = 26
const MAX_SPEED    = 11
const TURN_RATE    = 3.2
const FRICTION     = 2.6
const RESTITUTION  = 0.45
const DMG_K        = 7.5
const DMG_THRESH   = 1.2
const HIT_COOLDOWN = 0.45
const START_HP     = 100
const START_LIVES  = 3
const UP = new THREE.Vector3(0, 1, 0)

// Which body face is the "nose" → its angle about Y (so Forward drives that face).
const FRONT_TO_ANGLE = { '+z': 0, '+x': Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2 }
const A0 = (f) => FRONT_TO_ANGLE[f] ?? 0

class BattleManager {
  constructor() {
    this._mode = 'local'      // 'local' | 'host' | 'guest'
    this._a = null            // robot p1
    this._b = null            // robot p2
    this._arena = null
    this._proxy = null        // online opponent proxy mesh (disposed on stop)
    this._keys = new Set()
    this._last = 0
    this._hitClock = 0
    this._roundEndAt = 0
    this._msgClear = 0
    this._orig = {}
    this._remoteInput = { forward: 0, turn: 0 }
    this._oppInfo = null
    this._onKeyDown = null
    this._onKeyUp = null
  }

  isActive() { return useGameStore.getState().battleActive }

  // ── Robot info (for proxies sent over the network) ──────────────────────────
  getRobotInfo(id) {
    const root = objectManager.getMesh(id)
    if (!root) return null
    root.updateMatrixWorld(true)
    // position+rotation only (NOT the root's scale, which would distort offsets)
    const rootPos = root.getWorldPosition(new THREE.Vector3())
    const rootQInv = root.getWorldQuaternion(new THREE.Quaternion()).invert()
    const objects = useSceneStore.getState().objects
    const obj = objects.find(o => o.id === id)

    // Build a per-part list (each part = a box, positioned relative to the root)
    // so the opponent can render a matching multi-box robot — not one big cube.
    const box = new THREE.Box3()
    const parts = []
    for (const mid of assemblyMembers(id)) {
      const m = objectManager.getMesh(mid)
      if (!m) continue
      m.updateMatrixWorld(true)
      const wb = new THREE.Box3().setFromObject(m)
      if (wb.isEmpty()) continue
      box.union(wb)
      const size = wb.getSize(new THREE.Vector3())
      const center = wb.getCenter(new THREE.Vector3()).sub(rootPos).applyQuaternion(rootQInv)
      const mo = objects.find(o => o.id === mid)
      if (parts.length < 30) parts.push({
        d: [Math.max(0.15, size.x), Math.max(0.15, size.y), Math.max(0.15, size.z)],
        c: mo?.color ?? '#88aacc',
        p: [center.x, center.y, center.z],
      })
    }
    if (box.isEmpty()) box.setFromObject(root)
    const s = box.getSize(new THREE.Vector3())

    return {
      name: obj?.name ?? 'Robot',
      dims: [Math.max(0.4, s.x), Math.max(0.4, s.y), Math.max(0.4, s.z)],
      color: obj?.color ?? '#88aacc',
      baseY: root.position.y,
      parts,   // box cluster — shown instantly, then upgraded by streamed geometry
      radius: Math.max(0.6, Math.max(s.x, s.z) / 2),
      mass: Math.max(0.6, Math.min(12, s.x * s.y * s.z * 0.12)),
    }
  }

  // Exact per-mesh geometry of the whole assembly, relative to the root's
  // position+rotation. Streamed one mesh per message, paced (see _sendMyGeo).
  // Payload is kept compact: only the position array (+ index); normals are
  // recomputed on the receiver. geometry.toJSON() is far too bloated to stream.
  getRobotGeo(id) {
    const root = objectManager.getMesh(id)
    if (!root) return []
    root.updateMatrixWorld(true)
    const rootPos = root.getWorldPosition(new THREE.Vector3())
    const rootQuat = root.getWorldQuaternion(new THREE.Quaternion())
    const rootFrameInv = new THREE.Matrix4().compose(rootPos, rootQuat, new THREE.Vector3(1, 1, 1)).invert()
    const objs = useSceneStore.getState().objects
    const members = assemblyMembers(id)

    // Map every member's mesh so a reparented child (e.g. a wheel attached into a
    // motor) is attributed to ITS OWN member, not the motor it now lives under,
    // and is therefore sent exactly once.
    const memberOf = new Map()
    for (const mid of members) { const m = objectManager.getMesh(mid); if (m) { m.updateMatrixWorld(true); memberOf.set(m, mid) } }
    const ownerOf = (leaf) => { let n = leaf; while (n) { if (memberOf.has(n)) return memberOf.get(n); n = n.parent } return null }
    const BLACK = new THREE.Color(0, 0, 0)

    // Send EVERY real leaf mesh so the opponent looks exactly like the original —
    // full detail (incl. GLB motor internals), each with its own colour/material.
    const geo = []
    for (const mid of members) {
      const mm = objectManager.getMesh(mid)
      if (!mm) continue
      const obj = objs.find(o => o.id === mid)
      mm.traverse(leaf => {
        if (!leaf.isMesh || !leaf.geometry || ownerOf(leaf) !== mid) return
        const pos = leaf.geometry.getAttribute('position')
        if (!pos) return
        const mat = Array.isArray(leaf.material) ? leaf.material[0] : leaf.material
        const rec = {
          p: Array.from(pos.array),
          m: rootFrameInv.clone().multiply(leaf.matrixWorld).toArray(),
          c: mat?.color ? '#' + mat.color.getHexString() : (obj?.color ?? '#88aacc'),
        }
        const idx = leaf.geometry.getIndex(); if (idx) rec.i = Array.from(idx.array)
        const nrm = leaf.geometry.getAttribute('normal'); if (nrm) rec.n = Array.from(nrm.array)
        if (mat) {
          if (typeof mat.roughness === 'number') rec.ro = mat.roughness
          if (typeof mat.metalness === 'number') rec.me = mat.metalness
          if (mat.transparent && mat.opacity < 1) rec.o = mat.opacity
          if (mat.emissive && !mat.emissive.equals(BLACK)) rec.e = '#' + mat.emissive.getHexString()
        }
        geo.push(rec)
      })
    }
    return geo
  }

  // Rebuild a Three mesh from a geometry record (see getRobotGeo), reproducing
  // its geometry + material so the opponent matches the original exactly.
  _meshFromGeoRec(g) {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3))
    if (g.i) geom.setIndex(g.i)
    if (g.n) geom.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3))
    else geom.computeVertexNormals()
    const opts = { color: g.c || '#88aacc', roughness: g.ro ?? 0.6, metalness: g.me ?? 0.25 }
    if (typeof g.o === 'number') { opts.transparent = true; opts.opacity = g.o }
    if (g.e) opts.emissive = new THREE.Color(g.e)
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial(opts))
    mesh.applyMatrix4(new THREE.Matrix4().fromArray(g.m))
    mesh.castShadow = true
    return mesh
  }

  _robotFromMesh(mesh, info, startX, id) {
    const isProxy = !!mesh.userData.isBattleProxy
    let movers, baseY
    if (isProxy || !id) {
      // Proxy: one group that already holds the part boxes.
      baseY = info.baseY ?? (info.dims ? info.dims[1] / 2 : 0)
      movers = [{ mesh, off: new THREE.Vector3(0, 0, 0), quat0: new THREE.Quaternion() }]
    } else {
      // Real robot: capture EVERY scene-level assembly part relative to the root,
      // so the whole thing moves rigidly (wheels attached to motors follow their
      // motor automatically as Three children).
      mesh.updateMatrixWorld(true)
      const rootPos0 = mesh.getWorldPosition(new THREE.Vector3())
      baseY = rootPos0.y
      movers = []
      for (const mid of assemblyMembers(id)) {
        if (objectManager.attachedObjects.has(mid)) continue   // wheel → follows its motor
        const m = objectManager.getMesh(mid)
        if (!m) continue
        m.updateMatrixWorld(true)
        movers.push({
          mesh: m,
          off: m.getWorldPosition(new THREE.Vector3()).sub(rootPos0),
          quat0: m.getWorldQuaternion(new THREE.Quaternion()),
        })
      }
      if (!movers.length) movers = [{ mesh, off: new THREE.Vector3(0, 0, 0), quat0: mesh.getWorldQuaternion(new THREE.Quaternion()) }]
    }
    return {
      mesh, movers, isProxy,
      radius: info.radius, mass: info.mass,
      x: startX, z: 0, baseY,
      vx: 0, vz: 0,
      heading: Math.atan2(-startX, 0),   // face the centre
      frontA0: 0, frontAngle0: 0,
      startX,
    }
  }

  // Opponent proxy: an exact geometry replica if available, else a box cluster.
  _makeProxyMesh(info) {
    const group = new THREE.Group()
    group.userData.isBattleProxy = true

    if (info.geo && info.geo.length) {
      for (const g of info.geo) {
        try { group.add(this._meshFromGeoRec(g)) } catch (_) { /* skip bad geometry */ }
      }
    }
    if (!group.children.length) {   // fallback: box cluster
      const parts = (info.parts && info.parts.length) ? info.parts : [{ d: info.dims, c: info.color, p: [0, 0, 0] }]
      for (const pt of parts) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(pt.d[0] || 0.4, pt.d[1] || 0.4, pt.d[2] || 0.4),
          new THREE.MeshStandardMaterial({ color: pt.c || '#88aacc', roughness: 0.6, metalness: 0.2 })
        )
        mesh.position.set(pt.p[0], pt.p[1], pt.p[2])
        mesh.castShadow = true
        group.add(mesh)
      }
    }
    sceneManager.scene.add(group)
    this._proxy = group
    return group
  }

  // ── Local 2-player ──────────────────────────────────────────────────────────
  startLocal(p1Id, p2Id) {
    if (!p1Id || !p2Id || p1Id === p2Id) return false
    const i1 = this.getRobotInfo(p1Id), i2 = this.getRobotInfo(p2Id)
    if (!i1 || !i2) return false
    this._mode = 'local'
    this._a = this._robotFromMesh(objectManager.getMesh(p1Id), i1,  RING_RADIUS * 0.55, p1Id)
    this._b = this._robotFromMesh(objectManager.getMesh(p2Id), i2, -RING_RADIUS * 0.55, p2Id)
    this._saveOrig([p1Id, p2Id])
    this._enter()
    return true
  }

  // ── Online ────────────────────────────────────────────────────────────────
  connectHost() {
    networkManager.onData  = (m) => this._handleNet(m)
    networkManager.onReady = () => this.sendHello()
    networkManager.onClose = () => { if (this.isActive()) this.stop() }
    return networkManager.host()
  }
  connectJoin(code) {
    networkManager.onData  = (m) => this._handleNet(m)
    networkManager.onReady = () => this.sendHello()
    networkManager.onClose = () => { if (this.isActive()) this.stop() }
    networkManager.join(code)
  }
  sendHello() {
    const id = useGameStore.getState().myRobotId
    const info = id ? this.getRobotInfo(id) : null
    if (info) networkManager.send({ t: 'hello', info })
  }

  // Host begins the match (must have opponent info from their hello)
  hostStart() {
    const g = useGameStore.getState()
    const myInfo = g.myRobotId ? this.getRobotInfo(g.myRobotId) : null
    if (!myInfo || !this._oppInfo) return false
    this._mode = 'host'
    this._a = this._robotFromMesh(objectManager.getMesh(g.myRobotId), myInfo, RING_RADIUS * 0.55, g.myRobotId)
    this._b = this._robotFromMesh(this._makeProxyMesh(this._oppInfo), this._oppInfo, -RING_RADIUS * 0.55, null)
    this._saveOrig([g.myRobotId])
    networkManager.send({ t: 'start', hostInfo: myInfo })
    this._enter()
    return true
  }

  // Guest begins when it receives 'start'
  _guestStart(hostInfo) {
    const g = useGameStore.getState()
    const myInfo = g.myRobotId ? this.getRobotInfo(g.myRobotId) : null
    if (!myInfo) return
    this._mode = 'guest'
    this._oppInfo = hostInfo
    this._a = this._robotFromMesh(this._makeProxyMesh(hostInfo), hostInfo,  RING_RADIUS * 0.55, null)
    this._b = this._robotFromMesh(objectManager.getMesh(g.myRobotId), myInfo, -RING_RADIUS * 0.55, g.myRobotId)
    this._saveOrig([g.myRobotId])
    this._enter()
  }

  _handleNet(msg) {
    if (!msg || !msg.t) return
    if (msg.t === 'hello') {
      this._oppInfo = msg.info
      useGameStore.getState().sync({ oppName: msg.info?.name ?? 'Opponent', oppReady: true })
    } else if (msg.t === 'start') {
      this._guestStart(msg.hostInfo)
    } else if (msg.t === 'state') {
      this._applyState(msg)
    } else if (msg.t === 'geomesh') {
      this._applyGeoMesh(msg)
    } else if (msg.t === 'geometa') {
      this._applyGeoMeta(msg)
    } else if (msg.t === 'georeq') {
      this._sendMyGeo()                 // opponent is missing meshes — re-stream
    } else if (msg.t === 'roundloss') {
      this._resolveLoss(msg.side, msg.how)
    } else if (msg.t === 'bye') {
      if (this.isActive()) this.stop()
    }
  }

  // ── Shared entry ────────────────────────────────────────────────────────────
  _enter() {
    // Online uses split authority: each client owns one robot. host = p1, guest = p2.
    this._mySide = this._mode === 'host' ? 'p1' : this._mode === 'guest' ? 'p2' : null
    this._buildArena()
    this._hideNonCombatants()
    sceneManager.detachTransform?.()
    useSceneStore.getState().clearSelection?.()
    if (sceneManager.camera && sceneManager.orbitControls) {
      sceneManager.camera.position.set(0, RING_RADIUS * 1.7, RING_RADIUS * 1.25)
      sceneManager.orbitControls.target.set(0, 0, 0)
      sceneManager.orbitControls.update()
    }
    // Front-face offset + which keys are live, from the player's control config
    const ctrl = useGameStore.getState().controls
    this._activeKeys = new Set()
    const addKeys = (c) => ['up', 'down', 'left', 'right'].forEach(a => this._activeKeys.add(c[a]))
    if (this._mode === 'local') {
      addKeys(ctrl.p1); addKeys(ctrl.p2)
      this._setFront(this._a, A0(ctrl.p1.front)); this._a.heading = Math.atan2(-this._a.startX, 0)
      this._setFront(this._b, A0(ctrl.p2.front)); this._b.heading = Math.atan2(-this._b.startX, 0)
    } else {
      addKeys(ctrl.p1)
      this._setFront(this._mine(), A0(ctrl.p1.front)); this._mine().heading = Math.atan2(-this._mine().startX, 0)
      this._setFront(this._theirs(), 0);              this._theirs().heading = Math.atan2(-this._theirs().startX, 0)
    }

    this._keys.clear()
    this._onKeyDown = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (this._activeKeys.has(k)) { this._keys.add(k); e.preventDefault() }
    }
    this._onKeyUp = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this._keys.delete(k)
    }
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    this._last = performance.now()
    this._roundEndAt = 0

    if (this._mode === 'local') {
      useGameStore.getState().sync({ battleActive: true })
      this._beginRound(1, { p1: START_LIVES, p2: START_LIVES })
      return
    }

    // Online: capture & stream my geometry FIRST, while the robot is still at rest
    // (before _placeStart rotates it) so the opponent reconstructs it correctly.
    // Show a loading screen and don't start fighting until the opponent's full
    // robot has arrived (or a fallback timeout).
    if (this._proxy) this._proxy.visible = false
    this._opponentReady = false
    useGameStore.getState().sync({ battleActive: true, status: 'loading', message: '' })
    this._sendGeoMeta()
    this._sendMyGeo()
    this._placeStart()
    clearTimeout(this._loadTimer)
    this._loadTimer = setTimeout(() => this._beginOnlineFight(), 12000)
  }

  // The robot's built front-direction angle, so "Forward" drives the chosen face
  // and turning rotates the whole assembly. Uses the REST orientation captured
  // once (so it stays correct even after the body is driven / re-faced live).
  _setFront(r, a0) {
    r.frontA0 = a0
    if (!r._restQuat) r._restQuat = r.mesh.getWorldQuaternion(new THREE.Quaternion())
    const fl = new THREE.Vector3(Math.sin(a0), 0, Math.cos(a0)).applyQuaternion(r._restQuat)
    r.frontAngle0 = (fl.x * fl.x + fl.z * fl.z) > 1e-6 ? Math.atan2(fl.x, fl.z) : 0
  }

  // Reveal the opponent + start the first round (online). Safe to call repeatedly —
  // only fires while still in the 'loading' state.
  _beginOnlineFight() {
    const g = useGameStore.getState()
    if (this._mode === 'local' || g.status !== 'loading') return
    clearTimeout(this._loadTimer)
    if (this._proxy) this._proxy.visible = true
    if (this._mode === 'host') {
      this._beginRound(1, { p1: START_LIVES, p2: START_LIVES })
    } else {
      g.sync({ status: 'fighting', round: 1, message: 'Round 1 — FIGHT!' })
      this._msgClear = performance.now() + 1200
      this._placeStart()
    }
  }

  // Send my robot's ORIENTATION reference: the root's rest world quaternion + my
  // chosen front angle + ground height. The opponent applies these to its proxy
  // so the robot isn't rendered flipped/upside-down and faces the right way. Also
  // re-sent when I change my nose mid-game.
  _sendGeoMeta() {
    const id = useGameStore.getState().myRobotId
    const root = objectManager.getMesh(id)
    const me = this._mine()
    if (!root || !me) return
    const q = me._restQuat || root.getWorldQuaternion(new THREE.Quaternion())
    networkManager.send({ t: 'geometa', q: [q.x, q.y, q.z, q.w], f: me.frontAngle0, baseY: me.baseY })
  }

  _applyGeoMeta(msg) {
    const opp = this._theirs()
    if (!opp) return
    if (Array.isArray(msg.q) && opp.movers && opp.movers[0]) {
      opp.movers[0].quat0 = new THREE.Quaternion(msg.q[0], msg.q[1], msg.q[2], msg.q[3])
    }
    if (typeof msg.f === 'number') opp.frontAngle0 = msg.f
    if (typeof msg.baseY === 'number') opp.baseY = msg.baseY
    this._applyMesh(opp)
  }

  // Change which face is the nose DURING a match (no need to exit). Keeps the body
  // physically where it is and just remaps which direction "Forward" drives.
  //   slot: 'p1' | 'p2'  (online → always your own robot; local → that player)
  changeFront(slot, front) {
    const r = this._mode === 'local' ? (slot === 'p2' ? this._b : this._a) : this._mine()
    if (r) {
      const oldFA = r.frontAngle0
      this._setFront(r, A0(front))
      r.heading += (r.frontAngle0 - oldFA)   // keep body orientation fixed
      this._applyMesh(r)
      if (this._mode !== 'local') this._sendGeoMeta()
    }
    useGameStore.getState().setControl(slot, 'front', front)
  }

  // Stream my real geometry to the opponent, ONE mesh per message and PACED:
  // wait for the data-channel buffer to drain before sending the next, or the
  // burst overflows the SCTP send buffer and messages (incl. i:0) get dropped —
  // which is why the opponent's box proxy never upgraded.
  async _sendMyGeo() {
    const id = useGameStore.getState().myRobotId
    const geo = this.getRobotGeo(id)
    this._geoStreamId = (this._geoStreamId || 0) + 1
    const stream = this._geoStreamId
    if (!geo.length) { console.warn('[battle] no geometry to stream for', id); return }
    console.log('[battle] streaming', geo.length, 'meshes to opponent')
    for (let i = 0; i < geo.length; i++) {
      if (stream !== this._geoStreamId || !networkManager.isConnected()) return
      await this._sendPaced({ t: 'geomesh', i, total: geo.length, g: geo[i] })
    }
    console.log('[battle] geometry stream complete')
  }

  // Send one message, then resolve once the channel buffer has drained (backpressure).
  _sendPaced(msg) {
    return new Promise((resolve) => {
      const conn = networkManager.conn
      if (!conn || !conn.open) { resolve(); return }
      try { conn.send(msg) } catch (_) {}
      const dc = conn.dataChannel
      if (dc && typeof dc.bufferedAmount === 'number') {
        const wait = () => {
          if (!conn.open || dc.bufferedAmount < 65536) resolve()
          else setTimeout(wait, 25)
        }
        setTimeout(wait, 15)
      } else {
        setTimeout(resolve, 50)
      }
    })
  }

  _applyGeoMesh(msg) {
    if (!this._proxy) return
    // First mesh of a (re)stream: drop placeholder boxes + reset arrival tracking.
    if (msg.i === 0) {
      while (this._proxy.children.length) {
        const c = this._proxy.children[0]
        c.geometry?.dispose(); c.material?.dispose?.()
        this._proxy.remove(c)
      }
      this._geoRecv = new Set()
      this._geoTotal = msg.total
      this._geoReqTries = 0
    }
    if (!this._geoRecv) { this._geoRecv = new Set(); this._geoTotal = msg.total }
    if (this._geoRecv.has(msg.i)) return     // dedupe overlapping resends
    this._geoRecv.add(msg.i)
    try { this._proxy.add(this._meshFromGeoRec(msg.g)) } catch (_) { /* skip */ }
    console.log('[battle] geomesh', this._geoRecv.size, '/', msg.total)

    // Keep going until the WHOLE robot has arrived: if no new mesh shows up for a
    // few seconds and we're still short, ask the opponent to re-stream.
    clearTimeout(this._geoReqTimer)
    if (this._geoTotal && this._geoRecv.size >= this._geoTotal) {
      console.log('[battle] opponent fully rendered')
      this._opponentReady = true
      this._beginOnlineFight()   // leave the loading screen now the robot is complete
    } else {
      this._geoReqTimer = setTimeout(() => {
        if (this._geoTotal && this._geoRecv && this._geoRecv.size < this._geoTotal && (this._geoReqTries || 0) < 4) {
          this._geoReqTries = (this._geoReqTries || 0) + 1
          console.warn('[battle] incomplete geometry', this._geoRecv.size, '/', this._geoTotal, '— requesting resend')
          networkManager.send({ t: 'georeq' })
        }
      }, 4000)
    }
  }

  stop() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    this._keys.clear()
    clearTimeout(this._geoReqTimer)
    clearTimeout(this._loadTimer)
    this._geoRecv = null; this._geoTotal = 0; this._opponentReady = false
    this._clearArena()
    if (this._hidden) { this._hidden.forEach(m => { m.visible = true }); this._hidden = null }
    if (this._proxy) {
      this._proxy.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose?.() })
      this._proxy.removeFromParent(); this._proxy = null
    }
    for (const [id, t] of Object.entries(this._orig)) {
      const mesh = objectManager.getMesh(id)
      if (mesh) { mesh.position.set(t.position.x, t.position.y, t.position.z); mesh.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z) }
      useSceneStore.getState().updateObject(id, { position: t.position, rotation: t.rotation })
    }
    this._orig = {}
    if (this._mode !== 'local') { networkManager.send({ t: 'bye' }); networkManager.disconnect() }
    this._a = this._b = null
    this._mode = 'local'
    useGameStore.getState().sync({ battleActive: false, status: 'setup', connState: 'idle', oppReady: false, oppName: '', role: null })
  }

  _saveOrig(ids) {
    this._orig = {}
    for (const id of ids) {
      const o = useSceneStore.getState().objects.find(x => x.id === id)
      if (o) this._orig[id] = { position: { ...o.position }, rotation: { ...o.rotation } }
    }
  }

  // Hide everything that isn't a combatant or the arena, so stray scene objects
  // don't clutter the ring. Restored on stop.
  _hideNonCombatants() {
    const keep = new Set()
    for (const r of [this._a, this._b]) if (r) for (const mv of r.movers) keep.add(mv.mesh)
    const isKept = (m) => { let n = m; while (n) { if (keep.has(n)) return true; n = n.parent } return false }
    this._hidden = []
    for (const m of objectManager.getAllMeshes()) {
      if (m.userData.isArena || m.userData.isBattleProxy || isKept(m)) continue
      if (m.visible) { this._hidden.push(m); m.visible = false }
    }
  }

  _placeStart() {
    for (const r of [this._a, this._b]) {
      r.x = r.startX; r.z = 0; r.vx = 0; r.vz = 0
      r.heading = Math.atan2(-r.startX, 0)   // face the centre
      this._applyMesh(r)
    }
  }

  _beginRound(round, lives) {
    this._placeStart()
    useGameStore.getState().sync({
      status: 'fighting', round, lives: lives ?? useGameStore.getState().lives,
      hp: { p1: START_HP, p2: START_HP }, message: `Round ${round} — FIGHT!`, winner: null,
    })
    this._msgClear = performance.now() + 1200
  }

  // ── Frame update ─────────────────────────────────────────────────────────────
  step() {
    const g = useGameStore.getState()
    if (!g.battleActive) return
    const now = performance.now()
    let dt = (now - this._last) / 1000
    this._last = now
    if (dt <= 0) return
    if (dt > 0.05) dt = 0.05

    if (this._msgClear && now > this._msgClear) { useGameStore.getState().sync({ message: '' }); this._msgClear = 0 }

    if (this._mode === 'local') return this._stepLocal(g, now, dt)
    return this._stepOnline(g, now, dt)
  }

  // ── Local 2-player: simulate both robots here ───────────────────────────────
  _stepLocal(g, now, dt) {
    if (g.status === 'roundover' || g.status === 'matchover') {
      if (g.status === 'roundover' && now > this._roundEndAt) this._beginRound(g.round + 1, g.lives)
      return
    }
    if (g.status !== 'fighting') return
    this._drive(this._a, this._input('p1'), dt)
    this._drive(this._b, this._input('p2'), dt)
    this._collide(now)
    this._applyMesh(this._a)
    this._applyMesh(this._b)
    this._checkRingOut(now)
  }

  // ── Online split-authority: I simulate MY robot, render the opponent ────────
  _mine() { return this._mySide === 'p1' ? this._a : this._b }
  _theirs() { return this._mySide === 'p1' ? this._b : this._a }

  _stepOnline(g, now, dt) {
    const me = this._mine(), opp = this._theirs()

    // round reset (both clients do it from the same start positions)
    if (g.status === 'roundover') {
      if (now > this._roundEndAt) {
        me.x = me.startX; me.z = 0; me.vx = 0; me.vz = 0; me.heading = Math.atan2(-me.startX, 0)
        this._applyMesh(me)
        useGameStore.getState().sync({ status: 'fighting', round: g.round + 1, hp: { ...g.hp, [this._mySide]: START_HP }, message: `Round ${g.round + 1} — FIGHT!` })
        this._msgClear = now + 1200
      }
      this._sendState()
      return
    }
    if (g.status !== 'fighting') { this._sendState(); return }

    // drive my robot locally (always responsive)
    this._drive(me, this._localInput(), dt)
    this._collideOnline(me, opp, now)
    this._applyMesh(me)
    this._applyMesh(opp)
    // my ring-out → I lost the round
    if (Math.hypot(me.x, me.z) > RING_RADIUS) this._declareLoss(this._mySide, 'RING-OUT')
    this._sendState()
  }

  _sendState() {
    const me = this._mine()
    if (!me) return
    networkManager.send({
      t: 'state', side: this._mySide,
      x: me.x, z: me.z, h: me.heading, vx: me.vx, vz: me.vz,
      hp: useGameStore.getState().hp[this._mySide],
    })
  }

  // Push myself out of overlap + take damage when the opponent rams me.
  _collideOnline(me, opp, now) {
    const dx = opp.x - me.x, dz = opp.z - me.z
    const dist = Math.hypot(dx, dz)
    const minD = me.radius + opp.radius
    if (dist >= minD || dist < 1e-4) return
    const nx = dx / dist, nz = dz / dist
    const overlap = minD - dist
    me.x -= nx * overlap; me.z -= nz * overlap        // move myself clear
    const relN = (opp.vx - me.vx) * nx + (opp.vz - me.vz) * nz
    if (relN >= 0) return
    const closing = -relN
    const massRatio = opp.mass / (me.mass + opp.mass)
    const k = (1 + RESTITUTION) * closing * massRatio
    me.vx -= nx * k; me.vz -= nz * k                  // knockback
    // A hard contact damages me (each client damages its own robot; both sides
    // compute it, so a ram costs both — ring-out is the decisive win).
    if (closing > DMG_THRESH && now > this._hitClock) {
      this._hitClock = now + HIT_COOLDOWN * 1000
      const g = useGameStore.getState()
      const myHp = Math.max(0, g.hp[this._mySide] - Math.round(DMG_K * closing * 0.6))
      g.sync({ hp: { ...g.hp, [this._mySide]: myHp } })
      if (myHp === 0) this._declareLoss(this._mySide, 'KO')
    }
  }

  _declareLoss(side, how) {
    if (useGameStore.getState().status !== 'fighting') return
    networkManager.send({ t: 'roundloss', side, how })
    this._resolveLoss(side, how)
  }

  _resolveLoss(side, how) {
    const g = useGameStore.getState()
    if (g.status !== 'fighting') return
    const lives = { ...g.lives, [side]: Math.max(0, g.lives[side] - 1) }
    const winner = side === 'p1' ? 'p2' : 'p1'
    const wname = this._winnerName(winner)
    if (lives[side] <= 0) g.sync({ status: 'matchover', lives, winner, message: `${wname} WINS! 🏆` })
    else { g.sync({ status: 'roundover', lives, message: `${how}! ${wname} wins the round` }); this._roundEndAt = performance.now() + 2200 }
  }

  // Opponent broadcast → place their proxy + show their HP
  _applyState(msg) {
    const opp = this._theirs()
    if (!opp || msg.side === this._mySide) return
    opp.x = msg.x; opp.z = msg.z; opp.heading = msg.h
    opp.vx = msg.vx || 0; opp.vz = msg.vz || 0
    this._applyMesh(opp)
    if (typeof msg.hp === 'number') {
      const g = useGameStore.getState()
      const side = this._mySide === 'p1' ? 'p2' : 'p1'
      if (g.hp[side] !== msg.hp) g.sync({ hp: { ...g.hp, [side]: msg.hp } })
    }
  }

  _readKeys(c) {
    const k = this._keys
    return {
      forward: (k.has(c.up) ? 1 : 0) - (k.has(c.down) ? 1 : 0),
      turn:    (k.has(c.left) ? 1 : 0) - (k.has(c.right) ? 1 : 0),
    }
  }
  _input(player) { return this._readKeys(useGameStore.getState().controls[player]) }
  // Online: the local player uses the p1 control slot (their own keyboard config)
  _localInput() { return this._readKeys(useGameStore.getState().controls.p1) }

  _drive(r, input, dt) {
    r.heading += input.turn * TURN_RATE * dt
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading)
    r.vx += fx * input.forward * ACCEL * dt
    r.vz += fz * input.forward * ACCEL * dt
    const fr = Math.max(0, 1 - FRICTION * dt)
    r.vx *= fr; r.vz *= fr
    const sp = Math.hypot(r.vx, r.vz)
    if (sp > MAX_SPEED) { r.vx *= MAX_SPEED / sp; r.vz *= MAX_SPEED / sp }
    r.x += r.vx * dt; r.z += r.vz * dt
  }

  _collide(now) {
    const a = this._a, b = this._b
    const dx = b.x - a.x, dz = b.z - a.z
    const dist = Math.hypot(dx, dz)
    const minD = a.radius + b.radius
    if (dist >= minD || dist < 1e-4) return
    const nx = dx / dist, nz = dz / dist
    const overlap = minD - dist
    const invA = 1 / a.mass, invB = 1 / b.mass, invSum = invA + invB
    a.x -= nx * overlap * (invA / invSum); a.z -= nz * overlap * (invA / invSum)
    b.x += nx * overlap * (invB / invSum); b.z += nz * overlap * (invB / invSum)
    const relN = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz
    if (relN >= 0) return
    const closing = -relN
    const j = -(1 + RESTITUTION) * relN / invSum
    a.vx -= j * nx * invA; a.vz -= j * nz * invA
    b.vx += j * nx * invB; b.vz += j * nz * invB
    if (closing > DMG_THRESH && now > this._hitClock) {
      this._hitClock = now + HIT_COOLDOWN * 1000
      const dmg = Math.round(DMG_K * closing)
      const aTowards = a.vx * nx + a.vz * nz
      const bTowards = -(b.vx * nx + b.vz * nz)
      const g = useGameStore.getState()
      const hp = { ...g.hp }
      if (aTowards >= bTowards) { hp.p2 -= dmg; hp.p1 -= Math.round(dmg * 0.3) }
      else                     { hp.p1 -= dmg; hp.p2 -= Math.round(dmg * 0.3) }
      hp.p1 = Math.max(0, hp.p1); hp.p2 = Math.max(0, hp.p2)
      g.sync({ hp })
      if (hp.p1 === 0 || hp.p2 === 0) this._endRound(hp.p1 === 0 ? 'p2' : 'p1', 'KO')
    }
  }

  // Rigidly place the whole assembly: root at (x, z), spun so its front faces
  // `heading`. Every captured part keeps its offset/orientation relative to the root.
  _applyMesh(r) {
    const spin = r.heading - r.frontAngle0
    const c = Math.cos(spin), s = Math.sin(spin)
    const qSpin = new THREE.Quaternion().setFromAxisAngle(UP, spin)
    for (const mv of r.movers) {
      const ox = mv.off.x, oz = mv.off.z
      mv.mesh.position.set(
        r.x + ox * c + oz * s,
        r.baseY + mv.off.y,
        r.z - ox * s + oz * c,
      )
      mv.mesh.quaternion.copy(qSpin).multiply(mv.quat0)
    }
  }

  _checkRingOut(now) {
    const aOut = Math.hypot(this._a.x, this._a.z) > RING_RADIUS
    const bOut = Math.hypot(this._b.x, this._b.z) > RING_RADIUS
    if (!aOut && !bOut) return
    let loser
    if (aOut && bOut) loser = Math.hypot(this._a.x, this._a.z) >= Math.hypot(this._b.x, this._b.z) ? 'p1' : 'p2'
    else loser = aOut ? 'p1' : 'p2'
    this._endRound(loser === 'p1' ? 'p2' : 'p1', 'RING-OUT')
  }

  _endRound(winner, how) {
    const g = useGameStore.getState()
    if (g.status !== 'fighting') return
    const loser = winner === 'p1' ? 'p2' : 'p1'
    const lives = { ...g.lives, [loser]: Math.max(0, g.lives[loser] - 1) }
    const wname = this._winnerName(winner)
    if (lives[loser] <= 0) g.sync({ status: 'matchover', lives, winner, message: `${wname} WINS! 🏆` })
    else { g.sync({ status: 'roundover', lives, message: `${how}! ${wname} wins the round` }); this._roundEndAt = performance.now() + 2200 }
  }

  _winnerName(w) {
    if (this._mode === 'local') return w === 'p1' ? 'Player 1' : 'Player 2'
    // online: p1 = host, p2 = guest
    return w === 'p1' ? 'Host' : 'Challenger'
  }

  // ── Arena ────────────────────────────────────────────────────────────────────
  _buildArena() {
    this._clearArena()
    const g = new THREE.Group()
    g.userData.isArena = true
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o })
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(RING_RADIUS, RING_RADIUS, 0.4, 72), mat(0x2b2f38))
    plat.position.y = -0.2; plat.receiveShadow = true; g.add(plat)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.22, 14, 80), mat(0xffcc33, { emissive: 0x553300, roughness: 0.5 }))
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; g.add(ring)
    const inner = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS * 0.45, 0.06, 10, 64), mat(0x556070))
    inner.rotation.x = Math.PI / 2; inner.position.y = 0.03; g.add(inner)
    sceneManager.scene.add(g)
    this._arena = g
  }

  _clearArena() {
    if (!this._arena) return
    this._arena.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose?.() })
    this._arena.removeFromParent()
    this._arena = null
  }
}

export const battleManager = new BattleManager()
