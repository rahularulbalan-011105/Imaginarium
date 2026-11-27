// Vishay TSOP38238 38 kHz IR receiver module (Tinkercad "IR Sensor (receiver)").
// Datasheet: pins (dome toward you) 1 OUT, 2 GND, 3 VS; VS 2.5–5.5 V (abs max
// 6 V); supply current ≈0.35–0.45 mA; OUT is active-LOW with an internal ≈30 kΩ
// pull-up to VS, idling HIGH. Mold package ≈6.0 × 6.95 × 5.6 mm (incl. lens),
// 2.54 mm pitch. Frames from an "IR Remote" part reach every POWERED receiver;
// sketches read them through IRremote — both the 2.x API (IRrecv, decode,
// results.value, resume) and the ≥3.x API (IrReceiver.begin/decode/
// decodedIRData.command/resume), implemented in the sandbox below.
import { Group, SphereGeometry, Mesh } from 'three'
import { definePart } from '../../definePart.js'
import { resistor, addDiode } from '../../../circuit/mna.js'
import { mat, box, at, lead, PITCH } from '../../model.js'

const LEG = 0.5, BW = 0.60, BH = 0.695, BD = 0.40, LENS_R = 0.2

// ── IRremote (sandbox, ES5) ──────────────────────────────────────────────────
// A frame is decoded when a receiver whose OUT reaches this sketch pin is
// powered, and a remote has sent a new frame (IN.parts.ir_remote[id].seq).
// While a button is held the remote sends NEC repeat frames every 108 ms.
// After a successful decode() the receiver stays stopped until resume().
const SANDBOX = `
var UNKNOWN = 0, NEC = 8, REPEAT = 0xFFFFFFFF, IRDATA_FLAGS_EMPTY = 0, IRDATA_FLAGS_IS_REPEAT = 1;
var ENABLE_LED_FEEDBACK = true, DISABLE_LED_FEEDBACK = false, USE_DEFAULT_FEEDBACK_LED_PIN = 0;
var __ir_receiver_hex = function (v) { return '0x' + (Number(v) >>> 0).toString(16).toUpperCase() };
function decode_results() {
  if (!(this instanceof decode_results)) return new decode_results();
  this.value = 0; this.bits = 0; this.decode_type = UNKNOWN; this.address = 0; this.command = 0; this.rawlen = 0; this.overflow = false;
}
function IRrecv(pin, fbPin) {
  if (!(this instanceof IRrecv)) return new IRrecv(pin, fbPin);
  this._pin = pin == null ? -1 : Number(pin); this._on = false; this._stop = false; this._seen = {}; this._rep = {};
  this.decodedIRData = { protocol: UNKNOWN, address: 0, command: 0, extra: 0, numberOfBits: 0, flags: 0, decodedRawData: 0, decodedRawDataArray: [0] };
  this.results = new decode_results();
}
IRrecv.prototype = {
  enableIRIn: function () {
    this._on = true; this._stop = false;
    var T = __partIn('ir_remote');
    for (var id in T) { if (T[id]) { this._seen[id] = T[id].seq; this._rep[id] = millis(); } }
  },
  begin: function (pin) { if (pin != null) this._pin = Number(pin); this.enableIRIn(); },
  start: function () { this.enableIRIn(); },
  stop: function () { this._on = false; }, end: function () { this._on = false; }, disableIRIn: function () { this._on = false; },
  resume: function () { this._stop = false; },
  blink13: function () {}, isIdle: function () { return true },
  _rx: function () {
    var R = __partIn('ir_receiver');
    for (var id in R) { var r = R[id]; if (r && r.powered && r.pin === this._pin) return true; }
    return false;
  },
  available: function () { return this._on && !this._stop && this._rx() && this._next(false) != null; },
  _next: function (take) {
    var T = __partIn('ir_remote'), now = millis();
    for (var id in T) {
      var t = T[id];
      if (!t || !t.on) continue;
      var seen = this._seen[id] || 0;
      if (t.seq !== seen && t.seq > 0) { if (take) { this._seen[id] = t.seq; this._rep[id] = now; } return { t: t, rep: false }; }
      if (t.held && now - (this._rep[id] || now) >= 108) { if (take) this._rep[id] = now; return { t: t, rep: true }; }
    }
    return null;
  },
  decode: function (res) {
    if (!this._on || this._stop || this._pin < 0 || !this._rx()) return false;
    var f = this._next(true);
    if (!f) return false;
    var t = f.t, rep = f.rep, d = this.decodedIRData;
    d.protocol = NEC; d.address = t.addr; d.command = t.cmd; d.extra = 0;
    d.numberOfBits = rep ? 0 : 32; d.flags = rep ? IRDATA_FLAGS_IS_REPEAT : IRDATA_FLAGS_EMPTY;
    d.decodedRawData = rep ? 0 : t.raw; d.decodedRawDataArray = [d.decodedRawData];
    var targets = [this.results];
    if (res && typeof res === 'object' && res !== this.results) targets.push(res);
    for (var i = 0; i < targets.length; i++) {
      var r = targets[i];
      r.decode_type = NEC; r.value = rep ? REPEAT : t.value; r.bits = rep ? 0 : 32; r.address = t.addr; r.command = t.cmd;
    }
    this._stop = true;
    return true;
  },
  printIRResultShort: function () {
    var d = this.decodedIRData;
    send('serial', ['Protocol=' + (d.protocol === NEC ? 'NEC' : 'UNKNOWN') + ' Address=' + __ir_receiver_hex(d.address) + ' Command=' + __ir_receiver_hex(d.command) +
      (d.flags & IRDATA_FLAGS_IS_REPEAT ? ' Repeat' : ' Raw-Data=' + __ir_receiver_hex(d.decodedRawData) + ' 32 bits LSB first') + String.fromCharCode(10)]);
  },
};
var IrReceiver = new IRrecv(-1);
`

export default definePart({
  type: 'ir_receiver',
  label: 'IR Receiver (TSOP38238)',
  shortName: 'IR',
  tinkercad: 'IR Sensor (receiver)',
  category: 'comms',
  icon: '◉',
  desc: 'TSOP38238 · 38 kHz · OUT · GND · VS',
  purpose: 'Receives the codes of an IR remote. With the dome toward you: OUT (left) to a digital pin, GND (middle), VS (right) to 5 V. In code use IRremote: IrReceiver.begin(pin, ENABLE_LED_FEEDBACK); then if (IrReceiver.decode()) { … IrReceiver.decodedIRData.command …; IrReceiver.resume(); }. Add an "IR Remote" and press its buttons.',
  usage: 'remote-controlled robots · TV-remote menus',
  spec: { dims_mm: { w: 6.0, h: 11.95, d: 5.2 }, mass_kg: 0.0005, carrier_kHz: 38, supply_V: '2.5–5.5', absMax_V: 6, Is_mA: 0.45, pullup_ohm: 30e3,
    summary: 'Active-LOW output with a 30 kΩ pull-up. Pin 1 OUT, 2 GND, 3 VS (dome toward you).' },
  pins: [
    { name: 'OUT', kind: 'digital', x: -PITCH, y: 0.02, z: 0, r: 0.06 },
    { name: 'GND', kind: 'gnd', x: 0, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
    { name: 'VS', kind: 'power', x: PITCH, y: 0.02, z: 0, r: 0.06 },
  ],
  build() {
    const g = new Group()
    for (const x of [-PITCH, 0, PITCH]) g.add(lead([x, 0, 0], [x, LEG + 0.05, 0], { r: 0.025 }))
    const black = mat(0x141414, { rough: 0.55 })
    g.add(box(BW, BH, BD, black, 0, LEG + BH / 2, -0.08))
    const lens = new Mesh(new SphereGeometry(LENS_R, 24, 12), mat(0x1c1c22, { rough: 0.25 }))
    lens.scale.z = 0.6
    g.add(at(lens, 0, LEG + BH * 0.62, 0.12))
    for (const s of [-1, 1]) g.add(box(0.06, 0.12, 0.04, black, s * (BW / 2 - 0.03), LEG + 0.06, 0.13))  // standoff feet
    return g
  },
  sim: {
    circuit(api) {
      const vs = api.pin('VS'), gnd = api.pin('GND'), out = api.pin('OUT')
      return {
        iq: api.add(resistor(vs, gnd, 5 / 0.45e-3)),
        pu: api.add(resistor(vs, out, 30e3)),
        esd: addDiode(api, gnd, vs, { Rs: 10 }),
      }
    },
    solved(h, api) {
      const vs = api.vpin('VS') - api.vpin('GND')
      if (vs < -0.3) api.issue('reversed', 'error', `${api.obj.name} has VS and GND swapped`, 'Reverse supply destroys the TSOP. With the dome toward you the pins are OUT · GND · VS.')
      else api.clearIssue('reversed')
      if (vs > 6) api.issue('overvoltage', 'error', `${api.obj.name}: ${vs.toFixed(1)} V on VS`, 'Absolute maximum is 6 V.')
      else api.clearIssue('overvoltage')
      if (vs > 0.3 && vs < 2.5) api.issue('undervoltage', 'warning', `${api.obj.name} has only ${vs.toFixed(2)} V`, 'The TSOP38238 needs 2.5–5.5 V; it receives nothing below that.')
      else api.clearIssue('undervoltage')
      return { supply: vs, powered: vs >= 2.5 && vs <= 6 }
    },
    input(api) { return { pin: api.boardPin('OUT'), powered: !!api.solved()?.powered } },
  },
  code: {
    includes: ['IRremote', 'IRremote.hpp', 'IRremote.h'],
    classes: ['IRrecv', 'decode_results'],
    consts: ['IrReceiver', 'NEC', 'UNKNOWN', 'REPEAT', 'ENABLE_LED_FEEDBACK', 'DISABLE_LED_FEEDBACK', 'USE_DEFAULT_FEEDBACK_LED_PIN', 'IRDATA_FLAGS_IS_REPEAT', 'IRDATA_FLAGS_EMPTY'],
    sandbox: SANDBOX,
    example: `#include <IRremote.hpp>
const int RECV_PIN = 11;
void setup() {
  Serial.begin(9600);
  IrReceiver.begin(RECV_PIN, ENABLE_LED_FEEDBACK);
}
void loop() {
  if (IrReceiver.decode()) {
    Serial.println(IrReceiver.decodedIRData.command);
    IrReceiver.resume();
  }
}`,
  },
  blockly: {
    blocks: [{
      type: 'part_ir_receiver_code',
      message0: 'IR remote button code on pin %1',
      args0: [{ type: 'field_number', name: 'PIN', value: 11, min: 0, max: 19, precision: 1 }],
      output: 'Number', colour: '#2563eb',
      tooltip: 'The NEC command of the button just received (e.g. 69 = POWER, 12 = "1"), or -1 when nothing new arrived. Uses IRremote.',
    }],
    generators: {
      part_ir_receiver_code(block, gen, H) {
        const pin = block.getFieldValue('PIN')
        H.include(gen, '<IRremote.hpp>')
        H.setup(gen, 'ir_begin', `IrReceiver.begin(${pin}, ENABLE_LED_FEEDBACK);`)
        H.define(gen, 'ir_read', `long irReadCommand() {
  if (IrReceiver.decode()) {
    long c = IrReceiver.decodedIRData.command;
    IrReceiver.resume();
    return c;
  }
  return -1;
}`)
        return ['irReadCommand()', H.Order.ATOMIC]
      },
    },
  },
  tests: [
    {
      name: 'powered from 5 V, OUT idles HIGH through its 30 kΩ pull-up; draws ≈0.45 mA',
      run(kit) {
        kit.scene({ U: 'arduino', IR: 'ir_receiver' }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:GND1'], ['IR:VS', 'U:5V']])
        kit.pinMode(11, 'input'); kit.step(0.02)
        // 5 V × 10 MΩ / (10 MΩ + 30 kΩ) = 4.985 V.
        kit.near(kit.pinVoltage(11), 4.985, 0.01)
        kit.equal(kit.digitalRead(11), 1)
        kit.ok(kit.state('IR').powered)
        kit.equal(kit.input().ir_receiver.IR.pin, 11, 'OUT reaches D11')
      },
    },
    {
      name: 'IRremote ≥3 API: IrReceiver.decode() gets command 0x1C for remote button "5"',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', IR: 'ir_receiver', RC: 'ir_remote' }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:GND1'], ['IR:VS', 'U:5V']])
        const s = runSketch(kit, `#include <IRremote.hpp>
void setup() { Serial.begin(9600); IrReceiver.begin(11, ENABLE_LED_FEEDBACK); }
void loop() {
  if (IrReceiver.decode()) {
    if (!(IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT)) { Serial.println(IrReceiver.decodedIRData.command); }
    IrReceiver.resume();
  }
  delay(5);
}`)
        await s.run(80)
        kit.control('RC', 'btn', '5'); await s.run(80)
        kit.control('RC', 'btn', ''); await s.run(60)
        s.stop()
        kit.equal(s.out.join('|'), '28\n', 'command 0x1C = 28')
      },
    },
    {
      name: 'IRrecv object API: decode() + decodedRawData = 0xE31CFF00, and repeats arrive while held',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', IR: 'ir_receiver', RC: 'ir_remote' }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:GND1'], ['IR:VS', 'U:5V']])
        const s = runSketch(kit, `#include <IRremote.h>
IRrecv irrecv(11);
void setup() { Serial.begin(9600); irrecv.enableIRIn(); }
void loop() {
  if (irrecv.decode()) {
    Serial.println(irrecv.decodedIRData.decodedRawData);
    Serial.println(irrecv.results.value);
    irrecv.resume();
  }
  delay(5);
}`)
        await s.run(60)
        kit.control('RC', 'btn', '5'); await s.run(400)
        kit.control('RC', 'btn', ''); await s.run(40)
        s.stop()
        // "5": raw = 0xE3 1C FF 00 = 3810328320; classic value = 0x00FF38C7 = 16726215.
        kit.equal(s.out[0], '3810328320\n', 'decodedRawData')
        kit.equal(s.out[1], '16726215\n', 'results.value (2.x spelling)')
        // Held ≈400 ms → NEC repeat frames every 108 ms: value 0xFFFFFFFF.
        kit.ok(s.out.includes('4294967295\n'), 'repeat frame seen')
      },
    },
    {
      name: 'no code when the receiver is unpowered or the sketch listens on the wrong pin',
      async run(kit, { runSketch }) {
        const sketch = (pin) => `#include <IRremote.hpp>
void setup() { Serial.begin(9600); IrReceiver.begin(${pin}, ENABLE_LED_FEEDBACK); }
void loop() { if (IrReceiver.decode()) { Serial.println(IrReceiver.decodedIRData.command); IrReceiver.resume(); } delay(5); }`
        kit.scene({ U: 'arduino', IR: 'ir_receiver', RC: 'ir_remote' }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:GND1']])
        let s = runSketch(kit, sketch(11))
        kit.control('RC', 'btn', 'PWR'); await s.run(150)
        s.stop()
        kit.equal(s.out.length, 0, 'VS not wired')
        kit.scene({ U: 'arduino', IR: 'ir_receiver', RC: 'ir_remote' }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:GND1'], ['IR:VS', 'U:5V']])
        s = runSketch(kit, sketch(10))
        kit.control('RC', 'btn', 'PWR'); await s.run(150)
        s.stop()
        kit.equal(s.out.length, 0, 'wrong pin')
      },
    },
    {
      name: 'reversed supply is an error',
      run(kit) {
        kit.scene({ U: 'arduino', IR: 'ir_receiver' }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:5V'], ['IR:VS', 'U:GND1']])
        kit.step(0.02)
        kit.ok(kit.hasIssue('IR:reversed'))
      },
    },
  ],
})
