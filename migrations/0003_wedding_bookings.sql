-- Wedding booking support: adds 'wedding' to the allowed package types.
-- The table is recreated (empty in production) with the expanded CHECK,
-- and triggers are recreated since dropping a table drops its triggers.
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS booking_jobs;
DROP TABLE IF EXISTS booking_requests;

CREATE TABLE booking_requests (
  id TEXT PRIMARY KEY NOT NULL,
  submission_key_hash TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at = created_at + 172800),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'expired')),
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
CREATE INDEX booking_requests_expiry ON booking_requests(status, expires_at);

CREATE TRIGGER booking_requests_insert_guard
BEFORE INSERT ON booking_requests
BEGIN
  SELECT RAISE(ABORT, 'request_must_start_pending') WHERE NEW.status <> 'pending';
  SELECT RAISE(ABORT, 'booking_overlap') WHERE EXISTS (
    SELECT 1 FROM booking_requests r
    WHERE (r.status = 'approved' OR (r.status = 'pending' AND r.expires_at > unixepoch()))
      AND NEW.busy_start < r.busy_end AND NEW.busy_end > r.busy_start
  );
END;

CREATE TRIGGER booking_requests_snapshot_immutable
BEFORE UPDATE OF id, submission_key_hash, payload_hash, created_at, expires_at,
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
  SELECT RAISE(ABORT, 'hold_expired')
    WHERE NEW.status IN ('approved', 'declined') AND OLD.expires_at <= unixepoch();
  SELECT RAISE(ABORT, 'hold_not_expired')
    WHERE NEW.status = 'expired' AND OLD.expires_at > unixepoch();
  SELECT RAISE(ABORT, 'booking_overlap') WHERE NEW.status = 'approved' AND EXISTS (
    SELECT 1 FROM booking_requests r
    WHERE r.id <> OLD.id
      AND (r.status = 'approved' OR (r.status = 'pending' AND r.expires_at > unixepoch()))
      AND NEW.busy_start < r.busy_end AND NEW.busy_start > r.busy_start
  );
END;

CREATE TABLE booking_jobs (
  id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES booking_requests(id),
  kind TEXT NOT NULL CHECK (kind IN ('notify_owner', 'approve_delivery', 'notify_decline', 'notify_expired')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
  lease_until INTEGER,
  last_error_code TEXT,
  UNIQUE (request_id, kind)
);

CREATE TRIGGER booking_request_notification
AFTER INSERT ON booking_requests
BEGIN
  INSERT INTO booking_jobs(request_id, kind) VALUES (NEW.id, 'notify_owner');
END;

CREATE TRIGGER booking_decision_notification
AFTER UPDATE OF status ON booking_requests
BEGIN
  INSERT INTO booking_jobs(request_id, kind) VALUES (
    NEW.id, CASE NEW.status
      WHEN 'approved' THEN 'approve_delivery'
      WHEN 'declined' THEN 'notify_decline'
      WHEN 'expired' THEN 'notify_expired'
    END
  );
END;

PRAGMA foreign_keys = ON;
