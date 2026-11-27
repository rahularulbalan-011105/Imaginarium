// ─────────────────────────────────────────────────────────────────────────────
// The ONE answer to "is this scene type an electronics part?" (and the sensor
// subset). Before this file the same list was copied into eight modules and the
// copies had drifted (printExport missed esp32/pca9685/gripper/colour/LDR…).
// Every module now imports from here; catalogue parts (src/parts) join
// automatically.
// ─────────────────────────────────────────────────────────────────────────────
import { onPartsRegistered } from '../parts/registry.js'

// Hand-built parts that predate the catalogue (their models/pins/sim live in
// electronicsFactory, ObjectManager and SimulationManager).
export const LEGACY_SENSOR_TYPES = ['ultrasonic', 'ir_sensor', 'gas_sensor', 'color_sensor', 'ldr_sensor', 'dht11',
  'pir_sensor', 'flame_sensor', 'soil_moisture', 'rain_sensor', 'sound_sensor', 'touch_sensor', 'bmp280', 'accelerometer', 'gyroscope', 'hall_sensor']
export const LEGACY_ELEC_TYPES = ['arduino', 'subo', 'esp32', 'motor', 'motor_bo', 'motor_dc', 'motor_enc', 'led', 'servo', 'servo_cr',
  'buzzer', 'oled', 'l298n', 'stepper', 'uln2003', 'pca9685', 'gripper', ...LEGACY_SENSOR_TYPES]

/** Every electronics type: legacy + catalogue (filled in as the catalogue chunk registers). */
export const ELECTRONICS_TYPES = new Set(LEGACY_ELEC_TYPES)
onPartsRegistered((p) => ELECTRONICS_TYPES.add(p.type))
export const isElectronicsType = (type) => ELECTRONICS_TYPES.has(type)
