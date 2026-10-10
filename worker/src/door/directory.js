// worker/src/door/directory.js
// The Directory: people, their sign-in methods, invites, drives, sessions and
// the audit log, in one Durable Object (docs/superpowers/specs/
// 2026-10-10-accounts-and-sign-in-design.md, "The account model").
//
// One object for the whole service, so a drive name or the last use of an
// invite is decided in one place. Every change runs under one lock, in order,
// so two tabs racing for the same thing get one yes and one no. Secrets are
// kept as SHA-256 hashes: invite codes and session ids are long and random,
// so a slow hash would add nothing. Nothing secret goes into an audit line.
//
// JSON over fetch, like the Lease. The Worker is its only caller; the admin
// routes are reached from outside only through apex.js, behind a token.

import { nameProblem } from './names.js';
import { randomId, sha256Hex } from './tokens.js';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_DAYS = 30;
const NONCE_MS = 2 * 60 * 1000;
const AUDIT_DAYS = 180;
export const DEFAULT_MAX_DRIVES = 10;
export const STEPS = ['machine', 'install', 'check'];

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

class Refusal extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const refuse = (status, message, extra) => {
  throw new Refusal(status, message, extra);
};

const str = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');

export class DirectoryCore {
  constructor(storage, { now = () => Date.now(), maxDrives = DEFAULT_MAX_DRIVES } = {}) {
    this.storage = storage;
    this.now = now;
    this.maxDrives = maxDrives;
    this.queue = Promise.resolve();
  }

  /** One change at a time, in the order they came. */
  exclusive(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  iso() {
    return new Date(this.now()).toISOString();
  }

  async audit(kind, { account = null, ip = null, detail = null } = {}) {
    const at = this.iso();
    await this.storage.put(`audit:${at}:${randomId(4)}`, { at, kind, account, ip: ip ? str(ip, 64) : null, detail });
  }

  // ------------------------------------------------------------- invites

  /** The invite a code names: `{ ok, hash, invite }`, or `{ ok: false, why }`
   *  with why one of unknown, spent, expired. */
  async inviteFor(code) {
    if (typeof code !== 'string' || !/^[0-9a-f]{16,64}$/.test(code)) return { ok: false, why: 'unknown' };
    return this.inviteByHash(await sha256Hex(code));
  }

  async inviteByHash(hash) {
    const invite = hash ? await this.storage.get(`invite:${hash}`) : null;
    if (!invite) return { ok: false, why: 'unknown' };
    if (invite.off || invite.uses <= 0) return { ok: false, why: 'spent', hash, invite };
    if (Date.parse(invite.expires) <= this.now()) return { ok: false, why: 'expired', hash, invite };
    if (invite.owner && (await this.storage.get('meta:owner'))) return { ok: false, why: 'spent', hash, invite };
    return { ok: true, hash, invite };
  }

  async makeInvite({ note = '', uses = 1, days = 14, drive = null, sprite = null, owner = false } = {}) {
    return this.exclusive(async () => {
      if (owner && (await this.storage.get('meta:owner'))) refuse(409, 'There is already an owner.');
      if (drive) {
        const why = nameProblem(drive, { claiming: true });
        if (why) refuse(400, why);
      }
      const n = Math.floor(Number(uses));
      const d = Number(days);
      if (!(n >= 1 && n <= 100)) refuse(400, 'Uses is a whole number from 1 to 100.');
      if (!(d > 0 && d <= 365)) refuse(400, 'Days is a number from 1 to 365.');
      const code = randomId(16);
      const hash = await sha256Hex(code);
      const invite = {
        id: hash.slice(0, 8),
        note: str(note),
        uses: owner ? 1 : n,
        made: this.iso(),
        expires: new Date(this.now() + d * DAY).toISOString(),
        drive: drive || null,
        sprite: sprite ? str(sprite, 64) : null,
        owner: Boolean(owner),
      };
      await this.storage.put(`invite:${hash}`, invite);
      await this.audit('invite-made', { detail: { invite: invite.id, uses: invite.uses, drive: invite.drive, owner: invite.owner } });
      return { code, invite };
    });
  }

  async listInvites() {
    const all = await this.storage.list({ prefix: 'invite:' });
    return [...all.values()].sort((a, b) => a.made.localeCompare(b.made));
  }

  // ------------------------------------------------------------- people

  view(acct) {
    if (!acct) return null;
    return {
      id: acct.id,
      name: acct.name,
      email: acct.email,
      role: acct.role,
      state: acct.state,
      drives: acct.drives ?? [],
      methods: (acct.methods ?? []).map((m) => ({ provider: m.provider, email: m.email })),
      created: acct.created,
    };
  }

  /** What this account may do next, for the apex to route on. */
  async standing(acct) {
    const held = acct.held ? await this.inviteByHash(acct.held) : null;
    const claim = held?.ok && held.invite.drive ? held.invite.drive : null;
    const mayMake =
      acct.state === 'active' &&
      (acct.role === 'owner' || (acct.drives ?? []).length === 0) &&
      Boolean(acct.role === 'owner' || acct.approved || (held?.ok && !held.invite.drive));
    return { claim, mayMake };
  }

  async accountView(id) {
    const acct = id ? await this.storage.get(`acct:${id}`) : null;
    if (!acct) return null;
    return { ...this.view(acct), ...(await this.standing(acct)) };
  }

  async identity({ provider, subject, email, name, invite, ip }) {
    if (!['google', 'github'].includes(provider) || typeof subject !== 'string' || !subject) refuse(400, 'provider and subject are required');
    return this.exclusive(async () => {
      const identKey = `ident:${provider}:${subject}`;
      const known = await this.storage.get(identKey);
      if (known) {
        const acct = await this.storage.get(`acct:${known}`);
        if (!acct) refuse(500, 'that sign-in names an account that is gone');
        acct.seen = this.iso();
        // A signed-in person who opens another invite keeps it for their next
        // step: a claim invite for a drive, or a first drive.
        if (invite && !acct.held) {
          const inv = await this.inviteFor(invite);
          const hasRoom = acct.role === 'owner' || (acct.drives ?? []).length === 0;
          if (inv.ok && !inv.invite.owner && (inv.invite.drive || hasRoom)) acct.held = inv.hash;
        }
        await this.storage.put(`acct:${acct.id}`, acct);
        await this.audit('signed-in', { account: acct.id, ip, detail: { provider } });
        return { state: acct.state === 'held' ? 'held' : 'active', account: { ...this.view(acct), ...(await this.standing(acct)) } };
      }

      const inv = invite ? await this.inviteFor(invite) : { ok: false, why: null };
      const reqId = await this.storage.get(`reqident:${provider}:${subject}`);
      const request = reqId ? await this.storage.get(`request:${reqId}`) : null;
      if (!inv.ok && request?.state !== 'approved') {
        return { state: request ? 'asked' : 'new-needs-invite', why: inv.why ?? null };
      }

      const id = randomId(8);
      const owner = Boolean(inv.ok && inv.invite.owner);
      const acct = {
        id,
        name: str(name) || str(email) || 'Someone',
        email: str(email),
        role: owner ? 'owner' : 'member',
        state: 'active',
        created: this.iso(),
        seen: this.iso(),
        drives: [],
        methods: [{ provider, subject, email: str(email), added: this.iso() }],
        held: inv.ok && !owner ? inv.hash : null,
        approved: !inv.ok && request?.state === 'approved',
      };
      await this.storage.put(`acct:${id}`, acct);
      await this.storage.put(identKey, id);
      if (owner) {
        // The bootstrap invite is spent by making the owner: it makes no drive.
        await this.storage.put('meta:owner', id);
        await this.storage.put(`invite:${inv.hash}`, { ...inv.invite, uses: 0 });
      }
      if (request && !inv.ok) await this.storage.put(`request:${request.id}`, { ...request, state: 'used', account: id });
      await this.audit('account-made', { account: id, ip, detail: { provider, role: acct.role, invite: inv.ok ? inv.invite.id : null } });
      return { state: 'active', account: { ...this.view(acct), ...(await this.standing(acct)) } };
    });
  }

  async request({ provider, subject, email, name, ip }) {
    if (!['google', 'github'].includes(provider) || typeof subject !== 'string' || !subject) refuse(400, 'provider and subject are required');
    return this.exclusive(async () => {
      const key = `reqident:${provider}:${subject}`;
      const have = await this.storage.get(key);
      if (have) return { request: have, already: true };
      const id = randomId(6);
      await this.storage.put(`request:${id}`, { id, provider, subject, email: str(email), name: str(name), at: this.iso(), state: 'asked' });
      await this.storage.put(key, id);
      await this.audit('access-asked', { ip, detail: { request: id } });
      return { request: id, already: false };
    });
  }

  async listRequests() {
    const all = await this.storage.list({ prefix: 'request:' });
    return [...all.values()].filter((r) => r.state === 'asked').map(({ subject, ...r }) => r).sort((a, b) => a.at.localeCompare(b.at));
  }

  async approve({ request, account }) {
    return this.exclusive(async () => {
      if (request) {
        const r = await this.storage.get(`request:${request}`);
        if (!r) refuse(404, 'No such request.');
        await this.storage.put(`request:${request}`, { ...r, state: 'approved' });
        await this.audit('access-approved', { detail: { request } });
        return { ok: true };
      }
      const acct = account ? await this.storage.get(`acct:${account}`) : null;
      if (!acct) refuse(404, 'No such account.');
      await this.storage.put(`acct:${account}`, { ...acct, approved: true });
      await this.audit('access-approved', { account });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------- drives

  async liveDriveCount() {
    const all = await this.storage.list({ prefix: 'drive:' });
    return [...all.values()].filter((d) => d.state !== 'removed' && !d.claimed).length;
  }

  async claimDrive({ account, name }) {
    return this.exclusive(async () => {
      const acct = account ? await this.storage.get(`acct:${account}`) : null;
      if (!acct) refuse(404, 'No such account.');
      if (acct.state !== 'active') refuse(403, 'This account is on hold.');
      const held = acct.held ? await this.inviteByHash(acct.held) : null;

      if (held?.invite?.drive) {
        // A claim invite: it hands over a drive that already exists.
        if (!held.ok) refuse(410, held.why === 'expired' ? 'This invite has expired.' : 'This invite has been used.');
        const target = held.invite.drive;
        if (name && name !== target) refuse(400, `This invite is for ${target}.`);
        const existing = await this.storage.get(`drive:${target}`);
        if (existing?.owner && existing.owner !== acct.id) refuse(409, `${target} is taken.`);
        const drive = {
          name: target,
          owner: acct.id,
          sprite: held.invite.sprite ?? existing?.sprite ?? null,
          homes: existing?.homes ?? {},
          state: 'ready',
          claimed: true,
          created: existing?.created ?? this.iso(),
          steps: {},
        };
        await this.storage.put(`drive:${target}`, drive);
        await this.storage.put(`invite:${held.hash}`, { ...held.invite, uses: held.invite.uses - 1 });
        await this.storage.put(`acct:${acct.id}`, { ...acct, held: null, drives: [...new Set([...(acct.drives ?? []), target])] });
        await this.audit('drive-claimed', { account: acct.id, detail: { drive: target, invite: held.invite.id } });
        return { drive: this.driveView(drive) };
      }

      const why = nameProblem(name);
      if (why) refuse(400, why);
      if (acct.role !== 'owner' && (acct.drives ?? []).length >= 1) refuse(409, 'You already have a drive.');
      const may = acct.role === 'owner' || acct.approved || held?.ok;
      if (!may) refuse(403, held ? (held.why === 'expired' ? 'Your invite has expired.' : 'Your invite has been used.') : 'You need an invite to make a drive.');
      if (await this.storage.get(`drive:${name}`)) refuse(409, `${name} is taken.`);
      if ((await this.liveDriveCount()) >= this.maxDrives) refuse(503, 'Bryan has made as many drives as he can for now. Your invite still works; try again later.');

      const drive = { name, owner: acct.id, sprite: `d-${name}`, homes: {}, state: 'queued', created: this.iso(), steps: {} };
      await this.storage.put(`drive:${name}`, drive);
      if (held?.ok) await this.storage.put(`invite:${held.hash}`, { ...held.invite, uses: held.invite.uses - 1 });
      await this.storage.put(`acct:${acct.id}`, { ...acct, held: null, approved: false, drives: [...(acct.drives ?? []), name] });
      await this.audit('drive-asked', { account: acct.id, detail: { drive: name, invite: held?.ok ? held.invite.id : null } });
      return { drive: this.driveView(drive) };
    });
  }

  driveView(d) {
    if (!d) return null;
    return { name: d.name, owner: d.owner, homes: d.homes ?? {}, sprite: d.sprite ?? null, state: d.state, steps: d.steps ?? {}, failed: d.failed ?? null, created: d.created };
  }

  async drive(name) {
    return this.driveView(await this.storage.get(`drive:${name}`));
  }

  async listDrives() {
    const all = await this.storage.list({ prefix: 'drive:' });
    return [...all.values()].map((d) => this.driveView(d)).sort((a, b) => a.created.localeCompare(b.created));
  }

  async queued() {
    return (await this.listDrives()).filter((d) => d.state === 'queued');
  }

  async step(name, { step, state, url, sprite }) {
    return this.exclusive(async () => {
      const d = await this.storage.get(`drive:${name}`);
      if (!d) refuse(404, 'No such drive.');
      if (state === 'ready') {
        let origin;
        try {
          origin = new URL(url);
        } catch {
          refuse(400, 'ready needs the sprite URL');
        }
        if (origin.protocol !== 'https:') refuse(400, 'the sprite URL is https');
        const steps = Object.fromEntries(STEPS.map((s) => [s, 'done']));
        await this.storage.put(`drive:${name}`, { ...d, state: 'ready', homes: { ...(d.homes ?? {}), fly: origin.origin }, sprite: sprite ? str(sprite, 64) : d.sprite, steps, failed: null });
        await this.audit('drive-ready', { account: d.owner, detail: { drive: name } });
        return { ok: true };
      }
      if (!STEPS.includes(step)) refuse(400, `step is one of ${STEPS.join(', ')}`);
      if (state === 'failed') {
        await this.storage.put(`drive:${name}`, { ...d, state: 'failed', failed: step, steps: { ...(d.steps ?? {}), [step]: 'failed' } });
        await this.audit('drive-failed', { account: d.owner, detail: { drive: name, step } });
        return { ok: true };
      }
      if (!['now', 'done'].includes(state)) refuse(400, 'state is now, done, failed or ready');
      await this.storage.put(`drive:${name}`, { ...d, state: 'making', steps: { ...(d.steps ?? {}), [step]: state } });
      return { ok: true };
    });
  }

  async hold(name, on) {
    return this.exclusive(async () => {
      const d = await this.storage.get(`drive:${name}`);
      if (!d) refuse(404, 'No such drive.');
      const next = on ? { ...d, state: 'held', before: d.state === 'held' ? d.before : d.state } : { ...d, state: d.before ?? 'ready', before: undefined };
      await this.storage.put(`drive:${name}`, next);
      await this.audit(on ? 'drive-held' : 'drive-released', { account: d.owner, detail: { drive: name } });
      return { drive: this.driveView(next) };
    });
  }

  // ------------------------------------------------------------- sessions

  async openSession({ account, method, device, ip }) {
    const acct = account ? await this.storage.get(`acct:${account}`) : null;
    if (!acct) refuse(404, 'No such account.');
    const sid = randomId(32);
    const hash = await sha256Hex(sid);
    await this.storage.put(`session:${hash}`, { account, created: this.iso(), seen: this.iso(), method: str(method, 20), device: str(device, 120) });
    await this.audit('session-opened', { account, ip, detail: { method: str(method, 20) } });
    return { sid, hash };
  }

  async session(hash) {
    const s = hash ? await this.storage.get(`session:${hash}`) : null;
    if (!s || s.revoked) return { live: false };
    if (Date.parse(s.created) + SESSION_DAYS * DAY <= this.now()) return { live: false };
    const acct = await this.storage.get(`acct:${s.account}`);
    if (!acct || acct.state !== 'active') return { live: false };
    return { live: true, account: s.account, method: s.method, created: s.created };
  }

  async revoke(hash) {
    const s = hash ? await this.storage.get(`session:${hash}`) : null;
    if (!s) return { ok: false };
    await this.storage.put(`session:${hash}`, { ...s, revoked: this.iso() });
    await this.audit('session-revoked', { account: s.account });
    return { ok: true };
  }

  async revokeAll(account) {
    const all = await this.storage.list({ prefix: 'session:' });
    let n = 0;
    for (const [key, s] of all) {
      if (s.account !== account || s.revoked) continue;
      await this.storage.put(key, { ...s, revoked: this.iso() });
      n += 1;
    }
    await this.audit('sessions-revoked', { account, detail: { count: n } });
    return { ok: true, count: n };
  }

  // ------------------------------------------------------------- one-offs

  /** True the first time a grant's nonce is seen within its life. */
  async nonce(n) {
    return this.exclusive(async () => {
      if (typeof n !== 'string' || !/^[0-9a-f]{16,64}$/.test(n)) return false;
      const now = this.now();
      const seen = await this.storage.get(`nonce:${n}`);
      if (seen && seen > now) return false;
      await this.storage.put(`nonce:${n}`, now + NONCE_MS);
      const all = await this.storage.list({ prefix: 'nonce:' });
      for (const [key, until] of all) if (until <= now) await this.storage.delete(key);
      return true;
    });
  }

  /** A fixed-window counter for rate limits. */
  async count({ key, limit, windowSeconds }) {
    return this.exclusive(async () => {
      const now = this.now();
      const k = `count:${str(key, 160)}`;
      let rec = await this.storage.get(k);
      if (!rec || now >= rec.start + windowSeconds * 1000) rec = { start: now, n: 0 };
      if (rec.n >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((rec.start + windowSeconds * 1000 - now) / 1000)) };
      await this.storage.put(k, { ...rec, n: rec.n + 1 });
      return { ok: true };
    });
  }

  async log({ account = null, limit = 200 } = {}) {
    const all = await this.storage.list({ prefix: 'audit:' });
    const cutoff = new Date(this.now() - AUDIT_DAYS * DAY).toISOString();
    const lines = [];
    for (const [key, line] of all) {
      if (line.at < cutoff) {
        await this.storage.delete(key);
        continue;
      }
      if (!account || line.account === account) lines.push(line);
    }
    return lines.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
}

// ---------------------------------------------------------------- the object

async function body(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export class Directory {
  constructor(state, env = {}) {
    const max = Number(env.MAX_DRIVES);
    this.core = new DirectoryCore(state.storage, { maxDrives: Number.isFinite(max) && env.MAX_DRIVES !== '' && env.MAX_DRIVES !== undefined ? max : DEFAULT_MAX_DRIVES });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const c = this.core;
    try {
      let m;
      if (method === 'POST' && path === '/identity') return json(200, await c.identity(await body(request)));
      if (method === 'POST' && path === '/request') return json(200, await c.request(await body(request)));
      if (method === 'POST' && path === '/approve') return json(200, await c.approve(await body(request)));
      if (method === 'POST' && path === '/invite') {
        const { code, invite } = await c.makeInvite(await body(request));
        return json(200, { code, invite });
      }
      if (method === 'POST' && path === '/invite/peek') {
        const r = await c.inviteFor((await body(request)).code);
        return json(200, { ok: r.ok, why: r.ok ? null : r.why, drive: r.invite?.drive ?? null, owner: Boolean(r.invite?.owner) });
      }
      if (method === 'GET' && path === '/invites') return json(200, { invites: await c.listInvites() });
      if (method === 'GET' && path === '/requests') return json(200, { requests: await c.listRequests() });
      if (method === 'POST' && path === '/drive') return json(200, await c.claimDrive(await body(request)));
      if (method === 'GET' && path === '/drives') return json(200, { drives: await c.listDrives() });
      if (method === 'GET' && path === '/queue') return json(200, { drives: await c.queued() });
      if ((m = /^\/drives\/([a-z0-9-]{1,40})$/.exec(path)) && method === 'GET') {
        const d = await c.drive(m[1]);
        return d ? json(200, d) : json(404, { why: 'No such drive.' });
      }
      if ((m = /^\/drives\/([a-z0-9-]{1,40})\/step$/.exec(path)) && method === 'POST') return json(200, await c.step(m[1], await body(request)));
      if ((m = /^\/drives\/([a-z0-9-]{1,40})\/hold$/.exec(path)) && method === 'POST') return json(200, await c.hold(m[1], (await body(request)).on !== false));
      if ((m = /^\/accounts\/([0-9a-f]{16})$/.exec(path)) && method === 'GET') {
        const a = await c.accountView(m[1]);
        return a ? json(200, a) : json(404, { why: 'No such account.' });
      }
      if ((m = /^\/accounts\/([0-9a-f]{16})\/sessions$/.exec(path)) && method === 'DELETE') return json(200, await c.revokeAll(m[1]));
      if (method === 'POST' && path === '/session') return json(200, await c.openSession(await body(request)));
      if ((m = /^\/session\/([0-9a-f]{64})$/.exec(path))) {
        if (method === 'GET') return json(200, await c.session(m[1]));
        if (method === 'DELETE') return json(200, await c.revoke(m[1]));
      }
      if ((m = /^\/nonce\/([0-9a-f]{16,64})$/.exec(path)) && method === 'POST') return json(200, { fresh: await c.nonce(m[1]) });
      if (method === 'POST' && path === '/count') {
        const b = await body(request);
        return json(200, await c.count({ key: String(b.key ?? ''), limit: Number(b.limit) || 1, windowSeconds: Number(b.windowSeconds) || 60 }));
      }
      if (method === 'GET' && path === '/log') return json(200, { lines: await c.log({ account: url.searchParams.get('account'), limit: Number(url.searchParams.get('limit')) || 200 }) });
      return json(404, { why: 'no such route' });
    } catch (err) {
      if (err instanceof Refusal) return json(err.status, { why: err.message, ...err.extra });
      return json(500, { why: 'the directory failed' });
    }
  }
}

/** The Worker's handle on the one Directory object. */
export function directory(env) {
  const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
  return async (method, path, payload) => {
    const res = await stub.fetch(new Request(`https://directory${path}`, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    }));
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    return { status: res.status, ok: res.ok, data };
  };
}
