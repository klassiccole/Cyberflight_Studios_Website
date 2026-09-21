/* Live availability. Reads Google calendars only: the calendar is the source of truth. */
import {accessToken, googleJSON, ZONE} from '../../lib/google-auth.mjs';
const MINUTE = 60000;
const DURATIONS = { mini: 30, standard: 90, group: 90 };
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function dateKey(ms) {
  const parts = dateFormat.formatToParts(new Date(ms));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
function addDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function localMinutes(ms) {
  const parts = timeFormat.formatToParts(new Date(ms));
  return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
}
function midnight(key) {
  // Charlotte uses UTC-4 or UTC-5; verify the date and hour across DST changes.
  for (const offset of [4, 5]) {
    const ms = Date.parse(`${key}T00:00:00Z`) + offset * 3600000;
    if (dateKey(ms) === key && localMinutes(ms) === 0) return ms;
  }
  throw new Error('date');
}
function reply(body, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  } });
}
function interval(start, end) {
  // Require explicit offsets instead of interpreting a timestamp in the server timezone.
  const valid = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!valid(start) || !valid(end)) throw new Error('calendar-data');
  const a = Date.parse(start), b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw new Error('calendar-data');
  return [a, b];
}
function merge(ranges) {
  const out = [];
  for (const [a, b] of ranges.sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
async function openingWindows(env, token, timeMin, timeMax, signal) {
  const ranges = []; let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_AVAILABILITY_CALENDAR_ID)}/events`);
    url.search = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', showDeleted: 'false',
      eventTypes: 'default', maxResults: '250', timeZone: ZONE,
      fields: 'nextPageToken,items(status,start,end)', ...(pageToken ? { pageToken } : {}) }).toString();
    const data = await googleJSON(url.href, { headers: { Authorization: `Bearer ${token}` } }, signal);
    if (data.items !== undefined && !Array.isArray(data.items)) throw new Error('calendar-data');
    for (const event of data.items || []) {
      if (event.status === 'cancelled') continue;
      // All-day entries are notes, not explicit opening hours.
      if (event.start?.date && event.end?.date) continue;
      ranges.push(interval(event.start?.dateTime, event.end?.dateTime));
    }
    if (!data.nextPageToken) return merge(ranges);
    if (typeof data.nextPageToken !== 'string') throw new Error('calendar-data');
    pageToken = data.nextPageToken;
  }
  throw new Error('pagination-limit');
}
async function busyWindows(env, token, timeMin, timeMax, signal) {
  const ids = [...new Set([env.GOOGLE_BOOKINGS_CALENDAR_ID, env.GOOGLE_PERSONAL_CALENDAR_ID])];
  const data = await googleJSON('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, timeZone: ZONE, items: ids.map(id => ({ id })) })
  }, signal);
  const ranges = [];
  for (const id of ids) {
    const calendar = data.calendars?.[id];
    if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) throw new Error('calendar-access');
    for (const busy of calendar.busy) ranges.push(interval(busy.start, busy.end));
  }
  return merge(ranges);
}
function calculateDays(start, duration, openings, busy, now) {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, i), dayStart = midnight(key), dayEnd = midnight(addDays(key, 1));
    const slots = [], seen = new Set();
    for (let t = dayStart; t < dayEnd; t += 30 * MINUTE) {
      const a = t - 30 * MINUTE, b = t + (duration + 30) * MINUTE;
      if (t < now + 120 * 60 * MINUTE) continue;
      if (!openings.some(([x, y]) => a >= x && b <= y)) continue;
      if (busy.some(([x, y]) => a < y && b > x)) continue;
      const minute = localMinutes(t);
      if (dayEnd - dayStart > 24 * 60 * MINUTE && minute >= 60 && minute < 120) continue;
      // The browser identifies slots by local minutes: omit the repeated fall-back hour.
      if (seen.has(minute)) { const n = slots.indexOf(minute); if (n >= 0) slots.splice(n, 1); continue; }
      seen.add(minute); slots.push(minute);
    }
    return { key, slots: slots.sort((a, b) => a - b) };
  });
}
/* Holds that expired without approval release their calendar event here, so
   no cron is needed. Missing events (already deleted by the owner) are fine. */
/* Keeps the database consistent with the calendar, which the owner manages.
   Expired holds: their HOLD events are deleted and the rows marked expired.
   Holds whose calendar event has vanished (the owner deleted it to decline)
   are marked declined, so the slot is free for re-booking immediately. */
/* Keeps the database consistent with the calendar. The owner manages bookings
   by editing the Bookings Calendar directly: when an event is deleted there,
   the saved request row is deleted too, removing all its information. Rows
   without an event are also removed (event write failed or rolled back).
   Fresh submissions get a short grace period before this check applies. */
async function reconcileBookingsWithCalendar(env) {
  console.error(JSON.stringify({event:'RECONCILE_CALLED'}));
  const rows = await env.BOOKING_DB.prepare(`SELECT id, created_at FROM booking_requests`).all();
  if (!rows.success || !Array.isArray(rows.results) || !rows.results.length) return;
  const signal = AbortSignal.timeout(15000);
  const token = await accessToken(env, signal);
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows.results) {
    if (typeof row.id !== 'string' || !row.id) continue;
    if (Number(row.created_at) > now - 120) continue;
    let items = null;
    try {
      const search = await googleJSON(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_BOOKINGS_CALENDAR_ID)}/events?privateExtendedProperty=requestId:${encodeURIComponent(row.id)}`, { headers: { Authorization: `Bearer ${token}` } }, signal);
      items = Array.isArray(search.items) ? search.items : null;
    } catch(error) {
      // A failed lookup must never delete a booking: skip this row.
      continue;
    }
    if (items === null || items.length) continue;
    await env.BOOKING_DB.prepare('DELETE FROM booking_jobs WHERE request_id=?').bind(row.id).run();
    await env.BOOKING_DB.prepare('DELETE FROM booking_requests WHERE id=?').bind(row.id).run();
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
  const requestId = crypto.randomUUID(); let stage = 'configuration';
  try {
    const url = new URL(request.url), now = Date.now();
    const start = url.searchParams.get('start'), packageId = url.searchParams.get('package');
    const isEvent = packageId === 'event';
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(`${start}T12:00:00Z`)) || addDays(start, 0) !== start || (!isEvent && !Object.hasOwn(DURATIONS, packageId))) {
      return reply({ error: 'Invalid date or package.' }, 400);
    }
    const today = dateKey(now);
    const windowDays = isEvent ? 180 : 35;
    if (start < today || start > addDays(today, windowDays)) return reply({ error: 'Date outside booking window.' }, 400);
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY', 'GOOGLE_ALLOWED_EMAIL',
      'GOOGLE_AVAILABILITY_CALENDAR_ID', 'GOOGLE_BOOKINGS_CALENDAR_ID', 'GOOGLE_PERSONAL_CALENDAR_ID']) {
      if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error('configuration');
    }
    if (!env.BOOKING_DB) throw new Error('configuration');
    const signal = AbortSignal.timeout(20000);
    stage = 'refresh-token';
    const token = await accessToken(env, signal);
    const timeMin = new Date(midnight(start) - 30 * MINUTE).toISOString();
    const timeMax = new Date(midnight(addDays(start, 7)) + 120 * MINUTE).toISOString();
    stage = 'busy-calendars';
    const busy = await busyWindows(env, token, timeMin, timeMax, signal);
    stage = 'expired-holds';
    const busyAll = merge([...busy]);
    stage = 'expired-hold-cleanup';
    try { await reconcileBookingsWithCalendar(env); } catch(error) { console.error(JSON.stringify({event:'reconcile_failed',reason:String(error&&error.message||'unknown').slice(0,80)})); }
    if (isEvent) {
      // Event coverage ignores opening hours; the client computes which start
      // times fit a chosen length inside these clear ranges (epoch ms).
      return reply({ source: 'google', timeZone: ZONE, start, package: 'event',
        checkedAt: new Date(now).toISOString(), busy: busyAll });
    }
    stage = 'availability-calendar';
    const openings = await openingWindows(env, token, timeMin, timeMax, signal);
    stage = 'calculate';
    return reply({ source: 'google', timeZone: ZONE, start, package: packageId,
      checkedAt: new Date(now).toISOString(), days: calculateDays(start, DURATIONS[packageId], openings, busyAll, now) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const safe = /^(http-\d{3}|not-connected|key|token|calendar-data|calendar-access|pagination-limit|response-size|configuration|date)$/.test(message);
    console.error(JSON.stringify({ event: 'availability-failed', requestId, stage, reason: safe ? message : 'runtime-error' }));
    return reply({ error: 'Availability could not be loaded. Please try again or contact us.', requestId }, 503);
  }
}
