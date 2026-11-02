# Sterling Property Solutions: Design System

Direction: **calm, steady, trustworthy.** Cool gray-blue surfaces, deep slate for weight, one warm tan action color. Sellers are often stressed, so the page should feel quiet and human. It carries no photos yet: add the owner or team photo and real reviews when the client has them.

Source of truth for values is `public/styles.css` (`:root`). Pages use token names, never raw values.

## Color

The client's colors are `#dee3e8` (brand / forest) and `#b9a688` (accent). Both are light, so `#dee3e8` is the light surface and a deep slate (`#232d38`, chosen by us, not the client) carries the dark bands and white text. Buttons use the client's tan with dark text.

| Token | Value | Role |
| --- | --- | --- |
| `--bg` / `--bg-alt` | #f6f8fa / #dee3e8 | page, alternating sections (client color) |
| `--ink` | #18212b | body text |
| `--muted` | #3f4b57 | secondary text |
| `--line` | #c3ccd5 | hairlines, input borders |
| `--brand` / `--brand-2` | #232d38 / #323f4d | headings, footer, dark bands |
| `--forest` / `--forest-2` | #232d38 / #323f4d | dark sections: top bar, guarantee, final CTA, form header, hero |
| `--accent` / `--accent-2` | #b9a688 / #c9bb9f | every primary button (client color; text `--on-accent` #1d1608) |
| `--accent-ink` | #66593f | tan used as text on light |
| `--cyan` (light tan) | #d8c8a8 | highlights and numerals on dark slate |
| `--good` / `--bad` | #0f8a43 / #c62f2f | ticks / errors |

## Typography

Montserrat (500-900) with a system-sans fallback. Headings 800, tight tracking (-.03em), line-height ~1.06; body 500 at 16px, line-height 1.6.

| Token | Size | Use |
| --- | --- | --- |
| `--fs-h1` | clamp(2.3rem, 9.4vw, 4.1rem) | hero headline |
| `--fs-h2` | clamp(1.85rem, 6.6vw, 3.1rem) | section titles |
| `--fs-h3` | 1.25rem | card titles |
| `--fs-lg` | 1.125rem | lead paragraphs |
| `--fs-base` | 1rem | body, inputs (also prevents iOS zoom) |
| `--fs-sm` | .875rem | captions |
| `--fs-xs` | .75rem | caps labels and fine print. Nothing smaller |

## Spacing and layout

4px base: `--sp-1` .25 / `--sp-2` .5 / `--sp-3` .75 / `--sp-4` 1 / `--sp-6` 1.5 / `--sp-8` 2 / `--sp-12` 3 / `--sp-16` 4 rem. Container 1120px with 1.25rem side gutters. Section padding `--section-y`: 4.2rem on mobile, 6.2rem from 900px. Mobile-first: single column, form directly under the headline, two columns (copy + 440px form card) from 900px. Minimum touch target `--tap` 48px (inputs 54px, nav phone 44px).

## Shape and depth

Radius: `--radius` 18px (cards), `--radius-sm` 12px (inputs, buttons), `--radius-pill` for chips and the phone button. Shadows: `--shadow` (cards, form) and `--shadow-sm` (small lifts) only, both navy-tinted.

## Components

- **Primary button**: tan fill, dark 700 text, 12px radius, full width in forms; hover lifts 2px and brightens; disabled 50%.
- **Phone button**: outlined pill with a phone icon, always visible in the nav.
- **Sticky CTA**: full-width primary bar at the bottom on mobile only, safe-area aware, appears after the hero.
- **Inputs**: 54px tall, `--bg-alt` fill, 1.5px `--line` border; focus shows a cyan 3px ring; errors in `--danger` below the field.
- **Cards**: white, `--line` border, `--shadow-sm`.
- **Highlight (`.hl`)**: cyan marker under key words in headings, one phrase per heading.
- **Nav**: sticky, translucent, logo left, phone right; "Get My Offer" appears from 900px.
- **FAQ**: native `<details>` rows with a plus chip.
- **Situation cards**: 1 column on phones, 2 from 560px, 4 from 900px; tapping opens the form sheet in place (no scroll).
- **Form sheet**: bottom sheet on phones, centered modal from 700px; holds the same lead form; Esc, backdrop or × closes.
- **Sparkling icon tiles** (`.ico`): 56px gold or green gradient tile, drawn SVG, two twinkling stars; used in the offer list. Drawn placeholders for later AI illustrations.
- **Offer list** ("Walk-Away Cash Offer"): icon + title + one line, 1 column then 2.
- **Comparison**: agent left, Sterling right (gold-tinted column, green header); stacks as paired cells on phones.
- **Market Watch**: four sourced stat cards, repair-cost ranges, "what waiting costs" list; update monthly.
- **Formula + calculator**: value − costs − profit = offer, then a calculator: value − 15% − repairs, shown as "you could get up to", always labeled "not an offer".
- **Footer**: navy, compliance text at 12.8px.

## Imagery

Real photo of the owner in the About section, the logo, and real reviews. No stock-photo grids, no emoji icons, inline SVG for the few icons. Respect `prefers-reduced-motion` (scroll reveals switch off).
