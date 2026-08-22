// One gate, not an account system.
//
// The requirement at G0 is "not the open internet". It is not identity, and
// building identity now would be building it before knowing what sharing needs
// of it — the vision is explicit that this gets thrown away at G2, and that
// throwing it away is cheaper than guessing.
//
// So: one shared secret, and a cookie signed with it. Two things are worth
// getting right even in something disposable, because both are the kind of
// mistake that survives a rewrite:
//
//   - the comparison is constant-time, so the secret cannot be guessed a
//     character at a time by timing the answer;
//   - the cookie is signed rather than stored, so a restart does not sign
//     everybody out and there is no session table to grow.

import crypto from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;

const equal = (a, b) => {
  const left = Buffer.from(a ?? '', 'utf8');
  const right = Buffer.from(b ?? '', 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak. Hash
  // both sides first so the comparison is always over 32 equal bytes.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(left).digest(),
    crypto.createHash('sha256').update(right).digest(),
  );
};

export function createGate({ secret, cookieName = 'marble_drive', days = 30, secure = false }) {
  const open = !secret;

  const sign = (payload) =>
    crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  function issue() {
    const expires = Date.now() + days * DAY;
    const payload = String(expires);
    return `${payload}.${sign(payload)}`;
  }

  function valid(token) {
    if (typeof token !== 'string') return false;
    const at = token.lastIndexOf('.');
    if (at < 1) return false;
    const payload = token.slice(0, at);
    const signature = token.slice(at + 1);
    if (!equal(signature, sign(payload))) return false;
    const expires = Number(payload);
    return Number.isFinite(expires) && expires > Date.now();
  }

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

  /** Is this request allowed through? An open host says yes to everything, and
   *  says so at boot rather than quietly. */
  function allows(req) {
    if (open) return true;
    const jar = cookies(req.headers.cookie);
    if (valid(jar[cookieName])) return true;
    // A bearer token is the same secret by another name, for a script, a
    // backup job, or curl. Not a second mechanism — the same one, unwrapped.
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return Boolean(bearer) && equal(bearer, secret);
  }

  /** The secret, offered once, exchanged for a cookie. */
  const accepts = (offered) => open || (Boolean(offered) && equal(offered, secret));

  const cookieHeader = () =>
    [
      `${cookieName}=${issue()}`,
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

  return { open, allows, accepts, issue, valid, cookieHeader, clearHeader, cookieName };
}
