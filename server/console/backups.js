// Backups kept off Fly, on the owner's Mac (tools/drive-backup.sh), as the
// Console sees them (docs/superpowers/specs/2026-09-27-backups-in-console-design.md).
//
// The sprite cannot reach the Mac, so nothing here reaches it either. The Mac's
// agent (tools/backup-agent.mjs) checks in every minute while this drive is
// awake: it leaves a report, <dir>/<sprite>.json, and takes the requests the
// page left in <dir>/requests/<id>.json. This module reads the one and writes
// the other.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const CHECKPOINT = /^v\d{1,9}$/;

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export function createBackups({ dir, now = () => Date.now() }) {
  const requestsDir = path.join(dir, 'requests');

  async function reports() {
    const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json') && NAME.test(n.slice(0, -5)));
    const out = [];
    for (const n of names) {
      try {
        const r = JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8'));
        if (r?.sprite === n.slice(0, -5)) out.push(r);
      } catch {}
    }
    return out;
  }

  async function pending() {
    const files = (await fsp.readdir(requestsDir).catch(() => [])).filter((n) => n.endsWith('.json'));
    const out = [];
    for (const n of files) {
      try {
        out.push(JSON.parse(await fsp.readFile(path.join(requestsDir, n), 'utf8')));
      } catch {}
    }
    return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  /** Every drive the Mac backs up, with the requests still waiting for it. */
  async function list() {
    const [all, waiting] = await Promise.all([reports(), pending()]);
    return all.map((r) => ({ ...r, pending: waiting.filter((q) => q.sprite === r.sprite) }));
  }

  /** What changes when the Mac checks in or a request is left or taken. */
  async function signature() {
    const stat = async (p) => (await fsp.stat(p).catch(() => null))?.mtimeMs ?? 0;
    const names = await fsp.readdir(dir).catch(() => []);
    const reqs = await fsp.readdir(requestsDir).catch(() => []);
    return JSON.stringify([await Promise.all(names.filter((n) => n.endsWith('.json')).sort().map(async (n) => [n, await stat(path.join(dir, n))])), reqs.sort()]);
  }

  async function request(sprite, body = {}) {
    if (!NAME.test(String(sprite ?? ''))) throw bad('not a drive name');
    const report = (await reports()).find((r) => r.sprite === sprite);
    if (!report) throw bad(`no Mac backs up ${sprite}`, 404);
    const req = { id: `${now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`, sprite, at: new Date(now()).toISOString() };
    switch (body.kind) {
      case 'backup':
        Object.assign(req, { kind: 'backup' });
        break;
      case 'schedule':
        if (typeof body.on !== 'boolean') throw bad('on or off');
        Object.assign(req, { kind: 'schedule', on: body.on });
        break;
      case 'restore': {
        // The Mac keeps one copy; a restore names it, so a copy replaced in
        // the meantime is not the one put back.
        const snapshot = String(body.snapshot ?? '');
        const target = String(body.target ?? '');
        if (!SNAPSHOT.test(snapshot) || report.copy?.name !== snapshot) throw bad(`the Mac's copy is ${report.copy?.name ?? 'missing'}, not ${snapshot}`);
        if (!NAME.test(target)) throw bad('not a drive name');
        if (body.confirm !== target) throw bad(`type ${target} to confirm`);
        Object.assign(req, { kind: 'restore', snapshot, target });
        break;
      }
      case 'checkpoint': {
        // Restoring the drive this page is on stops it, so the Mac does it.
        const checkpoint = String(body.checkpoint ?? '');
        if (!CHECKPOINT.test(checkpoint)) throw bad('not a checkpoint');
        if (body.confirm !== sprite) throw bad(`type ${sprite} to confirm`);
        Object.assign(req, { kind: 'checkpoint', checkpoint, target: sprite });
        break;
      }
      default:
        throw bad('back up, schedule, restore or checkpoint');
    }
    // One at a time of a kind, and one restore of either kind: pressing twice
    // leaves one request.
    const restoring = (k) => (k === 'restore' || k === 'checkpoint' ? 'restore' : k);
    const same = (await pending()).find((q) => q.sprite === sprite && restoring(q.kind) === restoring(req.kind));
    if (same) throw bad(`already asked ${Math.round((now() - Date.parse(same.at)) / 1000)} s ago; the Mac picks it up within a minute`, 409);
    await fsp.mkdir(requestsDir, { recursive: true });
    const file = path.join(requestsDir, `${req.id}.json`);
    await fsp.writeFile(`${file}.tmp`, `${JSON.stringify(req)}\n`);
    await fsp.rename(`${file}.tmp`, file);
    return req;
  }

  /** Take back a request the Mac has not picked up. */
  async function withdraw(id) {
    if (!ID.test(String(id ?? ''))) throw bad('not a request');
    await fsp.rm(path.join(requestsDir, `${id}.json`), { force: true });
    return { ok: true };
  }

  return { list, signature, request, withdraw };
}
