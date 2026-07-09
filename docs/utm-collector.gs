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

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(HEADERS); }
  return sh;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (_) {}
  try {
    var v = JSON.parse((e && e.postData && e.postData.contents) || '{}');
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
  var payload = JSON.stringify(out);
  var cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + payload + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);   // JSONP for the dashboard
  }
  return ContentService.createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
