import { useRef, useState, useCallback } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useJointStore } from '../stores/jointStore.js'
import { useRobotStore } from '../stores/robotStore.js'
import { storageManager } from '../managers/StorageManager.js'
import { clear as clearHistory } from '../managers/history/editorDispatch.js'
import { saveJSONToFile, readJSONFile } from '../utils/export.js'
import { buildProjectSnapshot } from '../utils/helpers.js'
import HelpMenu from './onboarding/HelpMenu.jsx'
import { v4 as uuidv4 } from 'uuid'

export default function Header() {
  const projectName    = useSceneStore((s) => s.projectName)
  const setProjectName = useSceneStore((s) => s.setProjectName)
  const projectId      = useSceneStore((s) => s.projectId)
  const setProjectId   = useSceneStore((s) => s.setProjectId)
  const objects        = useSceneStore((s) => s.objects)
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
  const importRef = useRef(null)

  // ── snapshot helper ───────────────────────────────────────────────────────
  const getSnapshot = useCallback(() =>
    buildProjectSnapshot(useSceneStore.getState(), useElectronicsStore.getState()),
  [])

  // ── apply loaded / imported data to all stores ────────────────────────────
  const applyProjectData = useCallback((data) => {
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
    clearHistory()   // discard undo history; adopt the loaded/new doc as baseline
  }, [setProjectName, setProjectId, setObjects, clearAttachments, setConnections, setCode, setAttachments, setPatches, setBonds, setJoints, setBlueprints])

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    try {
      await storageManager.saveProject(getSnapshot())
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 1200)
    } finally {
      setSaving(false)
    }
  }

  // ── new project ───────────────────────────────────────────────────────────
  const handleNewProject = () => {
    if (objects.length > 0 && !confirm('Start a new project? Unsaved changes will be lost.')) return
    clearScene()
    clearAttachments()
    setProjectId(uuidv4())
    setProjectName('Untitled Project')
    clearHistory()   // discard undo history; adopt the loaded/new doc as baseline
    setShowMenu(false)
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
    await saveJSONToFile(getSnapshot(), `${projectName || 'project'}.json`)
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
      <header data-tour="header" className="flex items-center gap-3 px-4 h-12 shrink-0 z-10"
        style={{ background: 'linear-gradient(90deg,#F7F9FC 0%,#FFFFFF 50%,#F7F9FC 100%)', borderBottom: '1px solid rgba(99,102,241,0.18)' }}>
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <span className="text-lg">🧊</span>
          <span className="text-sm font-bold hidden sm:block"
            style={{ background: 'linear-gradient(90deg,#6366f1,#4F46E5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            3D Editor
          </span>
        </div>

        {/* Project name */}
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="bg-transparent text-sm text-gray-200 px-1 py-0.5 focus:outline-none w-40 min-w-0"
          style={{ borderBottom: '1px solid rgba(99,102,241,0.35)' }}
        />

        <div className="flex-1" />

        {/* Help menu — tutorials, product tour, shortcuts, beginner guide */}
        <HelpMenu />

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-3 py-1 text-xs font-semibold rounded transition-all disabled:opacity-50 ${
            saveFlash
              ? 'text-white'
              : 'text-white hover:brightness-110'
          }`}
          style={saveFlash
            ? { background: 'linear-gradient(90deg,#16a34a,#15803d)', boxShadow: '0 0 8px rgba(63,185,80,0.4)' }
            : { background: 'linear-gradient(90deg,#6366f1,#4f46e5)', boxShadow: '0 0 8px rgba(99,102,241,0.3)' }}
        >
          {saving ? 'Saving…' : saveFlash ? '✓ Saved' : '💾 Save'}
        </button>

        {/* File menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="px-3 py-1 text-xs text-gray-300 hover:text-slate-900 rounded transition-colors"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}
          >
            ☰ File
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 rounded shadow-2xl z-20 py-1"
                style={{ background: '#FFFFFF', border: '1px solid rgba(99,102,241,0.25)' }}>
                <MenuItem onClick={handleNewProject}  icon="📄" label="New Project" />
                <MenuItem onClick={handleOpenDialog}  icon="📂" label="Open Saved…" />
                <div className="my-1" style={{ borderTop: '1px solid rgba(99,102,241,0.15)' }} />
                <MenuItem onClick={handleExportJSON}  icon="⬇" label="Export JSON" />
                <MenuItem onClick={handleImportClick} icon="⬆" label="Import JSON" />
              </div>
            </>
          )}
        </div>

        <input
          ref={importRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />
      </header>

      {/* ── Open Saved Projects dialog ─────────────────────────────────────── */}
      {showOpenDlg && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowOpenDlg(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="rounded-xl shadow-2xl w-full max-w-md pointer-events-auto"
              style={{ background: '#FFFFFF', border: '1px solid rgba(99,102,241,0.25)' }}>

              {/* Dialog header */}
              <div className="flex items-center justify-between px-5 py-3.5"
                style={{ borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
                <h2 className="text-sm font-semibold text-white">Open Saved Project</h2>
                <button
                  onClick={() => setShowOpenDlg(false)}
                  className="text-gray-500 hover:text-slate-900 text-lg leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Project list */}
              <div className="max-h-96 overflow-y-auto">
                {savedProjects.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-gray-500">
                    <span className="text-3xl">📭</span>
                    <span className="text-sm">No saved projects yet</span>
                    <span className="text-xs text-gray-600">Click 💾 Save to store your work</span>
                  </div>
                ) : (
                  savedProjects.map((proj) => (
                    <div
                      key={proj.projectId}
                      onClick={() => handleLoadProject(proj.projectId)}
                      className="flex items-center gap-3 px-5 py-3.5 cursor-pointer last:border-0 group transition-colors"
                      style={{ borderBottom: '1px solid rgba(99,102,241,0.1)' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(99,102,241,0.07)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                    >
                      <span className="text-2xl shrink-0">📁</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate group-hover:text-indigo-300 transition-colors">
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
                        🗑
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

function MenuItem({ onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:text-slate-900 transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
