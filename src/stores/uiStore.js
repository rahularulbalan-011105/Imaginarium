import { create } from 'zustand'

export const useUiStore = create((set) => ({
  activePanel: 'properties',
  sidebarCollapsed: false,
  statusMessage: 'Ready',
  transformMode: 'translate',
  showProjectDialog: false,

  surfaceToolActive: false,
  simActive: false,

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
  setExtrudeTool: (v) => set({ extrudeToolActive: v, ...(v ? {} : { extrudeState: null }) }),
  setExtrudeState: (s) => set({ extrudeState: s }),
}))
