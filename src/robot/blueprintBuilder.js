import { useRigidStore } from '../stores/rigidStore.js'
import { useJointStore } from '../stores/jointStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'

// ── Blueprint builder (Stage 6) ──────────────────────────────────────────────
// Derives the structural parts of a blueprint — the link tree and the joint
// list — from the existing scene relationships (surface bonds, motor
// attachments, mechanical joints). This is the bridge from the loose scene graph
// to the explicit blueprint hierarchy; it inspects RELATIONSHIPS, not geometry.

/**
 * Build the link tree for an assembly: each member becomes a link whose
 * parentLinkId comes from a surface bond or a motor attachment (child → parent).
 * The root has parentLinkId = null; members with no explicit parent attach to root.
 */
export function buildLinks(rootId, memberIds) {
  const memberset = new Set(memberIds)
  const parentOf = {}

  // Surface bonds: child is rigidly fixed to parent.
  for (const b of Object.values(useRigidStore.getState().bonds)) {
    if (memberset.has(b.childId) && memberset.has(b.parentId)) parentOf[b.childId] = b.parentId
  }
  // Motor attachments: an attached part's parent link is its motor (bond wins if both exist).
  const attachments = useElectronicsStore.getState().attachments ?? {}
  for (const [childId, motorId] of Object.entries(attachments)) {
    if (memberset.has(childId) && memberset.has(motorId) && !parentOf[childId]) parentOf[childId] = motorId
  }

  return memberIds.map(id => ({
    id,
    parentLinkId: id === rootId ? null : (parentOf[id] ?? rootId),
  }))
}

/** Joint ids whose parent AND child are both members of this robot. */
export function buildJoints(memberIds) {
  const memberset = new Set(memberIds)
  return Object.values(useJointStore.getState().joints)
    .filter(j => memberset.has(j.parentId) && memberset.has(j.childId))
    .map(j => j.id)
}
