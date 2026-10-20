import * as THREE from 'three'
import { useSceneStore } from '../stores/sceneStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { loadWeaponModel } from '../utils/modelLoader.js'
import { mountSpecFor } from '../managers/SurfaceMountManager.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { buildAssemblies } from '../utils/robotAssembly.js'
import { v4 as uuidv4 } from 'uuid'

// ─────────────────────────────────────────────────────────────────────────────
// Stock opponent — a ready-made AI robot for players whose project holds only
// their own robot (the usual case after "Import JSON"). It is built from the
// SAME scene objects + bonds every other robot is made of, so CombatManager,
// damage, weapons and the AI treat it exactly like a user design.
//
// Its parts are flagged `transient: 'arena'`: buildProjectSnapshot leaves them
// out of save / autosave / export / share, and removeStockOpponent() deletes
// them when the match ends. The user's design is never touched.
// ─────────────────────────────────────────────────────────────────────────────

const STOCK = {
  brawler: {
    name: 'Scrapper', weapon: 'weapon_autocannon', color: '#7f1d1d',
    chassis: { x: 1.8, y: 0.7, z: 2.3 },
    plates: [
      { off: [0, 0.85, -0.9], scale: [1.4, 0.16, 0.9], color: '#991b1b' },     // rear deck
      { off: [1.95, 0.0, 0], scale: [0.14, 0.55, 1.9], color: '#450a0a' },     // side armour
      { off: [-1.95, 0.0, 0], scale: [0.14, 0.55, 1.9], color: '#450a0a' },
    ],
  },
}

const frames = (n) => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) })
async function meshReady(id, maxFrames = 240) {
  for (let i = 0; i < maxFrames; i++) {
    const m = objectManager.getMesh(id)
    if (m && m.children.length + (m.geometry ? 1 : 0) > 0) return m
    await frames(1)
  }
  return objectManager.getMesh(id) || null
}

function bond(parentId, childId) {
  const pm = objectManager.getMesh(parentId), cm = objectManager.getMesh(childId)
  if (!pm || !cm) return
  pm.updateMatrixWorld(true); cm.updateMatrixWorld(true)
  useRigidStore.getState().addBond(parentId, childId, pm.matrixWorld.clone().invert().multiply(cm.matrixWorld).toArray(), null, null, { attach: 'surface', transient: 'arena' })
}

// Build the stock robot well away from the user's design (the arena re-places
// every combatant at its spawn anyway). Resolves to the chassis (root) id.
export async function spawnStockOpponent(kind = 'brawler', at = { x: 60, z: 60 }) {
  const spec = STOCK[kind] || STOCK.brawler
  const scene = useSceneStore.getState()
  await loadWeaponModel(spec.weapon)

  const ch = scene.addObject('box', { x: at.x, y: spec.chassis.y, z: at.z })
  scene.updateObject(ch.id, { name: spec.name, color: spec.color, transient: 'arena', scale: { ...spec.chassis } })
  await meshReady(ch.id)
  const ids = [ch.id]

  for (const p of spec.plates) {
    const pl = scene.addObject('box', { x: at.x + p.off[0], y: spec.chassis.y + p.off[1], z: at.z + p.off[2] })
    scene.updateObject(pl.id, { name: `${spec.name} plate`, color: p.color, transient: 'arena', scale: { x: p.scale[0], y: p.scale[1], z: p.scale[2] } })
    await meshReady(pl.id)
    bond(ch.id, pl.id)
    ids.push(pl.id)
  }

  // Weapon on top, nose along +Z like the chassis (the arena fires along facing).
  const w = scene.addObject(spec.weapon, { x: at.x, y: spec.chassis.y * 2 + 0.3, z: at.z + 0.2 })
  // Barrel down the nose (+Z): yaw the model so its own forward axis maps to +Z.
  const f = mountSpecFor(spec.weapon)?.forward
  const gunYaw = f ? -Math.atan2(f.x, f.z) : 0
  scene.updateObject(w.id, { name: `${spec.name} gun`, transient: 'arena', rotation: { x: 0, y: gunYaw, z: 0 } })
  const wm = await meshReady(w.id)
  if (wm) {
    // Rest it on the chassis top.
    wm.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(wm, true)
    const drop = b.min.y - spec.chassis.y * 2
    scene.updateObject(w.id, { position: { x: at.x, y: wm.position.y - drop + 0.01, z: at.z + 0.2 } })
    wm.position.y = wm.position.y - drop + 0.01
    wm.updateMatrixWorld(true)
    bond(ch.id, w.id)
  }
  ids.push(w.id)
  await frames(2)
  return { rootId: ch.id, ids }
}

// ── An opponent loaded from a robot / project JSON file ────────────────────
// The SAME files File → Import JSON reads (Robot Builder exports). Instead of
// replacing the user's project, the file's parts are added for this match only:
// fresh ids, flagged `transient: 'arena'` (never saved / exported, removed by
// removeStockOpponent on stop), moved away from the user's design (the arena
// re-places every combatant anyway). Bonds keep their parent-local matrices +
// contact frames; motor-riding parts (wheels) keep their rotor attachment and
// exact local `attach` transform. The file is read, never modified.
// Resolves to { rootId, ids, name } — rootId = the file's largest robot.
export async function spawnOpponentFromProject(data, at = { x: -60, z: 60 }) {
  const src = (Array.isArray(data?.objects) ? data.objects : []).filter(o => o && o.id && o.position && !o.transient)
  if (!src.length) throw new Error('the file has no parts')
  const idMap = new Map(src.map(o => [o.id, uuidv4()]))
  let cx = 0, cz = 0
  for (const o of src) { cx += o.position.x; cz += o.position.z }
  cx /= src.length; cz /= src.length
  const dx = at.x - cx, dz = at.z - cz
  const copies = src.map(o => {
    const c = { ...o, id: idMap.get(o.id), transient: 'arena', position: { x: o.position.x + dx, y: o.position.y, z: o.position.z + dz } }
    if (c.attach?.motorId) c.attach = { ...c.attach, motorId: idMap.get(c.attach.motorId) }
    return c
  })
  // Weapon models first, so every weapon part shows its real barrel at once.
  await Promise.all([...new Set(copies.map(c => c.type).filter(t => typeof t === 'string' && t.startsWith('weapon_')))].map(t => loadWeaponModel(t).catch(() => null)))
  useSceneStore.setState(s => ({ objects: [...s.objects, ...copies] }))   // one update, selection untouched
  const rigid = useRigidStore.getState()
  for (const b of Object.values(data?.rigid?.bonds || {})) {
    const p = idMap.get(b.parentId), ch = idMap.get(b.childId)
    if (!p || !ch || !Array.isArray(b.relativeMatrix)) continue
    rigid.addBond(p, ch, b.relativeMatrix, b.contactLocalNormal ?? null, b.contactLocalCenter ?? null, { attach: b.attach, transient: 'arena' })
  }
  const el = useElectronicsStore.getState()
  const riders = []
  for (const [obj, motor] of Object.entries(data?.electronics?.attachments || {})) {
    const o = idMap.get(obj), m = idMap.get(motor)
    if (o && m) { el.attachToMotor(o, m); riders.push(o) }
  }
  const ids = copies.map(c => c.id)
  for (const id of ids) await meshReady(id)
  // The editor re-seats rotor riders from their saved `attach` (Viewport effect).
  for (let i = 0; i < 240 && riders.some(id => !objectManager.attachedObjects.has(id)); i++) await frames(1)
  await frames(2)
  const asm = buildAssemblies().filter(a => ids.includes(a.rootId)).sort((a, b) => b.memberIds.length - a.memberIds.length)[0]
  const rootId = asm?.rootId ?? ids[0]
  return { rootId, ids, name: useSceneStore.getState().objects.find(o => o.id === rootId)?.name || data?.name || 'Opponent' }
}

export function removeStockOpponent(ids) {
  if (!ids?.length) return
  const scene = useSceneStore.getState(), rigid = useRigidStore.getState(), el = useElectronicsStore.getState()
  for (const id of ids) if (el.attachments?.[id]) el.detachFromMotor(id)
  for (const id of ids) { rigid.removeBondsForObject(id); scene.removeObject(id) }
}

export function isTransient(o) { return !!o?.transient }
