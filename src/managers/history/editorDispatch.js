import { history } from './HistoryManager.js'
import { SnapshotCommand } from './Command.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { useElectronicsStore } from '../../stores/electronicsStore.js'
import { useRigidStore } from '../../stores/rigidStore.js'
import { useSurfaceStore } from '../../stores/surfaceStore.js'
import { useJointStore } from '../../stores/jointStore.js'
<<<<<<< HEAD
=======
import { useRobotStore } from '../../stores/robotStore.js'
>>>>>>> master

// The single sanctioned entry point for recording undoable changes. Every
// operation funnels through here — either as a fine-grained Command (execute) or,
// during migration, via the legacy snapshot bridge (recordSnapshot).

const clone = (v) => JSON.parse(JSON.stringify(v))

// ── Canonical document state ──────────────────────────────────────────────────
// The same five slices the original undo system captured. Kept identical so the
// snapshot bridge reproduces the previous behaviour exactly (minus the bugs).
// Fine-grained commands added later manage their own (incl. non-canonical) state.
export function captureCanonical() {
  return clone({
    objects:     useSceneStore.getState().objects,
    attachments: useElectronicsStore.getState().attachments,
    bonds:       useRigidStore.getState().bonds,
    patches:     useSurfaceStore.getState().patches,
    joints:      useJointStore.getState().joints,
<<<<<<< HEAD
=======
    blueprints:  useRobotStore.getState().blueprints,
>>>>>>> master
  })
}

export function restoreCanonical(state) {
  if (!state) return
  useSceneStore.getState().setObjects(state.objects ?? [])
  useElectronicsStore.getState().setAttachments(state.attachments ?? {})
  useRigidStore.getState().setBonds(state.bonds ?? {})
  useSurfaceStore.getState().setPatches(state.patches ?? {})
  useJointStore.getState().setJoints(state.joints ?? {})
<<<<<<< HEAD
=======
  useRobotStore.getState().setBlueprints(state.blueprints ?? {})
>>>>>>> master
}

// `_baseline` is the committed canonical state that the NEXT snapshot() will diff
// against. It always tracks the current document, so before/after pairs are exact.
let _baseline = null
function baseline() {
  if (_baseline == null) _baseline = captureCanonical()
  return _baseline
}

// ── Legacy snapshot bridge ────────────────────────────────────────────────────
// An operation already mutated the stores; record the before→after transition as
// one SnapshotCommand so it participates in the command stack and transactions.
// This is what useHistory().snapshot() now calls, so all existing call sites work.
export function recordSnapshot(label = 'edit') {
  const before = baseline()
  const after  = captureCanonical()
  // No-op edits (e.g. a slider released without movement) shouldn't pollute history.
  if (JSON.stringify(before) === JSON.stringify(after)) return null
  const cmd = new SnapshotCommand(before, after, restoreCanonical, label)
  history.record(cmd)        // effect already applied — record without re-doing
  _baseline = after
  return cmd
}

// ── Fine-grained commands ─────────────────────────────────────────────────────
export function execute(cmd) {
  history.execute(cmd)
  _baseline = captureCanonical()
  return cmd
}

// ── Transactions ──────────────────────────────────────────────────────────────
export function begin(label)  { history.begin(label) }
export function commit()      { history.commit();   _baseline = captureCanonical() }
export function rollback()    { history.rollback(); _baseline = captureCanonical() }

// Run fn() as one undoable step. Any execute()/recordSnapshot() inside is grouped.
export function transaction(label, fn) {
  history.begin(label)
  try {
    const result = fn()
    history.commit()
    _baseline = captureCanonical()
    return result
  } catch (e) {
    history.rollback()
    _baseline = captureCanonical()
    throw e
  }
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────
export function undo() { const ok = history.undo(); _baseline = captureCanonical(); return ok }
export function redo() { const ok = history.redo(); _baseline = captureCanonical(); return ok }

// ── Lifecycle ─────────────────────────────────────────────────────────────────
// Called on load / import / new project: discard history and adopt the freshly
// loaded document as the baseline (so the first edit diffs against it correctly).
export function resetBaseline() {
  _baseline = captureCanonical()
  history.clear()
}
export function clear() { resetBaseline() }
