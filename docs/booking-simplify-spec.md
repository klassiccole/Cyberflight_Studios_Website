# Booking Flow Simplification — Spec

Status: draft for review. Zero live bookings in the system; free to change anything.

## Goal

Replace the 4-service / 3-mode booking wizard with a single universal flow:

1. Coverage slider start: **1 hour** (behaves like today's event-coverage code).
2. **No prices or times are quoted by the form** — pricing stays on the services
   pages; Cole confirms totals offline, calendar is the source of truth.
3. Adding a service (drone, video, headshots) becomes content, not code.

## User flow

| Step | Screen | Contents |
|---|---|---|
| 1 | Date & coverage | Native date picker (pop-out calendar), **coverage slider** 1 hr → 9 hrs → **All day**, then start-time buttons for that length (hidden when All day), hint text |
| 2 | Details | **Shot dropdown**: *Graduation photos / Headshots / Real estate / Other* (Other reveals a required ~80-char text field), contact (name/email/phone), location/address, notes |
| 3 | **Review (new)** | Recap: shot, date, coverage + start time (or "All day"), location, contact, notes; pricing line reads **"To be confirmed"** ("By proposal" for all-day). Edit links jump back to step 1 or 2. **Book It** (only submit button; turnstile lives here) |
| 4 | Confirmation | Existing `/booking/confirmed/` page, unchanged |

Sidebar summary remains on steps 1–2; hidden on step 3 (the review IS the
summary, full-width).

## Copy (draft — Cole to approve)

- Under slider: "*Times shown fit your coverage length. Check **All day** for
  whole-date coverage — I'll shape the timeline with you. Pricing varies by
  service — see each service page; I confirm every total before booking.*"
- Above shot dropdown: "*I'll confirm the total for your date, location, and
  coverage before anything is finalized.*"
- Review price line: "Pricing: to be confirmed" / "By proposal" (all day).

## Frontend changes

### `booking/index.html`
- Panel 0 → **Date & coverage** (today's event schedule block, renamed):
  date input, slider (min stop = 1 hour, max stop 9 = All day), time slot area,
  all-day note, hint copy.
- Panel 1 → **Details** (today's details form): shot dropdown + `#shot-other`
  text field (hidden unless Other), contact fields, single location/address
  field (plain text, required; the UNC Charlotte grad select is dropped),
  notes, portfolio-permission fieldset. **Graduate name / participant rows /
  group options: removed.**
- Panel 2 → **Review** (new): definition-list recap, per-section `data-back`
  edit links, turnstile box, one "Book It" submit.
- Sidebar `<aside>` hidden via class when step = review.

### `booking/app.js`
- State becomes `{date, length, allDay, time, shot, shotText, details…}`.
- Delete: `selectService` package/tier branching, `state.package`,
  `state.tier`, `state.count`, group-size machinery, graduation/realestate/
  wedding schedule renderers, `renderDates`/`renderSlots` (slot-grid mode),
  `apiPackage`, URL param handling (`?service=&package=&tier=` gone).
- Reuse today's event path as the only path: `loadEventDay()` → busy ranges →
  `renderEventSchedule()`/`renderEventSlots()` → `C.eventStarts()`.
- New: review-step renderer (reads state + form fields into plain pairs),
  shot-Other reveal toggle, sidebar hide on review.
- Turnstile init moves to the review step-attach (unchanged mechanism).

### `booking/booking-core.js`
- `services` map reduced to metadata for the shot dropdown + summary imagery.
- `packages`/`groupPrices`/`availableSlots`/`deadline`: dead — remove (confirm
  no other importer; live-check.js / tests grepped before delete).
- `eventStarts`, `sessionInstant`, `dateKey`, `addDays`, `zone`: unchanged.

### Services pages
- All CTAs become plain links to `/booking/` (no query params). Grad group
  button → "Group sessions: contact me". Mini/Standard/tiers remain page
  content (marketing only).

## Server changes

### `lib/booking-input.mjs` — one unified path
`normalizeBooking(input)` accepts:
`{length (60–1200, %30, optional for allDay), allDay?, time? unless allDay,
date, details:{name,email,phone,shot,shotText?,location,notes}}`.

- Validate `shot` against the dropdown list when not "other"; when "other",
  `shotText` required, sanitized text ≤ 80 chars (same `text()` treatment).
- All timings/length validation reuse today's event branch logic.
- Output: `{package:'event'-equivalent (see migration), service:<shot label>,
  date, time (or 0), length (or allDay), details, priceCents:0, …}`.
- Delete: `GROUP_PRICES`, group/participant validation, wedding branch,
  `PACKAGES` price lookups (or reduce to the duration constant).

### `lib/booking-submit.mjs`
- Email subject/lines: use the shot label string from details ("New Graduation
  photos Request — Jane Doe"); pricing line becomes "to be confirmed" /
  "by proposal". Delete real-estate/group label guessing, retainer wording.

### `functions/api/availability.js`
- **Keep only busy-range mode** (`package=event` behavior). Per-package
  slot-grid mode (`DURATIONS`) is dead code — remove nothing else until the
  cutover PR, then delete the slots branch + `DURATIONS`.
- Response validation client-side (app.js) updated to the busy shape only.

## Database — migration `0005_universal_bookings.sql`

Table rebuild pattern (same as 0002/0003/0004 — triggers are dropped with the
table and recreated):

- `package_id`: single generic value (`'event'` stays valid, so possibly
  **zero change needed** — confirm and note in migration if we keep it).
- `service` CHECK relaxed to free text ≤ 40 chars (shot label), or left as the
  sanitized-in-code column with same enum — **decision: relax to text** so
  future services never need migrations.
- Drop triggers referencing deleted package behavior (`booking_jobs` FK), then
  recreate insert/overlap guards verbatim from 0004's final schema.
- `price_cents` stays `>= 0` (bookings store 0 = "to be confirmed").

Apply order at cutover: `npm run db:migrate:remote` **before** deploying the
new frontend/server (relaxed schema is backward-compatible with current code).

## Tests

- `tests/input.test.mjs`: fixtures for the unified path — length bounds,
  all-day, shot validation (List/Other), `priceCents:0`; delete group/wedding
  fixtures; keep sessionSeconds DST/gap tests verbatim.
- `tests/submission.test.mjs`: email label now shot string; pricing line text.
- `tests/storage.test.mjs` / `orphan-cleanup.test.mjs`: run after 0005
  applied locally (`npm run db:migrate:local`) — confirm overlap guard still
  triggers on a two-booking collision.
- `npm test` green before any browser work.

## Manual dev matrix (wrangler pages dev, :8788 — calendar works locally via
`npm run secrets:sync`)

1. Direct visit → step 1 calendar, slider default 1 hr, times render.
2. Slider to each stop incl. All day → times hide, review says "By proposal".
3. Shot=Other → text field required; submit includes label; email correct.
4. All-day = the former wedding path.
5. `npm run dev` → full submit → `/booking/confirmed/?id=…` renders, owner
   email received.
6. Overlap guard: two same-day requests → second flagged.

## Non-goals

- Drone/video services pages (later, content-only).
- Payments/collecting money in-form (still none).
- Mini (30-min) and group self-serve booking — dead on form; honored manually.
- Admin/confirmed page redesign beyond price-line copy.
