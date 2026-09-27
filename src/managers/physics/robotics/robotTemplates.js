// Procedural reference robots as physics graphs (scene units, 1 su = 5 cm).
// Used by the test-suite and as known-good examples of the graph format.
// The rest (zero-angle) pose is a bent-knee stance with each foot under its hip.
import * as THREE from 'three'

const Y = new THREE.Vector3(0, 1, 0)

function segment(from, to, half, mass, material) {
  const a = new THREE.Vector3(from.x, from.y, from.z), b = new THREE.Vector3(to.x, to.y, to.z)
  const dir = b.clone().sub(a), len = dir.length()
  const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize())
  const mid = a.clone().add(b).multiplyScalar(0.5)
  return { shape: 'box', halfExtents: { x: half, y: len / 2, z: half }, center: mid, q: { x: q.x, y: q.y, z: q.z, w: q.w }, mass, material }
}

function colliderAt(origin, c) {
  const { center, ...rest } = c
  return { ...rest, offset: { p: { x: center.x - origin.x, y: center.y - origin.y, z: center.z - origin.z }, q: c.q } }
}

/**
 * Legged robot with N legs of 3 DOF (hip-abduction, hip-pitch, knee).
 * @param opts.legs  mount points [{x,z}] (body frame, forward = −Z)
 */
export function buildLeggedRobot(opts = {}) {
  const {
    id = 'robot', name = 'Legged robot', origin = { x: 0, z: 0 },
    body = { hx: 2, hy: 0.5, hz: 3, mass: 1.0 },
    legs = [{ x: -2, z: -2.5 }, { x: 2, z: -2.5 }, { x: -2, z: 2.5 }, { x: 2, z: 2.5 }],
    upper = 1.6, lower = 2.0, kneeForward = 35 * Math.PI / 180,
    footRadius = 0.25, servo = { preset: 'mg996r' }, gait = {}, balance = {}, power = {},
    dof = 3, footMaterial = 'rubber', thermal = {}, imu = {},
  } = opts

  // Standing height: foot (sphere bottom on y=0) under the hip, bent knee.
  const kneeDy = upper * Math.cos(kneeForward), kneeDz = upper * Math.sin(kneeForward)
  const lowerDy = Math.sqrt(Math.max(0.01, lower * lower - kneeDz * kneeDz))
  const H = footRadius + lowerDy + kneeDy
  const bo = { x: origin.x, y: H, z: origin.z }

  const links = [{
    id: 'base', name: 'body', origin: bo,
    colliders: [{ shape: 'box', halfExtents: { x: body.hx, y: body.hy, z: body.hz }, offset: { p: { x: 0, y: 0, z: 0 } }, mass: body.mass, material: 'plastic' }],
  }]
  const joints = [], actuators = []
  const fwd = { x: 0, y: 0, z: -1 }, right = { x: 1, y: 0, z: 0 }

  legs.forEach((m, i) => {
    const L = `leg${i}`
    const hip = { x: bo.x + m.x, y: H, z: bo.z + m.z }
    const knee = { x: hip.x, y: H - kneeDy, z: hip.z - kneeDz }
    const foot = { x: hip.x, y: footRadius, z: hip.z }
    let parent = 'base'

    if (dof >= 3) {
      links.push({ id: `${L}_yoke`, origin: hip, colliders: [{ shape: 'box', halfExtents: { x: 0.2, y: 0.2, z: 0.2 }, offset: { p: { x: 0, y: 0, z: 0 } }, mass: 0.03 }] })
      joints.push({ id: `${L}_abd`, type: 'revolute', parent, child: `${L}_yoke`, anchor: hip, axis: fwd, limits: { min: -0.6, max: 0.6 }, damping: 0.001, friction: 0.002 })
      actuators.push({ id: `${L}_abd_servo`, jointId: `${L}_abd`, kind: 'servo', componentId: `${L}_abd_servo`, spec: { ...servo }, thermal })
      parent = `${L}_yoke`
    }
    links.push({ id: `${L}_upper`, origin: hip, colliders: [colliderAt(hip, segment(hip, knee, 0.22, 0.06))] })
    joints.push({ id: `${L}_hip`, type: 'revolute', parent, child: `${L}_upper`, anchor: hip, axis: right, limits: { min: -1.2, max: 1.2 }, damping: 0.001, friction: 0.002 })
    actuators.push({ id: `${L}_hip_servo`, jointId: `${L}_hip`, kind: 'servo', componentId: `${L}_hip_servo`, spec: { ...servo }, thermal })

    links.push({
      id: `${L}_lower`, origin: knee,
      colliders: [
        colliderAt(knee, segment(knee, foot, 0.18, 0.05)),
        { shape: 'sphere', radius: footRadius, offset: { p: { x: foot.x - knee.x, y: foot.y - knee.y, z: foot.z - knee.z } }, mass: 0.01, material: footMaterial },
      ],
      isFoot: true,
      footPoint: { x: foot.x, y: 0, z: foot.z },
    })
    joints.push({ id: `${L}_knee`, type: 'revolute', parent: `${L}_upper`, child: `${L}_lower`, anchor: knee, axis: right, limits: { min: -1.5, max: 1.5 }, damping: 0.001, friction: 0.002 })
    actuators.push({ id: `${L}_knee_servo`, jointId: `${L}_knee`, kind: 'servo', componentId: `${L}_knee_servo`, spec: { ...servo }, thermal })
  })

  return {
    id, name, baseLinkId: 'base', forward: fwd, links, joints, actuators,
    imu: { linkId: 'base', spec: imu }, power,
    locomotion: { type: 'legs', gait, balance },
    standHeight: H,
  }
}

export const buildQuadruped = (o = {}) => buildLeggedRobot({ name: 'Quadruped', ...o })

export const buildHexapod = (o = {}) => buildLeggedRobot({
  name: 'Hexapod',
  body: { hx: 2, hy: 0.5, hz: 4, mass: 1.1 },
  legs: [
    { x: -2, z: -3.5 }, { x: 2, z: -3.5 },
    { x: -2.4, z: 0 },  { x: 2.4, z: 0 },
    { x: -2, z: 3.5 },  { x: 2, z: 3.5 },
  ],
  gait: { type: 'tripod', ...(o.gait ?? {}) },
  ...o,
})

/** Single rigid body (passive object) as a graph. */
export function buildBox(opts = {}) {
  const { id = 'box', center = { x: 0, y: 2, z: 0 }, half = { x: 1, y: 1, z: 1 }, mass = 1, material = 'wood' } = opts
  return {
    id, baseLinkId: 'b', links: [{ id: 'b', origin: center, colliders: [{ shape: 'box', halfExtents: half, offset: { p: { x: 0, y: 0, z: 0 } }, mass, material }] }],
    joints: [], actuators: [], imu: false, locomotion: { type: 'none' },
  }
}
