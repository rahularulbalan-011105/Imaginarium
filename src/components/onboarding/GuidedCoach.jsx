import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { useElectronicsStore } from '../../stores/electronicsStore.js'
import { useRigidStore } from '../../stores/rigidStore.js'
import { useUiStore } from '../../stores/uiStore.js'
import { sceneManager } from '../../managers/SceneManager.js'
import { objectManager } from '../../managers/ObjectManager.js'
import * as THREE from 'three'
import { COACH_STEPS, wiringReport } from '../../onboarding/coachSteps.js'
import { DEBUG_STEPS } from '../../onboarding/debugSteps.js'
import { analyzeArduino } from '../../utils/arduinoDiagnostics.js'
import { trackEvent } from '../../utils/utmTracking.js'

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
    case 'bigWheels':  return `${d.count || 2} cylinders scaled up into wheels`
    case 'select':     return 'selectedId !== null'
    case 'selectType': return `selected object is [${d.any.join(' / ')}]`
    case 'activate':   return `transformMode === "${d.mode}"`
    case 'moved':      return 'selected object position changed'
    case 'rotated':    return 'selected object rotation changed'
    case 'scaled':     return 'selected object scale changed'
    case 'panel':      return `activePanel === "${d.value}"`
    case 'connection': return `${d.count || 1} new wire connection(s)`
    case 'wiredCorrectly': return 'all 4 motor wires connected correctly'
    case 'attach':     return 'a part is attached to a motor shaft'
    case 'attachPoint': return `${d.count || 1} attachment point(s) picked`
    case 'attachPointPicked': return `${d.count || 1} wheel attach point(s) picked`
    case 'attached':   return `${d.count || 1} wheel(s) attached to a motor`
    case 'bond':       return `${d.count || 1} new surface bond(s)`
    case 'flatChassis': return 'the box is a flat, wide chassis plate'
    case 'codeRunning': return 'code is running (simulation.running === true)'
    case 'simActive':  return 'simulation mode active (simActive === true)'
    case 'sim':        return 'a simulation is running'
    case 'simStopped': return 'simulation mode stopped (simActive === false)'
    case 'ack':        return 'user acknowledges (Continue)'
    case 'codeRan':    return 'the ▶ Run button was clicked'
    case 'codeCompiles': return 'the code compiles (0 errors)'
    case 'motorSignalFixed': return 'every motor TERM_A pin is wired'
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
    <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <span className={`text-lg ${anim}`} style={{ color: 'rgb(var(--a-400))', animationDuration: kind === 'rotate' ? '2.4s' : undefined }}>{glyph}</span>
      <span className="text-[10px] text-white/60">The object {label} as you drag.</span>
    </div>
  )
}

// Per-step tutorial videos — ONLY the steps you filmed. Drop the files in
// `public/tutorial/`. Every OTHER step keeps its text + the pointing arrow.
// If a file is missing, the step falls back to text automatically (onError).
const STEP_VIDEOS = {
  'flatten-chassis': 'resize-chassis.mp4',        // resizing the chassis
  'bond-motor':      'surface-attach-motors.mp4', // surface-attaching the BO motors
  'add-wheels':      'resize-wheels.mp4',         // resizing the cylindrical wheels
  'attach-both':     'pick-attach.mp4',           // picking the attachment points
  'attach-wheels':   'attach-wheels.mp4',         // attaching the wheels to the motors
  'wire-all':        'wiring.mp4',                // wiring
}

// Mission chapters — give the long tutorial a sense of place and a near goal.
const CHAPTERS = [
  { label: '🔨 BUILD', ids: ['mission-start', 'add-chassis', 'flatten-chassis', 'add-motors', 'bond-motor', 'add-wheels', 'attach-both', 'attach-wheels'] },
  { label: '⚡ WIRE',  ids: ['add-brain', 'wire-all'] },
  { label: '💻 CODE',  ids: ['open-code', 'run-code'] },
  { label: '🚗 DRIVE', ids: ['drive-it', 'mission-done'] },
]
const chapterOf = (id) => CHAPTERS.find((c) => c.ids.includes(id))?.label

// Badges earned at each chapter's final step — shown in that step's success card
// and all together on the finale card.
const BADGES = {
  'attach-wheels': { icon: '🔧', name: 'Engineer' },     // end of BUILD
  'wire-all':      { icon: '⚡', name: 'Electrician' },  // end of WIRE
  'run-code':      { icon: '💻', name: 'Programmer' },   // end of CODE
  'drive-it':      { icon: '🧑‍✈️', name: 'Pilot' },       // end of DRIVE
}

// Tiny completion chime (WebAudio, no assets). `big` = end-of-mission fanfare.
function ding(big = false) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const notes = big ? [523, 659, 784, 1047] : [880, 1320]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'
      const t = ctx.currentTime + i * (big ? 0.12 : 0.09)
      o.frequency.setValueAtTime(f, t)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o.start(t); o.stop(t + 0.4)
    })
    setTimeout(() => { try { ctx.close() } catch { /* ignore */ } }, big ? 1200 : 700)
  } catch { /* audio blocked — fine */ }
}

// Confetti burst on step completion (Web Animations API, self-cleaning).
function Burst({ n = 16 }) {
  const ref = useRef(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const EMO = ['🎉', '✨', '⚙️', '🔩', '🟠', '💫', '⭐']
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span')
      s.textContent = EMO[i % EMO.length]
      s.style.cssText = 'position:absolute;left:50%;top:35%;font-size:13px;pointer-events:none;will-change:transform,opacity'
      host.appendChild(s)
      const ang  = (Math.PI * 2 * i) / n + Math.random() * 0.6
      const dist = 55 + Math.random() * 75
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 20
      s.animate(
        [
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% + ${dy.toFixed(0)}px)) scale(0.5) rotate(${(Math.random() * 300 - 150).toFixed(0)}deg)`, opacity: 0 },
        ],
        { duration: 650 + Math.random() * 450, easing: 'cubic-bezier(.2,.8,.3,1)' }
      ).onfinish = () => s.remove()
    }
  }, [n])
  return <div ref={ref} className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }} />
}

export default function GuidedCoach() {
  const active  = useOnboardingStore((s) => s.coachActive)
  const mission = useOnboardingStore((s) => s.coachMission)
  const stepIdx = useOnboardingStore((s) => s.coachStep)
  const success = useOnboardingStore((s) => s.coachSuccess)
  const markSuccess = useOnboardingStore((s) => s.markCoachSuccess)
  const nextStep    = useOnboardingStore((s) => s.nextCoachStep)
  const prevStep    = useOnboardingStore((s) => s.prevCoachStep)
  const endCoach    = useOnboardingStore((s) => s.endCoach)

  // Read-only subscriptions for detection.
  const objects     = useSceneStore((s) => s.objects)
  const selectedId  = useSceneStore((s) => s.selectedId)
  const connections = useElectronicsStore((s) => s.connections)
  const attachments = useElectronicsStore((s) => s.attachments)
  const bonds       = useRigidStore((s) => s.bonds)
  const simRunning  = useElectronicsStore((s) => s.simulation.running)
  const code        = useElectronicsStore((s) => s.code)
  const activePanel = useUiStore((s) => s.activePanel)
  const simActive   = useUiStore((s) => s.simActive)
  const transformMode = useUiStore((s) => s.transformMode)

  const [rect, setRect]   = useState(null)
  const [stuck, setStuck] = useState(false)
  const [manualReady, setManualReady] = useState(false) // step advances via a Continue button
  const [cardSize, setCardSize] = useState({ w: CARD_W, h: 300 })
  const [videoBroken, setVideoBroken] = useState(false)   // missing/failed video → show text
  const [prog, setProg] = useState(null)                  // live [n, need] for counted steps
  const progRef = useRef('')
  const [extraRects, setExtraRects] = useState([])        // rects for step.arrows (multi-tool steps)
  const [drag, setDrag] = useState(null)                  // {x,y} manual card position (draggable box)
  const [needsScroll, setNeedsScroll] = useState(false)   // target is off-screen → show a scroll hint
  const [runTick, setRunTick] = useState(0)               // ↑ each time ▶ Run is clicked (debug mission)
  const [creditTick, setCreditTick] = useState(0)         // ↑ when the credit dialog is closed
  const cardRef = useRef(null)
  const baseline = useRef({ pos: {}, rot: {}, scale: {}, conn: 0, mode: 'translate', panel: 'properties', cam: null })

  const STEPS = mission === 'debug' ? DEBUG_STEPS : COACH_STEPS
  const total = STEPS.length
  const step  = STEPS[stepIdx]
  const isLast = stepIdx >= total - 1

  // Complete the current step. The debug mission advances QUIETLY — straight to
  // the next instruction with no green "✓ …" success flash / confetti between
  // steps. The build tutorial keeps its celebratory flash (markSuccess).
  const finishStep = () => {
    if (mission !== 'debug') { markSuccess(); return }
    trackEvent('tutorial_step', { step: stepIdx + 1, step_id: step?.id })
    if (isLast) { trackEvent('tutorial_completed', { steps: total }); endCoach() }
    else nextStep()
  }
  const videoName = step && STEP_VIDEOS[step.id]
  const videoSrc  = videoName ? `${import.meta.env.BASE_URL}tutorial/${videoName}` : null
  // Retry the video whenever the step changes (a filmed step shows a video/placeholder,
  // never the text — only NON-filmed steps show text).
  useEffect(() => { setVideoBroken(false); setDrag(null) }, [stepIdx])

  // Count ▶ Run clicks (debug mission's 'codeRan' detector) — the event fires on
  // every Run press, before the compile gate, so a broken sketch still counts.
  useEffect(() => {
    const onRun = () => setRunTick((t) => t + 1)
    window.addEventListener('constructa:code-run', onRun)
    return () => window.removeEventListener('constructa:code-run', onRun)
  }, [])
  useEffect(() => {
    const onClosed = () => setCreditTick((t) => t + 1)
    window.addEventListener('constructa:credit-closed', onClosed)
    return () => window.removeEventListener('constructa:credit-closed', onClosed)
  }, [])

  // ── Snapshot a baseline whenever the active step changes ────────────────────
  useEffect(() => {
    if (!active || !step) return
    setStuck(false)
    setManualReady(false)
    // Leaving a viewport-tool step (e.g. Surface bond) → turn the tool off so its
    // banner/mode doesn't linger into the next step.
    if (step.exitTools) {
      const ui = useUiStore.getState()
      if (ui.surfaceToolActive) ui.setSurfaceTool(false)
      if (ui.extrudeToolActive) ui.setExtrudeTool(false)
      if (ui.sliceToolActive)   ui.setSliceTool(false)
    }
    // Steps flagged exitSim leave the physics simulation on entry (the final
    // "find Learn" beat returns to the editor before pointing at the button).
    if (step.exitSim) window.dispatchEvent(new Event('constructa:exit-sim'))
    // Steps flagged openLearn pop the Learn menu open so the arrow can point at
    // an item inside it (e.g. Show Product Tour).
    if (step.openLearn) window.dispatchEvent(new Event('constructa:open-learn'))
    // Steps flagged showCredit pop the "created by" credit dialog; the step then
    // waits for it to be closed (detect: creditClosed) before advancing.
    if (step.showCredit) window.dispatchEvent(new Event('constructa:template-done'))
    // Steps flagged clearScene wipe the workspace (the finished template robot
    // vanishes) by loading a blank project — reuses the Header load path.
    if (step.clearScene) window.dispatchEvent(new CustomEvent('constructa:load-project', { detail: {
      name: 'Untitled Project', objects: [],
      electronics: { connections: {}, code: '', attachments: {} },
      surface: { patches: {} }, rigid: { bonds: {} }, joints: { joints: {} }, robots: { blueprints: {} },
    } }))
    const objs = useSceneStore.getState().objects
    const cam = sceneManager.camera
    const oc  = sceneManager.orbitControls
    baseline.current = {
      pos:   Object.fromEntries(objs.map((o) => [o.id, { ...o.position }])),
      rot:   Object.fromEntries(objs.map((o) => [o.id, { ...o.rotation }])),
      scale: Object.fromEntries(objs.map((o) => [o.id, { ...o.scale }])),
      conn:  Object.keys(useElectronicsStore.getState().connections).length,
      attach: Object.keys(useElectronicsStore.getState().attachments || {}).length,
      bonds:  Object.keys(useRigidStore.getState().bonds || {}).length,
      mode:  useUiStore.getState().transformMode,
      panel: useUiStore.getState().activePanel,
      run:   runTick,   // baseline Run-click count for the 'codeRan' detector
      credit: creditTick, // baseline credit-close count for the 'creditClosed' detector
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
    // Primary anchor, falling back to `step.fallback` when the primary isn't on
    // screen yet (e.g. point at the Elec TAB until the panel is open, then at the
    // BO Motor button once it exists). selector/fallback may be a function of live
    // state so the arrow can MOVE mid-step (e.g. Cylinder → Scale once 2 exist).
    const resolveSel = (s) => (typeof s === 'function' ? s(useSceneStore.getState(), useElectronicsStore.getState()) : s)
    const find = () => document.querySelector(`[data-tour="${resolveSel(step.selector)}"]`)
      || (step.fallback ? document.querySelector(`[data-tour="${resolveSel(step.fallback)}"]`) : null)
    const measure = (doScroll) => {
      const el = find()
      if (el) {
        const r0 = el.getBoundingClientRect()
        // Off-screen (needs scrolling to reach)? — the arrow can't sit on it yet.
        const off = r0.bottom < 40 || r0.top > window.innerHeight - 20 || r0.right < 40 || r0.left > window.innerWidth - 20
        setNeedsScroll(off)
        if (doScroll || off) {
          try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: off && !doScroll ? 'smooth' : 'auto' }) } catch { /* older browsers */ }
        }
      } else {
        setNeedsScroll(false)
      }
      setRect(el ? el.getBoundingClientRect() : null)
      // Extra arrow targets (multi-tool steps) — skip any that aren't on screen.
      const extras = (step.arrows || [])
        .map((sel) => document.querySelector(`[data-tour="${sel}"]`))
        .filter(Boolean)
        .map((e) => e.getBoundingClientRect())
      setExtraRects(extras)
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
    let liveProg = null                     // [n, need] → "1/2 ✓" chip in the card
    const selObj = objects.find((o) => o.id === selectedId)

    switch (d.type) {
      case 'objectType': {
        const n = objects.filter((o) => d.any.includes(o.type)).length
        done = n >= (d.count || 1)          // optional count: require ≥ N of the type
        current = `have ${n}/${d.count || 1} of [${d.any.join('/')}]`
        liveProg = [n, d.count || 1]
        break
      }
      case 'bigWheels': {   // ≥ count cylinders that have been SCALED UP into wheels
        const need = d.count || 2
        const min = d.min || 2.6            // default cylinder longest dim = 2; >2.6 ≈ scaled ≥1.3×
        let n = 0
        for (const o of objects) {
          if (o.type !== 'cylinder') continue
          const mesh = objectManager.getMesh(o.id)
          if (!mesh) continue
          const sz = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
          if (Math.max(sz.x, sz.y, sz.z) > min) n++
        }
        done = n >= need
        current = `${n}/${need} wheels sized up (>${min}u)`
        liveProg = [n, need]
        break
      }
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
      case 'flatChassis': {
        // Measure the box's REAL world size: the two footprint dims must be > 4
        // and the thickness < 1 (~0.5, a big flat plate) — also gives room to draw
        // a surface patch on it later. Uses the actual bounding box, not scale.
        const b = objects.find((o) => o.type === 'box')
        const mesh = b && objectManager.getMesh(b.id)
        if (mesh) {
          const sz = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
          const d = [sz.x, sz.y, sz.z].sort((a, z) => a - z)   // ascending: [thin, mid, long]
          done = d[0] < 1 && d[1] > 4 && d[2] > 4               // thin plate: thickness < 1
          current = `dims=${sz.x.toFixed(1)}×${sz.y.toFixed(1)}×${sz.z.toFixed(1)} (need 2 dims >4, 1 <1)`
        } else current = 'no box'
        break
      }
      case 'panel':
        current = `activePanel="${activePanel}"`
        if (activePanel === d.value) {
          if (baseline.current.panel !== d.value) done = true
          else { needManual = true; current += ' (already open)' }
        }
        break
      case 'connection': {
        const need = d.count || 1
        const made = Math.max(0, Object.keys(connections).length - baseline.current.conn)
        done = made >= need
        current = `connections=${Object.keys(connections).length} (need +${need} over ${baseline.current.conn})`
        liveProg = [Math.min(made, need), need]
        break
      }
      case 'wiredCorrectly': {   // all 4 CORRECT wires present AND no wrong ones
        const rep = wiringReport({ objects }, { connections })
        done = rep.ready && rep.allDone
        current = rep.ready ? `correct=${4 - rep.missing.length}/4 wrong=${rep.wrong.length}` : 'not ready'
        liveProg = rep.ready ? [4 - rep.missing.length, 4] : [0, 4]
        break
      }
      case 'attach':      // a wheel/part mounted on a motor shaft
        done = Object.keys(attachments || {}).length > baseline.current.attach
        current = `attachments=${Object.keys(attachments || {}).length} (baseline ${baseline.current.attach})`
        break
      case 'attachPoint': {   // ≥ count wheels have an attach point picked OR are attached
        const need = d.count || 1
        const att = attachments || {}
        const n = objects.filter((o) => o.attachmentOffset || att[o.id]).length
        done = n >= need
        current = `attach-progress=${n}/${need}`
        break
      }
      case 'attachPointPicked': {   // ≥ count wheels have a picked attachment point
        const need = d.count || 1
        const att = attachments || {}
        const n = objects.filter((o) => o.attachmentOffset || att[o.id]).length   // attaching also counts
        done = n >= need
        current = `points picked ${n}/${need}`
        liveProg = [Math.min(n, need), need]
        break
      }
      case 'attached': {   // ≥ count objects mounted on a motor shaft
        const need = d.count || 1
        const n = Object.keys(attachments || {}).length
        done = n >= need
        current = `attached ${n}/${need}`
        liveProg = [Math.min(n, need), need]
        break
      }
      case 'bond': {      // ≥ count NEW surface bonds joined two parts
        const need = d.count || 1
        const made = Math.max(0, Object.keys(bonds || {}).length - baseline.current.bonds)
        done = made >= need
        current = `bonds=${Object.keys(bonds || {}).length} (need +${need} over ${baseline.current.bonds})`
        liveProg = [Math.min(made, need), need]
        break
      }
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
        needManual = !step.auto          // step.auto → no button; auto-dismisses
        current = step.auto ? 'auto-dismiss beat' : 'awaiting Continue'
        break
      case 'codeRan':                  // ▶ Run pressed this step (even if it won't compile)
        done = runTick > (baseline.current.run || 0)
        current = `runTick=${runTick} (base ${baseline.current.run || 0})`
        break
      case 'creditClosed':             // the "created by" credit dialog was dismissed
        needManual = false
        done = creditTick > (baseline.current.credit || 0)
        current = `creditTick=${creditTick} (base ${baseline.current.credit || 0})`
        break
      case 'codeCompiles': {           // the missing ; was added → analyzer reports 0 errors
        const board = objects.some((o) => o.type === 'subo') ? 'subo' : 'arduino'
        const rep = analyzeArduino(code || '', { board })
        done = !!rep.ok
        current = `compile ok=${rep.ok} errors=${rep.errors?.length ?? '?'}`
        break
      }
      case 'motorSignalFixed': {       // every motor's TERM_A pin now has a wire
        const motors = objects.filter((o) => ['motor_bo', 'motor', 'motor_dc'].includes(o.type))
        const conns = Object.values(connections || {})
        const wired = (m) => conns.some((c) => c.fromPinId === `${m.id}:TERM_A` || c.toPinId === `${m.id}:TERM_A`)
        const n = motors.filter(wired).length
        done = motors.length > 0 && n === motors.length
        current = `motors TERM_A wired ${n}/${motors.length}`
        liveProg = [n, motors.length || 1]
        break
      }
      default:
        done = false
    }

    setManualReady(needManual)

    // Publish the live "1/2 ✓" progress chip (guarded — only on actual change).
    const progKey = liveProg ? `${stepIdx}:${liveProg[0]}/${liveProg[1]}` : `${stepIdx}:`
    if (progRef.current !== progKey) { progRef.current = progKey; setProg(liveProg) }

    if (done) {
      dbg(`✓ "${step.title}" completed — ${describe(d)} satisfied (${current}).`)
      finishStep()
    } else {
      dbg(`… "${step.title}" waiting — expected ${describe(d)} · current ${current}${needManual ? ' · (Continue available)' : ''}`)
    }
  }, [active, step, success, objects, selectedId, connections, simRunning, simActive, activePanel, transformMode, code, runTick, creditTick, markSuccess])

  // ── Auto-dismiss beats (step.auto = ms) — no button; complete themselves ─────
  useEffect(() => {
    if (!active || success || !step?.auto) return
    const t = setTimeout(() => finishStep(), step.auto)
    return () => clearTimeout(t)
  }, [active, stepIdx, success, step, markSuccess])

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
        if (done) { dbg(`✓ "${step.title}" completed — camera ${step.detect.mode} detected.`); finishStep(); return }
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
    ding(isLast)   // 🎵 completion chime (fanfare on the final step)
    // Analytics: one event per completed step → the dashboard's Tutorial funnel
    // (per-user sid, so we can see exactly how far each user gets).
    trackEvent('tutorial_step', { step: stepIdx + 1, step_id: step?.id })
    if (isLast) trackEvent('tutorial_completed', { steps: total })
    const nextTitle = isLast ? '(finish)' : STEPS[stepIdx + 1]?.title
    dbg(`→ "${step?.title}" done. Advancing to: ${nextTitle}`)
    const t = setTimeout(() => { isLast ? endCoach() : nextStep() }, 1700)
    return () => clearTimeout(t)
  }, [success, isLast, endCoach, nextStep, step, stepIdx])

  // Analytics: record the tutorial being opened (or resumed) once per activation.
  useEffect(() => {
    if (active) trackEvent('tutorial_started', { at_step: stepIdx + 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Early exit (✕ button / Esc) — record where the user dropped off.
  const exitEarly = () => {
    trackEvent('tutorial_exited', { at_step: stepIdx + 1, step_id: step?.id })
    endCoach()
  }

  // ── Esc exits the whole coach ──────────────────────────────────────────────
  useEffect(() => {
    if (!active) return
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); exitEarly() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, endCoach, stepIdx])

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
    // Anchor not on screen → tuck the card in the bottom-left corner (clear of the
    // right panel + any centre prompt) instead of covering the middle of the app.
    cardStyle = { left: 20, bottom: 70, width: CARD_W }
  }
  // Manual drag wins: once the user moves the card, pin it there for this step.
  if (drag) cardStyle = { left: drag.x, top: drag.y, width: CARD_W }

  // Drag the card by its header (ignores clicks on buttons/inputs/video).
  const onDragStart = (e) => {
    if (e.target.closest('button, input, video, a')) return
    const startX = e.clientX, startY = e.clientY
    const r0 = cardRef.current?.getBoundingClientRect()
    if (!r0) return
    const move = (ev) => setDrag({
      x: Math.max(4, Math.min(window.innerWidth - 60, r0.left + (ev.clientX - startX))),
      y: Math.max(4, Math.min(window.innerHeight - 40, r0.top + (ev.clientY - startY))),
    })
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  // Wrong-wiring warning for Step 9 (the arrow already points at the wire to cut).
  const wireRep = step?.id === 'wire-all' ? wiringReport({ objects }, { connections }) : null
  const wireWrong = !!wireRep && wireRep.wrong.length > 0

  return (
    <div className="fixed inset-0 z-[120] pointer-events-none">
      {/* Highlight ring around the target (NO screen dimming) + glow ring */}
      {rect && (
        <>
          <div
            className="absolute rounded-lg"
            style={{
              top: rect.top - 6, left: rect.left - 6,
              width: rect.width + 12, height: rect.height + 12,
              border: '2px solid rgb(var(--a-500) / 0.95)',
            }}
          />
          {/* pulsing glow ring — opacity pulse only, stays glued to the target
              (no scale "balloon" that could creep under the card) */}
          <div
            className="absolute rounded-lg animate-pulse"
            style={{
              top: rect.top - 6, left: rect.left - 6,
              width: rect.width + 12, height: rect.height + 12,
              border: `2px solid rgb(var(--a-500) / ${stuck ? 0.9 : 0.55})`,
              boxShadow: '0 0 14px 2px rgb(var(--a-600) / 0.18)',
            }}
          />
        </>
      )}

      {/* Extra arrow targets (multi-tool steps) — a static ring + ➤ on each */}
      {!success && extraRects.map((r, i) => (
        <div key={i}>
          <div className="absolute rounded-lg animate-pulse" style={{
            top: r.top - 5, left: r.left - 5, width: r.width + 10, height: r.height + 10,
            border: '2px solid rgb(var(--a-500) / 0.7)', boxShadow: '0 0 10px 1px rgb(var(--a-600) / 0.15)',
          }} />
          <div className="absolute animate-bounce" style={{ left: r.left + r.width / 2, top: r.top - 16, transform: 'translate(-50%,-50%)' }}>
            <span className="block text-2xl" style={{ transform: 'rotate(-90deg)', color: 'rgb(var(--a-500))', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}>➤</span>
          </div>
        </div>
      ))}

      {/* Bouncing arrow indicator — sits in the gap, points straight at the target */}
      {arrow && !success && (
        <div
          className="absolute animate-bounce"
          style={{ left: arrow.x, top: arrow.y, transform: 'translate(-50%,-50%)' }}
        >
          <span
            className="block text-3xl"
            style={{ transform: `rotate(${arrow.rot}deg)`, color: 'rgb(var(--a-500))', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}
          >
            ➤
          </span>
        </div>
      )}

      {/* Coaching card — the only interactive part of the overlay */}
      <div
        ref={cardRef}
        className="absolute rounded-xl shadow-2xl p-4 pointer-events-auto"
        style={{ ...cardStyle, background: 'rgba(20,21,27,0.98)', color: '#e5e7eb', border: `1px solid ${success ? 'rgba(34,197,94,0.5)' : 'rgb(var(--a-500) / 0.4)'}` }}
      >
        {/* Header doubles as the drag handle — move the card anywhere on screen */}
        <div onMouseDown={onDragStart} className="flex items-center justify-between mb-1.5 cursor-move select-none">
          <span className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5" style={{ color: 'rgb(var(--a-400))' }}>
            <span className="opacity-50" title="Drag to move">⠿</span>
            Tutorial · {stepIdx + 1}/{total}
            {chapterOf(step.id) && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide"
                style={{ background: 'rgb(var(--a-500) / 0.18)', border: '1px solid rgb(var(--a-500) / 0.35)', color: 'rgb(var(--a-400))' }}>
                {chapterOf(step.id)}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <button onClick={prevStep} className="text-white/60 hover:text-white text-xs leading-none" title="Go back a step">← Back</button>
            )}
            <button onClick={exitEarly} className="text-white/60 hover:text-white text-xs leading-none">✕ Exit</button>
          </div>
        </div>

        {success && <Burst n={isLast ? 36 : 16} />}

        {success ? (
          // ── Success state ──
          <div className="py-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">✅</span>
              <h3 className="text-sm font-bold text-green-400">{step.success}</h3>
            </div>
            {BADGES[step.id] && (
              <div className="mt-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5"
                style={{ background: 'rgb(var(--a-500) / 0.12)', border: '1px solid rgb(var(--a-500) / 0.35)', color: 'rgb(var(--a-600))' }}>
                <span className="text-base">{BADGES[step.id].icon}</span>
                Badge earned: {BADGES[step.id].name}!
              </div>
            )}
            {/* No Continue button — steps auto-advance after the success flash. */}
            <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <div className="h-full bg-green-500 animate-pulse" style={{ width: '100%' }} />
            </div>
          </div>
        ) : (
          // ── Teaching state ──
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{step.icon}</span>
              <h3 className="text-sm font-bold text-white">{step.title}</h3>
            </div>

            {videoName ? (
              videoBroken ? (
                // Filmed step whose clip isn't uploaded yet → video-slot placeholder
                // (NOT the text). Plays the real clip the moment the file is added.
                <div
                  className="w-full rounded-lg mb-1 flex flex-col items-center justify-center text-center px-3"
                  style={{ minHeight: 150, background: '#000', border: '1px dashed rgb(var(--a-500) / 0.45)' }}
                >
                  <div className="text-2xl mb-1">🎬</div>
                  <div className="text-[11px] text-white/90 font-semibold">Tutorial video</div>
                  <div className="text-[10px] text-white/50 mt-0.5">
                    plays here once <code className="text-white/60">{videoName}</code> is added
                  </div>
                </div>
              ) : (
                <video
                  key={videoSrc}
                  src={videoSrc}
                  autoPlay loop muted playsInline controls
                  onError={() => setVideoBroken(true)}
                  className="w-full rounded-lg mb-1 bg-black"
                  style={{ maxHeight: 240 }}
                />
              )
            ) : (
              <>
                {/* the robot speaks — its personality carries the tutorial */}
                <div className="flex items-start gap-1.5 mb-2">
                  <span className="text-xl leading-none mt-0.5">🤖</span>
                  <div className="text-[11px] text-white/90 leading-snug rounded-lg rounded-tl-sm px-2.5 py-1.5 flex-1"
                    style={{ background: 'rgb(var(--a-500) / 0.12)', border: '1px solid rgb(var(--a-500) / 0.25)' }}>
                    {step.why}
                  </div>
                </div>
                <p className="text-[11px] text-white/80 leading-snug">
                  <span className="text-indigo-400 font-semibold">Do this: </span>{step.how}
                </p>
                <Demo kind={step.demo} />
              </>
            )}

            {/* Small "what this tool does" note — shown even on video steps */}
            {step.toolTip && (
              <div className="mt-2 px-2.5 py-1.5 rounded-lg text-[10px] leading-snug"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1' }}>
                <span className="font-semibold" style={{ color: 'rgb(var(--a-400))' }}>{step.toolTip.tool} tool: </span>{step.toolTip.text}
              </div>
            )}

            {/* Scroll hint — the target is below the fold; we auto-scroll to it */}
            {needsScroll && (
              <div className="mt-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5"
                style={{ background: 'rgb(var(--a-500) / 0.14)', border: '1px solid rgb(var(--a-500) / 0.3)', color: '#fdba74' }}>
                <span className="animate-bounce">↓</span>
                <span>Scroll the panel to find it — I'm scrolling to it now; watch for the arrow.</span>
              </div>
            )}

            {/* CTA (hidden on the intro — there the single button below IS the CTA) */}
            {step.detect.type !== 'ack' && (
              <div className="mt-3 px-2.5 py-2 rounded-lg text-[11px] font-medium flex items-center gap-2"
                style={{ background: 'rgb(var(--a-500) / 0.14)', border: '1px solid rgb(var(--a-500) / 0.3)', color: '#fdba74' }}>
                <span className="flex-1">👉 {step.cta}</span>
                {prog && prog[1] > 1 && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: prog[0] > 0 ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.12)', color: prog[0] > 0 ? '#4ade80' : '#fdba74' }}>
                    {prog[0]}/{prog[1]} ✓
                  </span>
                )}
              </div>
            )}

            {/* Wrong-wiring alert (Step 9) — the arrow points at the wire to cut */}
            {wireWrong && (
              <div className="mt-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-start gap-1.5"
                style={{ background: 'rgba(239,68,68,0.16)', border: '1px solid rgba(239,68,68,0.45)', color: '#fca5a5' }}>
                <span>⚠</span>
                <span>That wire’s wrong! Follow the arrow to <b>✂ Cut</b> it, then wire it the right way (TERM_A→D5/D6, TERM_B→GND).</span>
              </div>
            )}

            {/* Finale — show off every badge earned on the journey */}
            {step.id === 'mission-done' && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                {Object.values(BADGES).map((b) => (
                  <span key={b.name} className="px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1"
                    style={{ background: 'rgb(var(--a-500) / 0.12)', border: '1px solid rgb(var(--a-500) / 0.3)', color: 'rgb(var(--a-600))' }}>
                    {b.icon} {b.name}
                  </span>
                ))}
              </div>
            )}

            {/* Manual continue — for understanding beats and already-satisfied states */}
            {manualReady && (
              <>
                {step.detect.type !== 'ack' && (
                  <div className="mt-2 text-[10px] text-green-400">
                    ✓ {step.detect.type === 'activate'
                      ? 'This tool is already active (it’s the default).'
                      : 'This panel is already open.'} Continue when ready.
                  </div>
                )}
                <button
                  onClick={finishStep}
                  className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-white hover:brightness-110 transition-all"
                  style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))' }}
                >
                  {step.detect.type === 'ack' ? step.cta : 'Continue →'}
                </button>
              </>
            )}

            {/* Slim progress bar (no shape row) */}
            <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${Math.round((stepIdx / Math.max(1, total - 1)) * 100)}%`, background: 'rgb(var(--a-500))' }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
