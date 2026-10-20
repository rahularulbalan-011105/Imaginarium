// Decode TopoJSON land-110m into plain lon/lat rings for the dashboard globe.
const fs = require('fs')
const t = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const { scale: s, translate: tr } = t.transform

const arcs = t.arcs.map((arc) => {
  let x = 0, y = 0
  return arc.map(([dx, dy]) => {
    x += dx; y += dy
    return [x * s[0] + tr[0], y * s[1] + tr[1]]
  })
})
const arcOf = (i) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i])

const rings = []
for (const g of t.objects.land.geometries) {
  const polys = g.type === 'MultiPolygon' ? g.arcs : [g.arcs]
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = []
      for (const idx of ring) {
        const a = arcOf(idx)
        for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k])
      }
      // 1 decimal ≈ 11 km — far finer than a 600 px globe can show.
      const r = pts.map(([lon, lat]) => [Math.round(lon * 10) / 10, Math.round(lat * 10) / 10])
      const dedup = r.filter((p, i) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1])
      if (dedup.length > 3) rings.push(dedup)
    }
  }
}
rings.sort((a, b) => b.length - a.length)
const body = rings.map((r) => '[' + r.map(([a, b]) => a + ',' + b).join(',') + ']').join(',\n')
const out = `// Simplified world land outlines for the dashboard globe.
//
// Source: Natural Earth 110m land (public domain), via world-atlas@2.0.2
// (ISC). Decoded from TopoJSON to flat [lon, lat, lon, lat, …] rings and
// rounded to 0.1° (~11 km) — far finer than the globe can draw, and small
// enough to inline so the dashboard needs no map server or tile provider.
//
// Regenerate: tools/build-world-rings.cjs
export const LAND_RINGS = [
${body}
]
`
fs.writeFileSync(process.argv[3], out)
console.log('rings', rings.length, 'points', rings.reduce((n, r) => n + r.length, 0), 'bytes', out.length)
