// worker/src/door/tokens.js
// Passes and grants: what the door hands a browser so a drive knows who it is
// (docs/superpowers/specs/2026-10-10-accounts-and-sign-in-design.md, "Where a
// session lives and how it reaches a drive").
//
//   v1.<kid>.<base64url(JSON payload)>.<base64url(Ed25519 signature)>
//
// The signature covers "v1.<kid>.<payload>". The edge holds the private key
// and each drive holds only public keys, so a drive (whose agent can read its
// own settings) can check a pass and never make one. WebCrypto only, and no
// Buffer: the same file runs in the Worker and under node --test.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < view.length; i += 1) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const pad = text.length % 4 === 2 ? '==' : text.length % 4 === 3 ? '=' : '';
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

const b64Decode = (text) => {
  const s = atob(String(text).trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
};

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** `bytes` random bytes as hex: session ids, invite codes, nonces. */
export function randomId(bytes = 16) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** What is stored in place of a secret: long random values need no slow hash. */
export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

const ED = { name: 'Ed25519' };

/** The edge's private key, from PKCS#8 in base64 (a Worker secret). */
export function importSigningKey(pkcs8Base64, extractable = false) {
  return crypto.subtle.importKey('pkcs8', b64Decode(pkcs8Base64), ED, extractable, ['sign']);
}

/** A public key, from SPKI in base64 (what a drive's MARBLE_DOOR_KEYS holds). */
export function importVerifyKey(spkiBase64) {
  return crypto.subtle.importKey('spki', b64Decode(spkiBase64), ED, true, ['verify']);
}

/** The public half of a private key, so the edge needs one secret, not two. */
export async function publicFromPrivate(pkcs8Base64) {
  const priv = await importSigningKey(pkcs8Base64, true);
  const jwk = await crypto.subtle.exportKey('jwk', priv);
  const pub = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, ED, true, ['verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pub));
  let s = '';
  for (const b of spki) s += String.fromCharCode(b);
  return { key: pub, spki: btoa(s) };
}

export async function sign(key, kid, payload) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new Error('a key id is letters, digits, - and _');
  const data = `v1.${kid}.${b64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign(ED, key, enc.encode(data));
  return `${data}.${b64urlEncode(sig)}`;
}

/** The payload, or null: bad shape, unknown key, bad signature, the wrong kind
 *  or drive, or expired. Never throws, because every caller would only turn a
 *  throw into a refusal. `now` is in milliseconds; `iat` and `exp` in seconds. */
export async function verify(keys, token, { now = Date.now(), typ, drv } = {}) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const [, kid, body, sig] = parts;
    const key = keys?.get?.(kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify(ED, key, b64urlDecode(sig), enc.encode(`v1.${kid}.${body}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(body)));
    if (!payload || typeof payload !== 'object') return null;
    if (typ !== undefined && payload.typ !== typ) return null;
    if (drv !== undefined && payload.drv !== drv) return null;
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- sealed cookies: the OAuth round trip's state, readable only by the edge.
// HMAC-SHA256 under a key derived from the signing key's secret text, so the
// door needs no second secret for it. Signed, not encrypted: what is inside is
// the person's own (their state, their invite), in their own HttpOnly cookie.

async function hmacKey(secretText, purpose) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`marble-door:${purpose}:${secretText}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function seal(secretText, purpose, value, { now = Date.now(), ttlSeconds = 600 } = {}) {
  const body = b64urlEncode(enc.encode(JSON.stringify({ v: value, exp: Math.floor(now / 1000) + ttlSeconds })));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secretText, purpose), enc.encode(body));
  return `${body}.${b64urlEncode(mac)}`;
}

export async function unseal(secretText, purpose, sealed, { now = Date.now() } = {}) {
  try {
    if (typeof sealed !== 'string') return null;
    const parts = sealed.split('.');
    if (parts.length !== 2) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secretText, purpose), b64urlDecode(parts[1]), enc.encode(parts[0]));
    if (!ok) return null;
    const { v, exp } = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    if (!Number.isFinite(exp) || exp * 1000 <= now) return null;
    return v;
  } catch {
    return null;
  }
}

/** A constant-time string comparison, for bearer tokens. */
export async function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
