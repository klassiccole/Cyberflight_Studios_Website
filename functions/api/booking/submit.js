/* Shoot-request handler: verifies Turnstile and honeypot, validates the
   adaptive form fields, and emails the owner via Resend. Reply-To is the
   visitor. No database, no calendar integration — the real scheduling
   happens in the follow-up conversation. */
import {BookingError, validateBooking, emailSubject, emailText, emailHtml} from '../../../lib/booking-form.mjs';

function json(body, status = 200) {
  return Response.json(body, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow'}});
}

export async function onRequest({ request, env }) {
  const diagnosticId = crypto.randomUUID();
  try {
    if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
    const form = await request.formData();
    const website = String(form.get('website') ?? '').trim();
    const token = String(form.get('cf-turnstile-response') ?? '');
    /* Honeypot: silently accept and discard bot submissions. */
    if (website) return json({ok: true});
    if (typeof env.TURNSTILE_SECRET !== 'string' || !env.TURNSTILE_SECRET) return json({error: 'verification_unavailable'}, 503);
    if (!token || token.length > 2048) return json({error: 'verification_unavailable'}, 400);
    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({secret: env.TURNSTILE_SECRET, response: token,
        ...(request.headers.get('CF-Connecting-IP') ? {remoteip: request.headers.get('CF-Connecting-IP')} : {})}) });
    if (!verifyResponse.ok) return json({error: 'verification_unavailable'}, 503);
    const verification = await verifyResponse.json();
    if (verification.success !== true) return json({error: 'verification_failed'}, 403);

    const plain = {};
    for (const key of ['shot', 'gradPackage', 'rePackage', 'reAddress', 'reUnit', 'reCity', 'reZip', 'reDate', 'reTime', 'ppPackage', 'ppCount', 'ppDate', 'ppTime', 'ppPlace', 'ppPlaceUnsure', 'gradCount', 'gradDate', 'gradTime', 'gradPlace', 'gradPlaceText', 'otherTitle', 'name', 'email', 'phone', 'contactPref', 'notes']) {
      const value = form.get(key);
      plain[key] = value === null ? undefined : String(value);
    }
    let booking;
    try {
      booking = validateBooking(plain);
    } catch (error) {
      if (error instanceof BookingError) return json({error: error.code}, error.status);
      throw error;
    }

    if (typeof env.RESEND_API_KEY !== 'string' || !env.RESEND_API_KEY) return json({error: 'request_unavailable'}, 503);
    if (typeof env.BOOKING_OWNER_EMAIL !== 'string' || !env.BOOKING_OWNER_EMAIL.trim()) return json({error: 'request_unavailable'}, 503);
    const sendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({from: 'Cyberflight Studios <cole@cyberflight.studio>',
        to: [env.BOOKING_OWNER_EMAIL.trim()],
        reply_to: booking.email,
        subject: emailSubject(booking), text: emailText(booking), html: emailHtml(booking)}) });
    if (!sendResponse.ok) {
      const body = await sendResponse.text().catch(() => '');
      console.error(JSON.stringify({event: 'booking_send_failed', status: sendResponse.status, body: body.slice(0, 120), diagnosticId}));
      return json({error: 'send_failed'}, 503);
    }
    return json({ok: true});
  } catch (error) {
    console.error(JSON.stringify({event: 'booking_form_failed', diagnosticId}));
    return json({error: 'request_unavailable'}, 503);
  }
}
