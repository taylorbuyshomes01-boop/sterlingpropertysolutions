/* Sterling Property Solutions — Meta attribution + pixel tracking
 *
 * Funnel → Meta event (browser pixel + server-side Conversions API, same event_id for dedupe):
 *   landing page view            → PageView + ViewContent
 *   step 1 form submit           → InitiateCheckout   (address + phone + email)
 *   phone verified & not listed  → Lead               (the qualified lead — optimize ads on this)
 *   survey finished              → CompleteRegistration
 *   CRM stage changes (server)   → QualifiedSeller / NewContract / PendingRevenue / ClosedRevenue
 */
(function () {
  'use strict';

  var META_PIXEL_ID = '1646013797266803';   /* same ID goes in Render as META_PIXEL_ID */
  var STORAGE_KEY = 'sps_meta_tracking';
  var COOKIE_DAYS = 90;
  var EVENTS = {
    start: 'InitiateCheckout',
    lead: 'Lead',
    complete: 'CompleteRegistration'
  };
  var ATTRIBUTION_KEYS = ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  /* ---- Consent gate: nothing below loads or fires until the visitor allows Advertising cookies ---- */
  function consentOK() { return !!(window.SPSConsent && window.SPSConsent.has('marketing')); }
  var pixelLoaded = false;
  function pixelReady() { return pixelLoaded && !!window.fbq && consentOK(); }

  /* ---- Meta Pixel base code (official snippet), loaded only after consent ---- */
  function loadPixel() {
    if (pixelLoaded || !consentOK() || !META_PIXEL_ID) return;
    pixelLoaded = true;
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  /* ---- helpers ---- */
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function setCookie(name, value) {
    if (!value) return;
    var expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  function readStored() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function writeStored(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'evt_' + Date.now() + '_' + Math.random().toString(16).slice(2);
  }

  function e164(phone) {
    var d = String(phone || '').replace(/\D/g, '');
    return d ? '+1' + d.slice(-10) : '';
  }

  /* ---- first-touch attribution ---- */
  function captureAttribution() {
    var params = new URLSearchParams(window.location.search);
    var stored = readStored();
    var next = Object.assign({}, stored);

    ATTRIBUTION_KEYS.forEach(function (key) {
      var value = params.get(key);
      if (value && !stored[key]) next[key] = value;
    });

    if (consentOK()) {
      if (!next.fbclid) next.fbclid = getCookie('fbclid');
      if (next.fbclid) setCookie('fbclid', next.fbclid);
      /* _fbp / _fbc are set by the pixel after it loads, so refresh them until we have them */
      var fbp = getCookie('_fbp');
      if (fbp) next.fbp = fbp;
      var fbc = getCookie('_fbc');
      if (!fbc && next.fbclid) fbc = 'fb.1.' + Date.now() + '.' + next.fbclid;
      if (fbc) next.fbc = fbc;
    } else {
      delete next.fbclid; delete next.fbp; delete next.fbc;   /* Meta click id + browser ids are advertising data */
    }

    if (!next.landing_variant) next.landing_variant = (document.documentElement.getAttribute('data-theme') || 'a').toLowerCase();
    if (!next.landing_page_url) next.landing_page_url = window.location.href;
    if (!next.referrer) next.referrer = document.referrer || '';
    if (!next.first_conversion_page) next.first_conversion_page = window.location.href;
    if (!next.lead_created_date) next.lead_created_date = new Date().toISOString();
    if (!next.original_platform) next.original_platform = inferPlatform(next);

    if (JSON.stringify(next) !== JSON.stringify(stored)) writeStored(next);
    return next;
  }

  function inferPlatform(data) {
    var source = (data.utm_source || '').toLowerCase();
    if (data.fbclid || /facebook|instagram|meta|^fb$|^ig$/.test(source)) return 'meta';
    return source || 'direct';
  }

  var HIDDEN_FIELDS = ['fbclid', 'fbp', 'fbc', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'landing_variant', 'landing_page_url', 'referrer', 'first_conversion_page', 'lead_created_date', 'original_platform'];

  function populateHiddenFields(form) {
    if (!form) return;
    var data = captureAttribution();
    HIDDEN_FIELDS.forEach(function (key) {
      var input = form.querySelector('[name="' + key + '"]');
      if (input) input.value = data[key] || '';
    });
  }

  function leadEventId(lead) {
    var id = lead && lead.lead_event_id;
    if (!id) id = uuid();
    if (lead) lead.lead_event_id = id;
    return id;
  }

  function leadValueFromTimeline(timeline) {
    var t = (timeline || '').toLowerCase();
    if (t.indexOf('asap') !== -1) return 50;
    if (t.indexOf('1 month') !== -1) return 35;
    if (t.indexOf('60') !== -1) return 25;
    if (t.indexOf('90') !== -1) return 15;
    if (t.indexOf('no timeline') !== -1) return 5;
    return 25;
  }

  /* Sends the same event server-side (Events API) with the shared event_id. */
  function sendServerEvent(name, eventId, value, lead) {
    if (!consentOK()) return Promise.resolve();
    var tracking = captureAttribution();
    return fetch('/api/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: name,
        event_id: eventId,
        value: value,
        lead: Object.assign({}, lead, tracking, {
          user_agent: navigator.userAgent,
          event_source_url: window.location.href
        })
      })
    }).catch(function () {});
  }

  /* Advanced matching: re-init with the lead's email/phone so Meta can match the event to a profile. */
  function identify(lead) {
    if (!pixelReady() || !lead || !(lead.email || lead.phone)) return;
    try {
      var um = {};
      if (lead.email) um.em = String(lead.email).trim().toLowerCase();
      if (lead.phone) um.ph = e164(lead.phone).replace(/\D/g, '');
      window.fbq('init', META_PIXEL_ID, um);
    } catch (_) {}
  }

  /* ---- events ---- */
  function trackViewContent() {
    if (pixelReady()) window.fbq('track', 'ViewContent', {
      content_type: 'product',
      content_name: 'Cash Offer Landing Page',
      content_category: 'Real Estate',
      currency: 'USD',
      value: 1
    }, { eventID: 'view_' + uuid() });
  }

  function trackInitiateCheckout(lead) {
    var eventId = 'start_' + uuid();
    identify(lead);
    if (pixelReady()) window.fbq('track', EVENTS.start, {
      content_type: 'product',
      content_name: 'Cash Offer Request',
      content_category: 'Real Estate',
      currency: 'USD',
      value: 5
    }, { eventID: eventId });
    sendServerEvent(EVENTS.start, eventId, 5, lead);
  }

  function trackLeadConversion(lead, done) {
    var eventId = leadEventId(lead || {});
    var value = leadValueFromTimeline(lead && lead.timeline);

    try {
      if (sessionStorage.getItem('sps_lead_conversion_sent') === eventId) {
        if (typeof done === 'function') done(eventId);
        return eventId;
      }
      sessionStorage.setItem('sps_lead_conversion_sent', eventId);
    } catch (_) {}

    identify(lead);
    if (pixelReady()) window.fbq('track', EVENTS.lead, {
      content_type: 'product',
      content_name: 'Qualified Seller Lead',
      content_category: 'Real Estate',
      currency: 'USD',
      value: value
    }, { eventID: eventId });
    sendServerEvent(EVENTS.lead, eventId, value, Object.assign({}, lead, { lead_event_id: eventId }));

    if (typeof done === 'function') window.setTimeout(function () { done(eventId); }, 300);
    return eventId;
  }

  function trackCompleteRegistration(lead) {
    try {
      if (sessionStorage.getItem('sps_complete_reg_sent')) return;
      sessionStorage.setItem('sps_complete_reg_sent', '1');
    } catch (_) {}
    var eventId = 'reg_' + (lead && lead.lead_event_id ? lead.lead_event_id : uuid());
    var value = leadValueFromTimeline(lead && lead.timeline);
    identify(lead);
    if (pixelReady()) window.fbq('track', EVENTS.complete, {
      content_type: 'product',
      content_name: 'Seller Survey Complete',
      currency: 'USD',
      value: value
    }, { eventID: eventId });
    sendServerEvent(EVENTS.complete, eventId, value, lead);
  }

  window.SPSTracking = {
    capture: captureAttribution,
    get: function () { return Object.assign({}, captureAttribution()); },
    populateHiddenFields: populateHiddenFields,
    trackViewContent: trackViewContent,
    trackInitiateCheckout: trackInitiateCheckout,
    trackLeadConversion: trackLeadConversion,
    trackCompleteRegistration: trackCompleteRegistration,
    leadEventId: leadEventId
  };

  var viewSent = false;
  function sendView() {
    if (viewSent || !pixelReady()) return;
    if (document.body && document.body.getAttribute('data-page') === 'landing') { viewSent = true; trackViewContent(); }
  }
  loadPixel();
  captureAttribution();

  document.addEventListener('DOMContentLoaded', function () {
    populateHiddenFields(document.getElementById('leadForm'));
    sendView();
  });
  /* Visitor accepts Advertising after the page loaded: start the pixel now */
  if (window.SPSConsent) window.SPSConsent.onChange(function () {
    if (consentOK()) { loadPixel(); captureAttribution(); populateHiddenFields(document.getElementById('leadForm')); setTimeout(sendView, 300); }
  });
})();
