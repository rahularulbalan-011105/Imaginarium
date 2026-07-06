// ─────────────────────────────────────────────────────────────────────────────
// Icon — a single inline-SVG icon set (Lucide/Phosphor-style: rounded, 1.75px
// stroke, `currentColor` so it inherits the theme). No external dependency, so
// it is safe under the app's offline / strict-CSP (Electron + static) runtime.
//
// Usage:  <Icon name="move" />                 // inherits text color + 1em size
//         <Icon name="cube" size={18} />
//         <Icon name="play" className="text-green-500" />
//
// Every glyph draws with `stroke="currentColor"`; the few solid glyphs (play /
// stop) set their own fill. Purely presentational — no state, no side effects.
// ─────────────────────────────────────────────────────────────────────────────

// Inner SVG markup per icon name. viewBox is 0 0 24 24 for all.
const PATHS = {
  // ── Transform ─────────────────────────────────────────────────────────────
  move:   <><path d="M12 2v20M2 12h20" /><path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" /></>,
  rotate: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v5h-5" /></>,
  scale:  <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></>,

  // ── Shapes ────────────────────────────────────────────────────────────────
  cube:      <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>,
  rectprism: <><path d="M22 15V9a1.5 1.5 0 0 0-.8-1.33l-8-3.6a2 2 0 0 0-1.4 0l-8 3.6A1.5 1.5 0 0 0 2 9v6a1.5 1.5 0 0 0 .8 1.33l8 3.6a2 2 0 0 0 1.4 0l8-3.6A1.5 1.5 0 0 0 22 15z" /><path d="M2.5 8 12 12l9.5-4M12 20v-8" /></>,
  sphere:    <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><path d="M12 3v18" /></>,
  cylinder:  <><ellipse cx="12" cy="5.5" rx="7" ry="2.8" /><path d="M5 5.5v13a7 2.8 0 0 0 14 0v-13" /></>,
  cone:      <><path d="M12 3 20 18 4 18z" /><ellipse cx="12" cy="18" rx="8" ry="2.4" /></>,
  pyramid:   <><path d="M12 2 3 20h18L12 2z" /><path d="M12 2v18M3 20l9-6 9 6" /></>,
  tetrahedron: <><path d="M12 2 3 20h18L12 2z" /><path d="M12 2 8 20M12 2l4 18" /></>,
  octahedron:  <><path d="M12 2 3 12l9 10 9-10-9-10z" /><path d="M3 12h18M12 2v20" /></>,
  dodecahedron: <><path d="M12 2 21 8.5 17.5 19 6.5 19 3 8.5z" /><path d="M12 8 8 11l1.5 5h5L16 11z" /></>,
  text: <><path d="M4 7V5h16v2M9 19h6M12 5v14" /></>,
  svg:  <><path d="M15.5 3.5 20.5 8.5 9 20H4v-5z" /><path d="M13.5 5.5 18.5 10.5" /></>,

  // ── Electronics ───────────────────────────────────────────────────────────
  cpu:  <><rect x="6" y="6" width="12" height="12" rx="1.5" /><rect x="9.5" y="9.5" width="5" height="5" rx="0.5" /><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></>,
  motor: <><rect x="2.5" y="8" width="12" height="8" rx="1.5" /><path d="M14.5 10.5h3l4-2.5v9l-4-2.5h-3" /><path d="M6 8V5M10.5 8V5" /></>,
  led:  <><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.6c.6.5 1 1.3 1 2.1v.3h6v-.3c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  bolt: <><path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" /><circle cx="12" cy="12" r="3.2" /></>,
  screw: <><circle cx="12" cy="4" r="2.2" /><path d="M12 6.2v13.6M9.5 9.5l5 2M9.5 13l5 2M10 16.5l3.5 1.5" /></>,

  // ── Solid-editing / workspace tools ───────────────────────────────────────
  surface: <><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 12l10 5 10-5M2 17l10 5 10-5" /></>,
  extrude: <><path d="M12 2v9" /><path d="M8 6l4-4 4 4" /><rect x="4" y="13" width="16" height="8" rx="1.5" /></>,
  slice:   <><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M20 4 8.2 15.8M14.4 14.5 20 20M8.2 8.2 12 12" /></>,
  magnet:  <><path d="M6 3v8a6 6 0 0 0 12 0V3" /><path d="M6 3H2v8M18 3h4v8" /><path d="M6 11h4M14 11h4" /></>,
  grid:    <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></>,
  axes:    <><circle cx="12" cy="12" r="9" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></>,
  guides:  <><path d="M12 2v20M2 12h20" strokeDasharray="2.5 2.5" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" /></>,
  printer: <><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1.5" /></>,

  // ── Playback ──────────────────────────────────────────────────────────────
  play: <polygon points="7 4 20 12 7 20" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,

  // ── Right-panel sections ──────────────────────────────────────────────────
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>,
  layers:  <><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 12l10 5 10-5M2 17l10 5 10-5" /></>,
  package: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12M7.5 4.2l9 5.2" /></>,
  zap:     <polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2" />,
  link:    <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.6 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>,
  robot:   <><rect x="4" y="8" width="16" height="12" rx="2.5" /><path d="M12 2v4" /><circle cx="12" cy="3" r="1" /><circle cx="9" cy="13" r="1.1" /><circle cx="15" cy="13" r="1.1" /><path d="M9.5 17h5M2 13h2M20 13h2" /></>,
  puzzle:  <><path d="M9 3a2 2 0 0 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v3a1 1 0 0 1-1 1h-3v1a2 2 0 0 1-4 0v-1H6a1 1 0 0 1-1-1v-3H4a2 2 0 0 1 0-4h1V5a1 1 0 0 1 1-1h3z" /></>,
  code:    <><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" /><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" /></>,
  swords:  <><path d="M14.5 17.5 3 6V3h3l11.5 11.5" /><path d="M13 19l6-6M16 16l4 4" /><path d="M9.5 17.5 21 6V3h-3L6.5 14.5" /><path d="M11 19l-6-6M8 16l-4 4" /></>,
  boolean: <><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></>,

  // ── Chrome / misc ─────────────────────────────────────────────────────────
  sun:     <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2 12h2M20 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5" /></>,
  moon:    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  help:    <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
  chevronDown:  <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  plus:    <path d="M12 5v14M5 12h14" />,
  close:   <path d="M18 6 6 18M6 6l12 12" />,
  search:  <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  home:    <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.4V21h14V9.4" /></>,
}

export default function Icon({ name, size = '1em', className = '', strokeWidth = 1.75, style, title, ...rest }) {
  const glyph = PATHS[name]
  if (!glyph) return null
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  )
}

// Named export of the available icon keys — handy for tooling / sanity checks.
export const ICON_NAMES = Object.keys(PATHS)
