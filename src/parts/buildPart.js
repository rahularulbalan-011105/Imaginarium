// Wraps a catalogue part's model in the root group ObjectManager tracks, with
// the pin table WireManager reads (userData.dynamicPins) and a key that tells
// updateMesh when a property change needs a rebuild.
// Named import only: passing the THREE namespace around as a value would stop
// tree-shaking and pull all of three.js into the startup bundle (+100 KB).
import { Group } from 'three'
import { partPinDefs3D } from './registry.js'
import { propOf } from './definePart.js'

export function partModelKey(part, obj) {
  return part.type + '|' + (part.rebuildOn ?? []).map(k => JSON.stringify(propOf(part, obj, k))).join('|')
}

export function buildPartObject(part, obj = {}) {
  const root = new Group()
  const model = part.build(obj)
  if (!model?.isObject3D) throw new Error(`[parts] ${part.type}.build() must return a THREE.Object3D`)
  model.name ||= 'model'
  root.add(model)
  root.userData.partKey = partModelKey(part, obj)
  root.userData.dynamicPins = partPinDefs3D(part.type, obj)
  root.userData.labelOffset = part.labelOffset ?? { dx: 0, dy: 0.3, dz: 0 }
  if (part.labelScale) root.userData.labelScale = part.labelScale
  return root
}
