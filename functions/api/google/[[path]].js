/* Cyberflight Google connection. Runs only in Cloudflare Pages Functions. */
const SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events.owned.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy'];
const COOKIE = '__Host-cyberflight-oauth';
const encoder = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const hash = async value => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));

async function cryptKey(env) {
  const bytes = decode(env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  if (bytes.length !== 32) throw new Error('configuration');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(key, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, encoder.encode(value));
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
async function unseal(key, value, context) {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1') throw new Error('encryption');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(context) }, key, decode(ciphertext)));
}
function response(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'",
    ...extra
  }});
}
function page(text, form = '') {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cyberflight Google connection</title><h1>Google Calendar connection</h1><p>${text}</p>${form}</html>`;
}
async function googleJSON(url, options = {}) {
  const result = await fetch(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!result.ok || !result.body) throw new Error('google');
  const reader = result.body.getReader();
  const chunks = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 65536) { await reader.cancel(); throw new Error('response size'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const callback = url.pathname === '/api/google/callback';
  const clearCookie = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
  try {
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_ALLOWED_EMAIL', 'GOOGLE_TOKEN_ENCRYPTION_KEY']) {
      if (!env[name]) throw new Error('configuration');
    }
    if (!env.BOOKING_DB) throw new Error('configuration');
    const redirect = new URL(env.GOOGLE_REDIRECT_URI);
    if (redirect.protocol !== 'https:' || redirect.pathname !== '/api/google/callback' || redirect.search || redirect.hash) throw new Error('configuration');
    if (url.origin !== redirect.origin) return response(page('Use the primary Cyberflight website to connect Google.'), 403);
    const key = await cryptKey(env);
    const now = Math.floor(Date.now() / 1000);

    if (url.pathname === '/api/google/connect') {
      if (request.method === 'GET') return response(page('Connect the Cyberflight Google account to enable calendar integration.', '<form method="post"><button type="submit">Connect Google Calendar</button></form>'));
      if (request.method !== 'POST') return response('', 405, { Allow: 'GET, POST' });
      if (request.headers.get('Origin') !== url.origin) return response(page('Start the connection from this website.'), 403);
      const state = random(), browser = random(), verifier = random();
      const stateHash = await hash(state);
      await env.BOOKING_DB.prepare('DELETE FROM google_oauth_states WHERE expires_at <= ?').bind(now).run();
      await env.BOOKING_DB.prepare('INSERT INTO google_oauth_states (state_hash, browser_hash, encrypted_code_verifier, expires_at) VALUES (?, ?, ?, ?)')
        .bind(stateHash, await hash(browser), await seal(key, verifier, `state:${stateHash}`), now + 600).run();
      const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorize.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect.href,
        response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
        login_hint: env.GOOGLE_ALLOWED_EMAIL, state,
        code_challenge: (await hash(verifier)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''), code_challenge_method: 'S256' }).toString();
      return response(null, 303, { Location: authorize.href, 'Set-Cookie': `${COOKIE}=${browser}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` });
    }

    if (callback) {
      if (request.method !== 'GET') return response('', 405, { Allow: 'GET' });
      const state = url.searchParams.get('state') || '';
      const browser = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) throw new Error('state');
      const stateHash = await hash(state);
      const row = await env.BOOKING_DB.prepare('DELETE FROM google_oauth_states WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING encrypted_code_verifier')
        .bind(stateHash, await hash(browser), now).first();
      if (!row || url.searchParams.has('error')) throw new Error('state');
      const code = url.searchParams.get('code');
      if (!code || code.length > 8192) throw new Error('code');
      const tokens = await googleJSON('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code,
        code_verifier: await unseal(key, row.encrypted_code_verifier, `state:${stateHash}`),
        grant_type: 'authorization_code', redirect_uri: redirect.href
      }) });
      if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw new Error('token');
      const granted = new Set((tokens.scope || '').split(' '));
      if (!SCOPES.slice(2).every(scope => granted.has(scope))) throw new Error('scopes');
      const account = await googleJSON('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const email = String(account.email || '').toLowerCase();
      if (account.email_verified !== true || email !== env.GOOGLE_ALLOWED_EMAIL.toLowerCase()) throw new Error('account');
      await env.BOOKING_DB.prepare('INSERT INTO google_connections (account_email, encrypted_refresh_token, granted_scopes, connected_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_email) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, granted_scopes = excluded.granted_scopes, updated_at = excluded.updated_at')
        .bind(email, await seal(key, tokens.refresh_token, `refresh:${email}`), tokens.scope, now, now).run();
      return response(null, 303, { Location: '/api/google/result?connected=1', 'Set-Cookie': clearCookie });
    }
    if (url.pathname === '/api/google/result' && request.method === 'GET') return response(page(url.searchParams.get('connected') === '1'
      ? 'Authorization completed. The connection was saved during the callback. This page does not check current calendar access. You can close this tab.'
      : 'Connection did not complete. Check the configured account, permissions, secrets and database binding, then start again at /api/google/connect.'));
    return response(page('Not found.'), 404);
  } catch {
    // Do not log authorization codes, credentials, tokens, or Google responses.
    if (callback) return response(null, 303, { Location: '/api/google/result?connected=0', 'Set-Cookie': clearCookie });
    return response(page('Connection setup is unavailable. Check the production secrets and BOOKING_DB binding.'), 503);
  }
}
