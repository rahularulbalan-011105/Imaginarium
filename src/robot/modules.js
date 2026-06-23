// Physics module classes + registry. Every module implements the same interface
// so the runtime can load/step/unload them uniformly. Adding a new robot
// capability = add a class here + reference it from the loader's registries.
//
// In this first slice the locomotion modules are DESCRIPTIVE: the heavy physics
// still runs in DriveManager (selected by the blueprint's locomotion type), and
// these modules declare/describe what's active for the UI and future per-module
// execution. New-type modules (tracks/rotors/marine) are registered stubs.

export class PhysicsModule {
  static key = 'PhysicsModule'
  static label = 'Physics'
  enter(/* entity, world, blueprint */) {}
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
const DifferentialDrivePhysics = def('DifferentialDrivePhysics', 'Differential drive')
const ServoPhysics            = def('ServoPhysics', 'Servo physics')
const JointPhysics            = def('JointPhysics', 'Joint physics')
const InverseKinematics       = def('InverseKinematics', 'Inverse kinematics')
const BalanceSystem           = def('BalanceSystem', 'Balance system')
const GaitEngine              = def('GaitEngine', 'Gait engine')
const TrackPhysics            = def('TrackPhysics', 'Track physics')
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
