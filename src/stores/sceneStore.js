import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { runBoolean, buildUnionMembers, unionWorldGeoJSONs } from '../utils/csg.js'
import { trackEvent } from '../utils/utmTracking.js'
import { WHEEL_DEFAULTS, CASTER_DEFAULTS, WHEEL_RIM_COLOR, WHEEL_TYRE_COLOR, CASTER_BODY_COLOR, CASTER_BALL_COLOR } from '../utils/wheels.js'
import { ELECTRONICS_TYPES, LEGACY_SENSOR_TYPES } from '../utils/elecTypes.js'
import { getPart, partDefaults } from '../parts/registry.js'
import { shapeDefaults } from '../utils/shapes3d.js'
import { useToolsStore } from './toolsStore.js'
import { placeOnWorkplane } from '../utils/workplane.js'

// Default object names for parts whose type id isn't their real name.
const PART_NAMES = { l298n: 'L298N', uln2003: 'ULN2003', esp32: 'ESP32', servo_cr: 'ContServo', motor_enc: 'EncMotor', pca9685: 'PCA9685', gripper: 'Gripper' }

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

  // `overrides` (optional): extra fields merged into the new object — used by
  // component variants (utils/componentVariants.js) to stamp an SG90's name,
  // size and physics onto a plain `servo`. id/type are never overridden.
  addObject: (type, position, overrides) => {
    // Sensors/peripherals are electronics too — they must be on this list so they
    // get an electronics spawn offset (NOT the {0,1,0} default, which buries every
    // one inside the object already at the origin) + the electronics grey colour.
    const SENSOR_TYPES = LEGACY_SENSOR_TYPES.concat(['oled', 'buzzer'])
    const isElectronics = ELECTRONICS_TYPES.has(type)
    const part = getPart(type)
    const mechTypes = ['gear', 'bolt', 'screw', 'wheel', 'caster']
    const isMech = mechTypes.includes(type)
    const isWeapon = typeof type === 'string' && type.startsWith('weapon_')
    const count = get().objects.filter(o => o.type === type).length
    const defaultPos = isWeapon             ? { x: count * 4 - 2, y: 2, z: -3 }
      : type === 'arduino'                  ? { x: count * 8 - 4, y: 0.15, z: -5 }
      : type === 'subo'                   ? { x: count * 8 - 4, y: 0.15, z: -5 }
      : type === 'esp32'                  ? { x: count * 8 - 4, y: 0.15, z: -5 }
      : type === 'motor_bo'               ? { x: count * 8 - 4, y: 0.15, z: 5  }
      : type === 'motor_dc'               ? { x: count * 8 - 4, y: 0.15, z: 8  }
      : type === 'motor'                  ? { x: count * 8 - 4, y: 0.15, z: 5  }
      : type === 'motor_enc'              ? { x: count * 8 - 4, y: 0.15, z: 11 }
      : type === 'led'                    ? { x: count * 3 - 3, y: 0.15, z: 0  }
      : type === 'servo'                  ? { x: count * 5 - 4, y: 0.15, z: 3  }
      : type === 'servo_cr'               ? { x: count * 4 - 4, y: 0.15, z: 7  }
      : type === 'gripper'                ? { x: 10 + count * 6, y: 0.62, z: 6 }
      // Motor driver: beside the board (boards spawn at z −5 from x −4).
      : type === 'l298n'                  ? { x: count * 6 + 4, y: 0.1,  z: -5 }
      // Stepper driver to the LEFT of the board (the L298N takes the right); the
      // stepper in front of it, plug toward the driver (model stands on y = 0).
      : type === 'uln2003'                ? { x: -12 - count * 5, y: 0.1, z: -10 }
      : type === 'pca9685'                ? { x: 4 + count * 8, y: 0.1, z: -10 }
      : type === 'stepper'                ? { x: -12 - count * 5, y: 0,   z: -3 }
      : SENSOR_TYPES.includes(type)       ? { x: count * 4 - 6, y: 1.2,  z: -9 }
      // Catalogue parts (src/parts): their own spawn spot, else a row in front of the board.
      : part                             ? { x: (part.spawn?.x ?? -6) + count * (part.spawn?.dx ?? 3), y: part.spawn?.y ?? 0.2, z: part.spawn?.z ?? 1 }
      // Wheel / caster: resting ON the grid (y = half their height), side by side.
      : type === 'wheel'                  ? { x: count * 2 + 6, y: WHEEL_DEFAULTS.wheelDiameter / 2, z: 4 }
      : type === 'caster'                 ? { x: count * 3 + 6, y: CASTER_DEFAULTS.casterHeight / 2, z: 8 }
      // Primitives: step each new same-type shape along X so two of a kind (e.g.
      // the tutorial's two wheels) don't spawn stacked on the exact same spot
      // (which buried them inside the chassis at the origin).
      : { x: count * 2.5, y: 1, z: 0 }
    // An explicit position wins; otherwise the default spot is laid onto the
    // active workplane (Tinkercad: new shapes land on the face you picked).
    const wp = position ? null : useToolsStore.getState().workplane
    const placed = placeOnWorkplane(wp, defaultPos)
    const pos = position ?? placed.position
    const color = isElectronics ? '#556677'
      : isWeapon                ? '#8a94a3'
      : type === 'wheel'        ? WHEEL_RIM_COLOR   // yellow rim; the tyre has its own tyreColor
      : type === 'caster'       ? CASTER_BODY_COLOR // silver body; the ball stays steel
      : isMech                  ? '#9ca3af'
      : PALETTE[paletteIdx++ % PALETTE.length]
    const displayCount = count + 1
    const gearDefaults = type === 'gear' ? { teeth: 12, module: 0.25, faceWidth: 0.5, bore: 0 } : {}
    const textDefaults = type === 'text' ? { textContent: 'Text', textSize: 1, textHeight: 0.4 } : {}
    const partProps = part ? partDefaults(type) : type === 'note' ? { noteText: 'Note' } : shapeDefaults(type)
    const roundDefaults = type === 'wheel' ? { ...WHEEL_DEFAULTS, tyreColor: WHEEL_TYRE_COLOR } : type === 'caster' ? { ...CASTER_DEFAULTS, ballColor: CASTER_BALL_COLOR } : {}
    const obj = {
      id: uuidv4(),
      // Part numbers keep their real spelling (L298N_1, not L298n_1).
      name: `${PART_NAMES[type] ?? part?.shortName ?? type.charAt(0).toUpperCase() + type.slice(1)}_${displayCount}`,
      type,
      ...partProps,
      ...gearDefaults,
      ...textDefaults,
      ...roundDefaults,
      position: { ...pos },
      rotation: placed.rotation,
      scale: { x: 1, y: 1, z: 1 },
      color,
      // Wheel rim/tyre and caster body use 'standard': fully metallic parts
      // render near-black here (no environment map to reflect).
      material: ((isMech && type !== 'wheel' && type !== 'caster') || isWeapon) ? 'metallic' : 'standard',
      visible: true,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
    if (overrides) Object.assign(obj, overrides, { id: obj.id, type })
    // Mecanum wheels are numbered per hand (MecanumA_1, MecanumB_1 …) — the hand matters when building.
    if (obj.wheelStyle === 'mecanum' && !overrides?.name) {
      const n = get().objects.filter(o => o.wheelStyle === 'mecanum' && o.rollerHand === obj.rollerHand).length + 1
      obj.name = `Mecanum${obj.rollerHand ?? 'A'}_${n}`
    }
    set((state) => ({ objects: [...state.objects, obj] }))
    // Analytics: user added a shape/part — carry the running scene count so the
    // dashboard can show "shapes in the pane" (peak per user).
    try { trackEvent('shape_added', { type, count: get().objects.length }) } catch (e) { /* ignore */ }
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

  // Add a CSG result object (stores serialized geometry). unionMembers (optional)
  // records the flat leaf members so a union can be de-unioned later.
  addCSGObject: (name, geometryJSON, color, position, rotation, scale, unionMembers) => {
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
      ...(Array.isArray(unionMembers) && unionMembers.length ? { unionMembers } : {}),
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
    // Capture flat union members (def + world geometry) BEFORE running the CSG,
    // while both operands are still live meshes — only for a true union.
    const unionMembers = op === 'union' ? buildUnionMembers(a, b) : null
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
      ...(unionMembers?.length ? { unionMembers } : {}),
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

  // ── De-union ────────────────────────────────────────────────────────────────
  // The flat leaf members of a union (unionMembers) let us reverse it. Each member
  // has { def, geo } — the original object def + its world geometry at union time.
  restoreMemberDef: (m) => ({
    ...JSON.parse(JSON.stringify(m.def)),
    id: uuidv4(),
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  }),

  // Split a union back into ALL of its member objects.
  deUnionAll: (unionId) => {
    const { objects, restoreMemberDef } = get()
    const U = objects.find((o) => o.id === unionId)
    if (!U || !Array.isArray(U.unionMembers) || U.unionMembers.length === 0) return null
    const restored = U.unionMembers.map(restoreMemberDef)
    set((state) => ({
      objects: [...state.objects.filter((o) => o.id !== unionId), ...restored],
      selectedId: restored[0]?.id ?? null,
      secondaryId: null,
    }))
    return restored
  },

  // Extract ONE member out of a union: restore it as a standalone object, and
  // rebuild the union from the remaining members (or restore the last one too).
  deUnionMember: (unionId, memberId) => {
    const { objects, restoreMemberDef } = get()
    const U = objects.find((o) => o.id === unionId)
    if (!U || !Array.isArray(U.unionMembers)) return null
    const idx = U.unionMembers.findIndex((m) => m.def?.id === memberId)
    if (idx < 0) return null
    const remaining = U.unionMembers.filter((_, i) => i !== idx)
    const extracted = restoreMemberDef(U.unionMembers[idx])

    if (remaining.length <= 1) {
      // 0 or 1 left → no union anymore; restore whatever remains as standalone.
      const solos = remaining.map(restoreMemberDef)
      set((state) => ({
        objects: [...state.objects.filter((o) => o.id !== unionId), ...solos, extracted],
        selectedId: extracted.id,
        secondaryId: null,
      }))
      return extracted
    }

    // Rebuild the union of the remaining members from their captured world geometry.
    const rebuilt = unionWorldGeoJSONs(remaining.map((m) => m.geo))
    if (!rebuilt) {
      // Couldn't rebuild (e.g. an old union with no captured geometry) — fall back
      // to splitting everything so the click still does something visible.
      const solos = remaining.map(restoreMemberDef)
      set((state) => ({
        objects: [...state.objects.filter((o) => o.id !== unionId), ...solos, extracted],
        selectedId: extracted.id,
        secondaryId: null,
      }))
      return extracted
    }
    const newUnion = {
      ...JSON.parse(JSON.stringify(U)),
      id: uuidv4(),                                   // new id → fresh mesh rebuild
      geometryJSON: rebuilt.geometryJSON,
      position: rebuilt.position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      unionMembers: remaining,
      groupMembers: remaining.map((m) => m.def),      // keep legacy ungroup working
      metadata: { ...U.metadata, updatedAt: new Date().toISOString() },
    }
    set((state) => ({
      objects: [...state.objects.filter((o) => o.id !== unionId), newUnion, extracted],
      selectedId: newUnion.id,
      secondaryId: null,
    }))
    return extracted
  },

  clearScene: () => set({ objects: [], selectedId: null, secondaryId: null, standaloneIds: [] }),

  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  toggleAxes: () => set((s) => ({ axesVisible: !s.axesVisible })),

  setObjects: (objects) => set({ objects }),
  setProjectName: (name) => set({ projectName: name }),
  setProjectId: (id) => set({ projectId: id }),
}))
