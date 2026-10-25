// Attachment mount frames.
//
// The reported bug: the same propeller attached to two servos came out with
// different orientations. The old mount was `rotorWorldQuat⁻¹ * propWorldQuat`,
// i.e. "whatever world orientation the part happened to have", so the result
// depended on how BOTH the part and that particular servo were rotated first.
// These tests pin the mount to geometry instead.
import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { objectManager } from '../../src/managers/ObjectManager.js'

/** A flat disc-like part (a propeller): thin along Y. */
const prop = () => new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4))
/** A part with no flat axis — deliberately has no canonical mount. */
const cube = () => new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))

/** A stand-in for a servo/motor: a root carrying a rotorGroup on `axis`. */
function rotor(axis = 'y', worldEuler = [0, 0, 0]) {
  const root = new THREE.Group()
  root.rotation.set(...worldEuler)
  const group = new THREE.Group()
  group.position.set(0, 1, 0)
  root.add(group)
  root.userData.rotorGroup = group
  root.userData.rotorAxis = axis
  return root
}

let scene
beforeEach(() => {
  scene = new THREE.Scene()
  objectManager.scene = scene
  objectManager.objects = new Map()
  objectManager.attachedObjects = new Map()
})

/** Register a part + rotor in the manager and attach them. */
function attach(part, rotorRoot, { partEuler = [0, 0, 0] } = {}) {
  part.rotation.set(...partEuler)
  scene.add(part)
  scene.add(rotorRoot)
  objectManager.objects.set('part', part)
  objectManager.objects.set('motor', rotorRoot)
  scene.updateMatrixWorld(true)
  const ok = objectManager.attachMeshToRotor('part', 'motor')
  expect(ok).toBe(true)
  return part
}

const quatOf = (m) => m.quaternion.clone()
/** Angle between two orientations, in degrees. */
const angleBetween = (a, b) => THREE.MathUtils.radToDeg(a.angleTo(b))

describe('attachment mount frame', () => {
  // Test A — the reported bug.
  it('A: the same prop mounts identically on two differently-oriented servos', () => {
    const a = attach(prop(), rotor('y', [0, 0, 0]))
    const qa = quatOf(a)

    beforeEachReset()
    const b = attach(prop(), rotor('y', [0, Math.PI / 2, 0]))
    const qb = quatOf(b)

    // Same local mount, even though the two servos face different ways.
    expect(angleBetween(qa, qb)).toBeLessThan(1e-6)
  })

  it('A2: and is unaffected by how the part was rotated beforehand', () => {
    const a = attach(prop(), rotor('y'))
    const qa = quatOf(a)

    beforeEachReset()
    // Same part, arbitrarily rotated in the world before attaching. The old code
    // baked this rotation into the mount; the canonical mount ignores it.
    const b = attach(prop(), rotor('y'), { partEuler: [0.7, -1.2, 2.1] })
    expect(angleBetween(qa, quatOf(b))).toBeLessThan(1e-6)
  })

  // Test C — rotors whose axes differ must each get their own correct mount.
  it('C: the flat axis lands on the rotor axis, whatever that axis is', () => {
    for (const axis of ['x', 'y', 'z']) {
      beforeEachReset()
      const part = attach(prop(), rotor(axis))
      // The prop is thin along its local Y; after mounting, that axis must point
      // along the rotor axis.
      const thin = new THREE.Vector3(0, 1, 0).applyQuaternion(part.quaternion)
      const expected = new THREE.Vector3()
      expected[axis] = 1
      expect(Math.abs(thin.dot(expected))).toBeCloseTo(1, 6)
    }
  })

  it('leaves parts with no flat axis alone rather than guessing', () => {
    expect(objectManager._canonicalMountQuat(cube(), 'y')).toBeNull()
  })

  // Test B — a rotated parent must carry the child, with no extra rotation.
  it('B: rotating the servo afterwards moves the prop with it, nothing more', () => {
    const rotorRoot = rotor('y')
    const part = attach(prop(), rotorRoot)
    const localBefore = quatOf(part)

    rotorRoot.rotation.y += Math.PI / 3
    rotorRoot.updateMatrixWorld(true)

    // The LOCAL mount is untouched: the part followed the parent, it was not
    // re-rotated on top of it.
    expect(angleBetween(localBefore, quatOf(part))).toBeLessThan(1e-9)
  })

  // Test F — detach must preserve the world transform.
  it('F: detaching preserves world position, orientation and scale', () => {
    const rotorRoot = rotor('y', [0.3, 0.9, -0.4])
    const part = attach(prop(), rotorRoot)
    part.scale.set(2, 2, 2)
    rotorRoot.updateMatrixWorld(true)
    part.updateMatrixWorld(true)

    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3()
    part.getWorldPosition(wp); part.getWorldQuaternion(wq); part.getWorldScale(ws)

    objectManager.detachMeshFromRotor('part')
    part.updateMatrixWorld(true)

    const ap = new THREE.Vector3(), aq = new THREE.Quaternion(), as = new THREE.Vector3()
    part.getWorldPosition(ap); part.getWorldQuaternion(aq); part.getWorldScale(as)

    expect(ap.distanceTo(wp)).toBeLessThan(1e-6)
    expect(angleBetween(aq, wq)).toBeLessThan(1e-6)
    expect(as.distanceTo(ws)).toBeLessThan(1e-6)   // scale was dropped before this fix
  })
})

describe('attachment correction', () => {
  it('applies a local rotation correction and resets exactly', () => {
    const part = attach(prop(), rotor('y'))
    const base = quatOf(part)

    objectManager.setAttachAlign('part', { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } })
    expect(angleBetween(quatOf(part), base)).toBeCloseTo(90, 4)

    objectManager.setAttachAlign('part', null)
    expect(angleBetween(quatOf(part), base)).toBeLessThan(1e-9)
  })

  it('does not accumulate when a slider is dragged through many values', () => {
    const part = attach(prop(), rotor('y'))
    const base = quatOf(part)
    for (let deg = 0; deg <= 45; deg++) {
      objectManager.setAttachAlign('part', { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: deg, z: 0 } })
    }
    // Composed against the stored base every time, so the end state is exactly
    // 45 degrees — not 0+1+2+…+45.
    expect(angleBetween(quatOf(part), base)).toBeCloseTo(45, 4)
  })

  it('offsets in the rotor frame and reverses cleanly', () => {
    const part = attach(prop(), rotor('y'))
    const p0 = part.position.clone()
    objectManager.setAttachAlign('part', { pos: { x: 0, y: 1.5, z: 0 }, rot: { x: 0, y: 0, z: 0 } })
    expect(part.position.y - p0.y).toBeCloseTo(1.5, 6)
    objectManager.setAttachAlign('part', null)
    expect(part.position.distanceTo(p0)).toBeLessThan(1e-9)
  })

  // Test G — what gets saved is enough to rebuild the correction.
  it('G: the saved transform carries base + align for reload', () => {
    const part = attach(prop(), rotor('y'))
    const align = { pos: { x: 0, y: 0.5, z: 0 }, rot: { x: 0, y: 30, z: 0 } }
    objectManager.setAttachAlign('part', align)

    const saved = objectManager.getAttachedLocalTransform('part')
    expect(saved.base).toBeTruthy()
    expect(saved.align).toEqual(align)

    // Reload into a fresh rotor and the correction survives.
    const before = quatOf(part)
    beforeEachReset()
    const rotorRoot = rotor('y')
    const fresh = prop()
    scene.add(fresh); scene.add(rotorRoot)
    objectManager.objects.set('part', fresh)
    objectManager.objects.set('motor', rotorRoot)
    objectManager.reattachLocal('part', 'motor', saved)
    expect(angleBetween(quatOf(fresh), before)).toBeLessThan(1e-6)
    expect(objectManager.getAttachBase('part')).toEqual(saved.base)
  })

  it('old projects without correction data still load, and can then be corrected', () => {
    const rotorRoot = rotor('y')
    const part = prop()
    scene.add(part); scene.add(rotorRoot)
    objectManager.objects.set('part', part)
    objectManager.objects.set('motor', rotorRoot)
    // A pre-correction save: position/quaternion/scale only.
    objectManager.reattachLocal('part', 'motor', {
      position: { x: 0, y: 0.4, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    })
    expect(part.position.y).toBeCloseTo(0.4, 6)
    // Its restored transform becomes the base, so corrections work from there.
    expect(objectManager.getAttachBase('part')).toBeTruthy()
    objectManager.setAttachAlign('part', { pos: { x: 0, y: 0.1, z: 0 }, rot: { x: 0, y: 0, z: 0 } })
    expect(part.position.y).toBeCloseTo(0.5, 6)
  })
})

// vitest's beforeEach only runs between `it`s; some cases need a mid-test reset.
function beforeEachReset() {
  scene = new THREE.Scene()
  objectManager.scene = scene
  objectManager.objects = new Map()
  objectManager.attachedObjects = new Map()
}
