// Every console action is a job: its output streamed and kept, secrets never
// in it, one at a time per drive, stoppable, and still there after a restart.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createJobs } from '../server/console/jobs.js';

const node = process.execPath;
const setup = async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jobs-'));
  const events = [];
  const jobs = createJobs({ dir, onEvent: (e) => events.push(e) });
  await jobs.ready();
  return { dir, jobs, events };
};
const settle = async (jobs, id) => {
  for (let i = 0; i < 300; i += 1) {
    const job = jobs.get(id);
    if (job && job.state !== 'running') return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job never settled');
};

test('a job runs its steps, streams what they print, and keeps it', async () => {
  const { jobs, events, dir } = await setup();
  const job = jobs.start({ kind: 'deploy', title: 'Deploy x to t-sam', target: 't-sam', run: async (ctx) => {
    ctx.say('starting');
    await ctx.exec(node, ['-e', 'console.log("one"); console.error("two")']);
  } });
  assert.equal(job.state, 'running');
  const done = await settle(jobs, job.id);
  assert.equal(done.state, 'done');
  assert.ok(done.endedAt >= done.startedAt);
  const out = await jobs.output(job.id);
  assert.match(out, /starting\n/);
  assert.match(out, /one\n/);
  assert.match(out, /two\n/);
  assert.ok(events.some((e) => e.type === 'output' && e.id === job.id));
  assert.ok(events.some((e) => e.type === 'job' && e.job.state === 'done'));
  assert.match(await fsp.readFile(path.join(dir, `${job.id}.log`), 'utf8'), /one/);
});

test('a secret is never in the output, even split across two writes', async () => {
  const { jobs } = await setup();
  const job = jobs.start({ kind: 'settings', title: 't', target: 't-sam', run: async (ctx) => {
    ctx.secret('hunter2-pass');
    await ctx.exec(node, ['-e', 'process.stdout.write("pass is hunt"); setTimeout(() => process.stdout.write("er2-pass ok\\n"), 30)']);
  } });
  await settle(jobs, job.id);
  const out = await jobs.output(job.id);
  assert.ok(!out.includes('hunter2'), out);
  assert.match(out, /pass is •••• ok/);
});

test('a drive with a job running refuses a second, and a failing step fails the job', async () => {
  const { jobs } = await setup();
  const first = jobs.start({ kind: 'deploy', title: 'a', target: 't-sam', run: (ctx) => ctx.exec(node, ['-e', 'setTimeout(() => process.exit(3), 150)']) });
  assert.throws(() => jobs.start({ kind: 'deploy', title: 'b', target: 't-sam', run: async () => {} }), (err) => err.status === 409 && /t-sam is busy/.test(err.message));
  const other = jobs.start({ kind: 'deploy', title: 'c', target: 't-irene', run: async () => {} });
  assert.equal((await settle(jobs, other.id)).state, 'done');
  const failed = await settle(jobs, first.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /exited 3/);
});

test('stopping a job ends what it is running', async () => {
  const { jobs } = await setup();
  const job = jobs.start({ kind: 'test', title: 't', target: 'marble-drive', run: (ctx) => ctx.exec(node, ['-e', 'setInterval(() => {}, 1000)']) });
  await new Promise((r) => setTimeout(r, 150));
  jobs.cancel(job.id);
  const done = await settle(jobs, job.id);
  assert.equal(done.state, 'stopped');
});

test('after a restart the jobs are listed, and one that was running says it was cut off', async () => {
  const { jobs, dir } = await setup();
  const job = jobs.start({ kind: 'deploy', title: 'long', target: 't-sam', run: (ctx) => ctx.exec(node, ['-e', 'setInterval(() => {}, 1000)']) });
  await new Promise((r) => setTimeout(r, 100));
  const again = createJobs({ dir });
  await again.ready();
  const listed = again.list().find((j) => j.id === job.id);
  assert.equal(listed.state, 'interrupted');
  jobs.cancel(job.id);
});

test('a secret known only by where it is printed is masked there', async () => {
  const { jobs } = await setup();
  const job = jobs.start({ kind: 'provision', title: 't', target: 't-new', run: async (ctx) => {
    ctx.mask(/(passphrase: )\S+/);
    await ctx.exec(node, ['-e', 'console.log("  passphrase: Zx81kQ")']);
  } });
  await settle(jobs, job.id);
  const out = await jobs.output(job.id);
  assert.match(out, /passphrase: ••••/);
  assert.ok(!out.includes('Zx81kQ'));
});
