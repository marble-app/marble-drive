// Who may use the drive from Claude or ChatGPT, and with which tokens.
//
// A connector is an app on someone else's servers (claude.ai, chatgpt.com)
// that the owner lets into the drive once, at a page on this host, and that
// then holds a token. It is OAuth 2.1 at its smallest: a client registers
// itself (RFC 7591), the owner says yes at /oauth/authorize, the client trades
// the code for tokens with PKCE (S256 only), and refreshes them as it goes.
//
// `.marble/connector.json` holds the clients and the grants. A token is kept
// only as its SHA-256, so the file can be read, backed up or synced without
// handing anybody a way in. A grant is the owner's yes to one client: turning
// it off ends every token it ever gave out, at once. Codes live in memory for
// a minute — a restart in that minute costs one more "Allow".

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
export const ACCESS_TTL = 60 * MINUTE;
export const REFRESH_TTL = 90 * DAY;
const CODE_TTL = MINUTE;
const CLIENTS_MAX = 64;

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url');
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** A redirect a client may name: https anywhere, or plain http back to this
 *  machine (a desktop client listening on loopback). Nothing else, and no
 *  fragment, which OAuth forbids. */
export function redirectAllowed(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function createGrants({ dir, now = () => Date.now() }) {
  const file = path.join(dir, 'connector.json');
  let state = null;
  let loading = null;
  const codes = new Map();

  async function load() {
    if (state) return state;
    loading ??= (async () => {
      try {
        const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
        state = {
          clients: Array.isArray(raw.clients) ? raw.clients : [],
          grants: Array.isArray(raw.grants) ? raw.grants : [],
        };
      } catch {
        state = { clients: [], grants: [] };
      }
      return state;
    })();
    return loading;
  }

  // One write at a time, whole, through a temp file (as server/shares.js).
  let saving = Promise.resolve();
  async function write() {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(tmp, file);
  }
  function save() {
    const run = saving.then(write, write);
    saving = run.catch(() => {});
    return run;
  }

  /** RFC 7591: anyone may register, because registering opens nothing. The
   *  owner still has to say yes, on a page only the owner can reach. A client
   *  that registered and was never allowed is dropped first when the list is
   *  full. */
  async function register({ redirect_uris: redirects, client_name: name } = {}) {
    if (!Array.isArray(redirects) || !redirects.length || !redirects.every((r) => typeof r === 'string' && redirectAllowed(r))) {
      throw Object.assign(new Error('redirect_uris must be https addresses (or http on loopback)'), { code: 'invalid_redirect_uri' });
    }
    const s = await load();
    const client = {
      id: random(16),
      name: String(name ?? '').trim().slice(0, 80) || 'An app',
      redirects: [...new Set(redirects)].slice(0, 8),
      made: now(),
    };
    s.clients.push(client);
    while (s.clients.length > CLIENTS_MAX) {
      const idle = s.clients.findIndex((c) => !s.grants.some((g) => g.client === c.id));
      s.clients.splice(idle < 0 ? 0 : idle, 1);
    }
    await save();
    return client;
  }

  const client = async (id) => (await load()).clients.find((c) => c.id === id) ?? null;

  /** The owner said yes: a code for this client, good once, for a minute. */
  function issueCode({ clientId, redirect, challenge, scope }) {
    for (const [code, held] of codes) if (held.expires < now()) codes.delete(code);
    const code = random();
    codes.set(digest(code), { clientId, redirect, challenge, scope, expires: now() + CODE_TTL });
    return code;
  }

  async function tokensFor(grant) {
    const access = random();
    const refresh = random();
    grant.access = [...(grant.access ?? []).filter((a) => a.expires > now()), { hash: digest(access), expires: now() + ACCESS_TTL }];
    grant.refresh = { hash: digest(refresh), expires: now() + REFRESH_TTL };
    grant.used = now();
    await save();
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: grant.scope };
  }

  /** The code, its verifier and the redirect it was given for, traded for a
   *  new grant's tokens. Every mismatch is the same refusal. */
  async function exchange({ code, verifier, clientId, redirect }) {
    const key = digest(code ?? '');
    const held = codes.get(key);
    codes.delete(key);
    if (!held || held.expires < now() || held.clientId !== clientId || held.redirect !== redirect) return null;
    if (typeof verifier !== 'string' || digest(verifier) !== held.challenge) return null;
    const s = await load();
    const grant = { id: random(9), client: clientId, scope: held.scope, made: now() };
    s.grants.push(grant);
    return tokensFor(grant);
  }

  /** A refresh token is good once: using it gives a new pair. */
  async function refresh({ token, clientId }) {
    const s = await load();
    const hash = digest(token ?? '');
    const grant = s.grants.find((g) => g.refresh?.hash === hash && g.client === clientId);
    if (!grant || grant.refresh.expires < now()) return null;
    return tokensFor(grant);
  }

  /** The grant an access token belongs to, or null. */
  async function check(token) {
    if (typeof token !== 'string' || !token) return null;
    const s = await load();
    const hash = digest(token);
    const grant = s.grants.find((g) => (g.access ?? []).some((a) => a.hash === hash && a.expires > now()));
    if (!grant) return null;
    const who = s.clients.find((c) => c.id === grant.client);
    return { grant: grant.id, client: grant.client, name: who?.name ?? 'An app' };
  }

  /** What the owner sees: each app let in, and when it last came. */
  async function list() {
    const s = await load();
    return s.grants.map((g) => ({
      id: g.id,
      name: s.clients.find((c) => c.id === g.client)?.name ?? 'An app',
      made: g.made,
      used: g.used ?? null,
    }));
  }

  async function revoke(id) {
    const s = await load();
    const before = s.grants.length;
    s.grants = s.grants.filter((g) => g.id !== id);
    if (s.grants.length === before) return false;
    await save();
    return true;
  }

  return { register, client, issueCode, exchange, refresh, check, list, revoke, digest };
}
