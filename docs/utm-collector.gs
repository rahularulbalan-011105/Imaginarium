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
  'medium', 'term', 'content', 'referrer', 'language', 'timezone', 'ua'];

// In-app engagement events (app_loaded, code_run, sim_started, share_link_created,
// project_saved, discord_join, email_submitted, …) land in a separate tab.
var EVENTS_NAME = 'events';
var EVENT_HEADERS = ['received', 'ts', 'sid', 'event', 't', 'source', 'campaign', 'ref', 'device_type', 'email', 'extra'];

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
    sheet_().appendRow([
      new Date(), v.ts || '', v.source || '', v.campaign || '', v.ref || '', v.landing || '',
      v.country || '', v.device_type || '', v.is_returning_visitor ? 'returning' : 'new',
      v.popup_action || '', v.session_duration || 0,
      v.medium || '', v.term || '', v.content || '', v.referrer || '', v.language || '', v.timezone || '', v.ua || ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doGet(e) {
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
      tagged: !!(r[2] && r[2] !== '(direct)')
    });
  }
  return reply_(out, e);
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
