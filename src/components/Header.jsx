import { useRef, useState, useCallback, useEffect } from 'react'
import { modelKeysFor, isModelLoaded, ensureModels } from '../utils/modelLoader.js'
import { usePhysicsStore } from '../stores/physicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useElectronicsStore, DEFAULT_CODE } from '../stores/electronicsStore.js'
import { buildShareUrl, readShareFromHash, clearShareHash } from '../utils/share.js'
import { trackEvent } from '../utils/utmTracking.js'
import { exportSTL, analyzePrintability } from '../utils/printExport.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useJointStore } from '../stores/jointStore.js'
import { useRobotStore } from '../stores/robotStore.js'
import { storageManager } from '../managers/StorageManager.js'
import { clear as clearHistory } from '../managers/history/editorDispatch.js'
import { saveJSONToFile, readJSONFile } from '../utils/export.js'
import { buildProjectSnapshot } from '../utils/helpers.js'
import HelpMenu from './onboarding/HelpMenu.jsx'
import { useOnboardingStore } from '../onboarding/onboardingStore.js'
import { getTheme, toggleTheme } from '../theme/theme.js'
import Icon from './ui/Icon.jsx'
import { useHistoryStore } from '../stores/historyStore.js'
import { undo as historyUndo, redo as historyRedo } from '../managers/history/editorDispatch.js'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
function HistoryButton({ kind }) {
  const stack = useHistoryStore((s) => s[kind])
  const label = stack.length ? stack[kind === 'undo' ? stack.length - 1 : 0] : null
  const keys = kind === 'undo' ? (isMac ? '⌘Z' : 'Ctrl+Z') : (isMac ? '⇧⌘Z' : 'Ctrl+Y')
  const name = kind === 'undo' ? 'Undo' : 'Redo'
  return (
    <button
      onClick={() => (kind === 'undo' ? historyUndo() : historyRedo())}
      disabled={!label}
      title={label ? `${name} ${label} (${keys})` : `Nothing to ${name.toLowerCase()} (${keys})`}
      aria-label={name}
      className="w-8 h-8 rounded-lg flex items-center justify-center ui-icon-btn disabled:opacity-35 disabled:pointer-events-none"
    >
      <Icon name={kind} size={16} />
    </button>
  )
}
import { useOverlay } from './ui/overlay.js'
import { useSimToggle } from '../managers/simControl.js'
import { v4 as uuidv4 } from 'uuid'

// Reopen-last-project runs once per page load (not per Header mount).
let restoreStarted = false

export default function Header() {
  const projectName    = useSceneStore((s) => s.projectName)
  const setProjectName = useSceneStore((s) => s.setProjectName)
  const projectId      = useSceneStore((s) => s.projectId)
  const setProjectId   = useSceneStore((s) => s.setProjectId)
  // Read at click time — subscribing re-rendered the header on every edit/drag.
  const partCount = () => useSceneStore.getState().objects.length
  const gridVisible    = useSceneStore((s) => s.gridVisible)
  const axesVisible    = useSceneStore((s) => s.axesVisible)
  const setObjects     = useSceneStore((s) => s.setObjects)
  const clearScene     = useSceneStore((s) => s.clearScene)

  const clearAttachments = useElectronicsStore((s) => s.clearAttachments)
  const setConnections   = useElectronicsStore((s) => s.setConnections)
  const setAttachments   = useElectronicsStore((s) => s.setAttachments)
  const setCode          = useElectronicsStore((s) => s.setCode)
  const setPatches       = useSurfaceStore((s) => s.setPatches)
  const setBonds         = useRigidStore((s) => s.setBonds)
  const setJoints        = useJointStore((s) => s.setJoints)
  const setBlueprints    = useRobotStore((s) => s.setBlueprints)

  const [saving, setSaving]           = useState(false)
  const [saveFlash, setSaveFlash]     = useState(false)
  const [showMenu, setShowMenu]       = useState(false)
  const [showOpenDlg, setShowOpenDlg] = useState(false)
  const [savedProjects, setSavedProjects] = useState([])
  const [theme, setTheme]             = useState(getTheme)
  const [shareMsg, setShareMsg] = useState(null)
  const [autosave, setAutosave] = useState(null)   // { state:'saving'|'saved'|'error', at } from constructa:autosave
  const relAgo = (ts) => {
    if (!ts) return ''
    const s = Math.round((Date.now() - ts) / 1000)
    if (s < 5) return 'just now'
    if (s < 60) return s + 's ago'
    const m = Math.round(s / 60)
    return m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago'
  }
  const importRef = useRef(null)

  // Register the header's floating layers as overlays so the View Cube yields.
  useOverlay('file-menu', showMenu)
  useOverlay('open-dialog', showOpenDlg)

  const handleToggleTheme = () => setTheme(toggleTheme())

  // ── snapshot helper ───────────────────────────────────────────────────────
  const getSnapshot = useCallback(() =>
    buildProjectSnapshot(useSceneStore.getState(), useElectronicsStore.getState()),
  [])

  // ── apply loaded / imported data to all stores ────────────────────────────
  const applyProjectData = useCallback(async (data) => {
    // Models load on demand: fetch exactly the GLBs this project uses before its
    // objects are created (pins anchor to real board geometry). The app shell is
    // already interactive; this shows its own project-loading progress.
    const keys = modelKeysFor(data?.objects)
    if (keys.some(k => !isModelLoaded(k))) {
      const ui = useUiStore.getState()
      ui.setProjectLoading({ done: 0, total: keys.length })
      try { await ensureModels(keys, (done, total) => ui.setProjectLoading({ done, total })) }
      finally { ui.setProjectLoading(null) }
    }
    setProjectName(data.name || 'Untitled Project')
    setProjectId(data.projectId || uuidv4())
    setObjects(data.objects || [])
    clearAttachments()
    if (data.electronics) {
      if (data.electronics.connections !== undefined) setConnections(data.electronics.connections)
      if (data.electronics.code       !== undefined) setCode(data.electronics.code)
      if (data.electronics.attachments !== undefined) setAttachments(data.electronics.attachments)
    }
    if (data.surface?.patches !== undefined) setPatches(data.surface.patches)
    if (data.rigid?.bonds     !== undefined) setBonds(data.rigid.bonds)
    if (data.joints?.joints   !== undefined) setJoints(data.joints.joints)
    setBlueprints(data.robots?.blueprints ?? {})   // absent in 1.0 files → cleared
    usePhysicsStore.getState().loadPhysics(data)    // absent in older files → defaults
    clearHistory()   // discard undo history; adopt the loaded/new doc as baseline
  }, [setProjectName, setProjectId, setObjects, clearAttachments, setConnections, setCode, setAttachments, setPatches, setBonds, setJoints, setBlueprints])

  // ── on mount: open a #share=… link, else reopen the last autosaved project ──
  useEffect(() => {
    readShareFromHash().then(async (data) => {
      if (data) { applyProjectData(data); clearShareHash(); return }
      // Cloud links (?project= / ?share=) are loaded by CloudProjectManager.
      const q = new URLSearchParams(window.location.search)
      if (q.has('project') || q.has('share')) return
      if (restoreStarted) return          // StrictMode runs mount effects twice in dev
      restoreStarted = true
      const last = await storageManager.loadLastProject().catch(() => null)
      // Don't clobber anything the user (or the MCP bridge) built meanwhile.
      if (last && useSceneStore.getState().objects.length === 0) await applyProjectData(last)
    })
  }, [applyProjectData])

  // ── load a project on demand (used by the guided debug mission) ───────────
  // Someone dispatches constructa:load-project with the parsed project as detail.
  useEffect(() => {
    // `constructa:project-applied` tells listeners (cloud sync) the stores now hold
    // the loaded project — applyProjectData is async (it waits for GLBs first).
    const onLoad = async (e) => {
      if (!e.detail) return
      try { await applyProjectData(e.detail) }
      finally { window.dispatchEvent(new CustomEvent('constructa:project-applied')) }
    }
    window.addEventListener('constructa:load-project', onLoad)
    return () => window.removeEventListener('constructa:load-project', onLoad)
  }, [applyProjectData])

  // Autosave status: reflect StorageManager (auto) + manual Save events in the
  // header. The interval re-renders so the "Saved Ns ago" label stays current.
  useEffect(() => {
    const onStatus = (e) => setAutosave(e.detail)
    window.addEventListener('constructa:autosave', onStatus)
    const t = setInterval(() => setAutosave(a => (a && a.state === 'saved') ? { ...a } : a), 15000)
    return () => { window.removeEventListener('constructa:autosave', onStatus); clearInterval(t) }
  }, [])

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    window.dispatchEvent(new CustomEvent('constructa:autosave', { detail: { state: 'saving', at: Date.now() } }))
    try {
      await storageManager.saveProject(getSnapshot())
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 1200)
      trackEvent('project_saved', { parts: partCount() })
      window.dispatchEvent(new Event('constructa:saved'))   // → soft email capture
      window.dispatchEvent(new CustomEvent('constructa:autosave', { detail: { state: 'saved', at: Date.now() } }))
    } catch (e) {
      window.dispatchEvent(new CustomEvent('constructa:autosave', { detail: { state: 'error', at: Date.now() } }))
      throw e
    } finally {
      setSaving(false)
    }
  }

  // ── new project ───────────────────────────────────────────────────────────
  const handleNewProject = () => {
    if (partCount() > 0 && !confirm('Start a new project? What is on screen now will be closed (it stays in File → Open if you saved it).')) return
    clearScene()
    clearAttachments()
    // Everything else the old project owned, or it leaks into the new one
    // (dangling wires to deleted parts, the old sketch, bonds/joints/patches).
    setConnections([])
    setCode(DEFAULT_CODE)
    setPatches({})
    setBonds({})
    setJoints({})
    setBlueprints({})
    usePhysicsStore.getState().loadPhysics({})       // new project → default world physics
    setProjectId(uuidv4())
    setProjectName('Untitled Project')
    clearHistory()   // discard undo history; adopt the loaded/new doc as baseline
    setShowMenu(false)
    useOnboardingStore.getState().openWelcome()   // → start screen: guided / starter / empty
  }

  // ── open saved projects dialog ────────────────────────────────────────────
  const handleOpenDialog = async () => {
    setShowMenu(false)
    const projects = await storageManager.getAllProjects()
    setSavedProjects(projects.sort((a, b) => new Date(b.modified) - new Date(a.modified)))
    setShowOpenDlg(true)
  }

  const handleLoadProject = async (id) => {
    const data = await storageManager.loadProject(id)
    if (!data) return
    applyProjectData(data)
    setShowOpenDlg(false)
  }

  const handleDeleteSaved = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this saved project? This cannot be undone.')) return
    await storageManager.deleteProject(id)
    setSavedProjects((p) => p.filter((proj) => proj.projectId !== id))
  }

  // ── export / import ───────────────────────────────────────────────────────
  const handleExportJSON = async () => {
    setShowMenu(false)
    trackEvent('export_json', { parts: partCount() })
    await saveJSONToFile(getSnapshot(), `${projectName || 'project'}.json`)
  }

  // ── share link (full project packed into the URL hash) ────────────────────
  const handleShareLink = async () => {
    setShowMenu(false)
    try {
      const { url } = await buildShareUrl(getSnapshot())
      try { await navigator.clipboard.writeText(url) } catch { /* clipboard may be blocked */ }
      trackEvent('share_link_created', { parts: partCount() })
      history.replaceState(null, '', url)   // reflect the shareable URL in the address bar
      setShareMsg(url.length > 12000
        ? `Link copied (~${Math.round(url.length / 1024)} KB). It's long — for big projects, Export JSON is more reliable.`
        : 'Share link copied to clipboard!')
      setTimeout(() => setShareMsg(null), 4500)
    } catch (e) {
      console.error('[share]', e)
      alert('Could not create a share link: ' + (e?.message ?? e))
    }
  }

  // ── export STL with a printability pre-check ──────────────────────────────
  const handleExportSTL = () => {
    setShowMenu(false)
    const objs = useSceneStore.getState().objects
    const report = analyzePrintability(objs, useUiStore.getState().printBedSizeMm)
    if (report.empty) { alert('Nothing to export yet — add some shapes first.'); return }
    const lines = report.items.map((i) => {
      const wt  = i.watertight === null ? '' : (i.watertight ? '  ✓ watertight' : `  ⚠ ${i.boundaryEdges} open edges`)
      const fit = i.fits ? '' : '  ⚠ exceeds bed'
      return `• ${i.name}: ${i.sizeMm.x}×${i.sizeMm.y}×${i.sizeMm.z} mm${wt}${fit}`
    }).join('\n')
    const verdict = (report.anyOpen || !report.allFit)
      ? '\n\n⚠ Some objects may not print cleanly (non-watertight, or larger than the build plate).'
      : '\n\n✓ All objects look print-ready.'
    if (!confirm(`Printability check (build plate ${report.bedMm} mm):\n\n${lines}${verdict}\n\nExport STL now?`)) return
    exportSTL(objs, `${projectName || 'model'}.stl`)
  }

  const handleImportClick = () => {
    importRef.current?.click()
    setShowMenu(false)
  }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = await readJSONFile(file)
      applyProjectData(data)
    } catch {
      alert('Failed to import project. Make sure it is a valid JSON file.')
    }
    e.target.value = ''
  }

  return (
    <>
      <header data-tour="header" className="flex items-center gap-2 pl-4 pr-3 h-12 shrink-0 relative z-40"
        style={{ background: 'rgb(var(--g-900))', borderBottom: '1px solid rgb(var(--g-700))' }}>
        {/* Logo */}
        <span className="text-[15px] font-extrabold tracking-tight mr-3" style={{ color: 'rgb(var(--a-600))' }}>Constructa</span>

        {/* Project name — looks like text until you hover or click it */}
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          title="Rename project"
          className="bg-transparent text-[13px] font-medium px-2 h-8 rounded-md w-48 min-w-0 border border-transparent hover:border-gray-600 focus:border-gray-500 focus:outline-none"
        />

        {/* Global undo / redo — the one editor history (editorDispatch). Ctrl/Cmd+Z,
            Ctrl/Cmd+Y and Shift+Ctrl/Cmd+Z keep working via App's key handler. */}
        <div className="flex items-center gap-1 ml-1" role="group" aria-label="History">
          <HistoryButton kind="undo" />
          <HistoryButton kind="redo" />
        </div>

        <div className="flex-1" />

        {/* Autosave status — reflects the 30s IndexedDB autosave + manual saves */}
        {autosave && (
          <span
            title="Your project saves itself in this browser about every 30 seconds"
            className="text-[12px] whitespace-nowrap mr-1"
            style={{ color: autosave.state === 'error' ? '#dc2626' : 'rgb(var(--g-500))' }}
          >
            {autosave.state === 'saving'
              ? 'Saving…'
              : autosave.state === 'error'
                ? 'Couldn’t save'
                : 'Saved ' + relAgo(autosave.at)}
          </span>
        )}

        {/* Help menu — tutorials, product tour, shortcuts, beginner guide */}
        <HelpMenu />

        {/* Theme toggle — light / dark palette switch */}
        <button
          onClick={handleToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle colour theme"
          className="w-8 h-8 flex items-center justify-center ui-icon-btn"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>

        {/* File menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            aria-expanded={showMenu}
            className="ui-btn ui-btn-quiet"
          >
            File <Icon name="chevronDown" size={13} />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-52 rounded-lg z-20 py-1"
                style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)' }}>
                <MenuItem onClick={handleNewProject}  label="New project" />
                <MenuItem onClick={handleOpenDialog}  label="Open…" />
                <div className="my-1" style={{ borderTop: '1px solid rgb(var(--g-700))' }} />
                <MenuItem onClick={handleImportClick} label="Import project file…" />
                <MenuItem onClick={handleExportJSON}  label="Download project file" />
                <MenuItem onClick={handleExportSTL}   label="Download STL for 3D printing" />
                <div className="my-1" style={{ borderTop: '1px solid rgb(var(--g-700))' }} />
                <MenuItem onClick={handleShareLink}   label="Copy share link" />
              </div>
            </>
          )}
        </div>

        {/* Save — secondary: the project also saves itself every ~30 s */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="ui-btn disabled:opacity-60"
          style={{ minWidth: 60 }}
        >
          {saving ? 'Saving…' : saveFlash ? 'Saved' : 'Save'}
        </button>

        <span className="w-px h-6 mx-1" style={{ background: 'rgb(var(--g-700))' }} aria-hidden="true" />

        {/* Simulate — THE primary action: always one click away, from any section */}
        <SimulateButton />

        <input
          ref={importRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />
      </header>

      {/* Share-link confirmation toast */}
      {shareMsg && (
        <div className="fixed top-14 right-4 z-50 max-w-xs px-4 py-2.5 rounded-lg text-xs text-white"
          style={{ background: '#1f2937', boxShadow: '0 8px 24px rgb(0 0 0 / 0.2)' }}>
          {shareMsg}
        </div>
      )}

      {/* ── Open Saved Projects dialog ─────────────────────────────────────── */}
      {showOpenDlg && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowOpenDlg(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="rounded-xl shadow-2xl w-full max-w-md pointer-events-auto"
              style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))' }}>

              {/* Dialog header */}
              <div className="flex items-center justify-between px-5 py-3.5"
                style={{ borderBottom: '1px solid rgb(var(--g-700))' }}>
                <h2 className="text-sm font-semibold text-gray-50">Open Saved Project</h2>
                <button
                  onClick={() => setShowOpenDlg(false)}
                  className="text-gray-500 hover:text-gray-50 text-lg leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Project list */}
              <div className="max-h-96 overflow-y-auto">
                {savedProjects.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-gray-500">
                    <span className="text-sm">No saved projects yet</span>
                    <span className="text-xs text-gray-600">Press Save to keep your work here.</span>
                  </div>
                ) : (
                  savedProjects.map((proj) => (
                    <div
                      key={proj.projectId}
                      onClick={() => handleLoadProject(proj.projectId)}
                      className="flex items-center gap-3 px-5 py-3.5 cursor-pointer last:border-0 group transition-colors"
                      style={{ borderBottom: '1px solid rgb(var(--g-700))' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgb(var(--g-800))'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-50 truncate  transition-colors">
                          {proj.name || 'Untitled Project'}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {new Date(proj.modified).toLocaleString()} · {proj.objects?.length ?? 0} object{proj.objects?.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSaved(proj.projectId, e)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-red-900/20 transition-all"
                        title="Delete project"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Dialog footer */}
              {savedProjects.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-700 text-xs text-gray-500">
                  {savedProjects.length} saved project{savedProjects.length !== 1 ? 's' : ''} · click a project to open it
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

function SimulateButton() {
  const { simActive, preparing, toggle } = useSimToggle()
  return (
    <button
      data-tour="simulate-header"
      onClick={toggle}
      disabled={preparing}
      title={simActive ? 'Stop the simulation and go back to editing' : 'Run your robot with real physics'}
      className={simActive ? 'ui-btn' : 'ui-btn ui-btn-primary'}
      style={{ minWidth: 118, ...(simActive ? { color: '#b91c1c', borderColor: 'rgb(220 38 38 / 0.45)' } : null) }}
    >
      <Icon name={simActive ? 'stop' : 'play'} size={13} />
      {preparing ? 'Starting…' : simActive ? 'Stop' : 'Simulate'}
    </button>
  )
}

function MenuItem({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-[13px] text-gray-300 hover:bg-gray-800 hover:text-gray-50 transition-colors"
    >
      {label}
    </button>
  )
}
