// Navigation model for the right-hand rail + context panel.
//
// LEVEL 1  parents  — the five rail buttons.
// LEVEL 2  tabs     — the options a parent shows in its context panel.
// A tab owns one or more panel ids (`uiStore.activePanel`); the ids are the same
// ones the app always used, so every existing setActivePanel('wiring'|'joints'|…)
// call, tutorial step and data-tour anchor keeps working.

export const NAV = [
  { id: 'cad', label: 'CAD', icon: 'cube', tabs: [
    { id: 'library',    label: 'Library',  panels: ['library'] },
    { id: 'properties', label: 'Design',   panels: ['properties'] },
    { id: 'boolean',    label: 'Boolean',  panels: ['boolean'] },
    { id: 'objects',    label: 'Overview', panels: ['objects'] },
  ] },
  { id: 'elec', label: 'ELEC', icon: 'cpu', tabs: [
    { id: 'electronics', label: 'Elec',   panels: ['electronics'] },
    { id: 'mechanical',  label: 'Mech',   panels: ['mechanical', 'joints'] },
    { id: 'wiring',      label: 'Wiring', panels: ['wiring', 'workbench'] },
  ] },
  { id: 'code', label: 'CODE', icon: 'code', tabs: [
    { id: 'blocks', label: 'Block Coding', panels: ['blocks'] },
    { id: 'code',   label: 'C++ Coding',   panels: ['code'] },
  ] },
  { id: 'simulate', label: 'SIMULATE', icon: 'play', home: 'simhome', tabs: [
    { id: 'sim',     label: 'Simulator', panels: ['sim'] },
    { id: 'robot',   label: 'Robot',     panels: ['robot'] },
    { id: 'physics', label: 'Physics',   panels: ['physics'] },
  ] },
  { id: 'settings', label: 'SETTINGS', icon: 'gear', tabs: [
    { id: 'settings', label: 'Settings', panels: ['settings'] },
  ] },
]

const PANEL_TO = new Map()
for (const p of NAV) {
  if (p.home) PANEL_TO.set(p.home, { parent: p, tab: null })
  for (const t of p.tabs) for (const id of t.panels) PANEL_TO.set(id, { parent: p, tab: t })
}

/** { parent, tab } for a panel id (tab is null for a parent's placeholder home). */
export function locatePanel(panelId) {
  return PANEL_TO.get(panelId) ?? PANEL_TO.get('properties')
}

/** The panel a parent opens on first visit. */
export function defaultPanelOf(parent) {
  return parent.home ?? parent.tabs[0].panels[0]
}

/** Panels that take over the centre workspace instead of living in the side panel. */
export const WORKSPACE_PANELS = new Set(['code', 'blocks', 'workbench'])
