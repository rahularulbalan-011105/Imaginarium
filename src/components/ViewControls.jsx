import { memo, useState } from 'react'
import { useSceneStore, selectedIdsOf } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import Icon from './ui/Icon.jsx'

// Tinkercad's view buttons, stacked on the left edge of the 3D view:
// Home · Fit · Zoom in · Zoom out · Perspective / Flat.
function ViewControls() {
  const simActive = useUiStore((s) => s.simActive)
  const [flat, setFlat] = useState(() => sceneManager.isFlatView)
  if (simActive) return null

  const fit = () => {
    const ids = selectedIdsOf(useSceneStore.getState())
    const meshes = ids.map((id) => objectManager.getMesh(id)).filter(Boolean)
    sceneManager.fitAll(meshes.length ? meshes : null)
  }
  const B = ({ icon, title, onClick, active }) => (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={active ? true : undefined} className="ui-tool">
      <Icon name={icon} size={17} />
    </button>
  )
  return (
    <div role="toolbar" aria-label="View" aria-orientation="vertical"
      className="absolute z-20 left-3 top-[112px] flex flex-col gap-0.5 p-1 rounded-lg pointer-events-auto"
      style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 1px 3px rgb(0 0 0 / 0.08)' }}>
      <B icon="home" title="Home view" onClick={() => sceneManager.resetCamera()} />
      <B icon="fit" title="Fit: show the selection, or everything (F)" onClick={fit} />
      <B icon="zoomIn" title="Zoom in (scroll)" onClick={() => sceneManager.zoomBy(0.8)} />
      <B icon="zoomOut" title="Zoom out (scroll)" onClick={() => sceneManager.zoomBy(1.25)} />
      <span className="h-px mx-1.5 my-0.5" style={{ background: 'rgb(var(--g-700))' }} aria-hidden="true" />
      <B icon={flat ? 'flat' : 'persp'} active={flat}
        title={flat ? 'Flat view: on (sizes read true). Click for perspective.' : 'Perspective view. Click for a flat view where sizes read true.'}
        onClick={() => { sceneManager.setFlatView(!flat); setFlat(!flat) }} />
    </div>
  )
}

export default memo(ViewControls)
