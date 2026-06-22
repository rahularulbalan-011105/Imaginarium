import * as Blockly from 'blockly'

// ──────────────────────────────────────────────────────────────────────────
// Arduino C++ code generator for the block workspace.
// Adapted from the AtumX "cppGenerator" pattern (Blocks-AI-2.0): a custom
// Blockly.Generator whose forBlock[] functions emit Arduino C++ that the app's
// existing arduinoParser/SimulationManager already understands.
// ──────────────────────────────────────────────────────────────────────────

export const arduinoGenerator = new Blockly.Generator('Arduino')
arduinoGenerator.INDENT = '  '

// Operator precedence (lower binds tighter)
const Order = {
  ATOMIC: 0,
  UNARY: 4,
  MULTIPLICATIVE: 5,
  ADDITIVE: 6,
  RELATIONAL: 7,
  EQUALITY: 7,
  LOGICAL_NOT: 8,
  LOGICAL_AND: 9,
  LOGICAL_OR: 10,
  NONE: 99,
}
arduinoGenerator.ORDER_ATOMIC = Order.ATOMIC
arduinoGenerator.ORDER_NONE = Order.NONE

// Per-run scratch state: #includes, global definitions, loop-var counter.
arduinoGenerator.init = function (workspace) {
  this._workspace = workspace
  this.includes_ = new Set(['<Arduino.h>'])
  this.definitions_ = Object.create(null)
  this._loopVar = 0

  // Variable name database — required for getVariableName()
  if (!this.nameDB_) this.nameDB_ = new Blockly.Names(this.RESERVED_WORDS_ || '')
  else this.nameDB_.reset()
  this.nameDB_.setVariableMap(workspace.getVariableMap())
  this.nameDB_.populateVariables(workspace)
  this.nameDB_.populateProcedures(workspace)
}

// Assemble: includes + globals (variables + servos) + setup()/loop() code.
arduinoGenerator.finish = function (code) {
  // Declare every workspace variable as a global int
  const varDefs = []
  try {
    for (const v of Blockly.Variables.allUsedVarModels(this._workspace)) {
      varDefs.push(`int ${this.getVariableName(v.getId())} = 0;`)
    }
  } catch (_) { /* no variables */ }

  const includes = [...this.includes_].map(i => `#include ${i}`).join('\n')
  const defs = [...varDefs, ...Object.values(this.definitions_)].join('\n')

  this._workspace = null
  this.definitions_ = null
  this.includes_ = null
  this.nameDB_?.reset()

  return [includes, defs, code].filter(s => s && s.trim()).join('\n\n') + '\n'
}

// Append the code of statement blocks chained below this one.
arduinoGenerator.scrub_ = function (block, code, thisOnly) {
  const nextBlock = block.nextConnection && block.nextConnection.targetBlock()
  const nextCode = (!thisOnly && nextBlock) ? this.blockToCode(nextBlock) : ''
  return code + nextCode
}

const G = arduinoGenerator.forBlock

// ── Top container: setup() + loop() ─────────────────────────────────────────
G['arduino_setup_loop'] = function (block, gen) {
  const setup = gen.statementToCode(block, 'SETUP')
  const loop  = gen.statementToCode(block, 'LOOP')
  return `void setup() {\n${setup}}\n\nvoid loop() {\n${loop}}\n`
}

// ── Pins / IO ───────────────────────────────────────────────────────────────
G['arduino_pinmode'] = function (block) {
  return `pinMode(${block.getFieldValue('PIN')}, ${block.getFieldValue('MODE')});\n`
}
G['arduino_digitalwrite'] = function (block) {
  return `digitalWrite(${block.getFieldValue('PIN')}, ${block.getFieldValue('LEVEL')});\n`
}
G['arduino_digitalread'] = function (block) {
  return [`digitalRead(${block.getFieldValue('PIN')})`, Order.ATOMIC]
}
G['arduino_analogwrite'] = function (block, gen) {
  const val = gen.valueToCode(block, 'VALUE', Order.NONE) || '0'
  return `analogWrite(${block.getFieldValue('PIN')}, ${val});\n`
}
G['arduino_analogread'] = function (block) {
  return [`analogRead(${block.getFieldValue('PIN')})`, Order.ATOMIC]
}
G['arduino_delay'] = function (block, gen) {
  const ms = gen.valueToCode(block, 'MS', Order.NONE) || '0'
  return `delay(${ms});\n`
}

// ── Serial ──────────────────────────────────────────────────────────────────
G['arduino_serial_begin'] = function (block) {
  return `Serial.begin(${block.getFieldValue('BAUD')});\n`
}
G['arduino_serial_print'] = function (block, gen) {
  const v = gen.valueToCode(block, 'VALUE', Order.NONE) || '""'
  return `Serial.println(${v});\n`
}

// ── Servo ───────────────────────────────────────────────────────────────────
function ensureServo(gen, pin) {
  gen.includes_.add('<Servo.h>')
  gen.definitions_['servo_pin' + pin] = `Servo servo_pin${pin};`
}
G['arduino_servo_attach'] = function (block, gen) {
  const pin = block.getFieldValue('PIN')
  ensureServo(gen, pin)
  return `servo_pin${pin}.attach(${pin});\n`
}
G['arduino_servo_write'] = function (block, gen) {
  const pin = block.getFieldValue('PIN')
  ensureServo(gen, pin)
  const angle = gen.valueToCode(block, 'ANGLE', Order.NONE) || '0'
  return `servo_pin${pin}.write(${angle});\n`
}

// ── Logic ───────────────────────────────────────────────────────────────────
G['controls_if'] = function (block, gen) {
  let n = 0, code = ''
  do {
    const cond = gen.valueToCode(block, 'IF' + n, Order.NONE) || 'false'
    const branch = gen.statementToCode(block, 'DO' + n)
    code += `${n === 0 ? 'if' : ' else if'} (${cond}) {\n${branch}}`
    n++
  } while (block.getInput('IF' + n))
  if (block.getInput('ELSE')) {
    code += ` else {\n${gen.statementToCode(block, 'ELSE')}}`
  }
  return code + '\n'
}
const COMPARE = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' }
G['logic_compare'] = function (block, gen) {
  const op = COMPARE[block.getFieldValue('OP')]
  const order = (op === '==' || op === '!=') ? Order.EQUALITY : Order.RELATIONAL
  const a = gen.valueToCode(block, 'A', order) || '0'
  const b = gen.valueToCode(block, 'B', order) || '0'
  return [`${a} ${op} ${b}`, order]
}
G['logic_operation'] = function (block, gen) {
  const and = block.getFieldValue('OP') === 'AND'
  const op = and ? '&&' : '||'
  const order = and ? Order.LOGICAL_AND : Order.LOGICAL_OR
  const a = gen.valueToCode(block, 'A', order) || 'false'
  const b = gen.valueToCode(block, 'B', order) || 'false'
  return [`${a} ${op} ${b}`, order]
}
G['logic_negate'] = function (block, gen) {
  const a = gen.valueToCode(block, 'BOOL', Order.LOGICAL_NOT) || 'false'
  return [`!${a}`, Order.LOGICAL_NOT]
}
G['logic_boolean'] = function (block) {
  return [block.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', Order.ATOMIC]
}

// ── Loops ───────────────────────────────────────────────────────────────────
G['controls_repeat_ext'] = function (block, gen) {
  const times = gen.valueToCode(block, 'TIMES', Order.NONE) || '0'
  const v = '_i' + (gen._loopVar++)
  const branch = gen.statementToCode(block, 'DO')
  return `for (int ${v} = 0; ${v} < ${times}; ${v}++) {\n${branch}}\n`
}
G['controls_whileUntil'] = function (block, gen) {
  const until = block.getFieldValue('MODE') === 'UNTIL'
  let cond = gen.valueToCode(block, 'BOOL', until ? Order.LOGICAL_NOT : Order.NONE) || 'false'
  if (until) cond = `!(${cond})`
  const branch = gen.statementToCode(block, 'DO')
  return `while (${cond}) {\n${branch}}\n`
}
G['controls_for'] = function (block, gen) {
  const v = gen.getVariableName(block.getFieldValue('VAR'))
  const from = gen.valueToCode(block, 'FROM', Order.NONE) || '0'
  const to   = gen.valueToCode(block, 'TO', Order.NONE) || '0'
  const by   = gen.valueToCode(block, 'BY', Order.NONE) || '1'
  const branch = gen.statementToCode(block, 'DO')
  return `for (${v} = ${from}; ${v} <= ${to}; ${v} += ${by}) {\n${branch}}\n`
}

// ── Math / text / variables ─────────────────────────────────────────────────
G['math_number'] = function (block) {
  return [String(Number(block.getFieldValue('NUM'))), Order.ATOMIC]
}
const ARITH = {
  ADD: ['+', Order.ADDITIVE], MINUS: ['-', Order.ADDITIVE],
  MULTIPLY: ['*', Order.MULTIPLICATIVE], DIVIDE: ['/', Order.MULTIPLICATIVE],
}
G['math_arithmetic'] = function (block, gen) {
  const key = block.getFieldValue('OP')
  if (key === 'POWER') {
    const a = gen.valueToCode(block, 'A', Order.NONE) || '0'
    const b = gen.valueToCode(block, 'B', Order.NONE) || '0'
    return [`pow(${a}, ${b})`, Order.ATOMIC]
  }
  const [op, order] = ARITH[key] || ['+', Order.ADDITIVE]
  const a = gen.valueToCode(block, 'A', order) || '0'
  const b = gen.valueToCode(block, 'B', order) || '0'
  return [`${a} ${op} ${b}`, order]
}
G['variables_get'] = function (block, gen) {
  return [gen.getVariableName(block.getFieldValue('VAR')), Order.ATOMIC]
}
G['variables_set'] = function (block, gen) {
  const v = gen.getVariableName(block.getFieldValue('VAR'))
  const val = gen.valueToCode(block, 'VALUE', Order.NONE) || '0'
  return `${v} = ${val};\n`
}
G['math_change'] = function (block, gen) {
  const v = gen.getVariableName(block.getFieldValue('VAR'))
  const delta = gen.valueToCode(block, 'DELTA', Order.NONE) || '0'
  return `${v} += ${delta};\n`
}
G['text'] = function (block) {
  const s = String(block.getFieldValue('TEXT')).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [`"${s}"`, Order.ATOMIC]
}
G['text_print'] = function (block, gen) {
  const v = gen.valueToCode(block, 'TEXT', Order.NONE) || '""'
  return `Serial.println(${v});\n`
}
