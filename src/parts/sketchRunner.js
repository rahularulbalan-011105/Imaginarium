// ─────────────────────────────────────────────────────────────────────────────
// sketchRunner — runs an Arduino C++ sketch END TO END against a test kit,
// through the same pieces the app uses: arduinoParser (C++ → JS), the sandbox
// runtime from sketchSandbox.bootstrapHtml (with every catalogue part's
// library), and the kit's CircuitBridge (pins, solver, part handlers).
//
// The browser sandbox is an iframe talking by postMessage; here the same
// runtime script runs in a Function with a stub `parent` whose postMessage
// feeds the kit, and the per-frame input snapshot is pushed in exactly like
// runSketchSandboxed does. Used by the catalogue tests (tests/parts).
// ─────────────────────────────────────────────────────────────────────────────
import { parseAndTranspile } from '../utils/arduinoParser.js'
import { bootstrapHtml } from '../managers/sketchSandbox.js'
import { partSandboxRuntime, partSandboxConsts } from '../circuit/simBridge.js'

const UNO_CONSTS = 'const A0=14,A1=15,A2=16,A3=17,A4=18,A5=19,INPUT_PULLUP=2,LED_BUILTIN=13;'
// Same values SimulationManager prepends for an ATtiny85 sketch.
const ATTINY_CONSTS = 'const A0=5,A1=2,A2=4,A3=3,PB0=0,PB1=1,PB2=2,PB3=3,PB4=4,PB5=5,INPUT_PULLUP=2,LED_BUILTIN=1;'
const MICROBIT_CONSTS = 'const PIN_BUTTON_A=5,PIN_BUTTON_B=11,LED_ON=1,LED_OFF=0,INPUT_PULLUP=2,A0=0,A1=1,A2=2;'
const MODE = { 0: 'input', 1: 'output', 2: 'pullup' }

/**
 * @param {object} kit       createKit() with a scene already built
 * @param {string} cpp       the sketch
 * @returns {{ run(ms): Promise<void>, stop(), out: string[], error: string|null }}
 */
export function runSketch(kit, cpp) {
  const { code, error } = parseAndTranspile(cpp, new Set())
  if (error) throw new Error('transpile failed: ' + error)
  const html = bootstrapHtml(code, `${kit.board === 'attiny85' ? ATTINY_CONSTS : kit.board === 'microbit' ? MICROBIT_CONSTS : UNO_CONSTS}\n${partSandboxConsts()}\nIN.parts = ${JSON.stringify(kit.input())};\nIN.i2cBus = ${JSON.stringify(kit.bridge.i2cBus())};`, partSandboxRuntime())
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/<\\\/script>/g, '</script>')

  const out = []
  const state = { error: null }
  let onMsg = null
  const parent = {
    postMessage(d) {
      if (!d || typeof d !== 'object') return
      if (d.t === 'err') { state.error = String(d.m); return }
      if (d.t !== 'out') return
      const a = d.a
      switch (d.f) {
        case 'pinMode': kit.pinMode(a[0], MODE[a[1]] ?? 'input'); break
        case 'digitalWrite': kit.write(a[0], a[1]); break
        case 'analogWrite': kit.analogWrite(a[0], a[1]); break
        case 'shiftOut': kit.bridge.shiftOut(a[0], a[1], a[2], a[3]); break
        case 'part': kit.call(a[0], a[1], a[2] ?? []); break
        case 'serial': out.push(String(a[0])); break
        case 'servoAttach': kit.servo[a[0]] ??= null; break
        case 'servoWrite': kit.servo[a[0]] = a[1]; break
        default: break
      }
    },
  }
  const addEventListener = (type, fn) => { if (type === 'message') onMsg = fn }
  // eslint-disable-next-line no-new-func
  new Function('parent', 'addEventListener', 'performance', script)(parent, addEventListener, globalThis.performance)

  const push = () => {
    const dread = {}, aread = {}
    for (const p of kit.bridge.circuitPins()) { dread[p] = kit.digitalRead(p); aread[p] = kit.analogRead(p) }
    onMsg?.({ data: { t: 'in', s: { aread, dread, pulse: kit.bridge.pulses(), enc: {}, lib: {}, parts: kit.input(), i2cBus: kit.bridge.i2cBus(), shiftIn: {}, i2c: [], ctrl: {}, serialIn: '', quad: {}, uno: true } } })
  }
  return {
    out,
    get error() { return state.error },
    /** Let the sketch run for `ms` of real time, stepping the circuit each ~16 ms. */
    async run(ms = 100) {
      const end = Date.now() + ms
      push()
      while (Date.now() < end) {
        await new Promise(r => setTimeout(r, 16))
        kit.step(1 / 60)
        push()
      }
      if (state.error) throw new Error('sketch runtime error: ' + state.error)
    },
    stop() { onMsg?.({ data: { t: 'stop' } }) },
  }
}
