// ─────────────────────────────────────────────────────────────────────────────
// arduinoDiagnostics — a compiler-style pre-flight analyzer for Arduino / SUBO
// sketches, producing Arduino-IDE / PlatformIO-quality diagnostics.
//
// This is ADDITIVE and side-effect free: it does NOT touch the real transpiler
// (arduinoParser) or the runtime (SimulationManager). CodeEditor / BlocksPanel
// call analyzeArduino() BEFORE running; if it returns blocking errors, execution
// is withheld and the errors are shown. A valid sketch returns zero errors, so it
// runs exactly as before — no behavioural change, no regressions.
//
// Design priority: PRECISION over recall. Every ERROR must be a real, unambiguous
// mistake — a currently-runnable sketch must never be flagged. Anything uncertain
// is a non-blocking WARNING instead.
//
// analyzeArduino(src, { board }) →
//   { ok, errors:[Diag], warnings:[Diag], stats:{ lines, functions, variables,
//     libraries, warnings, timeMs } }
// Diag = { severity:'error'|'warning', kind, line, col, endCol, len, file,
//          message, explain, suggestion, snippet, caret }
// ─────────────────────────────────────────────────────────────────────────────

const FILE = 'sketch.ino'

// ── Known symbol dictionaries ────────────────────────────────────────────────
// Arduino core functions → fixed arity (null = variadic / don't enforce count).
const CORE_FUNCS = {
  pinMode: 2, digitalWrite: 2, digitalRead: 1, analogWrite: 2, analogRead: 1,
  delay: 1, delayMicroseconds: 1, millis: 0, micros: 0,
  map: 5, constrain: 3, min: 2, max: 2, abs: 1, sq: 1, sqrt: 1, pow: 2,
  floor: 1, ceil: 1, round: 1, log: 1, exp: 1, sin: 1, cos: 1, tan: 1,
  random: null, randomSeed: 1, tone: null, noTone: 1, pulseIn: null,
  bitRead: 2, bitWrite: 3, bitSet: 2, bitClear: 2, lowByte: 1, highByte: 1,
}
// SUBO library free functions (Subo.h / MotorExpansion.h) → arity.
const SUBO_FUNCS = {
  SuboMatrixInit: 0, setAllLED: 3, setSingleLED: 4, playLEDSeq: 1, stripclear: 0,
  playTone: 2, stopBuzzer: 0, playBuzSeq: 1,
  start_motors: 0, drive_motors: null, runMotor: 2,
}
// Constants / macros always in scope.
const CORE_CONSTS = new Set([
  'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'true', 'false', 'NULL', 'null',
  'WHITE', 'BLACK', 'SSD1306_WHITE', 'SSD1306_BLACK', 'SSD1306_INVERSE',
  'SSD1306_SWITCHCAPVCC', 'SSD1306_EXTERNALVCC', 'SCREEN_WIDTH', 'SCREEN_HEIGHT',
  'S0', 'S1', 'S2', 'S3', 'OUT',
])
const SUBO_CONSTS = new Set([
  ...Array.from({ length: 21 }, (_, i) => `IO${i + 1}`),
  'SUBO_BUZZER_PIN', 'SUBO_LED_PIN', 'SUBO_LED_NUM', 'SUBO_BUTTONR', 'SUBO_BUTTONL',
])
// pitches.h note names (NOTE_C4 … + REST) — pattern-matched, plus a few explicit.
const isNoteConst = (s) => /^NOTE_[A-G]S?[0-8]$/.test(s) || s === 'REST'
// Library classes that can be constructed as objects.
const LIB_CLASSES = new Set(['Servo', 'LDR', 'DHT11', 'ColorSensor', 'RGB', 'Adafruit_SSD1306', 'String'])
// Known #include libraries (base name, without .h).
const KNOWN_LIBS = new Set(['Subo', 'Servo', 'LDR', 'DHT11', 'ColorSensor', 'Wire', 'SPI', 'Adafruit_SSD1306', 'Adafruit_GFX', 'pitches', 'MotorExpansion', 'math', 'stdint', 'Arduino', 'string', 'stdlib', 'EEPROM'])

const C_TYPES = new Set(['void', 'int', 'float', 'double', 'bool', 'boolean', 'char', 'byte', 'long', 'short', 'unsigned', 'signed', 'String', 'auto', 'size_t', 'uint8_t', 'uint16_t', 'uint32_t', 'int8_t', 'int16_t', 'int32_t', 'word'])
const CONTROL_KW = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'return', 'break', 'continue', 'goto'])
const DECL_KW = new Set([...C_TYPES, 'const', 'static', 'volatile', 'struct', 'typedef', 'enum', 'class'])

// ── Tokenizer (tracks line + column + source index + length) ──────────────────
const T = { NUM: 'NUM', STR: 'STR', CHAR: 'CHAR', IDENT: 'IDENT', OP: 'OP', PUNCT: 'PUNCT', PP: 'PP', ERR: 'ERR', EOF: 'EOF' }

function tokenize(src, lexErrors) {
  const toks = []
  let i = 0, line = 1, lineStart = 0
  const col = () => i - lineStart + 1
  const push = (t, v, sc, sl, scol) => toks.push({ t, v, line: sl, col: scol, index: sc, len: i - sc })

  while (i < src.length) {
    const c = src[i]
    if (c === '\n') { line++; i++; lineStart = i; continue }
    if (c === '\r' || c === ' ' || c === '\t') { i++; continue }

    // Comments
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') {
      const sc = i, sl = line, scol = col(); i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; i++; lineStart = i } else i++ }
      if (i >= src.length) lexErrors.push({ kind: 'unterminated-comment', line: sl, col: scol, index: sc, len: 2, v: '/*' })
      else i += 2
      continue
    }

    // Preprocessor line
    if (c === '#') {
      const sc = i, sl = line, scol = col()
      while (i < src.length && src[i] !== '\n') i++
      push(T.PP, src.slice(sc, i).trimEnd(), sc, sl, scol); continue
    }

    // String
    if (c === '"') {
      const sc = i, sl = line, scol = col(); i++
      let closed = false
      while (i < src.length && src[i] !== '\n') { if (src[i] === '\\') i += 2; else if (src[i] === '"') { i++; closed = true; break } else i++ }
      push(T.STR, src.slice(sc, i), sc, sl, scol)
      if (!closed) lexErrors.push({ kind: 'unterminated-string', line: sl, col: scol, index: sc, len: i - sc, v: src.slice(sc, i) })
      continue
    }

    // Char literal
    if (c === "'") {
      const sc = i, sl = line, scol = col(); i++
      let closed = false, n = 0
      while (i < src.length && src[i] !== '\n') { if (src[i] === '\\') { i += 2; n++ } else if (src[i] === "'") { i++; closed = true; break } else { i++; n++ } }
      push(T.CHAR, src.slice(sc, i), sc, sl, scol)
      if (!closed) lexErrors.push({ kind: 'unterminated-char', line: sl, col: scol, index: sc, len: i - sc, v: src.slice(sc, i) })
      else if (n === 0) lexErrors.push({ kind: 'empty-char', line: sl, col: scol, index: sc, len: i - sc, v: "''" })
      continue
    }

    // Number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const sc = i, sl = line, scol = col()
      let bad = false
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        i += 2; const ds = i; while (/[0-9a-fA-F_]/.test(src[i] ?? '')) i++
        if (i === ds) bad = true
      } else if (c === '0' && /[bB]/.test(src[i + 1] ?? '')) {
        i += 2; const ds = i; while (/[01_]/.test(src[i] ?? '')) i++; if (i === ds) bad = true
      } else {
        let dots = 0
        while (/[0-9.]/.test(src[i] ?? '')) { if (src[i] === '.') dots++; i++ }
        if (dots > 1) bad = true
        if (/[eE]/.test(src[i] ?? '')) { i++; if (/[+-]/.test(src[i] ?? '')) i++; while (/[0-9]/.test(src[i] ?? '')) i++ }
      }
      while (/[uUlLfF]/.test(src[i] ?? '')) i++
      // A letter immediately touching the number = invalid literal (e.g. 12abc).
      if (/[a-zA-Z_]/.test(src[i] ?? '')) { bad = true; while (/[a-zA-Z0-9_]/.test(src[i] ?? '')) i++ }
      push(T.NUM, src.slice(sc, i), sc, sl, scol)
      if (bad) lexErrors.push({ kind: 'invalid-number', line: sl, col: scol, index: sc, len: i - sc, v: src.slice(sc, i) })
      continue
    }

    // Identifier
    if (/[a-zA-Z_]/.test(c)) {
      const sc = i, sl = line, scol = col()
      while (/[a-zA-Z0-9_]/.test(src[i] ?? '')) i++
      push(T.IDENT, src.slice(sc, i), sc, sl, scol); continue
    }

    // Operators (longest first)
    const sc = i, sl = line, scol = col()
    const OPS3 = ['<<=', '>>=', '...']
    const OPS2 = ['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '->', '::']
    let found = false
    for (const op of OPS3) if (src.startsWith(op, i)) { i += 3; push(T.OP, op, sc, sl, scol); found = true; break }
    if (!found) for (const op of OPS2) if (src.startsWith(op, i)) { i += 2; push(T.OP, op, sc, sl, scol); found = true; break }
    if (!found && '+-*/%=<>!&|^~?:'.includes(c)) { i++; push(T.OP, c, sc, sl, scol); found = true }
    if (!found && ';,()[]{}.'.includes(c)) { i++; push(T.PUNCT, c, sc, sl, scol); found = true }
    if (!found) { i++; lexErrors.push({ kind: 'stray-char', line: sl, col: scol, index: sc, len: 1, v: c }) }
  }
  toks.push({ t: T.EOF, v: '', line, col: col(), index: i, len: 0 })
  return toks
}

// ── Levenshtein suggestion engine ─────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n; if (!n) return m
  const d = new Array(n + 1)
  for (let j = 0; j <= n; j++) d[j] = j
  for (let x = 1; x <= m; x++) {
    let prev = d[0]; d[0] = x
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[x - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[n]
}
// Best match in `dict` for `name`: prefers a case-insensitive exact hit (highest
// confidence typo like pinmode→pinMode), else nearest within an edit budget.
function suggest(name, dict) {
  const lower = name.toLowerCase()
  let ci = null
  for (const d of dict) { if (d.toLowerCase() === lower && d !== name) { ci = d; break } }
  if (ci) return ci
  const budget = Math.max(1, Math.min(3, Math.floor(name.length * 0.34)))
  let best = null, bestD = Infinity
  for (const d of dict) {
    const dist = levenshtein(name, d)
    if (dist < bestD && dist <= budget) { bestD = dist; best = d }
  }
  return best
}

// ── Public API ────────────────────────────────────────────────────────────────
export function analyzeArduino(src, { board = 'arduino' } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const lines = src.split('\n')
  const errors = [], warnings = []
  const lexErrors = []
  const toks = tokenize(src, lexErrors)
  const sig = toks.filter(t => t.t !== T.EOF)          // significant tokens

  const mk = (sev, kind, tok, message, explain, suggestion) => {
    const line = tok.line, col = tok.col
    const src_line = lines[line - 1] ?? ''
    const caret = ' '.repeat(Math.max(0, col - 1)) + '^'.repeat(Math.max(1, Math.min(tok.len || 1, 40)))
    return { severity: sev, kind, line, col, endCol: col + (tok.len || 1), len: tok.len || 1, file: FILE, message, explain: explain || '', suggestion: suggestion || '', snippet: src_line, caret }
  }
  const err = (...a) => errors.push(mk('error', ...a))
  const warn = (...a) => warnings.push(mk('warning', ...a))

  // 1) Lexical errors ---------------------------------------------------------
  for (const e of lexErrors) {
    const tok = { line: e.line, col: e.col, len: e.len }
    if (e.kind === 'unterminated-string') err('unterminated-string', tok, 'Missing closing quotation mark', 'A string literal was opened with " but never closed on this line.', 'Add a closing " to the end of the string.')
    else if (e.kind === 'unterminated-char') err('unterminated-char', tok, "Missing closing single quote", "A character literal ' was not closed.", "Close the character with a matching '.")
    else if (e.kind === 'empty-char') err('empty-char', tok, 'Empty character literal', "'' contains no character.", "Put one character between the quotes, e.g. 'A'.")
    else if (e.kind === 'unterminated-comment') err('unterminated-comment', tok, "Unterminated block comment", 'A /* comment was never closed with */.', 'Add */ to close the comment.')
    else if (e.kind === 'invalid-number') err('invalid-number', tok, `Invalid number literal '${e.v}'`, 'This is not a valid integer, float, hex or binary literal.', 'Check for a stray letter or a second decimal point.')
    else if (e.kind === 'stray-char') err('stray-char', tok, `Unexpected token '${e.v}'`, 'This character is not valid C++ here.', '')
  }

  // 2) Symbol collection (functions, variables, includes, defines) ------------
  const includes = new Set(), userFuncs = new Map(), userVars = new Map(), userTypes = new Set()
  const defines = new Set()
  for (const tk of sig) {
    if (tk.t === T.PP) {
      const inc = tk.v.match(/#\s*include\s*[<"]([A-Za-z0-9_./]+?)(?:\.h)?[>"]/)
      if (inc) includes.add(inc[1].replace(/^.*\//, ''))
      const def = tk.v.match(/#\s*define\s+([A-Za-z_]\w*)/)
      if (def) defines.add(def[1])
    }
  }
  // Function definitions/prototypes:  TYPE  name (   at statement level.
  for (let k = 0; k < sig.length - 2; k++) {
    const a = sig[k], b = sig[k + 1], c = sig[k + 2]
    const prev = k > 0 ? sig[k - 1] : null
    const atStmtStart = !prev || (prev.t === T.PUNCT && (prev.v === '{' || prev.v === '}' || prev.v === ';')) || prev.t === T.PP
    const isType = a.t === T.IDENT && (C_TYPES.has(a.v) || userTypes.has(a.v))
    if (atStmtStart && isType && b.t === T.IDENT && c.t === T.PUNCT && c.v === '(') {
      const arity = countParams(sig, k + 2)
      if (userFuncs.has(b.v)) err('duplicate-function', b, `Redefinition of function '${b.v}'`, `A function named '${b.v}' is already declared.`, 'Rename or remove the duplicate definition.')
      else userFuncs.set(b.v, arity)
    }
    // enum/struct/typedef names → user types (loose)
    if (a.t === T.IDENT && (a.v === 'struct' || a.v === 'class' || a.v === 'enum') && b.t === T.IDENT) userTypes.add(b.v)
  }
  // Variable declarations (global + local):  TYPE name  (not followed by '(').
  for (let k = 0; k < sig.length - 1; k++) {
    const a = sig[k], b = sig[k + 1]
    const prev = k > 0 ? sig[k - 1] : null
    const isTypeTok = a.t === T.IDENT && (C_TYPES.has(a.v) || LIB_CLASSES.has(a.v) || userTypes.has(a.v))
    const prevOkForType = !prev || (prev.t === T.PUNCT && '{};,('.includes(prev.v)) || prev.t === T.PP ||
      (prev.t === T.IDENT && (prev.v === 'const' || prev.v === 'static' || prev.v === 'unsigned' || prev.v === 'signed' || prev.v === 'volatile'))
    if (isTypeTok && b.t === T.IDENT && prevOkForType) {
      const after = sig[k + 2]
      const isFnDef = after && after.t === T.PUNCT && after.v === '(' && !LIB_CLASSES.has(a.v)
      if (!isFnDef && !CORE_CONSTS.has(b.v) && !SUBO_CONSTS.has(b.v)) userVars.set(b.v, b)
    }
    // for-loop / param locals: '(' TYPE IDENT  and  ',' TYPE IDENT
    if ((a.t === T.PUNCT && (a.v === '(' || a.v === ',')) && sig[k + 1] && (C_TYPES.has(sig[k + 1].v)) && sig[k + 2] && sig[k + 2].t === T.IDENT) {
      userVars.set(sig[k + 2].v, sig[k + 2])
    }
  }

  const known = (name) =>
    CORE_FUNCS[name] !== undefined || SUBO_FUNCS[name] !== undefined ||
    CORE_CONSTS.has(name) || SUBO_CONSTS.has(name) || isNoteConst(name) ||
    LIB_CLASSES.has(name) || C_TYPES.has(name) || CONTROL_KW.has(name) || DECL_KW.has(name) ||
    userFuncs.has(name) || userVars.has(name) || userTypes.has(name) || defines.has(name) ||
    name === 'Serial' || name === 'Wire' || name === 'setup' || name === 'loop'

  // Full dictionary for spelling suggestions.
  const dict = [
    ...Object.keys(CORE_FUNCS), ...Object.keys(SUBO_FUNCS), ...CORE_CONSTS, ...SUBO_CONSTS,
    ...LIB_CLASSES, 'Serial', 'Wire', 'setup', 'loop', ...userFuncs.keys(), ...userVars.keys(), ...defines,
  ]

  // 3) Bracket balance --------------------------------------------------------
  //    Also classify each '{' as a BLOCK or an INITIALIZER so we can safely do
  //    missing-semicolon detection only before block-closing braces.
  const stack = []
  const braceKind = new Map()     // token index → 'block' | 'init'
  for (let k = 0; k < sig.length; k++) {
    const tk = sig[k]
    if (tk.t !== T.PUNCT) continue
    if (tk.v === '(' || tk.v === '[' || tk.v === '{') {
      if (tk.v === '{') {
        const p = k > 0 ? sig[k - 1] : null
        const init = p && ((p.t === T.OP && (p.v === '=' )) || (p.t === T.PUNCT && (p.v === ',' || p.v === '(' || p.v === '{' || p.v === '[')))
        braceKind.set(k, init ? 'init' : 'block')
      }
      stack.push({ tk, k })
    } else if (tk.v === ')' || tk.v === ']' || tk.v === '}') {
      const want = tk.v === ')' ? '(' : tk.v === ']' ? '[' : '{'
      const top = stack[stack.length - 1]
      if (!top) err('unmatched-bracket', tk, `Unexpected '${tk.v}'`, `There is no matching '${want}' for this '${tk.v}'.`, `Remove '${tk.v}' or add the missing '${want}'.`)
      else if (top.tk.v !== want) {
        err('mismatched-bracket', tk, `Expected '${close(top.tk.v)}' before '${tk.v}'`, `An open '${top.tk.v}' (line ${top.tk.line}) is closed by the wrong bracket.`, `Close '${top.tk.v}' with '${close(top.tk.v)}' first.`)
        stack.pop()
      } else stack.pop()
    }
  }
  for (const { tk } of stack) {
    err('missing-bracket', tk, `Missing closing '${close(tk.v)}' for '${tk.v}'`, `This '${tk.v}' (line ${tk.line}) is never closed.`, `Add a matching '${close(tk.v)}'.`)
  }

  // 4) Missing semicolon (high-precision) -------------------------------------
  //    Fires only when an expression-ending token is directly followed (ignoring
  //    nothing) by a block-closing '}' or a new-line statement starter, at paren
  //    depth 0, with no ';' between. Never inside (...) or an initializer {...}.
  let depthParen = 0
  const braceStack = []
  for (let k = 0; k < sig.length; k++) {
    const tk = sig[k], nx = sig[k + 1]
    if (tk.t === T.PUNCT && (tk.v === '(' || tk.v === '[')) depthParen++
    if (tk.t === T.PUNCT && (tk.v === ')' || tk.v === ']')) depthParen = Math.max(0, depthParen - 1)
    if (tk.t === T.PUNCT && tk.v === '{') braceStack.push(braceKind.get(k) || 'block')
    if (tk.t === T.PUNCT && tk.v === '}') braceStack.pop()
    if (!nx || depthParen > 0) continue
    const inBlock = braceStack.length === 0 || braceStack[braceStack.length - 1] === 'block'
    if (!inBlock) continue
    const ender = isExprEnd(tk)
    if (!ender) continue
    // Skip if a ';' or continuation already follows.
    if (nx.t === T.PUNCT && ';'.includes(nx.v)) continue
    // Case A: '... }' on the SAME or next line closing a block.
    if (nx.t === T.PUNCT && nx.v === '}') {
      err('missing-semicolon', tk, `Expected ';' before '}'`, 'A statement is missing its terminating semicolon before the block closes.', `Did you forget a semicolon after '${short(tk.v)}'?`)
      continue
    }
    // Case B: next token starts a NEW statement on a LATER line.
    if (nx.line > tk.line && startsStatement(nx, userFuncs)) {
      err('missing-semicolon', tk, `Expected ';' after '${short(tk.v)}'`, 'This statement does not end with a semicolon.', `Add a ';' at the end of line ${tk.line}.`)
    }
  }

  // 5) Semantic checks on calls & identifiers ---------------------------------
  const referenced = new Map()  // name → count (for unused-variable warning)
  for (let k = 0; k < sig.length; k++) {
    const tk = sig[k]
    if (tk.t !== T.IDENT) continue
    referenced.set(tk.v, (referenced.get(tk.v) || 0) + 1)
    const prev = k > 0 ? sig[k - 1] : null
    const nx = sig[k + 1]
    // Member access: obj.method (`.` is a PUNCT) or obj->m / Class::m (OP).
    const isMember = prev && ((prev.t === T.PUNCT && prev.v === '.') || (prev.t === T.OP && (prev.v === '->' || prev.v === '::')))
    const isCall = nx && nx.t === T.PUNCT && nx.v === '('
    const isDeclName = prev && prev.t === T.IDENT && (C_TYPES.has(prev.v) || LIB_CLASSES.has(prev.v) || userTypes.has(prev.v))

    // 5a) Board validation — SUBO API on a plain Arduino board.
    if (board === 'arduino' && !includes.has('Subo')) {
      if ((SUBO_FUNCS[tk.v] !== undefined && isCall) || SUBO_CONSTS.has(tk.v)) {
        err('board-mismatch', tk, `'${tk.v}' belongs to the SUBO library`, 'This function/constant is part of the SUBO board API, not the Arduino core.', 'Add  #include <Subo.h>  and use a SUBO board.')
        continue
      }
    }

    // 5b) Invalid pin constant (IOn out of range).
    const pinm = tk.v.match(/^IO(\d+)$/)
    if (pinm && !isMember) {
      const n = +pinm[1]
      if ((n < 1 || n > 21) ) {
        err('invalid-pin', tk, `${tk.v} does not exist on the selected board`, 'The SUBO board only exposes IO1–IO21.', 'Use a pin in the range IO1–IO21.')
        continue
      }
    }

    // 5c) Unknown function call.
    if (isCall && !isMember && !isDeclName && !known(tk.v)) {
      const s = suggest(tk.v, dict)
      err('unknown-function', tk, `'${tk.v}' was not declared in this scope`, 'No function with this name exists in the Arduino core, the SUBO library, or your sketch.', s ? `Did you mean  ${s}()  ?` : 'Check the spelling or define the function.')
      continue
    }

    // 5d) Unknown identifier (non-call) — only flagged when there's a strong
    //     suggestion, so real local variables are never falsely reported.
    if (!isCall && !isMember && !isDeclName && !known(tk.v)) {
      const s = suggest(tk.v, dict)
      const caseOnly = s && s.toLowerCase() === tk.v.toLowerCase()          // pinmode→pinMode, DigitalWrite→digitalWrite
      const nearMiss = s && levenshtein(tk.v, s) <= 2 && Math.abs(tk.v.length - s.length) <= 2  // Subbo→Subo, Led→LED_BUILTIN-ish
      if (caseOnly || nearMiss) {
        err('unknown-identifier', tk, `'${tk.v}' was not declared in this scope`, 'This identifier does not match any known constant, variable, or type.', `Did you mean  ${s}  ?`)
      }
      // else: leave it — likely a legitimate user symbol we didn't track.
    }

    // 5e) Argument-count + type checks for core/SUBO builtins.
    if (isCall && !isMember) {
      const arity = CORE_FUNCS[tk.v] ?? SUBO_FUNCS[tk.v]
      if (arity != null) {
        const argc = countArgs(sig, k + 1)
        if (argc !== arity) {
          err('arg-count', tk, `'${tk.v}' expects ${arity} argument${arity === 1 ? '' : 's'}, got ${argc}`, `The function '${tk.v}' is called with the wrong number of arguments.`, `Call it with exactly ${arity} argument${arity === 1 ? '' : 's'}.`)
        }
      }
      // digitalWrite(pin, HIGH|LOW) — arg 2 must be a level, not a string.
      if (tk.v === 'digitalWrite') {
        const a2 = nthArgFirstTok(sig, k + 1, 1)
        if (a2 && a2.t === T.STR) err('type-mismatch', a2, 'Argument 2 of digitalWrite must be HIGH or LOW', 'digitalWrite takes a pin and a level (HIGH/LOW or 1/0), not a string.', 'Use HIGH or LOW without quotes.')
      }
    }
  }

  // 6) Warnings ---------------------------------------------------------------
  //    Assignment inside an if/while condition:  if ( IDENT = ... )
  for (let k = 0; k < sig.length - 3; k++) {
    const a = sig[k], b = sig[k + 1], c = sig[k + 2], d = sig[k + 3]
    if (a.t === T.IDENT && (a.v === 'if' || a.v === 'while') && b.t === T.PUNCT && b.v === '(' &&
        c.t === T.IDENT && d.t === T.OP && d.v === '=') {
      warn('assign-in-condition', d, 'Assignment used in a condition', 'A single = assigns; conditions usually compare with ==.', 'Did you mean  ==  ?')
    }
  }
  //    Division by a literal zero.
  for (let k = 0; k < sig.length - 1; k++) {
    if (sig[k].t === T.OP && (sig[k].v === '/' || sig[k].v === '%') && sig[k + 1].t === T.NUM && /^0+$/.test(sig[k + 1].v)) {
      warn('div-zero', sig[k + 1], 'Division by zero', 'Dividing by a literal 0 is undefined behaviour.', 'Guard the divisor so it can never be 0.')
    }
  }
  //    Always-true comparison:  if (true) / if (1) / while (1) etc.
  for (let k = 0; k < sig.length - 2; k++) {
    const a = sig[k], b = sig[k + 1], c = sig[k + 2], d = sig[k + 3]
    if (a.t === T.IDENT && (a.v === 'if') && b.t === T.PUNCT && b.v === '(' &&
        ((c.t === T.IDENT && c.v === 'true') || (c.t === T.NUM && c.v !== '0')) && d && d.t === T.PUNCT && d.v === ')') {
      warn('always-true', c, 'Condition is always true', 'This if-condition can never be false.', 'Remove the condition or use a real test.')
    }
  }
  //    Potential infinite loop: while(true)/while(1)/for(;;) with no break inside.
  flagInfiniteLoops(sig, warn)
  //    Unreachable code after return/break/continue within a block.
  flagDeadCode(sig, warn)
  //    Unused variables (referenced only at their declaration site).
  for (const [name, tok] of userVars) {
    if (name === 'setup' || name === 'loop') continue
    if ((referenced.get(name) || 0) <= 1) warn('unused-variable', tok, `Unused variable '${name}'`, 'This variable is declared but never used.', 'Remove it, or use it somewhere.')
  }
  //    Unknown / misspelled library include.
  for (const tk of sig) {
    if (tk.t !== T.PP) continue
    const inc = tk.v.match(/#\s*include\s*[<"]([A-Za-z0-9_./]+?)(?:\.h)?[>"]/)
    if (inc) {
      const base = inc[1].replace(/^.*\//, '')
      if (!KNOWN_LIBS.has(base)) {
        const s = suggest(base, [...KNOWN_LIBS])
        if (s && levenshtein(base, s) <= 2) err('invalid-include', tk, `Library '${base}.h' not found`, 'No simulator library with this name is available.', `Did you mean  #include <${s}.h>  ?`)
        else warn('unknown-include', tk, `Unknown library '${base}.h'`, 'This library is not provided by the simulator; it will be ignored.', '')
      }
    }
  }

  // 7) Stats ------------------------------------------------------------------
  const timeMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
  errors.sort((x, y) => x.line - y.line || x.col - y.col)
  warnings.sort((x, y) => x.line - y.line || x.col - y.col)
  const stats = {
    lines: lines.length,
    functions: userFuncs.size,
    variables: userVars.size,
    libraries: includes.size,
    warnings: warnings.length,
    timeMs: Math.round(timeMs * 10) / 10,
  }
  return { ok: errors.length === 0, errors, warnings, stats }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function close(open) { return open === '(' ? ')' : open === '[' ? ']' : '}' }
function short(v) { return String(v).length > 14 ? String(v).slice(0, 14) + '…' : String(v) }
function isExprEnd(tk) {
  if (tk.t === T.IDENT) return !CONTROL_KW.has(tk.v) && !DECL_KW.has(tk.v) && tk.v !== 'else'
  if (tk.t === T.NUM || tk.t === T.STR || tk.t === T.CHAR) return true
  if (tk.t === T.PUNCT && (tk.v === ')' || tk.v === ']')) return true
  return false
}
function startsStatement(tk, userFuncs) {
  if (tk.t === T.IDENT) {
    if (C_TYPES.has(tk.v) || CONTROL_KW.has(tk.v) || DECL_KW.has(tk.v)) return tk.v !== 'else'
    if (CORE_FUNCS[tk.v] !== undefined || SUBO_FUNCS[tk.v] !== undefined || userFuncs.has(tk.v) || tk.v === 'Serial' || tk.v === 'Wire') return true
  }
  return false
}
// Count params in a definition `name ( ... )` starting at the '(' token index.
function countParams(sig, openIdx) {
  let depth = 0, count = 0, seen = false
  for (let k = openIdx; k < sig.length; k++) {
    const tk = sig[k]
    if (tk.t === T.PUNCT && (tk.v === '(' || tk.v === '[')) { depth++; if (depth === 1) continue }
    if (tk.t === T.PUNCT && (tk.v === ')' || tk.v === ']')) { depth--; if (depth === 0) break }
    if (depth === 1) {
      if (tk.t === T.IDENT && tk.v === 'void' && !seen) return 0
      seen = true
      if (tk.t === T.PUNCT && tk.v === ',') count++
    }
  }
  return seen ? count + 1 : 0
}
// Count arguments in a call `name ( ... )` starting at the '(' token index.
function countArgs(sig, openIdx) {
  let depth = 0, count = 0, seen = false
  for (let k = openIdx; k < sig.length; k++) {
    const tk = sig[k]
    if (tk.t === T.PUNCT && (tk.v === '(' || tk.v === '[' || tk.v === '{')) { depth++; if (depth === 1 && tk.v === '(') continue }
    if (tk.t === T.PUNCT && (tk.v === ')' || tk.v === ']' || tk.v === '}')) { depth--; if (depth === 0) break }
    if (depth === 1) { seen = true; if (tk.t === T.PUNCT && tk.v === ',') count++ }
  }
  return seen ? count + 1 : 0
}
// First token of the Nth (0-based) argument of a call opening at openIdx.
function nthArgFirstTok(sig, openIdx, n) {
  let depth = 0, arg = 0, wantFirst = n === 0
  for (let k = openIdx; k < sig.length; k++) {
    const tk = sig[k]
    if (tk.t === T.PUNCT && (tk.v === '(' || tk.v === '[' || tk.v === '{')) { depth++; if (depth === 1 && tk.v === '(') { wantFirst = n === 0; continue } }
    if (tk.t === T.PUNCT && (tk.v === ')' || tk.v === ']' || tk.v === '}')) { depth--; if (depth === 0) break; continue }
    if (depth === 1) {
      if (tk.t === T.PUNCT && tk.v === ',') { arg++; wantFirst = arg === n; continue }
      if (wantFirst) return tk
    }
  }
  return null
}
// while(true)/while(1)/for(;;) with no `break`/`return` in the following block.
function flagInfiniteLoops(sig, warn) {
  for (let k = 0; k < sig.length - 3; k++) {
    const a = sig[k]
    let isInf = false, headTok = a
    if (a.t === T.IDENT && a.v === 'while' && sig[k + 1]?.v === '(' &&
        ((sig[k + 2]?.t === T.IDENT && sig[k + 2].v === 'true') || (sig[k + 2]?.t === T.NUM && sig[k + 2].v !== '0')) && sig[k + 3]?.v === ')') isInf = true
    if (a.t === T.IDENT && a.v === 'for' && sig[k + 1]?.v === '(' && sig[k + 2]?.v === ';' && sig[k + 3]?.v === ';' && sig[k + 4]?.v === ')') isInf = true
    if (!isInf) continue
    // Scan the block body for break/return.
    let j = k
    while (j < sig.length && !(sig[j].t === T.PUNCT && sig[j].v === '{')) j++
    if (j >= sig.length) continue
    let depth = 0, hasBreak = false
    for (; j < sig.length; j++) {
      if (sig[j].v === '{') depth++
      else if (sig[j].v === '}') { depth--; if (depth === 0) break }
      else if (sig[j].t === T.IDENT && (sig[j].v === 'break' || sig[j].v === 'return')) hasBreak = true
    }
    if (!hasBreak) warn('infinite-loop', headTok, 'Potential infinite loop', 'This loop condition is always true and the body has no break/return.', 'Add a break condition, or confirm this is intentional.')
  }
}
// Statements after return/break/continue before a block close = dead code.
function flagDeadCode(sig, warn) {
  for (let k = 0; k < sig.length - 1; k++) {
    const tk = sig[k]
    if (tk.t === T.IDENT && (tk.v === 'return' || tk.v === 'break' || tk.v === 'continue')) {
      // advance to the terminating ';'
      let j = k
      while (j < sig.length && !(sig[j].t === T.PUNCT && sig[j].v === ';')) { if (sig[j].t === T.PUNCT && (sig[j].v === '{' || sig[j].v === '}')) break; j++ }
      const after = sig[j + 1]
      if (after && !(after.t === T.PUNCT && (after.v === '}' || after.v === '{')) && !(after.t === T.IDENT && (after.v === 'case' || after.v === 'default'))) {
        warn('dead-code', after, 'Unreachable code', `Statements after '${tk.v}' can never run.`, 'Remove the dead code or restructure the branch.')
      }
    }
  }
}
