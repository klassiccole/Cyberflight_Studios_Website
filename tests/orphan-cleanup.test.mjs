import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/availability.js';

test('orphan row (deleted calendar event) is removed by reconciliation', async t => {
  const now = Math.floor(Date.now() / 1000);
  const date = new Date((now + 10 * 86400) * 1000).toISOString().slice(0, 10);
  const schema = readFileSync(new URL('../migrations/0002_booking_services.sql', import.meta.url), 'utf8');
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=OFF');
  sqlite.exec(schema);
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`CREATE TABLE google_connections (account_email TEXT PRIMARY KEY, encrypted_refresh_token TEXT NOT NULL)`);
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt', 'encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('refresh:owner@example.com') }, key, new TextEncoder().encode('local-fixture'));
  const b64 = bytes => Buffer.from(bytes).toString('base64');
  sqlite.prepare('INSERT INTO google_connections (account_email, encrypted_refresh_token) VALUES (?, ?)').run('owner@example.com', `v1.${b64(iv)}.${b64(cipher)}`);
  sqlite.prepare(`INSERT INTO booking_requests (id, submission_key_hash, payload_hash, created_at, expires_at, service, session_start, session_end, busy_start, busy_end, package_id, price_cents, customer_json, agreement_version, agreement_text, agreement_sha256, signature_json) VALUES ('ORPHAN', 'k', 'p', ?, ?, 'event', 1000000, 1003600, 998200, 1005400, 'event', 0, '{}', 'v', 't', 'h', '{}')`).run(now - 7200, now - 7200 + 172800);
  const deleted = [];
  const env = { BOOKING_DB: { prepare(sql) { const st = sqlite.prepare(sql); const result = { bind(...a) { return {
    async first() { if (sql.includes('google_connections')) return { encrypted_refresh_token: `v1.${b64(iv)}.${b64(cipher)}` }; return st.get(...a) ?? null; },
    async all() { if (sql.includes('SELECT id, created_at FROM booking_requests')) return { success: true, results: [{ id: 'ORPHAN', created_at: now - 7200 }] }; return { success: true, results: st.all(...a) }; },
    async run() { st.run(...a); return { success: true }; }
  }; } }; result.all = async () => { if (sql.includes('SELECT id, created_at FROM booking_requests')) return { success: true, results: [{ id: 'ORPHAN', created_at: now - 7200 }] }; return { success: true, results: st.all(...a) }; }; result.run = async () => { st.run(...a); return { success: true }; }; return result; } }, GOOGLE_ALLOWED_EMAIL: 'owner@example.com', GOOGLE_TOKEN_ENCRYPTION_KEY: b64(keyBytes),
    GOOGLE_CLIENT_ID: 'f', GOOGLE_CLIENT_SECRET: 'f', GOOGLE_AVAILABILITY_CALENDAR_ID: 'availability',
    GOOGLE_BOOKINGS_CALENDAR_ID: 'bookings', GOOGLE_PERSONAL_CALENDAR_ID: 'personal' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = String(url);
    if (target.includes('/token')) return Response.json({ access_token: 't' });
    if (target.includes('privateExtendedProperty=requestId:ORPHAN')) return Response.json({ items: [] });
    if (options?.method === 'DELETE') { deleted.push(target); return Response.json({}); }
    if (target.includes('/events')) return Response.json({ items: [] });
    if (target.includes('/freeBusy')) return Response.json({ calendars: { bookings: { busy: [] }, personal: { busy: [] } } });
    throw new Error('Unexpected fetch: ' + target);
  });
  const response = await onRequest({ env, request: new Request(`https://cyberflight.studio/api/availability?start=${date}&package=standard`) });
  assert.equal(response.status, 200);
  const row = sqlite.prepare('SELECT count(*) n FROM booking_requests').get();
  assert.equal(row.n, 0);
  assert.equal(deleted.length, 0);
});
