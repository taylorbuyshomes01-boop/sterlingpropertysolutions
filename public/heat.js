/* Sterling Property Solutions: anonymous click + scroll analytics for the heat map.
 * Loaded by consent.js ONLY after the visitor allows analytics.
 * Records: where a click landed (x as a fraction of page width, y in px), what was clicked (tag + class/id,
 * button text), which "situation" card was tapped, and how deep the visitor scrolled.
 * Never records: typed text, form values, names, phone numbers, emails, IP addresses, or screen recordings.
 */
(function () {
  'use strict';
  if (window.__spsHeat || /[?&]hm=1\b/.test(location.search)) return;
  window.__spsHeat = true;

  var sid = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).slice(0, 12);
  var queue = [], timer = null, maxDepth = 0, sentDepth = -1;

  function bucket() { var w = window.innerWidth; return w < 700 ? 'm' : (w < 1100 ? 't' : 'd'); }
  function docH() { return Math.max(document.documentElement.scrollHeight, document.body.scrollHeight); }
  function docW() { return document.documentElement.clientWidth || window.innerWidth; }

  function describe(el) {
    if (!el || !el.tagName) return '';
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/)[0] : '';
    var txt = '';
    if (tag === 'a' || tag === 'button' || tag === 'summary') txt = ' "' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32) + '"';
    return (tag + id + cls + txt).slice(0, 80);
  }

  function flush() {
    timer = null;
    if (!queue.length) return;
    var body = JSON.stringify({ sid: sid, ev: queue.splice(0, 40) });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/heat', new Blob([body], { type: 'application/json' }));
      else fetch('/api/heat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (_) {}
  }
  function push(ev) { queue.push(ev); if (!timer) timer = setTimeout(flush, 1500); }

  document.addEventListener('click', function (e) {
    var target = e.target.closest('a,button,summary,label,[data-s],[role="button"]') || e.target;
    var s = target.closest && target.closest('[data-s]');
    push({
      t: 'c', p: location.pathname, b: bucket(),
      x: +(e.pageX / docW()).toFixed(4), y: Math.round(e.pageY), h: docH(),
      e: describe(target), s: s ? s.getAttribute('data-s') : undefined
    });
  }, true);

  window.addEventListener('scroll', function () {
    var d = Math.round(((window.scrollY + window.innerHeight) / docH()) * 100);
    if (d > maxDepth) maxDepth = Math.min(100, d);
  }, { passive: true });

  function sendDepth() {
    if (maxDepth > sentDepth) { sentDepth = maxDepth; push({ t: 's', p: location.pathname, b: bucket(), d: maxDepth }); }
    flush();
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sendDepth(); });
  window.addEventListener('pagehide', sendDepth);
  push({ t: 'v', p: location.pathname, b: bucket() });
})();
