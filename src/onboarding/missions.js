// Learn-by-doing missions. Completion is DETECTED by observing real app state
// (read-only) inside MissionTracker — these objects only describe the goal and
// the success feedback. Nothing here creates objects or changes any store.

export const MISSIONS = [
  { id: 'cube',    label: 'Add a cube',          tip: 'Click ⬛ Cube in the left toolbar (or press 3).',                 flash: 'Cube added! 🎉' },
  { id: 'move',    label: 'Move the cube',        tip: 'Click the cube to select it, press W, then drag a colored arrow.', flash: 'Nice move! 👍' },
  { id: 'scale',   label: 'Resize the cube',      tip: 'Press R for Scale and drag a handle — or edit Scale in Properties.', flash: 'Resized! 📏' },
  { id: 'arduino', label: 'Add an Arduino',       tip: 'In the “Elec” group of the toolbar, click 🟢 Arduino.',           flash: 'Brain added! 🧠' },
  { id: 'motor',   label: 'Add a motor',          tip: 'In the “Elec” group, click a Motor (BO or DC).',                  flash: 'Motor ready! ⚙' },
  { id: 'wire',    label: 'Connect components',   tip: 'Open the ⚡ Wiring tab, then click a pin on each part to join them.', flash: 'Wired up! ⚡' },
  { id: 'code',    label: 'Open the Code editor', tip: 'Click the “{ } Code” tab on the right side.',                      flash: 'Editor open! { }' },
  { id: 'run',     label: 'Run a simulation',     tip: 'Press ▶ Run in the Code tab, or ▶ Simulate in the toolbar.',       flash: "It's alive! 🤖" },
]
