// Physics module classes + registry. Every module implements the same interface
// so the runtime can load/step/unload them uniformly. Adding a new robot
// capability = add a class here + reference it from the loader's registries.
//
// In this first slice the locomotion modules are DESCRIPTIVE: the heavy physics
// still runs in DriveManager (selected by the blueprint's locomotion type), and
// these modules declare/describe what's active for the UI and future per-module
// execution. New-type modules (tracks/rotors/marine) are registered stubs.

import { DifferentialDrive } from '../managers/robot/DifferentialDrive.js'

// PhysicsModule contract (Stage 4): the ModuleHost calls enter → step* → exit.
// `ctx` is a shared per-robot object:
//   { blueprint, wheelbase, inputs:{leftPWM,rightPWM,…}, env, output:{} }
// A module READS ctx.inputs/env and WRITES its result onto ctx.output
// (e.g. ctx.output.drive = { v, omega }). Most modules are still no-op stubs;
// they gain real step() bodies stage by stage.
export class PhysicsModule {
  static key = 'PhysicsModule'
  static label = 'Physics'
  static category = 'physics'
  // Pipeline position (lower runs first). Sensing < planning < control < actuation.
  static stage = 50
  enter(/* ctx */) {}
  step(/* dt, ctx */) {}
  exit() {}
}

const def = (key, label) => {
  const C = class extends PhysicsModule {}
  C.key = key; C.label = label
  return C
}

// Locomotion modules
const WheelPhysics            = def('WheelPhysics', 'Wheel physics')
const MotorPhysics            = def('MotorPhysics', 'Motor physics')

// First EXECUTABLE module: turns motor PWM into the robot's drive velocities
// using the same differential-drive control law DriveManager has always used.
// Writes { v, omega } to ctx.output.drive each step.
class DifferentialDrivePhysics extends PhysicsModule {
  static key = 'DifferentialDrivePhysics'
  static label = 'Differential drive'
  enter(ctx) {
    this._drive = new DifferentialDrive()
    if (ctx?.wheelbase) this._drive.wheelbase = ctx.wheelbase
  }
  step(_dt, ctx) {
    if (!this._drive) this._drive = new DifferentialDrive()
    const { leftPWM = 0, rightPWM = 0 } = ctx?.inputs ?? {}
    const { v, omega } = this._drive.compute(leftPWM, rightPWM)
    ctx.output = ctx.output ?? {}
    ctx.output.drive = { v, omega }
  }
  exit() { this._drive = null }
}
// ── Articulated (legged / manipulator) pipeline ─────────────────────────────
// EXECUTABLE when ctx.robot is an ArticulatedRobot (managers/physics/robotics).
// Each module is one stage of the control loop, ordered by `static stage`:
//   GaitEngine(20) → BalanceSystem(30) → InverseKinematics(40)
//   → ServoPhysics(60) → JointPhysics/JointConstraints(70)
// They only ever produce TARGETS and TORQUES — Rapier moves the bodies.
// Without an articulated robot in ctx they are inert (legacy paths unchanged).
class GaitEngine extends PhysicsModule {
  static key = 'GaitEngine'
  static label = 'Gait engine'
  static stage = 20
  step(dt, ctx) {
    const r = ctx?.robot
    if (!r?.computeFootTargets) return
    ctx.output.footTargets = r.computeFootTargets(dt)
  }
}

class BalanceSystem extends PhysicsModule {
  static key = 'BalanceSystem'
  static label = 'Balance system'
  static stage = 30
  step(_dt, ctx) {
    const r = ctx?.robot
    if (!r?.applyBalance || !ctx.output.footTargets) return
    ctx.output.footTargets = r.applyBalance(ctx.output.footTargets)
  }
}

class InverseKinematics extends PhysicsModule {
  static key = 'InverseKinematics'
  static label = 'Inverse kinematics'
  static stage = 40
  step(_dt, ctx) {
    const r = ctx?.robot
    if (!r?.solveIK || !ctx.output.footTargets) return
    r.solveIK(ctx.output.footTargets)
  }
}

class ServoPhysics extends PhysicsModule {
  static key = 'ServoPhysics'
  static label = 'Servo physics'
  static stage = 60
  step(dt, ctx) { ctx?.robot?.driveActuators?.(dt) }
}

class JointPhysics extends PhysicsModule {
  static key = 'JointPhysics'
  static label = 'Joint physics'
  static stage = 70
  step(dt, ctx) {
    const r = ctx?.robot
    if (!r?.passiveJoints) return
    // JointPhysics and JointConstraints may both be loaded — run once per step.
    if (r._passiveStep === r.metrics.stepCount) return
    r._passiveStep = r.metrics.stepCount
    r.passiveJoints(dt)
  }
}
// EXECUTABLE: tracked (skid-steer) drive. Same PWM→velocity model as wheels but
// with sharper turning and slight linear slip, so a 'tracks' robot feels like a
// tank rather than a car. Routes through the same wheeled seam (v/omega).
class TrackPhysics extends PhysicsModule {
  static key = 'TrackPhysics'
  static label = 'Track physics'
  enter(ctx) {
    this._drive = new DifferentialDrive()
    if (ctx?.wheelbase) this._drive.wheelbase = ctx.wheelbase
    this._turnBoost = 1.4   // tracks pivot faster than wheels
    this._linSlip   = 0.92  // and lose a little forward speed to slip
  }
  step(_dt, ctx) {
    if (!this._drive) this._drive = new DifferentialDrive()
    const { leftPWM = 0, rightPWM = 0 } = ctx?.inputs ?? {}
    const { v, omega } = this._drive.compute(leftPWM, rightPWM)
    ctx.output = ctx.output ?? {}
    ctx.output.drive = { v: v * this._linSlip, omega: omega * this._turnBoost }
  }
  exit() { this._drive = null }
}
const SlipPhysics             = def('SlipPhysics', 'Slip physics')
const TerrainPhysics          = def('TerrainPhysics', 'Terrain interaction')
const RotorPhysics            = def('RotorPhysics', 'Rotor physics')
const FlightController        = def('FlightController', 'Flight controller')
const WindPhysics             = def('WindPhysics', 'Wind physics')
const BuoyancyPhysics         = def('BuoyancyPhysics', 'Buoyancy')
const ThrusterPhysics         = def('ThrusterPhysics', 'Thrusters')
const HydroDragPhysics        = def('HydroDragPhysics', 'Hydrodynamic drag')

// Capability modules
class JointConstraints extends JointPhysics {
  static key = 'JointConstraints'
  static label = 'Joint constraints'
}
const DrivePhysics            = def('DrivePhysics', 'Drive physics')
const IMUSim                  = def('IMUSim', 'IMU')
const RangeSensorSim          = def('RangeSensorSim', 'Range sensor')
const AnalogSensorSim         = def('AnalogSensorSim', 'Analog sensor')

const ALL = [
  WheelPhysics, MotorPhysics, DifferentialDrivePhysics,
  ServoPhysics, JointPhysics, InverseKinematics, BalanceSystem, GaitEngine,
  TrackPhysics, SlipPhysics, TerrainPhysics,
  RotorPhysics, FlightController, WindPhysics,
  BuoyancyPhysics, ThrusterPhysics, HydroDragPhysics,
  JointConstraints, DrivePhysics, IMUSim, RangeSensorSim, AnalogSensorSim,
]

export const MODULE_REGISTRY = Object.fromEntries(ALL.map(C => [C.key, C]))
