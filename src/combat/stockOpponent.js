import * as THREE from 'three'
import { useSceneStore } from '../stores/sceneStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { loadWeaponModel } from '../utils/modelLoader.js'

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
  scene.updateObject(w.id, { name: `${spec.name} gun`, transient: 'arena' })
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

export function removeStockOpponent(ids) {
  if (!ids?.length) return
  const scene = useSceneStore.getState(), rigid = useRigidStore.getState()
  for (const id of ids) { rigid.removeBondsForObject(id); scene.removeObject(id) }
}

export function isTransient(o) { return !!o?.transient }
