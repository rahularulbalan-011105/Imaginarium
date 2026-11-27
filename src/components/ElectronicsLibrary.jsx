import { useState } from 'react'
import { ensureModels, isModelLoaded, hasModel, loadModel, modelKeyOf } from '../utils/modelLoader.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { variantOverrides } from '../utils/componentVariants.js'

// ─────────────────────────────────────────────────────────────────────────────
// ElectronicsLibrary — the dedicated "Electronics" section of the right
// workspace. This is where electronics parts are CREATED (previously duplicated
// in the floating toolbox + Library). PRESENTATION ONLY: each part calls the
// same existing store action (sceneStore.addObject) the old UI used. Carries the
// `elec-*` tutorial anchors the guided coach spotlights.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    key: 'mcu', label: 'MCUs', color: '#3b82f6', icon: '🧠', blurb: 'Controllers that run your code.',
    items: [
      { type: 'arduino', label: 'Arduino', icon: '🟢', desc: 'Microcontroller board', purpose: 'The programmable “brain”. Runs your code and controls everything wired to it.', usage: 'robot brains · automation · reading sensors' },
      { type: 'subo',    label: 'SUBO',    icon: '🟣', desc: 'ESP32 board (AtumX)', purpose: 'AtumX SUBO — an ESP32 board with an on-board 48-LED matrix, buzzer, 2 buttons and IO1–IO21 header pins. Programmed with the official Subo library.', usage: 'robotics · 48-LED matrix · buzzer · buttons · motor expansion' },
      { type: 'esp32',   label: 'ESP32',   icon: '🔵', desc: 'ESP32 DevKit V1', purpose: 'ESP32-WROOM-32 on the 30-pin DevKit V1 header. 3.3 V logic, 12-bit analog inputs, LEDC PWM on any output pin, plus simulated Wi-Fi and BLE. Programmed with the Arduino-ESP32 API.', usage: 'Wi-Fi · Bluetooth · sensors · motors · more GPIO than an Uno' },
    ],
  },
  {
    key: 'sensors', label: 'Sensors', color: '#14b8a6', icon: '📡', blurb: 'Measure the world and report back.',
    items: [
      { type: 'ultrasonic',   label: 'Ultrasonic',   icon: '📡', desc: 'HC-SR04 distance', purpose: 'Measures distance.', usage: 'obstacle avoidance · range finding' },
      { type: 'ir_sensor',    label: 'IR Sensor',    icon: '👁', desc: 'Obstacle detect',  purpose: 'Detects nearby obstacles.', usage: 'line following · edge/obstacle detection' },
      { type: 'gas_sensor',   label: 'Gas Sensor',   icon: '💨', desc: 'MQ combustible',    purpose: 'Detects combustible gases.', usage: 'gas-leak alarms · air quality' },
      { type: 'color_sensor', label: 'Color Sensor', icon: '🎨', desc: 'TCS3200 RGB',       purpose: 'Detects the dominant reflected colour.', usage: 'colour sorting · line following' },
      { type: 'ldr_sensor',   label: 'LDR Sensor',   icon: '🔆', desc: 'Light level',       purpose: 'Measures ambient light intensity.', usage: 'auto night-lights · light following' },
      { type: 'dht11',        label: 'DHT11',        icon: '🌡', desc: 'Temp + humidity',   purpose: 'Measures temperature and humidity.', usage: 'weather stations · climate logging' },
      { type: 'pir_sensor',    label: 'PIR Sensor',     icon: '🚶', desc: 'HC-SR501 motion',     purpose: 'Detects people and animals moving in front of its dome (up to ~7 m, 110°). OUT goes HIGH when it sees motion and stays HIGH for a few seconds. Wire VCC → 5V, GND → GND, OUT → a digital pin.', usage: 'burglar alarms · auto lights · people counters' },
      { type: 'flame_sensor',  label: 'Flame Sensor',   icon: '🔥', desc: 'IR flame · LM393',    purpose: 'Sees the infrared light of a flame. DO goes LOW when a flame is detected; AO gives the strength (lower = stronger flame).', usage: 'fire alarms · fire-fighting robots' },
      { type: 'soil_moisture', label: 'Soil Moisture',  icon: '🌱', desc: 'YL-69 probe + YL-38', purpose: 'Push the fork into soil to measure how wet it is. AO ≈ 1023 when dry and drops as the soil gets wetter; DO goes LOW when wetter than the trim-pot threshold.', usage: 'plant watering · garden monitors' },
      { type: 'rain_sensor',   label: 'Rain Sensor',    icon: '🌧', desc: 'FC-37 rain plate',    purpose: 'Water drops on the plate bridge its comb. AO falls as it gets wetter; DO goes LOW when rain is detected.', usage: 'weather stations · auto wipers · window closers' },
      { type: 'sound_sensor',  label: 'Sound Sensor',   icon: '🎤', desc: 'KY-038 microphone',   purpose: 'An electret microphone with an amplifier. AO is the sound wave (≈512 when quiet, swings with loudness); DO goes HIGH on a loud sound like a clap.', usage: 'clap switches · noise meters' },
      { type: 'touch_sensor',  label: 'Touch Sensor',   icon: '👆', desc: 'TTP223 capacitive',   purpose: 'A capacitive touch pad: OUT goes HIGH while a finger touches it, LOW otherwise. No moving parts.', usage: 'touch buttons · lamps · menus' },
      { type: 'bmp280',        label: 'Pressure Sensor', icon: '🎈', desc: 'BMP280 · I²C',       purpose: 'Measures air pressure and temperature; altitude is worked out from the pressure. Wire SDA/SCL to the board’s I²C pins. Address 0x76 (SDO → VCC for 0x77). Use the Adafruit_BMP280 library.', usage: 'altimeters · weather stations · drones' },
      { type: 'accelerometer', label: 'Accelerometer',  icon: '📐', desc: 'MPU6050 · I²C',       purpose: 'Measures acceleration on X, Y and Z (gravity included), so it knows how it is tilted. A GY-521 board at 0x68 on I²C. Use the MPU6050_light library: getAccX/Y/Z() and getAngleX/Y().', usage: 'tilt sensing · self-balancing robots · step counters' },
      { type: 'gyroscope',     label: 'Gyroscope',      icon: '🌀', desc: 'MPU6050 · I²C',       purpose: 'Measures how fast it is rotating around X, Y and Z in °/s. The same GY-521 board as the accelerometer, read with getGyroX/Y/Z() from the MPU6050_light library.', usage: 'turn measurement · balancing · drone stabilising' },
      { type: 'hall_sensor',   label: 'Hall Sensor',    icon: '🧲', desc: 'A3144 magnetic',      purpose: 'Detects a magnet’s south pole near the sensor face. OUT goes LOW when a magnet is close, HIGH otherwise.', usage: 'wheel-speed counting · door switches · limit switches' },
    ],
  },
  {
    key: 'displays', label: 'Displays', color: '#8b5cf6', icon: '📺', blurb: 'Show text and graphics.',
    items: [
      { type: 'oled', label: 'OLED', icon: '📺', desc: 'I²C 128×64', purpose: 'Displays text and graphics.', usage: 'readouts · menus · debugging' },
    ],
  },
  {
    key: 'actuators', label: 'Actuators', color: '#22c55e', icon: '⚙', blurb: 'Create movement, light or sound.',
    items: [
      { type: 'servo',    label: 'Servo Motor', icon: '🔩', desc: 'Angle control actuator', purpose: 'Rotates to a specified angle (0–180°).', usage: 'robot arms · steering · camera gimbals' },
      // Variant: a `servo` with the SG90's size, mass and torque (utils/componentVariants.js).
      { type: 'servo', variant: 'sg90', label: 'SG90 Micro Servo', icon: '🔩', desc: 'Small · 9 g · 1.8 kg·cm', purpose: 'The classic blue micro servo. Light and cheap but weak — fine for small arms and grippers, too weak for walking-robot legs.', usage: 'pan/tilt · small grippers · flaps' },
      { type: 'servo', variant: 'mg996r', label: 'MG996R Servo', icon: '🔩', desc: 'Metal gear · 55 g · 11 kg·cm', purpose: 'A standard-size metal-gear servo, about 6× stronger than an SG90. The usual choice for robot-arm joints and small walking-robot legs.', usage: 'robot arms · quadruped legs · steering' },
      { type: 'servo', variant: 'ds3218', label: 'DS3218 Servo', icon: '🔩', desc: 'High torque · 60 g · 21 kg·cm', purpose: 'A high-torque digital servo, about twice as strong as an MG996R. For heavy legs and arm shoulders that carry the most load.', usage: 'heavy legs · arm shoulders · lifting' },
      { type: 'motor_dc', label: 'DC Motor',    icon: '🔧', desc: 'Continuous rotation',     purpose: 'Spins continuously at a set speed.', usage: 'wheels · fans · propellers' },
      { type: 'motor_bo', label: 'BO Motor',    icon: '⚙',  desc: 'Geared drive motor',      purpose: 'A geared DC motor — high torque at low speed.', usage: 'driving robot wheels' },
      // Gear motors — variants of the BO / encoder motor (utils/componentVariants.js).
      { type: 'motor_bo', variant: 'n20', label: 'N20 Gear Motor', icon: '⚙', desc: 'Compact · Low speed · High torque', purpose: 'A tiny 12 mm metal-gearbox motor with a 3 mm D-shaft. Slow and strong for its size. Drive it like any DC motor: + and − to a motor driver (or a pin for testing).', usage: 'mini robots · small wheels · locks · pointers' },
      { type: 'motor_bo', variant: 'tt', label: 'TT Gear Motor', icon: '⚙', desc: 'Plastic gearbox · 3–6V · Robot drive', purpose: 'The yellow TT motor (1:48 plastic gearbox, 3–6 V) found in most robot-car kits, at its real 70 mm size. Shafts on both sides take the standard 65 mm wheels.', usage: '2WD / 4WD robot cars · line followers' },
      { type: 'motor_bo', variant: 'metal_gear', label: 'Metal Gear Motor', icon: '⚙', desc: 'Metal gearbox · High torque · Durable', purpose: 'A JGA25-370 motor: Ø25 mm steel gearbox and a 4 mm D-shaft. Much tougher than plastic gearboxes, for heavier robots. Mounts with two M3 screws on its front face.', usage: 'heavier robots · arms · conveyors' },
      { type: 'motor_enc', variant: 'n20_enc', label: 'N20 Encoder Gear Motor', icon: '🎯', desc: 'Hall encoder · Speed feedback', purpose: 'An N20 micro gear motor with a magnetic Hall encoder on its back. The 6-pin connector carries the motor (M1, M2), the encoder supply (VCC, GND) and its A/B outputs; count A/B with attachInterrupt() or the Encoder library to measure speed.', usage: 'small robots with speed control · PID' },
      { type: 'motor_enc', variant: 'tt_enc', label: 'TT Encoder Gear Motor', icon: '🎯', desc: 'Encoder · Wheel control', purpose: 'The TT gear motor with a Hall encoder board on its rear shaft, at its real size. A and B pulse 11 times per motor turn (528 per wheel turn on the 1:48 gearbox).', usage: 'exact distances · matching wheel speeds' },
      { type: 'motor_enc', variant: 'metal_gear_enc', label: 'Metal Gear Encoder Motor', icon: '🎯', desc: 'Quadrature encoder · Position feedback', purpose: 'A JGA25-370 metal gear motor with a quadrature Hall encoder (11 pulses per motor turn) on the back. Its connector order is M1 GND C1 C2 VCC M2 — C1/C2 are the A/B outputs.', usage: 'position control · odometry · robot arms' },
      { type: 'motor_enc', label: 'Encoder Motor', icon: '🎯', desc: 'TT gear motor + Hall encoder', purpose: 'A yellow TT gear motor with a magnetic encoder on its back. Besides turning, it reports how far and how fast it really turned: two outputs, A and B, pulse 11 times per motor turn (528 per wheel turn on the 1:48 gearbox). Count them with attachInterrupt() or the Encoder library.', usage: 'exact distances · matching wheel speeds · PID speed control' },
      // Its own type (not a servo variant): wired + coded like a servo, but it is a
      // drive MOTOR — write() sets speed (utils/continuousServo.js).
      { type: 'servo_cr', variant: 'fs90r', label: 'FS90R 360° Servo', icon: '🔄', desc: 'Continuous rotation · 110 RPM', purpose: 'Looks and wires like a micro servo, but spins all the way round. write(90) stops it; towards 180 it spins faster one way, towards 0 the other way. Put a wheel on its horn and it drives a robot — no motor driver needed.', usage: 'small wheeled robots · turntables · winches' },
      { type: 'gripper', label: 'Servo Gripper', icon: '🦾', desc: 'Claw · picks up parts', purpose: 'A parallel claw driven by one micro servo. write(0) opens it fully, write(180) closes it. It closes until the pads touch a part, and holds the part if the squeeze is strong enough for its weight. Mark the part as a Loose object first; mount the claw on an arm servo to lift things.', usage: 'robot arms · pick-and-place · sorting' },
      { type: 'stepper',  label: 'Stepper 28BYJ-48', icon: '🌀', desc: 'Exact steps · 2048 / turn', purpose: 'A geared stepper motor: it turns in exact steps instead of spinning freely, so code can move it to a precise angle and back. Needs a ULN2003 driver (Motor Drivers). Slow — about 15 RPM at most — but strong and accurate.', usage: 'turntables · pointers · camera sliders · clocks' },
      { type: 'led',      label: 'LED',         icon: '💡', desc: 'Light output',            purpose: 'A light you can switch on/off or dim from code.', usage: 'status indicators · signals' },
      { type: 'buzzer',   label: 'Buzzer',      icon: '🔔', desc: 'Tone output',            purpose: 'Plays tones and beeps from code.', usage: 'alarms · feedback · melodies' },
    ],
  },
  {
    key: 'drivers', label: 'Motor Drivers', color: '#f59e0b', icon: '🎛', blurb: 'Sit between the board and the motors.',
    items: [
      { type: 'l298n', label: 'L298N Driver', icon: '🎛', desc: 'Dual H-bridge · 2 motors', purpose: 'Lets the board drive two DC motors forwards and backwards with speed control. IN1/IN2 set motor A’s direction, ENA its speed (IN3/IN4 + ENB for motor B). Its GND must connect to the board’s GND. Motor power on 12V is assumed — battery parts are coming soon. Loses ≈2 V, so motors run ≈73 % as fast as wired straight to the battery.', usage: 'wheeled robots · reversing motors · speed control' },
      { type: 'pca9685', label: 'PCA9685 Servo Driver', icon: '🎚', desc: '16 servos over I2C', purpose: 'Runs up to 16 servos from just two board pins (SDA and SCL). The board tells the chip each channel’s pulse width over I2C and the chip keeps making the pulses, so the board is free for other work. Several boards can share the bus at different addresses.', usage: 'hexapods & quadrupeds · robot arms · animatronics' },
      { type: 'uln2003', label: 'ULN2003 Driver', icon: '🟩', desc: 'Stepper driver · 4 coils', purpose: 'Drives a 28BYJ-48 stepper: IN1–IN4 from the board switch the four coils, and the LEDs A–D show which coils are on. Plug the stepper into its socket, then wire VCC → 5V and GND → GND. Program it with the Stepper library.', usage: 'stepper motors · precise rotation' },
    ],
  },
  {
    key: 'weapons', label: 'Weapons', color: '#ef4444', icon: '⚔', blurb: 'Attach to a robot, then fight in the Physics Arena.',
    items: [
      { type: 'weapon_autocannon', label: 'Auto Cannon',  icon: '🔫', desc: 'Sustained DPS',  purpose: 'Continuous fire, armor break, crit on exposed core.', usage: 'main gun · sustained damage' },
      { type: 'weapon_shotgun',    label: 'Shotgun',       icon: '💥', desc: 'Burst + knockback', purpose: 'Pellet spread, short range, heavy knockback.', usage: 'close-range brawling' },
      { type: 'weapon_rocket',     label: 'Rocket Pod',    icon: '🚀', desc: 'Splash damage',   purpose: 'Explosive rockets with area damage + knockback.', usage: 'area denial · groups' },
      { type: 'weapon_flame',      label: 'Flamethrower',  icon: '🔥', desc: 'Burn / area',     purpose: 'Close cone that sets targets burning.', usage: 'area denial · zoning' },
    ],
  },
]

const SOON = [
  { key: 'power', label: 'Power',         icon: '🔋', note: 'Batteries · supplies · regulators — coming soon.' },
  { key: 'comms', label: 'Communication', icon: '📶', note: 'WiFi · Bluetooth · RF — coming soon.' },
]

export default function ElectronicsLibrary() {
  const addObject = useSceneStore((s) => s.addObject)
  const { snapshot } = useHistory()
  const [openCats, setOpenCats] = useState({ mcu: true, sensors: true, displays: true, actuators: true, drivers: true, weapons: true })
  const toggleCat = (key) => setOpenCats((o) => ({ ...o, [key]: !o[key] }))
  // Models load on demand: fetch this part's GLB (usually already prefetched on
  // hover/idle) before creating it, so its pins anchor to the real board.
  const [loadingType, setLoadingType] = useState(null)
  const addPart = async (type, variant) => {
    const key = variant ?? type
    const mk = modelKeyOf(type)          // e.g. a continuous servo is drawn with servo.glb
    if (!isModelLoaded(mk) && hasModel(mk)) {
      setLoadingType(key)
      await ensureModels([mk])
      setLoadingType(null)
    }
    const overrides = variant ? variantOverrides(variant, useSceneStore.getState().objects) : undefined
    addObject(type, undefined, overrides); snapshot()
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2">
      <div className="text-[9px] text-orange-500 uppercase tracking-wider mb-1.5 font-semibold px-1">Electronics</div>
      <div className="space-y-1">
        {CATEGORIES.map((cat) => {
          const open = !!openCats[cat.key]
          return (
            // Each category carries its own colour (--cat) so the groups are told
            // apart at a glance: edge bar, tinted header, count and item hover.
            <div key={cat.key} className="elec-cat rounded-lg border border-gray-700/40 overflow-hidden bg-gray-800/40" style={{ '--cat': cat.color }}>
              <button
                onClick={() => toggleCat(cat.key)}
                aria-expanded={open}
                className="elec-cat-head w-full flex items-center gap-2 px-2.5 py-2 transition-colors"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.color }} aria-hidden="true" />
                <span className="text-[12px] font-semibold" style={{ color: 'rgb(var(--g-200))' }}>{cat.label}</span>
                <span className="text-[10px] font-semibold" style={{ color: cat.color }}>{cat.items.length}</span>
                <span className="ml-auto text-[10px]" style={{ color: 'rgb(var(--g-500))' }}>{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="px-1.5 pb-1.5">
                  {cat.blurb && <div className="text-[9px] mb-1 px-1" style={{ color: 'rgb(var(--g-500))' }}>{cat.blurb}</div>}
                  <div className="flex flex-col gap-1">
                    {cat.items.map(({ type, variant, label, desc, purpose, usage }) => {
                      const key = variant ?? type
                      return (
                      <button
                        key={key}
                        data-tour={`elec-${key}`}
                        onClick={() => addPart(type, variant)}
                        onPointerEnter={() => { const mk = modelKeyOf(type); if (hasModel(mk)) loadModel(mk) }}
                        disabled={loadingType === key}
                        title={`${label}\n${purpose}\nCommonly used for: ${usage}`}
                        className="elec-item group flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg bg-gray-800/70 border border-transparent transition-all duration-150 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-medium leading-tight truncate" style={{ color: 'rgb(var(--g-200))' }}>{label}</span>
                          <span className="block text-[10px] leading-tight truncate" style={{ color: 'rgb(var(--g-400))' }}>{desc}</span>
                        </span>
                        <span className={`text-[14px] ${loadingType === key ? 'opacity-100 animate-pulse' : 'opacity-0 group-hover:opacity-100'} transition-opacity shrink-0`} style={{ color: cat.color }}>{loadingType === key ? '…' : '＋'}</span>
                      </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {SOON.map((cat) => {
          const open = !!openCats[cat.key]
          return (
            <div key={cat.key} className="rounded-lg border border-gray-800/60 overflow-hidden bg-gray-900/40">
              <button
                onClick={() => toggleCat(cat.key)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-800/40 transition-colors"
                title={cat.note}
              >
                <span className="text-[11px] font-medium text-gray-500">{cat.label}</span>
                <span className="text-[9px] text-gray-600">(0)</span>
                <span className="ml-auto text-[8px] uppercase tracking-wider text-gray-600">soon</span>
              </button>
              {open && <div className="px-2.5 pb-2 text-[9px] text-gray-600 leading-snug">{cat.note}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
