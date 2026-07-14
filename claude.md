# Constructa (Imaginarium) — Project Documentation

> **What it is:** a browser-based 3D robotics design → simulation → combat-gaming platform.
> Started as a Tinkercad-style 3D editor; grew into a full robotics studio with electronics
> wiring, Arduino/Blockly programming, physics simulation, wheeled + legged robots, a
> Robo-Sumo game, and a physics-driven co-op **Combat Arena** with a third-person PvP layer.
> **Brand = Constructa**; internal repo/build name = **Imaginarium**.

**Stack:** React 18 · Three.js 0.168 · Zustand 5 · Tailwind 3.4 · Vite 5 · Electron shell.
**No login / no backend** — projects persist to IndexedDB; sharing is URL-hash / Google Drive.
**Status:** post-MVP full robotics platform · studio UI · light/dark theme · onboarding.
**Platform:** desktop web (responsive) + Electron; base path `/Imaginarium/`.

---

## Table of Contents
1. [Technology Stack](#technology-stack)
2. [Complete File Structure](#complete-file-structure)
3. [UI Shell & Layout](#ui-shell--layout)
4. [Design System / Theme](#design-system--theme)
5. [State Management (stores)](#state-management-stores)
6. [Managers](#managers)
7. [Utilities](#utilities)
8. [Subsystems](#subsystems) — CAD · Electronics · Arduino/Blockly · Sensors · Physics · Robots · Battle · **Combat Arena** · Onboarding · Alignment · Analytics
9. [Data Models](#data-models)
10. [Key Architecture Decisions](#key-architecture-decisions)
11. [Controls & Keyboard Shortcuts](#controls--keyboard-shortcuts)
12. [Setup, Build & Deploy](#setup-build--deploy)
13. [MCP Asset Tooling](#mcp-asset-tooling-blender--falai)
14. [Troubleshooting](#troubleshooting)

---

## Technology Stack

| Package | Purpose |
|---|---|
| **React 18** | Component UI |
| **Three.js** (0.168) | 3D rendering (`three-stdlib` for OrbitControls/TransformControls/loaders) |
| **Zustand** (5) | State stores |
| **Tailwind CSS** (3.4) | Styling (theme-token driven; `postcss.config.js`, `tailwind.config.js`) |
| **three-bvh-csg** / **three-mesh-bvh** | Boolean CSG + BVH acceleration |
| **@dimforge/rapier3d-compat** | WASM rigid-body physics |
| **blockly** (11) | Visual Arduino programming |
| **peerjs** | WebRTC P2P (online Robo-Sumo) |
| **uuid** | IDs |
| **Vite** (5) | Dev server + bundler |
| **electron** / **electron-builder** (dev) | Desktop shell / packaging |
| **playwright** (dev) | Headless UI/theme verification |
| **gh-pages** (dev) | GitHub Pages deploy |

> **Install:** new deps sometimes need `npm install --legacy-peer-deps` (three-bvh-csg peer conflict).
> **Icons:** no external icon lib — every icon is an inline SVG (`components/ui/Icon.jsx`) or an emoji. Offline / strict-CSP / Electron safe.

---

## Complete File Structure

```
toolsapp/
├── index.html                      # App entry (Vite); loading screen
├── utm-dashboard.html              # 2nd Vite page — visit-analytics dashboard (JSONP → Google Sheet)
├── vite.config.js                  # base path /Imaginarium/, 2 HTML inputs, VITE_BASE override
├── tailwind.config.js              # remaps gray→--g-*, indigo→--a-* (accent), slate→text channels
├── postcss.config.js · package.json · netlify.toml · vercel.json
│
├── electron/
│   ├── main.cjs                    # Electron main process (desktop window)
│   └── preload.cjs                 # preload bridge
│
├── docs/
│   ├── UTM-SETUP.md                # how to wire the Google-Sheet analytics collector
│   └── utm-collector.gs            # Google Apps Script — appends visit records to a Sheet
│
├── public/
│   ├── favicon.svg                 # robot-head tab icon
│   ├── constructa-logo.png         # brand wordmark
│   ├── CNAME                       # custom domain constructa.atumx.in
│   └── models/                     # built-in GLBs (preloaded/cloned by modelLoader)
│       ├── arduino_uno.glb · subo.glb · servo.glb · motor_dc.glb · motor_bo.glb · led.glb · free_wheels.glb
│       ├── ultrasonic.glb · ir_sensor.glb · gas_sensor.glb · oled.glb · buzzer.glb · ldr.glb · dht11.glb
│       ├── weapon_autocannon.glb · weapon_shotgun.glb · weapon_rocket.glb · weapon_flame.glb   # combat weapons (lazy)
│       └── subo_*.glb              # SUBO board backups/variants (see SUBO notes)
│
└── src/
    ├── App.jsx                     # Root shell: layout, render-loop hook, keyboard shortcuts, bond propagation,
    │                               #   right icon-rail, mounts CombatHUD; onAnimationTick drives sim/battle/arena
    ├── main.jsx                    # React root
    │
    ├── components/                 # ── React UI ───────────────────────────────────────────────
    │   ├── Viewport.jsx            # Three.js canvas, raycasting, gizmo wiring, attachment sync; hosts toolbox + view cube
    │   ├── ViewportToolbox.jsx     # FLOATING glass toolbox (top-left): transform / surface-extrude-slice / snap-grid-axes / print bed
    │   ├── ViewGizmo.jsx           # Interactive View Cube (top-right); fades under overlays
    │   ├── Header.jsx              # Top bar: project name, theme toggle, Help, Save, File menu, Drive/share/STL
    │   ├── StatusBar.jsx           # Bottom bar: object count + shortcut cheat-sheet
    │   ├── Toolbar.jsx             # DEPRECATED old left sidebar (kept, unmounted)
    │   ├── PropertiesPanel.jsx     # Selected-object editor (transform/color/material/bend/fillet/dims/save-as-asset)
    │   ├── DimensionEditorPanel.jsx# Typed W/H/D bounding-box resize (center / locked-face)
    │   ├── DimensionOverlay.jsx    # On-canvas size labels
    │   ├── ObjectList.jsx          # Scene hierarchy, multi-select, visibility
    │   ├── AssetLibrary.jsx        # Library section: shapes + Text + Models + import(GLB/GLTF/STL/SVG) + saved assets
    │   ├── ElectronicsLibrary.jsx  # Electronics section: MCUs (Arduino/SUBO) + actuators + sensors + weapons; elec-* anchors
    │   ├── MechanicalLibrary.jsx   # Gear / Bolt / Screw / Star creation
    │   ├── BooleanPanel.jsx        # CSG union/subtract/intersect (injected when 2 selected)
    │   ├── FilletPanel.jsx         # Chamfer/fillet edges
    │   ├── ExtrudePanel.jsx        # Face-extrude tool UI (Merge / Keep both / Cancel)
    │   ├── SurfaceAttachPrompt.jsx # Surface-patch selection / bonding prompt
    │   ├── SlicePolylineOverlay.jsx# Editable cut-line overlay for Slice
    │   ├── WiringPanel.jsx         # Pin-to-pin wiring UI (state machine, PIN_DEFS per component)
    │   ├── WiringWorkbench.jsx     # Drag-to-connect 2D wiring workbench (Fritzing-style); shares electronicsStore.connections
    │   ├── ElectronicsPanel.jsx    # Legacy wire-connections editor (kept)
    │   ├── JointPanel.jsx          # Mechanical joint editor + feature-pick
    │   ├── RobotPanel.jsx          # Robot blueprint / module UI
    │   ├── BlocksPanel.jsx         # Blockly workspace → Arduino C++ (lazy-loaded)
    │   ├── CodeEditor.jsx          # Arduino C++ editor + Templates + Run (code-run anchor); pre-flight compiler diagnostics gate
    │   ├── CompilerOutput.jsx      # Arduino-IDE-style compiler report panel (errors/warnings/success + snippet+caret + clickable jump)
    │   ├── SimulationPanel.jsx     # Start/Stop sim (simulate anchor), environment, battle entry
    │   ├── DrivePanel.jsx          # In-viewport sim HUD (wheeled + legged drive controls, serial log)
    │   ├── BattlePanel.jsx         # Robo-Sumo HUD + setup (local/online) + Physics-Arena launch (You vs AI)
    │   ├── SettingsPanel.jsx       # Theme, grid/axes, snap, print bed
    │   ├── PanelErrorBoundary.jsx  # Wraps each panel so a crash can't kill the editor
    │   ├── WelcomeOverlay.jsx      # First-run card (Teach me / Tour / Explore)
    │   ├── OverlayBridge.jsx       # Headless: mirrors onboarding flags into overlay coordinator
    │   ├── ConstructaLogo.jsx      # Brand wordmark (img w/ text fallback), BASE_URL-aware
    │   ├── DiscordGate.jsx         # "Join beta community" card (post-load, localStorage-gated) → UTM popup_action
    │   ├── combat/
    │   │   └── CombatHUD.jsx       # Third-person PvP HUD: player L / enemy R cards, crosshair, hit marker, ability bar, camera legend
    │   ├── ui/
    │   │   ├── Icon.jsx            # ~45-glyph inline-SVG icon set (currentColor) — the only iconography source
    │   │   ├── surfaces.js         # GLASS glassmorphism tokens + icon-button styles
    │   │   ├── overlay.js          # useOverlay / useAnyOverlay — overlay-priority registry
    │   │   └── zIndex.js           # central z-index hierarchy (Z.*)
    │   └── onboarding/             # GuidedCoach · ProductTour · HelpMenu · KeyboardShortcutsModal · BeginnerGuideModal · PanelHint · MissionTracker(legacy)
    │
    ├── stores/                     # ── Zustand state (declarative) ───────────────────────────
    │   ├── sceneStore.js           # Objects, selection, CSG objects, grid/axes, project meta
    │   ├── uiStore.js              # activePanel, transformMode, simActive, snap, print bed, tool flags
    │   ├── electronicsStore.js     # Components, connections, servo/motor attachments, Arduino code, sensorValues, simulation.running
    │   ├── physicsStore.js         # Environment, gravity, wind, ground, legged control state
    │   ├── rigidStore.js           # Rigid-body / surface-bond definitions (relativeMatrix)
    │   ├── surfaceStore.js         # Surface-patch relationships
    │   ├── jointStore.js           # Mechanical joints (type/axis/limits/motor)
    │   ├── assetStore.js           # User-saved assets (localStorage)
    │   ├── gameStore.js            # Robo-Sumo + remappable controls (P1/P2 keys + fire + front)
    │   ├── combatStore.js          # Physics-Arena actors (armor/core/heat/stability/team/state) + player/enemy ids + camera mode
    │   ├── gearStore.js            # Gear mesh pairings (meshPairs)
    │   ├── robotStore.js           # Robot blueprint / module state
    │   └── historyStore.js         # Reactive mirror of undo/redo stacks
    │
    ├── managers/                   # ── Imperative logic (Three.js / physics / net) ───────────
    │   ├── SceneManager.js         # Scene/renderer/camera/lights/grid, render loop (onAnimationTick), named views, gizmo, snap, print bed
    │   ├── ObjectManager.js        # Add/remove/update meshes; animateServo/Motor/Led, setBend, reattachLocal, gear chains, bonds
    │   ├── AlignmentManager.js     # Smart alignment + dynamic guide lines while dragging (Canva/Figma/Fusion-style, placement-only)
    │   ├── DriveManager.js         # Enter/exit simulation; routes wheeled vs legged
    │   ├── SimulationManager.js    # Runs Arduino/SUBO code via arduinoParser transpiler; motorSpeeds/servoAngles/ledBrightness; sensor + SUBO shims
    │   ├── WireManager.js          # Renders 3D wires; drag-to-connect; hidden-until-needed pin reveal
    │   ├── JointManager.js         # Joint markers + constraint solving / child driving; createFeatureJoint
    │   ├── ExtrudeTool.js          # Face extrusion on BufferGeometry
    │   ├── FilletTool.js           # Vertex-chamfer / bevel
    │   ├── PatchManager.js         # Surface patches, face picking, extrude hover preview
    │   ├── StorageManager.js       # IndexedDB persistence + auto-save
    │   ├── BattleManager.js        # Robo-Sumo sim (arcade 2D disc physics, HP, ring-out) + WebRTC netcode
    │   ├── NetworkManager.js       # WebRTC P2P transport (PeerJS) for online battles
    │   ├── CombatManager.js        # Physics-Arena orchestrator: 1 Rapier body/robot, player-vs-AI, drive, ram damage, camera+effects+audio wiring, chassis lean
    │   ├── WeaponManager.js        # Per-robot weapons — primary+secondary SLOTS (ray/rocket/flame), reload/heat, mounts GLB, VFX, onFire hook
    │   ├── arena/                  # ── Third-person PvP layer (arena-only) ──
    │   │   ├── ArenaCameraManager.js   # Camera lifecycle, F1–F4 mode keys, F3 orbit mouse, owns CameraShake; snapshots+restores editor camera
    │   │   ├── ArenaCameraRig.js       # Spring-arm chase: smoothed follow → arm → collision raycast → SmoothDamp → look target + drive bob
    │   │   ├── ArenaCameraModes.js     # Data: Default / F1 Shoulder / F2 Tactical / F3 Orbit / F4 Top-Down (300ms blends)
    │   │   ├── CameraShake.js          # trauma² procedural shake (small=recoil, medium=explosion, heavy=destruction)
    │   │   ├── smoothing.js            # critically-damped SmoothDamp (scalar/vec3/angle), frame-rate independent
    │   │   ├── ArenaAIController.js     # Easy 1v1 AI → {fwd,turn,primary,secondary} (seek/face/fire, ~70% acc, reaction cadence)
    │   │   ├── CombatEffectsManager.js  # Feedback seam: fans damage/fire/detonate → HitEffects + DamageNumbers + audio + shake
    │   │   ├── HitEffects.js           # Pooled sparks/smoke/debris/hit-flash/armor-shards/destroyed fire+smoke
    │   │   ├── DamageNumbers.js        # Floating damage numbers (imperative DOM overlay, same-target aggregation)
    │   │   └── ArenaAudio.js           # WebAudio placeholder combat sounds (event→generator registry)
    │   ├── history/
    │   │   ├── HistoryManager.js   # Command-stack undo/redo (transactions, 1000-cap)
    │   │   ├── Command.js          # Command / CompositeCommand / SnapshotCommand
    │   │   └── editorDispatch.js   # Single sanctioned mutation facade
    │   ├── physics/
    │   │   ├── PhysicsManager.js   # Rapier WASM world; bodies/joints; combat: createCombatBody/impulse/raycast/contact events
    │   │   ├── PhysicsIntegrator.js# Kinematic fallback (inertia, drag, friction, wind)
    │   │   ├── MassCalculator.js   # Volume×density mass, inertia, frontal area
    │   │   └── EnvironmentConfig.js# Earth/Moon/Mars/Zero-G presets
    │   └── robot/
    │       ├── LeggedSystem.js     # Auto-detect + drive hexapod/quadruped/biped
    │       ├── GaitEngine.js       # Tripod/trot/alternating gaits
    │       ├── IKSolver.js         # Leg IK foot targets
    │       └── DifferentialDrive.js# Wheeled diff-drive math
    │
    ├── combat/                     # ── Combat framework (physics-independent logic) ──────────
    │   ├── CombatStats.js          # Robot class (light/medium/heavy) + stat block from real mass (HP/mobility/resist)
    │   ├── DamageManager.js        # THE single damage funnel (armor→core, crit, stability/heat, friendly-fire hook)
    │   ├── StabilitySystem.js      # Stability meter → stumble/stagger
    │   ├── HeatSystem.js           # Heat meter → overheat (hysteresis)
    │   ├── StatusEffectSystem.js   # Timed debuffs (burning/slow/disabled)
    │   ├── weaponRegistry.js       # Data-driven weapon defs (autocannon/shotgun/rocket/flame + built-in melee)
    │   ├── ProjectileManager.js    # Pooled swept-raycast rockets → ExplosionSystem
    │   └── ExplosionSystem.js      # Radial damage + impulse falloff + flash + onDetonate hook
    │
    ├── robot/                      # ── Robot blueprint / module / AI runtime ────────────────
    │   ├── RobotBlueprint.js · RobotRuntime.js · ModuleLoader.js · ModuleHost.js
    │   ├── PowerSystem.js · componentRegistry.js · modules.js
    │   ├── autoBlueprint.js · blueprintBuilder.js   # derive a blueprint from the scene
    │   └── ai/ (AIRuntime.js · behaviors.js)
    │
    ├── blockly/
    │   ├── arduinoBlocks.js        # Custom Arduino hardware blocks + toolbox
    │   └── arduinoGenerator.js     # Blockly → Arduino C++ generator
    │
    ├── arduino/                    # ── Simulator sensor libs + genuine Arduino sources ───────
    │   ├── sensorSim.js            # Single reusable sensor-reading interface (scene-driven / manual values)
    │   ├── sensorLibs.js           # Runtime LDR/DHT11/ColorSensor/RGB classes injected into sketches (like Servo)
    │   └── libraries/              # REAL Arduino library sources (source of truth, shipped for users)
    │       ├── Subo/ (Subo.h/.cpp, MotorExpansion.h/.cpp, pitches.h, keywords.txt, library.properties, README)
    │       ├── LDR/ · DHT11/ · ColorSensor/ (each .h/.cpp)
    │       └── examples/ (*.ino per library)
    │
    ├── onboarding/
    │   ├── onboardingStore.js      # UI-only onboarding state (welcome/tour/coach/modal flags), localStorage
    │   ├── coachSteps.js           # 27 guided-coach steps (selector + copy + read-only detect rule)
    │   ├── tourSteps.js            # 10 passive product-tour highlights
    │   └── missions.js             # Legacy mission checklist (superseded)
    │
    ├── hooks/
    │   ├── useHistory.js           # Delegates to editorDispatch (legacy snapshot() bridge)
    │   ├── useScene.js · useSelection.js
    │
    ├── theme/theme.js              # getTheme/toggleTheme — data-theme on <html>, persisted, default dark
    │
    ├── utils/
    │   ├── geometryFactory.js      # Primitive geometry + applyBendDeform
    │   ├── csg.js                  # runBoolean() — CSG with gizmo-correct positioning
    │   ├── arduinoParser.js        # Full Arduino C++ lexer + parser + JS transpiler
    │   ├── arduinoDiagnostics.js   # Compiler-style pre-flight analyzer (Arduino-IDE diagnostics: errors/warnings/suggestions/stats)
    │   ├── electronicsFactory.js   # Electronics component meshes + pin spheres/labels (SUBO substrate anchoring)
    │   ├── modelLoader.js          # GLTF/GLB/STL import + built-in GLB preload/clone (MODEL_PATHS, MODEL_SCALE_TARGET)
    │   ├── svgImport.js            # svgTextToGeometry — extrude SVG → solid
    │   ├── sliceTool.js            # Plane/polyline mesh slice
    │   ├── robotAssembly.js        # Union-find grouping of bonded/attached parts → robots (rootId, robotOptions)
    │   ├── export.js               # JSON/STL/GLTF export + import
    │   ├── printExport.js          # STL export + printability analysis
    │   ├── share.js                # Share-link build/read (project packed into URL hash)
    │   ├── utmTracking.js          # Backend-free visit analytics → Google Sheet
    │   └── helpers.js              # buildProjectSnapshot (save/load), snapRotationToAxes, misc
    │
    └── styles/globals.css          # Theme CSS variables (--g-*/--a-*), scrollbars, focus rings, theme-anim
```

---

## UI Shell & Layout

The app is **viewport-first**. `App.jsx` renders a vertical shell:

```
┌───────────────────────────────────────────────────────────────┐
│  Header  (logo · project name · ☀/🌙 · ? Help · Save · File)     │  z-40
├───────────────────────────────────────────────────────────────┤
│  ┌──────────┐          VIEWPORT           ┌──────────────┐ ┌────┐│
│  │ floating │        (largest area)       │ active right │ │icon││
│  │ toolbox  │          + View Cube ↗      │   section    │ │rail││
│  └──────────┘                             └──────────────┘ └────┘│
├───────────────────────────────────────────────────────────────┤
│  StatusBar  (object count · shortcut cheat-sheet)               │
└───────────────────────────────────────────────────────────────┘
```

- **No permanent left sidebar** (old `Toolbar` unmounted). Tools live in the floating **ViewportToolbox** (top-left, glass): transform (W/E/R) · surface/extrude/slice · snap/grid/axes · print bed.
- **View Cube** (`ViewGizmo`, top-right): clickable faces snap the camera; passive — fades out under any overlay.
- **Right workspace** = full-height section panel + slim grouped **icon rail** (drag-resizable 224–560 px). One section at a time.

**Right-panel sections** (rail groups → ids):
Design: Properties · Objects · Library — Create: Electronics · Mechanical — Build: Wiring · Joints · Robot — Program: Blocks · Code — Run: Simulation · Battle — Setup: Settings.
The **⊕ Boolean** section is injected only when two boolean-capable objects are selected.

---

## Design System / Theme

CSS-variable token system in `globals.css` (not a Tailwind ramp hack):
- Neutrals `--g-50…--g-950` (space-separated RGB so `<alpha-value>` opacity works); Accent `--a-*` = **orange `#F97316`** both themes.
- `tailwind.config.js` remaps `gray-*`→`--g-*`, `indigo-*`→`--a-*`, `slate-*`→text channels, so existing classes flip between themes with **no markup edits**.
- **Light/Dark** in `theme/theme.js` — stamps `data-theme` on `<html>`, persists to localStorage, default dark; `.theme-anim` fades colours ~200 ms.
- Shared **glass** tokens in `ui/surfaces.js`; inline-SVG icons in `ui/Icon.jsx`.
- **Caveat:** text drawn directly on the always-white 3D canvas uses fixed hex, not the flipping tokens.

**Overlay layering** (`ui/overlay.js` + `ui/zIndex.js` + `OverlayBridge`): passive widgets (View Cube) defer to any open popup. Register a new overlay with one line — `useOverlay('id', open)`. Z-scale: viewport 0 · toolbox 20 · viewCube 30 · dropdown 40 · dialog 50 · coach 120 · modal 130 · toast 200. (CombatHUD sits at z-90, its damage-number layer at z-95.)

---

## State Management (stores)

~13 Zustand stores hold declarative state; managers hold imperative logic; components subscribe + call managers. Key stores:

- **sceneStore** — `objects[]`, selection (`selectedId`/`secondaryId`), CSG add/group/ungroup, grid/axes, project meta, `standaloneIds`.
- **uiStore** — `activePanel` (free-form string), `transformMode`, `simActive`, snap, print bed, surface/extrude/slice tool flags.
- **electronicsStore** — components, `connections`, servo/motor `attachments`, Arduino `code`, `sensorValues` (manual/scene sensor inputs), `simulation.running`.
- **physicsStore** — environment, gravity, air density, friction, wind, `isLeggedRobot`, `leggedControl`.
- **rigidStore** / **surfaceStore** — surface bonds (`relativeMatrix`) + patch relationships.
- **jointStore** — mechanical joints. **gearStore** — gear mesh pairings. **robotStore** — blueprint/modules.
- **gameStore** — Robo-Sumo state + **remappable controls** (`p1`/`p2` keys + `front` + `fire`), persisted to `localStorage['subo.controls']`.
- **combatStore** — Arena actors keyed by rootId `{armor,core,heat,stability,staggered,overheated,state,team,effects}` + `playerId`/`enemyId`/`hitMarkerAt`/`cameraMode`.
- **historyStore** / **assetStore** — undo-stack mirror / saved assets.

---

## Managers

Managers own all Three.js / physics / network mutation. The render loop lives in **SceneManager** (`onAnimationTick`, injected by App). Highlights:

- **ObjectManager** — the mesh registry; animation of servos/motors/LEDs, gear chains, bond propagation, `reattachLocal`.
- **AlignmentManager** — magnetic snap + fading guide lines during a Move drag (placement-only).
- **DriveManager** — enters sim; picks wheeled (≥2 motors wired) vs legged (servo+arm leg pairs) path.
- **SimulationManager** — transpiles + runs Arduino/SUBO/Blockly-generated C++; exposes motorSpeeds/servoAngles/ledBrightness; injects SUBO library API + sensor libraries.
- **WireManager** — 3D wire tubes + drag-to-connect; **hidden-until-needed pin reveal** (pins show only when the Wiring panel is open or the board is selected).
- **BattleManager / NetworkManager** — Robo-Sumo (local + online WebRTC, split-authority, geometry streaming).
- **CombatManager + arena/** — Physics-Arena (see [Combat Arena](#combat-arena--physics-arena)).
- **physics/** — Rapier world + kinematic fallback + mass/env config.
- **history/** — command-stack undo/redo via the single `editorDispatch` facade.

---

## Utilities

Pure helpers: `geometryFactory` (primitives + bend), `csg` (boolean w/ gizmo centering), `arduinoParser` (C++ lexer→parser→JS transpiler), `electronicsFactory` (component meshes + pins), `modelLoader` (GLB/GLTF/STL + preloading + `MODEL_SCALE_TARGET`), `svgImport`, `sliceTool`, `robotAssembly` (union-find → robots), `export`/`printExport`/`share`, `utmTracking`, `helpers` (save/load snapshot).

---

## Subsystems

### CAD / Solid editing
Primitives + polyhedra + Text + SVG→solid + GLB/GLTF/STL import. **Boolean CSG** (union/subtract/intersect, gizmo-correct via `csg.js`), **Extrude** (pick face → walls → merge), **Fillet/Chamfer** (vertex bevel), **Slice** (draw a cut line), **geometry bending** (cylindrical `applyBendDeform`), typed **Dimension Editor**, **mechanical joints** (fixed/hinge/revolute/slider/ball/servo), **surface bonding** (`relativeMatrix`, propagated each frame), **gear pairing**.

### Electronics & wiring
Arduino, **SUBO** (custom ESP32-S3), servo, DC/BO motor, LED, sensors (IR/ultrasonic/gas/OLED/buzzer/LDR/DHT11/color), weapons. Two synced wiring views: **WiringPanel** (pin-to-pin state machine) and **WiringWorkbench** (drag-to-connect 2D). 3D wires via `WireManager`. Registering a new board touches: `modelLoader`, `electronicsFactory`, `ObjectManager`, `sceneStore`, `ElectronicsLibrary`, `WiringPanel`, `CodeEditor`, `App`, `MassCalculator`.

### Arduino / Blockly programming & simulation
`arduinoParser.js` = full C++ lexer → parser → JS codegen run in a sandboxed eval with Arduino API shims. Any `D<n>`/`IO<n>` pin → GPIO, so **SUBO reuses the parser unchanged** (SUBO constants + library prepended). Blockly programs convert to the same C++ via `arduinoGenerator`. `SimulationManager` injects SUBO API (matrix/buzzer/`MotorExpansion`) + sensor libraries.

**Compiler diagnostics (`arduinoDiagnostics.js` + `CompilerOutput.jsx`)** — a pre-flight analyzer giving Arduino-IDE/PlatformIO-style feedback. On **Run**, CodeEditor + BlocksPanel call `analyzeArduino(code, {board})` *before* the runtime; if it returns blocking **errors**, execution is withheld and a compiler report is shown. **Fully additive** — it does not touch `arduinoParser` or `SimulationManager`; a valid sketch returns zero errors and runs exactly as before (the analyzer is precision-first: anything uncertain is a non-blocking **warning**, never an error).
- **Own tokenizer** tracks line+column+snippet; collects **multiple** diagnostics per pass (unlike the parser's first-throw).
- **Errors:** missing `;` (before `}` / new statement), unbalanced/mismatched brackets, unterminated string/char/comment, invalid number, unknown function/identifier (with **Levenshtein "did you mean"** suggestions), wrong argument count, `digitalWrite` arg-2 type check, invalid pin (`IO50` → IO1–IO21), **board mismatch** (SUBO API on an Arduino board → `#include <Subo.h>?`), duplicate function, invalid/misspelled include.
- **Warnings (non-blocking):** assignment in condition, division by zero, always-true condition, potential infinite loop, unused variable, unreachable/dead code.
- **Suggestion engine:** case-insensitive exact match first (`pinmode`→`pinMode`), else nearest within an edit budget (`digitalWrte`→`digitalWrite`, `Subbo`→`Subo`).
- **Success report:** ✓ Compilation Successful + stats (lines/functions/variables/libraries/warnings/time) + "Ready to Execute".
- **UI (`CompilerOutput`):** red errors / yellow warnings / green success, icons, code snippet with a `^` caret under the offending token, expandable explanations, and click-to-jump (CodeEditor scrolls + selects the offending line). Blockly runs the SAME diagnostics on its generated C++.

### Sensors (simulation)
`arduino/sensorSim.js` = the single reusable reading interface (scene-driven or manual `electronicsStore.sensorValues`). `arduino/sensorLibs.js` = runtime LDR/DHT11/ColorSensor/RGB classes injected into sketches like `Servo`. `arduino/libraries/*` ships the **genuine Arduino sources** (Subo, LDR, DHT11, ColorSensor + examples) — the source of truth the sims mirror method-for-method.

### Physics simulation
**Rapier WASM** (`PhysicsManager`) + kinematic fallback (`PhysicsIntegrator`) — inertia, drag, rolling friction, wind. `MassCalculator` = volume×density mass. Presets: Earth/Moon/Mars/Zero-G. Scale: 1 su = 5 cm. (Rapier needs COOP/COEP headers for SharedArrayBuffer in production.)

### Robots — wheeled & legged
Wheeled: auto-detect ≥2 motors → `DifferentialDrive`. Legged: auto-detect hexapod/quad/biped from servo+arm pairs → `GaitEngine` (tripod/trot/alternating) + `IKSolver`. `DrivePanel` HUD. Robot **blueprint/AI** system in `src/robot/` (`RobotBlueprint`/`ModuleLoader`/`RobotRuntime`/`autoBlueprint` + `ai/`).

### Robo-Sumo Battle (Mode A)
Push out of a ring / drain HP by ramming; 100 HP, 3 lives. **Arcade 2D disc physics** (NOT Rapier). Local (P1 WASD / P2 arrows) + **online WebRTC/PeerJS** with split-authority netcode, box-cluster proxy → streamed exact geometry (backpressure-paced), orientation via `geometa`. `BattleManager` + `gameStore`.

### Combat Arena — "Physics Arena"
A Rapier-based, modular combat engine (distinct from the arcade Sumo). Launched from **Battle → 🤖 Physics Arena — You vs AI**. Ticked from `App.onAnimationTick` when `combatStore.arenaActive`.

**Core (`src/combat/` + CombatManager/WeaponManager/physics):**
- Each robot = **ONE Rapier dynamic body** (box approximating the assembly), yaw-locked upright, real mass → heavy shoves light. **Body id === assembly rootId** (contacts/raycasts resolve to the actor).
- **Movement** is impulse-driven (`_drive`): linear impulse toward `input.fwd*maxSpeed` (forward = reverse, `REVERSE_SCALE=1.0`), torque impulse toward a target yaw rate. Tuning: `MAX_SPEED 16`, `ACCEL_GAIN 0.62`, `TURN_RATE 5.0`, `TURN_GAIN 0.9`; per-robot `CombatStats` scales speed/turn with mass.
- **Damage funnel** (`DamageManager`) — every source emits one `DamageEvent`; armor absorbs → overflow to core → destroyed; crit on exposed core; friendly-fire hook. **CombatStats** = class + stats from real mass. **Stability/Heat/StatusEffect** systems modulate control. **Weapons** (`weaponRegistry` + `WeaponManager`): ray (autocannon/shotgun) · rocket (`ProjectileManager`→`ExplosionSystem`) · flame; **primary+secondary slots** (LMB/RMB; secondary defaults to built-in **Melee Strike**).

**Third-person PvP layer (`src/managers/arena/`)** — makes the arena feel like a mech game (player controls robot[0], AI drives robot[1]):
- **Player controller** — WASD move (mouse never rotates), **LMB primary / RMB secondary**. **`ArenaAIController`** — easy, beatable AI emitting the same input shape (seek→face→fire, ~70% accuracy, 400–600 ms reaction, strafe/back-off/unstick).
- **Camera** (arena-only; snapshots + restores the shared editor camera): `ArenaCameraManager` (lifecycle, F1–F4 modes, F3 orbit mouse, owns `CameraShake`) → `ArenaCameraRig` (smoothed follow → spring arm → wall-collision raycast → SmoothDamp position → look target + velocity look-ahead + speed-scaled distance/FOV + engine drive-bob; level horizon). Modes: Default / F1 Shoulder / F2 Tactical / F3 Orbit / F4 Top-Down (300 ms blends). All critically damped (`smoothing.js`), frame-rate independent.
- **Feedback** — `CombatEffectsManager` fans damage/fire/detonate to `HitEffects` (sparks/smoke/debris/hit-flash/armor-shards/destroyed fire), `DamageNumbers` (DOM overlay, aggregated), `ArenaAudio` (WebAudio placeholder sounds), `CameraShake`. Subtle **chassis lean/sway/suspension** on robots (visual-only, physics untouched).
- **HUD** (`CombatHUD`) — player L / enemy R (armor/HP/stability/heat + weapon/ammo), crosshair + hit marker, ability bar, camera-mode legend, overheat vignette, Exit.

**Stage status:** Done 1–4 (bodies+HP · damage+classes · stability/heat/status · weapons/projectiles/explosions) + PvP feel pass. Pending 5–8 (teams/co-op · AI archetypes/objectives/hazards · online netcode · polish).

### Onboarding / Tutorial (UI-only, read-only)
`onboarding/` store + `components/onboarding/`: WelcomeOverlay, GuidedCoach (27 state-detected steps), ProductTour (10), HelpMenu, KeyboardShortcutsModal, BeginnerGuideModal, PanelHint. Steps complete on **actual app state**, never DOM clicks. `data-tour` anchors drive spotlights — don't rename without updating `coachSteps.js`/`tourSteps.js`.

### Alignment guides
`AlignmentManager` — while Move-dragging, magnetically snaps to nearby centers/edges/faces and draws fading guide lines. Placement-only (like grid snap); never mutates other objects.

### Branding & Analytics
**Constructa** brand: `ConstructaLogo`, loading screen, `DiscordGate` beta card, favicon, custom domain. **UTM analytics** (`utmTracking.js`) — backend-free, one record/tab-session → `sendBeacon` → Google Apps Script (`docs/utm-collector.gs`) → Sheet; `utm-dashboard.html` reads it via JSONP.

---

## Data Models

### Scene Object (sceneStore)
```js
{
  id, name, type,            // box|sphere|…|text|gear|bolt|screw|csg|model|<electronics>|weapon_*
  position:{x,y,z}, rotation:{x,y,z}, scale:{x,y,z},
  color, material,           // standard|metallic|transparent
  visible,
  deform:{bend,bendAxis}?,   // only when bent
  attach:{motorId,position,quaternion,scale}?,   // inside a motor rotor
  modelKey?, geometryJSON?, groupMembers?, isHole?,
  metadata:{createdAt,updatedAt},
}
```

### Combat Actor (combatStore, keyed by rootId)
```js
{ id,name,team, armor,armorMax, core,coreMax, heat,heatMax,
  stability,stabilityMax, staggered, overheated,
  state:'active'|'downed'|'destroyed', effects:[] }
```

### Joint / Physics / UI stores — see the store files (jointStore, physicsStore, uiStore) for shapes.

---

## Key Architecture Decisions

- **State ↔ Managers ↔ Utils** separation; onboarding/overlay is a strictly read-only presentation layer.
- **Undo/Redo** = command-stack (`history/`), one facade (`editorDispatch`), 1000-cap, 5-slice canonical snapshot; save/load stays on the separate `'1.0'` format.
- **CSG gizmo** — `csg.js` recenters geometry at its bbox midpoint and returns `position`.
- **Board-agnostic simulator** — `D<n>`/`IO<n>`→GPIO lets SUBO reuse the Arduino parser unchanged.
- **Robot assembly** — union-find over bonds + attachments → `rootId`; used by Battle + Arena to move parts as one unit; bond propagation skipped during battle/arena.
- **Combat** — one physics body per robot (per-part armor is logical, not separate bodies); the damage funnel is the single path; the arena camera/effects are additive over the combat systems.
- **SUBO GLB** — mixed-unit hierarchy; `suboBoardBox()` anchors pins + LED matrix to the **largest** `/pcb/i` mesh (the real substrate). Don't revert to "first pcb mesh."

---

## Controls & Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `W`/`E`/`R` | Gizmo Translate / Rotate / Scale (scale blocked for electronics) |
| `Ctrl+Z`/`Ctrl+Y` | Undo / Redo |
| `Ctrl+C`/`V` · `Ctrl+D` | Copy/Paste · Duplicate (smart repeat) |
| `Ctrl+G`/`Ctrl+Shift+G` | Group (CSG) / Ungroup |
| `Delete`/`Backspace` | Delete selected / patches |
| `1`–`0` | Add primitive (1 cyl · 2 cone · 3 cube · 4 sphere · 5 tetra · 6 sq-pyr · 7 pent-pyr · 8 octa · 9 dodeca · 0 rect-prism) |
| `G`/`A` · `F` · `Shift+S` | Grid/Axes · Frame selection · Snap rotation to axes |
| `↑↓←→` | Nudge (Shift = Y); drives legged robot during legged sim |
| **Battle** | P1 WASD / P2 arrows (editor shortcuts blocked while active) |
| **Arena** | **WASD** move · **LMB** primary · **RMB** secondary · **F1–F4** camera views |
| `Space`/`Enter` | (legacy Arena fire keys) |
| Mouse | Wheel zoom · Middle-drag orbit · Right-drag pan (edit mode) |

---

## Setup, Build & Deploy

```bash
npm install            # add --legacy-peer-deps if peer-dep conflicts appear
npm run dev            # Vite dev → http://localhost:5173/Imaginarium/   (note the base path)
npm run build          # Production build (dist/)
npm run preview        # Serve dist/  (pin a port: npm run preview -- --port 4180)
npm run deploy         # Build + publish to gh-pages
npm run electron       # Electron desktop shell
npm run build:win      # Package a Windows app (electron-builder)
```

- **Don't run `npm run build` while `npm run dev` is live** (build rewrites `dist/` and crashes the Windows dev watcher).
- Production needs **COOP/COEP headers** for Rapier SharedArrayBuffer. `netlify.toml`/`vercel.json` set host config; GH Pages base path in `vite.config.js`.
- Requires WebGL 2.0, ES2020+, IndexedDB, SharedArrayBuffer; online battle needs WebRTC.

---

## MCP Asset Tooling (Blender + fal.ai)

Dev/authoring only — **not** part of the app runtime/build. Config `.mcp.json` in the repo parent (+ gitignored `.env` with `FAL_KEY`); walkthrough in `MCP_SETUP.md`.
- **blender** (stdio, `blender-mcp.exe`) — needs the MCP add-on running in Blender (`localhost:9876`). Tools: `execute_blender_code`, `get_objects_summary`, `render_viewport_to_path`, screenshots, API docs → author/inspect/render `public/models/*.glb`.
- **fal-ai** (HTTP) — text/image→3D generation.
- Registers only in the `claude` **CLI** (not the IDE extension). New/re-exported GLBs auto-scale via `MODEL_SCALE_TARGET`, but re-verify SUBO pins/matrix after any re-export.

---

## Troubleshooting

**View Cube overlaps a menu/popup** → it reads `useAnyOverlay()` and fades out; register new overlays with `useOverlay('id', open)`.
**A tool "disappeared" from the toolbox** → creation moved to right-panel Library/Electronics/Mechanical sections.
**Tutorial arrow points at nothing** → the step's `data-tour` anchor moved; open its section, or fix `coachSteps.js`.
**Undo after a gizmo drag wipes the scene** → fixed: one canonical `recordSnapshot('transform')`.
**Gizmo at wrong spot after Boolean/Fillet/Extrude** → `csg.js` returns `position`; pass it to `addCSGObject`.
**Servo arms fly apart on reimport** → arm must be in `attachments`; `reattachLocal` restores the local transform on load.
**Online Battle opponent invisible/upside-down** → stream per-mesh with backpressure + `geometa` orientation.
**Rapier physics not working** → WASM must finish loading; ensure COOP/COEP headers.
**A panel crashed** → wrapped in `PanelErrorBoundary`; use Retry.
**SUBO pins/matrix collapse to a dot** → `suboBoardBox()` must anchor to the **largest** `/pcb/i` mesh, not the first.
**SUBO/Arduino pins not visible** → hidden until needed; open Wiring or select the board (`WireManager.setReveal`).
**White/invisible text after theme change** → 3D-canvas text uses fixed hex, not tokens; inputs force-darkened in `globals.css`.
**`npm run dev` crashes `EBUSY … dist/…glb`** → a preview/build is holding `dist/`; stop it first.
**Arena camera stuck / editor camera wrong after leaving Arena** → `ArenaCameraManager` restores it in `stop()`; the HUD Exit button always restores. OrbitControls is disabled during a match (except F3).
**Arena: LMB/RMB do nothing / robot won't move** → player = robot[0] (first pick); WASD moves, A/D rotate (mouse doesn't); LMB needs a ⚔ weapon part (else no primary), RMB = built-in Melee. Click the viewport if focus was lost.
**Arena feels like a simulator / no hits or sound** → feedback is `CombatEffectsManager` (fed by `DamageManager.onApplied` + `WeaponManager.onFire` + `ExplosionSystem.onDetonate`); audio unlocks on first click; damage numbers are a DOM overlay.
**Canvas not rendering** → check WebGL 2.0 and canvas dimensions > 0.

---

**Last Updated:** 2026-07-10 · **Version:** 1.8.0
Full robotics platform · SUBO board (largest-substrate pin anchoring) · Constructa branding · Robo-Sumo (local+online) · **Physics-Arena combat** Stages 1–4 + third-person **You-vs-AI PvP layer** (chase camera, easy AI, LMB/RMB weapons, hit VFX/damage numbers/audio, chassis lean) · UTM analytics · custom domain `constructa.atumx.in`.
