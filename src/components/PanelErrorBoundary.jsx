import { Component } from 'react'
import { noteIfStale, isStaleBuildError, isStaleBuild } from '../utils/staleBuild.js'

// Contains a crashing panel so it can't take down the whole editor.
export default class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // A lazy panel whose chunk 404'd isn't broken — this tab just outlived the
    // build that shipped it. Raise the reload notice instead of a stack trace.
    // React.lazy retries a failed import and reports the SECOND failure as
    // "Cannot read properties of undefined (reading 'default')", so once any
    // chunk is known missing, stop attributing failures here to the panel.
    if (noteIfStale(error) || isStaleBuild()) return
    console.error('[PanelErrorBoundary]', error, info)
  }
  render() {
    if (this.state.error) {
      // StaleBuildNotice is already telling the user to reload; don't also
      // accuse the panel of crashing.
      if (isStaleBuildError(this.state.error) || isStaleBuild()) {
        return (
          <div className="p-4 text-xs" style={{ color: 'rgb(var(--g-400))' }}>
            {this.props.label ?? 'This panel'} needs the updated app — reload to open it.
          </div>
        )
      }
      return (
        <div className="p-4 text-xs text-red-300">
          <div className="font-semibold text-red-400 mb-1">{this.props.label ?? 'Panel'} crashed</div>
          <pre className="whitespace-pre-wrap break-words bg-red-950/40 border border-red-800/40 rounded p-2 text-[10px]">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-[10px]"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
