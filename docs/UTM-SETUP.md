# UTM tracking — see WhatsApp clicks from everyone

The app records how each visit arrived (`?utm_source=…`). By default that data
lives only in each visitor's own browser. To collect clicks from **all** visitors
into one place you own, connect a free Google Sheet. ~10 minutes, one time.

---

## Part A — Create the collector (Google Sheet + script)

1. Go to <https://sheets.new> to make a **new Google Sheet**. Name it anything
   (e.g. "UTM Clicks").
2. In the menu: **Extensions → Apps Script**. A code editor opens in a new tab.
3. Delete whatever is in `Code.gs`, then paste the entire contents of
   [`docs/utm-collector.gs`](utm-collector.gs) from this repo. Click **Save** (💾).
4. Click **Deploy → New deployment**.
   - Click the **gear ⚙ → Web app**.
   - **Description:** anything.
   - **Execute as:** *Me*.
   - **Who has access:** **Anyone**  ← important, or visitor clicks can't reach it.
   - Click **Deploy**. Approve/authorize when Google asks (it's your own script).
5. Copy the **Web app URL** it shows. It looks like:
   `https://script.google.com/macros/s/AKfy…long…/exec`
   **Keep this URL** — you need it in Parts B and C.

> Test it: paste that URL into a browser tab. You should see `[]` (an empty list).
> That means the server is live.

---

## Part B — Point the app at the collector

1. Open [`src/utils/utmTracking.js`](../src/utils/utmTracking.js).
2. Find this line near the top:
   ```js
   const COLLECTOR_ENDPOINT = ''
   ```
3. Paste your Web app URL between the quotes:
   ```js
   const COLLECTOR_ENDPOINT = 'https://script.google.com/macros/s/AKfy…/exec'
   ```
4. Rebuild + redeploy the site so visitors start reporting:
   ```bash
   npm run deploy
   ```
   (Ask me and I'll do this step for you.)

From now on, **every click on your app** — from WhatsApp, anywhere, anyone's
phone — adds a row to your Google Sheet.

---

## Part C — View everyone's clicks in the dashboard

1. Open your dashboard:
   `https://rahularulbalan-011105.github.io/Imaginarium/utm-dashboard.html`
2. In the **Server (Google Sheet)** box at the top, paste the **same Web app URL**
   and click **Load from server**.
3. The cards, tallies and table now show clicks from **all visitors**. The URL is
   remembered, so next time it loads automatically.

You can also just open the Google Sheet itself to see the raw rows.

---

## Make a link to share on WhatsApp

Use the **UTM link builder** in the dashboard, or write it by hand:

```
https://rahularulbalan-011105.github.io/Imaginarium/?utm_source=whatsapp&utm_medium=chat&utm_campaign=launch
```

- **utm_source** = where you shared it (`whatsapp`, `instagram`, …)
- **utm_medium** = the kind of channel (`chat`, `social`, `email`, …)
- **utm_campaign** = which push (`launch`, `demo-day`, …)

Share that link. Each person who taps it shows up in your dashboard, grouped by
source / medium / campaign.

---

### Notes
- The Apps Script URL must be deployed with access **"Anyone"** (Part A step 4),
  otherwise browsers can't post to it and the dashboard can't read it.
- If you change the script later, use **Deploy → Manage deployments → Edit →
  New version** so the same URL keeps working.
- Free-tier Apps Script easily handles normal campaign traffic.
