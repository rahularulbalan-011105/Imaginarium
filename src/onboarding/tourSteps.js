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
    title: 'Edit tools',
    what: 'The toolbar at the top-left of the 3D view: move, rotate, resize, attach, extrude, slice, snapping and grid. Hover a button to see its name.',
    does: 'Switch Move / Rotate / Scale, use Surface / Extrude / Slice, and toggle grid, axes and snapping.',
    when: 'Use it while shaping objects. Add new objects from Design → Library and Build → Electronics / Mechanical.',
  },
  {
    selector: 'viewport',
    title: '3D Viewport',
    what: 'Your 3D workspace.',
    does: 'Shows your design. Click to select, drag a part to move it, drag empty space to select several, right-drag to orbit, scroll to zoom.',
    when: 'This is where you build and arrange everything.',
  },
  {
    selector: 'panel',
    panel: 'properties',
    title: 'Design → Edit',
    what: 'Attach and Edit for whatever object is selected.',
    does: 'Attach: bond it to a surface or a motor. Edit: change its name, position, rotation, scale, color, material, bend, fillet and more.',
    when: 'Use it right after selecting an object to fine-tune it precisely.',
  },
  {
    selector: 'panel',
    panel: 'objects',
    title: 'Design → Objects',
    what: 'A list of everything in your scene.',
    does: 'Click any item to select it, toggle its visibility, or delete it. Shift-click a second object, then use Design → Combine.',
    when: 'Use it when the scene gets busy and clicking in 3D is fiddly.',
  },
  {
    selector: 'panel',
    panel: 'wiring',
    title: 'Build → Wiring',
    what: 'The electronics connector — a 2D Workbench and a Pin list, sharing the same wires.',
    does: 'Drag from one pin to another (or pick two pins) to run a wire. Right-click a wire to change its colour or delete it.',
    when: 'Use it after adding electronics and before writing code.',
  },
  {
    selector: 'panel',
    panel: 'blocks',
    title: 'Code → Blocks',
    what: 'Visual, drag-and-drop programming.',
    does: 'Snap blocks together to build Arduino logic with no typing — it generates real C++ for you.',
    when: 'Great when you are new to coding or want to prototype logic fast.',
  },
  {
    selector: 'panel',
    panel: 'code',
    title: 'Code → C++',
    what: 'The Arduino C++ editor.',
    does: 'Write or paste code, load a ready-made Template, press Run, and watch the Serial Monitor.',
    when: 'Use it to program exactly how your components behave.',
  },
  {
    selector: 'simulate-header',
    title: 'Simulate → Run',
    what: 'The Simulate button in the top bar (also in Simulate → Run).',
    does: 'Enters simulation mode and brings your robot to life with physics — then you can drive it around. Robot and Physics settings sit in the neighbouring Simulate tabs.',
    when: 'Use it once your build is wired up and programmed.',
  },
  {
    selector: 'panel',
    panel: 'library',
    title: 'Design → Library',
    what: 'A catalog of parts and models.',
    does: 'Add extra shapes, drop in your own GLB / GLTF / STL models, and reuse parts you saved earlier.',
    when: 'Start here to add shapes, text and models to your design.',
  },
]
