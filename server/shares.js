// Share links: one page, handed to someone who cannot open the drive.
//
// The gate (server/gate.js) is all or nothing: the passphrase opens every
// page, every agent and the shell. A share link is the other kind of key. It
// names one document and one level (server/share-policy.js), it is good until
// its owner turns it off, and it opens nothing else — not the tree, not the
// agents, not another page, not the history.
//
// A link is a capability: `/s/<token>`, where the token is a random id and a
// MAC of it under a key that never leaves `.marble/`. Nothing secret is
// written next to the id, so the list can be read without handing out links,
// and the owner can copy a link again without the host keeping it. Turning a
// link off removes its id; the MAC alone opens nothing.
//
// Opening a link trades the token for a cookie (`marble_share`, HttpOnly,
// SameSite=Lax) that holds the tokens this browser was given, and the page is
// then an ordinary `/a/<path>`. The carrier's own requests carry the cookie,
// so `/ops`, `/events` and `/presence` need no token in their URLs and the
// address bar never shows one after the first hop.
//
// `.marble/shares.json` holds `{ id, path, role, made, opened }`, rewritten
// whole (it is short), and follows a document when it moves. `opened` is the
// last time someone without the passphrase came in by the link, so the owner
// can tell a link nobody uses from one that is out there working.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ROLES } from './share-policy.js';

const DAY = 24 * 60 * 60 * 1000;
/** A link opened again inside this long is not news worth a write. */
const OPENED_EVERY = 60 * 1000;
const ID_BYTES = 12; // 16 base64url characters
const MAC_CHARS = 22; // 128 bits of HMAC-SHA256
const TOKEN = /^[A-Za-z0-9_-]{38}$/;
/** How many links one browser keeps. A cookie is 4 KB; a token is 38 bytes. */
const KEPT = 24;

export const RANK = { view: 1, edit: 2, modify: 3 };

export function createShares({ dir, cookieName = 'marble_share', days = 30, secureFor = () => false }) {
  const file = path.join(dir, 'shares.json');
  const keyFile = path.join(dir, 'shares.key');
  let list = null;
  let key = null;
  // Open event streams per link, so turning one off is felt at once rather
  // than on the next reload: the page stops hearing the document change.
  const open = new Map();

  // Read once, by whoever asks first. Two first requests that each read the
  // file would each hold their own list, and the second to write would drop
  // the link the first one made.
  let loading = null;
  async function load() {
    if (list) return list;
    loading ??= (async () => {
      try {
        const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
        list = Array.isArray(raw)
          ? raw.filter((s) => s && typeof s.id === 'string' && typeof s.path === 'string' && ROLES.includes(s.role))
          : [];
      } catch {
        list = [];
      }
      return list;
    })();
    return loading;
  }

  // One write at a time: two at once would share the temp file, and the
  // second rename would find it gone.
  let saving = Promise.resolve();
  async function write() {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`);
    await fsp.rename(tmp, file);
  }
  function save() {
    const run = saving.then(write, write);
    saving = run.catch(() => {});
    return run;
  }

  async function secret() {
    if (key) return key;
    try {
      key = Buffer.from((await fsp.readFile(keyFile, 'utf8')).trim(), 'hex');
      if (key.length === 32) return key;
    } catch {
      // First link on this drive: make the key.
    }
    await fsp.mkdir(dir, { recursive: true });
    const made = crypto.randomBytes(32);
    try {
      // `wx`: two first links at once must agree on one key.
      await fsp.writeFile(keyFile, `${made.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
      key = made;
    } catch {
      key = Buffer.from((await fsp.readFile(keyFile, 'utf8')).trim(), 'hex');
    }
    return key;
  }

  const macOf = async (id) =>
    crypto.createHmac('sha256', await secret()).update(`share:${id}`).digest('base64url').slice(0, MAC_CHARS);

  const tokenOf = async (id) => `${id}${await macOf(id)}`;

  const shape = async (share) => ({
    id: share.id,
    path: share.path,
    role: share.role,
    made: share.made,
    opened: share.opened ?? null,
    href: `/s/${await tokenOf(share.id)}`,
  });

  /** The link a token names, if it is still on. Constant-time on the MAC. */
  async function resolve(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const id = token.slice(0, 16);
    const given = Buffer.from(token.slice(16));
    const wanted = Buffer.from(await macOf(id));
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
    return (await load()).find((s) => s.id === id) ?? null;
  }

  /** The links that are on for one document, newest last. */
  async function forPath(docPath) {
    return Promise.all((await load()).filter((s) => s.path === docPath).map(shape));
  }

  /** The document's link at this level: the one that is on, or a new one. */
  async function make(docPath, role) {
    if (!ROLES.includes(role)) throw Object.assign(new Error('that is not a level a link can have'), { status: 400 });
    const shares = await load();
    const have = shares.find((s) => s.path === docPath && s.role === role);
    if (have) return shape(have);
    const share = { id: crypto.randomBytes(ID_BYTES).toString('base64url'), path: docPath, role, made: new Date().toISOString() };
    shares.push(share);
    await save();
    return shape(share);
  }

  /** Turn a link off: it opens nothing from now on, and pages it opened stop
   *  hearing the document. */
  async function off(id) {
    const shares = await load();
    const at = shares.findIndex((s) => s.id === id);
    if (at < 0) return false;
    shares.splice(at, 1);
    await save();
    for (const res of open.get(id) ?? []) res.end();
    open.delete(id);
    return true;
  }

  /** Someone came in by this link. At most one write a minute per link. */
  async function opened(id) {
    const share = (await load()).find((s) => s.id === id);
    if (!share) return;
    const now = Date.now();
    if (share.opened && now - Date.parse(share.opened) < OPENED_EVERY) return;
    share.opened = new Date(now).toISOString();
    await save();
  }

  /** A document moved (`at` maps an old path to its new one, or null), so its
   *  links go with it. The same mapper server/app.js hands the agents. */
  async function moved(at) {
    const shares = await load();
    let changed = false;
    for (const share of shares) {
      const next = at(share.path);
      if (next && next !== share.path) {
        share.path = next;
        changed = true;
      }
    }
    if (changed) await save();
  }

  // ------------------------------------------------------------- the visitor

  const tokensIn = (req) => {
    for (const part of String(req.headers?.cookie ?? '').split(';')) {
      const at = part.indexOf('=');
      if (at < 0 || part.slice(0, at).trim() !== cookieName) continue;
      return decodeURIComponent(part.slice(at + 1).trim()).split('.').filter((t) => TOKEN.test(t));
    }
    return [];
  };

  /** What this browser's links open: path → the highest level among them. */
  async function visitor(req) {
    const grants = new Map();
    for (const token of tokensIn(req)) {
      const share = await resolve(token);
      if (!share) continue;
      const had = grants.get(share.path);
      if (!had || RANK[share.role] > RANK[had.role]) grants.set(share.path, { id: share.id, role: share.role });
    }
    return grants.size ? grants : null;
  }

  /** The cookie after this browser is handed one more link: newest first, the
   *  ones that no longer open anything dropped. */
  async function cookieWith(req, token) {
    const kept = [token];
    for (const t of tokensIn(req)) {
      if (t !== token && kept.length < KEPT && (await resolve(t))) kept.push(t);
    }
    return [
      `${cookieName}=${kept.join('.')}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor((days * DAY) / 1000)}`,
      secureFor(req) ? 'Secure' : null,
    ].filter(Boolean).join('; ');
  }

  /** Keep a visitor's event stream, to end it if its link is turned off. */
  function track(id, res) {
    if (!open.has(id)) open.set(id, new Set());
    open.get(id).add(res);
    res.on('close', () => open.get(id)?.delete(res));
  }

  /** Did this browser come by a link at all, on or off? */
  const carries = (req) => tokensIn(req).length > 0;

  return { resolve, forPath, make, off, opened, moved, visitor, carries, cookieWith, track, cookieName };
}
