// 74HC08 — Quad AND Gate 74HC08 (Tinkercad "Quad AND Gate 74HC08"). DIP-14, real pinout (NXP/TI 74HC08 datasheet):
// 1A 1B 1Y 2A 2B 2Y GND 3Y 3A 3B 4Y 4A 4B VCC  (pins 1…14), VCC = 14, GND = 7.
import { makeGatePart } from './gate74hc.js'

export default makeGatePart({
  type: 'logic_74hc08', chip: '74HC08', label: 'Quad AND Gate 74HC08', tinkercad: 'Quad AND Gate 74HC08', fnName: 'AND',
  names: ["1A","1B","1Y","2A","2B","2Y","GND","3Y","3A","3B","4Y","4A","4B","VCC"],
  gates: [["1A","1B","1Y"],["2A","2B","2Y"],["3A","3B","3Y"],["4A","4B","4Y"]],
  fn: (a, b) => a & b,
})
