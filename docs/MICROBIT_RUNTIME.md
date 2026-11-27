# micro:bit support: runtime evaluation

**Question:** what would it take to simulate a BBC micro:bit, which Tinkercad lists next to
the Uno, in a simulator built around an Arduino C++ transpiler?

## What has to work

The micro:bit V2 (nRF52833, 3.3 V) has:
- a 5×5 LED matrix
- buttons A and B, and a touch logo
- an edge connector: P0–P2 as big rings, plus 3V and GND, with P3–P20 on the fine pads
- an accelerometer and compass
- a speaker and microphone

People program it in MakeCode (blocks or TypeScript) or MicroPython. In the simulator, its
pins must join the same nets as every other part. That means the runtime has to drive
`CircuitBridge` (pin writes and modes, `digitalRead` and `analogRead` through the solver),
just as an Arduino sketch does.

## Options

| | Runtime | Pros | Cons | Effort |
|---|---|---|---|---|
| **A** | Arduino core for nRF5 (sandeepmistry `arduino-nRF5`, Adafruit `Adafruit_Microbit` library), run by the existing transpiler and sandbox | Real firmware path: a micro:bit can be flashed from the Arduino IDE. Reuses the parser, sandbox, solver, diagnostics and Blockly with no new dependency. Fits the offline Electron build and strict CSP. | Not the language beginners use on a micro:bit (MakeCode / MicroPython) | Small: a board model (pin map, 3.3 V), the part, a 5×5 matrix + buttons library shim, tests |
| **B** | MicroPython compiled to WebAssembly (`@micropython/micropython-webassembly-pyscript`, MIT, ≈300 KB wasm) inside the sketch sandbox, with a `microbit` module (`display`, `button_a`, `pin0` …) written in JS that forwards to the same `send()` channels the Arduino runtime uses | The language the micro:bit Foundation teaches. Real CPython-compatible semantics. Runs offline once bundled. | New dependency and a lazy wasm chunk. The `microbit` module has to be written and kept faithful. `sleep()` needs async bridging, as `delay()` has today. | Medium |
| **C** | Embed MakeCode (`pxt-microbit`, MIT) or its simulator | Exact MakeCode blocks and simulator | Very large (editor + compiler, several MB). Its simulator has its own board model and cannot see Constructa's circuit, so a micro:bit wired to an LED on the breadboard would not light it. Loading it from makecode.microbit.org breaks the offline build and the sandbox CSP. | Large, and the integration stays shallow |

## Recommendation

1. **Build A now.** It is the only option that makes a micro:bit a real participant in the
   circuit (wired parts respond through the solver) without a new dependency. It is honest:
   the code is genuine Arduino-nRF5 code.
2. **Build B next** as a second language for the same board part. The board model, pin map
   and part are shared with A. Only the runtime inside the sandbox differs, selected by the
   sketch's language.
3. **Do not build C.** Its simulator cannot be connected to the rest of the circuit.

Status: not implemented yet. The micro:bit row in `docs/parts-test-dashboard.html` stays
NOT TESTED until A lands with its tests.
