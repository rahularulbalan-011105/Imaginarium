import { useState } from 'react'
import { ensureModels, isModelLoaded, hasModel, loadModel, modelKeyOf } from '../utils/modelLoader.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { usePlacement, placeCardProps } from '../managers/placement.js'
import { variantOverrides } from '../utils/componentVariants.js'
import Icon from './ui/Icon.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// ElectronicsLibrary — the dedicated "Electronics" section of the right
// workspace. This is where electronics parts are CREATED (previously duplicated
// in the floating toolbox + Library). PRESENTATION ONLY: each part calls the
// same existing store action (sceneStore.addObject) the old UI used. Carries the
// `elec-*` tutorial anchors the guided coach spotlights.
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  {
    key: 'mcu', label: 'Boards', color: '#3b82f6', icon: '🧠', blurb: 'The brain that runs your code.',
    items: [
      { type: 'arduino', label: 'Arduino', icon: '🟢', desc: 'Microcontroller board', purpose: 'The programmable “brain”. Runs your code and controls everything wired to it.', usage: 'robot brains · automation · reading sensors' },
      { type: 'subo',    label: 'SUBO',    icon: '🟣', desc: 'ESP32 board (AtumX)', purpose: 'AtumX SUBO — an ESP32 board with an on-board 48-LED matrix, buzzer, 2 buttons and IO1–IO21 header pins. Programmed with the official Subo library.', usage: 'robotics · 48-LED matrix · buzzer · buttons · motor expansion' },
      { type: 'esp32',   label: 'ESP32',   icon: '🔵', desc: 'ESP32 DevKit V1', purpose: 'ESP32-WROOM-32 on the 30-pin DevKit V1 header. 3.3 V logic, 12-bit analog inputs, LEDC PWM on any output pin, plus simulated Wi-Fi and BLE. Programmed with the Arduino-ESP32 API.', usage: 'Wi-Fi · Bluetooth · sensors · motors · more GPIO than an Uno' },
    ],
  },
  {
    key: 'sensors', label: 'Sensors', color: '#14b8a6', icon: '📡', blurb: 'Measure the world and report back.',
    items: [
      { type: 'ultrasonic',   label: 'Distance sensor', icon: '📡', desc: 'HC-SR04 ultrasonic', purpose: 'Measures distance.', usage: 'obstacle avoidance · range finding' },
      { type: 'ir_sensor',    label: 'IR sensor',    icon: '👁', desc: 'Obstacle / line detect',  purpose: 'Detects nearby obstacles.', usage: 'line following · edge/obstacle detection' },
      { type: 'gas_sensor',   label: 'Gas sensor',   icon: '💨', desc: 'MQ combustible',    purpose: 'Detects combustible gases.', usage: 'gas-leak alarms · air quality' },
      { type: 'color_sensor', label: 'Colour sensor', icon: '🎨', desc: 'TCS3200 RGB',       purpose: 'Detects the dominant reflected colour.', usage: 'colour sorting · line following' },
      { type: 'ldr_sensor',   label: 'Light sensor', icon: '🔆', desc: 'LDR light level',       purpose: 'Measures ambient light intensity.', usage: 'auto night-lights · light following' },
      { type: 'dht11',        label: 'Temp & humidity', icon: '🌡', desc: 'DHT11',   purpose: 'Measures temperature and humidity.', usage: 'weather stations · climate logging' },
    ],
  },
  {
    key: 'displays', label: 'Displays', color: '#8b5cf6', icon: '📺', blurb: 'Show text and graphics.',
    items: [
      { type: 'oled', label: 'OLED screen', icon: '📺', desc: 'I²C 128×64', purpose: 'Displays text and graphics.', usage: 'readouts · menus · debugging' },
      { type: 'tft28', label: 'Touch screen', icon: '🖥', desc: 'SPI 240×320 · capacitive touch', purpose: 'Waveshare 2.8inch colour TFT with a capacitive touch panel. The screen (ST7789) talks SPI: MOSI, SCLK, LCD_CS, LCD_DC, LCD_RST, plus LCD_BL for backlight brightness. The touch chip (CST328) talks I2C on TP_SDA / TP_SCL, with TP_INT and TP_RST. Runs on 3.3 V or 5 V. MISO is not connected on this module.', usage: 'touch menus · dashboards · images' },
    ],
  },
  {
    key: 'actuators', label: 'Motors & outputs', color: '#22c55e', icon: '⚙', blurb: 'Create movement, light or sound.',
    items: [
      { type: 'servo',    label: 'Servo', icon: '🔩', desc: 'Angle control actuator', purpose: 'Rotates to a specified angle (0–180°).', usage: 'robot arms · steering · camera gimbals' },
      // Variant: a `servo` with the SG90's size, mass and torque (utils/componentVariants.js).
      { type: 'servo', variant: 'sg90', label: 'Micro servo', icon: '🔩', desc: 'Small · 9 g · 1.8 kg·cm', purpose: 'The classic blue micro servo. Light and cheap but weak — fine for small arms and grippers, too weak for walking-robot legs.', usage: 'pan/tilt · small grippers · flaps' },
      { type: 'servo', variant: 'mg996r', label: 'Strong servo', icon: '🔩', desc: 'Metal gear · 55 g · 11 kg·cm', purpose: 'A standard-size metal-gear servo, about 6× stronger than an SG90. The usual choice for robot-arm joints and small walking-robot legs.', usage: 'robot arms · quadruped legs · steering' },
      { type: 'servo', variant: 'ds3218', label: 'Extra-strong servo', icon: '🔩', desc: 'High torque · 60 g · 21 kg·cm', purpose: 'A high-torque digital servo, about twice as strong as an MG996R. For heavy legs and arm shoulders that carry the most load.', usage: 'heavy legs · arm shoulders · lifting' },
      { type: 'motor_dc', label: 'DC motor',    icon: '🔧', desc: 'Continuous rotation',     purpose: 'Spins continuously at a set speed.', usage: 'wheels · fans · propellers' },
      { type: 'motor_bo', label: 'Wheel motor', icon: '⚙',  desc: 'BO geared motor',      purpose: 'A geared DC motor — high torque at low speed.', usage: 'driving robot wheels' },
      { type: 'motor_enc', label: 'Motor + encoder', icon: '🎯', desc: 'TT gear motor + Hall encoder', purpose: 'A yellow TT gear motor with a magnetic encoder on its back. Besides turning, it reports how far and how fast it really turned: two outputs, A and B, pulse 11 times per motor turn (528 per wheel turn on the 1:48 gearbox). Count them with attachInterrupt() or the Encoder library.', usage: 'exact distances · matching wheel speeds · PID speed control' },
      // Its own type (not a servo variant): wired + coded like a servo, but it is a
      // drive MOTOR — write() sets speed (utils/continuousServo.js).
      { type: 'servo_cr', variant: 'fs90r', label: '360° servo', icon: '🔄', desc: 'Continuous rotation · 110 RPM', purpose: 'Looks and wires like a micro servo, but spins all the way round. write(90) stops it; towards 180 it spins faster one way, towards 0 the other way. Put a wheel on its horn and it drives a robot — no motor driver needed.', usage: 'small wheeled robots · turntables · winches' },
      { type: 'gripper', label: 'Gripper claw', icon: '🦾', desc: 'Claw · picks up parts', purpose: 'A parallel claw driven by one micro servo. write(0) opens it fully, write(180) closes it. It closes until the pads touch a part, and holds the part if the squeeze is strong enough for its weight. Mark the part as a Loose object first; mount the claw on an arm servo to lift things.', usage: 'robot arms · pick-and-place · sorting' },
      { type: 'stepper',  label: 'Stepper motor', icon: '🌀', desc: 'Exact steps · 2048 / turn', purpose: 'A geared stepper motor: it turns in exact steps instead of spinning freely, so code can move it to a precise angle and back. Needs a ULN2003 driver (Motor Drivers). Slow — about 15 RPM at most — but strong and accurate.', usage: 'turntables · pointers · camera sliders · clocks' },
      { type: 'led',      label: 'LED',         icon: '💡', desc: 'Light output',            purpose: 'A light you can switch on/off or dim from code.', usage: 'status indicators · signals' },
      { type: 'buzzer',   label: 'Buzzer',      icon: '🔔', desc: 'Tone output',            purpose: 'Plays tones and beeps from code.', usage: 'alarms · feedback · melodies' },
    ],
  },
  {
    key: 'drivers', label: 'Motor Drivers', color: '#f59e0b', icon: '🎛', blurb: 'Sit between the board and the motors.',
    items: [
      { type: 'l298n', label: 'Motor driver', icon: '🎛', desc: 'L298N · 2 motors', purpose: 'Lets the board drive two DC motors forwards and backwards with speed control. IN1/IN2 set motor A’s direction, ENA its speed (IN3/IN4 + ENB for motor B). Its GND must connect to the board’s GND. Motor power on 12V is assumed — battery parts are coming soon. Loses ≈2 V, so motors run ≈73 % as fast as wired straight to the battery.', usage: 'wheeled robots · reversing motors · speed control' },
      { type: 'pca9685', label: 'Servo driver', icon: '🎚', desc: 'PCA9685 · 16 servos', purpose: 'Runs up to 16 servos from just two board pins (SDA and SCL). The board tells the chip each channel’s pulse width over I2C and the chip keeps making the pulses, so the board is free for other work. Several boards can share the bus at different addresses.', usage: 'hexapods & quadrupeds · robot arms · animatronics' },
      { type: 'uln2003', label: 'Stepper driver', icon: '🟩', desc: 'ULN2003 · 4 coils', purpose: 'Drives a 28BYJ-48 stepper: IN1–IN4 from the board switch the four coils, and the LEDs A–D show which coils are on. Plug the stepper into its socket, then wire VCC → 5V and GND → GND. Program it with the Stepper library.', usage: 'stepper motors · precise rotation' },
    ],
  },
  {
    key: 'weapons', label: 'Weapons', color: '#ef4444', icon: '⚔', blurb: 'Attach to a robot, then fight in the Physics Arena.',
    items: [
      { type: 'weapon_autocannon', label: 'Auto cannon',  icon: '🔫', desc: 'Sustained DPS',  purpose: 'Continuous fire, armor break, crit on exposed core.', usage: 'main gun · sustained damage' },
      { type: 'weapon_shotgun',    label: 'Shotgun',       icon: '💥', desc: 'Burst + knockback', purpose: 'Pellet spread, short range, heavy knockback.', usage: 'close-range brawling' },
      { type: 'weapon_rocket',     label: 'Rocket pod',    icon: '🚀', desc: 'Splash damage',   purpose: 'Explosive rockets with area damage + knockback.', usage: 'area denial · groups' },
      { type: 'weapon_flame',      label: 'Flamethrower',  icon: '🔥', desc: 'Burn / area',     purpose: 'Close cone that sets targets burning.', usage: 'area denial · zoning' },
    ],
  },
]

const SOON = [
  { key: 'power', label: 'Power',         note: 'Batteries, supplies and regulators are coming soon.' },
  { key: 'comms', label: 'Communication', note: 'Wi-Fi, Bluetooth and radio modules are coming soon.' },
]

const THUMB = (type) => `${import.meta.env.BASE_URL}thumbs/${type}.webp`

// A part's picture, rendered from its real 3D model (tools/thumbs). Parts with
// no picture yet get a plain lettered tile instead of a broken image.
function PartThumb({ type, label }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="ui-lib-tile">{label.replace(/[^A-Za-z0-9 ]/g, '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
  return <img src={THUMB(type)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
}

export default function ElectronicsLibrary() {
  const addObject = useSceneStore((s) => s.addObject)
  const [cat, setCat] = useState('all')
  const [query, setQuery] = useState('')
  // Click picks the part up; a click on the grid places it (managers/placement.js).
  // Models load on demand: the GLB starts loading when the part is picked up and
  // is awaited before creating it, so its pins anchor to the real board.
  const pendingKey = usePlacement((s) => s.pending?.key)
  const partCard = (type, variant, label) => {
    const mk = modelKeyOf(type)          // e.g. a continuous servo is drawn with servo.glb
    return placeCardProps({
      key: `elec:${variant ?? type}`, label,
      prepare: () => { if (hasModel(mk)) loadModel(mk) },
      create: async () => {
        if (!isModelLoaded(mk) && hasModel(mk)) await ensureModels([mk])
        const overrides = variant ? variantOverrides(variant, useSceneStore.getState().objects) : undefined
        return addObject(type, undefined, overrides)
      },
    }, pendingKey)
  }

  const q = query.trim().toLowerCase()
  const match = (it) => !q || `${it.label} ${it.desc} ${it.usage} ${it.type}`.toLowerCase().includes(q)
  const groups = CATEGORIES
    .filter((c) => cat === 'all' || c.key === cat)
    .map((c) => ({ ...c, items: c.items.filter(match) }))
    .filter((c) => c.items.length)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2 shrink-0" style={{ borderBottom: '1px solid rgb(var(--g-700))' }}>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Part category"
          className="h-8 px-2 rounded-md text-[13px] font-medium focus:outline-none"
          style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-600))' }}>
          <option value="all">All parts</option>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="flex items-center gap-2 h-8 px-2 rounded-md" style={{ background: 'rgb(var(--g-800))', border: '1px solid rgb(var(--g-700))' }}>
          <Icon name="search" size={14} style={{ color: 'rgb(var(--g-500))' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parts"
            aria-label="Search parts" className="flex-1 min-w-0 bg-transparent text-[13px] focus:outline-none" />
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && (
          <div className="px-2 py-6 text-[12px]" style={{ color: 'rgb(var(--g-500))' }}>No parts match “{query}”.</div>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <div className="ui-lib-head">{g.label}</div>
            <div className="grid grid-cols-3 gap-0.5">
              {g.items.map(({ type, variant, label, desc, purpose, usage }) => {
                const key = variant ?? type
                return (
                  <button
                    key={key}
                    data-tour={`elec-${key}`}
                    {...partCard(type, variant, label)}
                    onPointerEnter={() => { const mk = modelKeyOf(type); if (hasModel(mk)) loadModel(mk) }}
                    title={`${label} (${desc})\n${purpose}\nUsed for: ${usage}\n\nClick, then click the grid to place it, or drag it onto the grid.`}
                    className="ui-lib-card"
                  >
                    <span className="ui-lib-glyph"><PartThumb type={type} label={label} /></span>
                    <span className="ui-lib-label">{label}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        {cat === 'all' && !q && (
          <div className="mt-4 px-2 flex flex-col gap-1">
            {SOON.map((c) => (
              <div key={c.key} className="text-[12px]" style={{ color: 'rgb(var(--g-500))' }}>
                <span className="font-medium" style={{ color: 'rgb(var(--g-400))' }}>{c.label}:</span> {c.note}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
