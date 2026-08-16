/**
 * UTM collector for Constructa — Google Apps Script Web App.
 *
 * doPost  : a visit ping from the app → appends one row to the "visits" sheet.
 * doGet   : returns every row as JSON (JSONP via ?callback=) → the dashboard reads it.
 *
 * Cross-origin notes (why this works from GitHub Pages):
 *  - The app writes with navigator.sendBeacon / a text-plain POST → a "simple"
 *    request, so the browser sends NO CORS preflight (Apps Script can't answer
 *    preflight OPTIONS, which is why application/json POSTs fail).
 *  - The dashboard reads with JSONP (a <script> tag), which is not subject to CORS.
 *
 * NOTE: one row per session, sent at session end (carries session_duration +
 * popup_action). If you previously deployed the older schema, DELETE the old
 * "visits" tab once so it is recreated with the new header row, then Deploy →
 * Manage deployments → Edit → New version.
 *
 * Setup: see docs/UTM-SETUP.md.
 */

var SHEET_NAME = 'visits';
var HEADERS = ['received', 'ts', 'source', 'campaign', 'ref', 'landing', 'country',
  'device_type', 'is_returning_visitor', 'popup_action', 'session_duration',
  'medium', 'term', 'content', 'referrer', 'language', 'timezone', 'ua', 'sid'];

// In-app engagement events (app_loaded, code_run, sim_started, share_link_created,
// project_saved, discord_join, email_submitted, …) land in a separate tab.
var EVENTS_NAME = 'events';
var EVENT_HEADERS = ['received', 'ts', 'sid', 'event', 't', 'source', 'campaign', 'ref', 'device_type', 'email', 'extra'];

// Generated campaign links you build + "Save to sheet" in the dashboard land here,
// so every link you hand out is in one registry (separate from the visits tab).
var LINKS_NAME = 'links';
var LINK_HEADERS = ['saved', 'label', 'url', 'source', 'medium', 'campaign', 'ref', 'term', 'content'];

// Landing-page activity (constructa-page.atumx.in): page views + early-access
// clicks + email submits, each a row with a "sub" action type. Read by utm-dashboard2.
var LANDING_NAME = 'landing';
var LANDING_HEADERS = ['received', 'ts', 'sid', 'sub', 'email', 'source', 'medium',
  'campaign', 'ref', 'term', 'content', 'country', 'device_type', 'referrer', 'url'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(HEADERS); }
  return sh;
}
function eventsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EVENTS_NAME);
  if (!sh) { sh = ss.insertSheet(EVENTS_NAME); sh.appendRow(EVENT_HEADERS); }
  return sh;
}
function linksSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LINKS_NAME);
  if (!sh) { sh = ss.insertSheet(LINKS_NAME); sh.appendRow(LINK_HEADERS); }
  return sh;
}
function landingSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LANDING_NAME);
  if (!sh) { sh = ss.insertSheet(LANDING_NAME); sh.appendRow(LANDING_HEADERS); }
  return sh;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (_) {}
  try {
    var v = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (v.type === 'event') {
      var known = { type:1, event:1, sid:1, ts:1, t:1, source:1, campaign:1, ref:1, device_type:1, email:1 };
      var extra = {};
      for (var k in v) if (!known[k]) extra[k] = v[k];
      eventsSheet_().appendRow([
        new Date(), v.ts || '', v.sid || '', v.event || '', v.t || 0,
        v.source || '', v.campaign || '', v.ref || '', v.device_type || '',
        v.email || '', Object.keys(extra).length ? JSON.stringify(extra) : ''
      ]);
      return json_({ ok: true });
    }
    if (v.type === 'link') {                    // a generated campaign link → links tab
      linksSheet_().appendRow([
        new Date(), v.label || '', v.url || '', v.source || '', v.medium || '',
        v.campaign || '', v.ref || '', v.term || '', v.content || ''
      ]);
      return json_({ ok: true });
    }
    if (v.type === 'landing') {                  // landing-page view/click/email → landing tab
      landingSheet_().appendRow([
        new Date(), v.ts || '', v.sid || '', v.sub || 'view', v.email || '',
        v.source || '', v.medium || '', v.campaign || '', v.ref || '', v.term || '', v.content || '',
        v.country || '', v.device_type || '', v.referrer || '', v.url || ''
      ]);
      return json_({ ok: true });
    }
    sheet_().appendRow([
      new Date(), v.ts || '', v.source || '', v.campaign || '', v.ref || '', v.landing || '',
      v.country || '', v.device_type || '', v.is_returning_visitor ? 'returning' : 'new',
      v.popup_action || '', v.session_duration || 0,
      v.medium || '', v.term || '', v.content || '', v.referrer || '', v.language || '', v.timezone || '', v.ua || '',
      v.id || v.sid || ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doGet(e) {
  // ?landing=1 → landing-page activity; ?links=1 → saved-links; ?events=1 → events; else visits.
  if (e && e.parameter && e.parameter.landing) {
    var la = landingSheet_().getDataRange().getValues();
    var laOut = [];
    for (var p = 1; p < la.length; p++) {
      var pr = la[p];
      laOut.push({
        ts: pr[1] || (pr[0] && pr[0].toISOString ? pr[0].toISOString() : String(pr[0])),
        sid: pr[2], sub: pr[3], email: pr[4], source: pr[5], medium: pr[6], campaign: pr[7],
        ref: pr[8], term: pr[9], content: pr[10], country: pr[11], device_type: pr[12],
        referrer: pr[13], url: pr[14], tagged: !!(pr[5] && pr[5] !== '(direct)')
      });
    }
    return reply_(laOut, e);
  }
  // ?links=1 → the saved-links registry; ?events=1 → the events tab; else visits.
  if (e && e.parameter && e.parameter.links) {
    var lk = linksSheet_().getDataRange().getValues();
    var lkOut = [];
    for (var m = 1; m < lk.length; m++) {
      var lr = lk[m];
      lkOut.push({
        saved: lr[0] && lr[0].toISOString ? lr[0].toISOString() : String(lr[0]),
        label: lr[1], url: lr[2], source: lr[3], medium: lr[4], campaign: lr[5],
        ref: lr[6], term: lr[7], content: lr[8]
      });
    }
    return reply_(lkOut, e);
  }
  // ?events=1 → return the events tab; otherwise the visits tab.
  if (e && e.parameter && e.parameter.events) {
    var ev = eventsSheet_().getDataRange().getValues();
    var evOut = [];
    for (var j = 1; j < ev.length; j++) {
      var er = ev[j];
      evOut.push({ ts: er[1], sid: er[2], event: er[3], t: er[4], source: er[5], campaign: er[6], ref: er[7], device_type: er[8], email: er[9], extra: er[10] });
    }
    return reply_(evOut, e);
  }
  var values = sheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {           // row 0 = headers
    var r = values[i];
    out.push({
      ts: r[1] || (r[0] && r[0].toISOString ? r[0].toISOString() : String(r[0])),
      source: r[2], campaign: r[3], ref: r[4], landing: r[5], country: r[6],
      device_type: r[7], is_returning_visitor: r[8], popup_action: r[9], session_duration: r[10],
      medium: r[11], term: r[12], content: r[13], referrer: r[14], language: r[15], timezone: r[16], ua: r[17],
      sid: r[18] || '',
      tagged: !!(r[2] && r[2] !== '(direct)')
    });
  }
  return reply_(out, e);
}

// ── Per-user summary tab ─────────────────────────────────────────────────────
// Scans the "events" tab and (re)builds a "by_user" tab: ONE ROW PER USER
// (session id) with their action counts — run code, simulations, shapes,
// Export JSON, furthest tutorial step, etc.
// Run it from the editor (Run ▸ rebuildUserSummary), from the UTM menu that
// appears on the sheet, or add a time-driven trigger to keep it fresh.
var BY_USER_NAME = 'by_user';
var BY_USER_HEADERS = ['sid', 'source', 'campaign', 'ref', 'code_run', 'sim_started',
  'shapes_added', 'shapes_peak', 'export_json', 'furthest_step', 'total_events', 'first_seen', 'last_seen'];

function rebuildUserSummary() {
  var ev = eventsSheet_().getDataRange().getValues();
  var u = {};
  for (var i = 1; i < ev.length; i++) {                 // row 0 = headers
    var r = ev[i];
    var ts = r[1], sid = r[2] || '(no id)', name = r[3], source = r[5], campaign = r[6], ref = r[7], extra = r[10];
    var o = u[sid] || (u[sid] = { sid: sid, source: source || '', campaign: campaign || '', ref: ref || '',
      code_run: 0, sim_started: 0, shapes_added: 0, shapes_peak: 0, export_json: 0, step: 0, events: 0, first: ts, last: ts });
    o.events++;
    if (source) o.source = source;
    if (campaign) o.campaign = campaign;
    if (ref) o.ref = ref;
    if (ts && (!o.first || ts < o.first)) o.first = ts;
    if (ts && ts > o.last) o.last = ts;
    if (name === 'code_run') o.code_run++;
    else if (name === 'sim_started') o.sim_started++;
    else if (name === 'export_json') o.export_json++;
    else if (name === 'shape_added') { o.shapes_added++; var n = 0; try { n = (JSON.parse(extra || '{}').count) | 0; } catch (e) {} if (n > o.shapes_peak) o.shapes_peak = n; }
    else if (name === 'tutorial_step') { var st = 0; try { st = (JSON.parse(extra || '{}').step) | 0; } catch (e) {} if (st > o.step) o.step = st; }
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(BY_USER_NAME);
  if (!sh) sh = ss.insertSheet(BY_USER_NAME); else sh.clear();
  sh.appendRow(BY_USER_HEADERS);
  var rows = Object.keys(u).map(function (k) {
    var o = u[k];
    return [o.sid, o.source, o.campaign, o.ref, o.code_run, o.sim_started,
      o.shapes_added, o.shapes_peak, o.export_json, o.step, o.events, o.first, o.last];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, BY_USER_HEADERS.length).setValues(rows);
  return rows.length + ' users summarised';
}

// Adds a "UTM ▸ Rebuild per-user summary" menu to the spreadsheet.
function onOpen() {
  try { SpreadsheetApp.getUi().createMenu('UTM').addItem('Rebuild per-user summary', 'rebuildUserSummary').addToUi(); }
  catch (e) { /* not a bound context */ }
}

// JSONP (if ?callback=) or plain JSON.
function reply_(obj, e) {
  var payload = JSON.stringify(obj);
  var cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + payload + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
