// One place every part of the simulator reports "why isn't it moving".
// Issues land in physicsStore.simIssues (the sim HUD lists them) and, while a
// sketch runs, each one is echoed ONCE to the Serial monitor, tagged with where
// to look: [CAD] / [Electronics] / [Code].
import { usePhysicsStore } from '../stores/physicsStore.js'
import { CATEGORY_LABEL } from './physics/robotics/diagnosis.js'

let serialSink = null
const echoed = new Set()

const line = (i) => `[${CATEGORY_LABEL[i.category] ?? i.category}] ${i.title} — ${i.fix}\n`

export function reportIssue(issue) {
  if (!issue) return
  usePhysicsStore.getState().upsertSimIssue(issue)
  if (serialSink && !echoed.has(issue.id)) { echoed.add(issue.id); serialSink(line(issue)) }
}

export function resolveIssue(id) { usePhysicsStore.getState().removeSimIssue(id) }

/** prefix: clear only one family (e.g. 'run:'), else everything. */
export function clearIssues(prefix) {
  usePhysicsStore.getState().clearSimIssues(prefix)
  if (!prefix) echoed.clear()
  else for (const id of [...echoed]) if (id.startsWith(prefix)) echoed.delete(id)
}

/** A sketch started (fn) or stopped (null): echo what's already known to it. */
export function setSerialSink(fn) {
  serialSink = fn
  echoed.clear()
  if (fn) for (const i of usePhysicsStore.getState().simIssues) { echoed.add(i.id); fn(line(i)) }
}
