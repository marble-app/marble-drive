// The registry (server/host/registry.js): registry.json is written whole and
// atomically, a write that fails changes nothing, a file that cannot be read
// stops marble-host rather than being taken for an empty one, and
// events.jsonl is newest first and trimmed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { atomicWrite, openRegistry } from '../server/host/registry.js';

const scratch = () => fsp.mkdtemp(path.join(os.tmpdir(), 'host-registry-'));

test('an update is written, survives a reopen, and leaves no temporary file', async () => {
  const dir = await scratch();
  const r = await openRegistry({ dir });
  assert.deepEqual(r.drives(), []);
  assert.deepEqual(r.channels(), { canary: null, everyone: null });
  const got = await r.update((d) => {
    d.drives.ana = { name: 'ana', port: 4500, state: 'running' };
    return 'done';
  });
  assert.equal(got, 'done');
  assert.deepEqual(await fsp.readdir(dir), ['registry.json']);
  assert.equal((await fsp.stat(r.file)).mode & 0o777, 0o600);
  const again = await openRegistry({ dir });
  assert.deepEqual(again.drive('ana'), { name: 'ana', port: 4500, state: 'running' });
  assert.equal(again.drive('bob'), null);
  // What it hands out is a copy.
  again.drive('ana').state = 'scribbled';
  assert.equal(again.drive('ana').state, 'running');
});

test('a write that fails changes nothing, in memory or on disk', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root writes through a read-only folder');
  const dir = await scratch();
  const r = await openRegistry({ dir });
  await r.update((d) => {
    d.drives.ana = { name: 'ana', port: 4500, state: 'running' };
  });
  const before = await fsp.readFile(r.file, 'utf8');
  await fsp.chmod(dir, 0o500);
  t.after(() => fsp.chmod(dir, 0o700));
  await assert.rejects(r.update((d) => {
    d.drives.ana.state = 'suspended';
  }));
  assert.equal(r.drive('ana').state, 'running');
  assert.equal(await fsp.readFile(r.file, 'utf8'), before);
  // An update whose own work throws changes nothing either.
  await fsp.chmod(dir, 0o700);
  await assert.rejects(r.update((d) => {
    d.drives.ana.state = 'removed';
    throw new Error('changed my mind');
  }), /changed my mind/);
  assert.equal(r.drive('ana').state, 'running');
});

test('the file is always whole: read while many writes land, it always parses', async () => {
  const dir = await scratch();
  const r = await openRegistry({ dir });
  const padding = 'x'.repeat(20_000);
  let reading = true;
  let reads = 0;
  const reader = (async () => {
    while (reading) {
      try {
        JSON.parse(fs.readFileSync(r.file, 'utf8'));
        reads += 1;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
  await Promise.all(Array.from({ length: 40 }, (_, i) => r.update((d) => {
    d.drives[`d${i}`] = { name: `d${i}`, port: 4500 + i, padding };
  })));
  reading = false;
  await reader;
  assert.ok(reads > 0);
  assert.equal(r.drives().length, 40, 'one change at a time, none lost');
});

test('a registry that cannot be read stops marble-host instead of being taken for an empty one', async (t) => {
  const dir = await scratch();
  await fsp.writeFile(path.join(dir, 'registry.json'), '{"drives": {"ana": ');
  await assert.rejects(openRegistry({ dir }), /registry\.json cannot be read .*marble-host will not start without it/);
  if (process.getuid?.() === 0) return t.skip('root reads a file whatever its mode');
  const other = await scratch();
  await fsp.writeFile(path.join(other, 'registry.json'), '{}', { mode: 0o000 });
  await assert.rejects(openRegistry({ dir: other }), /cannot be read/);
});

test('atomicWrite replaces a file in one step, with the mode asked for', async () => {
  const dir = await scratch();
  const file = path.join(dir, 'x.env');
  await atomicWrite(file, 'A=1\n', 0o600);
  await atomicWrite(file, 'A=2\n', 0o600);
  assert.equal(await fsp.readFile(file, 'utf8'), 'A=2\n');
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await fsp.readdir(dir), ['x.env']);
  await assert.rejects(atomicWrite(path.join(dir, 'missing', 'y'), 'x'));
  assert.deepEqual(await fsp.readdir(dir), ['x.env']);
});

test('events are newest first, limited, and trimmed to the last few thousand', async () => {
  const dir = await scratch();
  let n = 0;
  const r = await openRegistry({ dir, keepEvents: 5, now: () => `t${(n += 1)}` });
  for (let i = 0; i < 12; i += 1) await r.event('ana', 'restarted', { i });
  await r.event(null, 'alert', { kind: 'disk' });
  const all = await r.events(100);
  assert.ok(all.length <= 10, `trimmed (${all.length})`);
  assert.deepEqual(all[0], { at: 't13', drive: null, kind: 'alert', detail: { kind: 'disk' } });
  assert.equal(all[1].detail.i, 11);
  assert.deepEqual((await r.events(2)).map((e) => e.kind), ['alert', 'restarted']);
  const lines = (await fsp.readFile(r.eventsFile, 'utf8')).trim().split('\n');
  assert.ok(lines.length <= 10);
  assert.equal((await fsp.stat(r.eventsFile)).mode & 0o777, 0o600);
});
