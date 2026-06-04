const MAX_SIZE = 50

class HistoryManager {
  constructor() {
    this.stack = []
    this.cursor = -1
  }

  push(snapshot) {
    this.stack = this.stack.slice(0, this.cursor + 1)
    this.stack.push(snapshot)
    if (this.stack.length > MAX_SIZE) this.stack.shift()
    else this.cursor++
  }

  undo() {
    if (!this.canUndo()) return null
    this.cursor--
    return JSON.parse(JSON.stringify(this.stack[this.cursor]))
  }

  redo() {
    if (!this.canRedo()) return null
    this.cursor++
    return JSON.parse(JSON.stringify(this.stack[this.cursor]))
  }

  canUndo() { return this.cursor > 0 }
  canRedo() { return this.cursor < this.stack.length - 1 }

  clear() {
    this.stack = []
    this.cursor = -1
  }
}

export const historyManager = new HistoryManager()
