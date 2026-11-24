// Browser-side half of tools/models/export-model.cjs: build a model from its
// `<name>.model.js` source and export it as a binary glTF (GLB), base64-encoded
// so Playwright can hand it back to Node. Runs inside the Vite dev server, so
// `three` resolves exactly as in the app and canvas textures (silkscreen etc.)
// can be drawn.
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

export async function exportModelGLB(name) {
  const mod = await import(/* @vite-ignore */ `./${name}.model.js`)
  const build = Object.values(mod).find((v) => typeof v === 'function' && /^build/.test(v.name))
  if (!build) throw new Error(`${name}.model.js exports no build*() function`)
  const root = build()
  root.updateMatrixWorld(true)
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize: 2048 })
  let bin = ''
  const bytes = new Uint8Array(glb)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  let meshes = 0, tris = 0
  root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 } })
  return { base64: btoa(bin), bytes: bytes.length, meshes, tris: Math.round(tris) }
}
