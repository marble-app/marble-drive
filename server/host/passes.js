// The passes marble-host signs in direct mode (docs/HOSTING.md, "Direct
// mode"): the same `v1.<kid>.<payload>.<signature>` the door's edge hands a
// browser (worker/src/door/tokens.js), signed with HOST_SIGNING_KEY under the
// key id `h1`, which every guest's MARBLE_DOOR_KEYS lists. The key lives in
// host.env, in the owner's home, so no guest can make a pass.
//
// A sign-in link is https://<name>.<suffix>/enter#<pass>: the drive's /enter
// takes the pass from after the # and makes it its cookie (server/door.js).

import crypto from 'node:crypto';

import { HOST_KID } from './settings.js';

export const PASS_DAYS = 90;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** A pass for drive `name` and its owner `account`, good for `days`. */
export function signPass({ signingKey, name, account, days = PASS_DAYS, now = Date.now() }) {
  if (!signingKey) throw new Error('there is no HOST_SIGNING_KEY in host.env: run node tools/pc-host.mjs init');
  if (!Number.isFinite(days) || days <= 0 || days > 366) throw new Error('a pass lasts 1 to 366 days');
  const key = crypto.createPrivateKey({ key: Buffer.from(signingKey, 'base64'), format: 'der', type: 'pkcs8' });
  const iat = Math.floor(now / 1000);
  const payload = { typ: 'pass', drv: name, acct: account, role: 'owner', sid: crypto.randomBytes(16).toString('hex'), iat, exp: iat + Math.round(days * 86400) };
  const data = `v1.${HOST_KID}.${b64url(JSON.stringify(payload))}`;
  return { pass: `${data}.${b64url(crypto.sign(null, Buffer.from(data), key))}`, expires: new Date(payload.exp * 1000).toISOString() };
}

/** The link that signs a person in to their drive. */
export const signInLink = ({ name, suffix, pass }) => `https://${name}.${suffix}/enter#${pass}`;

/** A new HOST_SIGNING_KEY: Ed25519, PKCS#8 in base64. */
export const newSigningKey = () => crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
