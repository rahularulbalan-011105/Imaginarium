// NeoPixel family (Tinkercad "NeoPixel", "NeoPixel Strip 4", "NeoPixel Strip 20",
// "NeoPixel Ring 12/16/24", "NeoPixel Jewel") — WS2812B addressable RGB LEDs in
// 5050 packages (5.0 × 5.0 × 1.6 mm), driven by the Adafruit_NeoPixel library.
//
// Real behaviour modelled:
//  • The sketch's Adafruit_NeoPixel object builds the byte stream exactly like
//    the library (colour order from NEO_GRB / NEO_RGB / NEO_RGBW, brightness
//    scaling (c·(b+1)) >> 8). show() sends it on the constructor pin.
//  • Every pixel is a WS2812B: it reads 24 bits as G-R-B and passes the rest on
//    through DOUT. So a part only updates when its DIN is on the sketch's pin
//    (or on the DOUT of a powered NeoPixel that is), its 5 V/GND are powered
//    (VDD 3.5–5.3 V), and only on show(). A NEO_RGB sketch on these GRB pixels
//    swaps red and green, as on the bench; NEO_KHZ400 is not decoded.
//  • Supply current: ≈1 mA per pixel idle + 20 mA per channel at 255
//    (Adafruit: ≈60 mA per pixel at full white), stamped as a 5 V load.
import { Group, Mesh, Shape, Path, ExtrudeGeometry, CylinderGeometry } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, lead, setGlow, TIN, GOLD, PCB_T } from '../../model.js'

const I_IDLE = 0.001, I_CH = 0.020
const PITCH60 = 1.6667                 // 60 LEDs/m strip pitch (cm)
const links = new WeakMap()            // obj → { head, prev, n, powered } (set by 'link' before every 'frame')
const loads = new WeakMap()            // obj → supply current (A) from the latched colours
const flags = new WeakMap()            // obj → { khz400 }

// ── geometry ─────────────────────────────────────────────────────────────────
function led5050(g, i, x, y, z, rotY = 0) {
  const body = box(0.5, 0.16, 0.5, mat(0xf4f4f0, { rough: 0.5 }), x, y + 0.08, z)
  body.rotation.y = rotY
  g.add(body)
  const lens = cyl(0.19, 0.012, mat(0xfafaf5, { rough: 0.25, emissive: 0x000000, opacity: 0.95 }), { seg: 20 })
  lens.name = `px_${i}`
  g.add(at(lens, x, y + 0.166, z))
}
function annulus(ro, ri, color) {
  const s = new Shape(); s.absarc(0, 0, ro, 0, Math.PI * 2, false)
  if (ri > 0) { const h = new Path(); h.absarc(0, 0, ri, 0, Math.PI * 2, true); s.holes.push(h) }
  const m = new Mesh(new ExtrudeGeometry(s, { depth: PCB_T, bevelEnabled: false, curveSegments: 48 }), mat(color, { rough: 0.6 }))
  m.rotation.x = -Math.PI / 2      // extrusion +Z → +Y: board from y = 0 to y = 1.6 mm
  return m
}
const PAD_NAMES = ['5V', 'GND', 'DIN', 'DOUT']
const KIND = { '5V': 'power', GND: 'gnd', DIN: 'digital', DOUT: 'digital' }

// ── shared simulation ────────────────────────────────────────────────────────
function sim(n) {
  return {
    initState: () => ({ pixels: Array.from({ length: n }, () => [0, 0, 0]), shows: 0 }),
    circuit(api) { return { r: api.add(resistor(api.pin('5V'), api.pin('GND'), 5 / (n * I_IDLE))) } },
    beforeStep(h, api) { h.r.R = 5 / Math.max(1e-4, loads.get(api.obj) ?? n * I_IDLE) },
    solved(h, api) {
      const v = api.vpin('5V') - api.vpin('GND'), i = api.cur(h.r)
      const name = api.obj.name || 'NeoPixel'
      if (v > 5.5) api.issue('overvoltage', 'error', `${name} has ${v.toFixed(1)} V on 5V`, 'WS2812B pixels are rated 3.5–5.3 V. Higher voltage destroys them.')
      else api.clearIssue('overvoltage')
      if (i > 0.5) api.issue('supply', 'warning', `${name} draws ${(i * 1000).toFixed(0)} mA`,
        'An Arduino 5 V pin on USB can give about 500 mA. Use a separate 5 V supply (shared GND) or lower setBrightness().')
      else api.clearIssue('supply')
      if (flags.get(api.obj)?.khz400) api.issue('khz400', 'warning', `${name} ignores 400 kHz data`, 'WS2812B pixels need NEO_KHZ800. NEO_KHZ400 is only for the old WS2811 chips.')
      else api.clearIssue('khz400')
      return { voltage: v, current: i, powered: v >= 3.5 && v <= 5.5 }
    },
    calls: {
      link([pin], api) {
        const v = api.vpin('5V') - api.vpin('GND')
        const prev = api.peers('DIN', null, 'DOUT').find(o => FAMILY.has(o.type)) ?? null
        links.set(api.obj, { head: pin != null && api.boardPin('DIN') === Number(pin), prev, n, powered: v >= 3.5 && v <= 5.5 })
      },
      frame([pin, bytes, khz400], api) {
        let cur = links.get(api.obj)
        if (!cur || !cur.powered) return
        let off = 0, guard = 0
        while (!cur.head) {
          const li = cur.prev && links.get(cur.prev)
          if (!li || !li.powered || ++guard > 64) return      // chain does not reach the sketch's pin
          off += li.n; cur = li
        }
        flags.set(api.obj, { khz400: !!khz400 })
        if (khz400) return
        const st = api.state
        let amps = 0
        for (let k = 0; k < n; k++) {
          const b = (off + k) * 3
          if (b + 2 < bytes.length) st.pixels[k] = [bytes[b + 1] & 255, bytes[b] & 255, bytes[b + 2] & 255]   // WS2812B: G R B
          const p = st.pixels[k]
          amps += I_IDLE + I_CH * (p[0] + p[1] + p[2]) / 255
        }
        loads.set(api.obj, amps)
        st.shows++
        void pin
      },
    },
    visual(root, { solved, state, off }) {
      for (let k = 0; k < n; k++) {
        const m = root.getObjectByName(`px_${k}`)
        const p = state?.pixels?.[k]
        if (off || !solved?.powered || !p) { setGlow(m, 0x000000, 0); continue }
        const L = Math.max(p[0], p[1], p[2]) / 255
        const hex = L > 0 ? (Math.round(p[0] / L) << 16) | (Math.round(p[1] / L) << 8) | Math.round(p[2] / L) : 0
        setGlow(m, hex, L)
      }
    },
    readout({ solved, state }) {
      if (!solved) return ''
      const lit = (state?.pixels ?? []).filter(p => p[0] || p[1] || p[2]).length
      return `${lit}/${n} lit · ${(solved.current * 1000).toFixed(0)} mA`
    },
  }
}

// ── the library (sandbox, ES5) ───────────────────────────────────────────────
const SANDBOX = `
var __neopixel_types = ['neopixel', 'neopixel_strip_4', 'neopixel_strip_20', 'neopixel_ring_12', 'neopixel_ring_16', 'neopixel_ring_24', 'neopixel_jewel'];
function Adafruit_NeoPixel(n, pin, type) {
  if (!(this instanceof Adafruit_NeoPixel)) return new Adafruit_NeoPixel(n, pin, type);
  this._pin = pin == null ? -1 : Number(pin);
  this._type = type == null ? 0x52 : Number(type);
  this._bri = 0; this._began = false;
  this.updateLength(n == null ? 0 : n);
}
Adafruit_NeoPixel.prototype = {
  begin: function () { this._began = true; if (this._pin >= 0) pinMode(this._pin, OUTPUT); },
  updateLength: function (n) { this._n = Math.max(0, Math.floor(Number(n) || 0)); this._px = []; for (var i = 0; i < this._n; i++) this._px.push([0, 0, 0, 0]); },
  updateType: function (t) { this._type = Number(t) || 0; },
  setPin: function (p) { this._pin = Number(p); if (this._began) pinMode(this._pin, OUTPUT); },
  getPin: function () { return this._pin; },
  numPixels: function () { return this._n; },
  canShow: function () { return true; },
  setPixelColor: function (i, r, g, b, w) {
    i = Math.floor(Number(i)); if (!(i >= 0 && i < this._n)) return;
    if (g === undefined) { var c = Number(r) >>> 0; w = (c >>> 24) & 255; r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255; }
    this._px[i] = [Number(r) & 255, Number(g) & 255, Number(b) & 255, Number(w || 0) & 255];
  },
  getPixelColor: function (i) {
    var p = this._px[Math.floor(Number(i))]; if (!p) return 0;
    return (((p[3] << 24) | (p[0] << 16) | (p[1] << 8) | p[2]) >>> 0);
  },
  fill: function (c, first, count) {
    first = Math.max(0, Math.floor(Number(first) || 0));
    var end = (count == null || Number(count) === 0) ? this._n : Math.min(this._n, first + Math.floor(Number(count)));
    for (var i = first; i < end; i++) this.setPixelColor(i, c == null ? 0 : c);
  },
  clear: function () { for (var i = 0; i < this._n; i++) this._px[i] = [0, 0, 0, 0]; },
  setBrightness: function (b) { this._bri = ((Number(b) || 0) + 1) & 255; },
  getBrightness: function () { return (this._bri - 1) & 255; },
  Color: function (r, g, b, w) {
    if (w === undefined) return (((Number(r) & 255) << 16) | ((Number(g) & 255) << 8) | (Number(b) & 255));
    return ((((Number(w) & 255) << 24) | ((Number(r) & 255) << 16) | ((Number(g) & 255) << 8) | (Number(b) & 255)) >>> 0);
  },
  ColorHSV: function (hue, sat, val) {
    hue = Number(hue == null ? 0 : hue) & 0xffff; sat = sat == null ? 255 : Number(sat) & 255; val = val == null ? 255 : Number(val) & 255;
    hue = Math.floor((hue * 1530 + 32768) / 65536);
    var r, g, b;
    if (hue < 510) { b = 0; if (hue < 255) { r = 255; g = hue; } else { r = 510 - hue; g = 255; } }
    else if (hue < 1020) { r = 0; if (hue < 765) { g = 255; b = hue - 510; } else { g = 1020 - hue; b = 255; } }
    else if (hue < 1530) { g = 0; if (hue < 1275) { r = hue - 1020; b = 255; } else { r = 255; b = 1530 - hue; } }
    else { r = 255; g = 0; b = 0; }
    var v1 = 1 + val, s1 = 1 + sat, s2 = 255 - sat;
    return ((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8) | (((((g * s1) >> 8) + s2) * v1) & 0xff00) | (((((b * s1) >> 8) + s2) * v1) >> 8);
  },
  gamma8: function (x) { return Math.round(Math.pow((Number(x) & 255) / 255, 2.6) * 255); },
  gamma32: function (c) {
    c = Number(c) >>> 0; var self = this;
    var f = function (s) { return self.gamma8((c >>> s) & 255) << s; };
    return ((f(24) | f(16) | f(8) | f(0)) >>> 0);
  },
  sine8: function (x) { return Math.round(127.5 + 127.5 * Math.sin(((Number(x) & 255) - 64) * Math.PI / 128)); },
  show: function () {
    if (!this._began || this._pin < 0) return;
    var t = this._type, wOff = (t >> 6) & 3, rOff = (t >> 4) & 3, gOff = (t >> 2) & 3, bOff = t & 3;
    var bpp = wOff === rOff ? 3 : 4, bytes = [], br = this._bri;
    for (var i = 0; i < this._n; i++) {
      var p = this._px[i], o = [0, 0, 0, 0];
      var s = function (v) { return br ? ((v * br) >> 8) : v; };
      o[rOff] = s(p[0]); o[gOff] = s(p[1]); o[bOff] = s(p[2]); if (bpp === 4) o[wOff] = s(p[3]);
      for (var k = 0; k < bpp; k++) bytes.push(o[k]);
    }
    var k4 = (t & 0x100) ? 1 : 0, j;
    for (j = 0; j < __neopixel_types.length; j++) __part(__neopixel_types[j], 'link', [this._pin]);
    for (j = 0; j < __neopixel_types.length; j++) __part(__neopixel_types[j], 'frame', [this._pin, bytes, k4]);
  },
};
`
const CONSTS = 'var NEO_RGB = 0x06, NEO_RBG = 0x09, NEO_GRB = 0x52, NEO_GBR = 0xA1, NEO_BRG = 0x58, NEO_BGR = 0xA4, NEO_RGBW = 0xC6, NEO_GRBW = 0xD2, NEO_KHZ800 = 0x0000, NEO_KHZ400 = 0x0100;'
const CODE_BASE = {
  includes: ['Adafruit_NeoPixel'], classes: ['Adafruit_NeoPixel'],
  consts: ['NEO_RGB', 'NEO_RBG', 'NEO_GRB', 'NEO_GBR', 'NEO_BRG', 'NEO_BGR', 'NEO_RGBW', 'NEO_GRBW', 'NEO_KHZ800', 'NEO_KHZ400'],
}

// ── family members ───────────────────────────────────────────────────────────
function member({ type, label, n, desc, spec, pins, build, extra = {} }) {
  return definePart({
    type, label, tinkercad: label, category: 'lights', icon: '🔴', shortName: 'NEO',
    desc, spec: { mass_kg: 0.0005 + n * 0.0003, chip: 'WS2812B (5050)', vdd_V: [3.5, 5.3], maxPerPixel_mA: 60, colorOrder: 'GRB', ...spec },
    purpose: `${n} addressable RGB LED${n > 1 ? 's' : ''} on one data wire. Wire 5V and GND to power (a separate 5 V supply for many pixels, GND shared with the Arduino) and DIN to one pin (a 330 Ω resistor in the data line is good practice). Use the Adafruit_NeoPixel library: Adafruit_NeoPixel strip(${n}, 6, NEO_GRB + NEO_KHZ800); strip.begin(); strip.setPixelColor(0, 255, 0, 0); strip.show(); DOUT continues the chain into the next NeoPixel's DIN.`,
    usage: 'animations · status lights · wearables',
    pins, build, sim: sim(n), code: { ...CODE_BASE },
    blockly: memberBlocks(type, label, n), tests: [memberTest(type, n)], ...extra,
  })
}

// One block per family member: set a pixel and show, with the right pixel count.
function memberBlocks(type, label, n) {
  const bt = `part_${type}_pixel`
  return {
    blocks: [{
      type: bt,
      message0: `${label} on pin %1: show pixel %2 as red %3 green %4 blue %5`,
      args0: [
        { type: 'field_number', name: 'PIN', value: 6, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'IDX', value: 0, min: 0, max: n - 1, precision: 1 },
        { type: 'field_number', name: 'R', value: 0, min: 0, max: 255, precision: 1 },
        { type: 'field_number', name: 'G', value: 0, min: 0, max: 255, precision: 1 },
        { type: 'field_number', name: 'B', value: 255, min: 0, max: 255, precision: 1 },
      ],
      previousStatement: null, nextStatement: null, colour: '#eab308',
      tooltip: `Sets one of the ${n} pixels and sends the colours (show).`,
    }],
    generators: {
      [bt](block, gen, H) {
        const pin = block.getFieldValue('PIN'), v = `${type}_pin${pin}`
        H.include(gen, '<Adafruit_NeoPixel.h>')
        H.define(gen, v, `Adafruit_NeoPixel ${v}(${n}, ${pin}, NEO_GRB + NEO_KHZ800);`)
        H.setup(gen, `${v}_begin`, `${v}.begin();`)
        const c = (k) => Math.max(0, Math.min(255, Math.round(Number(block.getFieldValue(k)) || 0)))
        const idx = Math.max(0, Math.min(n - 1, Math.round(Number(block.getFieldValue('IDX')) || 0)))
        return `${v}.setPixelColor(${idx}, ${c('R')}, ${c('G')}, ${c('B')});
${v}.show();
`
      },
    },
  }
}
function memberTest(type, n) {
  return {
    name: `end to end: a sketch lights pixel 0 red and pixel ${n - 1} blue; the rest stay off`,
    async run(kit, { runSketch }) {
      kit.scene({ U: 'arduino', P: type }, [['U:5V', 'P:5V'], ['P:GND', 'U:GND1'], ['U:D6', 'P:DIN']])
      const s = runSketch(kit, `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel px(${n}, 6, NEO_GRB + NEO_KHZ800);
void setup() {
  px.begin();
  px.setPixelColor(0, px.Color(255, 0, 0));
  px.setPixelColor(${n - 1}, 0, 0, 255);
  px.show();
}
void loop() { delay(10); }`)
      await s.run(120)
      const pix = kit.partState('P').pixels
      kit.equal(JSON.stringify(pix[0]), n > 1 ? '[255,0,0]' : '[0,0,255]', 'pixel 0')
      kit.equal(JSON.stringify(pix[n - 1]), '[0,0,255]', 'last pixel blue')
      kit.equal(pix.filter(p => p[0] + p[1] + p[2] > 0).length, Math.min(2, n), 'only those lit')
      // Supply: n·1 mA idle + 20 mA per channel at 255 (two channels lit), through the 0.05 Ω 5 V source.
      kit.near(kit.state('P').current, n * 0.001 + (n > 1 ? 0.04 : 0.02), 0.002, 'supply current')
      s.stop()
    },
  }
}
const padPins = (pts, y) => PAD_NAMES.map((name, i) => ({ name, kind: KIND[name], x: pts[i][0], y, z: pts[i][1], r: 0.07, label: name, ldy: i % 2 ? 0.25 : 0 }))

// Single: Adafruit-style breadboard breakout 10.2 × 12.7 mm, one WS2812B, four legs in a row on 2.54 mm.
const single = member({
  type: 'neopixel', label: 'NeoPixel', n: 1,
  desc: 'Single WS2812B · breadboard breakout',
  spec: { dims_mm: { w: 10.2, h: 6.2, d: 12.7 }, summary: 'One 5050 WS2812B on a 10.2 × 12.7 mm breakout; legs DIN · 5V · GND · DOUT at 2.54 mm.' },
  pins: ['DIN', '5V', 'GND', 'DOUT'].map((name, i) => ({ name, kind: KIND[name], x: -0.381 + i * 0.254, y: 0.02, z: 0.5, r: 0.06, label: name, ldy: i % 2 ? 0.25 : 0 })),
  build() {
    const g = new Group(), top = 0.3 + PCB_T
    g.add(box(1.02, PCB_T, 1.27, mat(0x111111, { rough: 0.6 }), 0, 0.3 + PCB_T / 2, 0))
    led5050(g, 0, 0, top, -0.12)
    for (let i = 0; i < 4; i++) {
      const x = -0.381 + i * 0.254
      g.add(box(0.064, 0.3 + PCB_T, 0.064, GOLD(), x, (0.3 + PCB_T) / 2, 0.5))
      g.add(box(0.16, 0.01, 0.16, GOLD(), x, top + 0.005, 0.5))
    }
    return g
  },
  extra: {
    code: { ...CODE_BASE, sandbox: SANDBOX, sandboxConsts: CONSTS },
    blockly: {
      blocks: [
        {
          type: 'part_neopixel_set',
          message0: 'NeoPixels on pin %1 (count %2): set pixel %3 to red %4 green %5 blue %6',
          args0: [
            { type: 'field_number', name: 'PIN', value: 6, min: 0, max: 19, precision: 1 },
            { type: 'field_number', name: 'COUNT', value: 12, min: 1, max: 300, precision: 1 },
            { type: 'field_number', name: 'IDX', value: 0, min: 0, max: 299, precision: 1 },
            { type: 'field_number', name: 'R', value: 255, min: 0, max: 255, precision: 1 },
            { type: 'field_number', name: 'G', value: 0, min: 0, max: 255, precision: 1 },
            { type: 'field_number', name: 'B', value: 0, min: 0, max: 255, precision: 1 },
          ],
          previousStatement: null, nextStatement: null, colour: '#eab308',
          tooltip: 'Stores a colour for one pixel. Nothing changes until "show".',
        },
        {
          type: 'part_neopixel_show',
          message0: 'NeoPixels on pin %1 (count %2): show',
          args0: [
            { type: 'field_number', name: 'PIN', value: 6, min: 0, max: 19, precision: 1 },
            { type: 'field_number', name: 'COUNT', value: 12, min: 1, max: 300, precision: 1 },
          ],
          previousStatement: null, nextStatement: null, colour: '#eab308',
          tooltip: 'Sends every stored colour down the data wire.',
        },
      ],
      generators: {
        part_neopixel_set(block, gen, H) {
          const v = neoDecl(block, gen, H)
          const c = (k) => Math.max(0, Math.min(255, Math.round(Number(block.getFieldValue(k)) || 0)))
          return `${v}.setPixelColor(${Math.round(Number(block.getFieldValue('IDX')) || 0)}, ${c('R')}, ${c('G')}, ${c('B')});\n`
        },
        part_neopixel_show(block, gen, H) { return `${neoDecl(block, gen, H)}.show();\n` },
      },
    },
    tests: [
      {
        name: 'end to end: a 16-pixel chain (Ring 12 → Strip 4) updates on show() only; an unwired Jewel stays dark',
        async run(kit, { runSketch }) {
          kit.scene({ U: 'arduino', R: 'neopixel_ring_12', S: 'neopixel_strip_4', J: 'neopixel_jewel' }, [
            ['U:5V', 'R:5V'], ['R:GND', 'U:GND1'], ['U:D6', 'R:DIN'], ['R:DOUT', 'S:DIN'],
            ['S:5V', 'U:5V'], ['S:GND', 'U:GND2'], ['J:5V', 'U:5V'], ['J:GND', 'U:GND3']])
          const s = runSketch(kit, `#include <Adafruit_NeoPixel.h>
#define PIN 6
#define NUM 16
Adafruit_NeoPixel strip(NUM, PIN, NEO_GRB + NEO_KHZ800);
void setup() {
  strip.begin();
  strip.setPixelColor(0, 255, 0, 0);
  strip.setPixelColor(12, strip.Color(0, 255, 0));
  strip.setPixelColor(15, strip.ColorHSV(43690));
  strip.show();
  strip.setPixelColor(1, 0, 0, 255);
}
void loop() { delay(10); }`)
          await s.run(150)
          kit.equal(JSON.stringify(kit.partState('R').pixels[0]), '[255,0,0]', 'ring pixel 0 red')
          kit.equal(JSON.stringify(kit.partState('R').pixels[1]), '[0,0,0]', 'pixel 1 set but never shown')
          kit.equal(JSON.stringify(kit.partState('S').pixels[0]), '[0,255,0]', 'chain index 12 = strip pixel 0 (green)')
          // ColorHSV(43690): (43690·1530 + 32768) / 65536 = 1020 → pure blue.
          kit.equal(JSON.stringify(kit.partState('S').pixels[3]), '[0,0,255]', 'chain index 15 = strip pixel 3 (blue)')
          kit.ok(kit.partState('J').pixels.every(p => p[0] + p[1] + p[2] === 0), 'Jewel has no data wire → dark')
          kit.ok(kit.mesh('R').getObjectByName('px_0').material.emissiveIntensity > 1, 'ring pixel 0 glows')
          s.stop()
        },
      },
      {
        name: 'end to end: NEO_RGB on WS2812B (GRB) swaps red/green; setBrightness(50) scales 255 → 50; unpowered pixel ignores data',
        async run(kit, { runSketch }) {
          kit.scene({ U: 'arduino', N: 'neopixel', M: 'neopixel' }, [
            ['U:5V', 'N:5V'], ['N:GND', 'U:GND1'], ['U:D5', 'N:DIN'], ['U:D5', 'M:DIN'], ['M:GND', 'U:GND2']])
          const s = runSketch(kit, `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel px = Adafruit_NeoPixel(1, 5, NEO_RGB + NEO_KHZ800);
void setup() {
  Serial.begin(9600);
  px.begin();
  px.setBrightness(50);
  px.setPixelColor(0, 255, 0, 0);
  px.show();
  Serial.println(px.getBrightness());
}
void loop() { delay(10); }`)
          await s.run(150)
          // Stream is R,G,B = [50,0,0] ((255·51) >> 8 = 50); the WS2812B reads it as G,R,B → green 50.
          kit.equal(JSON.stringify(kit.partState('N').pixels[0]), '[0,50,0]', 'red/green swapped, brightness scaled')
          kit.equal(JSON.stringify(kit.partState('M').pixels[0]), '[0,0,0]', 'M has no 5 V → no change')
          kit.ok(s.out.join('').includes('50'), 'getBrightness() returns 50')
          s.stop()
        },
      },
    ],
  },
})

// Strips: 60 LEDs/m flex strip, 10 mm wide; input pads 5V · DIN · GND at the left end, DOUT at the right.
function strip(n) {
  const L = n * PITCH60, y = 0.05
  const padX = -L / 2 + 0.18, endX = L / 2 - 0.18
  return member({
    type: `neopixel_strip_${n}`, label: `NeoPixel Strip ${n}`, n,
    desc: `${n} × WS2812B · 60 LED/m strip · ${(L * 10).toFixed(0)} mm`,
    spec: { dims_mm: { w: L * 10, h: 2.1, d: 10 }, pitch_mm: 16.67, summary: `${n} WS2812B on a 10 mm flex strip at 60 LEDs/m; pads 5V/DIN/GND in, DOUT out.` },
    pins: padPins([[padX, -0.3], [padX, 0.3], [padX, 0], [endX, 0]], y),
    build() {
      const g = new Group()
      g.add(box(L, y, 1.0, mat(0xf2f2f2, { rough: 0.6 }), 0, y / 2, 0))
      for (let i = 0; i < n; i++) led5050(g, i, -L / 2 + PITCH60 * (i + 0.5), y, 0)
      for (const [x, z] of [[padX, -0.3], [padX, 0.3], [padX, 0], [endX, 0], [endX, -0.3], [endX, 0.3]]) g.add(box(0.2, 0.01, 0.18, TIN(), x, y + 0.005, z))
      return g
    },
  })
}

// Rings (Adafruit #1643 / #1463 / #1586): OD / ID in mm; pads on the back beside pixel 0.
function ring(n, od, id) {
  const ro = od / 20, ri = id / 20, rm = (ro + ri) / 2
  const pads = PAD_NAMES.map((_, i) => [(i - 1.5) * 0.254, rm])
  return member({
    type: `neopixel_ring_${n}`, label: `NeoPixel Ring ${n}`, n,
    desc: `${n} × WS2812B ring · Ø${od} mm`,
    spec: { dims_mm: { w: od, h: 3.2, d: od }, od_mm: od, id_mm: id, summary: `${n} WS2812B on a ring PCB, ${od} mm outside / ${id} mm inside; pads 5V/GND/DIN/DOUT on the back.` },
    pins: padPins(pads, 0.0),
    build() {
      const g = new Group()
      g.add(annulus(ro, ri, 0x111111))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        led5050(g, i, -Math.sin(a) * rm, PCB_T, Math.cos(a) * rm, -a)
      }
      for (const [x, z] of pads) g.add(box(0.18, 0.01, 0.2, TIN(), x, -0.005, z))
      return g
    },
  })
}

// Jewel (Adafruit #2226): Ø23 mm disc, pixel 0 in the centre and six around it.
const jewel = member({
  type: 'neopixel_jewel', label: 'NeoPixel Jewel', n: 7,
  desc: '7 × WS2812B · Ø23 mm disc',
  spec: { dims_mm: { w: 23, h: 3.2, d: 23 }, summary: '7 WS2812B (one centre + six around) on a 23 mm disc; pads 5V/GND/DIN/DOUT on the back.' },
  pins: padPins(PAD_NAMES.map((_, i) => [(i - 1.5) * 0.254, 0.95]), 0.0),
  build() {
    const g = new Group()
    const disc = new Mesh(new CylinderGeometry(1.15, 1.15, PCB_T, 40), mat(0x111111, { rough: 0.6 }))
    g.add(at(disc, 0, PCB_T / 2, 0))
    led5050(g, 0, 0, PCB_T, 0)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      led5050(g, i + 1, -Math.sin(a) * 0.72, PCB_T, Math.cos(a) * 0.72, -a)
    }
    for (let i = 0; i < 4; i++) g.add(box(0.18, 0.01, 0.2, TIN(), (i - 1.5) * 0.254, -0.005, 0.95))
    void lead
    return g
  },
})

function neoDecl(block, gen, H) {
  const pin = block.getFieldValue('PIN'), n = block.getFieldValue('COUNT')
  const v = `pixels_pin${pin}`
  H.include(gen, '<Adafruit_NeoPixel.h>')
  H.define(gen, v, `Adafruit_NeoPixel ${v}(${n}, ${pin}, NEO_GRB + NEO_KHZ800);`)
  H.setup(gen, `${v}_begin`, `${v}.begin();`)
  return v
}

const ring24 = ring(24, 65.6, 52.3)
const FAMILY = new Set()
const all = [single, strip(4), strip(20), ring(12, 37, 23), ring(16, 44.5, 31.75), ring24, jewel]
for (const p of all) FAMILY.add(p.type)

// Power scenario on the 24-ring (needs no sketch library beyond the test-kit call path).
const withPowerTest = all.map(p => p !== ring24 ? p : definePart({ ...p, tests: [...p.tests, {
  name: '24 pixels at full white draw ≈1.44 A from the 5 V pin (supply warning); an all-off ring idles at ≈24 mA',
  async run(kit, { runSketch }) {
    kit.scene({ U: 'arduino', R: 'neopixel_ring_24' }, [['U:5V', 'R:5V'], ['R:GND', 'U:GND1'], ['U:D6', 'R:DIN']])
    const s = runSketch(kit, `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel ring(24, 6, NEO_GRB + NEO_KHZ800);
void setup() { ring.begin(); }
void loop() {
  ring.fill(ring.Color(255, 255, 255));
  ring.show();
  delay(10);
}`)
    await s.run(200)
    // Load = 24·(1 mA + 3·20 mA) = 1.464 A → R = 5/1.464 = 3.415 Ω; with the 0.05 Ω 5 V source: I = 5/3.465 ≈ 1.443 A.
    kit.near(kit.state('R').current, 1.443, 0.02, 'full-white current')
    kit.ok(kit.hasIssue('R:supply'), 'over-500 mA supply warning')
    s.stop()
    kit.scene({ U: 'arduino', R: 'neopixel_ring_24' }, [['U:5V', 'R:5V'], ['R:GND', 'U:GND1'], ['U:D6', 'R:DIN']])
    kit.step(0.05)
    // Idle only: 24 × 1 mA.
    kit.near(kit.state('R').current, 0.024, 0.001, 'idle current')
  },
}] }))

export default withPowerTest
