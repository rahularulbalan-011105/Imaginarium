import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// ArenaEnvironment — how the BattleBot Arena LOOKS (visuals only).
//
// CombatManager owns the arena's PHYSICS (floor plane + four static wall
// boxes at ±half). This builds the venue around that exact footprint and
// nothing here collides with anything: robots, shots, the camera spring-arm
// (physics raycasts) and mouse aim (`aimTargets` = floor + walls only) never
// see the decoration.
//
//   floor      one procedurally painted texture: steel plates, seams, bolts,
//              wear, centre hexagon + ring, start boxes, perimeter hazard band,
//              corner numerals (no stacked decals → no z-fighting)
//   enclosure  wall boxes on the collision footprint (panel / hazard texture),
//              posts outside the inner face, amber top rail, cyan floor strip,
//              faint protective shield panes + frames
//   venue      corner light towers + spotlights, perimeter truss with lamps,
//              tiered stands with an instanced crowd, an enclosing hall with
//              its own fog / background, championship banners, scoreboards
//   lighting   hemisphere fill + four tower spotlights (no extra shadow maps;
//              the editor's sun keeps casting the shadows)
//
// While active it replaces the editor's white background / fog and hides the
// editor grid + axes; dispose() restores them exactly and frees every
// geometry, material and texture it made. Repeated items are InstancedMesh
// (one draw call per kind); the whole venue is ~30 draw calls.
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  floor: '#5b626b', floorDark: '#4b5159', seam: '#2b3035', steel: 0x6b737d, steelDark: 0x3d434b,
  gunmetal: 0x4a5059, amber: 0xf59e0b, amberHex: '#f59e0b', cyan: 0x22d3ee, cyanHex: '#22d3ee',
  hall: 0x1c2430, rubber: 0x1b1e22,
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')] }
// Deterministic pseudo-random (the venue looks the same every match).
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

class ArenaEnvironment {
  constructor() { this.group = null; this.aimTargets = []; this._saved = null; this._disposables = []; this._board = null }

  // scene, renderer: the shared editor scene; half: arena half-width (walls at ±half);
  // wallH / wallT: the collision walls' height + thickness.
  build({ scene, renderer, camera = null, grid, axes, half = 26, wallH = 3, wallT = 0.6 }) {
    this.dispose()
    const g = new THREE.Group()
    g.name = 'ArenaEnvironment'
    g.userData.isArena = true
    this.group = g
    this._half = half
    const aniso = renderer?.capabilities?.getMaxAnisotropy?.() || 4
    const own = (x) => { this._disposables.push(x); return x }
    const tex = (cv, opts = {}) => { const t = own(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; Object.assign(t, opts); t.needsUpdate = true; return t }
    const std = (o) => own(new THREE.MeshStandardMaterial(o))
    const basic = (o) => own(new THREE.MeshBasicMaterial(o))
    const geo = (x) => own(x)

    // ── Scene atmosphere: hall-coloured background + fog, editor helpers hidden ──
    this._saved = {
      scene, background: scene.background, fog: scene.fog,
      grid, gridVis: grid?.visible, axes, axesVis: axes?.visible,
      renderer, exposure: renderer?.toneMappingExposure,
      camera, near: camera?.near,
    }
    // Depth precision: the editor camera's near plane (0.01) is for close-up
    // modelling; at arena range (F2 / F4 sit 50–90 su away) it can't separate
    // the floor's layers. No chase view comes within 0.1 su of anything.
    if (camera && camera.near < 0.1) { camera.near = 0.1; camera.updateProjectionMatrix() }
    scene.background = new THREE.Color(C.hall)
    scene.fog = new THREE.Fog(C.hall, 70, 175)
    if (grid) grid.visible = false
    if (axes) axes.visible = false
    if (renderer) renderer.toneMappingExposure = 1.15

    // ── FLOOR (top flush with y = 0, exactly where the physics ground is) ──
    const floorTex = tex(this._paintFloor(half))
    const roughTex = tex(this._paintRoughness(), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace })
    roughTex.repeat.set(6, 6)
    const floorSize = half * 2
    const base = new THREE.Mesh(geo(new THREE.BoxGeometry(floorSize, 0.4, floorSize)), std({ color: C.steelDark, roughness: 0.8 }))
    base.position.y = -0.35            // top 15 cm under the painted plane (no z-fighting at long camera range)
    g.add(base)
    // The painted surface: a plane lying at y = 0 (u → +X, canvas top → −Z), so
    // markings / numerals read the right way round from the arena.
    const floor = new THREE.Mesh(geo(new THREE.PlaneGeometry(floorSize, floorSize)), std({ map: floorTex, roughnessMap: roughTex, roughness: 0.78, metalness: 0.32 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    floor.receiveShadow = true
    g.add(floor)
    // Apron outside the walls (service deck) — darker, so the fight floor reads as the stage.
    const apron = new THREE.Mesh(geo(new THREE.BoxGeometry(floorSize + 12, 0.3, floorSize + 12)), std({ color: 0x2f353d, roughness: 0.9, metalness: 0.2 }))
    apron.position.y = -0.45; apron.receiveShadow = true; g.add(apron)   // top 30 cm under the floor

    // ── ENCLOSURE on the collision footprint ──
    const wallTex = tex(this._paintWall(), { wrapS: THREE.RepeatWrapping })
    const walls = [
      { x: 0, z: -half, sx: floorSize, sz: wallT, len: floorSize },
      { x: 0, z: half, sx: floorSize, sz: wallT, len: floorSize },
      { x: -half, z: 0, sx: wallT, sz: floorSize, len: floorSize },
      { x: half, z: 0, sx: wallT, sz: floorSize, len: floorSize },
    ]
    const wallMat = std({ map: wallTex, roughness: 0.55, metalness: 0.45 })
    wallTex.repeat.set(floorSize / 6.5, 1)
    this.aimTargets = [floor]
    for (const w of walls) {
      const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w.sx, wallH, w.sz)), wallMat)
      m.position.set(w.x, wallH / 2, w.z)
      m.receiveShadow = true
      g.add(m)
      this.aimTargets.push(m)
    }
    // Amber top rail (emissive accent) and the cyan floor-edge light strip (flat, 2 cm).
    const railMat = std({ color: C.amber, emissive: C.amber, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.3 })
    const stripMat = basic({ color: C.cyan, toneMapped: false })
    const edge = half - wallT / 2
    for (const w of walls) {
      const along = w.sx > w.sz
      const rail = new THREE.Mesh(geo(new THREE.BoxGeometry(along ? w.len + wallT : wallT + 0.1, 0.16, along ? wallT + 0.1 : w.len + wallT)), railMat)
      rail.position.set(w.x, wallH + 0.08, w.z); g.add(rail)
      const sgn = Math.sign(w.x || w.z)
      const strip = new THREE.Mesh(geo(new THREE.BoxGeometry(along ? w.len - 1 : 0.12, 0.02, along ? 0.12 : w.len - 1)), stripMat)
      strip.position.set(along ? 0 : sgn * (edge - 0.2), 0.012, along ? sgn * (edge - 0.2) : 0); g.add(strip)
    }
    // Posts: outside the inner face (never inside the fighting area), every ~6.5 su.
    const postGeo = geo(new THREE.BoxGeometry(0.7, wallH + 1.2, 0.7))
    const postMat = std({ color: C.gunmetal, roughness: 0.5, metalness: 0.6 })
    const postPos = []
    const n = Math.round(floorSize / 6.5)
    for (let i = 0; i <= n; i++) {
      const t = -half + (floorSize * i) / n
      postPos.push([t, -half - 0.35], [t, half + 0.35], [-half - 0.35, t], [half + 0.35, t])
    }
    const posts = new THREE.InstancedMesh(postGeo, postMat, postPos.length)
    const M = new THREE.Matrix4()
    postPos.forEach(([x, z], i) => posts.setMatrixAt(i, M.makeTranslation(x, (wallH + 1.2) / 2, z)))
    g.add(posts)
    // Protective shield panes above the walls (very faint) + their frame bars.
    const shieldMat = std({ color: 0x9fdcff, transparent: true, opacity: 0.07, roughness: 0.1, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide })
    const shieldH = 4.2
    for (const w of walls) {
      const along = w.sx > w.sz
      const pane = new THREE.Mesh(geo(new THREE.PlaneGeometry(w.len, shieldH)), shieldMat)
      pane.position.set(w.x, wallH + 0.2 + shieldH / 2, w.z)
      if (!along) pane.rotation.y = Math.PI / 2
      g.add(pane)
    }
    const frameGeo = geo(new THREE.BoxGeometry(0.16, shieldH, 0.16))
    const frames = new THREE.InstancedMesh(frameGeo, postMat, postPos.length)
    postPos.forEach(([x, z], i) => frames.setMatrixAt(i, M.makeTranslation(x, wallH + 1.2 + shieldH / 2 - 0.5, z)))
    g.add(frames)
    const capGeo = geo(new THREE.BoxGeometry(floorSize + 1, 0.2, 0.25))
    for (const w of walls) {
      const along = w.sx > w.sz
      const cap = new THREE.Mesh(capGeo, postMat)
      cap.position.set(w.x, wallH + 0.2 + shieldH, w.z)
      if (!along) cap.rotation.y = Math.PI / 2
      g.add(cap)
    }

    // ── CORNER LIGHT TOWERS + the real arena lights ──
    const T = half + 3.2, towerH = 19
    const towerGeo = geo(new THREE.BoxGeometry(2.2, towerH, 2.2))
    const towerTex = tex(this._paintTower())
    const towerMat = std({ map: towerTex, roughness: 0.55, metalness: 0.5 })
    const towers = new THREE.InstancedMesh(towerGeo, towerMat, 4)
    const corners = [[T, T], [-T, T], [T, -T], [-T, -T]]
    corners.forEach(([x, z], i) => towers.setMatrixAt(i, M.makeTranslation(x, towerH / 2, z)))
    g.add(towers)
    const headGeo = geo(new THREE.BoxGeometry(3.4, 1.2, 1.6))
    const heads = new THREE.InstancedMesh(headGeo, postMat, 4)
    const lensGeo = geo(new THREE.PlaneGeometry(3.0, 0.9))
    const lensMat = basic({ color: 0xfff6e0, toneMapped: false })
    const lenses = new THREE.InstancedMesh(lensGeo, lensMat, 4)
    const Q = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3()
    corners.forEach(([x, z], i) => {
      // head faces the arena centre, tilted down
      const yaw = Math.atan2(-x, -z)
      Q.setFromEuler(new THREE.Euler(-0.55, yaw, 0, 'YXZ'))
      heads.setMatrixAt(i, M.compose(P.set(x, towerH + 0.4, z), Q, S1))
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(Q)
      lenses.setMatrixAt(i, M.compose(P.set(x, towerH + 0.4, z).addScaledVector(fwd, 0.82), Q, S1))
      const spot = new THREE.SpotLight(0xfff1dc, 0.55, 0, 0.62, 0.65, 0)
      spot.position.set(x, towerH + 0.4, z)
      spot.target.position.set(x * 0.15, 0, z * 0.15)
      g.add(spot, spot.target)
    })
    g.add(heads, lenses)
    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3a342c, 0.75)
    g.add(hemi)
    // Warm + cool rim accents grazing the walls (cheap, no shadows, limited reach).
    for (const [x, z, col] of [[0, -half + 2, 0xff9a3c], [0, half - 2, 0x40d8ff]]) {
      const p = new THREE.PointLight(col, 60, 34, 2); p.position.set(x, 6, z); g.add(p)
    }

    // ── PER-SIDE VENUE: truss + lamps, stands + crowd, signage ──
    // Each side of the venue is its own group, so update(camera) can hide the
    // side the chase camera has pulled back behind (big robots / F2) — the
    // architecture never blocks the fight; the other three sides stay up.
    const SIDES = [['z', 1, '+z'], ['z', -1, '-z'], ['x', 1, '+x'], ['x', -1, '-x']]
    this._sides = {}
    for (const [, , key] of SIDES) { const sg = new THREE.Group(); sg.name = 'venue' + key; this._sides[key] = sg; g.add(sg) }
    const trussY = 15.5, depth = 1.4, R = T
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), mid = new THREE.Vector3(), sc = new THREE.Vector3()
    const memGeo = geo(new THREE.BoxGeometry(1, 1, 1))
    const lampGeo = geo(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 10))
    const lampMat = basic({ color: 0xfff3d6, toneMapped: false })
    const tiers = 7, tierD = 2.4, tierH = 1.25, standIn = half + 6.5
    const tierGeo = geo(new THREE.BoxGeometry(1, 1, 1))
    const tierMat = std({ color: 0x353c46, roughness: 0.85, metalness: 0.2 })
    const riserGeo = geo(new THREE.BoxGeometry(1, 0.06, 0.06))
    const riserMat = basic({ color: 0x2bc6e0, toneMapped: false, transparent: true, opacity: 0.55 })
    const bodyGeo = geo(new THREE.CapsuleGeometry(0.26, 0.55, 2, 6))
    const crowdMat = std({ roughness: 0.9, metalness: 0 })
    const palette = [0x3f4856, 0x556070, 0x6b7584, 0x2f3641, 0x7a8494, 0xb45309, 0x0e7490, 0x8a3b2e, 0x4b5563]
    const col = new THREE.Color()
    const rand = rng(7)
    const span = standIn * 2 - 4
    const instanced = []
    this._overhead = []          // truss + lamp pods (hidden in steep top-down views)
    for (const [axis, sgn, key] of SIDES) {
      const sg = this._sides[key]
      const at = (u, y, off) => axis === 'z' ? [u, y, sgn * off] : [sgn * off, y, u]
      // truss: two chords + verticals + diagonals along this side
      const members = []
      const addMember = (a, b, t = 0.14) => members.push({ a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), t })
      addMember(at(-R, trussY, R), at(R, trussY, R), 0.22)
      addMember(at(-R, trussY + depth, R), at(R, trussY + depth, R), 0.22)
      const segs = 14
      for (let i = 0; i <= segs; i++) {
        const u = -R + (2 * R * i) / segs
        addMember(at(u, trussY, R), at(u, trussY + depth, R))
        if (i < segs) { const u2 = -R + (2 * R * (i + 1)) / segs; addMember(at(u, trussY, R), at(u2, trussY + depth, R)) }
      }
      const truss = new THREE.InstancedMesh(memGeo, postMat, members.length)
      members.forEach((m, i) => {
        dir.subVectors(m.b, m.a); const len = dir.length(); dir.normalize()
        Q.setFromUnitVectors(up, dir); mid.addVectors(m.a, m.b).multiplyScalar(0.5); sc.set(m.t, len, m.t)
        truss.setMatrixAt(i, M.compose(mid, Q, sc))
      })
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 6)
      for (let i = 1; i < 7; i++) lamps.setMatrixAt(i - 1, M.makeTranslation(...at(-R + (2 * R * i) / 7, trussY - 0.3, R)))
      // stands (7 tiers) + riser light strips + spectators
      const tierMats = [], crowdPos = []
      for (let k = 0; k < tiers; k++) {
        const out = standIn + k * tierD + tierD / 2, h = (k + 1) * tierH, len = span + k * tierD * 2
        tierMats.push({ out, h, len })
        for (let u = -len / 2 + 0.7; u < len / 2 - 0.7; u += 1.05 + rand() * 0.5) {
          if (rand() < 0.22) continue
          crowdPos.push([u, h, out + (rand() - 0.5) * 0.6])
        }
      }
      const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, axis === 'z' ? 0 : Math.PI / 2, 0))
      const stands = new THREE.InstancedMesh(tierGeo, tierMat, tiers)
      const risers = new THREE.InstancedMesh(riserGeo, riserMat, tiers)
      tierMats.forEach((t, i) => {
        stands.setMatrixAt(i, M.compose(P.set(...at(0, t.h / 2, t.out)), yawQ, sc.set(t.len, t.h, tierD)))
        risers.setMatrixAt(i, M.compose(P.set(...at(0, t.h + 0.03, t.out - tierD / 2)), yawQ, sc.set(t.len, 1, 1)))
      })
      const crowd = new THREE.InstancedMesh(bodyGeo, crowdMat, crowdPos.length)
      crowdPos.forEach(([u, h, o], i) => {
        crowd.setMatrixAt(i, M.compose(P.set(...at(u, h + 0.55, o)), Q.identity(), sc.setScalar(0.9 + rand() * 0.25)))
        crowd.setColorAt(i, col.setHex(palette[Math.floor(rand() * palette.length)]))
      })
      sg.add(truss, lamps, stands, risers, crowd)
      this._overhead.push(truss, lamps)
      instanced.push(truss, lamps, stands, risers, crowd)
    }

    // ── HALL (the world beyond the venue: lit interior instead of a white void) ──
    const hallTex = tex(this._paintHall(), { wrapS: THREE.RepeatWrapping })
    hallTex.repeat.set(6, 2)
    // Tall enough that no camera mode (F2 / F4 pull far back + up for big robots) leaves it.
    const hall = new THREE.Mesh(geo(new THREE.CylinderGeometry(120, 120, 135, 48, 1, true)), std({ map: hallTex, side: THREE.BackSide, roughness: 0.9, metalness: 0.1 }))
    hall.position.y = 62
    g.add(hall)
    const roof = new THREE.Mesh(geo(new THREE.CircleGeometry(120, 48)), std({ color: 0x151b24, side: THREE.DoubleSide, roughness: 1 }))
    roof.rotation.x = Math.PI / 2; roof.position.y = 129
    g.add(roof)
    const hallFloor = new THREE.Mesh(geo(new THREE.CircleGeometry(120, 48)), std({ color: 0x222831, roughness: 0.95 }))
    hallFloor.rotation.x = -Math.PI / 2; hallFloor.position.y = -0.35
    g.add(hallFloor)

    // ── SIGNAGE: championship banners + two live scoreboards ──
    const bannerTex = tex(this._paintBanner())
    const bannerMat = basic({ map: bannerTex, toneMapped: false, side: THREE.DoubleSide })
    const bannerGeo = geo(new THREE.PlaneGeometry(26, 3.2))
    for (const [x, z, ry, key] of [[half + 16, 0, -Math.PI / 2, '+x'], [-half - 16, 0, Math.PI / 2, '-x']]) {
      const b = new THREE.Mesh(bannerGeo, bannerMat); b.position.set(x, 13.5, z); b.rotation.y = ry; this._sides[key].add(b)
    }
    const [bc, bctx] = canvas(1024, 512)
    this._board = { cv: bc, ctx: bctx, tex: tex(bc), player: 'YOU', enemy: 'ENEMY', t: -1 }
    this._drawBoard(0)
    const boardMat = basic({ map: this._board.tex, toneMapped: false })
    const frameMat = std({ color: 0x2a3038, roughness: 0.5, metalness: 0.6 })
    for (const [z, ry, key] of [[half + 15, Math.PI, '+z'], [-half - 15, 0, '-z']]) {
      const frame = new THREE.Mesh(geo(new THREE.BoxGeometry(17, 9, 0.6)), frameMat); frame.position.set(0, 16, z); frame.rotation.y = ry; this._sides[key].add(frame)
      const screen = new THREE.Mesh(geo(new THREE.PlaneGeometry(16, 8)), boardMat)
      screen.position.set(0, 16, z + (ry === 0 ? 0.31 : -0.31)); screen.rotation.y = ry; this._sides[key].add(screen)
    }

    for (const o of [posts, frames, towers, heads, lenses, ...instanced]) { o.computeBoundingSphere(); o.frustumCulled = false }
    scene.add(g)
    return this
  }

  // Per frame (cheap: four bounds checks). Hide the venue side the camera is
  // behind — the chase camera of a big robot or the F2 view pulls back past
  // the walls, where that side's truss / stands / signage would fill the frame.
  update(camera) {
    if (!this._sides || !camera) return
    const p = camera.position, h = this._half - 0.5
    // Looking nearly straight down (F4 / a big robot's high camera), the perimeter
    // truss projects over the floor's edge as dark wedges — drop it there.
    camera.getWorldDirection(this._dir || (this._dir = new THREE.Vector3()))
    const overhead = this._dir.y > -0.82
    for (const o of this._overhead || []) o.visible = overhead
    this._sides['+z'].visible = !(p.z > h)
    this._sides['-z'].visible = !(p.z < -h)
    this._sides['+x'].visible = !(p.x > h)
    this._sides['-x'].visible = !(p.x < -h)
  }

  // Scoreboards: names + match clock (redrawn at most once a second).
  setMatch(player, enemy) { if (!this._board) return; this._board.player = player || 'YOU'; this._board.enemy = enemy || 'ENEMY'; this._board.t = -1; this._drawBoard(0) }
  setClock(seconds) { if (this._board && seconds !== this._board.t) this._drawBoard(seconds) }

  _drawBoard(seconds) {
    const b = this._board, ctx = b.ctx, W = 1024, H = 512
    b.t = seconds
    const grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#0b1220'); grd.addColorStop(1, '#111a2b')
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = C.amberHex; ctx.lineWidth = 8; ctx.strokeRect(10, 10, W - 20, H - 20)
    ctx.fillStyle = C.amberHex; ctx.font = 'bold 54px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('CONSTRUCTA ARENA', W / 2, 92)
    ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif'; ctx.fillText('BATTLEBOT CHAMPIONSHIP', W / 2, 138)
    const name = (s) => String(s).replace(/_\d+$/, '').replace(/_/g, ' ').slice(0, 16).toUpperCase()
    ctx.font = 'bold 52px "Segoe UI", Arial, sans-serif'
    ctx.fillStyle = '#4ade80'; ctx.textAlign = 'left'; ctx.fillText(name(b.player), 60, 290)
    ctx.fillStyle = '#f87171'; ctx.textAlign = 'right'; ctx.fillText(name(b.enemy), W - 60, 290)
    ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'center'; ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif'; ctx.fillText('VS', W / 2, 290)
    ctx.fillStyle = C.cyanHex; ctx.font = 'bold 120px "Consolas", "Courier New", monospace'
    ctx.fillText(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, W / 2, 450)
    b.tex.needsUpdate = true
  }

  // ── Procedural textures (small, generated once per match) ───────────────────
  _paintFloor(half) {
    const S = 2048, [cv, ctx] = canvas(S, S), k = S / (half * 2)   // px per su
    const r = rng(11)
    ctx.fillStyle = C.floor; ctx.fillRect(0, 0, S, S)
    // steel plates with slight tone variation + brushed grain
    const plate = Math.round(6.5 * k)
    for (let y = 0; y < S; y += plate) for (let x = 0; x < S; x += plate) {
      const v = Math.round((r() - 0.5) * 16)
      ctx.fillStyle = `rgb(${91 + v},${98 + v},${107 + v})`; ctx.fillRect(x, y, plate, plate)
      ctx.globalAlpha = 0.07
      for (let i = 0; i < 26; i++) { ctx.fillStyle = r() < 0.5 ? '#ffffff' : '#000000'; ctx.fillRect(x, y + r() * plate, plate, 1 + r() * 2) }
      ctx.globalAlpha = 1
      ctx.fillStyle = '#3a3f46'
      for (const [bx, by] of [[10, 10], [plate - 10, 10], [10, plate - 10], [plate - 10, plate - 10]]) { ctx.beginPath(); ctx.arc(x + bx, y + by, 4, 0, 7); ctx.fill() }
    }
    ctx.strokeStyle = C.seam; ctx.lineWidth = 4
    for (let p = 0; p <= S; p += plate) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke() }
    // access hatches + wear
    for (let i = 0; i < 10; i++) {
      const x = r() * (S - 140) + 20, y = r() * (S - 140) + 20, w = 60 + r() * 60
      ctx.fillStyle = '#4c535b'; ctx.fillRect(x, y, w, w * 0.6); ctx.strokeStyle = '#30353b'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, w * 0.6)
    }
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S, rad = 30 + r() * 110
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(25,28,32,0.22)'); gr.addColorStop(1, 'rgba(25,28,32,0)')
      ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    const c = S / 2
    // perimeter hazard band (amber / black diagonal) + inner white line
    const band = Math.round(1.6 * k)
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.rect(band, band, S - 2 * band, S - 2 * band); ctx.clip('evenodd')
    ctx.fillStyle = '#1d2024'; ctx.fillRect(0, 0, S, S)
    ctx.fillStyle = C.amberHex
    for (let d = -S; d < S * 2; d += 56) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + 28, 0); ctx.lineTo(d + 28 - S, S); ctx.lineTo(d - S, S); ctx.closePath(); ctx.fill() }
    ctx.restore()
    ctx.strokeStyle = 'rgba(235,240,245,0.85)'; ctx.lineWidth = 6
    const inset = band + Math.round(0.9 * k); ctx.strokeRect(inset, inset, S - 2 * inset, S - 2 * inset)
    // centre: hexagon + ring + crossed lines + brand text
    const hex = (rad) => { ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? 'lineTo' : 'moveTo'](c + rad * Math.cos(a), c + rad * Math.sin(a)) } }
    hex(9.5 * k); ctx.fillStyle = 'rgba(42,47,54,0.55)'; ctx.fill()
    ctx.strokeStyle = C.amberHex; ctx.lineWidth = 14; hex(9.5 * k); ctx.stroke()
    ctx.strokeStyle = 'rgba(245,158,11,0.45)'; ctx.lineWidth = 5; hex(10.4 * k); ctx.stroke()
    ctx.strokeStyle = C.cyanHex; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(c, c, 4.2 * k, 0, 7); ctx.stroke()
    ctx.strokeStyle = 'rgba(226,232,240,0.5)'; ctx.lineWidth = 4
    ctx.beginPath(); ctx.moveTo(c - 4.2 * k, c); ctx.lineTo(c + 4.2 * k, c); ctx.moveTo(c, c - 4.2 * k); ctx.lineTo(c, c + 4.2 * k); ctx.stroke()
    ctx.fillStyle = 'rgba(226,232,240,0.22)'; ctx.font = `bold ${Math.round(1.6 * k)}px "Segoe UI", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('CONSTRUCTA', c, c + 6.6 * k)
    // start boxes at the spawn lanes (±12 su on X)
    for (const sx of [-1, 1]) {
      const bx = c + sx * 12 * k, w = 5 * k
      ctx.strokeStyle = sx < 0 ? '#4ade80' : '#f87171'; ctx.lineWidth = 8
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x0 = bx + dx * w / 2, y0 = c + dy * w / 2
        ctx.beginPath(); ctx.moveTo(x0, y0 - dy * w * 0.25); ctx.lineTo(x0, y0); ctx.lineTo(x0 - dx * w * 0.25, y0); ctx.stroke()
      }
    }
    // corner identifiers
    ctx.font = `bold ${Math.round(3 * k)}px "Segoe UI", Arial, sans-serif`; ctx.fillStyle = 'rgba(245,158,11,0.55)'
    const ci = band + 3.2 * k
    ;[['1', ci, ci], ['2', S - ci, ci], ['3', S - ci, S - ci], ['4', ci, S - ci]].forEach(([t, x, y]) => ctx.fillText(t, x, y))
    return cv
  }

  _paintRoughness() {
    const [cv, ctx] = canvas(256, 256), r = rng(23)
    ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2500; i++) { const v = 150 + Math.floor(r() * 90); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(r() * 256, r() * 256, 2 + r() * 6, 1) }
    return cv
  }

  _paintWall() {
    const [cv, ctx] = canvas(512, 256)
    const grd = ctx.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, '#7a828c'); grd.addColorStop(1, '#5a616a')
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 256)
    ctx.strokeStyle = '#3a4047'; ctx.lineWidth = 4; ctx.strokeRect(6, 40, 500, 150)
    ctx.fillStyle = '#4b525a'; ctx.fillRect(30, 70, 200, 90); ctx.fillRect(282, 70, 200, 90)
    ctx.fillStyle = '#2e3338'; for (const x of [16, 496]) for (const y of [52, 178]) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill() }
    // hazard foot band
    ctx.fillStyle = '#1b1e22'; ctx.fillRect(0, 205, 512, 51)
    ctx.fillStyle = C.amberHex; for (let d = -60; d < 560; d += 44) { ctx.beginPath(); ctx.moveTo(d, 256); ctx.lineTo(d + 22, 256); ctx.lineTo(d + 47, 205); ctx.lineTo(d + 25, 205); ctx.closePath(); ctx.fill() }
    // status lights
    ctx.fillStyle = C.cyanHex; for (const x of [120, 392]) ctx.fillRect(x, 18, 40, 8)
    ctx.fillStyle = '#2b3036'; ctx.fillRect(0, 0, 512, 6)
    return cv
  }

  _paintTower() {
    const [cv, ctx] = canvas(128, 1024)
    ctx.fillStyle = '#4d545d'; ctx.fillRect(0, 0, 128, 1024)
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 6
    for (let y = 0; y < 1024; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y + 128); ctx.moveTo(128, y); ctx.lineTo(0, y + 128); ctx.stroke(); ctx.strokeRect(4, y, 120, 128) }
    for (const y of [880, 940]) { ctx.fillStyle = C.amberHex; ctx.fillRect(0, y, 128, 26); ctx.fillStyle = '#1b1e22'; for (let x = 0; x < 128; x += 32) ctx.fillRect(x, y, 16, 26) }
    ctx.fillStyle = C.cyanHex; ctx.fillRect(56, 60, 16, 120)
    return cv
  }

  _paintHall() {
    const [cv, ctx] = canvas(512, 512)
    const grd = ctx.createLinearGradient(0, 0, 0, 512); grd.addColorStop(0, '#141a23'); grd.addColorStop(0.55, '#26303d'); grd.addColorStop(1, '#1b222c')
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 512)
    ctx.strokeStyle = 'rgba(120,135,155,0.25)'; ctx.lineWidth = 6
    for (let x = 0; x <= 512; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke() }
    ctx.lineWidth = 3; for (let x = 0; x < 512; x += 64) { ctx.beginPath(); ctx.moveTo(x, 120); ctx.lineTo(x + 64, 40); ctx.stroke() }
    // upper window band + gallery lights
    ctx.fillStyle = 'rgba(120,180,220,0.28)'; for (let x = 8; x < 512; x += 64) ctx.fillRect(x, 150, 48, 34)
    ctx.fillStyle = 'rgba(255,214,150,0.55)'; for (let x = 24; x < 512; x += 64) ctx.fillRect(x, 300, 16, 6)
    ctx.fillStyle = 'rgba(34,211,238,0.35)'; ctx.fillRect(0, 336, 512, 4)
    return cv
  }

  _paintBanner() {
    const [cv, ctx] = canvas(1024, 128)
    ctx.fillStyle = '#10161f'; ctx.fillRect(0, 0, 1024, 128)
    ctx.fillStyle = C.amberHex; ctx.fillRect(0, 0, 1024, 8); ctx.fillRect(0, 120, 1024, 8)
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 64px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('CONSTRUCTA  ·  BATTLEBOT ARENA', 512, 68)
    ctx.fillStyle = C.cyanHex; ctx.fillRect(40, 56, 24, 24); ctx.fillRect(960, 56, 24, 24)
    return cv
  }

  // Remove everything and restore the editor scene exactly.
  dispose() {
    if (this.group) { this.group.removeFromParent(); this.group = null }
    for (const d of this._disposables) d.dispose?.()
    this._disposables = []
    this.aimTargets = []
    this._board = null
    this._sides = null
    this._overhead = null
    const s = this._saved
    if (s) {
      s.scene.background = s.background; s.scene.fog = s.fog
      if (s.grid) s.grid.visible = s.gridVis
      if (s.axes) s.axes.visible = s.axesVis
      if (s.renderer && s.exposure != null) s.renderer.toneMappingExposure = s.exposure
      if (s.camera && s.near != null && s.camera.near !== s.near) { s.camera.near = s.near; s.camera.updateProjectionMatrix() }
      this._saved = null
    }
  }
}

export const arenaEnvironment = new ArenaEnvironment()
