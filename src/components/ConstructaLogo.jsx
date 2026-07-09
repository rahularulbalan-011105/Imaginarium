import { useState } from 'react'

// Renders the Constructa wordmark from public/constructa-logo.png. Falls back to
// a styled text wordmark if the image isn't present yet, so the loading screen /
// Discord card never break. Path uses BASE_URL so it works under both the
// /Imaginarium/ project path and the custom-domain root.
export default function ConstructaLogo({ width = 180, style, className }) {
  const [err, setErr] = useState(false)
  const src = (import.meta.env.BASE_URL || '/') + 'constructa-logo.png'
  if (err) {
    return (
      <div className={className} style={{ fontWeight: 900, fontSize: Math.round(width * 0.17), letterSpacing: '-0.02em', color: '#ff7a18', fontFamily: 'system-ui, sans-serif', ...style }}>
        constructa
      </div>
    )
  }
  return (
    <img src={src} alt="Constructa" onError={() => setErr(true)} className={className}
      style={{ width, height: 'auto', display: 'block', ...style }} />
  )
}
