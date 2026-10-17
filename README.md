# Cyberflight Studios Website

Source for [cyberflight.studio](https://cyberflight.studio), the site of Cyberflight Studios LLC (photography, videography, drone media; Charlotte, NC). A dependency-free static site whose booking and contact flows run as Cloudflare Pages Functions backed by a D1 database, Google Calendar, Resend, and Zoho Mail.

This file is the operational handbook for humans and coding agents.

## Tech stack

- **Frontend:** hand-written HTML5 / CSS3 / vanilla JS. **No frameworks, no bundler, no build step — by deliberate policy.** Do not add one. Started from the HTML5 UP "Dimension" template, heavily customized.
- **Backend:** Cloudflare Pages Functions (`functions/api/**`) — serverless edge handlers, no Node server.
- **Database:** Cloudflare D1 (SQLite). Schema integrity is enforced in SQL: CHECK constraints, triggers, and single-statement overlap guards, not app code.
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
  availability.js          Availability lookup (calendar + DB merge)
  booking/submit.js        Booking submission (thin wrapper -> lib/booking-submit.mjs)
  booking/agreement.js     Server-owned agreement text
  google/[[path]].js       Google OAuth connect/callback proxy
lib/                       Shared logic imported by the functions
  booking-input.mjs        Validation, prices, durations, Eastern-UTC math
  booking-submit.mjs       Submission pipeline
  booking-agreement.mjs    Agreement builder (per service)
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

Runs `node --test tests/*.test.mjs`. Suites cover booking input validation (server-derived prices, package rules, participant lists), submission pipeline, storage/conflict behavior, and orphan cleanup after calendar reconciliation. Suites are plain `node:test`; add a `test('name', ...)` in the relevant file rather than introducing a framework. Current count: 28 tests, all passing.

The submission pipeline enforces replay-before-verify as a security-relevant ordering. Do not move the `verify` call above the prior-row lookup.

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

- `footer.html` — standard site footer (`footer#footer` > `.site-footer`: brand + "Contact Me"). Used by about, gallery/*, services/*. Footer styling lives in `assets/css/site-pages.css` (`#footer .site-footer` rules); do not duplicate it into other stylesheets.
- `footer-brand.html` — brand-only variant (no link), used by contact/index.html only.

Not adopted (deliberately): the homepage (`index.html`) and the booking flow pages (`booking/`, `booking/confirmed/`, `contact/confirmed/`) keep their own inline footers and styles (`homepage.css`, `booking/booking.css`). `site-shell.css` is loaded by all pages including those, so do not move fragment-specific CSS there — it would leak onto the excluded pages.

Conventions:

- Bump `?v=` on the `data-include` attribute in every page that references a fragment whenever that fragment's markup changes (same rule as booking assets, above).
- Links inside fragments use absolute paths (`/contact/`); all pages are served from the domain root, so fragments need no per-page path logic.
- The pattern is not footer-specific: any future shared fragment follows the same form — one placeholder + one fragment file in `components/`, styled by whichever stylesheet family the adopting pages already load. Note: the shared page **header** is deliberately *not* a fragment — it is per-page markup styled centrally from `site-shell.css`; see "Shared header component" below.

## Shared header component (site-shell.css)

All modern standalone pages share one header "tile", styled centrally in the **Floating Box Layout** section of `assets/css/site-shell.css` (markup is duplicated per page; the styling is not):

```html
<div class="intro-tile">
    <a class="page-brand" href="/">
        <img src="/images/headers/logo_icon.png" alt="Cyberflight Studios" />
        <span>Cyberflight Studios</span>
    </a>
    <nav class="page-nav" aria-label="Page navigation">
        <a href="<parent>" class="page-back" aria-label="Back to <parent>">←</a>
        <div data-include="/components/page-nav.html?v=NN"></div>
        <a href="/" class="page-home icon solid fa-home" aria-label="Home"></a>
    </nav>
</div>
```

(This replaced an earlier banner-image header design — full-bleed `images/headers/*.webp` faces with the nav bar overlaid via `:has(> .page-banner)` — which was fully removed once the brand-row tile took over; no page carries `.page-banner` and the banner CSS is deleted.)

Rules of the component:

- **Brand row:** `logo_icon.png` + the studio name sit above the nav pill, floating over the animated page background (drop-shadow/text-shadow keep them legible); the whole row links home. On small phones the row scales down (40px mark / 20px name).
- **Unified nav bar:** one pill with a single backdrop and white border holds the back disc, the shared 4-button section menu (`components/page-nav.html`), and the home disc. Pixel-locked sizing (px + explicit typeface) so booking's 17px `CFBooking` root can't inflate or re-typeface it.
- **Current-section highlight:** `html-include.js` marks the link matching the URL's first path segment with `aria-current="page"` + `.is-active` (filled white chip).
- **Tile is nav-only:** every tile holds just the brand row and the bar — the banner-era edge-to-edge header images and `:has()` overlay geometry are gone. Gallery sub-pages keep their `h2.major` title in the content below the tile.
- **Booking shares it:** booking and the confirmation panels use the standard `intro-tile`/`page-nav`/`page-back`/`page-home` classes directly — no per-page co-listed class names anymore. Only booking-specific quirks stay in `booking/booking.css`.
- **Confirmation panels:** they have no `<article>` shell, so a scoped `body.cf-booking .confirm-panel .page-home` block gives their home disc the identical look.
- **All standalone pages converted:** every page including `services/graduation`, `services/realestate`, and `services/videography` uses the shared header component. The old pre-floating-boxes template variants and the JS-injected Home button (`main.js` "Standalone Page Home Button" block) are gone; the injector was deleted once it was confirmed no page lacked `.page-home`.
- **TODO(future):** hoist the whole tile into `components/header.html` (like `footer.html`), passing per-page bits (back target) via data- attributes, so every header is a single placeholder line.

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
4. **DB and calendar as separate sources:** events/weddings are calendar-only (no D1 rows); graduation (and real estate when enabled) persist to D1. Availability is the merge of both.
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
