// What changes inside a drive the PC hosts for someone else: /health names
// the release it runs; /health/deep answers only the owner on this machine,
// kept a minute, with both agent CLIs, the documents its person made and
// whether an agent can run; and the ledger and the memory guard measure the
// drive's own service when it has a memory limit, not the whole machine.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cgroupMemory, ownCgroup } from '../server/cgroup.js';
import { createDeepHealth, madeDocs } from '../server/health-deep.js';
import { systemReaders } from '../server/ledger.js';
import { createMemoryGuard } from '../server/memory-guard.js';

const MB = 2 ** 20;
const GiB = 2 ** 30;
const UNIT = '/system.slice/marble-guests.slice/marble-guest@ana.service';

/** A /proc and a /sys/fs/cgroup for one process in marble-guest@ana.service. */
async function fakeMachine({ cgroupLine = `0::${UNIT}`, max = String(1536 * MB), high = String(1024 * MB), currentMB = 300, inactiveMB = 50, activeMB = 0, slabMB = 0, pressure = 0, procs = [], meminfo = { totalMB: 12_000, availableMB: 200 } } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'guest-cg-'));
  const proc = path.join(root, 'proc');
  const cg = path.join(root, 'cgroup');
  await fsp.mkdir(path.join(proc, 'self'), { recursive: true });
  await fsp.mkdir(path.join(proc, 'pressure'), { recursive: true });
  await fsp.writeFile(path.join(proc, 'self', 'cgroup'), `${cgroupLine}\n`);
  await fsp.writeFile(path.join(proc, 'meminfo'), `MemTotal: ${meminfo.totalMB * 1024} kB\nMemFree: 1 kB\nMemAvailable: ${meminfo.availableMB * 1024} kB\n`);
  await fsp.writeFile(path.join(proc, 'pressure', 'memory'), 'some avg10=80.00 avg60=0 avg300=0 total=1\n');
  const dir = path.join(cg, UNIT);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'memory.max'), `${max}\n`);
  await fsp.writeFile(path.join(dir, 'memory.high'), `${high}\n`);
  await fsp.writeFile(path.join(dir, 'memory.current'), `${currentMB * MB}\n`);
  await fsp.writeFile(path.join(dir, 'memory.stat'), `anon ${(currentMB - inactiveMB - activeMB - slabMB) * MB}\nfile ${(inactiveMB + activeMB) * MB}\nshmem 0\nactive_file ${activeMB * MB}\ninactive_file ${inactiveMB * MB}\nslab_reclaimable ${slabMB * MB}\nslab_unreclaimable 1048576\n`);
  await fsp.writeFile(path.join(dir, 'memory.pressure'), `some avg10=${pressure.toFixed(2)} avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=1\n`);
  await fsp.writeFile(path.join(dir, 'cpu.stat'), 'usage_usec 42000000\nuser_usec 1\n');
  for (const p of procs) {
    const d = path.join(proc, String(p.pid));
    await fsp.mkdir(d);
    await fsp.writeFile(path.join(d, 'stat'), `${p.pid} (${p.name}) S ${p.ppid} 1 1 0 -1\n`);
    await fsp.writeFile(path.join(d, 'statm'), `1000 ${Math.round((p.mb * MB) / 4096)} 10 1 0 100 0\n`);
    await fsp.writeFile(path.join(d, 'oom_score_adj'), `${p.score ?? 0}\n`);
    await fsp.writeFile(path.join(d, 'cmdline'), `${p.name}\0`);
  }
  const setUse = async ({ currentMB: c, inactiveMB: i = 0, pressure: p = 0 }) => {
    await fsp.writeFile(path.join(dir, 'memory.current'), `${c * MB}\n`);
    await fsp.writeFile(path.join(dir, 'memory.stat'), `inactive_file ${i * MB}\n`);
    await fsp.writeFile(path.join(dir, 'memory.pressure'), `some avg10=${p.toFixed(2)} avg60=0.00 avg300=0.00 total=1\n`);
  };
  return { root, proc, cg, dir, setUse };
}

test('a drive in a service with a memory limit is measured by that service; anywhere else, by the machine', async () => {
  const m = await fakeMachine();
  assert.equal(ownCgroup({ proc: m.proc, root: m.cg }), m.dir);
  const unlimited = await fakeMachine({ max: 'max' });
  assert.equal(ownCgroup({ proc: unlimited.proc, root: unlimited.cg }), null, 'the owner\'s drive: no limit');
  const sprite = await fakeMachine({ cgroupLine: '0::/' });
  assert.equal(ownCgroup({ proc: sprite.proc, root: sprite.cg }), null, 'a sprite is one cgroup');
  const v1 = await fakeMachine({ cgroupLine: '12:memory:/x\n1:name=systemd:/x' });
  assert.equal(ownCgroup({ proc: v1.proc, root: v1.cg }), null);
  const sly = await fakeMachine({ cgroupLine: '0::/../../etc' });
  assert.equal(ownCgroup({ proc: sly.proc, root: sly.cg }), null);
  assert.equal(ownCgroup({ proc: path.join(m.root, 'nope'), root: m.cg }), null, 'a Mac has no /proc');
  assert.deepEqual(cgroupMemory(m.dir), { max: 1536 * MB, high: 1024 * MB, current: 300 * MB, used: 250 * MB, pressure: 0 });
  // The first drive to read a release holds its files in its cache, which
  // the kernel can drop: measured on the PC, 476 MB held, 96 MB its own.
  const first = await fakeMachine({ currentMB: 476, activeMB: 287, inactiveMB: 88, slabMB: 2 });
  assert.equal(cgroupMemory(first.dir).used, 99 * MB);
});

test('the ledger counts the drive\'s own CPU, memory and working set', async () => {
  const m = await fakeMachine();
  const r = systemReaders({ proc: m.proc, own: m.dir, disk: m.root });
  assert.equal(r.cpuSeconds(), 42);
  assert.equal(r.memGB(), (300 * MB) / GiB);
  assert.equal(r.usedGB(), (250 * MB) / GiB, 'what its programs use, less the file cache it can drop');
  const machine = systemReaders({ proc: m.proc, cgroup: path.join(m.root, 'nope'), own: null, disk: m.root });
  assert.equal(machine.usedGB(), (12_000 - 200) / 1024, 'the machine, as before');
});

test('the memory guard watches the drive\'s own limit: 10% of it left, or pressure past 90% of where it slows', async () => {
  const HOST = 100;
  const procs = [
    { pid: 1, ppid: 0, mb: 1, name: 'bash' },
    { pid: HOST, ppid: 1, mb: 150, name: 'node' },
    { pid: 200, ppid: HOST, mb: 200, name: 'claude', score: 500 },
    { pid: 210, ppid: 200, mb: 600, name: 'chrome', score: 500 },
  ];
  const m = await fakeMachine({ procs, currentMB: 400, inactiveMB: 0 });
  const killed = [];
  const guard = createMemoryGuard({ proc: m.proc, cgroup: m.dir, host: HOST, schedule: null, kill: (pid) => killed.push(pid), log: { error() {} }, cooldownMs: 0 });
  // The machine has 200 MB left and 80% pressure: none of this drive's business.
  assert.deepEqual(guard.reading(), { availableMB: 1136, totalMB: 1536, pressure: 0 });
  assert.equal(guard.check(), null);
  assert.equal(guard.snapshot().totalGB, 1.5);

  await m.setUse({ currentMB: 950, pressure: 0 });
  assert.equal(guard.check(), null, 'near where it slows, but not waiting on memory');
  await m.setUse({ currentMB: 950, pressure: 20 });
  const relief = guard.check();
  assert.ok(relief, 'waiting on memory past 90% of MemoryHigh');
  assert.deepEqual(killed, [210], 'the heaviest thing a turn runs');
  killed.length = 0;
  await m.setUse({ currentMB: 1400, pressure: 0 });
  assert.ok(guard.check(), 'less than 10% of MemoryMax left');
  await m.setUse({ currentMB: 1400, inactiveMB: 500, pressure: 0 });
  assert.equal(guard.check(), null, 'file cache it can drop is room');

  // The same drive outside a limited service reads the machine, as before.
  const machine = createMemoryGuard({ proc: m.proc, cgroup: null, host: HOST, schedule: null, kill() {}, log: { error() {} } });
  assert.equal(machine.reading().totalMB, 12_000);
});

/** A stand-in for the two CLIs, answering what a test says. */
function fakeCli({ claudeIn = false, codexIn = false, claude = '2.1.281 (Claude Code)', codex = 'codex-cli 0.159.3' } = {}) {
  const asked = [];
  const run = async (command, args, opts) => {
    asked.push({ line: [command, ...args].join(' '), env: opts.env });
    if (command === 'claude' && args[0] === '--version') return claude ? { code: 0, stdout: `${claude}\n`, stderr: '' } : { code: null, missing: true, stdout: '', stderr: '' };
    if (command === 'claude') return { code: claudeIn ? 0 : 1, stdout: JSON.stringify({ loggedIn: claudeIn, authMethod: claudeIn ? 'claude.ai' : 'none' }), stderr: '' };
    if (command === 'codex' && args[0] === '--version') return codex ? { code: 0, stdout: `${codex}\n`, stderr: '' } : { code: null, missing: true, stdout: '', stderr: '' };
    return { code: codexIn ? 0 : 1, stdout: '', stderr: codexIn ? 'Logged in using ChatGPT\n' : 'Not logged in\n' };
  };
  return { run, asked };
}

const fakeStore = (entries, seeded = {}) => {
  const marbleDir = fsp.mkdtemp(path.join(os.tmpdir(), 'deep-marble-'));
  return marbleDir.then(async (dir) => {
    await fsp.writeFile(path.join(dir, 'apps.json'), JSON.stringify({ seeded, docs: {} }));
    return { marbleDir: dir, list: async () => entries };
  });
};

test('/health/deep\'s answer: the release, both CLIs, the person\'s own documents, and whether an agent can run; kept a minute', async () => {
  const store = await fakeStore(
    [{ kind: 'doc', path: 'Start here' }, { kind: 'doc', path: 'drive' }, { kind: 'doc', path: 'Chat' }, { kind: 'doc', path: 'Ideas' }, { kind: 'folder', path: 'Notes' }, { kind: 'file', path: 'a.png' }],
    { 'start-here': 'Start here', drive: 'drive', chat: 'Chat', 'design-system': null },
  );
  assert.equal(await madeDocs(store), 1, 'only the one its person made');
  let t = 0;
  const cli = fakeCli();
  const deep = createDeepHealth({ store, keysFile: null, env: { MARBLE_GUEST_RELEASE: 'r1', HOME: '/h', PATH: '/p', MARBLE_DRIVE_SECRET: 'never-handed-on' }, run: cli.run, now: () => t });
  assert.deepEqual(await deep.read(), { ok: true, release: 'r1', claude: { version: '2.1.281', signedIn: false }, codex: { version: '0.159.3', signedIn: false }, docs: 1, agentConnected: false });
  assert.deepEqual(cli.asked.map((a) => a.line).sort(), ['claude --version', 'claude auth status', 'codex --version', 'codex login status']);
  assert.ok(cli.asked.every((a) => !('MARBLE_DRIVE_SECRET' in a.env) && a.env.HOME === '/h'), 'the CLIs get a turn\'s environment, not the drive\'s secret');
  t += 59_000;
  await Promise.all([deep.read(), deep.read()]);
  assert.equal(cli.asked.length, 4, 'kept a minute');
  t += 2_000;
  await Promise.all([deep.read(), deep.read()]);
  assert.equal(cli.asked.length, 8, 'asked again once, not twice');
});

test('/health/deep: signed in to either CLI, or a key in the drive\'s own file, is an agent that can run; a missing CLI has no version', async () => {
  const store = await fakeStore([]);
  const claude = createDeepHealth({ store, keysFile: null, env: {}, run: fakeCli({ claudeIn: true }).run });
  assert.deepEqual((await claude.read()).claude, { version: '2.1.281', signedIn: true });
  assert.equal((await claude.read()).agentConnected, true);
  const codex = createDeepHealth({ store, keysFile: null, env: {}, run: fakeCli({ codexIn: true, claude: null }).run });
  const said = await codex.read();
  assert.deepEqual(said.codex, { version: '0.159.3', signedIn: true });
  assert.deepEqual(said.claude, { version: null, signedIn: false });
  assert.equal(said.agentConnected, true);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deep-keys-'));
  const keysFile = path.join(dir, 'agent-keys');
  await fsp.writeFile(keysFile, JSON.stringify({ openai: 'sk-never-read-out' }), { mode: 0o600 });
  const keyed = await createDeepHealth({ store, keysFile, env: {}, run: fakeCli().run }).read();
  assert.equal(keyed.agentConnected, true);
  assert.ok(!JSON.stringify(keyed).includes('sk-never'), 'whether a key is set, never the key');
});

test('a drive: /health names its release; /health/deep answers only the owner, only on this machine', async (t) => {
  const { createDrive } = await import('../server/app.js');
  const { loadConfig } = await import('../server/config.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'guest-drive-'));
  const config = loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'pw-guest-1234', MARBLE_DRIVE_AGENT_KEYS: path.join(root, 'no-keys') });
  const cli = fakeCli();
  const drive = await createDrive(config, { log: { log() {}, error() {}, info() {} }, agents: false, deepHealth: { run: cli.run } });
  t.after(() => drive.close());
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const before = process.env.MARBLE_GUEST_RELEASE;
  t.after(() => {
    if (before === undefined) delete process.env.MARBLE_GUEST_RELEASE;
    else process.env.MARBLE_GUEST_RELEASE = before;
  });
  delete process.env.MARBLE_GUEST_RELEASE;
  assert.equal((await (await fetch(`${base}/health`)).json()).release, null, 'not a drive on the PC');
  process.env.MARBLE_GUEST_RELEASE = '20261025T161133Z-4b2103a';
  assert.equal((await (await fetch(`${base}/health`)).json()).release, '20261025T161133Z-4b2103a');

  const bearer = { authorization: 'Bearer pw-guest-1234' };
  assert.equal((await fetch(`${base}/health/deep`)).status, 401, 'the drive is closed to anyone else');
  const deep = await fetch(`${base}/health/deep`, { headers: bearer });
  assert.equal(deep.status, 200);
  const body = await deep.json();
  assert.equal(body.ok, true);
  assert.equal(body.claude.version, '2.1.281');
  assert.equal(body.codex.version, '0.159.3');
  assert.equal(body.docs, 0);
  assert.equal(body.agentConnected, false);
  for (const forwarded of [{ 'x-forwarded-for': '203.0.113.9' }, { 'x-forwarded-host': 'ana.marbledrive.app' }, { 'cf-ray': 'abc' }]) {
    const res = await fetch(`${base}/health/deep`, { headers: { ...bearer, ...forwarded } });
    assert.equal(res.status, 404, `through ${Object.keys(forwarded)[0]} it is not there`);
  }
  assert.equal((await fetch(`${base}/health/deep`, { method: 'POST', headers: bearer })).status !== 200, true);
});
