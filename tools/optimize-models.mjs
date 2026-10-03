// Build the runtime GLBs in public/models/ from the source GLBs in assets-src/models/.
//
//   node tools/optimize-models.mjs            (all models)
//   node tools/optimize-models.mjs servo subo (just these)
//
// Pipeline per model (glTF-Transform CLI via npx — a dev-time tool, not an app dependency):
//   1. prune      drop unused vertex attributes (e.g. the Arduino had 9 UV sets/vertex)
//   2. resize     cap textures at 1024² (2048² board textures cost ~22 MB of VRAM each)
//   3. webp       re-encode textures as WebP (smaller download, same GPU format)
//   4. meshopt    meshopt compression + quantisation (16-bit positions: ~1e-5 of the
//                 model size — pin anchoring/horn detection read world-space boxes, which
//                 are unchanged within that tolerance)
// The runtime loader registers three's MeshoptDecoder (modelLoader.js).
// Keep the originals in assets-src/models/ — they are the editable source of truth.
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'

const SRC = 'assets-src/models'
const OUT = 'public/models'
const CLI = ['-y', '@gltf-transform/cli@4']
const only = process.argv.slice(2)

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const run = (...args) => execFileSync(npx, [...CLI, ...args], { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' })

mkdirSync(OUT, { recursive: true })
const tmp = join(tmpdir(), 'constructa-models')
mkdirSync(tmp, { recursive: true })

const files = readdirSync(SRC).filter(f => f.endsWith('.glb') && (!only.length || only.includes(basename(f, '.glb'))))
let before = 0, after = 0
for (const f of files) {
  const src = join(SRC, f), name = basename(f, '.glb')
  const a = join(tmp, `${name}.1.glb`), b = join(tmp, `${name}.2.glb`), c = join(tmp, `${name}.3.glb`)
  run('prune', src, a, '--keep-attributes', 'false')
  run('resize', a, b, '--width', '1024', '--height', '1024')
  run('webp', b, c)
  run('meshopt', c, join(OUT, f), '--level', 'medium',
    '--quantize-position', '16', '--quantize-normal', '10', '--quantize-texcoord', '12')
  const s0 = statSync(src).size, s1 = statSync(join(OUT, f)).size
  before += s0; after += s1
  console.log(`${f.padEnd(24)} ${(s0 / 1024).toFixed(0).padStart(6)} KB → ${(s1 / 1024).toFixed(0).padStart(6)} KB  (${(100 * s1 / s0).toFixed(0)}%)`)
  for (const t of [a, b, c]) if (existsSync(t)) rmSync(t)
}
console.log(`TOTAL ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`)
