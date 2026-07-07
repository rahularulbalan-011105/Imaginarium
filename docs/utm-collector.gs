/**
 * UTM collector for the 3D Editor — Google Apps Script Web App.
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
 * Setup: see docs/UTM-SETUP.md.
 */

var SHEET_NAME = 'visits';
var HEADERS = ['received', 'ts', 'source', 'medium', 'campaign', 'term', 'content', 'referrer', 'landing', 'ua'];

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
      new Date(), v.ts || '', v.source || '', v.medium || '', v.campaign || '',
      v.term || '', v.content || '', v.referrer || '', v.landing || '', v.ua || ''
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
      ts:       r[1] || (r[0] && r[0].toISOString ? r[0].toISOString() : String(r[0])),
      source:   r[2], medium: r[3], campaign: r[4], term: r[5],
      content:  r[6], referrer: r[7], landing: r[8], ua: r[9],
      tagged:   !!(r[2] && r[2] !== '(direct)')
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
