// Physics benchmark (Benchmark E, headless): real Rapier WASM under Node, the
// app's own RoboticsRuntime + robot templates. Measures what one fixed 240 Hz
// step costs, split into controllers (control), Rapier (world.step) and
// post-step sensing/stability (postStep) — physics cost isolated from rendering.
//
//   node tools/bench/physics.mjs            (≈30 s)
//
// "Real-time budget": at 60 fps a 240 Hz sim must run 4 steps per frame, so a
// scene is real-time only while 4 × step ms leaves room for rendering + UI.
import R from '@dimforge/rapier3d-compat'
import { RoboticsRuntime } from '../../src/managers/physics/robotics/RoboticsRuntime.js'
import { buildQuadruped, buildHexapod, buildBox } from '../../src/managers/physics/robotics/robotTemplates.js'
import { L } from '../../src/managers/physics/robotics/units.js'

await R.init()
const now = () => performance.now()

function makeWorld() {
  const world = new R.World({ x: 0, y: -9.81 / L, z: 0 })
  const gb = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -1, 0))
  const ground = world.createCollider(R.ColliderDesc.cuboid(200, 1, 200), gb)
  return { world, rt: new RoboticsRuntime({ R, world, groundCollider: ground, config: { gravity: -9.81 } }) }
}

function bench(label, setup, seconds = 6) {
  const { world, rt } = makeWorld()
  const robots = setup(rt)
  for (const r of robots) { r.setMode?.('gait'); r.setCommand?.({ forward: 1 }) }
  const h = rt.config.timestep
  // Split timing without changing the runtime: wrap control / postStep / world.step.
  const t = { control: 0, world: 0, post: 0 }
  for (const r of rt.robots.values()) {
    const c = r.control.bind(r), p = r.postStep.bind(r)
    r.control = (dt) => { const a = now(); c(dt); t.control += now() - a }
    r.postStep = (dt) => { const a = now(); p(dt); t.post += now() - a }
  }
  const ws = world.step.bind(world)
  world.step = () => { const a = now(); ws(); t.world += now() - a }
  const warm = Math.round(1 / h)                 // 1 s warm-up (settling, JIT)
  rt.run(warm)
  t.control = t.world = t.post = 0
  const n = Math.round(seconds / h), per = []
  for (let i = 0; i < n; i++) { const a = now(); rt.step(h); per.push(now() - a) }
  per.sort((a, b) => a - b)
  const avg = per.reduce((s, v) => s + v, 0) / n
  const res = {
    scene: label, hz: Math.round(1 / h), bodies: world.bodies.len(), colliders: world.colliders.len(), joints: world.impulseJoints.len(),
    stepMsAvg: +avg.toFixed(3), stepMsP95: +per[Math.floor(n * 0.95)].toFixed(3),
    controlMs: +(t.control / n).toFixed(3), rapierMs: +(t.world / n).toFixed(3), postStepMs: +(t.post / n).toFixed(3),
    msPerFrameAt60fps: +(avg * (1 / h) / 60).toFixed(2),
    realtimeX: +((1000 * h) / avg).toFixed(1),
  }
  rt.dispose(); world.free()
  return res
}

const rows = [
  bench('1 quadruped (crawl)', rt => [rt.addRobot(buildQuadruped({ gait: { type: 'crawl' } }))]),
  bench('1 hexapod (tripod)', rt => [rt.addRobot(buildHexapod())]),
  bench('2 quadrupeds + 2 hexapods', rt => [
    rt.addRobot(buildQuadruped({ id: 'q1', origin: { x: -12, z: 0 } })), rt.addRobot(buildQuadruped({ id: 'q2', origin: { x: 12, z: 0 } })),
    rt.addRobot(buildHexapod({ id: 'h1', origin: { x: 0, z: -14 } })), rt.addRobot(buildHexapod({ id: 'h2', origin: { x: 0, z: 14 } })),
  ]),
  bench('hexapod + 10 loose boxes', rt => {
    const out = [rt.addRobot(buildHexapod({ id: 'W' }))]
    for (let i = 0; i < 10; i++) out.push(rt.addRobot(buildBox({ id: 'b' + i, center: { x: (i - 5) * 3, y: 0.6, z: -8 }, half: { x: 1, y: 0.6, z: 1 }, mass: 0.3 })))
    return out
  }),
]
console.table(rows)
console.log(JSON.stringify(rows))
