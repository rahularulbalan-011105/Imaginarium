// 74HC02 — Quad NOR Gate 74HC02 (Tinkercad "Quad NOR Gate 74HC02"). DIP-14, real pinout (NXP/TI 74HC02 datasheet):
// 1Y 1A 1B 2Y 2A 2B GND 3A 3B 3Y 4A 4B 4Y VCC  (pins 1…14), VCC = 14, GND = 7.
import { makeGatePart } from './gate74hc.js'

export default makeGatePart({
  type: 'logic_74hc02', chip: '74HC02', label: 'Quad NOR Gate 74HC02', tinkercad: 'Quad NOR Gate 74HC02', fnName: 'NOR',
  names: ["1Y","1A","1B","2Y","2A","2B","GND","3A","3B","3Y","4A","4B","4Y","VCC"],
  gates: [["1A","1B","1Y"],["2A","2B","2Y"],["3A","3B","3Y"],["4A","4B","4Y"]],
  fn: (a, b) => (a | b) ? 0 : 1,
})
