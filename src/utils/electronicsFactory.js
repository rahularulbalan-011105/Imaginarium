import * as THREE from 'three'
import { cloneModel, findRotorNode, detectRotorAxis, findEmissiveMeshes } from './modelLoader.js'

// ─── shared material helper ───────────────────────────────────────────────────
const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...opts })

// ─── Pin definitions (local-space positions) ─────────────────────────────────
// type: 'pwm' | 'digital' | 'analog' | 'gnd' | 'power'
// Positions are tuned to match the scaled GLB / procedural models

export const ARDUINO_PINS = {
  D2:   { x: -2.38 + 2*0.365, y: 0.62, z: 3.1,  color: 0xffcc00, type: 'digital', label: '~2'  },
  D3:   { x: -2.38 + 3*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~3'  },
  D4:   { x: -2.38 + 4*0.365, y: 0.62, z: 3.1,  color: 0xffcc00, type: 'digital', label: '4'   },
  D5:   { x: -2.38 + 5*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~5'  },
  D6:   { x: -2.38 + 6*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~6'  },
  D9:   { x: -2.38 + 9*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~9'  },
  D10:  { x: -2.38 +10*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~10' },
  D11:  { x: -2.38 +11*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~11' },
  '5V': { x: 2.12,            y: 0.62, z: -3.1, color: 0xff2222, type: 'power',   label: '5V'  },
  GND1: { x: 2.45,            y: 0.62, z: -3.1, color: 0x333333, type: 'gnd',     label: 'GND' },
  GND2: { x: 2.78,            y: 0.62, z: -3.1, color: 0x333333, type: 'gnd',     label: 'GND' },
}

export const MOTOR_PINS = {
  TERM_A: { x: -2.55, y: -0.25, z: 0, color: 0xff2222, type: 'power', label: '+' },
  TERM_B: { x: -2.55, y:  0.25, z: 0, color: 0x111111, type: 'gnd',   label: '−' },
}

export const LED_PINS = {
  ANODE:   { x: 0,  y: -0.55, z:  0.12, color: 0xff2222, type: 'power', label: '+' },
  CATHODE: { x: 0,  y: -0.55, z: -0.12, color: 0x333333, type: 'gnd',   label: '−' },
}

export const SERVO_PINS = {
  SIGNAL:  { x: -2.2, y: 0.4, z:  0.4, color: 0xff8800, type: 'pwm',   label: 'SIG' },
  VCC:     { x: -2.2, y: 0.4, z:  0,   color: 0xff2222, type: 'power', label: 'VCC' },
  GND:     { x: -2.2, y: 0.4, z: -0.4, color: 0x222222, type: 'gnd',   label: 'GND' },
}

// ─── Sensors & extra outputs ──────────────────────────────────────────────────
// Static pin layouts (used since these GLBs don't auto-compute dynamic pins).
// Pins sit in a small fanned row near the model so they're easy to click + wire.
export const IR_PINS = {
  OUT: { x:  0.7, y: -0.1, z: 1.2, color: 0xffcc00, type: 'digital', label: 'OUT' },
  GND: { x:  0.0, y: -0.1, z: 1.2, color: 0x333333, type: 'gnd',     label: 'GND' },
  VCC: { x: -0.7, y: -0.1, z: 1.2, color: 0xff2222, type: 'power',   label: 'VCC' },
}
export const ULTRASONIC_PINS = {
  VCC:  { x: -1.2, y: -0.2, z: 1.3, color: 0xff2222, type: 'power',   label: 'VCC'  },
  TRIG: { x: -0.4, y: -0.2, z: 1.3, color: 0xff8800, type: 'pwm',     label: 'TRIG' },
  ECHO: { x:  0.4, y: -0.2, z: 1.3, color: 0xffcc00, type: 'digital', label: 'ECHO' },
  GND:  { x:  1.2, y: -0.2, z: 1.3, color: 0x333333, type: 'gnd',     label: 'GND'  },
}
export const BUZZER_PINS = {
  SIGNAL: { x:  0.4, y: -0.1, z: 0.9, color: 0xff8800, type: 'pwm', label: 'I/O' },
  GND:    { x: -0.4, y: -0.1, z: 0.9, color: 0x333333, type: 'gnd', label: 'GND' },
}
export const OLED_PINS = {
  GND: { x: -1.2, y: -0.1, z: 1.1, color: 0x333333, type: 'gnd',     label: 'GND' },
  VCC: { x: -0.4, y: -0.1, z: 1.1, color: 0xff2222, type: 'power',   label: 'VCC' },
  SCL: { x:  0.4, y: -0.1, z: 1.1, color: 0x66aaff, type: 'digital', label: 'SCL' },
  SDA: { x:  1.2, y: -0.1, z: 1.1, color: 0x66aaff, type: 'digital', label: 'SDA' },
}
export const GAS_PINS = {
  VCC: { x: -1.2, y: -0.1, z: 1.2, color: 0xff2222, type: 'power',   label: 'VCC' },
  GND: { x: -0.4, y: -0.1, z: 1.2, color: 0x333333, type: 'gnd',     label: 'GND' },
  DO:  { x:  0.4, y: -0.1, z: 1.2, color: 0xffcc00, type: 'digital', label: 'DO'  },
  AO:  { x:  1.2, y: -0.1, z: 1.2, color: 0x22cc88, type: 'analog',  label: 'AO'  },
}

// SUBO board (custom ESP32-S3). Pins use the real silk labels IO1..IO21 from the
// Subo Arduino library; the simulator resolves IOn → GPIO via pinNameToNumber.
const SUBO_ADC = new Set(['IO1', 'IO5', 'IO8', 'IO11', 'IO12', 'IO17', 'IO19', 'IO20', 'IO21'])
const suboPinStyle = (io) => SUBO_ADC.has(io)
  ? { color: 0x22cc88, type: 'analog' }   // ADC-capable
  : { color: 0xff8800, type: 'pwm' }      // PWM-capable digital out

// Static fallback layout (used only if the GLB is missing; GLB path auto-places).
// Each IO is a 3-pin S / 5V / G connector — IO1–IO4 left edge, IO5–IO8 right edge.
export const SUBO_PINS = (() => {
  const pins = {}
  const add = (io, x, z) => {
    pins[io]        = { x,        y: 0.55, z, label: io,   ...suboPinStyle(io) }
    pins[`${io}_V`] = { x,        y: 0.55, z: z + 0.45, color: 0xff2222, type: 'power', label: '5V' }
    pins[`${io}_G`] = { x,        y: 0.55, z: z + 0.90, color: 0x333333, type: 'gnd',   label: 'G'  }
  }
  const zs = [-2.1, -0.7, 0.7, 2.1]
  ;['IO1','IO2','IO3','IO4'].forEach((io, i) => add(io, -3.0, zs[i]))
  ;['IO5','IO6','IO7','IO8'].forEach((io, i) => add(io,  2.1, zs[i]))
  return pins
})()

export const PIN_DEFS = {
  arduino:  ARDUINO_PINS,
  subo:     SUBO_PINS,
  motor:    MOTOR_PINS,
  motor_bo: MOTOR_PINS,
  motor_dc: MOTOR_PINS,
  led:      LED_PINS,
  servo:    SERVO_PINS,
  ir_sensor:  IR_PINS,
  ultrasonic: ULTRASONIC_PINS,
  buzzer:     BUZZER_PINS,
  oled:       OLED_PINS,
  gas_sensor: GAS_PINS,
}

const PIN_SPHERE_R = 0.17

// Label offset: above pin for Arduino, to the left for motor/led terminals
const LABEL_OFFSET = {
  arduino:  { dx: 0, dy: 0.55, dz: 0 },
  motor:    { dx: -0.85, dy: 0, dz: 0 },
  motor_bo: { dx: -0.85, dy: 0, dz: 0 },
  motor_dc: { dx: -0.85, dy: 0, dz: 0 },
  led:      { dx: -0.6,  dy: 0, dz: 0 },
  servo:    { dx: -0.85, dy: 0, dz: 0 },
}

// Create a canvas-texture sprite label for a pin
function createPinLabelSprite(text, color) {
  const W = 128, H = 30, S = 2
  const canvas = document.createElement('canvas')
  canvas.width  = W * S
  canvas.height = H * S
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'rgba(5, 5, 18, 0.82)'
  const r = 7 * S, w = W * S, h = H * S
  ctx.beginPath()
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r)
  ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r)
  ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r)
  ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath(); ctx.fill()

  const tc = new THREE.Color(color)
  const brightness = tc.r * 0.299 + tc.g * 0.587 + tc.b * 0.114
  ctx.fillStyle = brightness < 0.25 ? '#aaaacc' : '#' + tc.getHexString()
  ctx.font = `bold ${11 * S}px "Courier New", monospace`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2)

  const tex = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.65, depthWrite: false, sizeAttenuation: true,
  }))
  sprite.scale.set(1.05, 0.25, 1)
  sprite.userData.isPinLabel = true
  return sprite
}

export function addPinSpheresToGroup(group, componentId, type) {
  // GLB-loaded Arduino has dynamic pins computed from its actual geometry
  const defs = (group.userData.dynamicPins) ? group.userData.dynamicPins : PIN_DEFS[type]
  if (!defs) return
  const offset = group.userData.labelOffset ?? LABEL_OFFSET[type] ?? { dx: 0, dy: 0.55, dz: 0 }

  for (const [pinName, def] of Object.entries(defs)) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(PIN_SPHERE_R, 12, 12),
      new THREE.MeshStandardMaterial({
        color: def.color, emissive: new THREE.Color(0x000000),
        roughness: 0.3, metalness: 0.4,
        transparent: true, opacity: 0.55, depthWrite: false,
      })
    )
    sphere.position.set(def.x, def.y, def.z)
    sphere.userData.isPinSphere   = true
    sphere.userData.pinId         = `${componentId}:${pinName}`
    sphere.userData.rootId        = componentId
    sphere.userData.componentId   = componentId
    sphere.userData.pinName       = pinName
    sphere.userData.pinType       = def.type
    sphere.userData.pinLabel      = def.label
    sphere.userData.pinColor      = def.color
    group.add(sphere)

    const label = createPinLabelSprite(def.label, def.color)
    label.position.set(def.x + offset.dx, def.y + offset.dy, def.z + offset.dz)
    label.userData.isPinLabel = true
    label.userData.pinId      = `${componentId}:${pinName}`
    label.userData.rootId     = componentId
    group.add(label)
  }
}

// ─── Arduino Uno ─────────────────────────────────────────────────────────────

export function createArduinoGroup() {
  const glbScene = cloneModel('arduino')
  if (glbScene) return buildArduinoFromGLB(glbScene)
  return buildArduinoProcedural()
}

function buildArduinoFromGLB(scene) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })

  root.updateMatrixWorld(true)
  const box  = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())

  // Sort axes by dimension:
  //   thinAxis = board PCB thickness  (smallest)
  //   medAxis  = board width          (middle) — pin ROWS run parallel to this edge
  //   longAxis = board length         (largest) — pins are SPACED along this axis
  //
  // Arduino Uno pin layout:
  //   • Digital row  (D0-D13): one long edge  → medAxis = box.max[medAxis]
  //   • Power row (5V/GND):    other long edge → medAxis = box.min[medAxis]
  //   Both rows span the full board LENGTH (longAxis).
  const sorted = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])
  const thinAxis = sorted[0][0]
  const medAxis  = sorted[1][0]
  const longAxis = sorted[2][0]

  // Slightly above the top face of the board
  const above = box.max[thinAxis] + 0.32

  // Digital pin row sits at the MAX medAxis edge; power at MIN
  const digRow = box.max[medAxis] - 0.1
  const pwrRow = box.min[medAxis] + 0.1

  // Spread pins from ~12% to ~88% of the board's long dimension
  const longMin  = box.min[longAxis]
  const longSpan = size[longAxis]

  const PWM = new Set([3, 5, 6, 9, 10, 11])
  const pins = {}

  // D2–D11 (10 pins) spaced along the long edge
  for (let i = 2; i <= 11; i++) {
    const t = (i - 2) / 9                          // 0 → 1
    const p = { x: 0, y: 0, z: 0 }
    p[longAxis] = longMin + longSpan * (0.12 + t * 0.76)
    p[medAxis]  = digRow
    p[thinAxis] = above
    pins[`D${i}`] = {
      ...p,
      color: PWM.has(i) ? 0xff8800 : 0xffcc00,
      type:  PWM.has(i) ? 'pwm' : 'digital',
      label: PWM.has(i) ? `~${i}` : `${i}`,
    }
  }

  // 5V + two GND pins along the opposite long edge
  const pwrDefs = [
    { name: '5V',   t: 0.20, color: 0xff2222, type: 'power', label: '5V'  },
    { name: 'GND1', t: 0.40, color: 0x444444, type: 'gnd',   label: 'GND' },
    { name: 'GND2', t: 0.60, color: 0x444444, type: 'gnd',   label: 'GND' },
  ]
  for (const { name, t, color, type, label } of pwrDefs) {
    const p = { x: 0, y: 0, z: 0 }
    p[longAxis] = longMin + longSpan * t
    p[medAxis]  = pwrRow
    p[thinAxis] = above
    pins[name] = { ...p, color, type, label }
  }

  root.userData.dynamicPins = pins

  // Labels float away from the board face (thinAxis direction)
  const lo = { dx: 0, dy: 0, dz: 0 }
  if (thinAxis === 'x') lo.dx = 0.55
  else if (thinAxis === 'z') lo.dz = 0.55
  else lo.dy = 0.55
  root.userData.labelOffset = lo

  return root
}

function buildArduinoProcedural() {
  const root = new THREE.Group()

  const board = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.22, 6.8), mat(0x006633, { roughness: 0.8 }))
  root.add(board)

  const silk = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.01, 6.2), mat(0xffffff, { roughness: 1, opacity: 0.12, transparent: true }))
  silk.position.y = 0.115
  root.add(silk)

  const chip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 1.4), mat(0x111111))
  chip.position.set(0.4, 0.2, 0.3)
  root.add(chip)

  const xtal = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 12), mat(0xccccaa, { metalness: 0.7 }))
  xtal.position.set(-0.7, 0.3, 0.3)
  root.add(xtal)

  const usb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), mat(0x999999, { metalness: 0.8, roughness: 0.2 }))
  usb.position.set(-1.2, 0.2, -3.4)
  root.add(usb)

  const dcJack = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.65, 16), mat(0x111111))
  dcJack.rotation.x = Math.PI / 2; dcJack.position.set(1.5, 0.22, -3.5)
  root.add(dcJack)

  const btn = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.28), mat(0x222222))
  btn.position.set(-2.2, 0.22, 1.5)
  root.add(btn)

  const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat(0x00ff44, { emissive: 0x00aa22, roughness: 0.3 }))
  led.position.set(1.8, 0.26, 2.3)
  root.add(led)

  const pinHeaderD = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.2, 0.3), mat(0x111111))
  pinHeaderD.position.set(0, 0.2, 3.1)
  root.add(pinHeaderD)
  for (let i = 0; i < 14; i++) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.45, 8), mat(0xcccccc, { metalness: 0.9 }))
    pin.position.set(-2.38 + i * 0.365, 0.38, 3.1)
    root.add(pin)
  }

  const pinHeaderP = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, 0.3), mat(0x111111))
  pinHeaderP.position.set(1.9, 0.2, -3.1)
  root.add(pinHeaderP)
  for (let i = 0; i < 6; i++) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.45, 8), mat(0xcccccc, { metalness: 0.9 }))
    pin.position.set(1.13 + i * 0.33, 0.38, -3.1)
    root.add(pin)
  }

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── SUBO board (custom ESP32) ───────────────────────────────────────────────

export function createSuboGroup() {
  const glbScene = cloneModel('subo')
  if (glbScene) return buildSuboFromGLB(glbScene)
  return buildSuboProcedural()
}

// Connectors broken out to the side headers, each a 3-pin S / 5V / G group
// (servo-style, matching the silk). Signal key = IOn so it resolves to its GPIO.
const SUBO_CONNECTORS_LEFT  = ['IO1', 'IO2', 'IO3', 'IO4']
const SUBO_CONNECTORS_RIGHT = ['IO5', 'IO6', 'IO7', 'IO8']

function buildSuboFromGLB(scene) {
  // preloadModels' scaleAndCenter normalises the whole board to the configured
  // target size. root stays at scale 1 so pin spheres added to it land in true
  // world coordinates (scaling root here would double-transform them).
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  root.updateMatrixWorld(true)

  // Anchor pins to the PCB mesh bounds (not the whole model's bbox, which can be
  // inflated by stray geometry and would fling the pins off the board).
  let pcb = null
  root.traverse(c => { if (c.isMesh && /pcb/i.test(c.name) && !pcb) pcb = c })
  const box  = new THREE.Box3().setFromObject(pcb ?? root)
  const size = box.getSize(new THREE.Vector3())
  const sorted = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])
  const thinAxis = sorted[0][0]   // thickness
  const medAxis  = sorted[1][0]   // shorter dim (connectors spread along this)
  const longAxis = sorted[2][0]   // longer dim — headers on the left/right wings

  const above   = box.max[thinAxis] + 0.25
  const medMin  = box.min[medAxis]
  const medSpan = size[medAxis]
  const pins = {}

  // A 3-pin connector (S / 5V / G), pins spaced inward from the wing edge.
  const placeConnector = (io, side, t) => {
    const edge   = side < 0 ? box.min[longAxis] + 0.3 : box.max[longAxis] - 0.3
    const inward = side < 0 ? +1 : -1
    const medPos = medMin + medSpan * t
    const trio = [
      { key: io,        off: 0.0, label: io,   ...suboPinStyle(io) },
      { key: `${io}_V`, off: 0.6, label: '5V', color: 0xff2222, type: 'power' },
      { key: `${io}_G`, off: 1.2, label: 'G',  color: 0x333333, type: 'gnd' },
    ]
    for (const pin of trio) {
      const p = { x: 0, y: 0, z: 0 }
      p[longAxis] = edge + inward * pin.off
      p[medAxis]  = medPos
      p[thinAxis] = above
      pins[pin.key] = { ...p, color: pin.color, type: pin.type, label: pin.label }
    }
  }
  const ts = [0.15, 0.38, 0.62, 0.85]
  SUBO_CONNECTORS_LEFT.forEach((io, i)  => placeConnector(io, -1, ts[i]))
  SUBO_CONNECTORS_RIGHT.forEach((io, i) => placeConnector(io, +1, ts[i]))

  root.userData.dynamicPins = pins
  const lo = { dx: 0, dy: 0, dz: 0 }
  if (thinAxis === 'x') lo.dx = 0.5
  else if (thinAxis === 'z') lo.dz = 0.5
  else lo.dy = 0.5
  root.userData.labelOffset = lo

  return root
}

function buildSuboProcedural() {
  const root = new THREE.Group()
  const board = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.22, 4.0), mat(0x0b0b14, { roughness: 0.7 }))
  root.add(board)
  // 6×8 LED matrix hint
  const matrix = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 1.8), mat(0x1a1a22, { roughness: 1 }))
  matrix.position.y = 0.12
  root.add(matrix)
  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── DC Motor ────────────────────────────────────────────────────────────────

export function createMotorGroup() {
  const glbScene = cloneModel('motor')
  if (glbScene) return buildMotorFromGLB(glbScene)
  return buildMotorProcedural()
}

// Confirmed default shaft mesh names per GLB model (set by the user after testing)
const DEFAULT_SHAFT = {
  motor_bo: 'Object_24',
  // motor_dc: add here once confirmed
}

export function createMotorBOGroup() {
  const glbScene = cloneModel('motor_bo')
  if (glbScene) return buildMotorFromGLB(glbScene, DEFAULT_SHAFT.motor_bo)
  return buildMotorProcedural()
}

export function createMotorDCGroup() {
  const glbScene = cloneModel('motor_dc')
  if (glbScene) return buildMotorFromGLB(glbScene, DEFAULT_SHAFT.motor_dc)
  return buildMotorProcedural()
}

// Creates a world-aligned virtual Group at the shaft tip that props attach to.
// The shaft MESH spins directly (no reparenting = no GLB visual artifacts).
// The virtual GROUP also spins — props parented to it spin with no scale inheritance.
function setupRotorGroup(root, rotorNode, rotorAxis) {
  rotorNode.updateMatrixWorld(true)
  const box  = new THREE.Box3().setFromObject(rotorNode)
  const size = box.getSize(new THREE.Vector3())

  // Shaft tip = the extreme point of the shaft in its elongation direction
  const tipPos = box.getCenter(new THREE.Vector3())
  tipPos[rotorAxis] = box.max[rotorAxis]          // e.g. max.y for a vertical shaft

  // Virtual attachment group: direct child of root → no GLB scale inheritance
  // Remove any previously created virtual group first
  if (root.userData.rotorGroup && !root.userData.rotorGroup.isMesh) {
    root.remove(root.userData.rotorGroup)
  }
  const vGroup = new THREE.Group()
  vGroup.position.copy(tipPos)                    // world-space tip position
  root.add(vGroup)

  root.userData.rotorMesh        = rotorNode      // the shaft mesh to spin visually
  root.userData.rotorGroup       = vGroup         // virtual group for prop attachment
  root.userData.rotorAxis        = rotorAxis
  root.userData.currentRotorName = rotorNode.name
}

function buildMotorFromGLB(scene, defaultShaftName = null) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })

  root.updateMatrixWorld(true)

  // Collect all mesh names so the user can manually pick the shaft in the UI
  const motorMeshNames = []
  root.traverse(c => { if (c.isMesh && c.name) motorMeshNames.push(c.name) })
  root.userData.motorMeshNames = motorMeshNames

  // Use the confirmed default shaft name if provided, otherwise fall back to auto-detect
  let rotorNode = null
  if (defaultShaftName) {
    root.traverse(c => { if (c.isMesh && c.name === defaultShaftName) rotorNode = c })
  }
  if (!rotorNode) rotorNode = findRotorNode(root)

  if (rotorNode) {
    const rotorAxis = detectRotorAxis(rotorNode)
    setupRotorGroup(root, rotorNode, rotorAxis)
  } else {
    root.userData.rotorMesh        = null
    root.userData.rotorGroup       = null
    root.userData.currentRotorName = null
  }

  return root
}

function buildMotorProcedural() {
  const root = new THREE.Group()

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.8, 32), mat(0x445566, { metalness: 0.55, roughness: 0.4 }))
  body.rotation.z = Math.PI / 2
  root.add(body)

  for (const side of [-1, 1]) {
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 1.8), mat(0x334455, { metalness: 0.5 }))
    tab.position.set(0, side * 0.95, 0)
    root.add(tab)
  }

  const backCap = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.15, 32), mat(0x223344, { metalness: 0.6 }))
  backCap.rotation.z = Math.PI / 2; backCap.position.x = -1.42
  root.add(backCap)

  const frontBearing = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.35, 24), mat(0x778899, { metalness: 0.7 }))
  frontBearing.rotation.z = Math.PI / 2; frontBearing.position.x = 1.55
  root.add(frontBearing)

  for (let i = 0; i < 6; i++) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), mat(0x111111))
    const angle = (i / 6) * Math.PI * 2
    vent.position.set(-1.52, Math.sin(angle) * 0.55, Math.cos(angle) * 0.55)
    vent.rotation.z = Math.PI / 2
    root.add(vent)
  }

  for (const [idx, color] of [[0, 0xff2222], [1, 0x111111]]) {
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.9, 8), mat(color))
    lead.rotation.z = Math.PI / 2; lead.position.set(-2.1, (idx - 0.5) * 0.5, 0)
    root.add(lead)
  }

  // ── Rotor group (shaft + indicator blades) ────────────────────────────────
  const rotorGroup = new THREE.Group()

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 12), mat(0xddddcc, { metalness: 0.9, roughness: 0.15 }))
  shaft.rotation.z = Math.PI / 2; shaft.position.x = 2.2
  rotorGroup.add(shaft)

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0x441100, roughness: 0.5, metalness: 0.1 })
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.18), bladeMat)
    blade.position.x = 2.95; blade.rotation.x = (i / 3) * Math.PI * 2
    rotorGroup.add(blade)
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 16), mat(0xcccccc, { metalness: 0.8 }))
  hub.rotation.z = Math.PI / 2; hub.position.x = 2.95
  rotorGroup.add(hub)

  root.add(rotorGroup)
  root.userData.rotorGroup = rotorGroup
  root.userData.rotorAxis  = 'x'   // shaft lies along X (rotation.z = π/2 above)

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── LED ─────────────────────────────────────────────────────────────────────

export function createLEDGroup(color = '#ff0000') {
  const glbScene = cloneModel('led')
  if (glbScene) return buildLEDFromGLB(glbScene, color)
  return buildLEDProcedural(color)
}

function buildLEDFromGLB(scene, color) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })

  const emissiveMeshes = findEmissiveMeshes(root)
  for (const mesh of emissiveMeshes) {
    if (mesh.material) {
      mesh.material.emissive = new THREE.Color(0x000000)
      mesh.material.emissiveIntensity = 0
    }
  }
  root.userData.emissiveMeshes = emissiveMeshes
  root.userData.ledColor = color
  return root
}

function buildLEDProcedural(color) {
  const root = new THREE.Group()

  // Body (metal base)
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.65, 16),
    mat(0x999999, { metalness: 0.7, roughness: 0.3 })
  )
  body.position.y = 0.1
  root.add(body)

  // Dome (the glowing part)
  const domeMat = new THREE.MeshStandardMaterial({
    color, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85,
    emissive: new THREE.Color(0x000000), emissiveIntensity: 0,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat)
  dome.position.y = 0.425
  dome.name = 'dome'
  root.add(dome)

  // Anode lead (longer, +)
  const anode = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.65, 8),
    mat(0xcccccc, { metalness: 0.9 })
  )
  anode.position.set(0, -0.225, 0.12)
  root.add(anode)

  // Cathode lead (shorter, −)
  const cathode = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8),
    mat(0xcccccc, { metalness: 0.9 })
  )
  cathode.position.set(0, -0.15, -0.12)
  root.add(cathode)

  root.userData.emissiveMeshes = [dome]
  root.userData.ledColor = color

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── Servo ───────────────────────────────────────────────────────────────────

export function createServoGroup() {
  const glbScene = cloneModel('servo')
  if (glbScene) return buildServoFromGLB(glbScene)
  return buildServoProcedural()
}

function buildServoFromGLB(scene) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  root.updateMatrixWorld(true)

  // Pass 1 — keyword match on mesh name
  let rotorNode = null
  root.traverse(c => {
    if (!rotorNode && c.isMesh) {
      const n = c.name.toLowerCase()
      if (['horn','arm','servo_horn','output_shaft','output','lever','rotor','shaft','gear'].some(k => n.includes(k)))
        rotorNode = c
    }
  })

  // Pass 2 — geometric: topmost non-body mesh (output shaft / horn sits on top)
  if (!rotorNode) {
    root.updateMatrixWorld(true)
    const meshes = []
    root.traverse(c => { if (c.isMesh) { c.updateMatrixWorld(true); meshes.push(c) } })

    if (meshes.length > 1) {
      // Body = largest-volume mesh
      let maxVol = 0, bodyMesh = null
      for (const c of meshes) {
        const s = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3())
        const vol = s.x * s.y * s.z
        if (vol > maxVol) { maxVol = vol; bodyMesh = c }
      }
      // Among the rest, take the one with the highest Y bounding-box center
      let topY = -Infinity
      for (const c of meshes) {
        if (c === bodyMesh) continue
        const cy = new THREE.Box3().setFromObject(c).getCenter(new THREE.Vector3()).y
        if (cy > topY) { topY = cy; rotorNode = c }
      }
    } else if (meshes.length === 1) {
      rotorNode = meshes[0]
    }
  }

  if (rotorNode) {
    // Servo output shaft always spins around Y.
    // Use a pivot wrapper so the horn rotates around its own bounding-box center
    // (not around some arbitrary mesh local origin from the GLB export).
    _setupServoPivot(root, rotorNode)
  } else {
    root.userData.rotorMesh  = null
    root.userData.rotorGroup = null
    root.userData.rotorAxis  = 'y'
  }
  root.userData.isServo = true
  return root
}

// Creates a pivot Group centred on the horn mesh and reparents the horn into it.
// Rotating pivotGroup.rotation.y spins the horn around the output shaft axis.
function _setupServoPivot(root, rotorNode) {
  root.updateMatrixWorld(true)
  rotorNode.updateMatrixWorld(true)

  // World-space bounding box centre of the horn → convert to root-local
  const worldCenter = new THREE.Box3().setFromObject(rotorNode).getCenter(new THREE.Vector3())
  const localCenter = worldCenter.clone().applyMatrix4(
    new THREE.Matrix4().copy(root.matrixWorld).invert()
  )

  // Snapshot the horn's world transform before reparenting
  const worldMat = rotorNode.matrixWorld.clone()
  rotorNode.removeFromParent()

  // Pivot group at horn centre (child of root)
  const pivot = new THREE.Group()
  pivot.position.copy(localCenter)
  root.add(pivot)
  pivot.add(rotorNode)
  pivot.updateMatrixWorld(true)

  // Restore horn's local transform relative to the new pivot
  const localMat = new THREE.Matrix4().copy(pivot.matrixWorld).invert().multiply(worldMat)
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  localMat.decompose(p, q, s)
  rotorNode.position.copy(p)
  rotorNode.quaternion.copy(q)
  rotorNode.scale.copy(s)

  // rotorMesh = null so animateServo only rotates the pivot group, not the mesh twice
  root.userData.rotorMesh        = null
  root.userData.rotorGroup       = pivot
  root.userData.rotorAxis        = 'y'
  root.userData.currentRotorName = rotorNode.name
}

function buildServoProcedural() {
  const root = new THREE.Group()

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.6, 3.0),
    mat(0x2a3540, { metalness: 0.3, roughness: 0.6 })
  )
  root.add(body)

  // Top mounting flange
  const flange = new THREE.Mesh(
    new THREE.BoxGeometry(2.9, 0.22, 1.1),
    mat(0x1e2830, { metalness: 0.4 })
  )
  flange.position.set(0, 0.9, 0.5)
  root.add(flange)

  // Output shaft housing
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.35, 16),
    mat(0x111111, { metalness: 0.6 })
  )
  housing.position.set(0, 1.0, 0.4)
  root.add(housing)

  // Horn group (rotates to servo angle)
  const hornGroup = new THREE.Group()
  hornGroup.position.set(0, 1.25, 0.4)

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16),
    mat(0xeeeeee, { metalness: 0.2 })
  )
  hornGroup.add(hub)

  // Cross arms
  const armH = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.2), mat(0xfafafa))
  hornGroup.add(armH)
  const armV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 1.6), mat(0xfafafa))
  hornGroup.add(armV)

  // Small circles at arm tips
  for (const [px, pz] of [[0.8,0],[-0.8,0],[0,0.8],[0,-0.8]]) {
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), mat(0xdddddd))
    dot.position.set(px, 0, pz)
    hornGroup.add(dot)
  }

  root.add(hornGroup)
  root.userData.rotorGroup = hornGroup
  root.userData.rotorMesh  = hornGroup
  root.userData.rotorAxis  = 'y'
  root.userData.isServo    = true

  // Wire connector block
  const conn = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.6, 1.4),
    mat(0x111111, { metalness: 0.4 })
  )
  conn.position.set(-1.6, 0.1, 0)
  root.add(conn)

  // Three wires: orange (signal), red (VCC), brown (GND)
  for (const [i, color] of [[0, 0xff6600], [1, 0xff2222], [2, 0x332200]]) {
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8),
      mat(color)
    )
    wire.rotation.z = Math.PI / 2
    wire.position.set(-2.05, 0.1, (i - 1) * 0.4)
    root.add(wire)
  }

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── Wire helpers (unchanged) ─────────────────────────────────────────────────

export function buildWireControlPoints(from, to, _unused = 0, midOverride = null) {
  if (midOverride) return [from.clone(), midOverride.clone(), to.clone()]
  const mid = from.clone().lerp(to, 0.5)
  const d   = from.distanceTo(to)
  // Arch above the highest pin so wires never clip through geometry
  mid.y = Math.max(from.y, to.y) + Math.min(d * 0.14, 1.2) + 0.35
  return [from.clone(), mid, to.clone()]
}

const WIRE_RADIUS   = 0.045  // tube radius in scene units
const WIRE_RADSEGS  = 5      // polygon sides (pentagonal cross-section — cheap but round-looking)

export function buildWireLine(controlPoints, color, segments = 60) {
  const curve = new THREE.CatmullRomCurve3(controlPoints)
  const geo   = new THREE.TubeGeometry(curve, segments, WIRE_RADIUS, WIRE_RADSEGS, false)
  const mtr   = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
  const line  = new THREE.Mesh(geo, mtr)
  line.userData.isWire     = true
  line.userData.isWireLine = true
  return { line, curve }
}

export function rebuildWireLine(line, controlPoints, segments = 60) {
  // Skip degenerate curves (start === end or all points collapsed) — TubeGeometry
  // would compute zero-length tangents, producing NaN normals and potentially throwing.
  if (controlPoints[0].distanceTo(controlPoints[controlPoints.length - 1]) < 0.001) return
  const curve  = new THREE.CatmullRomCurve3(controlPoints)
  line.geometry.dispose()
  line.geometry = new THREE.TubeGeometry(curve, segments, WIRE_RADIUS, WIRE_RADSEGS, false)
  return curve
}

export function createWireLine(from, to) {
  const points   = [from.clone(), to.clone()]
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({ color: 0x44aaff, linewidth: 2 })
  const line     = new THREE.Line(geometry, material)
  line.userData.isWire = true
  return line
}

export function updateWireLine(line, from, to) {
  const pos = line.geometry.attributes.position
  pos.setXYZ(0, from.x, from.y, from.z)
  pos.setXYZ(1, to.x, to.y, to.z)
  pos.needsUpdate = true
}

// ─── Sensors & extra outputs (GLB-based) ──────────────────────────────────────
// All five use a preloaded GLB; pins come from the static PIN_DEFS above (added
// by wireManager.registerComponent → addPinSpheresToGroup). A simple box is used
// only if the GLB failed to load.
function buildModelComponent(name) {
  const root = new THREE.Group()
  const glb = cloneModel(name)
  if (glb) {
    root.add(glb)
  } else {
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1.4), mat(0x3a3a44)))
  }
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  return root
}

export function createIRSensorGroup()   { return buildModelComponent('ir_sensor') }
export function createUltrasonicGroup() { return buildModelComponent('ultrasonic') }
export function createBuzzerGroup()     { return buildModelComponent('buzzer') }
export function createGasSensorGroup()  { return buildModelComponent('gas_sensor') }
// Draw the OLED text buffer onto its canvas (black screen, cyan monospace text).
function drawOledCanvas(ctx, canvas, text) {
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = '#03060a'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#7ff0ff'
  ctx.textBaseline = 'top'
  ctx.font = 'bold 18px "Courier New", monospace'
  const lines = String(text ?? '').split('\n')
  let y = 8
  for (const ln of lines) { ctx.fillText(ln, 8, y, W - 14); y += 22; if (y > H) break }
}

// Add a glowing canvas "screen" plane over the OLED model's largest face and store
// an update(text) hook on userData.oledScreen so the simulation can write to it.
function attachOledScreen(root) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return
  const size   = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const thin   = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])[0][0]

  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 128
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  const planeMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false })
  const eps = 0.06
  let plane
  if (thin === 'z') {
    plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.84, size.y * 0.84), planeMat)
    plane.position.set(center.x, center.y, center.z + size.z / 2 + eps)
  } else if (thin === 'x') {
    plane = new THREE.Mesh(new THREE.PlaneGeometry(size.z * 0.84, size.y * 0.84), planeMat)
    plane.rotation.y = Math.PI / 2
    plane.position.set(center.x + size.x / 2 + eps, center.y, center.z)
  } else {
    plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.84, size.z * 0.84), planeMat)
    plane.rotation.x = -Math.PI / 2
    plane.position.set(center.x, center.y + size.y / 2 + eps, center.z)
  }
  plane.userData.isOledScreen = true
  root.add(plane)
  drawOledCanvas(ctx, canvas, '')
  tex.needsUpdate = true
  root.userData.oledScreen = { update: (t) => { drawOledCanvas(ctx, canvas, t); tex.needsUpdate = true } }
}

export function createOLEDGroup() {
  const r = buildModelComponent('oled')
  r.userData.isOled = true
  attachOledScreen(r)
  return r
}
