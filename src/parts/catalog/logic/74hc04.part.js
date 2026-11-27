// 74HC04 — Hex Inverter 74HC04 (Tinkercad "Hex Inverter 74HC04"). DIP-14, real pinout (NXP/TI 74HC04 datasheet):
// 1A 1Y 2A 2Y 3A 3Y GND 4Y 4A 5Y 5A 6Y 6A VCC  (pins 1…14), VCC = 14, GND = 7.
import { makeGatePart } from './gate74hc.js'

export default makeGatePart({
  type: 'logic_74hc04', chip: '74HC04', label: 'Hex Inverter 74HC04', tinkercad: 'Hex Inverter 74HC04', fnName: 'NOT', desc: '6× inverter (NOT) · DIP-14 · 2–6 V CMOS',
  names: ["1A","1Y","2A","2Y","3A","3Y","GND","4Y","4A","5Y","5A","6Y","6A","VCC"],
  gates: [["1A","1Y"],["2A","2Y"],["3A","3Y"],["4A","4Y"],["5A","5Y"],["6A","6Y"]],
  fn: (a) => (a ? 0 : 1),
})
