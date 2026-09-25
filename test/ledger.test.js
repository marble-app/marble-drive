// A drive's own ledger: one line per awake minute, saying what it used and why
// it was up, so its state and cost can be drawn later without anyone watching.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLedger, systemReaders } from '../server/ledger.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 25, 12, 0, 0);

async function world({ boot = 'boot-1', stored = undefined, uptime = 9999, cpu = 100, files = {} } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ledger-'));
  if (stored !== undefined) await fsp.writeFile(path.join(dir, '.boot'), stored);
  for (const [name, text] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), text);
  let wall = T0;
  const r = { cpu, mem: 2, used: 1, disk: 5, boot, uptime };
  const readers = {
    cpuSeconds: () => r.cpu,
    memGB: () => r.mem,
    usedGB: () => r.used,
    diskGB: () => r.disk,
    bootId: () => r.boot,
    uptimeSeconds: () => r.uptime,
  };
  const why = { tabs: 0, looking: 0, work: 0, asks: 0 };
  const logged = [];
  const ledger = createLedger({
    dir,
    readers,
    why: () => ({ ...why }),
    now: () => wall,
    schedule: null,
    log: { error: (m) => logged.push(m), info() {}, log() {} },
  });
  await ledger.ready;
  const step = async (ms) => {
    wall += ms;
    ledger.tick();
    await ledger.settled();
  };
  const lines = async () => ledger.read(0);
  return { dir, ledger, r, why, step, lines, logged, advance: (ms) => { wall += ms; } };
}

test('a minute awake is one line: CPU used, memory averaged, disk, and why', async () => {
  const w = await world();
  w.why.tabs = 1;
  for (const mem of [1, 2, 3]) {
    w.r.mem = mem;
    w.r.cpu += 3;
    await w.step(15_000);
  }
  w.why.looking = 1;
  w.r.mem = 6;
  w.r.cpu += 3;
  await w.step(15_000);
  const [line] = await w.lines();
  assert.equal(line.t, (T0 + 60_000) / 1000);
  assert.equal(line.dt, 60);
  assert.equal(line.cpu, 12);
  assert.equal(line.mem, 3);
  assert.equal(line.used, 1);
  assert.equal(line.disk, 5);
  assert.deepEqual(line.why, { tabs: 1, looking: 1, work: 0, asks: 0 }, 'the most seen in the minute');
  assert.equal(line.wake, 'cold', 'the first line of a machine never seen says it started cold');
});

test('the same boot is a restart; a new boot or a fresh machine is a cold start', async () => {
  const same = await world({ stored: 'boot-1' });
  for (let i = 0; i < 4; i += 1) await same.step(15_000);
  assert.equal((await same.lines())[0].wake, 'restart');

  const fresh = await world({ stored: 'boot-0' });
  for (let i = 0; i < 4; i += 1) await fresh.step(15_000);
  assert.equal((await fresh.lines())[0].wake, 'cold');

  const noId = await world({ boot: null, uptime: 40 });
  for (let i = 0; i < 4; i += 1) await noId.step(15_000);
  assert.equal((await noId.lines())[0].wake, 'cold', 'no boot id, but the machine only just booted');

  const noIdOld = await world({ boot: null, uptime: 40_000 });
  for (let i = 0; i < 4; i += 1) await noIdOld.step(15_000);
  assert.equal((await noIdOld.lines())[0].wake, 'restart');
});

test('a freeze ends the minute where it froze, and the next line says it woke warm', async () => {
  const w = await world({ stored: 'boot-1' });
  for (let i = 0; i < 4; i += 1) await w.step(15_000);
  await w.step(30_000 - 15_000); // 15 s into the next minute
  w.advance(3 * 60 * 60 * 1000); // paused for three hours
  await w.step(15_000); // the first tick after waking
  for (let i = 0; i < 4; i += 1) await w.step(15_000);
  const [first, partial, woke] = await w.lines();
  assert.equal(first.dt, 60);
  assert.equal(partial.dt, 15, 'the part-minute before the freeze');
  assert.equal(partial.t, (T0 + 75_000) / 1000);
  assert.equal(partial.wake, null);
  assert.equal(woke.wake, 'warm');
  assert.equal(woke.dt, 60, 'the freeze itself is not awake time');
  assert.equal(woke.t, (T0 + 75_000 + 3 * 60 * 60 * 1000 + 75_000) / 1000);
});

test('a CPU counter that went backwards is counted from zero, not negative', async () => {
  const w = await world({ cpu: 500 });
  for (let i = 0; i < 3; i += 1) await w.step(15_000);
  w.r.cpu = 4;
  await w.step(15_000);
  assert.equal((await w.lines())[0].cpu, 4);
});

test('unknown readings stay null and the line is still written', async () => {
  const w = await world();
  w.r.cpu = null;
  w.r.mem = null;
  w.r.disk = null;
  for (let i = 0; i < 4; i += 1) await w.step(15_000);
  const [line] = await w.lines();
  assert.equal(line.cpu, null);
  assert.equal(line.mem, null);
  assert.equal(line.disk, null);
  assert.equal(line.dt, 60);
});

test('turns and documents opened are counted into the minute they happened in', async () => {
  const w = await world();
  w.ledger.count('opens');
  w.ledger.count('opens');
  w.ledger.count('turns');
  for (let i = 0; i < 4; i += 1) await w.step(15_000);
  for (let i = 0; i < 4; i += 1) await w.step(15_000);
  const [a, b] = await w.lines();
  assert.equal(a.opens, 2);
  assert.equal(a.turns, 1);
  assert.equal(b.opens, 0);
});

test('lines go in one file per UTC day, older than 90 days are removed, and read() crosses days', async () => {
  const old = new Date(T0 - 91 * DAY).toISOString().slice(0, 10);
  const kept = new Date(T0 - 89 * DAY).toISOString().slice(0, 10);
  const w = await world({
    files: {
      [`${old}.jsonl`]: '{"t":1}\n',
      [`${kept}.jsonl`]: `${JSON.stringify({ t: (T0 - 89 * DAY) / 1000, dt: 60 })}\n`,
    },
  });
  const names = (await fsp.readdir(w.dir)).filter((n) => n.endsWith('.jsonl'));
  assert.deepEqual(names, [`${kept}.jsonl`]);
  for (let i = 0; i < 4; i += 1) await w.step(15_000);
  const all = await w.ledger.read(0);
  assert.equal(all.length, 2);
  const since = await w.ledger.read((T0 - DAY) / 1000);
  assert.equal(since.length, 1, 'only lines after the cursor');
  assert.ok((await fsp.readdir(w.dir)).includes('2026-09-25.jsonl'));
});

test('a write that fails is logged once and the ledger carries on', async () => {
  const w = await world();
  await fsp.rm(w.dir, { recursive: true });
  await fsp.writeFile(w.dir, 'not a directory');
  for (let i = 0; i < 8; i += 1) await w.step(15_000);
  assert.equal(w.logged.length, 1);
});

test('the system readers read cgroup v2, /proc and statfs, and return null where there is nothing', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sys-'));
  await fsp.mkdir(path.join(root, 'cg'));
  await fsp.mkdir(path.join(root, 'proc', 'sys', 'kernel', 'random'), { recursive: true });
  await fsp.writeFile(path.join(root, 'cg', 'cpu.stat'), 'usage_usec 765812404\nuser_usec 1\n');
  await fsp.writeFile(path.join(root, 'cg', 'memory.current'), '3615641600\n');
  await fsp.writeFile(path.join(root, 'proc', 'meminfo'), 'MemTotal:        8388608 kB\nMemFree:  1 kB\nMemAvailable:    6616072 kB\n');
  await fsp.writeFile(path.join(root, 'proc', 'uptime'), '1234.5 999.0\n');
  await fsp.writeFile(path.join(root, 'proc', 'sys', 'kernel', 'random', 'boot_id'), 'b808\n');
  const r = systemReaders({ cgroup: path.join(root, 'cg'), proc: path.join(root, 'proc'), disk: root });
  assert.equal(r.cpuSeconds(), 765.812404);
  assert.equal(r.memGB(), 3615641600 / 2 ** 30);
  assert.equal(r.usedGB(), (8388608 - 6616072) / 2 ** 20);
  assert.equal(r.bootId(), 'b808');
  assert.equal(r.uptimeSeconds(), 1234.5);
  assert.ok(r.diskGB() > 0);
  const none = systemReaders({ cgroup: path.join(root, 'nope'), proc: path.join(root, 'nope'), disk: path.join(root, 'nope') });
  assert.equal(none.cpuSeconds(), null);
  assert.equal(none.memGB(), null);
  assert.equal(none.usedGB(), null);
  assert.equal(none.diskGB(), null);
  assert.equal(none.bootId(), null);
});

test('a drive answers its ledger at /usage, behind the gate, and counts a document opened', async (t) => {
  const { createDrive } = await import('../server/app.js');
  const { loadConfig } = await import('../server/config.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ledger-host-'));
  const config = loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'pw-1234' });
  const drive = await createDrive(config, { log: { log() {}, error() {}, info() {} }, agents: false });
  t.after(() => drive.close());
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  await drive.ledger.ready;
  const dir = path.join(drive.store.marbleDir, 'usage');
  await fsp.writeFile(path.join(dir, '2026-09-25.jsonl'), `${JSON.stringify({ t: 100, dt: 60 })}\n${JSON.stringify({ t: 200, dt: 60 })}\n`);
  assert.equal((await fetch(`${base}/usage`)).status, 401);
  const res = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'pw-1234' }) });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const body = await (await fetch(`${base}/usage?since=150`, { headers: { cookie } })).json();
  assert.deepEqual(body.lines.map((l) => l.t), [200]);
});

test('a document counts as opened when it is visited, not when the Drive previews it in a frame', async (t) => {
  const { createDrive } = await import('../server/app.js');
  const { loadConfig } = await import('../server/config.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ledger-opens-'));
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root }), { log: { log() {}, error() {}, info() {} }, agents: false });
  t.after(() => drive.close());
  await drive.createDocument('note', '<!doctype html><html><body data-marble-id="b"><p data-marble-id="p">x</p></body></html>', { label: 't' });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const counted = [];
  const count = drive.ledger.count;
  drive.ledger.count = (kind) => { counted.push(kind); count(kind); };
  await fetch(`http://127.0.0.1:${port}/a/note`, { headers: { 'Sec-Fetch-Dest': 'document' } });
  await fetch(`http://127.0.0.1:${port}/a/note`, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  await fetch(`http://127.0.0.1:${port}/a/note`);
  assert.deepEqual(counted, ['opens', 'opens']);
});
