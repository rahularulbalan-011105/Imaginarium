import { useSceneStore } from '../stores/sceneStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { assemblyMembers } from '../utils/robotAssembly.js'
import { computeRobotStats } from './CombatStats.js'
import { weaponForType, isWeaponType } from './weaponRegistry.js'
import { resolveFront } from './robotFront.js'

// ─────────────────────────────────────────────────────────────────────────────
// Arena readiness — what the Battle panel shows before a match and what gates
// the Start button. Pure read of the real design (sceneStore + bonds +
// attachments + weapon registry); nothing here mutates anything.
//
//   level: 'ready'   — fight
//          'warn'    — fight, but something is worth knowing (melee only, …)
//          'invalid' — the robot can't be built into a combat body as it is
//
// Precision-first: only a problem that would break _captureRobot or the damage
// pipeline is 'invalid'. Cosmetic / recoverable things are warnings.
// ─────────────────────────────────────────────────────────────────────────────

const finite = (v) => v && [v.x, v.y, v.z].every(Number.isFinite)

export function assessRobot(rootId) {
  const out = { id: rootId, level: 'ready', issues: [], parts: 0, weapons: [], primary: null, secondary: null, stats: null, name: 'Robot' }
  const warn = (msg) => out.issues.push({ level: 'warn', msg })
  const bad  = (msg) => out.issues.push({ level: 'invalid', msg })
  if (!rootId) { bad('No robot selected'); out.level = 'invalid'; return out }

  const scene = useSceneStore.getState()
  const byId = new Map(scene.objects.map(o => [o.id, o]))
  const root = byId.get(rootId)
  if (!root) { bad('The selected robot is no longer in the scene'); out.level = 'invalid'; return out }
  out.name = root.name || 'Robot'
  { const r = resolveFront(rootId); out.front = r.front; out.frontAuto = r.auto }

  const members = assemblyMembers(rootId)
  out.parts = members.length
  const attachments = useElectronicsStore.getState().attachments || {}
  let missingMesh = 0
  for (const id of members) {
    const o = byId.get(id)
    if (!o) { bad('A bonded part is missing from the scene'); continue }
    if (!finite(o.position) || !finite(o.rotation) || !finite(o.scale)) bad(`${o.name}: invalid transform`)
    if (!objectManager.getMesh(id)) missingMesh++
    if (isWeaponType(o.type)) {
      const def = weaponForType(o.type)
      if (def) out.weapons.push({ id, type: o.type, name: def.name, range: def.range })
      else warn(`${o.name}: unknown weapon type ${o.type}`)
    }
  }
  if (missingMesh) warn(`${missingMesh} part${missingMesh > 1 ? 's' : ''} still loading`)
  // Duplicate ids would make bonds/damage ambiguous (a corrupt import).
  const seen = new Set(), dup = new Set()
  for (const o of scene.objects) { if (seen.has(o.id)) dup.add(o.id); seen.add(o.id) }
  if (members.some(id => dup.has(id))) bad('Duplicate component ids in this robot — re-import the file')

  // Bonds on this robot must point at real objects (a dangling bond is skipped
  // by the frame loop, so only warn).
  const memberSet = new Set(members)
  const bonds = useRigidStore.getState().getBonds()
  let dangling = 0
  for (const b of bonds) {
    if (!memberSet.has(b.parentId) && !memberSet.has(b.childId)) continue
    if (!byId.get(b.parentId) || !byId.get(b.childId)) dangling++
    else if (!Array.isArray(b.relativeMatrix) || b.relativeMatrix.length !== 16 || !b.relativeMatrix.every(Number.isFinite)) { bad('A bond has an invalid transform'); }
  }
  if (dangling) warn(`${dangling} attachment${dangling > 1 ? 's' : ''} reference a missing part (ignored)`)
  // Wheels riding a motor are fine; a wheel attached to a motor that isn't here is not.
  for (const id of members) if (attachments[id] && !byId.get(attachments[id])) warn(`${byId.get(id)?.name}: its motor is missing`)

  // Same weapon selection rule as CombatManager._captureRobot (longest range = LMB).
  const sorted = [...out.weapons].sort((a, b) => (b.range || 0) - (a.range || 0))
  out.primary = sorted[0] || null
  out.secondary = sorted.length > 1 ? sorted[sorted.length - 1] : { name: 'Melee Strike', builtin: true }
  if (!out.primary) warn('No weapon mounted — melee (RMB) only. Drag a ⚔ weapon from Electronics onto the robot.')
  if (out.parts === 1) warn('Single part — a chassis with mounted parts fights better (more mass, more armor)')

  try { out.stats = computeRobotStats(rootId) } catch { bad('Could not compute mass / stats for this robot') }

  out.level = out.issues.some(i => i.level === 'invalid') ? 'invalid' : out.issues.length ? 'warn' : 'ready'
  return out
}

// Both sides of a match.
export function assessMatch(playerId, opponentId) {
  const issues = []
  const player = assessRobot(playerId)
  const builtIn = opponentId === 'stock' || opponentId === 'file'   // spawned for the match (stock bot / opponent file)
  const opponent = builtIn ? null : assessRobot(opponentId)
  if (!playerId) issues.push({ level: 'invalid', msg: 'Pick your robot' })
  if (!opponentId) issues.push({ level: 'invalid', msg: 'Pick an opponent' })
  if (playerId && opponentId && !builtIn) {
    if (playerId === opponentId) issues.push({ level: 'invalid', msg: 'Pick two different robots' })
    else if (assemblyMembers(playerId).includes(opponentId) || assemblyMembers(opponentId).includes(playerId)) issues.push({ level: 'invalid', msg: 'Both picks are parts of the same robot' })
  }
  const levels = [player.level, opponent?.level ?? 'ready', ...issues.map(i => i.level)]
  const level = levels.includes('invalid') ? 'invalid' : levels.includes('warn') ? 'warn' : 'ready'
  return { level, issues, player, opponent }
}
