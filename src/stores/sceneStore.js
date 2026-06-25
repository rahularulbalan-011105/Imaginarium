import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { runBoolean } from '../utils/csg.js'

const PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4']
let paletteIdx = 0

export const useSceneStore = create((set, get) => ({
  objects: [],
  selectedId: null,
  gridVisible: true,
  axesVisible: true,
  projectId: uuidv4(),
  projectName: 'Untitled Project',
  // IDs of objects explicitly detached from a motor/servo — excluded from the robot drive group.
  standaloneIds: [],
  markStandalone:   (id) => set(s => ({ standaloneIds: [...s.standaloneIds.filter(i => i !== id), id] })),
  unmarkStandalone: (id) => set(s => ({ standaloneIds: s.standaloneIds.filter(i => i !== id) })),

  addObject: (type, position) => {
    const isElectronics = ['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo'].includes(type)
    const mechTypes = ['gear', 'bolt', 'screw']
    const isMech = mechTypes.includes(type)
    const count = get().objects.filter(o => o.type === type).length
    const defaultPos = type === 'arduino'  ? { x: count * 8 - 4, y: 0.15, z: -5 }
      : type === 'subo'                   ? { x: count * 8 - 4, y: 0.15, z: -5 }
      : type === 'motor_bo'               ? { x: count * 8 - 4, y: 0.15, z: 5  }
      : type === 'motor_dc'               ? { x: count * 8 - 4, y: 0.15, z: 8  }
      : type === 'motor'                  ? { x: count * 8 - 4, y: 0.15, z: 5  }
      : type === 'led'                    ? { x: count * 3 - 3, y: 0.15, z: 0  }
      : type === 'servo'                  ? { x: count * 5 - 4, y: 0.15, z: 3  }
      : { x: 0, y: 1, z: 0 }
    const pos = position ?? defaultPos
    const color = isElectronics ? '#556677'
      : isMech                  ? '#9ca3af'
      : PALETTE[paletteIdx++ % PALETTE.length]
    const displayCount = count + 1
    const gearDefaults = type === 'gear' ? { teeth: 12, module: 0.25, faceWidth: 0.5, bore: 0 } : {}
    const textDefaults = type === 'text' ? { textContent: 'Text', textSize: 1, textHeight: 0.4 } : {}
    const obj = {
      id: uuidv4(),
      name: `${type.charAt(0).toUpperCase() + type.slice(1)}_${displayCount}`,
      type,
      ...gearDefaults,
      ...textDefaults,
      position: { ...pos },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color,
      material: isMech ? 'metallic' : 'standard',
      visible: true,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
    set((state) => ({ objects: [...state.objects, obj] }))
    return obj
  },

  removeObject: (id) =>
    set((state) => ({
      objects: state.objects.filter((o) => o.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      secondaryId: state.secondaryId === id ? null : state.secondaryId,
    })),

  updateObject: (id, updates) =>
    set((state) => ({
      objects: state.objects.map((o) =>
        o.id === id
          ? { ...o, ...updates, metadata: { ...o.metadata, updatedAt: new Date().toISOString() } }
          : o
      ),
    })),

  // Secondary selection (for boolean ops)
  secondaryId: null,

  selectObject: (id) => set({ selectedId: id, secondaryId: null }),
  clearSelection: () => set({ selectedId: null, secondaryId: null }),
  setSecondaryId: (id) => set({ secondaryId: id }),
  clearSecondaryId: () => set({ secondaryId: null }),

  duplicateObject: (id) => {
    const obj = get().objects.find((o) => o.id === id)
    if (!obj) return null
    const dupe = {
      ...JSON.parse(JSON.stringify(obj)),
      id: uuidv4(),
      name: obj.name + '_copy',
      position: { x: obj.position.x + 2, y: obj.position.y, z: obj.position.z + 2 },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }
    set((state) => ({ objects: [...state.objects, dupe], selectedId: dupe.id }))
    return dupe
  },

  deleteSelected: () => {
    const { selectedId, removeObject } = get()
    if (selectedId) removeObject(selectedId)
  },

  // Add a CSG result object (stores serialized geometry)
  addCSGObject: (name, geometryJSON, color, position, rotation, scale) => {
    const obj = {
      id: uuidv4(),
      name,
      type: 'csg',
      position: position ?? { x: 0, y: 0, z: 0 },
      rotation: rotation ?? { x: 0, y: 0, z: 0 },
      scale: scale ?? { x: 1, y: 1, z: 1 },
      color: color ?? '#3b82f6',
      material: 'standard',
      visible: true,
      geometryJSON,
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }
    set((state) => ({ objects: [...state.objects, obj], selectedId: obj.id, secondaryId: null }))
    return obj
  },

  // Insert a fully-formed object (used by paste)
  insertObject: (obj) => {
    set((state) => ({ objects: [...state.objects, obj], selectedId: obj.id }))
  },

  // Toggle a shape between solid and "hole" (Tinkercad-style). Holes subtract from
  // solids when grouped, and render translucent so you can see through them.
  toggleHole: (id) =>
    set((state) => ({
      objects: state.objects.map((o) =>
        o.id === id ? { ...o, isHole: !o.isHole, metadata: { ...o.metadata, updatedAt: new Date().toISOString() } } : o
      ),
    })),

  // Group the two selected objects into one solid (Tinkercad "Group"):
  //  • two solids        → union
  //  • solid + hole       → solid minus the hole
  //  • two holes          → union, result stays a hole
  // The originals are stored on the result so Ungroup can restore them.
  groupSelected: () => {
    const { selectedId, secondaryId, objects } = get()
    const a = objects.find((o) => o.id === selectedId)
    const b = objects.find((o) => o.id === secondaryId)
    if (!a || !b || a.id === b.id) return null
    const aHole = !!a.isHole, bHole = !!b.isHole
    const op = aHole === bHole ? 'union' : (!aHole && bHole ? 'subtract' : 'subtractB')
    const res = runBoolean(a.id, b.id, op)
    if (!res) return null
    const members = [JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))]
    const groupCount = objects.filter((o) => Array.isArray(o.groupMembers)).length + 1
    const newObj = {
      id: uuidv4(),
      name: `Group_${groupCount}`,
      type: 'csg',
      position: res.position ?? { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: res.color ?? '#3b82f6',
      material: 'standard',
      visible: true,
      geometryJSON: res.geometryJSON,
      isHole: aHole && bHole,
      groupMembers: members,
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }
    set((state) => ({
      objects: [...state.objects.filter((o) => o.id !== a.id && o.id !== b.id), newObj],
      selectedId: newObj.id,
      secondaryId: null,
    }))
    return newObj
  },

  // Ungroup: replace a grouped object with fresh copies of its stored members.
  ungroupSelected: () => {
    const { selectedId, objects } = get()
    const o = objects.find((x) => x.id === selectedId)
    if (!o || !Array.isArray(o.groupMembers) || o.groupMembers.length === 0) return null
    const restored = o.groupMembers.map((m) => ({
      ...JSON.parse(JSON.stringify(m)),
      id: uuidv4(),
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }))
    set((state) => ({
      objects: [...state.objects.filter((x) => x.id !== o.id), ...restored],
      selectedId: restored[0]?.id ?? null,
      secondaryId: null,
    }))
    return restored
  },

  clearScene: () => set({ objects: [], selectedId: null, secondaryId: null, standaloneIds: [] }),

  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  toggleAxes: () => set((s) => ({ axesVisible: !s.axesVisible })),

  setObjects: (objects) => set({ objects }),
  setProjectName: (name) => set({ projectName: name }),
  setProjectId: (id) => set({ projectId: id }),
}))
