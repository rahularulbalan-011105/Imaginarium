// Browser-side half of tools/thumbs/render-thumbs.cjs: build each part exactly
// as the editor does (electronicsFactory / GLB cache), frame it from a fixed
// three-quarter view and return a transparent WebP thumbnail per part.
// Runs inside the Vite dev server so `three` and the app modules resolve as in
// the app.
import * as THREE from 'three'
import * as F from '../../src/utils/electronicsFactory.js'
import { ensureModels, cloneModel, modelKeyOf } from '../../src/utils/modelLoader.js'
import { createGeometry, createMaterial } from '../../src/utils/geometryFactory.js'
import { SHAPE_COLORS } from '../../src/utils/shapeColors.js'
import { isNonPhysical } from '../../src/managers/physics/robotics/sceneGraph.js'

const BUILDERS = {
  arduino: F.createArduinoGroup, subo: F.createSuboGroup, esp32: F.createEsp32Group,
  ultrasonic: F.createUltrasonicGroup, ir_sensor: F.createIRSensorGroup, gas_sensor: F.createGasSensorGroup,
  color_sensor: F.createColorSensorGroup, ldr_sensor: F.createLDRGroup, dht11: F.createDHT11Group,
  oled: F.createOLEDGroup, tft28: F.createTft28Group,
  servo: F.createServoGroup, motor_dc: F.createMotorDCGroup, motor_bo: F.createMotorBOGroup,
  motor_enc: F.createEncoderMotorGroup, servo_cr: F.createContinuousServoGroup, gripper: F.createGripperGroup,
  stepper: F.createStepperGroup, led: () => F.createLEDGroup('#ef4444'), buzzer: F.createBuzzerGroup,
  l298n: F.createL298NGroup, pca9685: F.createPca9685Group, uln2003: F.createUln2003Group,
}
const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'rectprism', 'torus', 'capsule', 'tetrahedron', 'octahedron', 'dodecahedron', 'prism', 'hexagon', 'pyramid', 'pentpyramid', 'plane']
for (const t of SHAPES) BUILDERS['shape_' + t] = () => {
  const m = new THREE.Mesh(createGeometry(t), createMaterial(SHAPE_COLORS[t]))
  if (t === 'plane') m.rotation.x = -Math.PI / 2
  return m
}
const WEAPONS = ['weapon_autocannon', 'weapon_shotgun', 'weapon_rocket', 'weapon_flame']

export async function renderThumbs(size = 160) {
  const keys = [...Object.keys(BUILDERS), ...WEAPONS]
  await ensureModels([...new Set(keys.filter((k) => !k.startsWith('shape_')).map(modelKeyOf))])

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(size, size)
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c4d6, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 8, 6); scene.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(-6, 3, -4); scene.add(rim)
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 1000)

  const out = {}
  for (const k of keys) {
    const obj = BUILDERS[k] ? BUILDERS[k]() : cloneModel(modelKeyOf(k))
    if (!obj) continue
    obj.traverse((n) => { if (isNonPhysical(n) || n.isSprite) n.visible = false; if (n.isMesh) n.frustumCulled = false })
    scene.add(obj)
    obj.updateMatrixWorld(true)
    // Frame on the 1st–99th percentile of the vertices, so a stray far-off piece
    // in a GLB (some exports carry one) can't shrink the part to a speck.
    const shown = (n) => { for (let p = n; p; p = p.parent) if (!p.visible) return false; return true }
    const xs = [], ys = [], zs = [], v = new THREE.Vector3()
    obj.traverse((n) => {
      if (!n.isMesh || !shown(n)) return
      const pos = n.geometry.attributes.position
      const step = Math.max(1, Math.floor(pos.count / 4000))
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld)
        xs.push(v.x); ys.push(v.y); zs.push(v.z)
      }
    })
    const q = (a, t) => { a.sort((m, n) => m - n); return a[Math.min(a.length - 1, Math.floor(t * a.length))] }
    const box = new THREE.Box3(
      new THREE.Vector3(q(xs, 0.01), q(ys, 0.01), q(zs, 0.01)),
      new THREE.Vector3(q(xs, 0.99), q(ys, 0.99), q(zs, 0.99)))
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const dir = new THREE.Vector3(1, 0.9, 1.25).normalize()
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.02
    camera.position.copy(sphere.center).addScaledVector(dir, dist)
    camera.near = dist / 100; camera.far = dist * 10
    camera.updateProjectionMatrix()
    camera.lookAt(sphere.center)
    renderer.render(scene, camera)
    out[k] = renderer.domElement.toDataURL('image/webp', 0.92)
    scene.remove(obj)
  }
  renderer.dispose()
  return out
}
