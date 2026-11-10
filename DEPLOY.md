# Deploying the 3D editor

> **Merging on GitHub does not make anything live.** After merging into `master`,
> deploy by hand with the steps below.

| | |
|---|---|
| **Live at** | https://constructa.atumx.in |
| **Repo / branch that goes live** | `Imaginarium` / **`master`** |
| **Hosted on** | GitHub Pages — serves the **`gh-pages`** branch |
| **How** | `npm run deploy` from your machine |

The landing page & dashboard (constructa-page.atumx.in) is a **separate app** in
the `landingpage` repo, deployed with Vercel — see `DEPLOY.md` in that repo.

A Vercel project named `constructa-battles` also exists, but it does **not**
serve the live editor (`constructa.atumx.in` points at GitHub Pages).

---

## Before the first deploy on a computer: the `.env` file

The build reads the Supabase settings from `.env` in the repo root. It is
git-ignored, so copy it onto a new machine first:

```
VITE_SUPABASE_URL="https://ywuvkzcnqqnjxqeogdnt.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<publishable key — same as the landing app's .env>"
VITE_DASHBOARD_URL="https://constructa-page.atumx.in/dashboard"
```

Without it the editor still builds, but opening dashboard projects and cloud
saving silently stop working on the live site.

## Deploy (every time)

```bash
cd /c/usman/atumx/Imaginarium
git checkout master
git pull origin master
npm install
npm run deploy
git checkout feature/bug-fixing
```

`npm run deploy`:

1. builds the editor (`vite build` with `VITE_BASE=./`, using `.env`);
2. pushes the built `dist/` to the **`gh-pages`** branch, including `CNAME` so the
   `constructa.atumx.in` domain is kept;
3. GitHub then runs **"pages build and deployment"** and publishes it (~1 minute).

**Check:** GitHub → Imaginarium → **Actions** — the new *pages build and
deployment* run turns green. Then open https://constructa.atumx.in in an
incognito window and hard-refresh (Ctrl+Shift+R). GitHub Pages may cache for a
few minutes.

## Roll back

Revert the bad commit on `master` and deploy again:

```bash
git checkout master
git revert <commit-hash>
git push origin master
npm run deploy
```

---

## Usual flow for a change

1. Work on a branch (e.g. `feature/bug-fixing`), commit, push it.
2. On GitHub, open a PR **into `master`** and merge with **Create a merge commit**.
3. Deploy with the steps above.
4. Test in an incognito window.

## Analytics events

`trackEvent(name)` sends to the Google Apps Script collector
(`docs/utm-collector.gs`), which **drops any event name not in its `EVENTS`
list**. Use an existing name (with `meta` to tell cases apart) or add the new
name to the script and redeploy the script.

## Local development

```bash
npm run dev        # http://localhost:5173/Imaginarium/
```

To open projects from the local dashboard and return to it, create
`.env.development.local` (git-ignored, read only by `npm run dev`):

```
VITE_SUPABASE_URL=<same as .env>
VITE_SUPABASE_PUBLISHABLE_KEY=<same as .env>
VITE_DASHBOARD_URL=http://localhost:8080/dashboard
```

Never put local URLs in `.env.local` — `npm run deploy` builds on your machine
and would ship them to the live site.

The email pop-up never shows on `localhost`. To test it, run
`npm run dev -- --host` and open the editor through the computer's network
address (e.g. `http://192.168.x.x:5173/Imaginarium/`), or test after deploying.

Local development uses the **production** Supabase database: changes to your own
robots locally are real changes.
