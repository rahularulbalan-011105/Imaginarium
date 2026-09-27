import R from '@dimforge/rapier3d-compat'
import { RoboticsRuntime } from '../../src/managers/physics/robotics/RoboticsRuntime.js'
import { L } from '../../src/managers/physics/robotics/units.js'

let _init = null
export async function rapier() {
  if (!_init) _init = R.init()
  await _init
  return R
}

/** A world in scene units with the same ground slab the app uses. */
export async function makeWorld(config = {}) {
  const R = await rapier()
  const world = new R.World({ x: 0, y: -9.81 / L, z: 0 })
  const gb = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -1, 0))
  const ground = world.createCollider(R.ColliderDesc.cuboid(200, 1, 200), gb)
  const rt = new RoboticsRuntime({ R, world, groundCollider: ground, config: { gravity: -9.81, ...config } })
  return { R, world, rt, ground }
}

export const seconds = (rt, s) => Math.round(s / rt.config.timestep)

/** Horizontal displacement of the base along the robot's forward axis (su). */
export function forwardProgress(robot, start) {
  const p = robot.basePose().p
  const f = robot.axes.forward
  return (p.x - start.x) * f.x + (p.z - start.z) * f.z
}

export function tilt(robot) {
  return { roll: robot.imu.trueRoll, pitch: robot.imu.truePitch }
}

/** One passive link hanging from a heavy base by a joint (pendulum / servo rig). */
export function jointRig({ axis = { x: 1, y: 0, z: 0 }, arm = { x: 0, y: 0, z: -1 }, armMass = 0.2, joint = {}, servo = null, shape = 'box' } = {}) {
  const armCollider = shape === 'sphere'
    ? { shape: 'sphere', radius: 0.2, offset: { p: arm }, mass: armMass }
    : { shape: 'box', halfExtents: { x: 0.15 + Math.abs(arm.x) * 0.85, y: 0.15 + Math.abs(arm.y) * 0.85, z: 0.15 + Math.abs(arm.z) * 0.85 }, offset: { p: arm }, mass: armMass }
  return {
    id: 'rig', baseLinkId: 'base', imu: false, locomotion: { type: 'none' },
    links: [
      { id: 'base', origin: { x: 0, y: 1, z: 0 }, colliders: [{ shape: 'box', halfExtents: { x: 2, y: 1, z: 2 }, offset: { p: { x: 0, y: 0, z: 0 } }, mass: 200 }] },
      { id: 'arm', origin: { x: 0, y: 5, z: 0 }, colliders: [armCollider] },
    ],
    joints: [{ id: 'j', type: 'revolute', parent: 'base', child: 'arm', anchor: { x: 0, y: 5, z: 0 }, axis, ...joint }],
    actuators: servo ? [{ id: 's', jointId: 'j', kind: 'servo', spec: servo, ...(servo.thermal ? { thermal: servo.thermal } : {}) }] : [],
  }
}
