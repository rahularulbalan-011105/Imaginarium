// Scene → physics graph: CAD-style structure (servo pivot groups with parts
// attached inside them, loose parts resting on others) becomes links/joints,
// and the resulting robot is physically sound.
import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'

// MassCalculator reads meshes only for csg/model types; stub the manager so the
// test doesn't pull in the browser-side scene graph.
vi.mock('../../src/managers/ObjectManager.js', () => ({ objectManager: { getMesh: () => null } }))
vi.mock('../../src/utils/utmTracking.js', () => ({ trackEvent: () => {}, setLoginEmail: () => {} }))

const { buildGraphFromScene } = await import('../../src/managers/physics/robotics/sceneGraph.js')
const { validateGraph } = await import('../../src/managers/physics/robotics/PhysicsGraph.js')
const { makeWorld, seconds } = await import('./helpers.js')

function boxMesh(id, w, h, d, pos) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial())
  m.position.set(pos.x, pos.y, pos.z)
  m.userData.id = id
  return m
}

/** A servo like electronicsFactory builds: body mesh + a pivot group at the horn (local +Y shaft). */
function servoMesh(id, pos, quat = new THREE.Quaternion()) {
  const root = new THREE.Group()
  root.userData.id = id
  root.position.set(pos.x, pos.y, pos.z)
  root.quaternion.copy(quat)
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.4), new THREE.MeshBasicMaterial()))
  const pivot = new THREE.Group()
  pivot.position.set(0, 0.45, 0)                 // horn on the top face
  root.add(pivot)
  root.userData.rotorGroup = pivot
  root.userData.rotorAxis = 'y'
  return root
}

/**
 * Quadruped built like a user would in the editor: a chassis box; per leg a
 * hip servo on the chassis side (shaft pointing sideways so the leg swings
 * forward/back), a thigh attached to its horn, a knee servo resting (not bonded)
 * at the thigh's tip, and a shin attached to the knee horn.
 */
function buildScene() {
  const scene = new THREE.Scene()
  const meshes = new Map(), objects = [], attachments = {}
  const add = (obj, mesh, parent = scene) => { parent.add(mesh); meshes.set(obj.id, mesh); objects.push(obj) }
  const H = 4.2
  add({ id: 'chassis', type: 'box', scale: { x: 2, y: 0.4, z: 3 }, material: 'standard' }, boxMesh('chassis', 4, 0.8, 6, { x: 0, y: H, z: 0 }))
  // Shaft along ±X (servo local +Y rotated to point outward).
  const out = (side) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side < 0 ? Math.PI / 2 : -Math.PI / 2)
  for (const [i, sx, sz] of [[0, -1, -2.2], [1, 1, -2.2], [2, -1, 2.2], [3, 1, 2.2]]) {
    const hip = servoMesh(`hip${i}`, { x: sx * 2.4, y: H, z: sz }, out(sx))
    add({ id: `hip${i}`, type: 'servo' }, hip)
    scene.updateMatrixWorld(true)
    // Thigh inside the hip's pivot: a bar hanging down from the horn.
    const pivot = hip.userData.rotorGroup
    const thighWorld = new THREE.Vector3(sx * 3.05, H - 0.9, sz)
    const thigh = boxMesh(`thigh${i}`, 0.3, 1.8, 0.3, thighWorld)
    pivot.attach(thigh)
    meshes.set(`thigh${i}`, thigh); objects.push({ id: `thigh${i}`, type: 'box', scale: { x: 0.15, y: 0.9, z: 0.15 } })
    attachments[`thigh${i}`] = `hip${i}`
    // Knee servo resting on the thigh tip (NOT bonded — must be inferred by contact).
    const knee = servoMesh(`knee${i}`, { x: sx * 3.05, y: H - 1.9, z: sz }, out(sx))
    add({ id: `knee${i}`, type: 'servo' }, knee)
    scene.updateMatrixWorld(true)
    const shin = boxMesh(`shin${i}`, 0.3, 2.0, 0.3, { x: sx * 3.6, y: H - 2.9, z: sz })
    knee.userData.rotorGroup.attach(shin)
    meshes.set(`shin${i}`, shin); objects.push({ id: `shin${i}`, type: 'box', scale: { x: 0.15, y: 1, z: 0.15 }, physics: { material: 'rubber' } })
    attachments[`shin${i}`] = `knee${i}`
  }
  scene.updateMatrixWorld(true)
  const objectMgr = { getMesh: (id) => meshes.get(id) ?? null }
  const topLevel = objects.filter(o => !attachments[o.id])
  return { scene, objectMgr, objects, topLevel, attachments }
}

describe('scene → physics graph', () => {
  it('derives links and actuated joints from servo horns, attachments and contact', () => {
    const { objectMgr, objects, topLevel, attachments } = buildScene()
    const { graph, warnings } = buildGraphFromScene({ objects: topLevel, allObjects: objects, objectMgr, attachments, bonds: [], joints: [], rootId: 'chassis', robotConfig: {} })
    expect(validateGraph(graph)).toEqual([])
    expect(warnings).toEqual([])
    // base + 4 thighs + 4 shins
    expect(graph.links.length).toBe(9)
    expect(graph.joints.length).toBe(8)
    expect(graph.actuators.length).toBe(8)
    // Every hip servo body rides on the chassis; every knee servo body on its thigh.
    const linkOf = (oid) => graph.links.find(l => l.objectIds.includes(oid)).id
    for (let i = 0; i < 4; i++) {
      expect(linkOf(`hip${i}`)).toBe('base')
      expect(linkOf(`knee${i}`)).toBe(`rotor_hip${i}`)
      expect(linkOf(`shin${i}`)).toBe(`rotor_knee${i}`)
    }
    // Joint axis = the servo shaft (world ±X here), anchor = the horn pivot.
    for (const j of graph.joints) {
      expect(Math.abs(j.axis.x)).toBeCloseTo(1, 5)
      expect(Math.abs(j.axis.y) + Math.abs(j.axis.z)).toBeLessThan(1e-6)
    }
    const j0 = graph.joints.find(j => j.id === 'j_hip0')
    expect(j0.parent).toBe('base'); expect(j0.child).toBe('rotor_hip0')
    expect(j0.anchor.x).toBeCloseTo(-2.4 - 0.45, 5)
    // Per-object material override reached the collider.
    expect(graph.links.find(l => l.id === 'rotor_knee0').colliders.find(c => c.objectId === 'shin0').material).toBe('rubber')
  })

  it('the extracted CAD robot stands on its servos in the physics world', async () => {
    const { objectMgr, objects, topLevel, attachments } = buildScene()
    const { graph } = buildGraphFromScene({ objects: topLevel, allObjects: objects, objectMgr, attachments, bonds: [], joints: [], rootId: 'chassis', robotConfig: { forwardVector: { x: 0, y: 0, z: -1 } } })
    // Servo-default MG90S on a ~chassis this size: use metal-gear 11 kg·cm servos.
    for (const a of graph.actuators) a.spec.preset = 'mg996r'
    const { rt } = await makeWorld()
    const robot = rt.addRobot(graph)
    expect(robot.legs.length).toBe(4)
    const y0 = robot.basePose().p.y
    rt.run(seconds(rt, 3))
    expect(robot.basePose().p.y).toBeGreaterThan(y0 - 0.6)          // held up by servo torque
    expect(Math.abs(robot.imu.trueRoll)).toBeLessThan(0.1)
    expect(Math.abs(robot.imu.truePitch)).toBeLessThan(0.1)
    expect([...robot.feet.values()].filter(f => f.contact).length).toBeGreaterThanOrEqual(3)
    // Firmware path: Servo.write(120) on a hip moves that joint through physics.
    robot.setMode('direct')
    expect(robot.commandServo('hip0', 120)).toBe(true)
    rt.run(seconds(rt, 1))
    const J = robot.joints.get('j_hip0'); robot.measureJoint(J)
    expect(Math.abs(J.angle)).toBeGreaterThan(0.2)
  })
})
