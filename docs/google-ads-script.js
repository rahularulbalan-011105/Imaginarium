/**
 * Constructa — Google Ads → analytics Sheet sync (Google Ads Script).
 *
 * Runs INSIDE Google Ads (Tools → Bulk actions → Scripts), on an hourly schedule.
 * It copies the account's performance into the same Google Sheet the collector
 * (utm-collector.gs) writes to, so ads-dashboard.html can put ad spend next to the
 * sign-ups and workshop activity from cx_events. No developer token, no server.
 *
 * Tabs (rewritten in full on every run, so a run is always safe to repeat):
 *   ads_daily    — one row per campaign per day
 *   ads_keywords — one row per keyword per day (Search campaigns)
 *   ads_terms    — one row per search term per day (top by cost)
 *   ads_meta     — account name, currency, time zone, last sync time
 *
 * Dates are the ad account's own days (its time zone), written as plain text
 * 'yyyy-MM-dd' so Sheets never turns them into Date cells.
 *
 * Setup: docs/ADS-SETUP.md.
 */

// The analytics Sheet (the one with the cx_events tab). The Google account that
// authorises this script must be able to edit it.
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1O_AB6jhTPq0mm4rR5YpAZvgFqD8zbmwxgji_wwPJjNo/edit';

var DAYS = 90;              // history kept in the tabs
var MAX_TERM_ROWS = 2000;   // search terms are the only tab that can grow large (dashboard shows the top 100)

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var end = new Date();
  var start = new Date(end.getTime() - (DAYS - 1) * 86400000);
  var range = "segments.date BETWEEN '" + ymd_(start, tz) + "' AND '" + ymd_(end, tz) + "'";
  var ss = SpreadsheetApp.openByUrl(SHEET_URL);

  var daily = rows_(
    'SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM campaign WHERE ' + range + ' AND metrics.impressions > 0',
    function (r) {
      return [r.segments.date, String(r.campaign.id), r.campaign.name, r.campaign.status,
        r.campaign.advertisingChannelType, n_(r.metrics.impressions), n_(r.metrics.clicks),
        money_(r.metrics.costMicros), n_(r.metrics.conversions), n_(r.metrics.conversionsValue)];
    });
  write_(ss, 'ads_daily', ['date', 'campaign_id', 'campaign', 'status', 'channel',
    'impressions', 'clicks', 'cost', 'conversions', 'conv_value'], daily);

  var keywords = rows_(
    'SELECT segments.date, campaign.id, ad_group.id, ad_group.name, ad_group_criterion.keyword.text, ' +
    'ad_group_criterion.keyword.match_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM keyword_view WHERE ' + range + ' AND metrics.impressions > 0',
    function (r) {
      return [r.segments.date, String(r.campaign.id), String(r.adGroup.id), r.adGroup.name,
        r.adGroupCriterion.keyword.text, r.adGroupCriterion.keyword.matchType,
        n_(r.metrics.impressions), n_(r.metrics.clicks), money_(r.metrics.costMicros), n_(r.metrics.conversions)];
    });
  write_(ss, 'ads_keywords', ['date', 'campaign_id', 'ad_group_id', 'ad_group', 'keyword', 'match_type',
    'impressions', 'clicks', 'cost', 'conversions'], keywords);

  var terms = rows_(
    'SELECT segments.date, campaign.id, search_term_view.search_term, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM search_term_view WHERE ' + range + ' AND metrics.impressions > 0 ' +
    'ORDER BY metrics.cost_micros DESC LIMIT ' + MAX_TERM_ROWS,
    function (r) {
      return [r.segments.date, String(r.campaign.id), r.searchTermView.searchTerm,
        n_(r.metrics.impressions), n_(r.metrics.clicks), money_(r.metrics.costMicros), n_(r.metrics.conversions)];
    });
  write_(ss, 'ads_terms', ['date', 'campaign_id', 'search_term', 'impressions', 'clicks', 'cost', 'conversions'], terms);

  write_(ss, 'ads_meta', ['synced', 'account', 'customer_id', 'currency', 'time_zone', 'days'],
    [[new Date().toISOString(), account.getName(), account.getCustomerId(), account.getCurrencyCode(), tz, String(DAYS)]]);

  Logger.log('Synced ' + daily.length + ' campaign-days, ' + keywords.length + ' keyword-days, ' + terms.length + ' search-term rows.');
}

function rows_(query, map) {
  var out = [];
  var it = AdsApp.search(query);
  while (it.hasNext()) out.push(map(it.next()));
  return out;
}

var CHUNK = 500;   // rows per write: one big setValues on a busy Sheet can time out

/**
 * Replace a tab's contents. Everything is text-formatted first so dates stay strings.
 * Written in chunks, each retried, because the analytics Sheet is large (cx_events)
 * and Sheets intermittently times out ("Service Spreadsheets timed out").
 */
function write_(ss, name, headers, rows) {
  var sh = retry_(function () { return ss.getSheetByName(name) || ss.insertSheet(name); });
  var all = [headers].concat(rows).map(function (r) { return r.map(function (v) { return v == null ? '' : String(v); }); });
  var width = headers.length;
  retry_(function () {
    sh.clear();
    // Keep the tab only as big as its data, so the Sheet doesn't grow with every run.
    var extra = sh.getMaxRows() - all.length - 1;
    if (extra > 0) sh.deleteRows(all.length + 2, extra);
  });
  for (var i = 0; i < all.length; i += CHUNK) {
    var part = all.slice(i, i + CHUNK);
    retry_(function () {
      var range = sh.getRange(i + 1, 1, part.length, width);
      range.setNumberFormat('@');
      range.setValues(part);
    });
    SpreadsheetApp.flush();
  }
  sh.setFrozenRows(1);
}

/** Run fn, retrying up to 4 times with a growing pause when Sheets times out. */
function retry_(fn) {
  for (var attempt = 1; ; attempt++) {
    try { return fn(); } catch (e) {
      if (attempt >= 4) throw e;
      Logger.log('Sheets busy (' + e.message + '), retry ' + attempt + '…');
      Utilities.sleep(5000 * attempt);
    }
  }
}

function n_(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function money_(micros) { return Math.round(n_(micros) / 10000) / 100; }   // micros → currency, 2 dp
function ymd_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
