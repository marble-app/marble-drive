// A session that knows whose it is.
//
// The gate's cookie carries an expiry and a signature and nothing else, because
// at G0 there is nothing else to carry — one owner, one secret. This is that
// cookie with the one field G2 needs added to it: the account id.
//
// What carries over from the gate, because it was right:
//
//   - the cookie is signed, not stored. No session table to grow, and a
//     restart does not sign anybody out.
//   - the signature is compared in constant time, over a hash of both sides so
//     a length mismatch leaks nothing.
//
// What is new is that `MARBLE_DRIVE_SECRET` stops being a password anyone types
// and becomes a signing key. On a multi-tenant host an unsigned session is
// every account at once, so the key is required there — `server/config.js` says
// so at boot.

import crypto from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;

const equal = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(Buffer.from(a ?? '', 'utf8')).digest(),
    crypto.createHash('sha256').update(Buffer.from(b ?? '', 'utf8')).digest(),
  );

const cookies = (header) =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf('=');
        return at < 0 ? [part, ''] : [part.slice(0, at), decodeURIComponent(part.slice(at + 1))];
      }),
  );

export function createSessions({ key, cookieName = 'marble_session', days = 30, secure = false }) {
  if (!key) throw new Error('a session needs a signing key');

  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

  /** `<userId>.<expires>.<signature>`. The id is base16 and the expiry is
   *  base10, so neither can hold the `.` that separates them. */
  function issue(userId) {
    if (!/^[a-z0-9]+$/i.test(userId ?? '')) throw new Error('a session needs a plain user id');
    const expires = Date.now() + days * DAY;
    const payload = `${userId}.${expires}`;
    return `${payload}.${sign(payload)}`;
  }

  /** The account id a token names, or null. A tampered payload fails the HMAC;
   *  a stale one fails the clock. */
  function read(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [userId, expiresRaw, signature] = parts;
    if (!/^[a-z0-9]+$/i.test(userId) || !/^\d+$/.test(expiresRaw)) return null;
    if (!equal(signature, sign(`${userId}.${expiresRaw}`))) return null;
    return Number(expiresRaw) > Date.now() ? userId : null;
  }

  /** Whose request is this? A cookie, or the same token as a bearer header for
   *  a script — not a second mechanism, the same one unwrapped. */
  function identify(req) {
    const jar = cookies(req.headers.cookie);
    const fromCookie = read(jar[cookieName]);
    if (fromCookie) return fromCookie;
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return bearer ? read(bearer) : null;
  }

  const cookieHeader = (userId) =>
    [
      `${cookieName}=${issue(userId)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor((days * DAY) / 1000)}`,
      secure ? 'Secure' : null,
    ]
      .filter(Boolean)
      .join('; ');

  const clearHeader = () =>
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

  return { issue, read, identify, cookieHeader, clearHeader, cookieName };
}

/** The host the browser asked for: X-Forwarded-Host from the edge or a
 *  proxy on this machine, else Host. A proxy that adds its own name after the
 *  edge's leaves the browser's first. A page can't set either header on a
 *  request to another site without a preflight this host never answers. */
export function askedHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
}

/**
 * The CSRF belt to `SameSite=Lax`'s suspenders. Lax already keeps the cookie
 * off a cross-site POST; this refuses a state-changing request whose `Origin`
 * is set and is not this host. A request with no `Origin` at all — curl, a
 * bearer-token script — is left alone, because it carried no ambient cookie to
 * abuse.
 *
 * Read routes do not call this. Every change passes `fromOwnPage`, below, in
 * front of every route; the agent routes, the Allow page and Publish ask this
 * again of their own.
 */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const asked = askedHost(req);
  return Boolean(asked) && host === asked;
}

/**
 * Did a change come from one of this drive's own pages? Until marbledrive.app
 * is on the Public Suffix List every drive under it is same-site with every
 * other, so Lax still sends ana's cookie with a post that a page on
 * bob.marbledrive.app makes to ana's drive. A browser says where a request
 * came from in `Origin` or, where it leaves that out, in `Sec-Fetch-Site`;
 * either has to name this drive. A request with a bearer is a script (a page
 * elsewhere can't add the header without that preflight), and one with
 * neither header is not a browser at all (curl, the backup job), so both go
 * on to be judged as before.
 *
 * server/app.js asks this of everything but GET, HEAD and OPTIONS, before any
 * route runs.
 */
export function fromOwnPage(req) {
  if (/^Bearer\s+\S/i.test(req.headers.authorization ?? '')) return true;
  if (req.headers.origin) return sameOrigin(req);
  const site = req.headers['sec-fetch-site'];
  return site ? site === 'same-origin' : true;
}
