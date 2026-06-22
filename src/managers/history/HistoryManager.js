import { CompositeCommand } from './Command.js'
import { useHistoryStore } from '../../stores/historyStore.js'

// Command-stack history manager (replaces the legacy snapshot stack and the dead
// CommandManager). Holds reversible Command objects, supports nestable
// transactions, and keeps a reactive mirror in historyStore for the debug panel.
//
// Operations reach this through editorDispatch (the single sanctioned facade);
// nothing should mutate the stacks directly.

const MAX = 1000   // cap; oldest entries are pruned beyond this

class HistoryManager {
  constructor() {
    this.undoStack = []
    this.redoStack = []
    this._txn = null       // open CompositeCommand while a transaction is active
    this._txnDepth = 0     // supports nested begin()/commit()
  }

  // Run a command and record it. Inside a transaction it's buffered into the
  // composite instead of pushed directly.
  execute(cmd) {
    cmd.do()
    this._record(cmd)
    return cmd
  }

  // Record a command whose effect has ALREADY been applied (no do()). Used by the
  // legacy snapshot() bridge, where the store mutation happened before recording.
  record(cmd) {
    this._record(cmd)
    return cmd
  }

  _record(cmd) {
    if (this._txn) { this._txn.add(cmd); return }
    this.undoStack.push(cmd)
    if (this.undoStack.length > MAX) this.undoStack.shift()
    this.redoStack.length = 0
    this._sync()
  }

  // ── Transactions ──────────────────────────────────────────────────────────
  begin(label = 'group') {
    this._txnDepth++
    if (!this._txn) this._txn = new CompositeCommand(label)
  }

  commit() {
    if (!this._txn) return
    this._txnDepth = Math.max(0, this._txnDepth - 1)
    if (this._txnDepth > 0) return         // wait for the outermost commit
    const txn = this._txn
    this._txn = null
    if (!txn.isEmpty) {
      this.undoStack.push(txn)
      if (this.undoStack.length > MAX) this.undoStack.shift()
      this.redoStack.length = 0
    }
    this._sync()
  }

  rollback() {
    if (!this._txn) return
    const txn = this._txn
    this._txn = null
    this._txnDepth = 0
    txn.undo()                              // revert whatever was applied so far
    this._sync()
  }

  // ── Undo / Redo ─────────────────────────────────────────────────────────────
  undo() {
    if (this._txn) this.commit()            // safety: never undo with an open txn
    const cmd = this.undoStack.pop()
    if (!cmd) return false
    cmd.undo()
    this.redoStack.push(cmd)
    this._sync()
    return true
  }

  redo() {
    const cmd = this.redoStack.pop()
    if (!cmd) return false
    cmd.redo()
    this.undoStack.push(cmd)
    this._sync()
    return true
  }

  canUndo() { return this.undoStack.length > 0 }
  canRedo() { return this.redoStack.length > 0 }

  clear() {
    this.undoStack = []
    this.redoStack = []
    this._txn = null
    this._txnDepth = 0
    this._sync()
  }

  _sync() {
    try {
      useHistoryStore.getState()._set({
        undo: this.undoStack.map(c => c.label),
        redo: this.redoStack.map(c => c.label).reverse(),
        open: this._txn ? this._txn.label : null,
      })
    } catch (_) { /* store not ready — ignore */ }
  }
}

export const history = new HistoryManager()
