import { useEffect, useState } from 'react'
import { Z } from './ui/zIndex.js'
import { onStaleBuild, isStaleBuild, reloadForNewBuild } from '../utils/staleBuild.js'
import { storageManager } from '../managers/StorageManager.js'

// Shown when a lazy chunk 404s because this tab predates the live deploy. The
// alternative is what the user actually saw: "Physics crashed" / "Operation
// failed: Failed to fetch dynamically imported module…", which reads like the
// feature is broken when nothing is wrong with it.
export default function StaleBuildNotice() {
  const [open, setOpen] = useState(isStaleBuild)
  const [busy, setBusy] = useState(false)

  useEffect(() => onStaleBuild(() => setOpen(true)), [])

  if (!open) return null

  const reload = async () => {
    setBusy(true)
    // The periodic autosave can be up to 30 s away; flush it before the tab goes.
    try { await storageManager.saveNow() } catch { /* reload anyway */ }
    await reloadForNewBuild()
  }

  return (
    <div
      role="alert"
      data-testid="stale-build-notice"
      style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: Z.toast, maxWidth: 420,
        background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))' }}
      className="px-4 py-3 rounded-xl shadow-2xl"
    >
      <div className="text-xs font-semibold mb-1" style={{ color: 'rgb(var(--a-500))' }}>
        Constructa was updated
      </div>
      <div className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--g-300))' }}>
        This tab is still running the previous version, so some tools can’t load their
        code any more. Reload to pick up the new one — your project is saved first.
      </div>
      <div className="flex gap-2 mt-2.5">
        <button
          onClick={reload}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-60"
          style={{ background: 'rgb(var(--a-600))', color: '#fff' }}
        >
          {busy ? 'Saving…' : 'Save & reload'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium"
          style={{ background: 'rgb(var(--g-800))', color: 'rgb(var(--g-300))' }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
