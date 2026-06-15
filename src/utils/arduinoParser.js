// Lexer + recursive-descent parser + JS code-generator for Arduino C++ subset.
// Replaces the regex-based transpiler in SimulationManager.

// ── Token types ───────────────────────────────────────────────────────────────

const TT = { NUM:'NUM', STR:'STR', CHAR:'CHAR', IDENT:'IDENT', KW:'KW', OP:'OP', PUNCT:'PUNCT', PP:'PP', EOF:'EOF' }

const KEYWORDS = new Set([
  'void','int','float','double','bool','boolean','char','byte',
  'long','short','unsigned','signed','const','static','String','auto',
  'if','else','while','for','do','return','break','continue',
  'switch','case','default','true','false','null','NULL',
  'struct','typedef','sizeof','new','delete',
  'HIGH','LOW','INPUT','OUTPUT','INPUT_PULLUP',
])

const C_TYPES = new Set([
  'void','int','float','double','bool','boolean','char','byte',
  'long','short','unsigned','signed','String','auto',
])

const ESC = { n:'\n', t:'\t', r:'\r', '\\':'\\', '"':'"', "'":"'", '0':'\0' }

// ── Lexer ─────────────────────────────────────────────────────────────────────

function lex(src) {
  const toks = []
  let i = 0, line = 1

  while (i < src.length) {
    const c = src[i]

    if (c === '\r') { i++; continue }
    if (c === '\n') { line++; i++; continue }
    if (c === ' ' || c === '\t') { i++; continue }

    // Comments
    if (c === '/' && src[i+1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i+1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i+1] === '/')) {
        if (src[i] === '\n') line++; i++
      }
      i += 2; continue
    }

    // Preprocessor
    if (c === '#') {
      const s = i
      while (i < src.length && src[i] !== '\n') i++
      toks.push({ t: TT.PP, v: src.slice(s, i).trimEnd(), line })
      continue
    }

    // String
    if (c === '"') {
      i++; let s = ''
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') { i++; s += ESC[src[i]] ?? src[i] } else s += src[i]
        i++
      }
      i++
      toks.push({ t: TT.STR, v: s, line }); continue
    }

    // Char literal
    if (c === "'") {
      i++
      let ch = src[i]
      if (ch === '\\') { i++; ch = ESC[src[i]] ?? src[i] }
      i++; i++ // char + closing '
      toks.push({ t: TT.CHAR, v: ch.charCodeAt(0), line }); continue
    }

    // Number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i+1] ?? ''))) {
      let s = ''
      if (c === '0' && /[xX]/.test(src[i+1] ?? '')) {
        s = '0x'; i += 2
        while (/[0-9a-fA-F_]/.test(src[i] ?? '')) { if (src[i] !== '_') s += src[i]; i++ }
      } else if (c === '0' && /[bB]/.test(src[i+1] ?? '')) {
        s = '0b'; i += 2
        while (/[01_]/.test(src[i] ?? '')) { if (src[i] !== '_') s += src[i]; i++ }
      } else {
        while (/[0-9]/.test(src[i] ?? '')) s += src[i++]
        if (src[i] === '.') { s += src[i++]; while (/[0-9]/.test(src[i] ?? '')) s += src[i++] }
        if (/[eE]/.test(src[i] ?? '')) {
          s += src[i++]
          if (/[+-]/.test(src[i] ?? '')) s += src[i++]
          while (/[0-9]/.test(src[i] ?? '')) s += src[i++]
        }
      }
      while (/[uUlLfF]/.test(src[i] ?? '')) i++
      toks.push({ t: TT.NUM, v: s, line }); continue
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(c)) {
      let s = ''
      while (/[a-zA-Z0-9_]/.test(src[i] ?? '')) s += src[i++]
      toks.push({ t: KEYWORDS.has(s) ? TT.KW : TT.IDENT, v: s, line }); continue
    }

    // Operators (longest match first)
    const OPS3 = ['<<=', '>>=']
    const OPS2 = ['==','!=','<=','>=','&&','||','++','--','+=','-=','*=','/=','%=','&=','|=','^=','<<','>>','->','::']
    let found = false
    for (const op of OPS3) if (src.startsWith(op, i)) { toks.push({ t:TT.OP, v:op, line }); i+=3; found=true; break }
    if (!found) for (const op of OPS2) if (src.startsWith(op, i)) { toks.push({ t:TT.OP, v:op, line }); i+=2; found=true; break }
    if (!found && '+-*/%=<>!&|^~?:'.includes(c)) { toks.push({ t:TT.OP, v:c, line }); i++; found=true }
    if (!found && ';,()[]{}. '.includes(c)) {
      if (c !== ' ') toks.push({ t:TT.PUNCT, v:c, line })
      i++
    } else if (!found) i++
  }

  toks.push({ t: TT.EOF, v: '', line })
  return toks
}

// ── Token stream ──────────────────────────────────────────────────────────────

class TS {
  constructor(toks) { this.toks = toks; this.p = 0 }
  peek(n = 0) { return this.toks[Math.min(this.p + n, this.toks.length - 1)] }
  next()      { const t = this.toks[this.p]; if (this.p < this.toks.length - 1) this.p++; return t }
  eof()       { return this.peek().t === TT.EOF }

  expect(t, v) {
    const tok = this.next()
    if (tok.t !== t || (v !== undefined && tok.v !== v))
      throw new SyntaxError(`Line ${tok.line}: expected '${v ?? t}' got '${tok.v}'`)
    return tok
  }
  match(t, v)  { const tk = this.peek(); if (tk.t === t && (v === undefined || tk.v === v)) { this.p++; return tk } return null }
  matchKw(v)   { return this.match(TT.KW, v) }
  matchOp(v)   { return this.match(TT.OP, v) }
  matchP(v)    { return this.match(TT.PUNCT, v) }
  isKw(v, n=0) { const tk = this.peek(n); return tk.t === TT.KW && tk.v === v }
  isOp(v, n=0) { const tk = this.peek(n); return tk.t === TT.OP && tk.v === v }
  isP(v, n=0)  { const tk = this.peek(n); return tk.t === TT.PUNCT && tk.v === v }
}

// ── Type helpers ──────────────────────────────────────────────────────────────

function isTypeTok(ts, n = 0) {
  const tk = ts.peek(n)
  if (tk.t === TT.KW) return C_TYPES.has(tk.v) || tk.v === 'const' || tk.v === 'static' || tk.v === 'unsigned' || tk.v === 'signed'
  return false
}

function isTypeStart(ts) {
  if (isTypeTok(ts)) return true
  // user typedef: IDENT followed by another IDENT or [ or *
  if (ts.peek().t === TT.IDENT) {
    const nxt = ts.peek(1)
    return nxt.t === TT.IDENT || (nxt.t === TT.OP && nxt.v === '*')
  }
  return false
}

function parseTypeSpec(ts) {
  const parts = []
  ts.matchKw('static')
  if (ts.isKw('const')) { parts.push('const'); ts.next() }
  while (ts.isKw('unsigned') || ts.isKw('signed')) parts.push(ts.next().v)
  const bt = ts.peek()
  if ((bt.t === TT.KW && (C_TYPES.has(bt.v) || bt.v === 'void')) || bt.t === TT.IDENT)
    parts.push(ts.next().v)
  while (ts.isOp('*') || ts.isOp('&')) ts.next()
  return parts.join(' ')
}

// ── Parser ────────────────────────────────────────────────────────────────────

class Parser {
  constructor(src) {
    this.ts        = new TS(lex(src))
    this.userFuncs = new Set()
    this._preScan()
  }

  // Collect all user function names before full parse (for await injection)
  _preScan() {
    for (let i = 0; i < this.ts.toks.length - 2; i++) {
      const a = this.ts.toks[i], b = this.ts.toks[i+1], c = this.ts.toks[i+2]
      if (b.t === TT.IDENT && c.t === TT.PUNCT && c.v === '(' &&
          ((a.t === TT.KW && (C_TYPES.has(a.v) || a.v === 'void')) || a.t === TT.IDENT))
        this.userFuncs.add(b.v)
    }
  }

  parse() {
    const body = []
    while (!this.ts.eof()) {
      if (this.ts.matchP(';')) continue
      const n = this.parseTopLevel()
      if (n) body.push(n)
    }
    return { type: 'Program', body }
  }

  parseTopLevel() {
    const tk = this.ts.peek()
    if (tk.t === TT.PP) return this.parsePP()
    if (this.ts.isKw('struct') || this.ts.isKw('typedef')) { this._skipBraced(); return null }
    if (isTypeStart(this.ts)) return this.parseDeclOrFn()
    return this.parseExprStmt()
  }

  parsePP() {
    const { v } = this.ts.next()
    const m = v.match(/^#\s*define\s+(\w+)(?:\s+(.+))?$/)
    if (m && !m[1].includes('(')) return { type:'Define', name:m[1], value:(m[2]||'').trim() }
    const ifdef = v.match(/^#\s*(ifdef|ifndef|if|else|elif|endif|pragma)\b/)
    if (ifdef) return { type:'PP', dir:ifdef[1], raw:v }
    return null
  }

  parseDeclOrFn() {
    const typeStr = parseTypeSpec(this.ts)
    const nameTk  = this.ts.next()
    const name    = nameTk.v
    if (this.ts.isP('(')) return this.parseFnAfterName(typeStr, name)
    return this.parseVarListAfterName(typeStr, name, false)
  }

  parseFnAfterName(retType, name) {
    this.ts.expect(TT.PUNCT, '(')
    const params = this.parseParams()
    this.ts.expect(TT.PUNCT, ')')
    if (this.ts.isP('{')) {
      const body = this.parseBlock()
      return { type:'FnDecl', retType, name, params, body }
    }
    this.ts.matchP(';')
    return null // prototype
  }

  parseParams() {
    const ps = []
    if (this.ts.isP(')')) return ps
    if (this.ts.isKw('void') && this.ts.isP(')', 1)) { this.ts.next(); return ps }
    do {
      if (this.ts.isP(')')) break
      const pt = parseTypeSpec(this.ts)
      let pn = ''
      if (this.ts.peek().t === TT.IDENT || this.ts.peek().t === TT.KW) pn = this.ts.next().v
      let arr = false
      if (this.ts.matchP('[')) { this.ts.matchP(']'); arr = true }
      ps.push({ pt, pn, arr })
    } while (this.ts.matchP(','))
    return ps
  }

  parseVarListAfterName(typeStr, name, inForInit) {
    const isConst = typeStr.includes('const')
    const decls   = [this._varSuffix(typeStr, name, isConst)]
    while (this.ts.matchP(',')) {
      const nm = this.ts.next().v
      decls.push(this._varSuffix(typeStr, nm, isConst))
    }
    if (!inForInit) this.ts.matchP(';')
    return { type:'VarList', decls }
  }

  _varSuffix(typeStr, name, isConst) {
    if (this.ts.matchP('[')) {
      let sz = null, sz2 = null
      if (!this.ts.isP(']')) sz = this.parseExpr()
      this.ts.expect(TT.PUNCT, ']')
      if (this.ts.matchP('[')) { if (!this.ts.isP(']')) sz2 = this.parseExpr(); this.ts.expect(TT.PUNCT, ']') }
      let init = null
      if (this.ts.matchOp('=')) init = this.ts.isP('{') ? this.parseArrInit() : this.parseExpr()
      return { type:'VarDecl', vt:typeStr, name, isConst, isArr:true, sz, sz2, init }
    }
    let init = null
    if (this.ts.matchOp('=')) init = this.ts.isP('{') ? this.parseArrInit() : this.parseAssign()
    return { type:'VarDecl', vt:typeStr, name, isConst, isArr:false, init }
  }

  parseArrInit() {
    this.ts.expect(TT.PUNCT, '{')
    const els = []
    while (!this.ts.isP('}') && !this.ts.eof()) {
      if (this.ts.isP('}')) break
      els.push(this.parseAssign())
      if (!this.ts.matchP(',')) break
    }
    this.ts.expect(TT.PUNCT, '}')
    return { type:'ArrInit', els }
  }

  _skipBraced() {
    let d = 0
    while (!this.ts.eof()) {
      const t = this.ts.next()
      if (t.t === TT.PUNCT && t.v === '{') d++
      if (t.t === TT.PUNCT && t.v === '}') { d--; if (d <= 0) { this.ts.matchP(';'); return } }
      if (d === 0 && t.t === TT.PUNCT && t.v === ';') return
    }
  }

  // ── Statements ────────────────────────────────────────────────────────────────

  parseBlock() {
    this.ts.expect(TT.PUNCT, '{')
    const body = []
    while (!this.ts.isP('}') && !this.ts.eof()) {
      if (this.ts.matchP(';')) continue
      const n = this.parseStmt()
      if (n) body.push(n)
    }
    this.ts.expect(TT.PUNCT, '}')
    return { type:'Block', body }
  }

  parseStmt() {
    const tk = this.ts.peek()
    if (tk.t === TT.PP) { const n = this.parsePP(); return n || { type:'Empty' } }
    if (this.ts.isP('{')) return this.parseBlock()

    if (tk.t === TT.KW) {
      switch (tk.v) {
        case 'if':       return this.parseIf()
        case 'while':    return this.parseWhile()
        case 'for':      return this.parseFor()
        case 'do':       return this.parseDo()
        case 'switch':   return this.parseSwitch()
        case 'return':   return this.parseReturn()
        case 'break':    this.ts.next(); this.ts.matchP(';'); return { type:'Break' }
        case 'continue': this.ts.next(); this.ts.matchP(';'); return { type:'Continue' }
      }
    }

    if (isTypeStart(this.ts)) {
      const typeStr = parseTypeSpec(this.ts)
      const nm = this.ts.next().v
      if (this.ts.isP('(')) return this.parseFnAfterName(typeStr, nm)
      return this.parseVarListAfterName(typeStr, nm, false)
    }

    return this.parseExprStmt()
  }

  parseBlockOrStmt() {
    return this.ts.isP('{') ? this.parseBlock() : this.parseStmt()
  }

  parseIf() {
    this.ts.expect(TT.KW, 'if')
    this.ts.expect(TT.PUNCT, '(')
    const test = this.parseExpr()
    this.ts.expect(TT.PUNCT, ')')
    const cons = this.parseBlockOrStmt()
    let alt = null
    if (this.ts.matchKw('else')) alt = this.parseBlockOrStmt()
    return { type:'If', test, cons, alt }
  }

  parseWhile() {
    this.ts.expect(TT.KW, 'while')
    this.ts.expect(TT.PUNCT, '(')
    const test = this.parseExpr()
    this.ts.expect(TT.PUNCT, ')')
    return { type:'While', test, body: this.parseBlockOrStmt() }
  }

  parseFor() {
    this.ts.expect(TT.KW, 'for')
    this.ts.expect(TT.PUNCT, '(')
    let init = null
    if (!this.ts.isP(';')) {
      if (isTypeStart(this.ts)) {
        const typeStr = parseTypeSpec(this.ts)
        const nm = this.ts.next().v
        init = this.parseVarListAfterName(typeStr, nm, true)  // no semicolon consumed
        this.ts.matchP(';')
      } else {
        init = { type:'ExprStmt', expr: this.parseExpr() }
        this.ts.matchP(';')
      }
    } else { this.ts.next() }

    let test = null
    if (!this.ts.isP(';')) test = this.parseExpr()
    this.ts.matchP(';')
    let upd = null
    if (!this.ts.isP(')')) upd = this.parseExpr()
    this.ts.expect(TT.PUNCT, ')')
    return { type:'For', init, test, upd, body: this.parseBlockOrStmt() }
  }

  parseDo() {
    this.ts.expect(TT.KW, 'do')
    const body = this.parseBlockOrStmt()
    this.ts.expect(TT.KW, 'while')
    this.ts.expect(TT.PUNCT, '(')
    const test = this.parseExpr()
    this.ts.expect(TT.PUNCT, ')')
    this.ts.matchP(';')
    return { type:'DoWhile', body, test }
  }

  parseSwitch() {
    this.ts.expect(TT.KW, 'switch')
    this.ts.expect(TT.PUNCT, '(')
    const disc = this.parseExpr()
    this.ts.expect(TT.PUNCT, ')')
    this.ts.expect(TT.PUNCT, '{')
    const cases = []
    while (!this.ts.isP('}') && !this.ts.eof()) {
      if (this.ts.matchKw('case')) {
        const val = this.parseExpr(); this.ts.expect(TT.PUNCT, ':')
        const body = this._casebody()
        cases.push({ val, body })
      } else if (this.ts.matchKw('default')) {
        this.ts.expect(TT.PUNCT, ':')
        cases.push({ val: null, body: this._casebody() })
      } else this.ts.next()
    }
    this.ts.expect(TT.PUNCT, '}')
    return { type:'Switch', disc, cases }
  }

  _casebody() {
    const body = []
    while (!this.ts.isKw('case') && !this.ts.isKw('default') && !this.ts.isP('}') && !this.ts.eof()) {
      if (this.ts.matchP(';')) continue
      const n = this.parseStmt(); if (n) body.push(n)
    }
    return body
  }

  parseReturn() {
    this.ts.expect(TT.KW, 'return')
    let val = null
    if (!this.ts.isP(';')) val = this.parseExpr()
    this.ts.matchP(';')
    return { type:'Return', val }
  }

  parseExprStmt() {
    const expr = this.parseExpr()
    this.ts.matchP(';')
    return { type:'ExprStmt', expr }
  }

  // ── Expressions ───────────────────────────────────────────────────────────────

  parseExpr()    { return this.parseAssign() }

  parseAssign() {
    const left = this.parseTernary()
    const ASGN = ['=','+=','-=','*=','/=','%=','&=','|=','^=','<<=','>>=']
    if (this.ts.peek().t === TT.OP && ASGN.includes(this.ts.peek().v)) {
      const op = this.ts.next().v
      return { type:'Assign', op, left, right: this.parseAssign() }
    }
    return left
  }

  parseTernary() {
    const c = this.parseOr()
    if (this.ts.matchOp('?')) {
      const t = this.parseExpr(); this.ts.expect(TT.OP, ':'); const e = this.parseExpr()
      return { type:'Ternary', c, t, e }
    }
    return c
  }

  parseOr()    { return this._bin(this.parseAnd.bind(this),    ['||']) }
  parseAnd()   { return this._bin(this.parseBOr.bind(this),    ['&&']) }
  parseBOr()   { return this._bin(this.parseBXor.bind(this),   ['|']) }
  parseBXor()  { return this._bin(this.parseBAnd.bind(this),   ['^']) }
  parseBAnd()  { return this._bin(this.parseEq.bind(this),     ['&']) }
  parseEq()    { return this._bin(this.parseRel.bind(this),    ['==','!=']) }
  parseRel()   { return this._bin(this.parseShift.bind(this),  ['<','>','<=','>=']) }
  parseShift() { return this._bin(this.parseAdd.bind(this),    ['<<','>>']) }
  parseAdd()   { return this._bin(this.parseMul.bind(this),    ['+','-']) }
  parseMul()   { return this._bin(this.parseUnary.bind(this),  ['*','/','%']) }

  _bin(next, ops) {
    let l = next()
    while (this.ts.peek().t === TT.OP && ops.includes(this.ts.peek().v)) {
      const op = this.ts.next().v; l = { type:'Binary', op, l, r: next() }
    }
    return l
  }

  parseUnary() {
    if (this.ts.peek().t === TT.OP && ['!','~','-','+','++','--'].includes(this.ts.peek().v)) {
      const op = this.ts.next().v
      return { type:'Unary', op, pre: true, arg: this.parseUnary() }
    }
    if (this.ts.isP('(') && this._isCast()) {
      this.ts.next()
      const ct = parseTypeSpec(this.ts)
      if (this.ts.matchP('[')) this.ts.matchP(']')
      this.ts.expect(TT.PUNCT, ')')
      return { type:'Cast', ct, arg: this.parseUnary() }
    }
    return this.parsePostfix()
  }

  _isCast() {
    const n = this.ts.peek(1)
    return (n.t === TT.KW && (C_TYPES.has(n.v) || n.v === 'unsigned' || n.v === 'signed'))
  }

  parsePostfix() {
    let e = this.parsePrimary()
    while (true) {
      if (this.ts.matchP('[')) {
        const i = this.parseExpr(); this.ts.expect(TT.PUNCT, ']')
        e = { type:'Index', obj:e, idx:i }
      } else if (this.ts.matchP('(')) {
        const args = this._args(); this.ts.expect(TT.PUNCT, ')')
        e = { type:'Call', callee:e, args }
      } else if (this.ts.matchP('.') || this.ts.matchOp('->')) {
        const prop = this.ts.next().v; e = { type:'Member', obj:e, prop }
      } else if (this.ts.peek().t === TT.OP && (this.ts.peek().v === '++' || this.ts.peek().v === '--')) {
        const op = this.ts.next().v; e = { type:'Unary', op, pre:false, arg:e }
      } else break
    }
    return e
  }

  _args() {
    const args = []
    if (this.ts.isP(')')) return args
    do { if (this.ts.isP(')')) break; args.push(this.parseAssign()) } while (this.ts.matchP(','))
    return args
  }

  parsePrimary() {
    const tk = this.ts.peek()

    if (this.ts.matchP('(')) {
      const e = this.parseExpr(); this.ts.expect(TT.PUNCT, ')'); return { type:'Paren', e }
    }
    if (this.ts.isP('{')) return this.parseArrInit()
    if (tk.t === TT.NUM) { this.ts.next(); return { type:'Num', v:tk.v } }
    if (tk.t === TT.STR) { this.ts.next(); return { type:'Str', v:tk.v } }
    if (tk.t === TT.CHAR) { this.ts.next(); return { type:'Char', v:tk.v } }
    if (tk.t === TT.KW && tk.v === 'true')  { this.ts.next(); return { type:'Bool', v:true } }
    if (tk.t === TT.KW && tk.v === 'false') { this.ts.next(); return { type:'Bool', v:false } }
    if (tk.t === TT.KW && (tk.v === 'null' || tk.v === 'NULL')) { this.ts.next(); return { type:'Null' } }
    if (tk.t === TT.KW && tk.v === 'sizeof') {
      this.ts.next()
      if (this.ts.matchP('(')) { let d=1; while(!this.ts.eof()){ const t=this.ts.next(); if(t.v==='(')d++; if(t.v===')')if(--d===0)break } }
      return { type:'Num', v:'1' }
    }

    if (tk.t === TT.IDENT || (tk.t === TT.KW && !['if','else','while','for','do','return','break','continue','switch','case','default','void'].includes(tk.v))) {
      this.ts.next(); return { type:'Ident', name:tk.v }
    }
    this.ts.next(); return { type:'Num', v:'0' }
  }
}

// ── Code generator ────────────────────────────────────────────────────────────

const ASYNC_BUILTINS = new Set(['delay','delayMicroseconds'])

const CASTS = {
  'int':'Math.trunc', 'long':'Math.trunc', 'short':'Math.trunc',
  'byte':'(v=>v&0xFF)', 'unsigned long':'(v=>v>>>0)', 'unsigned int':'(v=>v>>>0)',
  'float':'Number', 'double':'Number',
  'char':'String.fromCharCode', 'bool':'Boolean', 'boolean':'Boolean',
}

class Gen {
  constructor(userFuncs, skipDefines) { this.uf = userFuncs; this.skip = skipDefines || new Set(); this.ind = 0; this.out = [] }
  I()   { return '  '.repeat(this.ind) }
  w(s)  { this.out.push(s) }
  get() { return this.out.join('') }

  gen(n) {
    if (!n) return
    switch (n.type) {
      case 'Program':  for (const s of n.body) if (s) this.gen(s); return
      case 'Define':   return this.gDefine(n)
      case 'PP':       return this.gPP(n)
      case 'FnDecl':   return this.gFn(n)
      case 'VarList':  for (const d of n.decls) this.gVar(d); return
      case 'Block':    return this.gBlock(n)
      case 'ExprStmt': { const s = this.gExpr(n.expr); if (s) this.w(`${this.I()}${s};\n`); return }
      case 'If':       return this.gIf(n)
      case 'While':    this.w(`${this.I()}while (${this.gExpr(n.test)}) `); this.gBS(n.body); return
      case 'For':      return this.gFor(n)
      case 'DoWhile':  this.w(`${this.I()}do `); this.gBS(n.body); this.w(`${this.I()}while (${this.gExpr(n.test)});\n`); return
      case 'Switch':   return this.gSwitch(n)
      case 'Return':   this.w(`${this.I()}return${n.val ? ' '+this.gExpr(n.val) : ''};\n`); return
      case 'Break':    this.w(`${this.I()}break;\n`); return
      case 'Continue': this.w(`${this.I()}continue;\n`); return
      case 'Empty':    return
    }
  }

  gDefine(n) {
    if (this.skip.has(n.name)) return
    const v = n.value
    if (!v || v.includes('(')) return
    const jv = /^-?[0-9.]+$/.test(v) ? v : /^"/.test(v) ? v : JSON.stringify(v)
    this.w(`${this.I()}const ${n.name} = ${jv};\n`)
  }

  gPP(n) {
    // Pass through #if/#ifdef/#ifndef/#else/#elif/#endif as JS comments
    // (they can't be executed, but their content might be important context)
    // For safety, wrap in /* */ so the JS doesn't break
    const d = n.dir
    if (d === 'endif' || d === 'else') { /* ignore */ }
    // Nothing to emit — just swallow
  }

  gFn(n) {
    const ps = n.params.map(p => p.pn || '_p').join(', ')
    this.w(`${this.I()}async function ${n.name}(${ps}) {\n`)
    this.ind++
    for (const s of n.body.body) if (s) this.gen(s)
    this.ind--
    this.w(`${this.I()}}\n`)
  }

  gVar(d) {
    const kw = (d.isConst && !d.isArr) ? 'const' : 'let'
    if (d.isArr) {
      let iv
      if (d.init?.type === 'ArrInit') {
        iv = `[${d.init.els.map(e => this.gExpr(e)).join(', ')}]`
      } else if (d.sz) {
        const sz = this.gExpr(d.sz)
        const fill = (d.vt.includes('float')||d.vt.includes('double')) ? '0.0' : d.vt.includes('String') ? '""' : '0'
        iv = d.sz2
          ? `Array.from({length:${sz}},()=>new Array(${this.gExpr(d.sz2)}).fill(${fill}))`
          : `new Array(${sz}).fill(${fill})`
      } else { iv = '[]' }
      this.w(`${this.I()}${kw} ${d.name} = ${iv};\n`)
    } else {
      let iv = d.init !== null ? ` = ${this.gExpr(d.init)}` : this._defInit(d.vt)
      this.w(`${this.I()}${kw} ${d.name}${iv};\n`)
    }
  }

  _defInit(vt) {
    if (vt.includes('float')||vt.includes('double')) return ' = 0.0'
    if (vt.includes('String')) return ' = ""'
    if (vt.includes('bool')||vt.includes('boolean')) return ' = false'
    // PascalCase types are Arduino library classes (Servo, Wire, LiquidCrystal, etc.)
    // — construct with new so `Servo myServo;` → `let myServo = new Servo()`
    const base = vt.trim()
    if (/^[A-Z]/.test(base) && !['HIGH','LOW','OUTPUT','INPUT'].includes(base))
      return ` = new ${base}()`
    return ' = 0'
  }

  gBlock(n, inline=false) {
    if (!inline) { this.w(`${this.I()}{\n`); this.ind++ }
    for (const s of n.body) if (s) this.gen(s)
    if (!inline) { this.ind--; this.w(`${this.I()}}\n`) }
  }

  gBS(n) {
    if (n.type === 'Block') {
      this.w('{\n'); this.ind++
      for (const s of n.body) if (s) this.gen(s)
      this.ind--; this.w(`${this.I()}}\n`)
    } else { this.w('\n'); this.ind++; this.gen(n); this.ind-- }
  }

  gIf(n) {
    this.w(`${this.I()}if (${this.gExpr(n.test)}) `)
    this.gBS(n.cons)
    if (n.alt) { this.w(`${this.I()}else `); this.gBS(n.alt) }
  }

  gFor(n) {
    let init = ''
    if (n.init) {
      if (n.init.type === 'VarList') {
        const kw = n.init.decls[0].isConst ? 'const' : 'let'
        init = kw + ' ' + n.init.decls.map(d => {
          return `${d.name}${d.init !== null ? ' = '+this.gExpr(d.init) : ' = 0'}`
        }).join(', ')
      } else if (n.init.type === 'ExprStmt') {
        init = this.gExpr(n.init.expr)
      }
    }
    const test = n.test ? this.gExpr(n.test) : ''
    const upd  = n.upd  ? this.gExpr(n.upd)  : ''
    this.w(`${this.I()}for (${init}; ${test}; ${upd}) `)
    this.gBS(n.body)
  }

  gSwitch(n) {
    this.w(`${this.I()}switch (${this.gExpr(n.disc)}) {\n`)
    this.ind++
    for (const c of n.cases) {
      this.w(c.val !== null ? `${this.I()}case ${this.gExpr(c.val)}:\n` : `${this.I()}default:\n`)
      this.ind++; for (const s of c.body) if (s) this.gen(s); this.ind--
    }
    this.ind--; this.w(`${this.I()}}\n`)
  }

  gExpr(n) {
    if (!n) return '0'
    switch (n.type) {
      case 'Num':    return String(n.v)
      case 'Str':    return JSON.stringify(n.v)
      case 'Char':   return String(n.v)
      case 'Bool':   return String(n.v)
      case 'Null':   return 'null'
      case 'Ident':  return n.name
      case 'Paren':  return `(${this.gExpr(n.e)})`
      case 'ArrInit':return `[${n.els.map(e=>this.gExpr(e)).join(', ')}]`

      case 'Binary': return `${this.gExpr(n.l)} ${n.op} ${this.gExpr(n.r)}`
      case 'Assign': return `${this.gExpr(n.left)} ${n.op} ${this.gExpr(n.right)}`
      case 'Ternary':return `(${this.gExpr(n.c)} ? ${this.gExpr(n.t)} : ${this.gExpr(n.e)})`
      case 'Unary':  return n.pre ? `${n.op}${this.gExpr(n.arg)}` : `${this.gExpr(n.arg)}${n.op}`

      case 'Index':  return `${this.gExpr(n.obj)}[${this.gExpr(n.idx)}]`
      case 'Member': return `${this.gExpr(n.obj)}.${n.prop}`

      case 'Cast': {
        const fn = CASTS[n.ct]
        return fn ? `${fn}(${this.gExpr(n.arg)})` : `(${this.gExpr(n.arg)})`
      }

      case 'Call': {
        const args = n.args.map(a => this.gExpr(a)).join(', ')
        // Determine callee name for await injection
        let cname = null
        if (n.callee.type === 'Ident')  cname = n.callee.name
        if (n.callee.type === 'Member') cname = n.callee.prop
        const isAsync = ASYNC_BUILTINS.has(cname) || (cname && this.uf.has(cname))
        const callee  = this.gExpr(n.callee)
        return `${isAsync ? 'await ' : ''}${callee}(${args})`
      }

      default: return '0'
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function parseAndTranspile(src, skipDefines) {
  try {
    const parser = new Parser(src)
    const ast    = parser.parse()
    const cg     = new Gen(parser.userFuncs, skipDefines)
    cg.gen(ast)
    return { code: cg.get(), error: null }
  } catch (e) {
    return { code: null, error: e.message }
  }
}
