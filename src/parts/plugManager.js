// Keeps breadboard plugs in sync with the scene (see plugging.js for the rule).
//
// Whenever objects change — a drag released, a typed position, a drop, an
// undo — a part that sits on a breadboard is snapped onto the hole grid and its
// legs become wires to the holes under them (connections flagged auto: 'plug').
// Moving the part away unplugs it. Hand-drawn wires are never touched.
import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { sceneManager } from '../managers/SceneManager.js'
import { getPart } from './registry.js'
import { computePlugs, snapOffset } from './plugging.js'

let timer = null, started = false, lastObjects = null

function sync() {
  timer = null
  if (sceneManager.transformControls?.dragging) { schedule(); return }   // wait for the gizmo to let go
  const scene = useSceneStore.getState()
  const objects = scene.objects
  if (!objects.some(o => getPart(o.type)?.breadboard)) { clearPlugs(); return }

  // 1. Snap parts that moved onto a board's grid.
  const moved = lastObjects ? objects.filter(o => {
    const prev = lastObjects.get(o.id)
    return !prev || prev.position !== o.position || prev.rotation !== o.rotation
  }) : []
  for (const o of moved) {
    const off = snapOffset(o, objects)
    if (off) scene.updateObject(o.id, { position: { x: +(o.position.x + off.x).toFixed(4), y: +(o.position.y + off.y).toFixed(4), z: +(o.position.z + off.z).toFixed(4) } })
  }
  const now = useSceneStore.getState().objects
  lastObjects = new Map(now.map(o => [o.id, o]))

  // 2. Plugs: add the new ones, drop the ones whose leg moved off its hole.
  const want = computePlugs(now)
  const el = useElectronicsStore.getState()
  const conns = el.connections
  const wantKey = new Set(want.map(p => `${p.fromPinId}→${p.toPinId}`))
  const have = new Map()
  for (const [id, c] of Object.entries(conns)) if (c.auto === 'plug') have.set(`${c.fromPinId}→${c.toPinId}`, id)
  for (const [k, id] of have) if (!wantKey.has(k)) el.removeWireConnection(id)
  for (const p of want) {
    const k = `${p.fromPinId}→${p.toPinId}`
    if (!have.has(k)) el.addWireConnection(p.fromPinId, p.toPinId, `plug:${k}`, { auto: 'plug' })
  }
}

function clearPlugs() {
  const el = useElectronicsStore.getState()
  for (const [id, c] of Object.entries(el.connections)) if (c.auto === 'plug') el.removeWireConnection(id)
}

function schedule() { if (!timer) timer = setTimeout(sync, 150) }

/** Start watching the scene (idempotent). Called once by the Viewport. */
export function initPlugging() {
  if (started) return
  started = true
  lastObjects = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
  useSceneStore.subscribe((s, prev) => { if (s.objects !== prev.objects) schedule() })
  schedule()
}
