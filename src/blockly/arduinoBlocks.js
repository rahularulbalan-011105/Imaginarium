import * as Blockly from 'blockly'
import { allParts } from '../parts/registry.js'
import { PART_CATEGORIES } from '../parts/definePart.js'

// ──────────────────────────────────────────────────────────────────────────
// Custom Arduino blocks for the visual coding workspace.
// Standard blocks (logic / loops / math / text / variables) come from Blockly's
// built-in set; here we add the Arduino-specific hardware blocks and a toolbox.
// ──────────────────────────────────────────────────────────────────────────

const C_IO     = '#e67e22'   // pins / IO
const C_TIME   = '#16a085'   // timing
const C_SERIAL = '#2c98f0'   // serial
const C_SERVO  = '#9b59b6'   // servo
const C_SENSOR = '#27ae60'   // sensors
const C_SUBO   = '#8e44ad'   // SUBO board

const pinField = (name = 'PIN', def = 13) => ({
  type: 'field_number', name, value: def, min: 0, max: 19, precision: 1,
})

const CUSTOM_BLOCKS = [
  {
    type: 'arduino_setup_loop',
    message0: 'Arduino %1 setup %2 %3 loop forever %4',
    args0: [
      { type: 'input_dummy' },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'SETUP' },
      { type: 'input_statement', name: 'LOOP' },
    ],
    colour: '#34495e',
    tooltip: 'Runs setup once, then loop repeatedly — the program entry point.',
  },
  {
    type: 'arduino_pinmode',
    message0: 'set pin %1 mode %2',
    args0: [pinField(), {
      type: 'field_dropdown', name: 'MODE',
      options: [['OUTPUT', 'OUTPUT'], ['INPUT', 'INPUT'], ['INPUT_PULLUP', 'INPUT_PULLUP']],
    }],
    previousStatement: null, nextStatement: null, colour: C_IO,
    tooltip: 'pinMode(pin, mode)',
  },
  {
    type: 'arduino_digitalwrite',
    message0: 'digital write pin %1 %2',
    args0: [pinField(), {
      type: 'field_dropdown', name: 'LEVEL', options: [['HIGH', 'HIGH'], ['LOW', 'LOW']],
    }],
    previousStatement: null, nextStatement: null, colour: C_IO,
    tooltip: 'digitalWrite(pin, HIGH/LOW)',
  },
  {
    type: 'arduino_digitalread',
    message0: 'digital read pin %1',
    args0: [pinField()],
    output: 'Boolean', colour: C_IO, tooltip: 'digitalRead(pin)',
  },
  {
    type: 'arduino_analogwrite',
    message0: 'analog write (PWM) pin %1 value %2',
    args0: [pinField('PIN', 3), { type: 'input_value', name: 'VALUE', check: 'Number' }],
    inputsInline: true, previousStatement: null, nextStatement: null, colour: C_IO,
    tooltip: 'analogWrite(pin, 0-255) — drives motor speed / LED brightness',
  },
  {
    type: 'arduino_analogread',
    message0: 'analog read pin %1',
    args0: [pinField('PIN', 0)],
    output: 'Number', colour: C_IO, tooltip: 'analogRead(pin)',
  },
  {
    type: 'arduino_delay',
    message0: 'wait %1 ms',
    args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
    inputsInline: true, previousStatement: null, nextStatement: null, colour: C_TIME,
    tooltip: 'delay(milliseconds)',
  },
  {
    type: 'arduino_serial_begin',
    message0: 'serial begin %1 baud',
    args0: [{
      type: 'field_dropdown', name: 'BAUD',
      options: [['9600', '9600'], ['115200', '115200'], ['57600', '57600']],
    }],
    previousStatement: null, nextStatement: null, colour: C_SERIAL,
    tooltip: 'Serial.begin(baud)',
  },
  {
    type: 'arduino_serial_print',
    message0: 'serial print %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    inputsInline: true, previousStatement: null, nextStatement: null, colour: C_SERIAL,
    tooltip: 'Serial.println(value)',
  },
  {
    type: 'arduino_servo_attach',
    message0: 'attach servo on pin %1',
    args0: [pinField('PIN', 9)],
    previousStatement: null, nextStatement: null, colour: C_SERVO,
    tooltip: 'Declare a servo and attach it to a pin (put this in setup).',
  },
  {
    type: 'arduino_servo_write',
    message0: 'servo pin %1 write angle %2',
    args0: [pinField('PIN', 9), { type: 'input_value', name: 'ANGLE', check: 'Number' }],
    inputsInline: true, previousStatement: null, nextStatement: null, colour: C_SERVO,
    tooltip: 'servo.write(angle) — rotate the attached arm.',
  },

  // ── Sensor library blocks (LDR / DHT11 / ColorSensor) ─────────────────────
  {
    type: 'arduino_read_ldr',
    message0: 'read LDR light on pin %1',
    args0: [pinField('PIN', 0)],
    output: 'Number', colour: C_SENSOR,
    tooltip: 'ldr.read() — ambient light 0 (dark) … 1023 (bright).',
  },
  {
    type: 'arduino_dht_temperature',
    message0: 'read temperature (°C) on pin %1',
    args0: [pinField('PIN', 2)],
    output: 'Number', colour: C_SENSOR,
    tooltip: 'dht.readTemperature() — DHT11 temperature in °C.',
  },
  {
    type: 'arduino_dht_humidity',
    message0: 'read humidity (%) on pin %1',
    args0: [pinField('PIN', 2)],
    output: 'Number', colour: C_SENSOR,
    tooltip: 'dht.readHumidity() — DHT11 relative humidity in %.',
  },
  {
    type: 'arduino_read_color',
    message0: 'read colour name on OUT pin %1',
    args0: [pinField('PIN', 8)],
    output: 'String', colour: C_SENSOR,
    tooltip: 'color.readColor() — detected colour name (e.g. "Red").',
  },

  // ── Module + I²C sensor blocks (PIR / flame / soil / rain / sound / touch /
  //    Hall read their pins; BMP280 + MPU6050 use their Arduino libraries) ───
  {
    type: 'sensor_pir_motion',
    message0: 'PIR motion detected on pin %1',
    args0: [pinField('PIN', 2)],
    output: 'Boolean', colour: C_SENSOR,
    tooltip: 'HC-SR501: OUT is HIGH while motion is seen (digitalRead(pin) == HIGH).',
  },
  {
    type: 'sensor_flame_detected',
    message0: 'flame detected on DO pin %1',
    args0: [pinField('PIN', 3)],
    output: 'Boolean', colour: C_SENSOR,
    tooltip: 'Flame module: DO goes LOW when a flame is seen (digitalRead(pin) == LOW).',
  },
  {
    type: 'sensor_soil_moisture',
    message0: 'soil moisture %% on AO pin %1',
    args0: [pinField('PIN', 4)],
    output: 'Number', colour: C_SENSOR,
    tooltip: 'YL-69: map(analogRead(pin), 1023, 0, 0, 100) — 0 % dry … 100 % wet.',
  },
  {
    type: 'sensor_rain_detected',
    message0: 'rain detected on DO pin %1',
    args0: [pinField('PIN', 5)],
    output: 'Boolean', colour: C_SENSOR,
    tooltip: 'FC-37: DO goes LOW when the plate is wet (digitalRead(pin) == LOW).',
  },
  {
    type: 'sensor_sound_detected',
    message0: 'loud sound on DO pin %1',
    args0: [pinField('PIN', 6)],
    output: 'Boolean', colour: C_SENSOR,
    tooltip: 'KY-038: DO goes HIGH on a sound louder than the trim-pot threshold.',
  },
  {
    type: 'sensor_sound_level',
    message0: 'sound level on AO pin %1',
    args0: [pinField('PIN', 6)],
    output: 'Number', colour: C_SENSOR,
    tooltip: 'KY-038: analogRead(pin) — about 512 when quiet, swings further with louder sound.',
  },
  {
    type: 'sensor_touch',
    message0: 'touch pad touched on pin %1',
    args0: [pinField('PIN', 7)],
    output: 'Boolean', colour: C_SENSOR,
    tooltip: 'TTP223: OUT is HIGH while a finger touches the pad.',
  },
  {
    type: 'sensor_hall_magnet',
    message0: 'magnet detected on pin %1',
    args0: [pinField('PIN', 8)],
    output: 'Boolean', colour: C_SENSOR,
    tooltip: 'A3144: OUT goes LOW when a magnet (south pole) is near (digitalRead(pin) == LOW).',
  },
  {
    type: 'sensor_bmp280_begin',
    message0: 'start BMP280 pressure sensor at %1',
    args0: [{ type: 'field_dropdown', name: 'ADDR', options: [['0x76 (SDO open)', '0x76'], ['0x77 (SDO → VCC)', '0x77']] }],
    previousStatement: null, nextStatement: null, colour: C_SENSOR,
    tooltip: 'bmp.begin(address) — put this in setup. Uses the Adafruit_BMP280 library.',
  },
  {
    type: 'sensor_bmp280_read',
    message0: 'BMP280 %1',
    args0: [{ type: 'field_dropdown', name: 'WHAT', options: [['pressure (hPa)', 'P'], ['temperature (°C)', 'T'], ['altitude (m)', 'A']] }],
    output: 'Number', colour: C_SENSOR,
    tooltip: 'Read the BMP280: pressure in hPa, temperature in °C or altitude in metres.',
  },
  {
    type: 'sensor_mpu6050_begin',
    message0: 'start MPU6050 (accelerometer + gyroscope)',
    previousStatement: null, nextStatement: null, colour: C_SENSOR,
    tooltip: 'Wire.begin(); mpu.begin(); mpu.calcOffsets(); — put this in setup (keep the board still). MPU6050_light library.',
  },
  {
    type: 'sensor_mpu6050_update',
    message0: 'update MPU6050 readings',
    previousStatement: null, nextStatement: null, colour: C_SENSOR,
    tooltip: 'mpu.update() — call once at the start of every loop.',
  },
  {
    type: 'sensor_mpu6050_read',
    message0: 'MPU6050 %1',
    args0: [{ type: 'field_dropdown', name: 'WHAT', options: [
      ['acceleration X (g)', 'getAccX'], ['acceleration Y (g)', 'getAccY'], ['acceleration Z (g)', 'getAccZ'],
      ['rotation X (°/s)', 'getGyroX'], ['rotation Y (°/s)', 'getGyroY'], ['rotation Z (°/s)', 'getGyroZ'],
      ['tilt angle X (°)', 'getAngleX'], ['tilt angle Y (°)', 'getAngleY'], ['turn angle Z (°)', 'getAngleZ'],
      ['temperature (°C)', 'getTemp'],
    ] }],
    output: 'Number', colour: C_SENSOR,
    tooltip: 'Read the MPU6050 (MPU6050_light): acceleration in g, rotation rate in °/s, angles in degrees.',
  },

  // ── SUBO board blocks (official Subo library API) ─────────────────────────
  {
    type: 'subo_matrix_init',
    message0: 'SUBO matrix init',
    previousStatement: null, nextStatement: null, colour: C_SUBO,
    tooltip: 'SuboMatrixInit() — call once in setup before any LED call.',
  },
  {
    type: 'subo_set_all_led',
    message0: 'SUBO fill matrix  R %1 G %2 B %3',
    args0: [
      { type: 'input_value', name: 'R', check: 'Number' },
      { type: 'input_value', name: 'G', check: 'Number' },
      { type: 'input_value', name: 'B', check: 'Number' },
    ],
    inputsInline: true, previousStatement: null, nextStatement: null, colour: C_SUBO,
    tooltip: 'setAllLED(r, g, b) — fill all 48 on-board LEDs.',
  },
  {
    type: 'subo_play_tone',
    message0: 'SUBO buzzer tone %1 Hz for %2 s',
    args0: [
      { type: 'input_value', name: 'F', check: 'Number' },
      { type: 'input_value', name: 'D', check: 'Number' },
    ],
    inputsInline: true, previousStatement: null, nextStatement: null, colour: C_SUBO,
    tooltip: 'playTone(frequency, duration-in-seconds).',
  },
  {
    type: 'subo_run_motor',
    message0: 'SUBO drive %1 speed %2',
    args0: [
      { type: 'field_dropdown', name: 'DIR', options: [['Forward', 'F'], ['Back', 'B'], ['Left', 'L'], ['Right', 'R'], ['Stop', 'S']] },
      { type: 'input_value', name: 'SPEED', check: 'Number' },
    ],
    inputsInline: true, previousStatement: null, nextStatement: null, colour: C_SUBO,
    tooltip: 'runMotor(dir, speed 0–255) — needs the motor-expansion board.',
  },
]

let _registered = false
export function defineArduinoBlocks() {
  if (_registered) return
  Blockly.defineBlocksWithJsonArray(CUSTOM_BLOCKS)
  // Catalogue parts' blocks (src/parts/catalog/**: part.blockly.blocks).
  const partBlocks = allParts().flatMap(p => p.blockly?.blocks ?? [])
  if (partBlocks.length) Blockly.defineBlocksWithJsonArray(partBlocks)
  _registered = true
}

// Toolbox (category flyout). Standard blocks reuse Blockly's built-in types.
export const ARDUINO_TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category', name: 'Pins / IO', colour: C_IO,
      contents: [
        { kind: 'block', type: 'arduino_pinmode' },
        { kind: 'block', type: 'arduino_digitalwrite' },
        { kind: 'block', type: 'arduino_digitalread' },
        {
          kind: 'block', type: 'arduino_analogwrite',
          inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 200 } } } },
        },
        { kind: 'block', type: 'arduino_analogread' },
      ],
    },
    {
      kind: 'category', name: 'Servo', colour: C_SERVO,
      contents: [
        { kind: 'block', type: 'arduino_servo_attach' },
        {
          kind: 'block', type: 'arduino_servo_write',
          inputs: { ANGLE: { shadow: { type: 'math_number', fields: { NUM: 90 } } } },
        },
      ],
    },
    {
      kind: 'category', name: 'Sensors', colour: C_SENSOR,
      contents: [
        { kind: 'block', type: 'arduino_read_ldr' },
        { kind: 'block', type: 'arduino_dht_temperature' },
        { kind: 'block', type: 'arduino_dht_humidity' },
        { kind: 'block', type: 'arduino_read_color' },
        { kind: 'block', type: 'sensor_pir_motion' },
        { kind: 'block', type: 'sensor_flame_detected' },
        { kind: 'block', type: 'sensor_soil_moisture' },
        { kind: 'block', type: 'sensor_rain_detected' },
        { kind: 'block', type: 'sensor_sound_detected' },
        { kind: 'block', type: 'sensor_sound_level' },
        { kind: 'block', type: 'sensor_touch' },
        { kind: 'block', type: 'sensor_hall_magnet' },
        { kind: 'block', type: 'sensor_bmp280_begin' },
        { kind: 'block', type: 'sensor_bmp280_read' },
        { kind: 'block', type: 'sensor_mpu6050_begin' },
        { kind: 'block', type: 'sensor_mpu6050_update' },
        { kind: 'block', type: 'sensor_mpu6050_read' },
      ],
    },
    {
      kind: 'category', name: 'SUBO', colour: C_SUBO,
      contents: [
        { kind: 'block', type: 'subo_matrix_init' },
        {
          kind: 'block', type: 'subo_set_all_led',
          inputs: {
            R: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
            G: { shadow: { type: 'math_number', fields: { NUM: 128 } } },
            B: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
          },
        },
        {
          kind: 'block', type: 'subo_play_tone',
          inputs: {
            F: { shadow: { type: 'math_number', fields: { NUM: 523 } } },
            D: { shadow: { type: 'math_number', fields: { NUM: 0.2 } } },
          },
        },
        {
          kind: 'block', type: 'subo_run_motor',
          inputs: { SPEED: { shadow: { type: 'math_number', fields: { NUM: 200 } } } },
        },
      ],
    },
    {
      kind: 'category', name: 'Timing', colour: C_TIME,
      contents: [{
        kind: 'block', type: 'arduino_delay',
        inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 500 } } } },
      }],
    },
    {
      kind: 'category', name: 'Serial', colour: C_SERIAL,
      contents: [
        { kind: 'block', type: 'arduino_serial_begin' },
        { kind: 'block', type: 'arduino_serial_print' },
      ],
    },
    {
      kind: 'category', name: 'Logic', colour: '210',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
      ],
    },
    {
      kind: 'category', name: 'Loops', colour: '120',
      contents: [
        {
          kind: 'block', type: 'controls_repeat_ext',
          inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } } },
        },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_for' },
      ],
    },
    {
      kind: 'category', name: 'Math', colour: '230',
      contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
      ],
    },
    {
      kind: 'category', name: 'Text', colour: '160',
      contents: [
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'text_print' },
      ],
    },
    {
      kind: 'category', name: 'Variables', colour: '330', custom: 'VARIABLE',
    },
  ],
}

// The toolbox plus one category per catalogue section that has blocks, placed
// after Sensors. Call once the catalogue is loaded (BlocksPanel awaits loadParts).
export function toolboxWithParts() {
  const toolbox = { ...ARDUINO_TOOLBOX, contents: [...ARDUINO_TOOLBOX.contents] }
  const groups = new Map()
  for (const p of allParts()) {
    const items = p.blockly?.toolbox ?? (p.blockly?.blocks ?? []).map(b => ({ kind: 'block', type: b.type }))
    if (!items.length) continue
    if (!groups.has(p.category)) groups.set(p.category, [])
    groups.get(p.category).push(...items)
  }
  const at = toolbox.contents.findIndex(c => c.name === 'Sensors') + 1
  const cats = PART_CATEGORIES.filter(c => groups.has(c.key)).map(c => ({
    kind: 'category', name: c.label, colour: c.color, contents: groups.get(c.key),
  }))
  toolbox.contents.splice(at, 0, ...cats)
  return toolbox
}
