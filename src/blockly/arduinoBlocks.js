import * as Blockly from 'blockly'

// ──────────────────────────────────────────────────────────────────────────
// Custom Arduino blocks for the visual coding workspace.
// Standard blocks (logic / loops / math / text / variables) come from Blockly's
// built-in set; here we add the Arduino-specific hardware blocks and a toolbox.
// ──────────────────────────────────────────────────────────────────────────

const C_IO     = '#e67e22'   // pins / IO
const C_TIME   = '#16a085'   // timing
const C_SERIAL = '#2c98f0'   // serial
const C_SERVO  = '#9b59b6'   // servo

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
]

let _registered = false
export function defineArduinoBlocks() {
  if (_registered) return
  Blockly.defineBlocksWithJsonArray(CUSTOM_BLOCKS)
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
