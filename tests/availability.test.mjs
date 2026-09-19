import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/availability.js';

test('availability combines Google busy events and database reservations', async t => {
  const now = Math.floor(Date.now() / 1000);
  const date = new Date((now + 10 * 86400) * 1000).toISOString().slice(0, 10);
  // Use the actual Eastern offset for the selected date, including winter runs.
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
  const offset = 12 - Number(zone.format(new Date(`${date}T12:00:00Z`)));
  const seconds = hour => Date.parse(`${date}T00:00:00Z`) / 1000 + (hour + offset) * 3600;
  const iso = hour => new Date(seconds(hour) * 1000).toISOString();
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.function('unixepoch', () => now);
  sqlite.exec('CREATE TABLE booking_requests (status TEXT, expires_at INTEGER, busy_start INTEGER, busy_end INTEGER)');
  const email = 'owner@example.com';
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`refresh:${email}`) }, key, new TextEncoder().encode('local-fixture'));
  const b64 = bytes => Buffer.from(bytes).toString('base64');
  const encrypted = `v1.${b64(iv)}.${b64(cipher)}`;
  let databaseFailure = false;
  const db = { prepare(sql) {
    return { bind(...args) { return {
      async first() { assert.ok(sql.includes('google_connections')); return { encrypted_refresh_token: encrypted }; },
      async all() {
        if (databaseFailure) throw new Error('database unavailable');
        return { success: true, results: sqlite.prepare(sql).all(...args) };
      }
    }; } };
  } };
  const env = { BOOKING_DB: db, GOOGLE_ALLOWED_EMAIL: email, GOOGLE_TOKEN_ENCRYPTION_KEY: b64(keyBytes),
    GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture', GOOGLE_AVAILABILITY_CALENDAR_ID: 'availability',
    GOOGLE_BOOKINGS_CALENDAR_ID: 'bookings', GOOGLE_PERSONAL_CALENDAR_ID: 'personal' };
  let personal = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/token')) return Response.json({ access_token: 'local-token' });
    if (String(url).includes('/events')) return Response.json({ items: [{ start: { dateTime: iso(12.5) }, end: { dateTime: iso(18) } }] });
    if (String(url).includes('/freeBusy')) return Response.json({ calendars: { bookings: { busy: [] }, personal: { busy: personal } } });
    throw new Error('Unexpected network destination');
  });
  const request = () => onRequest({ env, request: new Request(`https://cyberflight.studio/api/availability?start=${date}&package=standard`) });
  const slots = async () => {
    const response = await request(); assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const data = await response.json();
    assert.deepEqual(Object.keys(data.days[0]).sort(), ['key', 'slots']);
    return data.days[0].slots;
  };
  const reset = () => { sqlite.exec('DELETE FROM booking_requests'); personal = []; databaseFailure = false; };
  const reserve = (status, expires = now + 172800) => sqlite.prepare('INSERT INTO booking_requests VALUES (?, ?, ?, ?)').run(status, expires, seconds(12.5), seconds(15));

  await t.test('empty database preserves Google openings', async () => {
    assert.deepEqual(await slots(), [780, 810, 840, 870, 900, 930, 960]);
  });
  await t.test('active pending hold blocks conflicts but permits touching buffers', async () => {
    reset(); reserve('pending');
    assert.deepEqual(await slots(), [930, 960]);
  });
  await t.test('approved reservation remains blocked after its original hold deadline', async () => {
    reset(); reserve('approved', now - 1);
    assert.deepEqual(await slots(), [930, 960]);
  });
  await t.test('declined and expired requests release the interval at the exact deadline', async () => {
    for (const [status, expiry] of [['declined', now + 100], ['expired', now - 1], ['pending', now]]) {
      reset(); reserve(status, expiry);
      assert.deepEqual(await slots(), [780, 810, 840, 870, 900, 930, 960]);
    }
  });
  await t.test('personal calendar conflicts still apply alongside saved holds', async () => {
    reset(); reserve('pending'); personal = [{ start: iso(16.5), end: iso(17) }];
    assert.deepEqual(await slots(), []);
  });
  await t.test('database outage fails closed instead of advertising held times', async () => {
    reset(); databaseFailure = true;
    t.mock.method(console, 'error', () => {});
    const response = await request(); assert.equal(response.status, 503);
    assert.equal((await response.json()).days, undefined);
  });
});
