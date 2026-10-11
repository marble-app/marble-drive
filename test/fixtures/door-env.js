// A Worker env with the door turned on, and nothing real behind it: the
// Directory and the Lease run in memory, Google and GitHub are fakes, and the
// signing key is made fresh for each env.
import nodeCrypto from 'node:crypto';

import { Directory } from '../../worker/src/door/directory.js';
import { Lease } from '../../worker/src/index.js';

/** Durable Object storage over a Map: get, put, delete, list({ prefix }). */
export function memoryStorage() {
  const map = new Map();
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    map,
    get: async (key) => clone(map.get(key)),
    put: async (key, value) => {
      map.set(key, clone(value));
    },
    delete: async (key) => map.delete(key),
    list: async ({ prefix = '' } = {}) => new Map([...map].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, clone(v)])),
  };
}

/** One object per name, made on first use, as the runtime does. */
export function namespace(make) {
  const objects = new Map();
  return {
    objects,
    idFromName: (name) => name,
    get: (id) => {
      if (!objects.has(id)) objects.set(id, make(id));
      return objects.get(id);
    },
  };
}

export function edgeKeys() {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519');
  return {
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export const DRIVES = JSON.stringify({ bryan: { mac: 'https://mac-bryan.marbledrive.app', pc: 'https://pc-bryan.marbledrive.app', fly: 'https://admin-p2-b3fwm.sprites.app' } });

export function doorEnv({ lease = { home: 'pc', epoch: 3, since: null }, maxDrives = '10', ...vars } = {}) {
  const keys = edgeKeys();
  const storage = memoryStorage();
  const env = {
    keys,
    storage,
    DRIVES,
    LEASE_TOKEN: 'lease-token',
    LEASE: namespace(() => {
      const s = memoryStorage();
      s.map.set('lease', lease);
      return new Lease({ storage: s });
    }),
    DIRECTORY: namespace(() => new Directory({ storage }, { MAX_DRIVES: maxDrives })),
    DOOR_SIGNING_KEY: keys.pkcs8,
    DOOR_KEY_ID: 'k1',
    DOOR_ADMIN_TOKEN: 'admin-token-for-tests-only',
    GOOGLE_CLIENT_ID: 'google-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-client',
    GITHUB_CLIENT_SECRET: 'github-secret',
    MAX_DRIVES: maxDrives,
    DOOR_SPRITE_URL: 'https://door-sprite.example',
    ...vars,
  };
  return env;
}

/** Google and GitHub, answering as the identity given (or failing as asked). */
export function fakeProviders({ google = {}, github = {} } = {}) {
  const calls = [];
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, method: init.method ?? 'GET', body: init.body ? String(init.body) : null, headers: new Headers(init.headers) });
    if (url.origin === 'https://door-sprite.example') return new Response('', { status: 202 });
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      if (google.fail) return reply(400, { error: 'invalid_grant' });
      const claims = {
        iss: 'https://accounts.google.com',
        aud: google.aud ?? 'google-client.apps.googleusercontent.com',
        sub: google.sub ?? '1100000000000001',
        email: google.email ?? 'ana@example.com',
        email_verified: google.email_verified ?? true,
        name: google.name ?? 'Ana',
        nonce: google.nonce ?? google.nonceFrom?.() ?? null,
        exp: google.exp ?? Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        ...(google.claims ?? {}),
      };
      return reply(200, { access_token: 'ya29.google-access-token', id_token: `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`, code: form.get('code') });
    }
    if (url.href === 'https://github.com/login/oauth/access_token') {
      if (github.fail) return reply(200, { error: 'bad_verification_code' });
      return reply(200, { access_token: 'gho_github-access-token', token_type: 'bearer' });
    }
    if (url.href === 'https://api.github.com/user') return reply(200, { id: github.id ?? 4242, login: github.login ?? 'ana', name: github.name ?? 'Ana' });
    if (url.href === 'https://api.github.com/user/emails') {
      return reply(200, github.emails ?? [{ email: 'ana@example.com', primary: true, verified: true }]);
    }
    return reply(404, { error: 'not faked' });
  };
  return { fetchImpl, calls };
}
