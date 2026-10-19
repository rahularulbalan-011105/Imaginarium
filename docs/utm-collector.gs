/**
 * Constructa analytics collector — Google Apps Script Web App (v2).
 *
 * ONE event stream for the whole funnel:
 *   landing page (constructa-page.atumx.in)  →  sign-up / login  →  editor (constructa.atumx.in)
 * Every row carries the visitor id (vid), the email (once known) and the
 * attribution (source / medium / campaign / content / term / ref) that brought
 * the visitor in. The dashboard (utm-dashboard.html) joins them per email.
 *
 * Tabs (created automatically, fresh — the old v1 tabs "visits", "events",
 * "links", "landing", "by_user" are NOT read any more and can be deleted):
 *   cx_events  — one row per event
 *   cx_links   — campaign links saved from the dashboard's link generator
 *
 * Accuracy guards:
 *   • unknown event names / apps are rejected (keeps junk out of the sheet)
 *   • each event has a unique eid → duplicates (beacon retries) are dropped
 *   • `received` = server time (client clocks can be wrong); client ts kept too
 *   • events from any host other than the two production hosts are stored with
 *     env = "test" and hidden by the dashboard
 *
 * Privacy: the sheet holds emails, so READING requires the dashboard key.
 *   1. Paste this file into Extensions → Apps Script (replace everything).
 *   2. Run the function `setup` once (▶ Run, choose "setup") and approve.
 *      It prints the DASHBOARD KEY in the execution log — copy it.
 *   3. Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy
 *      (keeps the same /exec URL the site already uses).
 *   4. Open https://constructa.atumx.in/utm-dashboard.html and enter the key.
 * Run `setup` again any time to rotate the key.
 */

var EVENTS_TAB = 'cx_events';
var EVENT_HEADERS = ['received', 'env', 'eid', 'app', 'event', 'email', 'vid', 'sid',
  'source', 'medium', 'campaign', 'content', 'term', 'ref', 'referrer',
  'page', 'device', 'value', 'meta', 'client_ts'];

var LINKS_TAB = 'cx_links';
var LINK_HEADERS = ['saved', 'label', 'url', 'base', 'source', 'medium', 'campaign', 'content', 'term', 'ref'];

var PROD_HOSTS = { 'constructa.atumx.in': 1, 'constructa-page.atumx.in': 1 };
var APPS = { landing: 1, editor: 1 };
var EVENTS = {
  // landing site
  landing_view: 1, cta_click: 1, updates_signup: 1, signup: 1, login: 1,
  open_editor: 1, whatsapp_click: 1,
  // editor
  editor_open: 1, email_entered: 1, session_time: 1, app_loaded: 1,
  shape_added: 1, preset_opened: 1, code_run: 1, sim_started: 1, battle_started: 1,
  arena_started: 1, project_saved: 1, export_json: 1, share_link_created: 1,
  tutorial_started: 1, tutorial_step: 1, tutorial_completed: 1, tutorial_exited: 1,
  whatsapp_join: 1, popup_dismiss: 1
};

function tab_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

function str_(v, max) { return v == null ? '' : String(v).slice(0, max || 200); }
function cleanEmail_(v) {
  var e = str_(v, 160).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

function doPost(e) {
  var v;
  try { v = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }

  if (v.type === 'cx_link') return saveLink_(v);
  if (v.type !== 'cx') return json_({ ok: false, error: 'ignored' });   // old v1 clients
  if (v.w !== WRITE_TOKEN) return json_({ ok: false, error: 'bad token' });
  if (!APPS[v.app] || !EVENTS[v.event]) return json_({ ok: false, error: 'unknown event' });
  if (!underWriteCap_()) return json_({ ok: false, error: 'rate limited' });

  var eid = str_(v.eid, 40);
  if (!eid) return json_({ ok: false, error: 'no eid' });
  var cache = CacheService.getScriptCache();
  if (cache.get('eid_' + eid)) return json_({ ok: true, dup: true });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (_) { /* append anyway */ }
  try {
    if (cache.get('eid_' + eid)) return json_({ ok: true, dup: true });
    var value = Number(v.value);
    tab_(EVENTS_TAB, EVENT_HEADERS).appendRow([
      new Date(),
      PROD_HOSTS[str_(v.host, 100).toLowerCase()] ? 'prod' : 'test',
      eid, v.app, v.event, cleanEmail_(v.email), str_(v.vid, 40), str_(v.sid, 40),
      str_(v.source, 100).trim().toLowerCase() || '(direct)', str_(v.medium, 100).trim().toLowerCase(),
      str_(v.campaign, 120).trim().toLowerCase(), str_(v.content, 120).trim().toLowerCase(), str_(v.term, 120), str_(v.ref, 80), str_(v.referrer, 300),
      str_(v.page, 300), str_(v.device, 20), isFinite(value) ? value : '',
      v.meta && typeof v.meta === 'object' ? JSON.stringify(v.meta).slice(0, 1000) : '',
      str_(v.ts, 40)
    ]);
    cache.put('eid_' + eid, '1', 21600);   // 6 h dedupe window
    return json_({ ok: true });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function saveLink_(v) {
  if (!keyOk_(v.key)) return json_({ ok: false, error: 'bad key' });
  tab_(LINKS_TAB, LINK_HEADERS).appendRow([
    new Date(), str_(v.label, 120), str_(v.url, 1000), str_(v.base, 200), str_(v.source, 100),
    str_(v.medium, 100), str_(v.campaign, 120), str_(v.content, 120), str_(v.term, 120), str_(v.ref, 80)
  ]);
  return json_({ ok: true });
}

// GET ?key=…&what=events|links|ping [&callback=fn]  (JSONP for the dashboard)
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.what === 'ping') return reply_({ ok: true, keySet: !!getKey_() }, p);
  if (!sigOk_(p)) return reply_({ ok: false, error: 'bad key' }, p);

  if (p.what === 'links') {
    var lk = tab_(LINKS_TAB, LINK_HEADERS).getDataRange().getValues();
    var links = [];
    for (var j = 1; j < lk.length; j++) {
      var l = lk[j];
      links.push({ saved: iso_(l[0]), label: l[1], url: l[2], base: l[3], source: l[4],
        medium: l[5], campaign: l[6], content: l[7], term: l[8], ref: l[9] });
    }
    return reply_({ ok: true, rows: links }, p);
  }

  var vals = tab_(EVENTS_TAB, EVENT_HEADERS).getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    // compact arrays (same order as EVENT_HEADERS) keep the payload small
    rows.push([iso_(r[0])].concat(r.slice(1, 19)).concat([String(r[19] || '')]));
  }
  return reply_({ ok: true, headers: EVENT_HEADERS, rows: rows }, p);
}

function iso_(d) { return d && d.toISOString ? d.toISOString() : String(d || ''); }

function getKey_() { return PropertiesService.getScriptProperties().getProperty('DASH_KEY') || ''; }

/** Raw-key check — only for POST bodies (never logged in a URL). */
function keyOk_(k) { var real = getKey_(); return !!real && String(k || '') === real; }

/**
 * Signed read check for GET. The dashboard sends ts + sig = HMAC-SHA256(ts, key)
 * instead of the key itself, so the key never lands in a URL, a server log or a
 * Referer header. The timestamp window limits replay of a captured signature.
 */
var SIG_WINDOW_MS = 5 * 60 * 1000;
function sigOk_(p) {
  var real = getKey_();
  if (!real || !p || !p.ts || !p.sig) return false;
  var ts = Number(p.ts);
  if (!isFinite(ts) || Math.abs(Date.now() - ts) > SIG_WINDOW_MS) return false;
  var raw = Utilities.computeHmacSha256Signature(String(p.ts), real);
  var want = Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
  return String(p.sig).replace(/=+$/, '') === want;
}

/**
 * Write token for event ingest. The collector URL is public (it ships in the
 * site's JavaScript), so this only raises the bar against drive-by posting — it
 * is NOT a secret and cannot authenticate a browser. Treat client-sent events as
 * untrusted: the hourly cap below protects the Sheet and the Apps Script quota,
 * and anything business-critical should be confirmed server-side instead.
 */
var WRITE_TOKEN = 'cx1_w7kQ2mBvRt';
var MAX_EVENTS_PER_HOUR = 5000;

function underWriteCap_() {
  var cache = CacheService.getScriptCache();
  var slot = 'cxrate_' + Math.floor(Date.now() / 3600000);
  var n = Number(cache.get(slot) || 0);
  if (n >= MAX_EVENTS_PER_HOUR) return false;
  cache.put(slot, String(n + 1), 3900);
  return true;
}

/** Run once from the editor: creates (or rotates) the dashboard key and the tabs. */
function setup() {
  var key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('DASH_KEY', key);
  tab_(EVENTS_TAB, EVENT_HEADERS);
  tab_(LINKS_TAB, LINK_HEADERS);
  Logger.log('DASHBOARD KEY: ' + key);
  return key;
}

function reply_(obj, p) {
  var payload = JSON.stringify(obj);
  var cb = p && p.callback;
  if (cb && /^[A-Za-z_$][\w$]{0,60}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + payload + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
