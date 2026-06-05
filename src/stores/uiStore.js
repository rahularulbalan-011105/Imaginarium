import { create } from 'zustand'

export const useUiStore = create((set) => ({
  activePanel: 'properties',
  sidebarCollapsed: false,
  statusMessage: 'Ready',
  transformMode: 'translate',
  showProjectDialog: false,

  surfaceToolActive: false,
  simActive: false,

  setActivePanel: (panel) => set({ activePanel: panel }),
  setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setTransformMode: (mode) => set({ transformMode: mode }),
  setShowProjectDialog: (v) => set({ showProjectDialog: v }),
  setSurfaceTool: (v) => set({ surfaceToolActive: v }),
  setSimActive: (v) => set({ simActive: v }),
}))
