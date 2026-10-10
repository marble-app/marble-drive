// The drive's side of the door (docs/superpowers/specs/
// 2026-10-10-accounts-and-sign-in-design.md).
//
// People sign in at marbledrive.app, and the edge hands their browser a pass
// for this drive: `__Host-md_pass`, signed with Ed25519. The edge checks it
// first, so strangers never wake the drive; this checks it again, because the
// sprite URL and the PC's tunnel can be reached without the edge. It holds
// public keys only, so nothing on this machine, its agent included, can make
// a pass for this drive or any other.
//
// With no MARBLE_DOOR_* settings it is not configured, allows nobody, and the
// gate decides everything exactly as before.

import crypto from 'node:crypto';

import { returnPath } from './gate.js';

export const DOOR_ORIGIN = 'https://marbledrive.app';
const PASS_COOKIE = '__Host-md_pass';

/** `k1:<base64 SPKI> k2:<base64 SPKI>` as a Map of kid to KeyObject. Spaces,
 *  never commas, because a sprite.env value may not hold one. A malformed entry
 *  is a boot error that names the setting and never repeats its value. */
export function parseDoorKeys(text) {
  const keys = new Map();
  if (!text || !String(text).trim()) return keys;
  const bad = (why) => new Error(`MARBLE_DOOR_KEYS: ${why}`);
  if (String(text).includes(',')) throw bad('separate keys with spaces, not commas');
  for (const entry of String(text).trim().split(/\s+/)) {
    const at = entry.indexOf(':');
    if (at < 1) throw bad('each entry is <key id>:<base64 public key>');
    const kid = entry.slice(0, at);
    const body = entry.slice(at + 1);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw bad('a key id is letters, digits, - and _');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw bad(`key ${kid} is not base64`);
    let key;
    try {
      key = crypto.createPublicKey({ key: Buffer.from(body, 'base64'), format: 'der', type: 'spki' });
    } catch {
      throw bad(`key ${kid} is not a public key`);
    }
    if (key.asymmetricKeyType !== 'ed25519') throw bad(`key ${kid} is not an Ed25519 key`);
    keys.set(kid, key);
  }
  return keys;
}

function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

export function createDoor({ keys = new Map(), name = null, owner = null, cookieName = PASS_COOKIE, now = () => Date.now(), origin = DOOR_ORIGIN } = {}) {
  const configured = Boolean(keys?.size && name && owner);

  /** The pass's payload, when it is a pass for this drive and its owner. */
  function read(req) {
    if (!configured) return null;
    const token = cookieValue(req?.headers?.cookie, cookieName);
    if (!token || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const [, kid, body, sig] = parts;
    const key = keys.get(kid);
    if (!key) return null;
    try {
      const ok = crypto.verify(null, Buffer.from(`v1.${kid}.${body}`), key, Buffer.from(sig, 'base64url'));
      if (!ok) return null;
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload?.typ !== 'pass' || payload.drv !== name || payload.acct !== owner) return null;
      if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  const allows = (req) => Boolean(read(req));

  function who(req) {
    const payload = read(req);
    return payload ? { account: payload.acct, role: payload.role, session: payload.sid } : null;
  }

  /** Where a browser without a pass is sent: the door, with a path on this
   *  drive to come back to. */
  function enterUrl(req) {
    const url = new URL('/enter', origin);
    url.searchParams.set('drive', name ?? '');
    url.searchParams.set('to', returnPath(req?.url ?? '/'));
    return url.href;
  }

  return { configured, allows, who, enterUrl, cookieName, name };
}
