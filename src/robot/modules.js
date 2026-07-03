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
const ServoPhysics            = def('ServoPhysics', 'Servo physics')
const JointPhysics            = def('JointPhysics', 'Joint physics')
const InverseKinematics       = def('InverseKinematics', 'Inverse kinematics')
const BalanceSystem           = def('BalanceSystem', 'Balance system')
const GaitEngine              = def('GaitEngine', 'Gait engine')
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
const JointConstraints        = def('JointConstraints', 'Joint constraints')
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
