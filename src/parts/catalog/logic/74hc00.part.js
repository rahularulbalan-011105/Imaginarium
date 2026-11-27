// 74HC00 — Quad 2-input NAND (Tinkercad "Quad NAND Gate 74HC00"). DIP-14, real
// pinout (NXP/TI 74HC00 datasheet): 1A 1B 1Y 2A 2B 2Y GND 3Y 3A 3B 4Y 4A 4B VCC
// (pins 1…14), VCC = 14, GND = 7. NAND is universal: the classic XOR from four
// NANDs is checked below.
import { makeGatePart } from './gate74hc.js'

const nand = (a, b) => (a & b) ? 0 : 1

export default makeGatePart({
  type: 'logic_74hc00', chip: '74HC00', label: 'Quad NAND Gate 74HC00', tinkercad: 'Quad NAND Gate 74HC00', fnName: 'NAND',
  names: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'],
  gates: [['1A', '1B', '1Y'], ['2A', '2B', '2Y'], ['3A', '3B', '3Y'], ['4A', '4B', '4Y']],
  fn: nand,
  extraTests: [
    {
      name: 'XOR built from four NANDs: n = A NAND B, Y = (A NAND n) NAND (B NAND n)',
      run(kit) {
        kit.scene({ U: 'arduino', X: 'logic_74hc00', R: { type: 'resistor', resistance: 220 }, L: 'led' }, [
          ['X:VCC', 'U:5V'], ['X:GND', 'U:GND1'],
          ['X:1A', 'U:D2'], ['X:1B', 'U:D3'],                 // n = A NAND B
          ['X:2A', 'U:D2'], ['X:2B', 'X:1Y'],                 // p = A NAND n
          ['X:3A', 'U:D3'], ['X:3B', 'X:1Y'],                 // q = B NAND n
          ['X:4A', 'X:2Y'], ['X:4B', 'X:3Y'],                 // Y = p NAND q = A XOR B
          ['X:4Y', 'U:D4'], ['X:4Y', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2'],
        ])
        kit.pinMode(2, 'output'); kit.pinMode(3, 'output'); kit.pinMode(4, 'input')
        for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          kit.write(2, a); kit.write(3, b)
          kit.step(1 / 60)                                    // three gate levels settle inside one solve
          kit.equal(kit.digitalRead(4), a ^ b, `XOR(${a},${b})`)
          if (a ^ b) kit.ok(kit.led.L > 100, `LED lit for ${a}${b}`)
          else kit.ok(!(kit.led.L > 0), `LED dark for ${a}${b}`)
        }
      },
    },
  ],
})
