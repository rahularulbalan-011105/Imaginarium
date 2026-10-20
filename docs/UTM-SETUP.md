# Constructa analytics — setup & how it works

One event stream covers the whole journey:

```
campaign link ─► landing page (constructa-page.atumx.in) ─► sign-up / login ─► workshop (constructa.atumx.in)
                 landing_view · cta_click · signup · login      editor_open · shape_added · code_run · sim_started · …
```

Every event is a row in the Google Sheet tab **`cx_events`**. Each row has:

- **vid**: a visitor id. The landing page creates it, and it is handed to the workshop in the URL (`?cx_vid=…`, removed from the address bar on arrival). This links landing visits and workshop activity to the same person.
- **email**: comes from the Supabase account (sign-up / login), or from the **email gate**. Nobody can use the workshop without entering an email.
- **tz / lang**: where the visitor is, as the **browser** already knows it — its IANA time zone (`Asia/Kolkata`) and UI language (`en-IN`). No IP address is read, stored or sent anywhere, and no third-party geolocation service is involved. The dashboard turns the zone into a city/country dot on the globe (`src/dashboard/geo.js`).
- **source / medium / campaign / content / ref**: from the campaign link. It is captured when the visitor arrives and stored in the browser, so it survives the jump to `/signup`, `/dashboard` and the workshop. Rule: explicit UTM > external referrer > previously stored > `(direct)`. The source is also saved on the Supabase account at sign-up (`signup_source`, `signup_campaign`, …).

Dashboard: **https://constructa.atumx.in/utm-dashboard.html** (protected by a key, because the data includes emails).

---

## One-time setup (Google Apps Script)

1. Open the Google Sheet that holds the analytics → **Extensions → Apps Script**.
2. Replace everything in `Code.gs` with [`docs/utm-collector.gs`](utm-collector.gs) → **Save**.
3. Choose the function **`setup`** in the toolbar → **▶ Run** → approve. Open **Execution log** and copy the
   `DASHBOARD KEY: …` value. (Run `setup` again any time to change the key.)
4. **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.**
   Editing the existing deployment keeps the same `/exec` URL that the site already uses. Don't create a new deployment.
5. Open the dashboard and paste the key.

Until step 4 is done, the live sites send v2 events that the old script ignores, so nothing is recorded.

> **Order matters when updating the script.** The dashboard now authenticates reads
> with a short-lived signature instead of sending the key in the URL. Deploy the
> new `utm-collector.gs` **before (or with)** the site, otherwise the dashboard
> reports \"Wrong dashboard key\" until the script is updated. Event collection is
> unaffected either way.

The old v1 tabs (`visits`, `events`, `links`, `landing`, `by_user`) are no longer used and can be deleted.

---

## Accuracy rules (what the numbers mean)

| Number | Definition |
|---|---|
| Visitors | unique browsers (vid) that opened the landing page or the workshop |
| Landing visits | landing-page browser sessions (one per tab session) |
| Try-free clicks | landing sessions that clicked "Try Constructa" |
| Sign-ups | new accounts (re-submitting an existing email is **not** counted) |
| Workshop users | unique emails that opened the workshop |
| Active builders | unique emails that added a part, opened a preset, ran code, simulated, battled, saved, exported or shared |
| Time building | per tab session, the **maximum** cumulative visible-tab time (pings are cumulative, so nothing is double-counted) |

**Where visitors are (the globe)**

- A time zone is a **region, not an address**: every visitor on `Asia/Kolkata` is one dot at Kolkata, whether they are in Chennai or Jaipur. Read the globe as "which parts of the world people come from", never as "where this person lives".
- Dot **area** is proportional to visitors, and a visitor (vid) is counted **once per place** however many events they fire.
- The legend says how many of the period's visitors could be located (`56 of 57`). Rows written before these columns existed, and browsers that report no zone, are counted as visitors but are not plotted — they are never guessed at.
- A zone that is not in the lookup table still appears, positioned by its continent and marked `≈` in the table.
- Land outlines are inlined in the page (Natural Earth 110m, public domain). The dashboard contacts no map server.

- **A person's source** is the source they **signed up** through. Accounts created before this tracking use the first non-direct source they arrived from (marked "first visit").
- Visit metrics follow the source of **that visit**. People metrics follow the **person's** source.
- Events without an email are linked to a person only when their browser (vid) or tab session belongs to **exactly one** email. Shared school computers are never guessed.
- Duplicates are removed (unique event id, deduplicated in the collector and again in the dashboard). Unknown event names are rejected.
- Times are the server's receive time. Traffic from any host other than the two production hosts (localhost, previews) is stored as `env = test` and hidden.
- Use **Hide internal emails** in the dashboard to drop your own team's accounts (for example `@atumx.in`).

## Making links

Use the dashboard's **Campaign link generator**. Pick a source, type a campaign (and optionally content/ref), then copy the link. **Save to list** to see each link's visitors / sign-ups / workshop users / active builders. Values are lower-cased and spaces become dashes, so `WhatsApp` and `whatsapp` never split into two rows.

## Code map

| Where | File |
|---|---|
| Collector (Apps Script) | `docs/utm-collector.gs` |
| Workshop tracking + email identity | `src/utils/utmTracking.js`, `src/components/EmailGate.jsx` |
| Dashboard | `utm-dashboard.html`, `src/dashboard/dashboard.js`, `src/dashboard/analyze.js` (tested in `tests/dashboard/`) |
| Visitor globe | `src/dashboard/globe.js` (canvas renderer), `src/dashboard/geo.js` (zone → place), `src/dashboard/world-land.js` (generated by `tools/build-world-rings.cjs`) |
| Landing tracking | landing repo `src/lib/landing-tracker.ts` (+ `auth.tsx`, `workspace.ts`, `SignupForm.tsx`, `Nav.tsx`, `share.$token.tsx`) |

**Adding a column** (this is how `tz`/`lang` were added): append it to `EVENT_HEADERS` **at the end** — never reorder, or every existing row shifts — add its value at the end of the `appendRow([...])` list, and redeploy the script as a new version. The collector adds the missing header cells to the existing sheet on the next write, and old rows simply carry blanks. `tests/dashboard/geo.test.js` checks the column list and the write stay in step.

To add a new tracked action: call `trackEvent('name')` in the workshop (or `ctrack('name')` on the landing). Add the name to `EVENTS` in `utm-collector.gs`, and redeploy the script as a new version.
