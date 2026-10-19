# Constructa — security model

Reviewed 2026-10-19. This records what is protected, how, and what is *not*
covered, so later changes don't quietly undo a control.

---

## 1. Untrusted sketch code (the important one)

**Threat.** A project carries its sketch (`electronics.code`), and projects
travel: share links (`#share=`), community builds, and "Reuse". Opening someone
else's robot loads their code into the editor, and the app invites the user to
press ▶ Run. Before this review that code was executed with `new Function` in the
app's own realm, where it could read `localStorage` (Supabase session tokens, the
analytics dashboard key) and `fetch` it anywhere — i.e. account takeover from a
shared robot.

Shadowing dangerous globals is **not** a fix: the transpiler supports member
access, so `("").constructor.constructor("return globalThis")()` escapes it.

**Control.** [`src/managers/sketchSandbox.js`](../src/managers/sketchSandbox.js)
runs every sketch inside an isolated `<iframe>`:

| Mechanism | Effect |
|---|---|
| `sandbox="allow-scripts"` **without** `allow-same-origin` | opaque origin: `localStorage`, `indexedDB`, `document.cookie` all throw; the parent document is cross-origin |
| `default-src 'none'` CSP inside the frame | no `fetch`/XHR/WebSocket/image beacon — a hostile sketch cannot phone home |
| narrow `postMessage` protocol | the only channel: Arduino-level calls out (`OUT_CALLS`), an input snapshot in |
| parent verifies `event.source === frame.contentWindow` | other frames/windows cannot inject calls |
| heartbeat watchdog (10 s) | a sketch that never yields is torn down; it can only wedge its own frame, never the editor |

Everything scene-aware (wiring maps, servo binding, audio, OLED, physics
telemetry) stays in `SimulationManager`; the frame forwards calls and reads a
snapshot pushed once per animation frame.

**Verified** (Playwright, against the running app): from inside the frame,
`localStorage` → `SecurityError`, `parent.document` → `SecurityError`,
`location.origin` → `"null"`, `fetch()` → blocked; a hostile sketch using the
`constructor.constructor` escape produced no output and the token in app storage
was untouched. Sketch behaviour (Serial, `map`, loop repetition, `Servo.attach` +
`write`, Stop) is unchanged.

**Rules for future changes**
- Never add `allow-same-origin` to that iframe.
- Never widen the frame CSP beyond `script-src 'unsafe-inline'`.
- New sketch APIs go in the frame runtime and forward via `OUT_CALLS`; never pass
  a live app object into the frame.

## 2. Community data is world-readable

`GRANT SELECT ON public.projects TO anon` + the "Anyone reads public projects"
policy make every **column** of a published row readable by anyone holding the
publishable key (which ships in the public bundle). RLS filters rows, not
columns.

**Control.** `author_email` is no longer stamped and existing values were cleared
(`supabase/migrations/20261019_community_pii.sql` in the landing repo); the
client neither selects nor displays it.

**Rule.** Anything added to `projects` is public the moment a row is published.
Keep personal data out of that table — `auth.users` is the source of truth and is
not exposed.

## 3. Analytics collector

- **Writes are unauthenticated by nature.** The endpoint ships in public JS, so
  client events can always be forged. `WRITE_TOKEN` only stops drive-by posting;
  an hourly cap (`MAX_EVENTS_PER_HOUR`) protects the Sheet and the Apps Script
  quota. **Treat client-sent events as untrusted**: anything business-critical
  (e.g. real sign-up counts) should be confirmed server-side from Supabase.
- **Reads are signed.** The dashboard sends `ts` + `HMAC-SHA256(ts, key)` instead
  of the key, so the key never appears in a URL, a server log or a `Referer`
  header; signatures expire after 5 minutes. There is **no JSONP fallback** —
  JSONP executes the response as script.

## 4. Other controls in place

| Area | State |
|---|---|
| XSS in the editor UI | React escaping only; no `dangerouslySetInnerHTML`. The analytics dashboard builds HTML but escapes every interpolation (`esc()`), which matters because anyone can write events. |
| Share links | payload decompression capped at 64 MB (`utils/share.js`) so a short URL can't exhaust the tab. |
| Project access | owner-only RLS; public reads only for `is_public`; share links use a 144-bit random token via a `SECURITY DEFINER` RPC. |
| `beta_signups` | insert-only for anon (no read grant), length caps, email-shape check. |
| Headers | `frame-ancestors 'none'`, `X-Frame-Options DENY`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| Electron | `contextIsolation: true`, `nodeIntegration: false`, empty preload, external links via `shell.openExternal`. |

## 5. Accepted / residual risks

1. **Forged analytics events** — unavoidable for a public endpoint (see §3).
2. **Sign-up flooding of `beta_signups`** — needs a captcha or an edge function
   with per-IP limits; Postgres cannot see the caller's IP.
3. **Session handoff in the URL fragment** (`#cs=`) — fragments are not sent to
   servers and the editor strips it immediately, but it can reach browser
   history. A short-lived single-use code would be stronger and needs a server.
4. **The page CSP keeps `unsafe-eval`/`unsafe-inline`** — the transpiler needs
   it. The sandbox is what contains sketch code, not the page CSP.
5. **Supply chain** — Lovable can push to the landing repo; `npx
   @gltf-transform/cli@4` resolves at build time; there is no CI dependency
   scanning. A compromised package ships to users.
