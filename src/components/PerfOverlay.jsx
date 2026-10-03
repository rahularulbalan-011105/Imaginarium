import { useEffect, useState } from 'react'
import { useUiStore } from '../stores/uiStore.js'
import { sceneManager } from '../managers/SceneManager.js'
import { physicsManager } from '../managers/physics/PhysicsManager.js'
import { roboticsTelemetry } from '../managers/physics/robotics/telemetry.js'
import { modelLoadTimes } from '../utils/modelLoader.js'
import { Z } from './ui/zIndex.js'

// Performance overlay. Off by default (Settings → Performance, or F9). Samples at
// 2 Hz from counters the render loop already keeps — it adds no per-frame work.
export default function PerfOverlay() {
  const on = useUiStore((s) => s.perf.overlay)
  const setPerf = useUiStore((s) => s.setPerf)
  const [m, setM] = useState(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'F9' || e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
      e.preventDefault()
      setPerf({ overlay: !useUiStore.getState().perf.overlay })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPerf])

  useEffect(() => {
    if (!on) { setM(null); return }
    let lastFrames = sceneManager.stats.frames, lastT = performance.now()
    const id = setInterval(() => {
      const r = sceneManager.renderer
      if (!r) return
      const now = performance.now(), st = sceneManager.stats
      const fps = ((st.frames - lastFrames) * 1000) / (now - lastT)
      lastFrames = st.frames; lastT = now
      const w = physicsManager.world
      const tel = roboticsTelemetry.get()
      setM({
        fps, renderMs: st.renderMs, calls: st.calls, tris: st.triangles,
        geo: r.info.memory.geometries, tex: r.info.memory.textures,
        dpr: r.getPixelRatio(), profile: sceneManager.quality?.profile, auto: sceneManager.quality?.auto,
        heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
        bodies: w ? w.bodies.len() : null, colliders: w ? w.colliders.len() : null, joints: w ? w.impulseJoints.len() : null,
        stepMs: tel?.runtime?.stepMsAvg ?? null, physHz: tel?.runtime ? Math.round(1 / tel.runtime.timestep) : null,
        models: Object.keys(modelLoadTimes()).length,
      })
    }, 500)
    return () => clearInterval(id)
  }, [on])

  if (!on || !m) return null
  const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))
  const row = (k, v) => <div className="flex justify-between gap-3"><span style={{ opacity: 0.65 }}>{k}</span><span>{v}</span></div>
  return (
    <div data-testid="perf-overlay"
      style={{ position: 'fixed', left: 12, bottom: 34, zIndex: Z.toast ?? 200, font: '11px/1.35 ui-monospace, monospace', color: '#e5e7eb', background: 'rgba(10,12,18,0.82)', padding: '8px 10px', borderRadius: 8, minWidth: 190, pointerEvents: 'none' }}>
      {row('FPS', `${f(m.fps, 0)}  (${f(m.renderMs, 2)} ms render)`)}
      {row('Draw calls', m.calls)}
      {row('Triangles', m.tris.toLocaleString())}
      {row('Geometries / textures', `${m.geo} / ${m.tex}`)}
      {row('Pixel ratio', `${f(m.dpr, 2)} · ${m.profile}${m.auto ? ' (auto)' : ''}`)}
      {m.heap != null && row('JS heap', `${f(m.heap, 0)} MB`)}
      {m.bodies != null && row('Bodies / colliders / joints', `${m.bodies} / ${m.colliders} / ${m.joints}`)}
      {m.stepMs != null && row('Physics', `${m.physHz} Hz · ${f(m.stepMs, 2)} ms/step`)}
      {row('Models loaded', m.models)}
      <div style={{ opacity: 0.5, marginTop: 4 }}>F9 to hide</div>
    </div>
  )
}
