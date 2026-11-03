# Google Ads dashboard — setup & how it works

**Dashboard:** https://constructa.atumx.in/ads-dashboard.html. It uses the same key as the UTM dashboard.

It puts two kinds of numbers side by side:

| From | Numbers | How they get here |
|---|---|---|
| **Google Ads** | spend, impressions, clicks, CTR, CPC, Google-counted conversions, keywords, search terms | [`google-ads-script.js`](google-ads-script.js) runs hourly inside Google Ads and rewrites the `ads_daily`, `ads_keywords`, `ads_terms` and `ads_meta` tabs of the analytics Sheet |
| **Our funnel** (`cx_events`) | ad visitors, sign-ups, workshop users, active builders, time building | the landing site and editor trackers, narrowed to visitors whose source is `google` with medium `cpc` |

Joining them gives **cost per sign-up** and **cost per active builder**, which Google Ads can't show on its own because it never sees what people do in the workshop.

```
Google Ads ──(Ads Script, hourly)──► Sheet: ads_* tabs ─┐
ad click ─► landing page ─► sign-up ─► workshop          ├─► collector (GET what=ads / events) ─► ads-dashboard.html
        (gclid + utm_* tags) ─────► Sheet: cx_events ────┘
```

The Google tag (`AW-18546217723`) on the landing site goes the **other** way. It only **sends** sign-up conversions to Google Ads, so Google can optimise bidding. It never reads anything back.

---

## One-time setup

### 1. Update the collector

1. Open the analytics Sheet → **Extensions → Apps Script**. Replace `Code.gs` with [`utm-collector.gs`](utm-collector.gs) → **Save**.
2. **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.** Edit the existing deployment, so the `/exec` URL stays the same.

Until this is done, the ads dashboard says the collector is an older version.

### 2. Add the Google Ads Script

1. Google Ads → **Tools → Bulk actions → Scripts → + New script**.
2. Paste [`google-ads-script.js`](google-ads-script.js). Set `SHEET_URL` to the analytics Sheet's URL. That's the Sheet with the `cx_events` tab, and the Google account you authorise with needs edit access to it.
3. **Authorise**, then **Run**. Check the log for `Synced N campaign-days…` and the four new `ads_*` tabs in the Sheet.
4. Back in the scripts list, set **Frequency → Hourly**.

### 3. Tag every ad click (Final URL suffix)

Google Ads → **Admin → Account settings → Tracking → Final URL suffix**:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}
```

`{campaignid}`, `{adgroupid}` and `{keyword}` are filled in by Google on each click. They're how sign-ups are matched to a campaign and a keyword. Without the suffix, ad clicks are still recognised through Google's click id (`gclid`), but they show up in the dashboard as **(no campaign tag)**.

Tagged ad clicks also show up in the UTM dashboard as source `google`. Their campaign there is the numeric campaign id; the ads dashboard shows the campaign names.

### 4. Sign-up conversion (landing site)

So that Google Ads optimises for sign-ups and not just clicks:

1. Google Ads → **Goals → Conversions → + New conversion action → Website**, for the domain `constructa-page.atumx.in`. Category **Sign-up**. Choose to add the tag yourself.
2. Copy the `send_to` value (`AW-18546217723/xxxxxxxx`) into `SIGNUP_SEND_TO` in the landing repo's `src/lib/google-ads.ts`.

---

## What the numbers mean

| Number | Definition |
|---|---|
| Spend, impressions, clicks, CTR, avg CPC | Google Ads' own figures for the selected days |
| Google conversions | conversions as Google Ads counts them (from the Google tag); can be fractional |
| Ad visitors | unique browsers that opened the landing page or workshop from an ad |
| Sign-ups from ads | new accounts whose sign-up arrived from an ad (internal emails hidden) |
| Cost per sign-up | spend ÷ sign-ups from ads, for the same days |
| Active builders | ad sign-up users who added a part, ran code, simulated, saved, exported, … (same rule as the UTM dashboard) |

- **Periods are whole days.** "Last 7 days" means today plus the 6 days before it, for both spend and sign-ups. Ad days are in the ad account's time zone and sign-up days are in your computer's. For an Indian account viewed in India, they're the same.
- **Freshness.** The Ads Script runs hourly, and Google's own numbers can lag a few hours behind. The sync line warns when the last sync is more than 3 hours old.
- **Google conversions and our sign-ups won't match exactly.** Google counts conversions by click date, across devices, and with its own attribution model. Our sign-ups are actual new accounts, counted on the day they signed up.
