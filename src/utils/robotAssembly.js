import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'

// Group scene objects into "robots": connected components linked by surface
// bonds (rigidStore) and motor/wheel attachments (electronicsStore). Each group
// is driven by its root (a bond parent that isn't anyone's child), so moving the
// root cascades to the whole assembly via propagateAllBonds.

export function buildAssemblies() {
  const objects = useSceneStore.getState().objects
  const bonds = Object.values(useRigidStore.getState().bonds || {})
  const attachments = useElectronicsStore.getState().attachments || {}

  // union-find over object ids
  const parent = {}
  for (const o of objects) parent[o.id] = o.id
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { if (parent[a] === undefined || parent[b] === undefined) return; parent[find(a)] = find(b) }

  for (const b of bonds) if (b.parentId && b.childId) union(b.parentId, b.childId)
  for (const [objId, motorId] of Object.entries(attachments)) union(objId, motorId)

  const groups = {}
  for (const o of objects) { const r = find(o.id); (groups[r] ||= []).push(o.id) }

  const childIds    = new Set(bonds.map(b => b.childId))
  const attachedIds = new Set(Object.keys(attachments))
  const bondParents = new Set(bonds.map(b => b.parentId))
  const byId = Object.fromEntries(objects.map(o => [o.id, o]))

  const result = []
  for (const members of Object.values(groups)) {
    // Root must be drivable: not a bond child, not riding a motor; prefer a bond parent.
    let roots = members.filter(id => !childIds.has(id) && !attachedIds.has(id))
    if (roots.length === 0) roots = members.slice()
    roots.sort((a, b) => (bondParents.has(b) ? 1 : 0) - (bondParents.has(a) ? 1 : 0))
    const rootId = roots[0]
    result.push({ rootId, name: byId[rootId]?.name ?? 'Robot', memberIds: members })
  }
  return result
}

// All member ids of the assembly that contains `rootId` (for whole-robot bounds).
export function assemblyMembers(rootId) {
  const a = buildAssemblies().find(g => g.rootId === rootId || g.memberIds.includes(rootId))
  return a ? a.memberIds : [rootId]
}

// Dropdown options: one entry per robot assembly, labelled with the part count.
export function robotOptions() {
  return buildAssemblies().map(a => ({
    id: a.rootId,
    name: a.memberIds.length > 1 ? `${a.name}  ·  robot (${a.memberIds.length} parts)` : a.name,
  }))
}
