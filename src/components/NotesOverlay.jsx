import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useSceneStore } from '../stores/sceneStore.js'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'

// ─────────────────────────────────────────────────────────────────────────────
// Notes (Tinkercad 3D Design tool): each `note` object is a pin in the scene;
// this overlay draws its text as a label that follows the pin on screen. Select
// the pin (or click its label) to edit the text. Notes save with the project,
// are never printed and weigh nothing.
// ─────────────────────────────────────────────────────────────────────────────
export default function NotesOverlay() {
  // useShallow: a new array each call, but only re-render when the notes themselves change.
  const notes = useSceneStore(useShallow(s => s.objects.filter(o => o.type === 'note' && o.visible !== false)))
  const selectedId = useSceneStore(s => s.selectedId)
  const selectObject = useSceneStore(s => s.selectObject)
  const updateObject = useSceneStore(s => s.updateObject)
  const [pos, setPos] = useState({})
  const last = useRef('')

  useEffect(() => {
    if (!notes.length) { setPos({}); return }
    let raf
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const cam = sceneManager.camera, dom = sceneManager.renderer?.domElement
      if (!cam || !dom) return
      const W = dom.clientWidth, H = dom.clientHeight, out = {}
      for (const n of notes) {
        const mesh = objectManager.getMesh(n.id)
        if (!mesh) continue
        mesh.updateMatrixWorld(true)
        const p = new Vector3(0, 1.0, 0).applyMatrix4(mesh.matrixWorld).project(cam)
        if (p.z < -1 || p.z > 1) continue
        out[n.id] = [Math.round((p.x + 1) / 2 * W), Math.round((-p.y + 1) / 2 * H)]
      }
      const key = JSON.stringify(out)
      if (key !== last.current) { last.current = key; setPos(out) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [notes])

  if (!notes.length) return null
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none' }}>
      {notes.map(n => {
        const p = pos[n.id]
        if (!p) return null
        const editing = selectedId === n.id
        return (
          <div key={n.id} className="absolute -translate-x-1/2 -translate-y-full rounded-md shadow-md text-[11px] leading-snug"
            style={{ left: p[0], top: p[1], pointerEvents: 'auto', background: '#fef3c7', color: '#422006', border: editing ? '2px solid #f97316' : '1px solid #d97706', maxWidth: 220 }}
            onPointerDown={(e) => { e.stopPropagation(); if (!editing) selectObject(n.id) }}>
            {editing
              ? <textarea autoFocus value={n.noteText ?? ''} rows={3} maxLength={500} aria-label="Note text"
                  onChange={(e) => updateObject(n.id, { noteText: e.target.value })}
                  className="block w-52 bg-transparent outline-none resize-none px-2 py-1" />
              : <div className="px-2 py-1 whitespace-pre-wrap cursor-pointer">{n.noteText || 'Note'}</div>}
          </div>
        )
      })}
    </div>
  )
}
