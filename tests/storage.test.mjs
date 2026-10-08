import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const schema = readFileSync(new URL('../migrations/0004_remove_hold.sql', import.meta.url), 'utf8');
const NOW = 1800000000;
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(schema);
  return db;
}
function insert(db, id, {start = NOW + 6 * 86400, duration = 5400, key = id, packageId = 'standard'} = {}) {
  db.prepare(`INSERT INTO booking_requests
    (id, submission_key_hash, payload_hash, created_at,
     session_start, session_end, busy_start, busy_end, package_id, price_cents,
     customer_json, agreement_version, agreement_text, agreement_sha256, signature_json)
    VALUES (?, ?, 'payload-hash', ?, ?, ?, ?, ?, ?, 20000,
      '{
        "name":"Test Customer"}', 'test-v1', 'Test agreement', 'agreement-hash',
      '{"typedName":"Test Customer","agreementConsent":true,"electronicConsent":true}')`)
    .run(id, key, NOW, start, start + duration, start - 1800, start + duration + 1800, packageId);
}
function decide(db, id, status, message = null) {
  db.prepare('UPDATE booking_requests SET status=?, decision_at=?, decline_message=? WHERE id=?')
    .run(status, NOW, message, id);
}

test('submission stores the signed agreement snapshot and customer details', () => {
  const db = setup(); insert(db, 'a');
  const row = db.prepare('SELECT * FROM booking_requests').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.agreement_text, 'Test agreement');
  assert.equal(JSON.parse(row.signature_json).typedName, 'Test Customer');
  db.close();
});
test('overlapping requests, including buffers, are rejected', () => {
  const db = setup(); insert(db, 'a');
  for (const offset of [0, -1800, 5400, 8999]) {
    assert.throws(() => insert(db, 'b', {start: NOW + 6 * 86400 + offset}), /booking_overlap/);
  }
  db.close();
});
test('touching buffer boundaries are permitted', () => {
  const db = setup(); insert(db, 'a'); insert(db, 'b', {start: NOW + 6 * 86400 + 9000}); db.close();
});
test('decline releases the time and preserves customer-facing reason', () => {
  const db = setup(); insert(db, 'a'); decide(db, 'a', 'declined', 'Location unavailable.'); insert(db, 'b');
  assert.equal(db.prepare("SELECT decline_message FROM booking_requests WHERE id='a'").get().decline_message, 'Location unavailable.');
  assert.throws(() => decide(db, 'a', 'approved'), /request_already_decided/); db.close();
});
test('approval is terminal and its slot blocks new requests', () => {
  const db = setup(); insert(db, 'a'); decide(db, 'a', 'approved');
  assert.throws(() => decide(db, 'a', 'approved'), /request_already_decided/);
  assert.throws(() => insert(db, 'b'), /booking_overlap/);
  db.close();
});
test('idempotency key cannot create a second request for a different slot', () => {
  const db = setup(); insert(db, 'a');
  assert.throws(() => insert(db, 'b', {key: 'a', start: NOW + 8 * 86400}), /UNIQUE/); db.close();
});
test('signed snapshot cannot be edited after submission', () => {
  const db = setup(); insert(db, 'a');
  for (const field of ['agreement_text', 'signature_json', 'customer_json', 'price_cents', 'session_start']) {
    assert.throws(() => db.exec(`UPDATE booking_requests SET ${field}=${field} WHERE id='a'`), /immutable/);
  }
  db.close();
});
