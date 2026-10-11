// worker/src/door/oauth.js
// Sign in with Google or GitHub (docs/superpowers/specs/
// 2026-10-10-accounts-and-sign-in-design.md, "Methods, by phase").
//
// The authorization code flow with PKCE, and for Google a nonce. The round
// trip's state rides in `__Host-md_oauth`, sealed by the edge and good for ten
// minutes; the callback refuses anything that does not match it. An account is
// keyed on Google's `sub` or GitHub's numeric id, never on an email. Provider
// access tokens are read once for the identity and dropped.

import { b64urlDecode, b64urlEncode, randomId, seal, unseal } from './tokens.js';

export const APEX_ORIGIN = 'https://marbledrive.app';
export const OAUTH_COOKIE = '__Host-md_oauth';
const OAUTH_TTL = 600;

export class DoorError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const PROVIDERS = {
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    id: (env) => env.GOOGLE_CLIENT_ID,
    secret: (env) => env.GOOGLE_CLIENT_SECRET,
  },
  github: {
    label: 'GitHub',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    id: (env) => env.GITHUB_CLIENT_ID,
    secret: (env) => env.GITHUB_CLIENT_SECRET,
  },
};

export const isProvider = (p) => Object.hasOwn(PROVIDERS, p);
export const providerReady = (p, env) => isProvider(p) && Boolean(PROVIDERS[p].id(env) && PROVIDERS[p].secret(env));
export const redirectUri = (p) => `${APEX_ORIGIN}/auth/${p}/callback`;

const enc = new TextEncoder();
const challengeOf = async (verifier) => b64urlEncode(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));

export const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/** The redirect to the provider, with the round trip's state in a cookie.
 *  `invite` and `to` come back on the other side of it. */
export async function start(provider, { env, invite = null, to = null, now = Date.now() }) {
  if (!providerReady(provider, env)) throw new DoorError(`Sign-in with ${PROVIDERS[provider]?.label ?? 'that'} isn't set up yet.`, 404);
  const p = PROVIDERS[provider];
  const state = randomId(16);
  const verifier = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = provider === 'google' ? randomId(16) : null;
  const url = new URL(p.authorize);
  url.searchParams.set('client_id', p.id(env));
  url.searchParams.set('redirect_uri', redirectUri(provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await challengeOf(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (nonce) url.searchParams.set('nonce', nonce);
  if (provider === 'google') url.searchParams.set('prompt', 'select_account');
  if (provider === 'github') url.searchParams.set('allow_signup', 'true');
  const sealed = await seal(env.DOOR_SIGNING_KEY, 'oauth', { p: provider, state, verifier, nonce, invite, to }, { now, ttlSeconds: OAUTH_TTL });
  return new Response(null, {
    status: 302,
    headers: { location: url.href, 'set-cookie': cookie(OAUTH_COOKIE, sealed, OAUTH_TTL), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

const STALE = 'That sign-in took too long, or started in another browser. Start again.';

async function form(fetchImpl, url, params, headers = {}) {
  try {
    return await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    return null;
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function idTokenClaims(idToken) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
}

/** The person the provider vouched for: `{ provider, subject, email, name }`,
 *  plus the `invite` and `to` the round trip carried. Throws a DoorError whose
 *  words go on the page; nothing in them comes from the request. */
export async function finish(provider, request, { env, fetchImpl = fetch, now = Date.now() }) {
  if (!providerReady(provider, env)) throw new DoorError(`Sign-in with ${PROVIDERS[provider]?.label ?? 'that'} isn't set up yet.`, 404);
  const p = PROVIDERS[provider];
  const url = new URL(request.url);
  if (url.searchParams.get('error')) throw new DoorError(`Signing in with ${p.label} was cancelled.`);
  const kept = await unseal(env.DOOR_SIGNING_KEY, 'oauth', readCookie(request, OAUTH_COOKIE), { now });
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!kept || kept.p !== provider || !state || state !== kept.state || !code) throw new DoorError(STALE);
  const carried = { invite: kept.invite ?? null, to: kept.to ?? null };

  if (provider === 'google') {
    const res = await form(fetchImpl, p.token, {
      code,
      client_id: p.id(env),
      client_secret: p.secret(env),
      redirect_uri: redirectUri(provider),
      grant_type: 'authorization_code',
      code_verifier: kept.verifier,
    });
    const body = res?.ok ? await readJson(res) : null;
    if (!body?.id_token) throw new DoorError('Google didn’t accept the sign-in. Start again.', 502);
    // Straight from Google's token endpoint over TLS, so its signature need
    // not be checked again (OpenID Connect Core 3.1.3.7); its claims still are.
    const claims = idTokenClaims(body.id_token);
    const issuers = ['https://accounts.google.com', 'accounts.google.com'];
    if (!claims || !issuers.includes(claims.iss) || claims.aud !== p.id(env)) throw new DoorError('Google’s answer was for another app. Start again.', 502);
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) throw new DoorError(STALE);
    if (!kept.nonce || claims.nonce !== kept.nonce) throw new DoorError(STALE);
    if (claims.email_verified !== true && claims.email_verified !== 'true') throw new DoorError('Google hasn’t confirmed this email address, so it can’t be used to sign in.', 403);
    if (typeof claims.sub !== 'string' || !claims.sub) throw new DoorError('Google’s answer had no account in it. Start again.', 502);
    return { provider, subject: claims.sub, email: String(claims.email ?? ''), name: String(claims.name ?? claims.given_name ?? ''), ...carried };
  }

  // GitHub
  const res = await form(fetchImpl, p.token, {
    client_id: p.id(env),
    client_secret: p.secret(env),
    code,
    redirect_uri: redirectUri(provider),
    code_verifier: kept.verifier,
  });
  const token = res?.ok ? (await readJson(res))?.access_token : null;
  if (!token) throw new DoorError('GitHub didn’t accept the sign-in. Start again.', 502);
  const api = async (path) => {
    try {
      const r = await fetchImpl(`https://api.github.com${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'marble-drive-door', 'x-github-api-version': '2022-11-28' },
      });
      return r.ok ? await readJson(r) : null;
    } catch {
      return null;
    }
  };
  const user = await api('/user');
  if (!user || !Number.isInteger(user.id)) throw new DoorError('GitHub didn’t say who you are. Start again.', 502);
  const emails = await api('/user/emails');
  const primary = Array.isArray(emails) ? emails.find((e) => e?.primary && e?.verified) : null;
  if (!primary) throw new DoorError('Your GitHub account has no verified email address. Verify one on GitHub, then sign in again.', 403);
  return { provider, subject: String(user.id), email: String(primary.email), name: String(user.name || user.login || ''), ...carried };
}
