// AA battery holders with red (+) and black (−) flying leads (Tinkercad
// "AA Battery Pack (2xAA)" and "AA Battery Pack (4xAA)"). Cells sit side by
// side and are wired in SERIES by the holder's springs/straps, so the EMFs and
// internal resistances add: per cell 1.5 V, 0.15 Ω (Energizer E91) plus
// ≈0.05 Ω of spring contact → 2×AA = 3.0 V / 0.4 Ω, 4×AA = 6.0 V / 0.8 Ω.
// Holder sizes: 2×AA ≈ 58 × 31 × 16 mm, 4×AA flat ≈ 62 × 58 × 16 mm, plus
// ≈20 mm of lead out of the − end (tinned tips for a breadboard).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, box, cyl, at, lead, TIN } from '../../model.js'
import { batterySim, batteryReadout } from './battery.js'

const CELL_V = 1.5, CELL_R = 0.15 + 0.05, I_MAX = 2.0
const AA_R = 0.725, AA_L = 5.05, LEAD_L = 2.0, H = 1.6, LEAD_Y = 0.5

function packPart({ n, type, tinkercad, holderX, holderZ }) {
  const V = n * CELL_V, rInt = +(n * CELL_R).toFixed(3)
  const hx0 = -(holderX + LEAD_L) / 2 + LEAD_L      // holder's −X edge (leads leave from here)
  const hcx = hx0 + holderX / 2
  const tipX = hx0 - LEAD_L
  const wireZ = 0.3
  return definePart({
    type,
    label: `AA Battery Pack (${n}xAA)`,
    shortName: `${n}xAA`,
    tinkercad,
    category: 'power',
    icon: '🔋',
    desc: `${n} × AA in series · ${V.toFixed(1)} V · ≈${rInt} Ω`,
    purpose: `${n} AA cells in a holder, in series: ${V.toFixed(1)} V between the red (+) and black (−) leads. Good for motors, LED strings${n >= 4 ? ' and an Arduino through VIN (marginal) or straight to 5V-tolerant loads' : ' and 3 V logic'}. Can deliver amps — never join the leads.`,
    usage: n >= 4 ? 'robot motors · servos (6 V) · portable projects' : 'LEDs · small motors · 3 V sensors',
    spec: {
      dims_mm: { w: (holderX + LEAD_L) * 10, h: H * 10, d: holderZ * 10 }, mass_kg: 0.01 + n * 0.023,
      cells: n, chemistry: 'alkaline AA (LR6) in series', emf_V: V, rInt_ohm: rInt, capacity_mAh: 2500,
      summary: `${n} × 1.5 V in series = ${V.toFixed(1)} V behind ${rInt} Ω (cells + spring contacts).`,
    },
    groundPin: 'NEG',
    pins: [
      { name: 'POS', kind: 'power', label: '+ red', x: tipX, y: LEAD_Y, z: -wireZ, r: 0.1 },
      { name: 'NEG', kind: 'gnd', label: '− black', x: tipX, y: LEAD_Y, z: wireZ, r: 0.1, ldy: 0.25 },
    ],
    build() {
      const g = new Group()
      const black = mat(0x141414, { rough: 0.85 })
      // Open-top moulded holder: floor + four walls.
      g.add(box(holderX, 0.12, holderZ, black, hcx, 0.06, 0))
      for (const s of [-1, 1]) {
        g.add(box(holderX, H * 0.75, 0.1, black, hcx, H * 0.375, s * (holderZ / 2 - 0.05)))
        g.add(box(0.15, H * 0.75, holderZ, black, hcx + s * (holderX / 2 - 0.075), H * 0.375, 0))
      }
      // Cells side by side along Z, alternating direction (series strap path).
      const pitch = (holderZ - 0.3) / n
      for (let i = 0; i < n; i++) {
        const z = -holderZ / 2 + 0.15 + pitch * (i + 0.5)
        const flip = i % 2 ? -1 : 1
        g.add(at(cyl(AA_R, AA_L * 0.7, mat(0x1b1b1b, { rough: 0.45, metal: 0.3 }), { axis: 'x', seg: 24 }), hcx - flip * AA_L * 0.15, 0.12 + AA_R, z))
        g.add(at(cyl(AA_R, AA_L * 0.3, mat(0xb8732e, { rough: 0.35, metal: 0.5 }), { axis: 'x', seg: 24 }), hcx + flip * AA_L * 0.35, 0.12 + AA_R, z))
        // spring on the − end, flat contact on the + end
        g.add(at(cyl(0.3, 0.25, TIN(), { axis: 'x', seg: 12 }), hcx - flip * (AA_L / 2 + 0.1), 0.12 + AA_R, z))
      }
      // Red and black leads out of the −X wall, tinned tips.
      for (const [z, color] of [[-wireZ, 0xd32f2f], [wireZ, 0x111111]]) {
        g.add(lead([hx0 + 0.1, LEAD_Y, z], [tipX + 0.5, LEAD_Y, z], { r: 0.06, material: mat(color, { rough: 0.6 }) }))
        g.add(lead([tipX + 0.5, LEAD_Y, z], [tipX, LEAD_Y, z], { r: 0.035 }))
      }
      return g
    },
    sim: { ...batterySim({ V, rInt, iMax: I_MAX, what: `${n}×AA pack` }), readout: batteryReadout },
    tests: n === 2 ? [
      {
        name: 'red LED + 220 Ω from 3 V: I = (3 − 1.72 V) / 220.4 Ω ≈ 5.8 mA',
        run(kit) {
          kit.scene({ P: type, R: { type: 'resistor', resistance: 220 }, L: 'led' },
            [['P:POS', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'P:NEG']])
          kit.step(0.05)
          kit.near(kit.state('L').current, 0.0058, 0.0002, 'LED current')
        },
      },
      {
        name: 'a 9 V battery in parallel forces current backwards into the pack: (9 − 3) / (1.7 + 0.4) = 2.86 A',
        run(kit) {
          kit.scene({ P: type, B: 'battery_9v' }, [['P:POS', 'B:POS'], ['P:NEG', 'B:NEG']])
          kit.step(0.05)
          kit.near(kit.state('P').current, -6 / 2.1, 0.01, 'current into the pack')
          kit.ok(kit.hasIssue('P:reverse'), 'reverse-current warning on the pack')
          kit.ok(kit.hasIssue('B:overload'), 'the 9 V battery is overloaded')
        },
      },
    ] : [
      {
        name: '8 Ω DC motor on 6 V: I = 6 / 8.8 = 0.682 A, motor sees 5.45 V',
        run(kit) {
          kit.scene({ P: type, M: 'motor_dc' }, [['P:POS', 'M:TERM_A'], ['M:TERM_B', 'P:NEG']])
          kit.step(0.05)
          kit.near(kit.state('P').current, 6 / 8.8, 1e-4)
          kit.near(kit.state('M').voltage, 6 * 8 / 8.8, 1e-3)
          kit.ok(kit.state('M').speed > 200, 'motor runs near full speed')
        },
      },
      {
        name: 'leads touching: 6 / 0.8 = 7.5 A short circuit',
        run(kit) {
          kit.scene({ P: type }, [['P:POS', 'P:NEG']])
          kit.step(0.05)
          kit.near(kit.state('P').current, 7.5, 0.01)
          kit.ok(kit.hasIssue('P:short'))
        },
      },
    ],
  })
}

export default [
  packPart({ n: 2, type: 'battery_pack_2aa', tinkercad: 'AA Battery Pack (2xAA)', holderX: 5.8, holderZ: 3.1 }),
  packPart({ n: 4, type: 'battery_pack_4aa', tinkercad: 'AA Battery Pack (4xAA)', holderX: 6.2, holderZ: 5.8 }),
]
