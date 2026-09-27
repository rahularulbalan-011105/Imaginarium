import { useEffect, useMemo, useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { usePhysicsStore } from '../stores/physicsStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { recordSnapshot } from '../managers/history/editorDispatch.js'
import { driveManager } from '../managers/DriveManager.js'
import { buildAssemblies } from '../utils/robotAssembly.js'
import { roboticsTelemetry } from '../managers/physics/robotics/telemetry.js'
import { MATERIALS } from '../managers/physics/robotics/materials.js'
import { SERVO_PRESETS } from '../managers/physics/robotics/ServoActuator.js'
import { GAIT_TYPES, TRAJECTORY_TYPES } from '../managers/physics/robotics/gait.js'
import { TERRAIN_TYPES } from '../managers/physics/robotics/terrain.js'
import {
  resolveObjectPhysics, resolveServoConfig, resolveJointConfig, resolveRobotConfig,
  COLLIDER_SHAPES, FORWARD_AXES,
} from '../managers/physics/robotics/config.js'
import { getMassForObject } from '../managers/physics/MassCalculator.js'

// ─────────────────────────────────────────────────────────────────────────────
// PhysicsPanel — configuration + live telemetry for the articulated physics
// engine. Sections appear only when relevant to the selection:
//   always:        WORLD (gravity, timestep, solver, terrain) · DEBUG overlay
//   any part:      BODY (material, mass, collision shape)
//   a servo:       ACTUATOR · JOINT · THERMAL · ENCODER
//   robot (root):  MODEL · LOCOMOTION · BALANCE · POWER · IMU
//   while running: TELEMETRY (read from the physics bus at 5 Hz — no per-frame renders)
// Every edit writes obj.physics (sparse overrides) and records ONE undo step.
// ─────────────────────────────────────────────────────────────────────────────

const DEG = 180 / Math.PI
const ELECTRONICS = new Set(['arduino', 'subo', 'servo', 'motor', 'motor_dc', 'motor_bo', 'led', 'ultrasonic', 'ir_sensor', 'gas_sensor', 'oled', 'buzzer', 'ldr_sensor', 'dht11', 'color_sensor'])

const S = {
  card:  { background: 'rgb(var(--g-800) / 0.5)', color: 'rgb(var(--g-200))' },
  muted: { color: 'rgb(var(--g-500))' },
  input: { background: 'rgb(var(--g-900))', color: 'rgb(var(--g-100))', border: '1px solid rgb(var(--g-700))' },
}

function Section({ title, children, right }) {
  return (
    <div className="px-3 pt-3">
      <div className="flex items-center mb-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider flex-1" style={S.muted}>{title}</div>
        {right}
      </div>
      <div className="rounded-lg p-2 space-y-1.5" style={S.card}>{children}</div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="flex items-center gap-2 text-[11px]" title={hint}>
      <span className="flex-1 truncate">{label}</span>
      {children}
    </label>
  )
}

/** Number input that commits (one undo step) on blur / Enter, not per keystroke. */
function Num({ value, onCommit, step = 0.01, min, max, width = 72, placeholder }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  const commit = () => {
    if (draft === '' || draft === null) { if (value != null) onCommit(null); return }
    let v = Number(draft)
    if (!Number.isFinite(v)) { setDraft(value ?? ''); return }
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    if (v !== value) onCommit(v)
  }
  return (
    <input type="number" step={step} value={draft} placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className="rounded px-1.5 py-0.5 text-[11px] text-right" style={{ ...S.input, width }} />
  )
}

function Sel({ value, options, onChange, width = 110 }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded px-1 py-0.5 text-[11px]" style={{ ...S.input, width }}>
      {options.map(o => typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Check({ checked, onChange }) {
  return <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
}

// Sparse write of obj.physics at `path` + one undo record.
function usePhysicsEditor(obj) {
  const updateObject = useSceneStore((s) => s.updateObject)
  return (path, value, label) => {
    if (!obj) return
    const next = JSON.parse(JSON.stringify(obj.physics ?? {}))
    let cur = next
    for (let i = 0; i < path.length - 1; i++) cur = (cur[path[i]] ??= {})
    const key = path[path.length - 1]
    if (value === null || value === undefined) delete cur[key]
    else cur[key] = value
    updateObject(obj.id, { physics: Object.keys(next).length ? next : undefined })
    recordSnapshot(label ?? `Physics: ${path.join('.')}`)
  }
}

function useTelemetry(active) {
  const [t, setT] = useState(() => roboticsTelemetry.get())
  useEffect(() => {
    if (!active) { setT(null); return }
    const id = setInterval(() => setT(roboticsTelemetry.get()), 200)
    return () => clearInterval(id)
  }, [active])
  return t
}

export default function PhysicsPanel() {
  const objects    = useSceneStore((s) => s.objects)
  const selectedId = useSceneStore((s) => s.selectedId)
  const simActive  = useUiStore((s) => s.simActive)
  const ps = usePhysicsStore()
  const sel = objects.find(o => o.id === selectedId) ?? null
  const telemetry = useTelemetry(simActive)

  // The robot that the selection belongs to → its root carries robot settings.
  const root = useMemo(() => {
    if (!sel) return null
    const withCfg = objects.find(o => o.physics?.robot)
    if (withCfg) return withCfg
    const asm = buildAssemblies().find(a => a.memberIds.includes(sel.id))
    return objects.find(o => o.id === asm?.rootId) ?? sel
  }, [sel, objects])

  const editSel = usePhysicsEditor(sel)
  const editRoot = usePhysicsEditor(root)
  const world = ps.worldPhysics
  const gravity = ps.gravity

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-6 text-[11px]">
      <Section title="World">
        <Field label="Gravity" hint="m/s² (Earth −9.81)">
          <Sel value={ps.environment} width={92}
            options={[{ value: 'earth', label: 'Earth' }, { value: 'moon', label: 'Moon' }, { value: 'mars', label: 'Mars' }, { value: 'zero_g', label: 'Zero-G' }, { value: 'custom', label: 'Custom' }]}
            onChange={(v) => v === 'custom' ? ps.setCustomGravity(gravity) : ps.setEnvironment(v)} />
          <Num value={+gravity.toFixed(3)} step={0.1} onCommit={(v) => ps.setCustomGravity(v ?? -9.81)} width={60} />
        </Field>
        <Field label="Physics rate" hint="Fixed timestep, independent of the render frame rate. Servos on light links need ≥ 240 Hz.">
          <Sel value={String(Math.round(1 / world.timestep))} width={92}
            options={['120', '240', '480', '960'].map(v => ({ value: v, label: `${v} Hz` }))}
            onChange={(v) => ps.setWorldPhysics({ timestep: 1 / Number(v) })} />
        </Field>
        <Field label="Solver iterations" hint="World-wide; robots add their own extra iterations.">
          <Num value={world.solverIterations} step={1} min={1} max={64} onCommit={(v) => ps.setWorldPhysics({ solverIterations: v ?? 8 })} />
        </Field>
        <Field label="Terrain">
          <Sel value={world.terrain.type} options={TERRAIN_TYPES} onChange={(v) => ps.setWorldPhysics({ terrain: { type: v } })} />
        </Field>
        <Field label="Ground material">
          <Sel value={world.terrain.material} options={Object.keys(MATERIALS)} onChange={(v) => ps.setWorldPhysics({ terrain: { material: v } })} />
        </Field>
        {simActive && <div className="text-[10px]" style={S.muted}>World changes apply on the next simulation start.</div>}
      </Section>

      <Section title="Debug overlay">
        {Object.entries(ps.debugLayers).map(([k, v]) => (
          <Field key={k} label={k}>
            <Check checked={v} onChange={(c) => { ps.setDebugLayers({ [k]: c }); driveManager.articulated?.setDebugLayers({ [k]: c }) }} />
          </Field>
        ))}
      </Section>

      {!sel && <div className="px-3 pt-3 text-[11px]" style={S.muted}>Select a part to edit its body, actuator and robot physics.</div>}
      {sel && <BodySection obj={sel} edit={editSel} />}
      {sel?.type === 'servo' && <ServoSections obj={sel} edit={editSel} />}
      {root && <RobotSections obj={root} edit={editRoot} />}
      {simActive && <TelemetrySection t={telemetry} />}
    </div>
  )
}

function BodySection({ obj, edit }) {
  const p = resolveObjectPhysics(obj)
  const autoMass = useMemo(() => { try { return getMassForObject(obj) } catch { return null } }, [obj])
  return (
    <Section title={`Body · ${obj.name ?? obj.type}`}>
      <Field label="Material" hint="Friction & restitution in contact; density for auto mass">
        <Sel value={p.material ?? ''} options={[{ value: '', label: 'auto' }, ...Object.keys(MATERIALS)]} onChange={(v) => edit(['material'], v || null, 'Physics: material')} />
      </Field>
      <Field label="Mass (kg)" hint="Blank = volume × density">
        <Num value={p.mass} step={0.001} min={0.0001} placeholder={autoMass != null ? autoMass.toFixed(3) : 'auto'} onCommit={(v) => edit(['mass'], v, 'Physics: mass')} />
      </Field>
      {!ELECTRONICS.has(obj.type) && (
        <Field label="Collision shape" hint="Simplified shapes are faster and more stable than mesh">
          <Sel value={p.collider} options={COLLIDER_SHAPES} onChange={(v) => edit(['collider'], v === 'auto' ? null : v, 'Physics: collider')} />
        </Field>
      )}
    </Section>
  )
}

function ServoSections({ obj, edit }) {
  const sc = resolveServoConfig(obj), jc = resolveJointConfig(obj)
  const preset = SERVO_PRESETS[sc.preset] ?? {}
  const v = (k) => sc[k] ?? preset[k]
  return (<>
    <Section title="Actuator">
      <Field label="Servo model">
        <Sel value={sc.preset} width={150} options={Object.entries(SERVO_PRESETS).map(([k, p]) => ({ value: k, label: p.label }))} onChange={(x) => edit(['servo', 'preset'], x, 'Physics: servo model')} />
      </Field>
      <Field label="Stall torque (N·m)"><Num value={v('maxTorque')} step={0.01} min={0.001} onCommit={(x) => edit(['servo', 'maxTorque'], x, 'Physics: servo torque')} /></Field>
      <Field label="No-load speed (rad/s)"><Num value={v('maxVelocity')} step={0.1} min={0.1} onCommit={(x) => edit(['servo', 'maxVelocity'], x, 'Physics: servo speed')} /></Field>
      <Field label="Max accel (rad/s²)"><Num value={v('maxAcceleration') ?? 400} step={10} min={1} onCommit={(x) => edit(['servo', 'maxAcceleration'], x, 'Physics: servo acceleration')} /></Field>
      <Field label="Deadband (°)"><Num value={+((v('deadband') ?? 0.00785) * DEG).toFixed(3)} step={0.05} min={0} onCommit={(x) => edit(['servo', 'deadband'], x == null ? null : x / DEG, 'Physics: deadband')} /></Field>
      <Field label="Backlash (°)"><Num value={+((v('backlash') ?? 0) * DEG).toFixed(3)} step={0.1} min={0} onCommit={(x) => edit(['servo', 'backlash'], x == null ? null : x / DEG, 'Physics: backlash')} /></Field>
      <Field label="P-band (°)" hint="Error at which the servo applies full torque"><Num value={v('proportionalBand') ?? 10} step={0.5} min={0.5} onCommit={(x) => edit(['servo', 'proportionalBand'], x, 'Physics: P-band')} /></Field>
      <Field label="Gear efficiency"><Num value={v('efficiency')} step={0.01} min={0.05} max={1} onCommit={(x) => edit(['servo', 'efficiency'], x, 'Physics: efficiency')} /></Field>
      <Field label="Rated voltage (V)"><Num value={v('nominalVoltage')} step={0.1} min={1} onCommit={(x) => edit(['servo', 'nominalVoltage'], x, 'Physics: servo voltage')} /></Field>
      <Field label="Stall current (A)"><Num value={v('stallCurrent')} step={0.05} min={0.01} onCommit={(x) => edit(['servo', 'stallCurrent'], x, 'Physics: stall current')} /></Field>
    </Section>
    <Section title="Joint">
      <Field label="Min angle (°)"><Num value={jc.minAngleDeg} step={1} min={-180} max={0} onCommit={(x) => edit(['joint', 'minAngleDeg'], x, 'Physics: joint limit')} /></Field>
      <Field label="Max angle (°)"><Num value={jc.maxAngleDeg} step={1} min={0} max={180} onCommit={(x) => edit(['joint', 'maxAngleDeg'], x, 'Physics: joint limit')} /></Field>
      <Field label="Damping (N·m·s/rad)"><Num value={jc.damping} step={0.0001} min={0} onCommit={(x) => edit(['joint', 'damping'], x, 'Physics: joint damping')} /></Field>
      <Field label="Friction (N·m)"><Num value={jc.friction} step={0.0005} min={0} onCommit={(x) => edit(['joint', 'friction'], x, 'Physics: joint friction')} /></Field>
    </Section>
    <Section title="Thermal">
      <Field label="Cut-out (°C)"><Num value={sc.thermal.maxTemp} step={1} min={30} onCommit={(x) => edit(['servo', 'thermal', 'maxTemp'], x, 'Physics: thermal limit')} /></Field>
      <Field label="Derating from (°C)"><Num value={sc.thermal.deratingStart} step={1} min={25} onCommit={(x) => edit(['servo', 'thermal', 'deratingStart'], x, 'Physics: derating')} /></Field>
      <Field label="Heat capacity (J/K)"><Num value={sc.thermal.heatCapacity} step={0.5} min={0.01} onCommit={(x) => edit(['servo', 'thermal', 'heatCapacity'], x, 'Physics: heat capacity')} /></Field>
      <Field label="Cooling (K/W)"><Num value={sc.thermal.thermalResistance} step={1} min={0.1} onCommit={(x) => edit(['servo', 'thermal', 'thermalResistance'], x, 'Physics: cooling')} /></Field>
    </Section>
    <Section title="Encoder">
      <Field label="Enabled"><Check checked={sc.encoder.enabled !== false} onChange={(c) => edit(['servo', 'encoder', 'enabled'], c ? null : false, 'Physics: encoder')} /></Field>
      <Field label="Resolution (counts/rev)"><Num value={sc.encoder.resolution} step={64} min={8} onCommit={(x) => edit(['servo', 'encoder', 'resolution'], x, 'Physics: encoder resolution')} /></Field>
      <Field label="Noise (rad)"><Num value={sc.encoder.noise} step={0.0005} min={0} onCommit={(x) => edit(['servo', 'encoder', 'noise'], x, 'Physics: encoder noise')} /></Field>
      <Field label="Rate (Hz)"><Num value={sc.encoder.rate} step={10} min={1} onCommit={(x) => edit(['servo', 'encoder', 'rate'], x, 'Physics: encoder rate')} /></Field>
    </Section>
  </>)
}

function RobotSections({ obj, edit }) {
  const rc = resolveRobotConfig(obj)
  const r = (path, v, label) => edit(['robot', ...path], v, label)
  return (<>
    <Section title="Robot">
      <Field label="Physics model" hint="articulated: one rigid body per link, servo torques, contacts. kinematic: the legacy animation path.">
        <Sel value={rc.model} options={['articulated', 'kinematic']} onChange={(v) => r(['model'], v === 'articulated' ? null : v, 'Physics: model')} />
      </Field>
      <Field label="Forward axis" hint="Which way the robot faces in its authored pose">
        <Sel value={rc.forward} options={Object.keys(FORWARD_AXES)} onChange={(v) => r(['forward'], v === '-z' ? null : v, 'Physics: forward axis')} />
      </Field>
    </Section>
    <Section title="Locomotion">
      <Field label="Gait"><Sel value={rc.gait.type} options={['auto', ...GAIT_TYPES]} onChange={(v) => r(['gait', 'type'], v === 'auto' ? null : v, 'Physics: gait')} /></Field>
      <Field label="Cadence (Hz)" hint="Blank = per-gait default"><Num value={rc.gait.frequency} step={0.05} min={0.05} max={4} placeholder="auto" onCommit={(v) => r(['gait', 'frequency'], v, 'Physics: gait speed')} /></Field>
      <Field label="Step height (su)"><Num value={rc.gait.stepHeight} step={0.1} min={0} onCommit={(v) => r(['gait', 'stepHeight'], v, 'Physics: step height')} /></Field>
      <Field label="Stride length (su)"><Num value={rc.gait.strideLength} step={0.1} min={0} onCommit={(v) => r(['gait', 'strideLength'], v, 'Physics: stride')} /></Field>
      <Field label="Max speed (su/s)"><Num value={rc.gait.maxSpeed} step={0.1} min={0} onCommit={(v) => r(['gait', 'maxSpeed'], v, 'Physics: max speed')} /></Field>
      <Field label="Foot trajectory"><Sel value={rc.gait.trajectory} options={TRAJECTORY_TYPES} onChange={(v) => r(['gait', 'trajectory'], v, 'Physics: trajectory')} /></Field>
      <Field label="COM sway"><Check checked={rc.gait.comSway} onChange={(c) => r(['gait', 'comSway'], c, 'Physics: COM sway')} /></Field>
    </Section>
    <Section title="Balance">
      <Field label="Enabled"><Check checked={rc.balance.enabled} onChange={(c) => r(['balance', 'enabled'], c, 'Physics: balance')} /></Field>
      <Field label="Attitude gain"><Num value={rc.balance.kpAttitude} step={0.05} min={0} onCommit={(v) => r(['balance', 'kpAttitude'], v, 'Physics: balance gain')} /></Field>
      <Field label="Rate damping (s)"><Num value={rc.balance.kdAttitude} step={0.01} min={0} onCommit={(v) => r(['balance', 'kdAttitude'], v, 'Physics: balance damping')} /></Field>
      <Field label="COM shift gain"><Num value={rc.balance.kCom} step={0.05} min={0} onCommit={(v) => r(['balance', 'kCom'], v, 'Physics: COM gain')} /></Field>
    </Section>
    <Section title="Power">
      <Field label="Chemistry"><Sel value={rc.power.chemistry} options={['nimh', 'lipo', 'liion', 'alkaline']} onChange={(v) => r(['power', 'chemistry'], v, 'Physics: battery')} /></Field>
      <Field label="Cells"><Num value={rc.power.cells} step={1} min={1} max={12} onCommit={(v) => r(['power', 'cells'], v, 'Physics: battery cells')} /></Field>
      <Field label="Capacity (mAh)"><Num value={rc.power.capacity_mAh} step={100} min={1} onCommit={(v) => r(['power', 'capacity_mAh'], v, 'Physics: battery capacity')} /></Field>
      <Field label="Internal R (Ω)"><Num value={rc.power.internalResistance} step={0.01} min={0} onCommit={(v) => r(['power', 'internalResistance'], v, 'Physics: battery resistance')} /></Field>
      <Field label="Current limit (A)"><Num value={rc.power.maxCurrent} step={0.5} min={0.1} onCommit={(v) => r(['power', 'maxCurrent'], v, 'Physics: current limit')} /></Field>
      <Field label="Brownout (V)"><Num value={rc.power.brownoutVoltage} step={0.1} min={0} onCommit={(v) => r(['power', 'brownoutVoltage'], v, 'Physics: brownout')} /></Field>
    </Section>
    <Section title="IMU">
      <Field label="Rate (Hz)"><Num value={rc.imu.rate} step={10} min={1} onCommit={(v) => r(['imu', 'rate'], v, 'Physics: IMU rate')} /></Field>
      <Field label="Accel noise (m/s²)"><Num value={rc.imu.accelNoise} step={0.01} min={0} onCommit={(v) => r(['imu', 'accelNoise'], v, 'Physics: IMU noise')} /></Field>
      <Field label="Gyro noise (rad/s)"><Num value={rc.imu.gyroNoise} step={0.001} min={0} onCommit={(v) => r(['imu', 'gyroNoise'], v, 'Physics: IMU noise')} /></Field>
      <Field label="Gyro drift (rad/s/√s)"><Num value={rc.imu.gyroDrift} step={0.0001} min={0} onCommit={(v) => r(['imu', 'gyroDrift'], v, 'Physics: IMU drift')} /></Field>
    </Section>
  </>)
}

const STATE_COLOR = { stable: '#22c55e', marginal: '#f59e0b', unstable: '#ef4444' }
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—')

function TelemetrySection({ t }) {
  if (!t) return (
    <Section title="Telemetry"><div style={S.muted}>Kinematic model or no actuated joints — telemetry is available when the robot runs on articulated physics.</div></Section>
  )
  const st = t.stability
  return (<>
    <Section title="Telemetry" right={<span className="text-[10px] font-semibold" style={{ color: STATE_COLOR[st.state] }}>{st.state}{st.bodyContact ? ' · body on ground' : ''}</span>}>
      <Field label="Mode"><span>{t.mode}</span></Field>
      <Field label="Stability margin"><span>{f(st.margin_m * 100, 1)} cm · {st.groundedFeet} feet</span></Field>
      <Field label="Roll / pitch (IMU est.)"><span>{f(t.imu?.roll * DEG, 1)}° / {f(t.imu?.pitch * DEG, 1)}°</span></Field>
      <Field label="Roll / pitch (truth)"><span>{f(t.imu?.trueRoll * DEG, 1)}° / {f(t.imu?.truePitch * DEG, 1)}°</span></Field>
      <Field label="Mass"><span>{f(st.mass, 3)} kg</span></Field>
      <Field label="Battery"><span>{f(t.battery.voltage)} V · {f(t.battery.current)} A · {f(t.battery.soc * 100, 0)}%{t.battery.brownout ? ' · BROWNOUT' : t.battery.currentLimited ? ' · limited' : ''}</span></Field>
      <Field label="Energy used"><span>{f(t.battery.energyUsed_J, 1)} J</span></Field>
      <Field label="Joint / foot error"><span>{f(t.validation.maxJointError * DEG, 1)}° / {f(t.validation.maxFootError_m * 100, 1)} cm</span></Field>
      <Field label="Physics"><span>{Math.round(1 / t.runtime.timestep)} Hz · {f(t.runtime.stepMsAvg, 2)} ms/step · {t.runtime.stepsLastFrame}/frame</span></Field>
      {t.warnings?.length > 0 && <div className="text-[10px]" style={{ color: '#f59e0b' }}>{t.warnings.join(' · ')}</div>}
    </Section>
    <Section title="Servos">
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 gap-y-0.5 text-[10px]">
        <span style={S.muted}>servo</span><span style={S.muted}>angle</span><span style={S.muted}>τ / max</span><span style={S.muted}>A</span><span style={S.muted}>°C</span>
        {t.actuators.map(a => (
          <Fragmentish key={a.id} a={a} />
        ))}
      </div>
    </Section>
    <Section title="Feet">
      {t.feet.map(ft => (
        <Field key={ft.id} label={ft.id.replace(/^rotor_/, '')}>
          <span style={{ color: ft.contact ? (ft.slipping ? '#ef4444' : '#22c55e') : 'rgb(var(--g-500))' }}>
            {ft.contact ? `${f(ft.normalForce, 1)} N${ft.slipping ? ' slip' : ''}` : 'air'}
          </span>
        </Field>
      ))}
    </Section>
  </>)
}

function Fragmentish({ a }) {
  const warn = a.stalled || a.overheated
  const c = warn ? '#ef4444' : undefined
  return (<>
    <span className="truncate" style={{ color: c }}>{(a.componentId ?? a.id).slice(0, 8)}{a.stalled ? ' stall' : a.overheated ? ' hot' : ''}</span>
    <span>{f(a.angle * DEG, 0)}°→{f(a.target * DEG, 0)}°</span>
    <span>{f(Math.abs(a.torque), 2)}/{f(a.torqueLimit, 2)}</span>
    <span>{f(a.current, 2)}</span>
    <span>{f(a.temperature, 0)}</span>
  </>)
}

