# Cyberflight Studios Website

Source for [cyberflight.studio](https://cyberflight.studio), the site of Cyberflight Studios LLC (photography, videography, drone media; Charlotte, NC). A dependency-free static site whose booking and contact flows run as Cloudflare Pages Functions backed by Google Calendar (the booking source of truth), D1 (connection storage + request reconciliation), Resend, and Zoho Mail.

This file is the operational handbook for humans and coding agents.

## Tech stack

- **Frontend:** hand-written HTML5 / CSS3 / vanilla JS. **No frameworks, no bundler, no build step — by deliberate policy.** Do not add one. Started from the HTML5 UP "Dimension" template, heavily customized.
- **Backend:** Cloudflare Pages Functions (`functions/api/**`) — serverless edge handlers, no Node server.
- **Database:** Cloudflare D1 (SQLite) — stores the encrypted Google connection and booking_requests rows used for calendar reconciliation. Schema integrity is enforced in SQL: CHECK constraints, triggers, and single-statement overlap guards, not app code.
- **Email:** Resend (contact form + booking notifications) → owner mailbox on Zoho Mail. Zoho handles inbound MX/DKIM/SPF for the domain.
- **Spam protection:** Cloudflare Turnstile on contact and booking forms.
- **Calendar:** Google Calendar API (service account/OAuth, refresh token encrypted at rest in D1).
- **Tests:** `node:test` + `assert/strict`, no test framework.
- **Hosting:** GitHub Pages (static assets) + Cloudflare Pages (functions). Pushing to `main` deploys both automatically.

## Repo layout

```
index.html                 Home page
about/ contact/ gallery/   Static pages, one dir + index.html per clean URL
gallery/                   charlotte, nature, film, cyclegearbikenights,
                           hyattshootingcompetitions, monroeairshow (flat,
                           no intermediate hubs)
services/                  photography, videography, drone, graduation, realestate
booking/                   Universal booking flow (the active one)
  index.html               Step-based booking UI
  app.js booking-core.js booking.css
  confirmed/index.html     Post-submission receipt screen
functions/api/             Pages Functions (the entire backend)
  contact.js               Contact form: Turnstile verify + Resend send
  availability.js          Availability lookup (openings calendar + free/busy)
  booking/submit.js        Booking submission (thin wrapper -> lib/booking-submit.mjs)
  google/[[path]].js       Google OAuth connect/callback proxy
lib/                       Shared logic imported by the functions
  booking-input.mjs        Validation, prices, durations, Eastern-UTC math
  booking-submit.mjs       Submission pipeline (calendar event + owner email)
  google-auth.mjs          Token decryption + bounded Google JSON fetch
migrations/                D1 migrations 0001-0004 (plain SQL)
tests/                     node:test suites (unit + storage + submission)
assets/ images/ videos/    Static media
components/                Shared HTML fragments + include loader (see "Shared fragments" below)
_redirects                 Cloudflare Pages redirects (301s from the old
                           /gallery/events/* URLs; see "Gallery structure" below)
wrangler.jsonc             Local dev config (bindings; DB id for remote ops)
.dev.vars.example          Template for local secrets (copy to .dev.vars)
```

## Local development

```bash
npm install              # first time only (installs wrangler)
npm run db:migrate:local # create/update local D1 copy from migrations/
npm run dev              # serves http://localhost:8788
```

`npm run dev` runs the **real stack locally**: static site, `functions/api/*` handlers, and a local D1 copy.

### Environment files (local vs production)

Both use the same `KEY=VALUE` format; the template for both is `.dev.vars.example`. Neither is ever committed.

| File | Scope | Used by | Git status |
|---|---|---|---|
| `.dev.vars` | Local dev | `npm run dev` (wrangler reads it automatically) | gitignored |
| `.secrets.production` | Production | pushed to Cloudflare via `npm run secrets:sync` | gitignored |

Setup: copy `.dev.vars.example` to each file and fill in real values per environment. No manual swapping: local dev always reads `.dev.vars`, production secrets live in Cloudflare and are updated by the sync script.

```bash
npm run secrets:sync -- <pages-project-name>   # pushes .secrets.production to Cloudflare Pages secrets
```

Run it after changing any production secret (Turnstile, Resend, Google keys). It does not touch local `.dev.vars`, and it only adds/updates the keys present in the file. `BOOKING_DB` is a binding (configured in `wrangler.jsonc`), not a secret — keep it out of `.secrets.production`.

- Turnstile ships official test keys: the secret in `.dev.vars.example` (`1x000...AA`) always passes verification locally, so forms work end to end without real keys.
- Leave Google/Resend values blank and everything non-mail/calendar still works; the affected endpoints fail with a clear error.
- The local D1 is disposable: `rm -rf .wrangler/state` resets it, then re-run the migrate script.

**Test everything at localhost before pushing.** Localhost exercises the identical handlers and bindings that production runs. The old failure mode was verifying changes only after deploying to production; do not do that.

## Testing

```bash
npm test
```

Runs `node --test tests/*.test.mjs`. Suites cover booking input validation (server-derived prices, package rules, participant lists), the submission pipeline's gates (origin, enabled flag, Turnstile hostname/action, availability outcomes), storage triggers, and orphan cleanup after calendar reconciliation. Suites are plain `node:test`; add a `test('name', ...)` in the relevant file rather than introducing a framework. Current count: 17 tests, all passing.

The pipeline is calendar-as-truth: a booking request is the Bookings Calendar event plus the owner email — booking_requests rows are no longer written (only reconciled/deleted), and there is no client signature/agreement step (removed).

## Deployment

Push to `main` (GitHub). Two deploy targets pick it up:

1. **GitHub Pages** serves the static site.
2. **Cloudflare Pages** builds and serves the Functions; production bindings/secrets are set in the Cloudflare dashboard (Workers & Pages → the site project → Settings → Variables & Secrets), or managed from the repo via `.secrets.production` + `npm run secrets:sync` (see Environment files above).

Remote D1 migrations are run manually, in order, when a new migration file lands:

```bash
npm run db:migrate:remote
```

**Cache-busting convention:** every cached asset is loaded with a query version and bumped on change — site-wide assets (`main.js?v=NN`, `site-shell.css?v=NN`, `site-pages.css?v=NN`, `noscript.css?v=NN`), homepage (`homepage.css?v=NN`), booking (`booking.css?v=NN`, `booking-core.js?v=NN`, `app.js?v=NN`), and every `data-include` fragment URL (`components/footer.html?v=NN`). Any change to a cached asset requires bumping that `v=` in the pages that load it — site-wide assets are referenced by ~22 pages, so a bump touches all of them. Forgetting this makes correct fixes appear broken (stale browser JS), and has wasted entire sessions before. Check it every time.

## Shared fragments (components/)

Shared HTML lives in `components/` so it is written once and adopted per page. No build step: each page holds a placeholder plus the loader, and the loader swaps the placeholder for the fetched fragment at runtime.

```html
<div data-include="/components/footer.html?v=1"></div>
<script src="/components/html-include.js?v=1"></script>
```

Current fragments:

- `header.html` — full header tile (brand row + nav bar with section menu). Used by every page except the homepage; see "Shared header component" below.
- `footer.html` — standard site footer (`footer#footer` > `.site-footer`: brand + "Contact Me"). Used by about, gallery/*, services/*. Footer styling lives in `assets/css/site-pages.css` (`#footer .site-footer` rules); do not duplicate it into other stylesheets.
- `footer-brand.html` — brand-only variant (no link), used by contact/index.html only.

Not adopted (deliberately): the homepage (`index.html`) and the booking flow pages (`booking/`, `booking/confirmed/`, `contact/confirmed/`) keep their own inline footers and styles (`homepage.css`, `booking/booking.css`). `site-shell.css` is loaded by all pages including those, so do not move fragment-specific CSS there — it would leak onto the excluded pages.

Conventions:

- Bump `?v=` on the `data-include` attribute in every page that references a fragment whenever that fragment's markup changes (same rule as booking assets, above).
- Links inside fragments use absolute paths (`/contact/`); all pages are served from the domain root, so fragments need no per-page path logic.
- The pattern is not footer-specific: any future shared fragment follows the same form — one placeholder + one fragment file in `components/`, styled by whichever stylesheet family the adopting pages already load.

## Shared header component (components/header.html)

Every page except the homepage renders its header tile from **one fragment** — the full tile (brand row + unified nav bar with back disc, 4-button section menu, home disc) lives in `components/header.html`; the former per-page tile markup and the separate `page-nav.html` menu fragment were absorbed into it. Each page is a single line:

```html
<div class="intro-tile-slot" data-include="/components/header.html?v=NN"></div>
```

- **Slot reservation:** while the fetch is in flight, the placeholder's `.intro-tile-slot` class (CSS in `site-shell.css`) holds the tile's final height (184px desktop, 116px mobile) so content below never jumps. The class is consumed on injection.
- **Back link:** defaults to `href="../"` — which only works because tiles exist at exactly one directory depth site-wide (keep that rule). Override with `data-back="/services/"` (booking does this); omit entirely with `data-no-back` (the two confirmation pages). The back link carries `id="nav-back"` because `booking/app.js` hooks it to step backwards through the booking wizard — don't remove the id. `main.js` still adds same-site history-aware behavior by class.
- **Current-section highlight:** `html-include.js` marks the menu link matching the URL's first path segment with `aria-current="page"` + `.is-active` (filled white chip).
- **Brand row:** `logo_icon.png` + the studio name link home; legibility over the animated background via drop-shadow/text-shadow; scales down on small phones (40px mark / 20px name).
- **Pixel-locked nav:** sizes in px with an explicit typeface so booking's 17px `CFBooking` root can't inflate or re-typeface the bar.
- **Booking flow:** `booking/index.html` uses the fragment with `data-back="/services/"`; the two confirmation pages place the header above their centered success panel (their inline brand/nav and the scoped `body.cf-booking .confirm-panel .page-home` rules are gone).
- **Excluded:** the homepage keeps its own full-page header design (not this component). The old banner-image header design (full-bleed `images/headers/*.webp` + `:has()` overlay) was removed with the brand-row tile; no page carries `.page-banner` and the banner CSS is deleted.
- **No-JS:** pages without JavaScript show no header tile (fragment requires the loader). Accepted trade-off; the homepage and booking forms remain fully usable without it.

## Gallery structure

The gallery is **flat**: `charlotte`, `nature`, `film`, `cyclegearbikenights`, `hyattshootingcompetitions`, and `monroeairshow` sit directly under `/gallery/`. The former `/gallery/events/` hub was removed and the three event galleries moved up one level:

- Old URLs 301-redirect via `_redirects` at the repo root (Cloudflare Pages). If a gallery page moves again, add a redirect line there.
- Canonical tags and `sitemap.xml` point at the new URLs; keep them in sync with any move.
- Image folders mirror the page folders: `images/gallery/<name>/` (the bike-nights image folder was renamed to match its page dir).
- `booking/booking-core.js` uses `images/gallery/events_cover.webp` as the generic event summary image — that file's path is load-bearing for the booking flow.

## Variables

All read via `env.*` inside Functions; set in Cloudflare dashboard (prod) or `.dev.vars` (local).

| Variable | Purpose | Required |
|---|---|---|
| `BOOKING_DB` | D1 binding, configured in `wrangler.jsonc` | Yes (binding, not a secret) |
| `TURNSTILE_SECRET` | Server side of the Turnstile widget | Yes |
| `RESEND_API_KEY` | Sends contact + booking notification email | Yes |
| `BOOKING_OWNER_EMAIL` | Owner mailbox notifications are sent to | Yes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | OAuth app for calendar connect flow | Yes |
| `GOOGLE_ALLOWED_EMAIL` | Owner account allowed to connect the calendar | Yes |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32-byte AES-GCM key (base64); encrypts the stored Google refresh token | Yes |
| `GOOGLE_AVAILABILITY_CALENDAR_ID` | Calendar read for open slots (the availability calendar) | Yes |
| `GOOGLE_BOOKINGS_CALENDAR_ID` | Calendar that new bookings are written to (separate from availability) | Yes |
| `GOOGLE_PERSONAL_CALENDAR_ID` | Owner's personal calendar (free/busy context) | Yes |
| `BOOKING_SUBMISSIONS_ENABLED` | Gate: `true` enables public booking; anything else returns `booking_not_open_yet` | Yes |
| `BOOKING_SKIP_TURNSTILE` | **Danger:** `true` disables Turnstile verification. Never set in production; use only for throwaway pipeline tests, then delete | No |

## Domain/email infrastructure (context you shouldn't touch casually)

- DNS is Cloudflare. MX points to **Zoho** (3 records), plus SPF/DKIM (`zoho` selector TXT) and DMARC. Cloudflare Email Routing is **disabled** — it was removed when mail moved to Zoho.
- The contact/booking notification path is: form → `functions/api/*` → Turnstile verify → Resend send → `cole@cyberflight.studio` (Zoho).
- Changing MX/DKIM/SPF affects all mail for the domain. Ask before touching DNS or Cloudflare account settings.

## Design principles (enforced, not aspirational)

1. **No frontend frameworks or new dependencies.** Vanilla only. If a change seems to need a library, it doesn't.
2. **Never trust the client.** Prices, durations, package names, and timezone math are computed in `lib/` from server state. Browser-submitted values of those fields are rejected (`unexpected_fields`, `invalid_package`). Agreements are served by the server and hashed with the signature at submission.
3. **Push integrity into the schema.** Use CHECK constraints/triggers over app-level guards when the database can express the rule.
4. **Calendar is the source of truth:** every booking request becomes a Bookings Calendar event plus an owner email; no booking rows are written to D1. Availability is the merge of the openings calendar and free/busy data. Lead times are advisory (30+ days ideal for events/weddings), never enforced in code. All-day event requests are an owner override: never rejected for busy time, but the owner email is conflict-flagged for calendar review.
5. **Clean URLs via directory structure:** each page is `<dir>/index.html`. Keep that pattern for new pages.

## Stylesheet ownership

- `site-shell.css` — shared blueprint, loads on all 20 pages: reset, fonts, typography, background, header tile, footer, page states, the floating-box layout and the unified nav bar. Homepage and booking load it, so it must stay page-agnostic.
- `site-pages.css` — content-page layer (about / gallery / services / contact / privacy / terms + the footer fragment styling). The homepage and booking pages must never be affected by it.
- `homepage.css` / `booking.css` — the two single-purpose files. The homepage footer is intentionally its own copy; keep it in sync manually.
- **Shared page family:** the `.packages-page` CSS family (intro, tagline, package-card tiles, information, CTA) is used by BOTH `services/graduation` and `services/realestate` — do not rename or trim members without checking both pages. The `graduation` booking service name (`/booking/?service=graduation`, D1 rows) is unrelated to these class names and is not part of any rename.

## Working conventions for agents (learned the hard way)

- **Never push, commit, deploy, delete data, or change Cloudflare settings without explicit per-action approval.** When asked for "comment and code", reply with exactly the pastable commands and nothing else.
- **Verify locally before proposing any push.** The deploy-then-see loop is the most expensive mistake this project has.
- **Test rows are your mess.** If you submit test bookings, clean up the resulting D1 rows and calendar events yourself and say so. Ghost rows from uncleaned tests caused repeated "That time was just taken" loops.
- **Ask, don't assume, on scope.** The author fixes scope precisely (e.g. "only the booking folder"). Confirm which files a change touches before making it.
- **One real fix beats three guesses.** Before "fixing" an error, reproduce it locally and name the failing line. Guess-fix cycles burned more trust than any other behavior.
- **Windows note:** use npm scripts (`npm run ...`), not bare `npx` — `npx.ps1` trips PowerShell's execution policy on this machine.

## Known gotchas

- The production D1 console cannot paste multi-statement migration files (triggers choke the parser); always use `wrangler d1 migrations apply`.
- The D1 check constraint on `package_id` is migration-versioned; adding a package means a new migration, not an edit to an old one.
- One Turnstile widget/sitekey pair covers any page on the domain; don't create per-form widgets.
- `booking/app.js` is the single frontend brain for the whole flow; large string-surgery edits on it have corrupted files before. Prefer small, verified edits.
- **Pricing lives in three synchronized places:** the booking page's select options, `booking/booking-core.js` (client twin), and `lib/booking-input.mjs` (server authority). A price/duration change must touch all three; drift fails safe because the server recomputes and rejects client-submitted prices, but the UI shows stale numbers until all three are updated.
- Event coverage length ceilings differ by layer by design: UI slider allows 1-9 hours (+ All Day), the server accepts up to 1200 minutes for timed events, and all-day requests bypass availability entirely (conflict-flagged email instead).
- **Simultaneous duplicate submissions can double-book a slot** (known, accepted risk): the availability check and the calendar event creation are two separate steps, so two requests for the same slot in the same instant can both see the slot free and both create events. The old D1 single-statement insert guard used to serialize this; persistence was removed with the calendar-as-truth design. Likelihood is low (same-second collisions); if it ever bites, the fix is a D1 "claims ledger" insert before the calendar call.
