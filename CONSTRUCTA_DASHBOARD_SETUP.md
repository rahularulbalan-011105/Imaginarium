# Constructa — Auth, Dashboard & Project Management

Adds Supabase authentication, a project dashboard, and cloud auto-save to the
Constructa product. A **project = a 3D robot design**. The **dashboard lives in
the landing app**; **Open** launches the existing 3D **editor** with the design,
which auto-saves back to Supabase.

```
Landing (constructa-page.atumx.in)          Editor (constructa.atumx.in)
  /signup /login  → Supabase Auth
  /dashboard      → list / create / delete / share / download / complete
  /project/$id    → launcher ──(session in URL #fragment)──▶  loads project,
  /share/$token   → public read-only                         auto-saves to cloud
```

Two apps, **one Supabase project**, one user session shared across subdomains via
a one-time URL-fragment handoff.

---

## 1. What was implemented

**Landing app** (`LANDING PAE- CONSTURCTA/`, TanStack Start + Vercel)
- Email/password **auth** (Supabase) — signup (name/email/password/confirm,
  validation, password toggle, loading/error/success), login, logout, session
  persistence, client-side **route protection**.
- **Dashboard** — project grid, drafts vs completed, search by title, filter
  tabs (All/Drafts/Completed), New Project, empty/loading/error states.
- Per-project **Open / Share / Download / Delete / Mark-complete (⇄ reopen)**.
- **Share** — opaque token → `/share/$token` public read-only page (Copy Link).
- **Download** — a Constructa `.json` (the editor snapshot, re-importable).
- All comic-theme (shadcn UI + existing tokens), responsive.

**Editor** (`src/`, toolsapp)
- **Cloud sync** — consumes the session handoff, loads `?project=<id>` (or
  `?share=<token>` read-only), **auto-saves** the snapshot back to Supabase.
- **CloudSaveBar** — "← Dashboard" + live **Saving… / Saved ✓ / Unable to save
  · Retry** (and a Read-only badge for shares).
- Puppy onboarding is suppressed when opened as a cloud workspace.

**Database** — `projects` + `project_shares` tables, RLS, a `SECURITY DEFINER`
share-read function, `updated_at` trigger.

---

## 2. Files

**Created — landing** (`LANDING PAE- CONSTURCTA/LANDING PAE- CONSTURCTA/`)
- `supabase/migrations/20260830090000_projects.sql` — schema + RLS + share RPC
- `src/lib/auth.tsx` — `AuthProvider` / `useAuth`
- `src/lib/projects.ts` — project + share CRUD
- `src/lib/workspace.ts` — editor handoff URL builder
- `src/lib/download.ts` — JSON download
- `src/components/auth/AuthShell.tsx`, `RequireAuth.tsx`
- `src/components/ui/loaders.tsx`
- `src/components/dashboard/DashboardHeader.tsx`, `ProjectCard.tsx`, `ShareDialog.tsx`, `DeleteConfirm.tsx`
- `src/routes/signup.tsx`, `login.tsx`, `dashboard.tsx`, `project.$id.tsx`, `share.$token.tsx`
- `.env.example`

**Modified — landing**
- `src/routes/__root.tsx` — wrap in `AuthProvider` + `Toaster`
- `src/integrations/supabase/types.ts` — `projects` / `project_shares` / RPC types
- `src/components/landing/Nav.tsx` — Log in / Get Started / My robots

**Created — editor** (`src/`)
- `src/lib/supabaseClient.js`
- `src/managers/CloudProjectManager.js`
- `src/components/CloudSaveBar.jsx`
- `.env.example`

**Modified — editor**
- `src/App.jsx` — `initCloudSync()` on boot + mount `<CloudSaveBar/>`
- `src/components/StartSessionBanner.jsx` — skip onboarding in cloud mode
- `package.json` — add `@supabase/supabase-js`

---

## 3. Supabase setup (do this once)

1. **Run the migration.** In the Supabase SQL editor for project
   `uytepdfgbgjdeefcnadz`, paste and run
   `supabase/migrations/20260830090000_projects.sql`. (Or `supabase db push`.)
2. **Auth → Providers:** enable **Email**. For the smoothest test, turn **OFF**
   "Confirm email" (Auth → Providers → Email) so signup logs in immediately; if
   you keep it on, the signup screen shows a "check your inbox" step.
3. **Auth → URL Configuration:** set **Site URL** to your landing origin
   (`https://constructa-page.atumx.in`) and add it (and `http://localhost:8080`
   for dev) to **Redirect URLs**.
4. **Vercel env** (landing project): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
   The service-role key is **server-only — never commit it**.

## 4. Env vars

| Var | Landing | Editor | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | ✅ | same project |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | ✅ | public-safe |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | ✅ (SSR) | — | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (Vercel only) | — | **secret** |
| `VITE_EDITOR_ORIGIN` | optional | — | default `https://constructa.atumx.in` |
| `VITE_DASHBOARD_URL` | — | optional | default `https://constructa-page.atumx.in/dashboard` |

The **editor** reads its two `VITE_` vars at build time — set them in the
toolsapp `.env` before `npm run build` / `npm run deploy`. Without them the
editor simply runs standalone (no cloud sync), unchanged.

## 5. Deploy

- **Landing:** `git push` → Vercel auto-deploys (env already in Vercel).
- **Editor:** create toolsapp `.env` from `.env.example`, then `npm run deploy`.

---

## 6. How it works

**Auth.** `AuthProvider` wraps the app, subscribing to
`supabase.auth.onAuthStateChange` and hydrating from `getSession()`. `RequireAuth`
waits for that check (SSR renders a loader), then bounces anonymous users to
`/login?redirect=…`. Name is stored in the user's `user_metadata.full_name`.

**Data + security.** The dashboard/workspace read and write with the **browser
Supabase client under the user's session**; **RLS** (`auth.uid() = user_id`) is
the real boundary — changing a project id in the URL cannot reach another user's
data. Sharing never widens `projects`: `/share/$token` calls the
`get_shared_project(token)` `SECURITY DEFINER` function, the only anon path in,
and it returns a project **only** for a live, non-expired token.

**Cross-subdomain session.** "Open" builds
`…/?app=1&project=<id>#cs=<base64 tokens>`. Fragments are never sent to a server;
the editor's `CloudProjectManager` reads it, calls `setSession`, and **strips the
fragment from history** immediately. The editor then keeps its own persisted
session. (Production hardening option: a cookie scoped to `.atumx.in` instead of
the fragment handoff.)

**Auto-save (race-safe).** Store changes are debounced (~900 ms). Saves are
**single-flight with a trailing re-run**: only one `update` is ever in flight,
and any change during it triggers exactly one more save afterwards with the
latest snapshot — so an out-of-order response can never overwrite a newer
version. Identical snapshots are skipped (fingerprint compare). A final
best-effort save fires on tab hide/close via `fetch(..., {keepalive:true})`.

**Share / download.** Share mints/reuses an opaque token (`project_shares`).
Download serializes the project's `content` (the editor snapshot) to a
re-importable `.json`.

## 7. Testing checklist

- Signup → lands on `/dashboard`; refresh keeps you signed in; logout returns home.
- Invalid login / duplicate email show friendly errors.
- New Project → editor opens empty → build something → **Saved ✓** → "← Dashboard"
  → card shows "edited just now" → **Open** restores your work.
- Mark complete → moves to Completed filter; reopen → back to Drafts.
- Share → open the link in a private window → read-only view loads; delete →
  confirm → card gone.
- **RLS:** as user B, `GET /rest/v1/projects?id=eq.<user A's id>` returns `[]`.

## 8. Assumptions / notes

- Target = the **live** landing (`LANDING PAE- CONSTURCTA`); the old
  "AtumX Robot Forge" copy was left untouched.
- Project **title** (dashboard) and the editor's internal `content.name` are
  independent; renaming inside the editor doesn't rename the dashboard card.
- Dashboard **Download** exports JSON; STL/GLB export still lives inside the
  editor's own File menu.
- I could not create the Supabase objects, set secrets, or run the live
  cross-domain flow here — sections 3 & 5 are yours to run.
