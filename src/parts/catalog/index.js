// The whole catalogue as one lazy chunk (see registry.loadParts). Every
// *.part.js under this folder default-exports a definePart() result, or an
// array of them (a family such as the NeoPixel ring sizes).
const modules = import.meta.glob('./**/*.part.js', { eager: true })

export default Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([path, mod]) => {
    const list = Array.isArray(mod.default) ? mod.default : [mod.default]
    for (const p of list) if (!p?.type) throw new Error(`[parts] ${path}: default export is not a definePart() result`)
    return list
  })
