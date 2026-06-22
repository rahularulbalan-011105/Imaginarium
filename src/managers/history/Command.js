// Command-pattern primitives for the Undo/Redo system.
//
//   Command          — base: do() applies/re-applies, undo() reverts.
//   CompositeCommand — a transaction: many child commands committed as ONE
//                      undo step; undo runs children in reverse order.
//   SnapshotCommand  — restores whole canonical document slices to a captured
//                      before/after state. Used by the legacy snapshot() bridge
//                      and as the fallback for operations not yet migrated to
//                      fine-grained commands. Memory-heavier, so prefer scoped
//                      commands where it matters (per the hybrid design).

let _seq = 0
const nextId = () => `cmd_${++_seq}`

export class Command {
  constructor(label = 'edit') {
    this.id = nextId()
    this.label = label
  }
  do() {}            // apply / re-apply the change
  undo() {}          // revert the change
  redo() { this.do() } // defaults to do(); override only if redo differs
}

export class CompositeCommand extends Command {
  constructor(label = 'group', children = []) {
    super(label)
    this.children = children
  }
  add(cmd) { this.children.push(cmd); return this }
  get isEmpty() { return this.children.length === 0 }
  do()   { for (const c of this.children) c.do() }
  redo() { for (const c of this.children) c.redo() }
  undo() { for (let i = this.children.length - 1; i >= 0; i--) this.children[i].undo() }
}

export class SnapshotCommand extends Command {
  // `restore(state)` writes a captured canonical snapshot back into the stores.
  constructor(before, after, restore, label = 'edit') {
    super(label)
    this.before   = before
    this.after    = after
    this._restore = restore
  }
  do()   { this._restore(this.after) }
  redo() { this._restore(this.after) }
  undo() { this._restore(this.before) }
}
