/* =========================================
   Sterling Property Solutions — landing page logic
   ========================================= */

(function () {
  'use strict';
  if (/[?&]hm=1\b/.test(location.search)) document.documentElement.classList.remove('js');

  /* ---- Phone formatting ---- */
  function formatPhone(value) {
    var digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }

  function rawPhone(value) {
    return value.replace(/\D/g, '');
  }

  /* ---- Field validation helpers ---- */
  function setError(input, errorEl, msg) {
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    if (errorEl) errorEl.textContent = msg;
  }

  function clearError(input, errorEl) {
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    if (errorEl) errorEl.textContent = '';
  }

  function isValidEmail(val) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  }

  /* ---- Sticky mobile CTA: show once the form is off-screen ---- */
  (function () {
    var sticky = document.getElementById('stickyCta');
    var formCard = document.getElementById('lead-form');
    if (!sticky || !formCard || !('IntersectionObserver' in window)) return;
    var pastTop = false;
    new IntersectionObserver(function (entries) {
      var entry = entries[0];
      pastTop = entry.boundingClientRect.top < 0;
      sticky.classList.toggle('is-visible', !entry.isIntersecting && pastTop);
    }, { threshold: 0 }).observe(formCard);
  })();

  /* ---- Ad-matched hero + situation picker ---- */
  var HOOKS = {
    foreclosure: ['Behind on your mortgage?', 'Don\'t let the bank decide for you. <span class="hl-blue">Sell for cash, as-is.</span>', 'Tell us about the house. <strong>A real member of our team will reach out.</strong> No agents, no repairs, no fees.'],
    inherited: ['Inherited a house you don\'t want to deal with?', 'Skip the cleanout, the repairs and the listing. <span class="hl-blue">Sell for cash, as-is.</span>', 'Tell us about the property. <strong>A real member of our team will reach out.</strong> No agents, no repairs, no fees.'],
    divorce: ['Selling because of a divorce?', 'A fast, simple sale with no listing. <span class="hl-blue">Sell for cash, as-is.</span>', 'Tell us about the property. <strong>A real member of our team will reach out.</strong> No agents, no repairs, no fees.'],
    relocation: ['Relocating and need to sell?', 'Sell on your timeline, even from another city. <span class="hl-blue">Close in as little as 7 days.</span>', 'Tell us about the property. <strong>A real member of our team will reach out.</strong> No agents, no repairs, no fees.'],
    downsizing: ['Downsizing?', 'Move on to what\'s next without the hassle. <span class="hl-blue">Sell for cash, as-is.</span>', 'Tell us about the property. <strong>A real member of our team will reach out.</strong> No agents, no repairs, no fees.'],
    repairs: ['House needs too much work?', 'Sell it exactly as it is. <span class="hl-blue">No repairs, no cleaning.</span>', 'Tell us about the property. <strong>A real member of our team will reach out.</strong> No agents, no fees or commissions.']
  };
  var situationInput = document.getElementById('situation');
  function setSituation(key) {
    if (situationInput) situationInput.value = key || '';
    var hook = HOOKS[key];
    if (!hook) return;
    var k = document.getElementById('heroKicker'), hd = document.getElementById('heroHeadline'), sb = document.getElementById('heroSub');
    if (k) k.textContent = hook[0];
    if (hd) hd.innerHTML = hook[1];
    if (sb) sb.innerHTML = hook[2];
  }
  try { setSituation(new URLSearchParams(window.location.search).get('s')); } catch (_) {}
  /* ---- Form sheet: opens in place, no scroll jump ---- */
  var LABELS = { foreclosure: 'Behind on payments or facing foreclosure', inherited: 'Inherited property', divorce: 'Going through a divorce', relocation: 'Relocating', downsizing: 'Downsizing', repairs: 'Needs work', other: 'Something else going on' };
  var sheet = document.getElementById('sheet'), slot = document.getElementById('sheetSlot'), sheetSit = document.getElementById('sheetSituation');
  var formCard = document.getElementById('lead-form');
  var homeParent = formCard && formCard.parentNode, homeNext = formCard && formCard.nextSibling, lastFocus = null;
  function openSheet(key) {
    if (!sheet || !formCard) return;
    if (key && situationInput) {
      situationInput.value = key;
      try { var u = new URL(window.location.href); u.searchParams.set('s', key); window.history.replaceState(null, '', u.toString()); } catch (_) {}
    }
    var label = LABELS[situationInput && situationInput.value];
    sheetSit.hidden = !label; sheetSit.textContent = label ? 'Your situation: ' + label : '';
    lastFocus = document.activeElement;
    slot.appendChild(formCard);
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    setTimeout(function () { var f = formCard.querySelector('input'); if (f) f.focus({ preventScroll: true }); }, 80);
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    homeParent.insertBefore(formCard, homeNext);
    sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  if (sheet) {
    sheet.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  }
  document.querySelectorAll('.situation').forEach(function (btn) {
    btn.addEventListener('click', function () { openSheet(btn.getAttribute('data-s')); });
  });
  document.querySelectorAll('[data-open-sheet]').forEach(function (btn) {
    btn.addEventListener('click', function () { openSheet(); });
  });
  /* Every "Get my offer" button: focus the hero form if it's on screen, otherwise open the sheet */
  document.querySelectorAll('a[href="#lead-form"]').forEach(function (link) {
    if (link.classList.contains('skip-link')) return;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var r = formCard.getBoundingClientRect(), inHero = formCard.parentNode === homeParent;
      if (inHero && r.top < window.innerHeight * 0.7 && r.bottom > 0) {
        var f = formCard.querySelector('input'); if (f) f.focus();
      } else { openSheet(); }
    });
  });

  /* ---- Rough-offer calculator: value - 15% (commissions, closing, our profit) - repairs ---- */
  (function () {
    var val = document.getElementById('calcValue'), rep = document.getElementById('calcRepairs');
    if (!val || !rep) return;
    function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
    function num(el) { var d = el.value.replace(/[^0-9]/g, ''); return Math.min(Number(d || 0), 100000000); }
    function fmt(el) { var n = num(el); el.value = n ? n.toLocaleString('en-US') : ''; return n; }
    function run() {
      var v = fmt(val), r = fmt(rep), costs = v * 0.15, up = Math.max(0, v - costs - r);
      document.getElementById('calcA').textContent = money(v);
      document.getElementById('calcB').textContent = '\u2212' + money(costs);
      document.getElementById('calcR').textContent = '\u2212' + money(r);
      document.getElementById('calcC').textContent = money(up);
    }
    val.addEventListener('input', run); rep.addEventListener('input', run);
  })();

  /* ---- Reviews slideshow: auto-advances, pauses on hover/touch/focus, arrows + dots ---- */
  (function () {
    var root = document.getElementById('rv');
    if (!root) return;
    var slides = Array.prototype.slice.call(root.querySelectorAll('.rv-slide'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('.rv-dot'));
    var cur = 0, timer = null, inView = false, held = false;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function go(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle('is-on', k === cur); s.setAttribute('aria-hidden', k === cur ? 'false' : 'true'); });
      dots.forEach(function (d, k) { d.classList.toggle('is-on', k === cur); });
    }
    function stop() { clearInterval(timer); timer = null; }
    function play() { if (reduce || timer || held || !inView) return; timer = setInterval(function () { go(cur + 1); }, 7000); }
    function manual(i) { stop(); go(i); play(); }
    root.querySelector('.rv-prev').addEventListener('click', function () { manual(cur - 1); });
    root.querySelector('.rv-next').addEventListener('click', function () { manual(cur + 1); });
    dots.forEach(function (d) { d.addEventListener('click', function () { manual(Number(d.getAttribute('data-i'))); }); });
    root.addEventListener('mouseenter', function () { held = true; stop(); });
    root.addEventListener('mouseleave', function () { held = false; play(); });
    root.addEventListener('focusin', function () { held = true; stop(); });
    root.addEventListener('focusout', function () { held = false; play(); });
    var startX = null;
    root.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; stop(); }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (startX !== null) { var dx = e.changedTouches[0].clientX - startX; if (Math.abs(dx) > 45) go(cur + (dx < 0 ? 1 : -1)); }
      startX = null; play();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { inView = es[0].isIntersecting; if (inView) play(); else stop(); }, { threshold: 0.3 }).observe(root);
    } else { inView = true; play(); }
  })();

  /* ---- Reveal on scroll ---- */
  (function () {
    if (!('IntersectionObserver' in window)) return;
    var sel = '.section-title, .eyebrow, .section-sub, .step, .stack, .split-col, .about > div, .faq-item, .guarantee-inner > *, .cta-final .container';
    var els = document.querySelectorAll(sel);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el, i) {
      el.classList.add('reveal');
      if (el.classList.contains('step') || el.classList.contains('stat')) {
        var idx = Array.prototype.indexOf.call(el.parentNode.children, el);
        if (idx > 0) el.classList.add('d' + Math.min(idx, 3));
      }
      io.observe(el);
    });
  })();

  /* ---- Stats bar count-up (first view only) ---- */
  (function () {
    var nums = document.querySelectorAll('.proofbar-set:first-child [data-count]');
    var bar = document.querySelector('.proofbar');
    if (!nums.length || !bar || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    nums.forEach(function (n) { n.textContent = '0'; });
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      var start = performance.now(), dur = 1400;
      (function tick(now) {
        var t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
        nums.forEach(function (n) { n.textContent = Math.round(e * n.getAttribute('data-count')); });
        if (t < 1) requestAnimationFrame(tick);
      })(start);
    }, { threshold: 0.4 });
    io.observe(bar);
  })();

  /* ---- Main lead form ---- */
  var leadForm = document.getElementById('leadForm');
  if (!leadForm) return;

  var addressInput = document.getElementById('address');
  var phoneInput   = document.getElementById('phone');
  var emailInput   = document.getElementById('email');
  var consentInput = document.getElementById('smsConsent');
  var consentError = document.getElementById('consent-error');
  var submitBtn    = document.getElementById('submitBtn');

  phoneInput.addEventListener('input', function () {
    this.value = formatPhone(this.value);
  });

  [
    { el: addressInput, errId: 'address-error' },
    { el: phoneInput,   errId: 'phone-error' },
    { el: emailInput,   errId: 'email-error' },
  ].forEach(function (f) {
    f.el.addEventListener('input', function () {
      clearError(f.el, document.getElementById(f.errId));
    });
  });

  consentInput.addEventListener('change', function () {
    if (consentInput.checked) consentError.style.display = 'none';
  });

  leadForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var valid = true;

    var addrErr = document.getElementById('address-error');
    if (!addressInput.value.trim()) {
      setError(addressInput, addrErr, 'Please enter your property address.');
      valid = false;
    } else if (addressInput.dataset.placesReady === 'true' && !window._spsPlaceSelected) {
      setError(addressInput, addrErr, 'Please select your full address from the dropdown suggestions.');
      valid = false;
    } else {
      clearError(addressInput, addrErr);
    }

    var phoneErr = document.getElementById('phone-error');
    if (rawPhone(phoneInput.value).length < 10) {
      setError(phoneInput, phoneErr, 'Please enter a valid 10-digit phone number.');
      valid = false;
    } else {
      clearError(phoneInput, phoneErr);
    }

    var emailErr = document.getElementById('email-error');
    if (!isValidEmail(emailInput.value)) {
      setError(emailInput, emailErr, 'Please enter a valid email address.');
      valid = false;
    } else {
      clearError(emailInput, emailErr);
    }

    if (!consentInput.checked) {
      consentError.style.display = 'block';
      valid = false;
    }

    if (!valid) {
      var first = leadForm.querySelector('.is-invalid') || consentInput;
      first.focus();
      return;
    }

    var addrComponents = window._spsAddressComponents || {};

    /* Pull first-touch tracking captured on page load */
    var tracking = {};
    if (window.SPSTracking) {
      window.SPSTracking.populateHiddenFields(leadForm);
      tracking = window.SPSTracking.get();
    } else {
      try { tracking = JSON.parse(localStorage.getItem('sps_meta_tracking') || sessionStorage.getItem('sps_meta_tracking') || '{}'); } catch (_) {}
    }

    var lead = {
      address:  addressInput.value.trim(),
      street:   addrComponents.street || '',
      city:     addrComponents.city   || '',
      state:    addrComponents.state  || '',
      zip:      addrComponents.zip    || '',
      phone:    rawPhone(phoneInput.value),
      phoneFmt: phoneInput.value,
      email:    emailInput.value.trim(),
      situation: (situationInput && situationInput.value) || '',
      ts:       Date.now(),
      /* tracking */
      fbclid:       tracking.fbclid       || '',
      fbp:          tracking.fbp          || '',
      fbc:          tracking.fbc          || '',
      utm_source:   tracking.utm_source   || '',
      utm_medium:   tracking.utm_medium   || '',
      utm_campaign: tracking.utm_campaign || '',
      utm_content:  tracking.utm_content  || '',
      utm_term:     tracking.utm_term     || '',
      landing_variant:       tracking.landing_variant       || '',
      landing_page_url:      tracking.landing_page_url      || window.location.href,
      referrer:              tracking.referrer              || document.referrer || '',
      first_conversion_page: tracking.first_conversion_page || window.location.href,
      lead_created_date:     tracking.lead_created_date     || new Date().toISOString(),
      original_platform:     tracking.original_platform     || '',
      lead_event_id:         window.SPSTracking ? window.SPSTracking.leadEventId({}) : ('lead_' + Date.now()),
    };
    try { sessionStorage.setItem('sps_lead', JSON.stringify(lead)); } catch (_) {}

    /* InitiateCheckout — address + phone + email submitted, entering funnel */
    if (window.SPSTracking) window.SPSTracking.trackInitiateCheckout(lead);

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    fetch('/api/send-code', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone: lead.phone, lead: lead }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) throw new Error(data.error);
      /* brief delay so the pixel request is in flight before we navigate away */
      setTimeout(function () { window.location.href = '/verify'; }, 150);
    })
    .catch(function (err) {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      setError(phoneInput, document.getElementById('phone-error'), err.message || 'Something went wrong. Please try again.');
    });
  });
})();
