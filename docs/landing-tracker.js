/**
 * Constructa landing-page tracker  →  Google Sheet ("landing" tab)
 * ----------------------------------------------------------------------------
 * Paste this whole file inside a <script> tag on constructa-page.atumx.in
 * (just before </body>). It records, to the SAME collector the app uses:
 *
 *   • a PAGE VIEW (once per tab-session), with UTM source/campaign/ref
 *   • an EARLY-ACCESS CLICK
 *   • an EMAIL SUBMIT (with the email address)
 *
 * View it all in utm-dashboard2.html.
 *
 * It is framework-agnostic (works on plain HTML, Framer, Webflow, Carrd, …) and
 * has ZERO dependencies. Sends are text/plain beacons → no CORS preflight.
 *
 * ── Wiring the two actions ──────────────────────────────────────────────────
 * AUTOMATIC (no code): it already
 *   • fires "email_submitted" on ANY <form> submit that contains an email input,
 *   • fires "early_access_click" on clicks of any element whose text contains
 *     "early access" / "get access" / "join", OR that has data-cta="early-access".
 * MANUAL (most reliable): call these from your own button/handlers —
 *     window.ctrack('early_access_click')
 *     window.ctrack('email_submitted', 'person@email.com')
 */
(function () {
  'use strict';

  // ⚠️ Same Apps Script Web-app URL the app uses (docs/utm-collector.gs deployment).
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxgWlc_0ZkVdtNGznRm1pCRmKZes18Yrm_XzgDknByKcRfiHxfNh6lfgM0EWIi2SKc0sw/exec';

  var SESSION_FLAG = 'constructa_landing_session';
  var CTA_WORDS = ['early access', 'get access', 'get early access', 'join', 'request access', 'sign up', 'signup'];

  // ── helpers ────────────────────────────────────────────────────────────────
  function qp(name) {
    try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; }
  }
  function deviceType() {
    var ua = navigator.userAgent || '';
    if (/Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
    if (/iPad|Tablet/i.test(ua)) return 'tablet';
    return 'desktop';
  }
  function sid() {
    try {
      var s = sessionStorage.getItem('constructa_landing_sid');
      if (!s) { s = 'ls_' + Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('constructa_landing_sid', s); }
      return s;
    } catch (e) { return 'ls_' + Date.now(); }
  }

  // UTM context is read once and attached to every ping.
  var CTX = {
    source:   qp('utm_source')   || '(direct)',
    medium:   qp('utm_medium')   || '(none)',
    campaign: qp('utm_campaign') || '(not set)',
    term:     qp('utm_term'),
    content:  qp('utm_content'),
    ref:      qp('ref'),
    referrer: document.referrer || '',
    url:      location.pathname + location.search
  };

  function send(sub, email) {
    var rec = {
      type: 'landing', sub: sub, sid: sid(), ts: new Date().toISOString(),
      email: email || '', source: CTX.source, medium: CTX.medium, campaign: CTX.campaign,
      term: CTX.term, content: CTX.content, ref: CTX.ref, device_type: deviceType(),
      referrer: CTX.referrer, url: CTX.url
    };
    var payload = JSON.stringify(rec);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
      } else {
        fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: payload });
      }
    } catch (e) { /* best-effort */ }
  }

  // Public manual API.
  window.ctrack = function (sub, email) { send(sub, email); };

  // ── 1. page view (once per tab-session) ──────────────────────────────────────
  try {
    if (!sessionStorage.getItem(SESSION_FLAG)) { sessionStorage.setItem(SESSION_FLAG, '1'); send('view'); }
  } catch (e) { send('view'); }

  // ── 2. early-access click (auto) ─────────────────────────────────────────────
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    for (var i = 0; el && i < 4; i++, el = el.parentElement) {   // walk up a few levels
      if (el.getAttribute && el.getAttribute('data-cta') === 'early-access') { send('early_access_click'); return; }
      var txt = (el.textContent || '').trim().toLowerCase();
      if (txt && txt.length < 40) {
        for (var j = 0; j < CTA_WORDS.length; j++) {
          if (txt.indexOf(CTA_WORDS[j]) >= 0) { send('early_access_click'); return; }
        }
      }
    }
  }, true);

  // ── 3. email submit (auto) ───────────────────────────────────────────────────
  function emailFrom(form) {
    var inp = form.querySelector('input[type="email"]') ||
              form.querySelector('input[name*="email" i]') ||
              form.querySelector('input[placeholder*="email" i]');
    return inp && inp.value ? inp.value.trim() : '';
  }
  document.addEventListener('submit', function (ev) {
    try {
      var email = emailFrom(ev.target);
      if (email) send('email_submitted', email);
    } catch (e) { /* ignore */ }
  }, true);
})();
