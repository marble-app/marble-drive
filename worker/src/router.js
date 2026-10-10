// worker/src/router.js
// The front door (docs/HOSTING.md, "The front door (marbledrive.app)"):
// <name>.marbledrive.app reaches that drive wherever its lease says it lives.
// A drive at home on the Mac or the PC is reached through that machine's
// Cloudflare tunnel; one on Fly through its sprite URL. The request passes through whole (cookies,
// body, method) and the answer comes back untouched, so Set-Cookie survives
// and SSE streams. The drive's own gate does the signing in.
//
// Once the door is switched on (worker/src/door/apex.js), a drive that has an
// owner in the Directory is guarded here too: a request without that owner's
// pass is sent to sign in and never reaches, or wakes, the drive. Share links
// and a script's own bearer pass through for the drive to judge. A drive with
// no owner yet (bryan, until a claim invite hands it over) is routed exactly
// as before.

import { apex, clearPass, doorReady, edgeVerifyKeys, mintPass, passCookie, PASS_COOKIE } from './door/apex.js';
import { directory } from './door/directory.js';
import { readCookie } from './door/oauth.js';
import { esc } from './door/pages.js';
import { returnPath } from './door/paths.js';
import { verify } from './door/tokens.js';

export const APEX = 'marbledrive.app';
const RESERVED = new Set(['www', 'app', 'api', 'docs', 'status', 'admin', 'mail']);
const UNREACHABLE = new Set([530]); // a Cloudflare tunnel with no connector (error 1033)

export const isFrontDoor = (hostname) => hostname === APEX || hostname.endsWith(`.${APEX}`);

function page(status, title, text, headers = {}) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:18vh auto;padding:0 16px;color:#222;background:#fafafa}@media (prefers-color-scheme:dark){body{color:#ddd;background:#161616}}h1{font-size:1.25rem;font-weight:600}code{font-size:.9em}</style></head><body><h1>${title}</h1><p>${text}</p></body></html>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

const placeholder = () => page(200, 'Marble Drive', 'Coming soon.');
const nobody = () => page(404, 'No drive lives here', 'There is no Marble drive at this address.');
const lost = () => page(503, 'Can’t tell where this drive lives right now', 'Try again in a minute.', { 'retry-after': '30' });
const MACHINE_NAMES = { mac: 'Mac', pc: 'PC' };
const away = (home) =>
  MACHINE_NAMES[home]
    ? page(503, 'This drive is out of reach', `Your drive is at home on your ${MACHINE_NAMES[home]}, which isn’t reachable right now (asleep or offline). On the ${MACHINE_NAMES[home]}: <code>node tools/drive-home.mjs to fly</code> moves it to Fly. If the ${MACHINE_NAMES[home]} is off for good, from another machine: <code>node tools/drive-home.mjs rescue-to fly --from ${home}</code> brings it back from its last upload.`, { 'retry-after': '30' })
    : page(503, 'This drive is out of reach', 'Fly isn’t answering right now; try again in a minute.', { 'retry-after': '30' });

function drives(env) {
  const raw = env.DRIVES ?? {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Each public request would otherwise read the Durable Object, and the Free
// plan's request quota is shared with the lease API. So an isolate keeps what
// it read for a few seconds. A route that is stale for those seconds during a
// move reaches the side just left, which answers as a standby.
export const LEASE_TTL_MS = 5000;
const leases = new Map(); // name -> { lease, at }
export const forgetLeases = () => {
  leases.clear();
  records.clear();
};

async function readLease(env, name, now) {
  const kept = leases.get(name);
  if (kept && now - kept.at >= 0 && now - kept.at < LEASE_TTL_MS) return kept.lease;
  const res = await env.LEASE.get(env.LEASE.idFromName(name)).fetch(new Request(`https://lease/lease/${name}`));
  if (!res.ok) throw new Error(`lease read: ${res.status}`);
  const lease = await res.json();
  leases.set(name, { lease, at: now });
  return lease;
}

// What the Directory says of a drive, kept per isolate for a few seconds like
// the lease. Only a settled answer is kept (no drive, or one that is ready or
// held), so a drive that has just been made is seen at once.
export const DRIVE_TTL_MS = 30_000;
const records = new Map(); // name -> { record, at }
export const forgetDrives = () => records.clear();

async function readDrive(env, name, now) {
  const kept = records.get(name);
  if (kept && now - kept.at >= 0 && now - kept.at < DRIVE_TTL_MS) return kept.record;
  const r = await directory(env)('GET', `/drives/${name}`);
  if (r.status !== 200 && r.status !== 404) throw new Error(`directory read: ${r.status}`);
  const record = r.status === 200 ? r.data : null;
  if (!record || record.state === 'ready' || record.state === 'held') records.set(name, { record, at: now });
  return record;
}

const enterUrl = (name, url) => `https://${APEX}/enter?${new URLSearchParams({ drive: name, to: returnPath(url.pathname + url.search) })}`;
const wantsHtml = (request) => (request.headers.get('accept') ?? '').includes('text/html');
const SHARE_LINK = /^\/s\/[A-Za-z0-9_-]+$/;
const carriesShare = (request) => /(?:^|;\s*)marble_share=/.test(request.headers.get('cookie') ?? '');

/** Send someone without a pass to sign in: a page to the door, anything else a 401. */
function signInFirst(request, name, url, extra = {}) {
  if (wantsHtml(request) && (request.method === 'GET' || request.method === 'HEAD')) {
    return new Response(null, { status: 302, headers: { location: enterUrl(name, url), 'cache-control': 'no-store', ...extra } });
  }
  return new Response(JSON.stringify({ error: 'sign in first', at: enterUrl(name, url) }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}

/** The edge in front of a drive with an owner. `{ response }` when the edge
 *  answers itself; else on to the drive, with `{ renew }` to set on the way. */
async function guard(request, env, { name, record, url, now }) {
  const keys = await edgeVerifyKeys(env);

  // A grant from the door, traded for this drive's pass. Single use: its
  // nonce is spent in the Directory, so a grant replayed in its 60 s is refused.
  if (url.pathname === '/_marble/enter') {
    const to = returnPath(url.searchParams.get('to') ?? '/');
    const grant = await verify(keys, url.searchParams.get('grant'), { now, typ: 'grant', drv: name });
    const fresh = grant && grant.acct === record.owner ? (await directory(env)('POST', `/nonce/${grant.n}`)).data?.fresh === true : false;
    if (!fresh) {
      return {
        response: page(400, 'That sign-in link has been used', `It works once, for a minute. <a href="${esc(enterUrl(name, new URL(to, url)))}">Open your drive again</a>.`, { 'referrer-policy': 'no-referrer' }),
      };
    }
    const pass = await mintPass(env, { drive: name, account: grant.acct, session: grant.sid, now });
    return { response: new Response(null, { status: 302, headers: { location: to, 'set-cookie': passCookie(pass), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } }) };
  }

  // Signing out walks each of the person's drives to clear its pass, then home.
  if (url.pathname === '/_marble/leave') {
    const rest = (url.searchParams.get('then') ?? '').split(',').filter((n) => /^[a-z0-9-]{1,40}$/.test(n));
    const next = rest.length ? `https://${rest[0]}.${APEX}/_marble/leave${rest.length > 1 ? `?then=${encodeURIComponent(rest.slice(1).join(','))}` : ''}` : `https://${APEX}/`;
    return { response: new Response(null, { status: 303, headers: { location: next, 'set-cookie': clearPass(), 'cache-control': 'no-store' } }) };
  }

  if (record.state === 'held') return { response: page(403, 'This drive is on hold', 'Its owner can ask Bryan why.') };

  const pass = await verify(keys, readCookie(request, PASS_COOKIE), { now, typ: 'pass', drv: name });
  if (pass && pass.acct === record.owner) {
    // Over an hour old: is its session still live? Then a fresh pass rides
    // the answer; if not, the pass is cleared and its holder signs in again.
    if (now / 1000 - pass.iat > 3600) {
      const s = /^[0-9a-f]{64}$/.test(pass.sid ?? '') ? await directory(env)('GET', `/session/${pass.sid}`) : { data: {} };
      if (!s.data?.live || s.data.account !== pass.acct) return { response: signInFirst(request, name, url, { 'set-cookie': clearPass() }) };
      return { renew: passCookie(await mintPass(env, { drive: name, account: pass.acct, session: pass.sid, now })) };
    }
    return {};
  }
  // Share links are the drive's, not the account's: the drive judges them.
  if ((SHARE_LINK.test(url.pathname) && request.method === 'GET') || carriesShare(request)) return {};
  // A script with the drive's passphrase as a bearer: the drive judges that too.
  if (request.headers.get('authorization')) return {};
  return { response: signInFirst(request, name, url) };
}

const making = () => page(503, 'This drive is still being made', 'Try again in a few minutes.', { 'retry-after': '60' });

export async function route(request, env, { fetchImpl = fetch, now = Date.now(), ctx = null } = {}) {
  const url = new URL(request.url);
  const host = url.hostname;
  // The apex is the door once it is switched on (worker/src/door/apex.js),
  // and the placeholder until then.
  if (host === APEX || host === `www.${APEX}`) return doorReady(env) ? apex(request, env, { fetchImpl, now, ctx }) : placeholder();

  const name = host.slice(0, -(APEX.length + 1));
  // A machine's own tunnel (pc-bryan, mac-bryan) is never this Worker's to
  // answer. Its routes should keep it off the Worker altogether; if the
  // wildcard route ever catches one, the request goes on to the tunnel as it
  // came, since a Worker's request to its own zone goes to the origin.
  if (/^(mac|pc)-[a-z0-9-]+$/.test(name)) return fetchImpl(request);
  const table = drives(env);
  if (!name || name.includes('.') || RESERVED.has(name)) return nobody();
  const inTable = Object.hasOwn(table, name);

  let record = null;
  if (doorReady(env)) {
    try {
      record = await readDrive(env, name, now);
    } catch {
      // A drive in DRIVES is still routed by its lease, and its own host still
      // checks who is asking; any other drive cannot be found without this.
      if (!inTable) return lost();
    }
  }
  if (record?.state === 'removed') record = null;
  if (!inTable && !record) return nobody();

  let renew = null;
  if (record?.owner) {
    const said = await guard(request, env, { name, record, url, now });
    if (said.response) return said.response;
    renew = said.renew ?? null;
  }

  let home;
  let origin;
  if (inTable) {
    let lease;
    try {
      lease = await readLease(env, name, now);
    } catch {
      return lost();
    }
    home = lease?.home;
    origin = (home === 'fly' || Object.hasOwn(MACHINE_NAMES, home)) && Object.hasOwn(table[name], home) && table[name][home];
    if (!origin) return lost();
  } else {
    if (record.state !== 'ready') return making();
    home = 'fly';
    origin = record.homes?.fly;
    if (!origin) return lost();
  }

  // Never resolve the path against the origin: `//evil.example/x` would then
  // name another host, taking the cookie and the Sprites token with it.
  const base = new URL(origin);
  const target = new URL(base.origin + url.pathname + url.search);
  if (target.origin !== base.origin) return nobody();
  // A guarded drive is always proxied: a redirect to the sprite would leave
  // its pass behind on this name.
  if (home === 'fly' && !env.SPRITES_TOKEN && !record?.owner) {
    // The sprite URL is private to the Fly org; the owner signs in there.
    return new Response(null, { status: 302, headers: { location: target.href, 'cache-control': 'no-store' } });
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', host);
  headers.set('x-forwarded-proto', 'https');
  if (home === 'fly' && env.SPRITES_TOKEN && !headers.has('authorization')) headers.set('authorization', `Bearer ${env.SPRITES_TOKEN}`);

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body;
    init.duplex = 'half';
  }

  let res;
  try {
    res = await fetchImpl(target, init);
  } catch {
    return away(home);
  }
  if (UNREACHABLE.has(res.status)) return away(home);
  if (!renew) return res;
  const renewed = new Response(res.body, res);
  renewed.headers.append('set-cookie', renew);
  return renewed;
}
