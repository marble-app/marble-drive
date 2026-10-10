// worker/src/router.js
// The front door (docs/HOSTING.md, "The front door (marbledrive.app)"):
// <name>.marbledrive.app reaches that drive wherever its lease says it lives.
// A drive at home on the Mac or the PC is reached through that machine's
// Cloudflare tunnel; one on Fly through its sprite URL. The request passes through whole (cookies,
// body, method) and the answer comes back untouched, so Set-Cookie survives
// and SSE streams. The drive's own gate does the signing in.

import { apex, doorReady } from './door/apex.js';

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
export const forgetLeases = () => leases.clear();

async function readLease(env, name, now) {
  const kept = leases.get(name);
  if (kept && now - kept.at >= 0 && now - kept.at < LEASE_TTL_MS) return kept.lease;
  const res = await env.LEASE.get(env.LEASE.idFromName(name)).fetch(new Request(`https://lease/lease/${name}`));
  if (!res.ok) throw new Error(`lease read: ${res.status}`);
  const lease = await res.json();
  leases.set(name, { lease, at: now });
  return lease;
}

export async function route(request, env, { fetchImpl = fetch, now = Date.now(), ctx = null } = {}) {
  const url = new URL(request.url);
  const host = url.hostname;
  // The apex is the door once it is switched on (worker/src/door/apex.js),
  // and the placeholder until then.
  if (host === APEX || host === `www.${APEX}`) return doorReady(env) ? apex(request, env, { fetchImpl, now, ctx }) : placeholder();

  const name = host.slice(0, -(APEX.length + 1));
  const table = drives(env);
  if (!name || name.includes('.') || RESERVED.has(name) || !Object.hasOwn(table, name)) return nobody();

  let lease;
  try {
    lease = await readLease(env, name, now);
  } catch {
    return lost();
  }
  const home = lease?.home;
  const origin = (home === 'fly' || Object.hasOwn(MACHINE_NAMES, home)) && Object.hasOwn(table[name], home) && table[name][home];
  if (!origin) return lost();

  // Never resolve the path against the origin: `//evil.example/x` would then
  // name another host, taking the cookie and the Sprites token with it.
  const base = new URL(origin);
  const target = new URL(base.origin + url.pathname + url.search);
  if (target.origin !== base.origin) return nobody();
  if (home === 'fly' && !env.SPRITES_TOKEN) {
    // The sprite URL is private to the Fly org; the owner signs in there.
    return new Response(null, { status: 302, headers: { location: target.href, 'cache-control': 'no-store' } });
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', host);
  headers.set('x-forwarded-proto', 'https');
  if (home === 'fly' && !headers.has('authorization')) headers.set('authorization', `Bearer ${env.SPRITES_TOKEN}`);

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
  return res;
}
