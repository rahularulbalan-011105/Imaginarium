// ─────────────────────────────────────────────────────────────────────────────
// ArenaCameraModes — data-only definitions of the arena chase-camera modes.
//
// Mech-game framing (War Robots / Mech Arena / Armored Core), NOT FPS. Each mode
// is a pure record the ArenaCameraRig reads; switching modes just changes the
// target record and the rig blends (~300 ms) toward it. Add a mode = one entry.
//
// Fields:
//   distance   base spring-arm length behind the follow target (su)
//   height     base height above the follow target (su)
//   pitchDeg   downward look angle (° below horizon)
//   fov        vertical FOV (°); rig eases toward it
//   sideOffset lateral shoulder offset (su, + = right)
//   followYaw  true → arm swings behind the robot's heading; false → world-fixed
//   orbit      true → yaw/pitch driven by the mouse (free orbit around robot)
//   lookAhead  velocity look-ahead gain (0 = look at robot centre only)
//   armSmooth  follow/arm smoothing time (s) — smaller = snappier
// ─────────────────────────────────────────────────────────────────────────────

export const CAMERA_MODES = {
  // DEFAULT — third-person combat chase. The everyday view: behind + slightly
  // above, angled down, robot seated in the lower-middle of the frame. Medium
  // distance; tighter armSmooth so the camera stays glued behind the robot.
  default: {
    key: 'default', label: 'Combat',
    distance: 13, height: 6, pitchDeg: 17, fov: 70, sideOffset: 0,
    followYaw: true, orbit: false, lookAhead: 0.5, armSmooth: 0.15,
  },
  // F1 — CLOSE SHOULDER. Tighter, lower, more visceral.
  shoulder: {
    key: 'shoulder', label: 'Shoulder',
    distance: 8.5, height: 4.2, pitchDeg: 11, fov: 74, sideOffset: 2.2,
    followYaw: true, orbit: false, lookAhead: 0.7, armSmooth: 0.16,
  },
  // F2 — FAR TACTICAL. Higher and further to read the whole arena.
  tactical: {
    key: 'tactical', label: 'Tactical',
    distance: 24, height: 17, pitchDeg: 42, fov: 60, sideOffset: 0,
    followYaw: true, orbit: false, lookAhead: 0.3, armSmooth: 0.3,
  },
  // F3 — FREE ORBIT. Mouse rotates around the robot.
  orbit: {
    key: 'orbit', label: 'Orbit',
    distance: 15, height: 8, pitchDeg: 18, fov: 68, sideOffset: 0,
    followYaw: false, orbit: true, lookAhead: 0, armSmooth: 0.18,
  },
  // F4 — TOP DOWN. Strategy view, world-fixed north-up.
  topdown: {
    key: 'topdown', label: 'Top-Down',
    distance: 2, height: 34, pitchDeg: 86, fov: 52, sideOffset: 0,
    followYaw: false, orbit: false, lookAhead: 0.15, armSmooth: 0.26,
  },
}

// Which mode a function key selects (Default has no key — it's the base view and
// is reachable by pressing the active mode's key again, handled in the manager).
export const MODE_KEYS = {
  F1: 'shoulder',
  F2: 'tactical',
  F3: 'orbit',
  F4: 'topdown',
}

export const DEFAULT_MODE = 'default'
