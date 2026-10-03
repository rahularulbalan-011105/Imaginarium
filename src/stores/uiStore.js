import { create } from 'zustand'

// Performance preferences (small, per-device) — localStorage, never the project.
const PERF_KEY = 'constructa.performance.v1'
const loadPerf = () => {
  try { return { profile: 'auto', overrides: {}, overlay: false, ...JSON.parse(localStorage.getItem(PERF_KEY) || '{}') } }
  catch { return { profile: 'auto', overrides: {}, overlay: false } }
}
const savePerf = (p) => { try { localStorage.setItem(PERF_KEY, JSON.stringify(p)) } catch { /* private mode */ } }

export const useUiStore = create((set, get) => ({
  // Performance: 'auto' | 'low' | 'medium' | 'high' + advanced overrides
  // { renderScale, shadows, antialias, physicsQuality, effects, telemetryHz }.
  perf: loadPerf(),
  setPerf: (patch) => {
    const perf = { ...get().perf, ...patch, overrides: { ...get().perf.overrides, ...(patch.overrides ?? {}) } }
    for (const [k, v] of Object.entries(perf.overrides)) if (v === null || v === undefined || v === '') delete perf.overrides[k]
    savePerf(perf)
    set({ perf })
  },

  activePanel: 'properties',
  sidebarCollapsed: false,
  statusMessage: 'Ready',
  transformMode: 'translate',
  showProjectDialog: false,

  // Snap-to-grid: 0 = free (off). Value is grid step in scene units; rotation in degrees.
  snapTranslate: 0,
  snapRotateDeg: 0,

  // 3D-printer build plate
  printBedVisible: false,
  printBedSizeMm: 220,

  // Smart alignment guides (Phase 5). `smartGuides` is the master toggle; the
  // two snap modes can be enabled independently (grid snap is `snapTranslate`).
  smartGuides: true,
  snapObject: true,    // center + edge alignment to other objects
  snapSurface: true,   // face / stacking (one object's face onto another's)

  surfaceToolActive: false,
  simActive: false,

  // Slice tool — draw an editable polyline, then cut the selected shape in two
  sliceToolActive: false,

  // Extrude tool
  extrudeToolActive: false,
  // { sourceObjectId, extrudeObjectId, faceCenterWorld:{x,y,z}, faceNormalWorld:{x,y,z} }
  extrudeState: null,

  setActivePanel: (panel) => set({ activePanel: panel }),
  setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setTransformMode: (mode) => set({ transformMode: mode }),
  setShowProjectDialog: (v) => set({ showProjectDialog: v }),
  setSurfaceTool: (v) => set({ surfaceToolActive: v }),
  setSimActive: (v) => set({ simActive: v }),

  // Project hydration progress (NOT app startup): { done, total } while a
  // project's models are being fetched before its objects are created.
  projectLoading: null,
  setProjectLoading: (v) => set({ projectLoading: v }),
  setExtrudeTool: (v) => set({ extrudeToolActive: v, ...(v ? {} : { extrudeState: null }) }),
  setSliceTool: (v) => set({ sliceToolActive: v }),
  setExtrudeState: (s) => set({ extrudeState: s }),
  setSnapTranslate: (v) => set({ snapTranslate: v }),
  setSnapRotateDeg: (v) => set({ snapRotateDeg: v }),
  setPrintBedVisible: (v) => set({ printBedVisible: v }),
  setPrintBedSizeMm: (v) => set({ printBedSizeMm: v }),
  setSmartGuides: (v) => set({ smartGuides: v }),
  setSnapObject:  (v) => set({ snapObject: v }),
  setSnapSurface: (v) => set({ snapSurface: v }),
}))
