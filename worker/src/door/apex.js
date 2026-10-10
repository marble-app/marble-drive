// worker/src/door/apex.js
// The door's pages and routes at marbledrive.app (docs/superpowers/specs/
// 2026-10-10-accounts-and-sign-in-design.md, "Signing up makes a drive" and
// "Where a session lives and how it reaches a drive").
//
//   /                      sign in, or on to where a signed-in person is going
//   /join/<code>           an invite
//   /auth/<p>/start        off to Google or GitHub
//   /auth/<p>/callback     back, signed in (or not invited)
//   /ask                   Ask for access
//   /name                  name your drive (GET the form, POST the claim)
//   /name/check?n=         free, taken, or what is wrong with it
//   /making/<name>[.json]  the steps while it is made
//   /enter?drive=&to=      a grant for the drive, if it is yours
//   /account               your drive and how you sign in
//   /signout[/everywhere]  end this session, or all of them
//   /privacy, /terms
//   /_door/*               the owner's API (tools/door.mjs, the door sprite),
//                          behind DOOR_ADMIN_TOKEN
//
// Every state-changing request must carry `Origin: https://marbledrive.app`
// exactly: until the domain is on the Public Suffix List every drive is
// same-site with the apex, so SameSite cookies alone would let a document on
// a drive post here.

import { directory } from './directory.js';
import { nameProblem } from './names.js';
import { APEX_ORIGIN, DoorError, cookie, finish, isProvider, providerReady, readCookie, start } from './oauth.js';
import * as pages from './pages.js';
import { returnPath } from './paths.js';
import { importSigningKey, importVerifyKey, publicFromPrivate, randomId, sameSecret, seal, sha256Hex, sign, unseal } from './tokens.js';

export const SESSION_COOKIE = '__Host-md_session';
const ASK_COOKIE = '__Host-md_ask';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const GRANT_SECONDS = 60;
export const APEX = 'marbledrive.app';

const redirect = (location, status = 303, headers = {}) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers } });

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const clear = (name) => `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;

const ipOf = (request) => request.headers.get('cf-connecting-ip') ?? 'unknown';

/** Is the door switched on? Only with its key and its Directory: without
 *  them marbledrive.app is the placeholder it always was. */
export const doorReady = (env) => Boolean(env?.DIRECTORY && env?.DOOR_SIGNING_KEY && env?.DOOR_KEY_ID);

const providersOf = (env) => ({ google: providerReady('google', env), github: providerReady('github', env) });

let signingKey = null; // per isolate: { pkcs8, key }
async function edgeKey(env) {
  if (!signingKey || signingKey.pkcs8 !== env.DOOR_SIGNING_KEY) {
    signingKey = { pkcs8: env.DOOR_SIGNING_KEY, key: await importSigningKey(env.DOOR_SIGNING_KEY) };
  }
  return signingKey.key;
}

export const PASS_COOKIE = '__Host-md_pass';
export const PASS_SECONDS = 12 * 60 * 60;

/** The keys a grant or a pass is checked with: DOOR_PUBLIC_KEYS, the same
 *  `<kid>:<base64 SPKI>` line every drive's MARBLE_DOOR_KEYS holds (older keys
 *  stay in it while a new one rolls out). The edge's own key is derived from
 *  its private half when the list does not name it. */
let verifying = null; // per isolate: { from, keys }
export async function edgeVerifyKeys(env) {
  const from = `${env.DOOR_KEY_ID}|${env.DOOR_SIGNING_KEY}|${env.DOOR_PUBLIC_KEYS ?? ''}`;
  if (verifying?.from === from) return verifying.keys;
  const keys = new Map();
  for (const entry of String(env.DOOR_PUBLIC_KEYS ?? '').trim().split(/\s+/).filter(Boolean)) {
    const at = entry.indexOf(':');
    if (at < 1) continue;
    try {
      keys.set(entry.slice(0, at), await importVerifyKey(entry.slice(at + 1)));
    } catch {
      console.log('door: an entry in DOOR_PUBLIC_KEYS is not an Ed25519 public key');
    }
  }
  if (!keys.has(env.DOOR_KEY_ID)) {
    try {
      keys.set(env.DOOR_KEY_ID, (await publicFromPrivate(env.DOOR_SIGNING_KEY)).key);
    } catch {
      console.log('door: could not derive the public key; put this key in DOOR_PUBLIC_KEYS');
    }
  }
  verifying = { from, keys };
  return keys;
}

/** A drive's pass: 12 hours, renewed at the edge while its session lives. */
export async function mintPass(env, { drive, account, session, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  return sign(await edgeKey(env), env.DOOR_KEY_ID, { typ: 'pass', drv: drive, acct: account, sid: session, role: 'owner', iat, exp: iat + PASS_SECONDS });
}

export const passCookie = (token) => cookie(PASS_COOKIE, token, PASS_SECONDS);
export const clearPass = () => clear(PASS_COOKIE);

/** A single-use ticket, 60 seconds, for one drive: the edge in front of the
 *  drive trades it for a pass. */
export async function mintGrant(env, { drive, account, session, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  return sign(await edgeKey(env), env.DOOR_KEY_ID, { typ: 'grant', drv: drive, acct: account, sid: session, role: 'owner', iat, exp: iat + GRANT_SECONDS, n: randomId(16) });
}

async function limited(dir, key, limit, windowSeconds) {
  const r = await dir('POST', '/count', { key, limit, windowSeconds });
  if (r.data?.ok !== false) return null;
  const wait = r.data.retryAfter ?? windowSeconds;
  const minutes = Math.ceil(wait / 60);
  const when = wait < 90 ? 'a minute' : minutes < 90 ? `${minutes} minutes` : `${Math.ceil(minutes / 60)} hours`;
  return pages.problem({ title: 'Too many tries', text: `Too many tries from here. Try again in ${when}.`, status: 429, headers: { 'retry-after': String(wait) } });
}

async function sessionOf(request, dir) {
  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return null;
  const hash = await sha256Hex(sid);
  const s = await dir('GET', `/session/${hash}`);
  if (!s.data?.live) return null;
  const a = await dir('GET', `/accounts/${s.data.account}`);
  if (!a.ok) return null;
  return { hash, account: a.data };
}

const sameOrigin = (request) => request.headers.get('origin') === APEX_ORIGIN;
const crossSite = () => pages.problem({ title: 'That didn’t come from Marble Drive', text: 'The request came from another site, so nothing was done. Go back and try again from marbledrive.app.', status: 403 });

/** Where a signed-in person goes next, from what their account holds. */
async function onward(session, dir) {
  const { account } = session;
  for (const name of account.drives ?? []) {
    const d = await dir('GET', `/drives/${name}`);
    if (d.ok && d.data.state !== 'ready' && d.data.state !== 'held') return redirect(`/making/${encodeURIComponent(name)}`);
  }
  if ((account.drives ?? []).length) return redirect('/account');
  if (account.mayMake) return redirect('/name');
  return pages.notInvited({ name: account.name, email: account.email });
}

/** Ask the door sprite to look at its queue. It is woken by this; a poke that
 *  fails is logged, and the next one finds the drive still queued. */
function poke(env, fetchImpl, ctx) {
  if (!env.DOOR_SPRITE_URL) return;
  const work = (async () => {
    try {
      const res = await fetchImpl(new URL('/poke', env.DOOR_SPRITE_URL).href, {
        method: 'POST',
        headers: { ...(env.SPRITES_TOKEN ? { authorization: `Bearer ${env.SPRITES_TOKEN}` } : {}), 'x-door-token': env.DOOR_ADMIN_TOKEN ?? '' },
      });
      if (!res.ok) console.log(`door: the door sprite answered the poke with ${res.status}`);
    } catch {
      console.log('door: the door sprite did not answer the poke');
    }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(work);
  return work;
}

// ---------------------------------------------------------------- admin

const ADMIN = [
  ['POST', /^\/invite$/],
  ['GET', /^\/invites$/],
  ['GET', /^\/requests$/],
  ['POST', /^\/approve$/],
  ['GET', /^\/drives$/],
  ['GET', /^\/queue$/],
  ['GET', /^\/log$/],
  ['POST', /^\/drives\/[a-z0-9-]{1,40}\/(step|hold)$/],
];

async function admin(request, env, path) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.DOOR_ADMIN_TOKEN || !(await sameSecret(bearer, env.DOOR_ADMIN_TOKEN))) return json(401, { why: 'unauthorised' });
  const inner = path.slice('/_door'.length);
  if (!ADMIN.some(([m, re]) => m === request.method && re.test(inner))) return json(404, { why: 'no such route' });
  const url = new URL(request.url);
  const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
  const res = await stub.fetch(new Request(`https://directory${inner}${url.search}`, {
    method: request.method,
    headers: { 'content-type': 'application/json' },
    body: request.method === 'POST' ? await request.text() : undefined,
  }));
  if (inner === '/invite' && res.ok) {
    const body = await res.json();
    return json(200, { link: `${APEX_ORIGIN}/join/${body.code}`, invite: body.invite });
  }
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// ---------------------------------------------------------------- routes

export async function apex(request, env, { fetchImpl = fetch, now = Date.now(), ctx = null } = {}) {
  const url = new URL(request.url);
  if (url.hostname === `www.${APEX}`) return redirect(`${APEX_ORIGIN}${url.pathname}${url.search}`, 301);
  const path = url.pathname;
  const method = request.method;
  const dir = directory(env);
  const ip = ipOf(request);

  try {
    if (path.startsWith('/_door/')) return await admin(request, env, path);
    if (path === '/privacy') return pages.privacy();
    if (path === '/terms') return pages.terms();
    if (path === '/favicon.ico') return new Response(null, { status: 404 });

    let m;
    if (path === '/') {
      const session = await sessionOf(request, dir);
      if (!session) return pages.signIn({ providers: providersOf(env) });
      return await onward(session, dir);
    }

    if ((m = /^\/join\/([^/]{1,100})$/.exec(path)) && method === 'GET') {
      const slow = await limited(dir, `join:${ip}`, 10, 3600);
      if (slow) return slow;
      const code = m[1];
      const peek = await dir('POST', '/invite/peek', { code });
      if (!peek.data.ok) return pages.join({ providers: providersOf(env), why: peek.data.why ?? 'unknown' });
      return pages.join({ providers: providersOf(env), invite: code, drive: peek.data.drive });
    }

    if ((m = /^\/auth\/([a-z]+)\/start$/.exec(path)) && method === 'GET' && isProvider(m[1])) {
      const slow = await limited(dir, `start:${ip}`, 20, 60);
      if (slow) return slow;
      const invite = url.searchParams.get('invite');
      const to = url.searchParams.get('to');
      return await start(m[1], {
        env,
        now,
        invite: invite && /^[0-9a-f]{16,64}$/.test(invite) ? invite : null,
        to: to ? returnPath(to) : null,
      });
    }

    if ((m = /^\/auth\/([a-z]+)\/callback$/.exec(path)) && method === 'GET' && isProvider(m[1])) {
      const who = await finish(m[1], request, { env, fetchImpl, now });
      const r = await dir('POST', '/identity', { provider: who.provider, subject: who.subject, email: who.email, name: who.name, invite: who.invite, ip });
      if (!r.ok) throw new DoorError('Signing in didn’t finish. Start again.', 502);
      if (r.data.state === 'held') {
        return pages.problem({ title: 'Your account is on hold', text: 'Ask Bryan what happened.', status: 403, action: null, headers: { 'set-cookie': clear('__Host-md_oauth') } });
      }
      const out = new Headers({ 'cache-control': 'no-store' });
      out.append('set-cookie', clear('__Host-md_oauth'));
      if (r.data.state !== 'active') {
        const asked = r.data.state === 'asked';
        const sealed = await seal(env.DOOR_SIGNING_KEY, 'ask', { provider: who.provider, subject: who.subject, email: who.email, name: who.name, asked }, { now, ttlSeconds: 1800 });
        out.append('set-cookie', cookie(ASK_COOKIE, sealed, 1800));
        out.set('location', '/ask');
        return new Response(null, { status: 303, headers: out });
      }
      const account = r.data.account;
      const opened = await dir('POST', '/session', { account: account.id, method: who.provider, device: (request.headers.get('user-agent') ?? '').slice(0, 120), ip });
      if (!opened.ok) throw new DoorError('Signing in didn’t finish. Start again.', 502);
      out.append('set-cookie', cookie(SESSION_COOKIE, opened.data.sid, SESSION_SECONDS));
      out.append('set-cookie', clear(ASK_COOKIE));
      // A claim invite hands its drive over as soon as its person is in.
      if (account.claim) await dir('POST', '/drive', { account: account.id });
      out.set('location', who.to ? returnPath(who.to) : '/');
      return new Response(null, { status: 303, headers: out });
    }

    if (path === '/ask') {
      const kept = await unseal(env.DOOR_SIGNING_KEY, 'ask', readCookie(request, ASK_COOKIE), { now });
      if (!kept) return redirect('/');
      if (method === 'GET') return pages.notInvited({ name: kept.name, email: kept.email, asked: kept.asked });
      if (method === 'POST') {
        if (!sameOrigin(request)) return crossSite();
        const slow = await limited(dir, `ask:${ip}`, 3, 86400);
        if (slow) return slow;
        await dir('POST', '/request', { provider: kept.provider, subject: kept.subject, email: kept.email, name: kept.name, ip });
        const res = pages.notInvited({ asked: true });
        res.headers.append('set-cookie', cookie(ASK_COOKIE, await seal(env.DOOR_SIGNING_KEY, 'ask', { ...kept, asked: true }, { now, ttlSeconds: 1800 }), 1800));
        return res;
      }
    }

    if (path === '/enter' && method === 'GET') {
      const drive = url.searchParams.get('drive') ?? '';
      const to = returnPath(url.searchParams.get('to') ?? '/');
      if (!/^[a-z0-9-]{1,40}$/.test(drive)) return pages.problem({ title: 'No drive named', text: 'That link doesn’t name a drive.', status: 400 });
      const session = await sessionOf(request, dir);
      if (!session) return pages.signIn({ providers: providersOf(env), to: `/enter?${new URLSearchParams({ drive, to })}`, drive });
      const d = await dir('GET', `/drives/${drive}`);
      if (!d.ok || d.data.owner !== session.account.id) return pages.notYours({ email: session.account.email });
      if (d.data.state === 'held') return pages.problem({ title: 'This drive is on hold', text: 'Ask Bryan what happened.', status: 403, action: null });
      if (d.data.state !== 'ready') return redirect(`/making/${encodeURIComponent(drive)}`);
      const grant = await mintGrant(env, { drive, account: session.account.id, session: session.hash, now });
      return redirect(`https://${drive}.${APEX}/_marble/enter?${new URLSearchParams({ grant, to })}`, 302);
    }

    // Everything below is for someone signed in.
    const session = await sessionOf(request, dir);
    const signedOut = () => redirect('/');

    if (path === '/account' && method === 'GET') {
      if (!session) return signedOut();
      const drives = [];
      for (const name of session.account.drives ?? []) {
        const d = await dir('GET', `/drives/${name}`);
        if (d.ok) drives.push(d.data);
      }
      return pages.account({ account: session.account, drives });
    }

    if (path === '/name/check' && method === 'GET') {
      if (!session) return json(401, { ok: false, said: 'Sign in first.' });
      const n = url.searchParams.get('n') ?? '';
      const why = nameProblem(n);
      if (why) return json(200, { ok: false, said: why });
      const d = await dir('GET', `/drives/${n}`);
      return json(200, d.ok ? { ok: false, said: `${n} is taken.` } : { ok: true, said: `${n} is free.` });
    }

    if (path === '/name') {
      if (!session) return signedOut();
      if (!session.account.mayMake) return await onward(session, dir);
      if (method === 'GET') return pages.nameDrive({});
      if (method === 'POST') {
        if (!sameOrigin(request)) return crossSite();
        let name = '';
        try {
          name = String((await request.formData()).get('name') ?? '').trim();
        } catch {
          name = '';
        }
        const r = await dir('POST', '/drive', { account: session.account.id, name });
        if (!r.ok) return pages.nameDrive({ value: name, said: r.data.why ?? 'That didn’t work. Try again.', ok: false, status: r.status });
        poke(env, fetchImpl, ctx);
        return redirect(`/making/${encodeURIComponent(r.data.drive.name)}`);
      }
    }

    if ((m = /^\/making\/([a-z0-9-]{1,40})(\.json)?$/.exec(path)) && method === 'GET') {
      if (!session) return m[2] ? json(401, { why: 'sign in' }) : signedOut();
      const d = await dir('GET', `/drives/${m[1]}`);
      if (!d.ok || d.data.owner !== session.account.id) return m[2] ? json(403, { why: 'not yours' }) : pages.notYours({ email: session.account.email });
      if (m[2]) return json(200, { state: d.data.state, steps: pages.stepStates(d.data), failed: d.data.failed ?? null });
      return pages.making({ drive: d.data });
    }

    if ((path === '/signout' || path === '/signout/everywhere') && method === 'POST') {
      if (!sameOrigin(request)) return crossSite();
      if (!session) return redirect('/', 303, { 'set-cookie': clear(SESSION_COOKIE) });
      if (path === '/signout/everywhere') await dir('DELETE', `/accounts/${session.account.id}/sessions`);
      else await dir('DELETE', `/session/${session.hash}`);
      // Then through each of the person's drives, to clear its pass there too.
      const names = session.account.drives ?? [];
      const location = names.length
        ? `https://${names[0]}.${APEX}/_marble/leave${names.length > 1 ? `?then=${encodeURIComponent(names.slice(1).join(','))}` : ''}`
        : '/';
      return redirect(location, 303, { 'set-cookie': clear(SESSION_COOKIE) });
    }
    if (path === '/signout' || path === '/signout/everywhere') return redirect(session ? '/account' : '/');

    return pages.problem({ title: 'Nothing here', text: 'There is no page at this address.', status: 404 });
  } catch (err) {
    if (err instanceof DoorError) return pages.problem({ title: 'Couldn’t sign you in', text: err.message, status: err.status });
    console.log(`door: ${path} failed: ${err?.name ?? 'Error'}`);
    return pages.problem({ title: 'Something went wrong', text: 'Marble Drive couldn’t finish that. Try again in a minute.', status: 500 });
  }
}
