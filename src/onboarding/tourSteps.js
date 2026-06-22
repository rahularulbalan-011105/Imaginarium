// Product-tour steps. Each step points at a real element via its `data-tour`
// attribute. `panel` (optional) is the right-panel tab to switch to first, so
// the highlighted area is visible. Pure data — no behavior.

export const TOUR_STEPS = [
  {
    selector: 'header',
    title: 'Project Bar',
    what: 'The bar across the top.',
    does: 'Name your project, Save it, and use the File menu to start New, Open, Import, or Export. The “?” opens this help.',
    when: 'Use it to keep your work safe and to switch between projects.',
  },
  {
    selector: 'toolbar',
    title: 'Toolbar',
    what: 'The vertical strip on the left.',
    does: 'Create shapes, electronics, and mechanical parts; switch Move/Rotate/Scale; toggle the grid and axes; and start a simulation.',
    when: 'Use it whenever you want to add something or change how you edit.',
  },
  {
    selector: 'viewport',
    title: '3D Viewport',
    what: 'Your 3D workspace.',
    does: 'Shows your design. Click to select, drag the colored arrows to move, scroll to zoom, and middle-drag to orbit the camera.',
    when: 'This is where you build and arrange everything.',
  },
  {
    selector: 'panel',
    panel: 'properties',
    title: 'Properties Panel',
    what: 'The editor for whatever object is selected.',
    does: 'Change its name, position, rotation, scale, color, material, bend, fillet and more.',
    when: 'Use it right after selecting an object to fine-tune it precisely.',
  },
  {
    selector: 'panel',
    panel: 'objects',
    title: 'Objects Panel',
    what: 'A list of everything in your scene.',
    does: 'Click any item to select it, toggle its visibility, or delete it. Shift-click a second object to enable Boolean operations.',
    when: 'Use it when the scene gets busy and clicking in 3D is fiddly.',
  },
  {
    selector: 'panel',
    panel: 'wiring',
    title: 'Wiring Panel',
    what: 'The electronics connector.',
    does: 'Click a pin on one component, then a pin on another, to run a wire between them (for example a motor to the Arduino).',
    when: 'Use it after adding electronics and before writing code.',
  },
  {
    selector: 'panel',
    panel: 'blocks',
    title: 'Blocks Panel',
    what: 'Visual, drag-and-drop programming.',
    does: 'Snap blocks together to build Arduino logic with no typing — it generates real C++ for you.',
    when: 'Great when you are new to coding or want to prototype logic fast.',
  },
  {
    selector: 'panel',
    panel: 'code',
    title: 'Code Panel',
    what: 'The Arduino C++ editor.',
    does: 'Write or paste code, load a ready-made Template, press Run, and watch the Serial Monitor.',
    when: 'Use it to program exactly how your components behave.',
  },
  {
    selector: 'simulate',
    title: 'Simulation Controls',
    what: 'The Simulate (▶) button at the bottom of the toolbar.',
    does: 'Enters simulation mode and brings your robot to life with physics — then you can drive it around.',
    when: 'Use it once your build is wired up and programmed.',
  },
  {
    selector: 'panel',
    panel: 'library',
    title: 'Asset Library',
    what: 'A catalog of parts and models.',
    does: 'Add extra shapes, drop in your own GLB / GLTF / STL models, and reuse parts you saved earlier.',
    when: 'Use it when the toolbar does not have the shape you need.',
  },
]
