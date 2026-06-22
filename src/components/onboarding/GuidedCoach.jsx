import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { useElectronicsStore } from '../../stores/electronicsStore.js'
import { useUiStore } from '../../stores/uiStore.js'
import { sceneManager } from '../../managers/SceneManager.js'
import { COACH_STEPS } from '../../onboarding/coachSteps.js'

// ─────────────────────────────────────────────────────────────────────────────
// GuidedCoach — an interactive, element-anchored teacher. It highlights the exact
// element to use, explains why + how, and WAITS for the user to perform the real
// action (detected read-only) before celebrating and moving on.
//
// Crucially, this overlay is pointer-events-none everywhere EXCEPT its card, so
// the user can actually click/drag the real UI underneath. It never mutates any
// app state — detection only observes scene/electronics/ui stores and reads the
// Three.js camera for the camera lessons.
// ─────────────────────────────────────────────────────────────────────────────

const CARD_W = 330
const STUCK_MS = 10000

// Temporary tutorial debug logging. Flip to false (or set window.__COACH_DEBUG = false)
// to silence. Logs what each step waits for, the live value, and when it advances.
const COACH_DEBUG = true
const dbg = (...a) => {
  if (COACH_DEBUG && (typeof window === 'undefined' || window.__COACH_DEBUG !== false)) console.log('[Coach]', ...a)
}

// Human-readable description of a step's success condition (for debug + audit clarity).
const describe = (d) => {
  switch (d?.type) {
    case 'objectType': return `an object of type [${d.any.join(' / ')}] exists`
    case 'select':     return 'selectedId !== null'
    case 'selectType': return `selected object is [${d.any.join(' / ')}]`
    case 'activate':   return `transformMode === "${d.mode}"`
    case 'moved':      return 'selected object position changed'
    case 'rotated':    return 'selected object rotation changed'
    case 'scaled':     return 'selected object scale changed'
    case 'panel':      return `activePanel === "${d.value}"`
    case 'connection': return 'a new wire connection exists'
    case 'codeRunning': return 'code is running (simulation.running === true)'
    case 'simActive':  return 'simulation mode active (simActive === true)'
    case 'sim':        return 'a simulation is running'
    case 'simStopped': return 'simulation mode stopped (simActive === false)'
    case 'ack':        return 'user acknowledges (Continue)'
    case 'cam':        return `camera ${d.mode}`
    default:           return String(d?.type)
  }
}

const changed3 = (a, b) =>
  !!a && !!b && (Math.abs(a.x - b.x) > 1e-3 || Math.abs(a.y - b.y) > 1e-3 || Math.abs(a.z - b.z) > 1e-3)

// ── Smart card placement ─────────────────────────────────────────────────────
// Never let the card overlap the highlighted target. Try Right → Left → Below →
// Above; pick the first side where the card sits FULLY on-screen AND is separated
// from the target by a buffer. Falls back to the side with the most room only
// when the target is so large/edge-bound that no side fully clears it.
const EDGE = 12          // min gap from the viewport edges
const PREF_BUF = 40      // preferred gap between card and target
const MIN_BUF = 24       // minimum acceptable gap
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi))

function choosePlacement(t, cw, ch) {
  const vw = window.innerWidth, vh = window.innerHeight
  const aTop  = clamp(t.top, EDGE, vh - ch - EDGE)                       // align card top to target
  const aLeft = clamp(t.left + t.width / 2 - cw / 2, EDGE, vw - cw - EDGE) // center card on target

  const tryBuf = (buf) => {
    const cands = [
      { side: 'right', left: t.right + buf,     top: aTop },
      { side: 'left',  left: t.left - buf - cw, top: aTop },
      { side: 'below', left: aLeft,             top: t.bottom + buf },
      { side: 'above', left: aLeft,             top: t.top - buf - ch },
    ]
    // On-screen check; each candidate is separated from the target by `buf`
    // on its own axis by construction, so on-screen ⇒ no overlap.
    return cands.find((c) =>
      c.left >= EDGE && c.top >= EDGE && c.left + cw <= vw - EDGE && c.top + ch <= vh - EDGE)
  }

  const good = tryBuf(PREF_BUF) || tryBuf(MIN_BUF)
  if (good) return { ...good, overlap: false }

  // Fallback (huge or corner targets): the side with the most free space, hugged
  // to that edge. May graze a very large target, but keeps the card on-screen.
  const opts = [
    { side: 'right', space: vw - t.right,  left: vw - cw - EDGE, top: aTop },
    { side: 'left',  space: t.left,        left: EDGE,           top: aTop },
    { side: 'below', space: vh - t.bottom, top: vh - ch - EDGE,  left: aLeft },
    { side: 'above', space: t.top,         top: EDGE,            left: aLeft },
  ]
  opts.sort((a, b) => b.space - a.space)
  return { ...opts[0], overlap: true }
}

// Arrow sits in the gap between the card and the target, pointing at the target.
function arrowFor(side, t, p, cw, ch) {
  const vw = window.innerWidth, vh = window.innerHeight
  const tcx = t.left + t.width / 2, tcy = t.top + t.height / 2
  let x, y, rot
  if (side === 'right')      { x = (t.right + p.left) / 2;          y = clamp(tcy, t.top + 8, t.bottom - 8); rot = 180 }
  else if (side === 'left')  { x = ((p.left + cw) + t.left) / 2;    y = clamp(tcy, t.top + 8, t.bottom - 8); rot = 0 }
  else if (side === 'below') { y = (t.bottom + p.top) / 2;          x = clamp(tcx, t.left + 8, t.right - 8); rot = -90 }
  else /* above */           { y = ((p.top + ch) + t.top) / 2;      x = clamp(tcx, t.left + 8, t.right - 8); rot = 90 }
  return { x: clamp(x, 10, vw - 10), y: clamp(y, 10, vh - 10), rot }
}

function Demo({ kind }) {
  if (!kind) return null
  const glyph = kind === 'move' ? '✛' : kind === 'rotate' ? '↻' : '⤢'
  const anim  = kind === 'move' ? 'animate-bounce' : kind === 'rotate' ? 'animate-spin' : 'animate-pulse'
  const label = kind === 'move' ? 'slides' : kind === 'rotate' ? 'spins' : 'resizes'
  return (
    <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <span className={`text-lg text-indigo-300 ${anim}`} style={{ animationDuration: kind === 'rotate' ? '2.4s' : undefined }}>{glyph}</span>
      <span className="text-[10px] text-gray-400">The object {label} as you drag.</span>
    </div>
  )
}

export default function GuidedCoach() {
  const active  = useOnboardingStore((s) => s.coachActive)
  const stepIdx = useOnboardingStore((s) => s.coachStep)
  const success = useOnboardingStore((s) => s.coachSuccess)
  const markSuccess = useOnboardingStore((s) => s.markCoachSuccess)
  const nextStep    = useOnboardingStore((s) => s.nextCoachStep)
  const endCoach    = useOnboardingStore((s) => s.endCoach)

  // Read-only subscriptions for detection.
  const objects     = useSceneStore((s) => s.objects)
  const selectedId  = useSceneStore((s) => s.selectedId)
  const connections = useElectronicsStore((s) => s.connections)
  const simRunning  = useElectronicsStore((s) => s.simulation.running)
  const activePanel = useUiStore((s) => s.activePanel)
  const simActive   = useUiStore((s) => s.simActive)
  const transformMode = useUiStore((s) => s.transformMode)

  const [rect, setRect]   = useState(null)
  const [stuck, setStuck] = useState(false)
  const [manualReady, setManualReady] = useState(false) // step advances via a Continue button
  const [cardSize, setCardSize] = useState({ w: CARD_W, h: 300 })
  const cardRef = useRef(null)
  const baseline = useRef({ pos: {}, rot: {}, scale: {}, conn: 0, mode: 'translate', panel: 'properties', cam: null })

  const total = COACH_STEPS.length
  const step  = COACH_STEPS[stepIdx]
  const isLast = stepIdx >= total - 1

  // ── Snapshot a baseline whenever the active step changes ────────────────────
  useEffect(() => {
    if (!active || !step) return
    setStuck(false)
    setManualReady(false)
    const objs = useSceneStore.getState().objects
    const cam = sceneManager.camera
    const oc  = sceneManager.orbitControls
    baseline.current = {
      pos:   Object.fromEntries(objs.map((o) => [o.id, { ...o.position }])),
      rot:   Object.fromEntries(objs.map((o) => [o.id, { ...o.rotation }])),
      scale: Object.fromEntries(objs.map((o) => [o.id, { ...o.scale }])),
      conn:  Object.keys(useElectronicsStore.getState().connections).length,
      mode:  useUiStore.getState().transformMode,
      panel: useUiStore.getState().activePanel,
      cam: (cam && oc) ? {
        dist: cam.position.distanceTo(oc.target),
        target: oc.target.clone(),
        dir: cam.position.clone().sub(oc.target).normalize(),
      } : null,
    }
    dbg(`▶ Step ${stepIdx + 1}/${total}: "${step.title}" — waiting for: ${describe(step.detect)}`)
  }, [active, stepIdx, step, total])

  // ── Measure the highlighted element (re-measure on resize / scroll) ─────────
  // Targets can live in horizontally-scrolling containers (the tab bar) or be
  // scrolled out of view — scroll them into view first so the user never has to
  // hunt for a hidden element (Code/Blocks tabs especially).
  useEffect(() => {
    if (!active || !step) return
    let raf1 = 0, raf2 = 0, timer = 0
    const find = () => document.querySelector(`[data-tour="${step.selector}"]`)
    const measure = (doScroll) => {
      const el = find()
      if (el && doScroll) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* older browsers */ }
      }
      setRect(el ? el.getBoundingClientRect() : null)
    }
    // First pass scrolls the target into view; later ticks just track its position.
    const track = () => measure(false)
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => measure(true)) })
    timer = setInterval(track, 400) // keep the spotlight glued as panels/layout shift
    window.addEventListener('resize', track)
    window.addEventListener('scroll', track, true)
    return () => {
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearInterval(timer)
      window.removeEventListener('resize', track)
      window.removeEventListener('scroll', track, true)
    }
  }, [active, stepIdx, step])

  // ── State-based detection ───────────────────────────────────────────────────
  // Every condition reads ACTUAL application state — never a click/DOM event — so
  // it advances no matter how the user reached that state (toolbar, shortcut, or
  // any future UI). Camera steps are handled by the separate poller below.
  useEffect(() => {
    if (!active || !step || success) return
    const d = step.detect
    if (d.type === 'cam') return            // handled by the camera poller below

    let done = false
    let needManual = false                  // step is satisfiable only via "Continue"
    let current = ''
    const selObj = objects.find((o) => o.id === selectedId)

    switch (d.type) {
      case 'objectType':
        done = objects.some((o) => d.any.includes(o.type))
        current = `objects=[${objects.map((o) => o.type).join(',') || '∅'}]`
        break
      case 'select':
        done = !!selectedId
        current = `selectedId=${selectedId || 'null'}`
        break
      case 'selectType':
        done = !!selObj && d.any.includes(selObj.type)
        current = `selectedType=${selObj?.type || 'none'}`
        break
      case 'activate': {
        // ACTIVATION: editor entered the target transform mode (toolbar OR key).
        // If we were already in that mode when the step began (e.g. translate is
        // the default), there's nothing to switch — let the user acknowledge.
        const target = d.mode
        current = `transformMode="${transformMode}"`
        if (transformMode === target) {
          if (baseline.current.mode !== target) done = true
          else { needManual = true; current += ' (already active)' }
        }
        break
      }
      case 'moved':   // EXECUTION
        done = objects.some((o) => changed3(o.position, baseline.current.pos[o.id]))
        current = 'position Δ'
        break
      case 'rotated':
        done = objects.some((o) => changed3(o.rotation, baseline.current.rot[o.id]))
        current = 'rotation Δ'
        break
      case 'scaled':
        done = objects.some((o) => changed3(o.scale, baseline.current.scale[o.id]))
        current = 'scale Δ'
        break
      case 'panel':
        current = `activePanel="${activePanel}"`
        if (activePanel === d.value) {
          if (baseline.current.panel !== d.value) done = true
          else { needManual = true; current += ' (already open)' }
        }
        break
      case 'connection':
        done = Object.keys(connections).length > baseline.current.conn
        current = `connections=${Object.keys(connections).length} (baseline ${baseline.current.conn})`
        break
      case 'codeRunning':              // Run Code (Arduino program executing)
        done = simRunning
        current = `simulation.running=${simRunning}`
        break
      case 'simActive':                // Start Simulation (physics/drive mode)
        done = simActive
        current = `simActive=${simActive}`
        break
      case 'sim':                      // legacy: either running state
        done = simRunning || simActive
        current = `simRunning=${simRunning}, simActive=${simActive}`
        break
      case 'simStopped':               // Stop Simulation (physics mode off)
        done = !simActive
        current = `simActive=${simActive}`
        break
      case 'ack':
        needManual = true
        current = 'awaiting Continue'
        break
      default:
        done = false
    }

    setManualReady(needManual)

    if (done) {
      dbg(`✓ "${step.title}" completed — ${describe(d)} satisfied (${current}).`)
      markSuccess()
    } else {
      dbg(`… "${step.title}" waiting — expected ${describe(d)} · current ${current}${needManual ? ' · (Continue available)' : ''}`)
    }
  }, [active, step, success, objects, selectedId, connections, simRunning, simActive, activePanel, transformMode, markSuccess])

  // ── Camera detection (polls the Three.js camera; read-only) ─────────────────
  useEffect(() => {
    if (!active || !step || success || step.detect.type !== 'cam') return
    let raf = 0
    const tick = () => {
      const cam = sceneManager.camera
      const oc  = sceneManager.orbitControls
      const base = baseline.current.cam
      if (cam && oc && base) {
        const dist = cam.position.distanceTo(oc.target)
        const dir  = cam.position.clone().sub(oc.target).normalize()
        let done = false
        if (step.detect.mode === 'zoom')      done = Math.abs(dist - base.dist) > base.dist * 0.08
        else if (step.detect.mode === 'pan')  done = oc.target.distanceTo(base.target) > Math.max(0.4, base.dist * 0.04)
        else /* orbit */                      done = dir.angleTo(base.dir) > 0.12
        if (done) { dbg(`✓ "${step.title}" completed — camera ${step.detect.mode} detected.`); markSuccess(); return }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, stepIdx, step, success, markSuccess])

  // ── Stuck recovery: nudge after a quiet period ─────────────────────────────
  useEffect(() => {
    if (!active || success) return
    const t = setTimeout(() => setStuck(true), STUCK_MS)
    return () => clearTimeout(t)
  }, [active, stepIdx, success])

  // ── Auto-advance shortly after success (still skippable via button) ─────────
  useEffect(() => {
    if (!success) return
    const nextTitle = isLast ? '(finish)' : COACH_STEPS[stepIdx + 1]?.title
    dbg(`→ "${step?.title}" done. Advancing to: ${nextTitle}`)
    const t = setTimeout(() => { isLast ? endCoach() : nextStep() }, 1700)
    return () => clearTimeout(t)
  }, [success, isLast, endCoach, nextStep, step, stepIdx])

  // ── Esc exits the whole coach ──────────────────────────────────────────────
  useEffect(() => {
    if (!active) return
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); endCoach() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, endCoach])

  // ── Measure the card so placement uses its real height (avoids guesswork) ────
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCardSize((prev) =>
      (Math.abs(prev.w - r.width) > 1 || Math.abs(prev.h - r.height) > 1) ? { w: r.width, h: r.height } : prev)
  }, [active, stepIdx, success, manualReady, stuck, rect])

  if (!active || !step) return null

  // ── Card + arrow placement (collision-avoiding) ─────────────────────────────
  let cardStyle, arrow = null
  if (rect) {
    const p = choosePlacement(rect, cardSize.w, cardSize.h)
    cardStyle = { top: p.top, left: p.left, width: CARD_W }
    arrow = arrowFor(p.side, rect, p, cardSize.w, cardSize.h)
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: CARD_W }
  }

  return (
    <div className="fixed inset-0 z-[120] pointer-events-none">
      {/* Spotlight (box-shadow dims everything else) + glow ring */}
      {rect && (
        <>
          <div
            className="absolute rounded-lg"
            style={{
              top: rect.top - 6, left: rect.left - 6,
              width: rect.width + 12, height: rect.height + 12,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
              border: '2px solid rgba(99,102,241,0.95)',
            }}
          />
          {/* pulsing glow ring — opacity pulse only, stays glued to the target
              (no scale "balloon" that could creep under the card) */}
          <div
            className="absolute rounded-lg animate-pulse"
            style={{
              top: rect.top - 6, left: rect.left - 6,
              width: rect.width + 12, height: rect.height + 12,
              border: `2px solid rgba(99,102,241,${stuck ? 0.9 : 0.55})`,
              boxShadow: '0 0 14px 2px rgba(79,70,229,0.18)',
            }}
          />
        </>
      )}

      {/* Bouncing arrow indicator — sits in the gap, points straight at the target */}
      {arrow && !success && (
        <div
          className="absolute animate-bounce"
          style={{ left: arrow.x, top: arrow.y, transform: 'translate(-50%,-50%)' }}
        >
          <span
            className="block text-3xl"
            style={{ transform: `rotate(${arrow.rot}deg)`, color: '#6366f1', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}
          >
            ➤
          </span>
        </div>
      )}

      {/* Coaching card — the only interactive part of the overlay */}
      <div
        ref={cardRef}
        className="absolute rounded-xl shadow-2xl p-4 pointer-events-auto"
        style={{ ...cardStyle, background: '#FFFFFF', border: `1px solid ${success ? 'rgba(34,197,94,0.5)' : 'rgba(99,102,241,0.35)'}` }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-indigo-500/80 font-semibold">
            Tutorial · {stepIdx + 1}/{total}
          </span>
          <button onClick={endCoach} className="text-gray-500 hover:text-slate-900 text-xs leading-none">✕ Exit</button>
        </div>

        {success ? (
          // ── Success state ──
          <div className="py-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">✅</span>
              <h3 className="text-sm font-bold text-green-700">{step.success}</h3>
            </div>
            <div className="flex items-center gap-1.5 mt-3">
              <div className="flex-1 h-1 rounded-full bg-gray-700 overflow-hidden">
                <div className="h-full bg-green-500 animate-pulse" style={{ width: '100%' }} />
              </div>
              <button
                onClick={() => (isLast ? endCoach() : nextStep())}
                className="px-3 py-1 rounded text-xs font-semibold text-white hover:brightness-110 transition-all"
                style={{ background: 'linear-gradient(90deg,#16a34a,#15803d)' }}
              >
                {isLast ? 'Finish ✓' : 'Continue →'}
              </button>
            </div>
          </div>
        ) : (
          // ── Teaching state ──
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{step.icon}</span>
              <h3 className="text-sm font-bold text-slate-900">{step.title}</h3>
              {step.shortcut && (
                <kbd className="ml-auto text-[10px] font-mono text-indigo-700 px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
                  {step.shortcut}
                </kbd>
              )}
            </div>

            <p className="text-[11px] text-gray-400 leading-snug mb-1.5">
              <span className="text-indigo-400 font-semibold">Why: </span>{step.why}
            </p>
            <p className="text-[11px] text-gray-300 leading-snug">
              <span className="text-indigo-400 font-semibold">How: </span>{step.how}
            </p>

            <Demo kind={step.demo} />

            <div className="mt-3 px-2.5 py-2 rounded-lg text-[11px] font-medium text-indigo-800"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.22)' }}>
              👉 {step.cta}
            </div>

            {/* Manual continue — for understanding beats and already-satisfied states */}
            {manualReady && (
              <>
                {step.detect.type !== 'ack' && (
                  <div className="mt-2 text-[10px] text-green-700">
                    ✓ {step.detect.type === 'activate'
                      ? 'This tool is already active (it’s the default).'
                      : 'This panel is already open.'} Continue when ready.
                  </div>
                )}
                <button
                  onClick={markSuccess}
                  className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-white hover:brightness-110 transition-all"
                  style={{ background: 'linear-gradient(90deg,#6366f1,#4f46e5)' }}
                >
                  {step.detect.type === 'ack' ? 'Got it — Continue →' : 'Continue →'}
                </button>
              </>
            )}

            {/* Stuck recovery */}
            {stuck && (
              <div className="mt-2 px-2.5 py-1.5 rounded-lg text-[10px] text-cyan-800 flex items-start gap-1.5"
                style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)' }}>
                <span>💡</span>
                <span>Need help? Look for the <span className="text-indigo-300">glowing arrow</span> — that’s exactly where to {step.detect.type === 'cam' ? 'act in the 3D view' : 'click'}.</span>
              </div>
            )}

            {/* Progress dots */}
            <div className="flex gap-1 mt-3 flex-wrap">
              {COACH_STEPS.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === stepIdx ? 'w-5 bg-indigo-500' : i < stepIdx ? 'w-1.5 bg-green-600' : 'w-1.5 bg-gray-600'}`} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
