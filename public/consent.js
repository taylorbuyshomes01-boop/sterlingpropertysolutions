/* Sterling Property Solutions: cookie and tracking consent.
 *
 * Opt-in by default: nothing that tracks (Meta Pixel, Meta Conversions API, click/scroll analytics)
 * runs until the visitor says yes. "Essential" (the site itself, the form, the SMS code) always runs.
 * A browser Global Privacy Control signal counts as "reject" unless the visitor later opts in themselves.
 * Choice is stored in localStorage under sps_consent_v1 and can be changed from any "Your privacy choices" link.
 */
(function () {
  'use strict';
  var KEY = 'sps_consent_v1';
  var VERSION = 1;
  var listeners = [];
  var el = null;

  /* Heat-map viewer iframe: no banner, no tracking */
  if (/[?&]hm=1\b/.test(location.search)) {
    document.documentElement.classList.add('hm');
    window.SPSConsent = { has: function () { return false; }, get: function () { return null; }, onChange: function () {}, open: function () {} };
    return;
  }

  function read() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      return s && s.v === VERSION ? s : null;
    } catch (_) { return null; }
  }
  var gpc = !!navigator.globalPrivacyControl;
  var state = read();
  if (!state && gpc) state = { v: VERSION, analytics: false, marketing: false, gpc: true, ts: Date.now() };

  function has(cat) {
    if (cat === 'essential') return true;
    return !!(state && state[cat]);
  }

  function purgeMarketingCookies() {
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (/^(_fbp|_fbc|fbclid|_fbq|fr)$/i.test(name)) {
        document.cookie = name + '=; Max-Age=0; path=/';
        document.cookie = name + '=; Max-Age=0; path=/; domain=' + location.hostname;
        document.cookie = name + '=; Max-Age=0; path=/; domain=.' + location.hostname.replace(/^www\./, '');
      }
    });
    ['sps_meta_tracking'].forEach(function (k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (_) {} });
  }

  function save(next) {
    var prev = state;
    state = { v: VERSION, analytics: !!next.analytics, marketing: !!next.marketing, gpc: gpc, ts: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    if (prev && prev.marketing && !state.marketing) purgeMarketingCookies();
    listeners.slice().forEach(function (fn) { try { fn(state); } catch (_) {} });
    document.dispatchEvent(new CustomEvent('spsconsent', { detail: state }));
    loadAnalytics();
  }

  var heatLoaded = false;
  function loadAnalytics() {
    if (heatLoaded || !has('analytics')) return;
    heatLoaded = true;
    var s = document.createElement('script');
    s.src = '/heat.js?v=20261029-1'; s.async = true;
    document.head.appendChild(s);
  }

  function close() {
    if (el) { el.remove(); el = null; }
    document.body.classList.remove('consent-open');
  }

  function open(startCustom) {
    if (el) return;
    var cur = state || { analytics: false, marketing: false };
    el = document.createElement('div');
    el.className = 'consent-bar';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie and privacy choices');
    el.innerHTML =
      '<div class="consent-inner">' +
        '<div class="consent-copy">' +
          '<strong>Your privacy choices</strong>' +
          '<p>We use cookies and similar tools to run this site, understand how it is used, and measure our Facebook and Instagram ads. ' +
          'You pick what\'s allowed. Rejecting does not affect your offer. <a href="/privacy#cookies">Privacy Policy</a></p>' +
          (gpc ? '<p class="consent-gpc">Your browser\'s Global Privacy Control signal is on, so tracking is off unless you turn it on below.</p>' : '') +
        '</div>' +
        '<div class="consent-custom" hidden>' +
          '<label class="consent-row"><span><b>Essential</b><small>Runs the site, form and text-message verification. Always on.</small></span><input type="checkbox" checked disabled></label>' +
          '<label class="consent-row"><span><b>Analytics</b><small>Anonymous click and scroll data so we can improve this page. No names, no recordings.</small></span><input type="checkbox" id="cc-analytics"' + (cur.analytics ? ' checked' : '') + '></label>' +
          '<label class="consent-row"><span><b>Advertising</b><small>Meta Pixel and server-side events that measure our ads. This counts as "sharing" under some state privacy laws.</small></span><input type="checkbox" id="cc-marketing"' + (cur.marketing ? ' checked' : '') + '></label>' +
        '</div>' +
        '<div class="consent-actions">' +
          '<button type="button" class="consent-btn" data-c="reject">Reject non-essential</button>' +
          '<button type="button" class="consent-btn" data-c="custom">Customize</button>' +
          '<button type="button" class="consent-btn" data-c="accept">Accept all</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    document.body.classList.add('consent-open');
    var custom = el.querySelector('.consent-custom'), customBtn = el.querySelector('[data-c="custom"]');
    function showCustom() { custom.hidden = false; customBtn.textContent = 'Save my choices'; customBtn.setAttribute('data-c', 'save'); }
    if (startCustom) showCustom();
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]');
      if (!b) return;
      var c = b.getAttribute('data-c');
      if (c === 'accept') { save({ analytics: true, marketing: true }); close(); }
      else if (c === 'reject') { save({ analytics: false, marketing: false }); close(); }
      else if (c === 'custom') { showCustom(); }
      else if (c === 'save') {
        save({ analytics: el.querySelector('#cc-analytics').checked, marketing: el.querySelector('#cc-marketing').checked });
        close();
      }
    });
  }

  window.SPSConsent = {
    has: has,
    get: function () { return state; },
    onChange: function (fn) { listeners.push(fn); },
    open: function () { open(true); }
  };

  function init() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-consent-open]');
      if (t) { e.preventDefault(); if (el) close(); open(true); }
    });
    if (!read() && !gpc) open(false);
    loadAnalytics();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
