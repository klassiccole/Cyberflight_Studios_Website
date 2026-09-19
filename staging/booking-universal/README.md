# Universal booking page — Phase A (static, no backend changes)

Rebuilds the graduation booking prototype as a company-wide booking page.
Nothing in the live site was modified. Copy files from this folder into the
repo root to deploy a phase, or use them as reference for manual revisions.

## Destination structure

`booking/` lives at the site root, alongside `services/`, `about/`, and
`contact/`. All asset paths in these files are written for that location
(`../assets/`, `../images/`, `../videos/`). The confirmed receipt page lives
at `booking/confirmed/` (two levels deep).

Final URLs:

    cyberflight.studio/booking/
    cyberflight.studio/booking/confirmed/

## What Phase A includes

- Step 1 is service selection: Graduation (dropdown: Mini/Standard/Group),
  Event Coverage (by proposal), Wedding (by proposal), Real Estate
  (size-tier dropdown). Tile styling is the existing package style.
- Graduation and Real Estate use the live availability API (real estate maps
  to the `standard` package internally, 90 minutes).
- Weddings: own step 2 — any date at least 30 days out, no availability call.
  Max look-ahead 540 days.
- Events: step 2 shows date + duration slider (1–10 hours, 30-minute steps,
  starts 8:00–23:30, 30-minute buffers, blocks may run past midnight).
  Live start times need the event-mode availability endpoint (Phase B); until
  then the panel says scheduling opens with the next update and submits
  date/length only.
- Details and sign steps adapt per service; graduation keeps its full existing
  agreement, the other three get a compact draft agreement with the agreed
  payment terms (retainer/balance wording).
- Success step is a preview only — nothing is submitted in Phase A.

## Copy map

    staging/booking-universal/booking/    → booking/            (new folder, site root)
    staging/booking-universal/services/graduation/index.html → services/graduation/index.html

The graduation page reference copy points its Book buttons at
/booking/?service=graduation&package=…

## Home page nav swap (do when deploying Phase A)

On the home page main nav, replace the Contact entry with Book:

    <li><a href="booking/">Book</a></li>

and add Contact as a link in the home page footer, next to the existing
footer content. Contact remains a full page for general questions; the
booking page footer already links back to it ("Not ready to book?").

## Before deploying Phase A

1. The old /services/graduation/graduationbookings/ page is unlinked from the
   site today (its Book buttons pointed at /contact/). After Phase A deploys,
   those buttons point at the universal page. Delete the old folder during
   cleanup.
2. Real estate tier prices in booking-core.js ($150/$200/from $250) are
   placeholders — confirm actual tiers before launch.
3. Event/wedding summary images use existing site photos as placeholders.
4. Start-window defaults: events start 8:00–23:30, blocks to 3am supported,
   1 hour minimum, 10 hour maximum. Adjust in booking-core.js services.event.

## Phase B (backend, still to come)

- Migration 0002: service column, variable durations, relaxed hold checks.
- Event mode on /api/availability (busy ranges for the event slider).
- Submission endpoint (from the 2026-09-14 staged work) adapted for services.
- One Resend notification to cole@cyberflight.studio with full request details.

## Phase C (frontend + backend together)

- Sign step POSTs to /api/booking/submit with Turnstile.
- Redirect to /booking/confirmed/?id=… receipt screen (holds expiry, summary).
- Duplicate protection is already in the staged backend: submission-key hash
  plus payload hash replays return the original receipt; conflicting payloads
  are rejected.
