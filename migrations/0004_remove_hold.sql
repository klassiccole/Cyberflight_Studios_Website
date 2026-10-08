-- Remove the 48-hour hold. Confirmed-vs-released lives entirely in the
-- Bookings Calendar; the owner manages requests there and reconciliation
-- deletes database rows whose calendar event disappears. This table now
-- exists only to store signed agreements for graduation / real estate
-- until the calendar event is deleted. (Event and wedding proposals never
-- wrote rows.) booking_jobs had no consumer and is dropped.
-- Transient rows only: the table is rebuilt and triggers are recreated
-- (dropping a table drops its triggers). Follows the 0002/0003 pattern.
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS booking_jobs;
DROP TABLE IF EXISTS booking_requests;

CREATE TABLE booking_requests (
  id TEXT PRIMARY KEY NOT NULL,
  submission_key_hash TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  service TEXT NOT NULL DEFAULT 'graduation'
    CHECK (service IN ('graduation', 'realestate', 'event', 'wedding')),
  session_start INTEGER NOT NULL,
  session_end INTEGER NOT NULL CHECK (session_end > session_start),
  busy_start INTEGER NOT NULL CHECK (busy_start = session_start - 1800),
  busy_end INTEGER NOT NULL CHECK (busy_end = session_end + 1800),
  package_id TEXT NOT NULL CHECK (package_id IN ('mini', 'standard', 'group', 'event', 'wedding')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  customer_json TEXT NOT NULL CHECK (json_valid(customer_json)),
  agreement_version TEXT NOT NULL,
  agreement_text TEXT NOT NULL,
  agreement_sha256 TEXT NOT NULL,
  signature_json TEXT NOT NULL CHECK (json_valid(signature_json)),
  decision_at INTEGER,
  decline_message TEXT,
  CHECK ((status = 'pending' AND decision_at IS NULL) OR
         (status <> 'pending' AND decision_at IS NOT NULL)),
  CHECK (status = 'declined' OR decline_message IS NULL)
);

CREATE INDEX booking_requests_overlap ON booking_requests(status, busy_start, busy_end);

-- A single INSERT checks conflicts and writes the row under the same DB lock.
-- Only confirmed (approved) rows and open requests block a slot now.
CREATE TRIGGER booking_requests_insert_guard
BEFORE INSERT ON booking_requests
BEGIN
  SELECT RAISE(ABORT, 'request_must_start_pending') WHERE NEW.status <> 'pending';
  SELECT RAISE(ABORT, 'booking_overlap') WHERE EXISTS (
    SELECT 1 FROM booking_requests r
    WHERE r.status IN ('approved', 'pending')
      AND NEW.busy_start < r.busy_end AND NEW.busy_end > r.busy_start
  );
END;

-- A submitted agreement is a snapshot: approval must not rewrite signed terms.
CREATE TRIGGER booking_requests_snapshot_immutable
BEFORE UPDATE OF id, submission_key_hash, payload_hash, created_at,
  session_start, session_end, busy_start, busy_end, package_id, price_cents,
  customer_json, agreement_version, agreement_text, agreement_sha256, signature_json
ON booking_requests
BEGIN
  SELECT RAISE(ABORT, 'submitted_snapshot_is_immutable');
END;

CREATE TRIGGER booking_requests_decision_guard
BEFORE UPDATE OF status, decision_at, decline_message ON booking_requests
BEGIN
  SELECT RAISE(ABORT, 'request_already_decided') WHERE OLD.status <> 'pending';
  SELECT RAISE(ABORT, 'invalid_decision') WHERE NEW.status = 'pending';
  SELECT RAISE(ABORT, 'booking_overlap') WHERE NEW.status = 'approved' AND EXISTS (
    SELECT 1 FROM booking_requests r
    WHERE r.id <> OLD.id
      AND r.status IN ('approved', 'pending')
      AND NEW.busy_start < r.busy_end AND NEW.busy_end > r.busy_start
  );
END;

PRAGMA foreign_keys = ON;
