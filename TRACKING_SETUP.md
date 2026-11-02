# Meta tracking

Pixel ID goes in two places: `META_PIXEL_ID` at the top of `public/tracking.js` and the `META_PIXEL_ID` env var on Render. Server-side Conversions API in `server.js` (needs `META_ACCESS_TOKEN`).

| Step | Browser pixel | Conversions API | Notes |
|---|---|---|---|
| Landing view | PageView, ViewContent | - | |
| Step 1 submit | InitiateCheckout (value 5) | yes | same `event_id` = deduped |
| Phone verified + not listed | **SubmitForm** (value 5-50 by timeline) | yes | the qualified lead; optimize ads on this |
| Survey finished | CompleteRegistration | yes | |
| GHL stage change | - | QualifiedSeller 150, NewContract 1000, PendingRevenue 5000, ClosedRevenue (actual or 10000) | only for leads with `fbclid` / `original_platform=meta` |

Event names live in `EVENTS` at the top of `public/tracking.js` (browser) and `OFFLINE_EVENTS` in `server.js`.

## Ad URL (set on every Facebook / Instagram ad)

```
https://sterlingpropertysolutions.org/?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}
```

Meta adds `fbclid` to the link on its own when someone taps the ad; you don't add it.

A/B test: add `&v=b` to the URL of the ads that should show the midnight/coral theme. Everything else defaults to variant A (cream/forest/lime). The variant is saved as `landing_variant` on the lead in GHL.

## Captured fields (sent to GHL)

`fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_variant, landing_page_url, referrer, first_conversion_page, lead_created_date, original_platform, lead_event_id`, plus `lead_source`, `source_platform`, `source_route`, `is_meta_lead`.

Create GHL custom fields for `fbclid`, `fbp`, `fbc`, `landing_variant`, `is_meta_lead` and map them in the two webhook workflows.

## GHL stage webhook

POST opportunity/contact payload (including the custom fields above) to `https://sterlingpropertysolutions.org/api/ghl-stage-webhook`. Send the secret as header `x-webhook-secret`. Leads that did not come from Meta ads are ignored.

## Testing

1. Events Manager > your pixel > Test Events: copy the test code, set `META_TEST_EVENT_CODE` on Render, load the site with `?fbclid=test`, and walk the funnel. Browser and server events should appear and merge (deduped).
2. Remove `META_TEST_EVENT_CODE` afterwards.
3. `GET /api/health` shows whether the Conversions API token is set.

`data/offline-events.json` (stage-event dedupe) is on Render's ephemeral disk and resets on redeploy; add a persistent disk if that matters.
