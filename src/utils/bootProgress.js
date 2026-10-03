// Boot stages for the startup overlay. The editor mounts immediately; this only
// tracks how far the P0 path (React → renderer → first frame) has got, so the
// overlay can show real progress and get out of the way as soon as the
// workspace is usable. Optional systems never report here — they load later.
const STAGES = ['core', 'renderer', 'workspace']
const state = { core: false, renderer: false, workspace: false, times: {} }
const listeners = new Set()

export const bootProgress = {
  STAGES,
  mark(stage) {
    if (state[stage]) return
    state[stage] = true
    state.times[stage] = Math.round(typeof performance !== 'undefined' ? performance.now() : 0)
    for (const fn of listeners) { try { fn({ ...state }) } catch { /* ignore */ } }
  },
  get() { return { ...state } },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
}
