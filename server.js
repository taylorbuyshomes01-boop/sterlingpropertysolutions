'use strict';

require('dotenv').config();
const express = require('express');
const twilio  = require('twilio');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const zlib    = require('zlib');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const SITE_ORIGIN = 'https://offer.sterlingpropertysolutions.org';

/* Real visitor IP. Render's edge (Cloudflare) overwrites CF-Connecting-IP, so unlike the leftmost
   X-Forwarded-For entry a visitor cannot spoof it to dodge the rate limits below. */
function visitorIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.ip || (req.socket && req.socket.remoteAddress) || '').trim();
}

/* ── Security headers ──────────────────────────────────────────────────────
   Only directives that cannot break the Meta pixel / Google Places are enforced (anti-clickjacking,
   no <base>/form hijacking, no plugins). A script-src allowlist is deliberately not set. */
const FUNNEL_PATHS = new Set(['/verify', '/property', '/success', '/not-a-fit']);
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const p = req.path.replace(/\.html$/, '');
  /* Funnel steps, the API and the Markdown mirrors stay out of search results (the mirrors duplicate the HTML pages). */
  if (FUNNEL_PATHS.has(p) || p.startsWith('/api/') || p.startsWith('/admin') || /\.md$/i.test(req.path)) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }
  if (/\.md$/i.test(req.path)) {
    const page = req.path === '/index.md' ? '/' : req.path.replace(/\.md$/i, '');
    if (req.path !== '/sitemap.md') res.set('Link', `<${SITE_ORIGIN}${page}>; rel="canonical"`);
  }
  next();
});

/* ── Abuse protection: in-memory rate limits (single Render instance) ──────── */
const rateBuckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  const rec = rateBuckets.get(key);
  if (!rec || now - rec.t > windowMs) { rateBuckets.set(key, { n: 1, t: now }); return true; }
  rec.n += 1;
  return rec.n <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now - v.t > 3600000) rateBuckets.delete(k);
}, 600000).unref();

function limited(name, max, windowMs, keyFn) {
  return (req, res, next) => {
    const key = `${name}|${keyFn ? keyFn(req) : visitorIp(req)}`;
    if (hit(key, max, windowMs)) return next();
    res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
    return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again, or call us.' });
  };
}

/* Browser-only endpoints must come from our own pages (blocks cross-site form posts and drive-by abuse). */
function sameSiteOnly(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host === req.headers.host) return next(); } catch (_) {}
    return res.status(403).json({ error: 'Forbidden.' });
  }
  if (req.headers['sec-fetch-site'] === 'same-origin') return next();
  return res.status(403).json({ error: 'Forbidden.' });
}

/* Compression: brotli when the browser supports it (smaller), gzip otherwise. Compressed copies of static
   files are cached in memory so repeat requests cost no CPU. API and admin responses are never cached. */
const zCache = new Map();
app.use((req, res, next) => {
  const ae = req.headers['accept-encoding'] || '';
  const enc = /\bbr\b/.test(ae) ? 'br' : (/\bgzip\b/.test(ae) ? 'gzip' : '');
  if (!enc || req.method === 'HEAD') return next();

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const chunks = [];
  const cacheable = req.method === 'GET' && !/^\/(api|admin)\b/.test(req.path);

  res.write = (chunk, encoding, cb) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    if (typeof cb === 'function') cb();
    return true;
  };

  res.end = (chunk, encoding, cb) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    const body = Buffer.concat(chunks);
    const type = res.getHeader('Content-Type') || '';
    const shouldCompress = body.length > 1024 && /text|javascript|json|svg|xml/i.test(String(type));

    const finish = (compressed) => {
      res.setHeader('Content-Encoding', enc);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', compressed.length);
      originalWrite(compressed);
      originalEnd(null, null, cb);
    };

    if (!shouldCompress || res.getHeader('Content-Encoding')) {
      if (body.length) originalWrite(body);
      return originalEnd(null, null, cb);
    }

    const key = cacheable ? `${enc}|${req.originalUrl}|${body.length}` : '';
    if (key && zCache.has(key)) return finish(zCache.get(key));

    const done = (err, compressed) => {
      if (err) {
        if (body.length) originalWrite(body);
        return originalEnd(null, null, cb);
      }
      if (key) { if (zCache.size > 200) zCache.clear(); zCache.set(key, compressed); }
      finish(compressed);
    };
    if (enc === 'br') zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }, done);
    else zlib.gzip(body, { level: 6 }, done);
    return true;
  };

  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(['/api/send-code', '/api/verify-code', '/api/not-listed', '/api/submit-survey', '/api/track-event'], sameSiteOnly);

/* Only files inside /public are ever served (never server.js, .env, data/, etc). */
const PUBLIC_DIR = path.join(__dirname, 'public');

const PAGE_ROUTES = {
  '/verify': 'verify.html',
  '/property': 'property.html',
  '/success': 'success.html',
  '/not-a-fit': 'not-a-fit.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
};

app.get(['/index.html', ...Object.keys(PAGE_ROUTES).map((route) => `${route}.html`)], (req, res) => {
  if (req.path === '/index.html') return res.redirect(301, '/');
  res.redirect(301, req.path.replace(/\.html$/, ''));
});

app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  setHeaders(res, filePath) {
    const versioned = !!(res.req && res.req.query && res.req.query.v);
    if (/\.woff2$/i.test(filePath) || (versioned && /\.(?:css|js)$/i.test(filePath))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    if (/\.(?:css|js|png|jpe?g|webp|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

Object.entries(PAGE_ROUTES).forEach(([route, fileName]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, fileName));
  });
});

/* ── Config ────────────────────────────────────────────────────────────── */
function compact(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, 1000);
}

function normalizeTwilioSid(value) {
  return compact(value).replace(/^SID=/i, '');
}

const client     = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const VERIFY_SID = normalizeTwilioSid(process.env.TWILIO_VERIFY_SERVICE_SID);

/* GoHighLevel webhooks for this site only. Set them as environment variables (Render); never reuse another site's. */
const GHL_WEBHOOK_VERIFY = process.env.GHL_WEBHOOK_VERIFY ||
  '';
/* Fires the moment the first form (address + phone + email) is submitted, before the SMS code is sent. */
const GHL_WEBHOOK_FORM = process.env.GHL_WEBHOOK_FORM ||
  '';
const GHL_WEBHOOK_SURVEY = process.env.GHL_WEBHOOK_SURVEY ||
  '';

[['GHL_WEBHOOK_FORM', GHL_WEBHOOK_FORM], ['GHL_WEBHOOK_VERIFY', GHL_WEBHOOK_VERIFY], ['GHL_WEBHOOK_SURVEY', GHL_WEBHOOK_SURVEY]]
  .forEach(([name, url]) => { if (!url) console.warn(`[config] ${name} is not set: that lead step will NOT reach the CRM until you add it in the environment.`); });

const META_PIXEL_ID = process.env.META_PIXEL_ID || '';
const META_GRAPH_VERSION = 'v21.0';
const OFFLINE_EVENT_LOG = path.join(__dirname, 'data', 'offline-events.json');

/* CRM pipeline stage → Meta custom event (fired server-side only). */
const OFFLINE_EVENTS = {
  qualified_seller: {
    label: 'Qualified Seller',
    metaName: 'QualifiedSeller',
    value: 150,
    stages: ['hot / working', 'appointment set', 'verbal offer', 'contract sent'],
  },
  new_contract: {
    label: 'New Contract',
    metaName: 'NewContract',
    value: 1000,
    stages: ['new contract'],
  },
  pending_revenue: {
    label: 'Pending Revenue',
    metaName: 'PendingRevenue',
    value: 5000,
    stages: ['assignment sent', 'emd received - pending closing'],
  },
  closed_revenue: {
    label: 'Closed Revenue',
    metaName: 'ClosedRevenue',
    value: 10000,
    stages: ['closed & funded'],
  },
};

/* ── Helpers ───────────────────────────────────────────────────────────── */
function toE164(phone) {
  const digits = phone.replace(/\D/g, '');
  return '+1' + (digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits.slice(-10));
}

function envIsSet(name) {
  return Boolean((process.env[name] || '').trim());
}

function digitsOnly(value) {
  return compact(value).replace(/\D/g, '');
}

function normalizeStage(value) {
  return compact(value).toLowerCase().replace(/\s+/g, ' ');
}

function pick(obj, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((cur, part) => cur && cur[part], obj);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function sha256(value) {
  const normalized = compact(value).toLowerCase();
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : '';
}

/* Real US mobile-style numbers only (NANP rules). Also keeps SMS-pumping to premium/foreign ranges out. */
function validUsPhone(phone) {
  const d = digitsOnly(phone);
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) && !/^(\d)\1+$/.test(ten);
}

function validEmail(email) {
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(compact(email)) && compact(email).length <= 254;
}

/* Proof that a phone passed Twilio Verify: HMAC(phone|expiry), valid for 2 hours. The survey endpoints
   refuse to forward a lead to GoHighLevel without it, so nobody can POST fake leads straight at them. */
const TOKEN_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_KEY || process.env.TWILIO_AUTH_TOKEN || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 2 * 3600 * 1000;
function phoneKey(phone) {
  const d = digitsOnly(phone);
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d.slice(-10);
}
function signVerified(phone) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(`${phoneKey(phone)}|${exp}`).digest('hex');
  return `${exp}.${sig}`;
}
function checkVerified(token, phone) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const want = crypto.createHmac('sha256', TOKEN_SECRET).update(`${phoneKey(phone)}|${exp}`).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ensureEventLog() {
  fs.mkdirSync(path.dirname(OFFLINE_EVENT_LOG), { recursive: true });
  if (!fs.existsSync(OFFLINE_EVENT_LOG)) fs.writeFileSync(OFFLINE_EVENT_LOG, '{}\n');
}

function readEventLog() {
  ensureEventLog();
  try {
    return JSON.parse(fs.readFileSync(OFFLINE_EVENT_LOG, 'utf8') || '{}');
  } catch (_) {
    return {};
  }
}

function writeEventLog(log) {
  ensureEventLog();
  fs.writeFileSync(OFFLINE_EVENT_LOG, JSON.stringify(log, null, 2) + '\n');
}

function isMetaLead(data) {
  const platform = normalizeStage(data.original_platform);
  const utmSource = normalizeStage(data.utm_source);
  return platform === 'meta' || Boolean(compact(data.fbclid)) || /facebook|instagram|^fb$|^ig$|^meta$/.test(utmSource);
}

function leadSourceFromAttribution(data) {
  if (isMetaLead(data)) {
    return {
      lead_source: 'Meta Ads',
      source_platform: 'meta',
      source_route: 'meta_ads',
      is_meta_lead: 'true',
    };
  }

  const platform = normalizeStage(data.original_platform);
  const utmSource = normalizeStage(data.utm_source);
  return {
    lead_source: 'Website / Organic',
    source_platform: platform || utmSource || 'website',
    source_route: 'website_other',
    is_meta_lead: 'false',
  };
}

function buildLeadPayload(lead, phone, source) {
  const firstName = compact(lead.firstName || lead.first_name);
  const lastName = compact(lead.lastName || lead.last_name);
  const fullName = compact(lead.name || `${firstName} ${lastName}`);
  const phoneDigits = digitsOnly(phone || lead.phone);
  const phoneE164 = phoneDigits ? `+1${phoneDigits.length === 11 && phoneDigits[0] === '1' ? phoneDigits.slice(1) : phoneDigits.slice(-10)}` : '';
  const address = compact(lead.address || lead.full_address || lead.property_address);

  const customData = {
    full_address: address,
    property_address: address,
    street: compact(lead.street),
    city: compact(lead.city),
    state: compact(lead.state),
    zip: compact(lead.zip),
    timeline: compact(lead.timeline),
    repairs: compact(lead.repairs),
    reason: compact(lead.reason),
    listed: compact(lead.listed),
    situation: compact(lead.situation),
    property_type: compact(lead.propertyType),
    land_owned: compact(lead.landOwned),
    utm_source: compact(lead.utm_source),
    utm_medium: compact(lead.utm_medium),
    utm_campaign: compact(lead.utm_campaign),
    utm_content: compact(lead.utm_content),
    utm_term: compact(lead.utm_term),
    fbclid: compact(lead.fbclid),
    fbp: compact(lead.fbp),
    fbc: compact(lead.fbc),
    landing_variant: compact(lead.landing_variant),
    landing_page_url: compact(lead.landing_page_url),
    referrer: compact(lead.referrer),
    first_conversion_page: compact(lead.first_conversion_page),
    lead_created_date: compact(lead.lead_created_date),
    last_stage_change_date: compact(lead.last_stage_change_date),
    original_platform: compact(lead.original_platform),
    lead_event_id: compact(lead.lead_event_id),
    offline_event_qualified_fired: 'false',
    offline_event_contract_fired: 'false',
    offline_event_pending_revenue_fired: 'false',
    offline_event_closed_revenue_fired: 'false',
    closed_revenue_amount: compact(lead.closed_revenue_amount),
  };
  const sourceData = leadSourceFromAttribution(customData);
  const mappedCustomData = { ...customData, ...sourceData };
  const attributionSummary = [
    `Lead Source: ${sourceData.lead_source}`,
    `Source Platform: ${sourceData.source_platform}`,
    `Source Route: ${sourceData.source_route}`,
    `Landing Variant: ${customData.landing_variant || 'n/a'}`,
    `Original Platform: ${customData.original_platform || 'unknown'}`,
    `UTM Source: ${customData.utm_source || 'n/a'}`,
    `UTM Medium: ${customData.utm_medium || 'n/a'}`,
    `UTM Campaign: ${customData.utm_campaign || 'n/a'}`,
    `UTM Content: ${customData.utm_content || 'n/a'}`,
    `Landing Page: ${customData.landing_page_url || 'n/a'}`,
    `Referrer: ${customData.referrer || 'n/a'}`,
    `fbclid: ${customData.fbclid || 'n/a'}`,
    `fbp: ${customData.fbp || 'n/a'}`,
    `Lead Event ID: ${customData.lead_event_id || 'n/a'}`,
  ].join('\n');
  const noteBody = [
    source === 'phone_verified' ? 'Phone verified website lead.' : source === 'form_submitted' ? 'Website form submitted (address, phone, email).' : 'Survey completed website lead.',
    '',
    `Name: ${fullName || 'n/a'}`,
    `Phone: ${phoneE164 || phoneDigits || 'n/a'}`,
    `Email: ${compact(lead.email) || 'n/a'}`,
    `Property: ${address || 'n/a'}`,
    '',
    `Timeline: ${customData.timeline || 'n/a'}`,
    `Repairs: ${customData.repairs || 'n/a'}`,
    `Reason: ${customData.reason || 'n/a'}`,
    `Situation (ad/page pick): ${compact(lead.situation) || 'n/a'}`,
    `Listed With Agent: ${customData.listed || 'n/a'}`,
    `Property type: ${customData.property_type || 'n/a'}${customData.land_owned ? ' (land owned: ' + customData.land_owned + ')' : ''}`,
    '',
    attributionSummary,
  ].join('\n');

  return {
    event_source: source || 'website_lead',
    source: source || 'website_lead',
    note_body: noteBody,
    attribution_summary: attributionSummary,
    ...sourceData,

    // Standard contact-style fields for easier GHL mapping.
    firstName,
    lastName,
    name: fullName,
    email: compact(lead.email),
    phone: phoneDigits,
    phone_e164: phoneE164,
    address1: address,
    city: customData.city,
    state: customData.state,
    postalCode: customData.zip,

    // Snake-case fields for custom-field mapping.
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    ...customData,

    // Nested copy for GHL workflow/customData mapping and stage webhooks.
    customData: mappedCustomData,
    customFields: mappedCustomData,
  };
}

function extractOpportunityPayload(body) {
  const customData = body.customData || body.customFields || body.contact?.customFields || {};
  const stageName = pick(body, [
    'stage.name',
    'stageName',
    'pipelineStageName',
    'opportunity.stageName',
    'opportunity.pipelineStageName',
    'opportunity.stage',
  ]) || customData.stageName || customData.pipelineStageName || body.stage;
  const opportunityId = pick(body, ['opportunity.id', 'opportunityId', 'id']);
  const contactId = pick(body, ['contact.id', 'contactId', 'contact_id']);
  const email = pick(body, ['contact.email', 'email']);
  const phone = pick(body, ['contact.phone', 'phone']);
  const revenue = Number(pick(body, [
    'closed_revenue_amount',
    'assignment_fee',
    'opportunity.monetaryValue',
    'monetaryValue',
    'value',
  ]) || customData.closed_revenue_amount || customData.assignment_fee || 0);

  return {
    stageName: compact(stageName),
    opportunityId: compact(opportunityId),
    contactId: compact(contactId),
    email: compact(email),
    phone: digitsOnly(phone),
    firstName: compact(pick(body, ['contact.firstName', 'firstName', 'first_name'])),
    lastName: compact(pick(body, ['contact.lastName', 'lastName', 'last_name'])),
    fbclid: compact(body.fbclid || customData.fbclid),
    fbp: compact(body.fbp || customData.fbp),
    fbc: compact(body.fbc || customData.fbc),
    utm_source: compact(body.utm_source || customData.utm_source),
    original_platform: compact(body.original_platform || customData.original_platform),
    landingPageUrl: compact(body.landing_page_url || customData.landing_page_url || body.event_source_url),
    revenue: Number.isFinite(revenue) && revenue > 0 ? revenue : 0,
    raw: body,
  };
}

function eventForStage(stageName) {
  const normalized = normalizeStage(stageName);
  return Object.entries(OFFLINE_EVENTS).find(([, config]) => config.stages.includes(normalized));
}

function clientIpFromReq(req) {
  return req ? visitorIp(req) : '';
}

/* ── Meta Conversions API ──────────────────────────────────────────────── */
/* Docs: https://developers.facebook.com/docs/marketing-api/conversions-api  */
/* The pixel fires the same event with the same event_id in the browser;      */
/* Meta de-duplicates on event_id + event name.                               */
async function postMetaEvent({ event, eventId, value, lead, req }) {
  const token = compact(process.env.META_ACCESS_TOKEN);
  if (!token) return { skipped: 'missing META_ACCESS_TOKEN' };
  if (!META_PIXEL_ID) return { skipped: 'missing META_PIXEL_ID' };

  const phone = digitsOnly(lead.phone);
  const fbclid = compact(lead.fbclid);
  const user = {
    em: sha256(lead.email) ? [sha256(lead.email)] : '',
    ph: phone ? [sha256(toE164(phone).replace(/\D/g, ''))] : '',
    external_id: sha256(lead.contactId || lead.opportunityId || lead.email || phone),
    fbc: compact(lead.fbc) || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : ''),
    fbp: compact(lead.fbp),
    client_ip_address: req ? clientIpFromReq(req) : compact(lead.client_ip_address),
    client_user_agent: (req && req.headers && req.headers['user-agent']) || compact(lead.user_agent),
  };
  Object.keys(user).forEach((key) => { if (!user[key]) delete user[key]; });

  const sourceUrl = compact(lead.event_source_url || lead.landing_page_url || lead.landingPageUrl || lead.first_conversion_page);
  const payload = {
    data: [{
      event_name: event,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId || crypto.randomUUID(),
      action_source: req ? 'website' : 'system_generated',
      ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
      user_data: user,
      custom_data: { currency: 'USD', value: Number(value) || 1 },
    }],
  };
  if (compact(process.env.META_TEST_EVENT_CODE)) payload.test_event_code = compact(process.env.META_TEST_EVENT_CODE);

  /* Token goes in the Authorization header, not the URL, so it never lands in logs. */
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(META_PIXEL_ID)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`Meta Conversions API returned ${res.status}: ${JSON.stringify(data.error || data)}`);
  }
  return { sent: true, event, event_id: payload.data[0].event_id };
}

/* ── GET /api/health ───────────────────────────────────────────────────── */
function adminKeyOk(req) {
  const want = process.env.ADMIN_KEY || '';
  const got = String(req.query.key || '');
  if (!want || want.length < 12) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/api/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  /* Public callers (Render's health check, uptime monitors) only learn "up". Config detail needs ADMIN_KEY. */
  if (!adminKeyOk(req)) return res.json({ ok: true });
  const health = {
    ok: true,
    twilio: {
      accountSid: envIsSet('TWILIO_ACCOUNT_SID'),
      authToken: envIsSet('TWILIO_AUTH_TOKEN'),
      verifyServiceSid: envIsSet('TWILIO_VERIFY_SERVICE_SID'),
    },
    meta: {
      pixelId: META_PIXEL_ID,
      eventsApiToken: envIsSet('META_ACCESS_TOKEN'),
      testMode: envIsSet('META_TEST_EVENT_CODE'),
    },
  };

  if (req.query.deep === 'twilio' && health.twilio.accountSid && health.twilio.authToken && health.twilio.verifyServiceSid) {
    try {
      const service = await client.verify.v2.services(VERIFY_SID).fetch();
      health.twilio.verifyServiceReachable = Boolean(service && service.sid);
    } catch (err) {
      health.twilio.verifyServiceReachable = false;
      health.twilio.errorCode = err.code || err.status || 'unknown';
      health.twilio.error = err.message || 'Unable to reach Twilio Verify service.';
    }
  }

  res.json(health);
});

app.get('/api/debug-ghl-payload', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found.' });

  const sampleLead = {
    address: '123 Main St, Springfield, IL 62701',
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    phone: '5555550123',
    email: 'seller@example.com',
    firstName: 'Sample',
    lastName: 'Seller',
    name: 'Sample Seller',
    timeline: 'ASAP',
    repairs: 'Light Cosmetic - Paint, flooring, minor updates',
    reason: 'Need to Sell Quickly',
    listed: 'No',
    propertyType: 'Single Family',
    situation: 'foreclosure',
    utm_source: 'facebook',
    utm_medium: 'paid_social',
    utm_campaign: 'sample_campaign',
    utm_content: 'video_1',
    utm_term: '',
    fbclid: 'sample-fbclid',
    fbp: "fb.1.1700000000.sample",
    fbc: "fb.1.1700000000.sample-fbclid",
    landing_variant: 'a',
    landing_page_url: 'https://offer.sterlingpropertysolutions.org/',
    referrer: 'https://l.facebook.com/',
    first_conversion_page: 'https://offer.sterlingpropertysolutions.org/',
    lead_created_date: new Date().toISOString(),
    original_platform: 'meta',
    lead_event_id: 'lead_sample_123',
  };

  res.json({
    phone_verified: buildLeadPayload({ ...sampleLead, firstName: '', lastName: '', name: '' }, sampleLead.phone, 'phone_verified'),
    survey_completed: buildLeadPayload(sampleLead, sampleLead.phone, 'survey_completed'),
    form_submitted: buildLeadPayload(
      { ...sampleLead, firstName: '', lastName: '', name: '', timeline: '', repairs: '', reason: '', listed: '', email: 'test-lead@example.com' },
      sampleLead.phone, 'form_submitted'),
  });
});

function twilioSendError(err) {
  const code = err && (err.code || err.status);
  const message = (err && err.message) || '';

  if (/Invalid parameter `To`/i.test(message) || code === 60200 || code === 21211) {
    return 'Please enter a real mobile phone number that can receive SMS messages.';
  }
  if (code === 20003 || /Authenticate/i.test(message)) {
    return 'Phone verification is not configured correctly. Please call us or try again shortly.';
  }
  if (code === 20404 || /not found/i.test(message)) {
    return 'Phone verification is temporarily unavailable. Please call us or try again shortly.';
  }
  if (code === 21608 || /unverified/i.test(message)) {
    return 'This phone number cannot receive verification texts from this account yet. Please call us or try another number.';
  }
  if (code === 60203 || /Max check attempts/i.test(message)) {
    return 'Too many verification attempts. Please wait a few minutes and try again.';
  }
  return 'Failed to send verification code. Please try again or call us directly.';
}

/* ── POST /api/send-code ───────────────────────────────────────────────── */
/* Every text costs money and can be abused ("SMS pumping"), so cap per visitor, per number, and overall. */
const SMS_HOURLY_CAP = Number(process.env.SMS_HOURLY_CAP) || 150;
app.post('/api/send-code',
  limited('send-ip', 8, 10 * 60 * 1000),
  limited('send-ip-hour', 20, 60 * 60 * 1000),
  limited('send-phone', 4, 60 * 60 * 1000, (req) => phoneKey((req.body || {}).phone)),
  (req, res, next) => (hit('send-global', SMS_HOURLY_CAP, 60 * 60 * 1000) ? next()
    : res.status(429).json({ error: 'We are getting a lot of requests right now. Please call or text us at (443) 329-9736.' })),
  async (req, res) => {
  const { phone, lead } = req.body || {};

  if (typeof phone !== 'string' || !validUsPhone(phone)) {
    return res.status(400).json({ error: 'Please enter a real 10-digit US mobile phone number.' });
  }

  /* First form submitted: tell GHL right away (don't wait on, or fail because of, the SMS) */
  if (lead && typeof lead === 'object' && validEmail(lead.email) && compact(lead.address || lead.full_address || lead.property_address).length >= 6) {
    const payload = buildLeadPayload(lead, phone, 'form_submitted');
    fetch(GHL_WEBHOOK_FORM, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
      .then(async (r) => {
        if (!r.ok) console.error('[ghl-form-webhook] non-2xx status:', r.status, await r.text());
        else console.log('[ghl-form-webhook] sent OK for', payload.phone);
      })
      .catch((err) => console.error('[ghl-form-webhook] fetch error:', err.message));
  }

  try {
    await client.verify.v2.services(VERIFY_SID)
      .verifications.create({ to: toE164(phone), channel: 'sms' });
    res.json({ success: true });
  } catch (err) {
    console.error('[send-code]', {
      code: err.code || null,
      status: err.status || null,
      message: err.message || null,
      moreInfo: err.moreInfo || null,
    });
    res.status(400).json({
      error: twilioSendError(err),
      code: err.code || err.status || 'twilio_send_failed',
    });
  }
  });

/* ── POST /api/verify-code ─────────────────────────────────────────────── */
app.post('/api/verify-code',
  limited('verify-ip', 20, 10 * 60 * 1000),
  limited('verify-phone', 10, 60 * 60 * 1000, (req) => phoneKey((req.body || {}).phone)),
  async (req, res) => {
  const { phone, code, lead } = req.body || {};

  if (typeof phone !== 'string' || !validUsPhone(phone) || !/^\d{4,8}$/.test(String(code || '')) || !lead) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  let result;
  try {
    result = await client.verify.v2.services(VERIFY_SID)
      .verificationChecks.create({ to: toE164(phone), code });
  } catch (err) {
    console.error('[verify-code twilio]', err.message);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }

  if (result.status !== 'approved') {
    return res.status(400).json({ error: 'Incorrect code. Please try again.' });
  }

  /* Webhook 1 fires later — only when the seller confirms they are NOT listed */
  res.json({ success: true, token: signVerified(phone) });
  });

/* ── POST /api/not-listed ──────────────────────────────────────────────── */
/* Fires GHL webhook 1 only for off-market leads (survey answer "No" to      */
/* "Is your property listed?").                                              */
app.post('/api/not-listed',
  limited('notlisted-ip', 10, 60 * 60 * 1000),
  async (req, res) => {
  const { lead, phone, token } = req.body || {};

  if (!lead || typeof lead !== 'object' || !phone) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!checkVerified(token, phone) || phoneKey(phone) !== phoneKey(lead.phone) || !hit(`notlisted-phone|${phoneKey(phone)}`, 3, TOKEN_TTL_MS)) {
    return res.status(403).json({ error: 'Phone not verified.' });
  }

  const payload = buildLeadPayload(lead, phone, 'phone_verified');

  try {
    const ghlRes = await fetch(GHL_WEBHOOK_VERIFY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!ghlRes.ok) {
      console.error('[ghl-verify-webhook] non-2xx status:', ghlRes.status, await ghlRes.text());
    } else {
      console.log('[ghl-verify-webhook] sent OK (not listed) for', payload.phone);
    }
  } catch (err) {
    console.error('[ghl-verify-webhook] fetch error:', err.message);
  }

  res.json({ success: true });
  });

/* ── POST /api/submit-survey ───────────────────────────────────────────── */
app.post('/api/submit-survey',
  limited('survey-ip', 10, 60 * 60 * 1000),
  async (req, res) => {
  const { lead, token } = req.body || {};

  if (!lead || typeof lead !== 'object' || !lead.phone || !validEmail(lead.email)) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!checkVerified(token, lead.phone) || !hit(`survey-phone|${phoneKey(lead.phone)}`, 3, TOKEN_TTL_MS)) {
    return res.status(403).json({ error: 'Phone not verified.' });
  }

  const payload = buildLeadPayload(lead, lead.phone, 'survey_completed');

  try {
    const ghlRes = await fetch(GHL_WEBHOOK_SURVEY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!ghlRes.ok) {
      console.error('[ghl-survey-webhook] non-2xx status:', ghlRes.status, await ghlRes.text());
    } else {
      console.log('[ghl-survey-webhook] sent OK for', payload.email);
    }
  } catch (err) {
    console.error('[ghl-survey-webhook] fetch error:', err.message);
  }

  res.json({ success: true });
  });

/* ── POST /api/track-event ─────────────────────────────────────────────── */
/* Server-side twin of every browser pixel event (InitiateCheckout,          */
/* Lead, CompleteRegistration). Same event_id → Meta de-duplicates.          */
const BROWSER_EVENTS = new Set(['InitiateCheckout', 'Lead', 'CompleteRegistration']);

app.post('/api/track-event',
  limited('track-ip', 30, 10 * 60 * 1000),
  async (req, res) => {
  const { event_name, event_id, lead } = req.body || {};
  /* The page sends lead values of 1-50; clamp so nobody can inflate conversion value in Meta. */
  const value = Math.min(100, Math.max(0, Number((req.body || {}).value) || 1));
  if (!event_name || !lead || typeof lead !== 'object') return res.status(400).json({ error: 'Missing required fields.' });
  if (!BROWSER_EVENTS.has(event_name)) return res.status(400).json({ error: 'Unsupported event.' });

  try {
    const result = await postMetaEvent({ event: event_name, eventId: event_id, value, lead, req });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[meta-conversions-api]', err.message);
    res.status(500).json({ error: 'Failed to send event.' });
  }
  });

/* ── POST /api/ghl-stage-webhook ───────────────────────────────────────── */
/* GHL opportunity stage changes → Meta offline-style events. Only leads    */
/* that came from Meta ads are sent, so other sources sharing the same GHL   */
/* workflow never pollute the Meta pixel.                                    */
function stageSecretOk(req) {
  const want = process.env.GHL_STAGE_SECRET || '';
  const got = String(req.headers['x-webhook-secret'] || req.query.secret || '');
  if (want.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/api/ghl-stage-webhook', limited('stage-ip', 60, 60 * 1000), async (req, res) => {
  /* Server-to-server only: GHL must send the shared secret (header x-webhook-secret or ?secret=). Without
     GHL_STAGE_SECRET set the endpoint is off, so strangers cannot fire fake Meta conversions. */
  if (!stageSecretOk(req)) return res.status(404).json({ error: 'Not found.' });
  const lead = extractOpportunityPayload(req.body || {});
  const matched = eventForStage(lead.stageName);

  if (!matched) {
    return res.json({ success: true, skipped: 'stage not tracked', stage: lead.stageName });
  }
  if (!isMetaLead(lead)) {
    return res.json({ success: true, skipped: 'not a Meta lead', stage: lead.stageName });
  }

  const [eventKey, config] = matched;
  const entityId = lead.opportunityId || lead.contactId || lead.email || lead.phone;
  if (!entityId) {
    return res.status(400).json({ error: 'Missing opportunity/contact identifier for deduplication.' });
  }

  const eventId = `${entityId}:${eventKey}`;
  const log = readEventLog();
  if (log[eventId]) {
    return res.json({ success: true, skipped: 'already fired', event_id: eventId });
  }

  const value = eventKey === 'closed_revenue' ? (lead.revenue || config.value) : config.value;
  const results = {};

  try {
    results.meta = await postMetaEvent({ event: config.metaName, eventId, value, lead });
  } catch (err) {
    console.error('[meta-offline]', err.message);
    results.meta = { error: err.message };
  }

  /* Don't burn the dedupe key unless Meta actually accepted the event. */
  if (results.meta.error) {
    return res.status(502).json({ success: false, event: config.label, event_id: eventId, results });
  }
  if (results.meta.skipped) {
    return res.json({ success: false, skipped: results.meta.skipped, event: config.label, event_id: eventId });
  }

  log[eventId] = {
    event: config.label,
    stage: lead.stageName,
    opportunity_id: lead.opportunityId,
    contact_id: lead.contactId,
    value,
    fired_at: new Date().toISOString(),
    results,
  };
  writeEventLog(log);

  res.json({ success: true, event: config.label, event_id: eventId, value, results });
});

/* ── Heat map (anonymous click + scroll analytics) ───────────────────────── */
/* Events arrive only from visitors who allowed Analytics cookies (see consent.js / heat.js).
   No IPs, no form values, no personal data are stored. View them at /admin/heatmap?key=ADMIN_KEY.
   NOTE: on Render the disk is wiped on every deploy; attach a persistent disk and set HEAT_DIR to keep history. */
const HEAT_DIR  = process.env.HEAT_DIR || path.join(__dirname, 'data');
const HEAT_FILE = path.join(HEAT_DIR, 'heat-events.jsonl');
try { fs.mkdirSync(HEAT_DIR, { recursive: true }); } catch (_) {}
const heatHits = new Map();

function heatRateOk(ip) {
  const now = Date.now();
  const rec = heatHits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60000) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  heatHits.set(ip, rec);
  if (heatHits.size > 5000) heatHits.clear();
  return rec.n <= 40;
}

app.post('/api/heat', (req, res) => {
  res.status(204).end();
  if (!heatRateOk(visitorIp(req))) return;
  const body = req.body || {};
  const sid = String(body.sid || '').replace(/[^a-z0-9-]/gi, '').slice(0, 16);
  const list = Array.isArray(body.ev) ? body.ev.slice(0, 40) : [];
  const lines = [];
  list.forEach((e) => {
    if (!e || !['c', 's', 'v'].includes(e.t)) return;
    const b = ['m', 't', 'd'].includes(e.b) ? e.b : 'd';
    const row = { ts: Date.now(), sid, t: e.t, b, p: String(e.p || '/').slice(0, 60) };
    if (e.t === 'c') {
      const x = Number(e.x), y = Number(e.y), h = Number(e.h);
      if (!(x >= 0 && x <= 1) || !(y >= 0 && y <= 50000) || !(h > 0 && h <= 50000)) return;
      row.x = x; row.y = Math.round(y); row.h = Math.round(h);
      row.e = String(e.e || '').slice(0, 80);
      if (e.s) row.s = String(e.s).replace(/[^a-z_-]/gi, '').slice(0, 20);
    } else if (e.t === 's') {
      row.d = Math.max(0, Math.min(100, Math.round(Number(e.d) || 0)));
    }
    lines.push(JSON.stringify(row));
  });
  if (lines.length) fs.appendFile(HEAT_FILE, lines.join('\n') + '\n', () => {});
});

function heatAuthOk(req) {
  const want = process.env.ADMIN_KEY || '';
  const got = String(req.query.key || '');
  if (!want || want.length < 12) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function heatRead() {
  try {
    const stat = fs.statSync(HEAT_FILE);
    const max = 12 * 1024 * 1024;
    const fd = fs.openSync(HEAT_FILE, 'r');
    const start = Math.max(0, stat.size - max);
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const rows = [];
    buf.toString('utf8').split('\n').forEach((ln, i) => {
      if (!ln || (start && i === 0)) return;
      try { rows.push(JSON.parse(ln)); } catch (_) {}
    });
    return rows;
  } catch (_) { return []; }
}

app.get('/admin/heatmap/data', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  if (!heatAuthOk(req)) return res.status(404).end();
  const b = ['m', 't', 'd'].includes(req.query.b) ? req.query.b : 'm';
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const since = Date.now() - days * 86400000;
  const rows = heatRead().filter((r) => r.ts >= since && r.p === '/');
  const clicks = [], top = {}, sit = {}, depth = {};
  let views = { m: 0, t: 0, d: 0 }, sessions = new Set(), maxH = 0;
  rows.forEach((r) => {
    if (r.t === 'v') views[r.b] += 1;
    if (r.b !== b) return;
    sessions.add(r.sid);
    if (r.t === 'c') {
      clicks.push([r.x, r.y]);
      maxH = Math.max(maxH, r.h);
      top[r.e] = (top[r.e] || 0) + 1;
      if (r.s) sit[r.s] = (sit[r.s] || 0) + 1;
    } else if (r.t === 's') {
      for (let d = 10; d <= 100; d += 10) if (r.d >= d) depth[d] = (depth[d] || 0) + 1;
    }
  });
  const topList = Object.entries(top).sort((x, y) => y[1] - x[1]).slice(0, 15);
  res.json({ clicks: clicks.slice(-20000), height: maxH, views, sessions: sessions.size, top: topList, situations: sit, depth });
});

app.get('/admin/heatmap', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  if (!heatAuthOk(req)) return res.status(404).send('Not found');
  res.type('html').send(HEAT_VIEWER_HTML.replace(/__KEY__/g, encodeURIComponent(String(req.query.key))));
});

const HEAT_VIEWER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Heat map</title>
<style>
:root{--bg:#fffcf5;--ink:#1d1f2a;--mut:#605a4a;--line:#e8dfc9;--gold:#f5a60f}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:.8rem 1rem;display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center}
h1{font-size:1.05rem;margin:0 1rem 0 0}select,button{font:inherit;padding:.45rem .7rem;border:1px solid var(--line);border-radius:8px;background:#fff}
.stat{color:var(--mut);font-size:.9rem}.wrap{display:grid;gap:1rem;padding:1rem;grid-template-columns:minmax(0,1fr)}
@media(min-width:1000px){.wrap{grid-template-columns:auto 340px;align-items:start}}
.stage{position:relative;margin:0 auto;border:1px solid var(--line);background:#fff;overflow:hidden}
.stage iframe{display:block;border:0;width:100%}.stage canvas{position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply}
.side{background:#fff;border:1px solid var(--line);border-radius:12px;padding:1rem}.side h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin:1rem 0 .4rem}.side h2:first-child{margin-top:0}
.row{display:flex;justify-content:space-between;gap:.6rem;padding:.3rem 0;border-bottom:1px dashed var(--line);font-size:.88rem}.row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{height:8px;background:var(--line);border-radius:6px;overflow:hidden;margin:.2rem 0 .5rem}.bar i{display:block;height:100%;background:var(--gold)}
</style></head><body>
<header><h1>Click heat map</h1>
<label>Device <select id="dev"><option value="m">Phone (390px)</option><option value="t">Tablet (820px)</option><option value="d">Desktop (1280px)</option></select></label>
<label>Range <select id="days"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option></select></label>
<button id="go">Refresh</button><span class="stat" id="stat"></span></header>
<div class="wrap"><div class="stage" id="stage"><iframe id="fr" title="Landing page" scrolling="no"></iframe><canvas id="cv"></canvas></div>
<aside class="side"><h2>Most clicked</h2><div id="top"></div><h2>"Tap what sounds like you"</h2><div id="sit"></div><h2>How far people scroll</h2><div id="dep"></div>
<p class="stat" style="margin-top:1rem">Only visitors who allowed Analytics are counted. Positions are scaled to each device width, so they are close, not pixel-exact.</p></aside></div>
<script>
var KEY="__KEY__",W={m:390,t:820,d:1280},fr=document.getElementById('fr'),cv=document.getElementById('cv'),st=document.getElementById('stage');
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function pal(){var c=document.createElement('canvas');c.width=1;c.height=256;var g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,256);
gr.addColorStop(.0,'rgba(0,0,255,0)');gr.addColorStop(.25,'rgb(0,200,255)');gr.addColorStop(.5,'rgb(0,230,90)');gr.addColorStop(.75,'rgb(255,220,0)');gr.addColorStop(1,'rgb(255,30,0)');
g.fillStyle=gr;g.fillRect(0,0,1,256);return g.getImageData(0,0,1,256).data}
var P=pal();
function load(){var b=document.getElementById('dev').value,d=document.getElementById('days').value,w=W[b];
st.style.width=w+'px';fr.style.width=w+'px';
fr.onload=function(){setTimeout(function(){var h=fr.contentDocument.documentElement.scrollHeight;fr.style.height=h+'px';cv.width=w;cv.height=h;cv.style.width=w+'px';cv.style.height=h+'px';
fetch('/admin/heatmap/data?key='+KEY+'&b='+b+'&days='+d).then(function(r){return r.json()}).then(function(j){draw(j,w,h)})},900)};
fr.src='/?hm=1&_='+Date.now()}
function draw(j,w,h){var g=cv.getContext('2d');g.clearRect(0,0,w,h);var o=document.createElement('canvas');o.width=w;o.height=h;var x=o.getContext('2d');
var sc=j.height&&j.height>0?h/j.height:1,r=w<500?26:40;
j.clicks.forEach(function(c){var px=c[0]*w,py=c[1]*sc;var gr=x.createRadialGradient(px,py,0,px,py,r);gr.addColorStop(0,'rgba(0,0,0,.18)');gr.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=gr;x.fillRect(px-r,py-r,r*2,r*2)});
var im=x.getImageData(0,0,w,h),d=im.data;for(var i=0;i<d.length;i+=4){var a=d[i+3];if(a){var k=Math.min(255,a*3)*4;d[i]=P[k];d[i+1]=P[k+1];d[i+2]=P[k+2];d[i+3]=Math.min(210,a*3+40)}}
g.putImageData(im,0,0);
document.getElementById('stat').textContent=j.clicks.length+' clicks · '+j.sessions+' visitors on this device · '+j.views.m+' phone / '+j.views.t+' tablet / '+j.views.d+' desktop page views';
document.getElementById('top').innerHTML=j.top.map(function(t){return '<div class="row"><span title="'+esc(t[0])+'">'+esc(t[0])+'</span><b>'+t[1]+'</b></div>'}).join('')||'<div class="stat">No clicks yet</div>';
var L={foreclosure:'Behind / foreclosure',inherited:'Inherited',divorce:'Divorce',relocation:'Relocating',downsizing:'Downsizing',repairs:'Needs work',other:'Something else'};
var s=Object.entries(j.situations).sort(function(a,b){return b[1]-a[1]});
document.getElementById('sit').innerHTML=s.map(function(t){return '<div class="row"><span>'+esc(L[t[0]]||t[0])+'</span><b>'+t[1]+'</b></div>'}).join('')||'<div class="stat">No taps yet</div>';
var dep='';for(var p=10;p<=100;p+=10){var n=j.depth[p]||0,top=j.depth[10]||1;dep+='<div class="row"><span>Reached '+p+'%</span><b>'+n+'</b></div><div class="bar"><i style="width:'+Math.round(n/top*100)+'%"></i></div>'}
document.getElementById('dep').innerHTML=dep}
document.getElementById('go').onclick=load;document.getElementById('dev').onchange=load;document.getElementById('days').onchange=load;load();
</script></body></html>`;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sterling Property Solutions server running at http://localhost:${PORT}`));
