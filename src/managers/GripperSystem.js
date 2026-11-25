// Servo gripper at run time: moves the jaws at the servo's speed, stops them on
// a LOOSE part between the pads, and holds the part while the squeeze's
// friction beats its weight (utils/gripper.js has the numbers). A held part
// rides along with the gripper; opening (or slipping) drops it onto whatever
// is below. Rule-based, not contact physics: loose parts are pick-up targets,
// not colliders. Everything returns to its design pose when the simulation ends.
import * as THREE from 'three'
import { objectManager } from './ObjectManager.js'
import { simulationManager } from './SimulationManager.js'
import { sceneManager } from './SceneManager.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { usePhysicsStore } from '../stores/physicsStore.js'
import { effectiveMass } from './physics/MassCalculator.js'
import { SCENE_TO_M } from './physics/EnvironmentConfig.js'
import { makeIssue } from './physics/robotics/diagnosis.js'
import { reportIssue, clearIssues } from './simIssues.js'
import {
  GRIP, gapForAngle, gapRate, servoOf, squeezeN, holdCapacityN, padForceN, partBetweenPads, FULL_SQUEEZE_CM,
} from '../utils/gripper.js'
import { SERVO_PRESETS } from './physics/robotics/ServoActuator.js'
import { isNonPhysical } from './physics/robotics/sceneGraph.js'

const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _v = new THREE.Vector3()

const _I = new THREE.Matrix4()
/**
 * A part's solid bounding box — its own visible meshes only (no pins, outlines,
 * markers…) — in another object's frame (`inv` = that frame's inverse), or in
 * world space when `inv` is omitted.
 */
function boxIn(partMesh, inv = _I) {
  const local = new THREE.Box3()
  const own = new THREE.Box3()
  partMesh.updateMatrixWorld(true)
  partMesh.traverse((c) => {
    if (!c.isMesh || !c.geometry || !c.visible || isNonPhysical(c)) return
    if (!c.geometry.boundingBox) c.geometry.computeBoundingBox()
    own.copy(c.geometry.boundingBox)
    _m.multiplyMatrices(inv, c.matrixWorld)
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? own.max.x : own.min.x, i & 2 ? own.max.y : own.min.y, i & 4 ? own.max.z : own.min.z).applyMatrix4(_m)
      local.expandByPoint(_v)
    }
  })
  return local.isEmpty() ? null : local
}

class GripperSystem {
  constructor() { this.reset() }

  reset() {
    for (const [id, pose] of this._saved ?? []) {
      const m = objectManager.getMesh(id)
      if (m) { m.position.copy(pose.p); m.quaternion.copy(pose.q); m.updateMatrixWorld(true) }
    }
    for (const id of this._grippers?.keys() ?? []) objectManager.getMesh(id)?.userData.setGap?.(GRIP.maxGap)
    if (this._saved?.size || this._grippers?.size) sceneManager.requestRender?.(200)
    this._grippers = new Map()   // id → { gap, holding, rel, contact, force }
    this._saved = new Map()      // part id → design pose
    this._falling = new Map()    // part id → { v, floor }
    this._said = new Set()
    this._t = null
    clearIssues('run:grip')
  }

  /** Live state for the Properties panel. */
  state(id) { return this._grippers.get(id) ?? null }

  _save(id, mesh) { if (!this._saved.has(id)) this._saved.set(id, { p: mesh.position.clone(), q: mesh.quaternion.clone() }) }

  step(now = performance.now()) {
    const dt = this._t == null ? 0 : Math.min(0.05, (now - this._t) / 1000)
    this._t = now
    const objects = useSceneStore.getState().objects
    const grippers = objects.filter((o) => o.type === 'gripper')
    if (!grippers.length && !this._falling.size) return
    const loose = objects.filter((o) => o.loose)
    const g = Math.abs(usePhysicsStore.getState().gravity ?? 9.81)
    const held = new Set([...this._grippers.values()].map((s) => s.holding).filter(Boolean))

    for (const o of grippers) {
      const mesh = objectManager.getMesh(o.id)
      if (!mesh?.userData.setGap) continue
      let st = this._grippers.get(o.id)
      if (!st) { st = { gap: GRIP.maxGap, holding: null, rel: null, contact: null, force: 0 }; this._grippers.set(o.id, st) }
      const cmd = simulationManager.servoAngles[o.id]
      const target = cmd == null ? st.gap : gapForAngle(cmd)
      const servo = servoOf(o)
      mesh.updateMatrixWorld(true)
      _inv.copy(mesh.matrixWorld).invert()

      // ── holding: keep it, or let go (opened / slipped) ──
      if (st.holding) {
        const part = objects.find((p) => p.id === st.holding)
        const pm = objectManager.getMesh(st.holding)
        if (!part || !pm) { st.holding = null }
        else if (target > st.contact + 0.05) { this._drop(st, pm, objects); held.delete(part.id) }
        else {
          st.force = squeezeN(servo, st.contact, target)
          if (holdCapacityN(st.force) < effectiveMass(part) * g) {
            this._slipIssue(o, part, servo, st.contact, g)
            this._drop(st, pm, objects); held.delete(part.id)
          } else {
            _m.multiplyMatrices(mesh.matrixWorld, st.rel)
            _m.decompose(pm.position, pm.quaternion, _v)
            pm.updateMatrixWorld(true)
          }
        }
      }

      // ── move the jaws toward the command at the servo's speed ──
      const step = gapRate(servo) * dt
      let next = target < st.gap ? Math.max(target, st.gap - step) : Math.min(target, st.gap + step)

      if (st.holding) next = st.contact
      else if (next < st.gap + 1e-6) {
        // closing (or squeezing): a loose part between the pads stops the jaws
        let hit = null
        for (const p of loose) {
          if (held.has(p.id) || this._falling.get(p.id)?.v > 0) continue   // can't catch it mid-fall
          const pm = objectManager.getMesh(p.id)
          if (!pm) continue
          const box = boxIn(pm, _inv)
          const h = box && partBetweenPads(box, st.gap + 0.01)
          if (h && h.width <= st.gap + 0.01 && (!hit || h.width > hit.width)) hit = { ...h, part: p, pm }
        }
        if (hit && next <= hit.width) {
          next = hit.width
          st.contact = hit.width
          st.force = squeezeN(servo, hit.width, target)
          const weight = effectiveMass(hit.part) * g
          if (holdCapacityN(st.force) >= weight) {
            // grabbed: the pads centre it between them, then it rides along
            this._save(hit.part.id, hit.pm)
            if (Math.abs(hit.centerX) > 1e-4) {
              _v.set(1, 0, 0).transformDirection(mesh.matrixWorld).multiplyScalar(-hit.centerX)
              hit.pm.position.add(_v); hit.pm.updateMatrixWorld(true)
            }
            st.holding = hit.part.id
            this._falling.delete(hit.part.id)
            st.rel = new THREE.Matrix4().multiplyMatrices(_inv, hit.pm.matrixWorld)
            held.add(hit.part.id)
            this._said.delete(`slip:${o.id}`)
          } else if (target <= hit.width - FULL_SQUEEZE_CM) {
            this._slipIssue(o, hit.part, servo, hit.width, g)      // full squeeze and still too heavy
          }
        } else if (!hit) { st.contact = null; st.force = 0 }
      }
      if (Math.abs(next - st.gap) > 1e-5) { st.gap = next; mesh.userData.setGap(next) }
    }

    // ── dropped parts fall onto what's below them — and fall again when that
    //    moves away (a part left on the claw drops once the arm swings off) ──
    for (const [id, f] of this._falling) {
      const pm = objectManager.getMesh(id)
      if (!pm) { this._falling.delete(id); continue }
      if (f.v === 0 && (f.recheck -= dt) > 0) continue          // resting: look again every 0.1 s
      f.recheck = 0.1
      const me = boxIn(pm)
      if (!me) continue
      const floor = this._floorUnder(id, me, objects)
      if (me.min.y <= floor + 1e-3) { f.v = 0; continue }
      f.v += (g / SCENE_TO_M) * dt
      pm.position.y -= Math.min(f.v * dt, me.min.y - floor); pm.updateMatrixWorld(true)
    }
    sceneManager.requestRender?.(100)
  }

  _drop(st, pm, objects) {
    const id = st.holding
    st.holding = null; st.rel = null; st.force = 0
    if (!id) return
    // It lands on its base: keep the heading it has now, drop the tilt the
    // claw gave it (back to how it was designed to stand).
    const design = this._saved.get(id)?.q
    if (design) {
      const now = new THREE.Euler().setFromQuaternion(pm.quaternion, 'YXZ')
      const stand = new THREE.Euler().setFromQuaternion(design, 'YXZ')
      pm.quaternion.setFromEuler(new THREE.Euler(stand.x, now.y, stand.z, 'YXZ'))
      pm.updateMatrixWorld(true)
    }
    this._falling.set(id, { v: 1e-6, recheck: 0 })               // starts falling next frame
  }

  /** The highest top of any other part under this footprint (else the ground). */
  _floorUnder(id, me, objects) {
    let floor = 0
    for (const o of objects) {
      if (o.id === id) continue
      const m = objectManager.getMesh(o.id)
      if (!m || !m.visible) continue
      const b = boxIn(m)
      if (!b || b.max.x < me.min.x || b.min.x > me.max.x || b.max.z < me.min.z || b.min.z > me.max.z) continue
      if (b.max.y <= me.min.y + 0.05) floor = Math.max(floor, b.max.y)
    }
    return floor
  }

  _slipIssue(o, part, servo, width, g) {
    const key = `slip:${o.id}`
    if (this._said.has(key)) return
    this._said.add(key)
    const need = effectiveMass(part) * g
    const can = holdCapacityN(padForceN(servo, width))
    const name = o.name || 'Gripper'
    const label = SERVO_PRESETS[servo]?.label?.split(' ')[0] ?? servo
    reportIssue(makeIssue('cad', `run:grip-slip:${o.id}`,
      `${part.name || 'The part'} slips out of ${name}`,
      `It weighs ${effectiveMass(part).toFixed(2)} kg, so the pads need ${need.toFixed(1)} N of friction to hold it. The ${label} squeezes hard enough for at most ${can.toFixed(1)} N (${(can / g).toFixed(2)} kg).`,
      `Use a stronger gripper servo (select ${name} → Properties), or a lighter part (Physics → Body → mass). Also close well past the part (a larger write() angle) so the servo squeezes fully.`,
      'warning'))
  }
}

export const gripperSystem = new GripperSystem()
