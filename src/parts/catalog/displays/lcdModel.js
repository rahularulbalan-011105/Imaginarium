// Shared 3D model of a 1602 (16 × 2) character LCD module: 80 × 36 mm green
// PCB, 71.2 × 24.2 mm black bezel, 64.5 × 16 mm viewing area, 16-hole header
// along the top edge (pin 1 at 8 mm from the left edge, 2.5 mm from the top).
// Not a part file. Used by lcd_16x2 and lcd_16x2_i2c.
import { Mesh, PlaneGeometry, CanvasTexture, SRGBColorSpace } from 'three'
import { mat, box, PCB_T, PITCH, GOLD } from '../../model.js'

export const LCD_W = 8.0, LCD_D = 3.6, BEZEL_H = 0.7
export const HDR_Z = -LCD_D / 2 + 0.25
export const HDR_X0 = -LCD_W / 2 + 0.8
export const LCD_PIN_NAMES = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K']

/** Add PCB + bezel + screen to g with the PCB underside at y = pcbY. */
export function lcdBody(g, pcbY) {
  const top = pcbY + PCB_T
  g.add(box(LCD_W, PCB_T, LCD_D, mat(0x1f6f3a, { rough: 0.5 }), 0, pcbY + PCB_T / 2, 0))
  g.add(box(7.12, BEZEL_H, 2.42, mat(0x151515, { metal: 0.3, rough: 0.6 }), 0, top + BEZEL_H / 2, 0.15))
  const screen = new Mesh(new PlaneGeometry(6.45, 1.6), mat(0x1b2f8a, { rough: 0.3, emissive: 0x000000 }))
  screen.rotation.x = -Math.PI / 2
  screen.position.set(0, top + BEZEL_H + 0.002, 0.15)
  screen.name = 'screen'
  g.add(screen)
  // Mounting holes (corner rings) + backlight edge strip at the left.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.25, 0.01, 0.25, GOLD(), sx * 3.75, top + 0.005, sz * 1.55))
  g.add(box(0.3, 0.3, 1.6, mat(0xe5e7eb, { rough: 0.6 }), -3.7, top + 0.15, 0.15))
  return top
}
export function hdrX(i) { return HDR_X0 + i * PITCH }
export const makeLcdTexture = (canvas) => { const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace; return t }
