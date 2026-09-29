// tools/browser-tests.mjs runs browser tests on the owner's Mac when one is
// watching the sprite, and here otherwise; tools/test-runner.mjs is the Mac's
// half. Here the command runs from a throwaway checkout, the runner folder is a
// temp folder, and the test plays the Mac.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validRequest } from '../tools/test-runner.mjs';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'browser-tests.mjs');

async function checkout() {
  const repo = await fsp.mkdtemp(path.join(os.tmpdir(), 'bt-repo-'));
  await fsp.mkdir(path.join(repo, 'tools'));
  await fsp.mkdir(path.join(repo, 'test-browser'));
  await fsp.copyFile(TOOL, path.join(repo, 'tools', 'browser-tests.mjs'));
  await fsp.writeFile(path.join(repo, 'test-browser', 'ok.test.js'), "import test from 'node:test'; test('passes here', () => {});\n");
  await fsp.writeFile(path.join(repo, 'test-browser', 'fails.test.js'), "import test from 'node:test'; test('fails here', () => { throw new Error('no'); });\n");
  const runner = path.join(repo, 'runner');
  return { repo, runner };
}

function tool({ repo, runner }, files, env = {}) {
  const child = spawn(process.execPath, [path.join(repo, 'tools', 'browser-tests.mjs'), ...files], {
    cwd: repo,
    // Without the outer runner's NODE_TEST_CONTEXT, which would have the inner
    // `node --test` report to it rather than print.
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), MARBLE_RUNNER_DIR: runner, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out: () => out, err: () => err })));
  return { child, done, out: () => out };
}

const until = async (check, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

const checkIn = async (runner) => {
  await fsp.mkdir(runner, { recursive: true });
  await fsp.writeFile(path.join(runner, 'mac.json'), JSON.stringify({ host: 'bryans-mac' }));
};

test('with no Mac watching, the tests run here, one at a time, and their status is the exit status', async () => {
  const c = await checkout();
  const ok = await tool(c, ['test-browser/ok.test.js']).done;
  assert.equal(ok.code, 0);
  assert.match(ok.err(), /running 1 file here, one at a time/);
  assert.match(ok.out(), /passes here/);
  assert.equal((await tool(c, ['test-browser/fails.test.js']).done).code, 1);
});

test('only test files in test-browser/ can be asked for', async () => {
  const c = await checkout();
  await fsp.writeFile(path.join(c.repo, 'tools', 'evil.test.js'), '');
  for (const f of ['tools/evil.test.js', 'test-browser/../tools/evil.test.js', 'test-browser/missing.test.js', '/etc/passwd']) {
    const r = await tool(c, [f]).done;
    assert.equal(r.code, 2, f);
  }
});

test('with a Mac watching, the run is handed over and its output comes back as it is written', async () => {
  const c = await checkout();
  await checkIn(c.runner);
  const t = tool(c, ['test-browser/ok.test.js']);
  // The Mac takes the request, as tools/test-runner.mjs does.
  const name = await until(async () => (await fsp.readdir(path.join(c.runner, 'requests')).catch(() => [])).find((n) => n.endsWith('.json')));
  const req = JSON.parse(await fsp.readFile(path.join(c.runner, 'requests', name), 'utf8'));
  assert.deepEqual(req.files, ['test-browser/ok.test.js']);
  assert.equal(req.checkout, fs.realpathSync(c.repo));
  await fsp.mkdir(path.join(c.runner, 'running'), { recursive: true });
  await fsp.rename(path.join(c.runner, 'requests', name), path.join(c.runner, 'running', name));
  await fsp.appendFile(path.join(c.runner, 'out', `${req.id}.log`), 'first part\n');
  assert.ok(await until(() => t.out().includes('first part')), 'streamed before the run ended');
  await checkIn(c.runner);
  await fsp.appendFile(path.join(c.runner, 'out', `${req.id}.log`), 'second part\n');
  await fsp.writeFile(path.join(c.runner, 'out', `${req.id}.status`), JSON.stringify({ code: 3, host: 'bryans-mac' }));
  const r = await t.done;
  assert.equal(r.code, 3, "the Mac's status");
  assert.equal(r.out(), 'first part\nsecond part\n');
  assert.match(r.err(), /handed to bryans-mac/);
});

test('a Mac that does not take the run in time: it runs here instead, and the request is withdrawn', async () => {
  const c = await checkout();
  await checkIn(c.runner);
  const r = await tool(c, ['test-browser/ok.test.js'], { MARBLE_RUNNER_TAKE_SECONDS: '1' }).done;
  assert.equal(r.code, 0);
  assert.match(r.err(), /did not take the run within 1s[\s\S]*running 1 file here/);
  assert.deepEqual(await fsp.readdir(path.join(c.runner, 'requests')), []);
});

test('a Mac that goes quiet mid-run: it is told to stop, and the run happens here', async () => {
  const c = await checkout();
  await checkIn(c.runner);
  const t = tool(c, ['test-browser/ok.test.js'], { MARBLE_RUNNER_GONE_SECONDS: '1' });
  const name = await until(async () => (await fsp.readdir(path.join(c.runner, 'requests')).catch(() => [])).find((n) => n.endsWith('.json')));
  await fsp.mkdir(path.join(c.runner, 'running'), { recursive: true });
  await fsp.rename(path.join(c.runner, 'requests', name), path.join(c.runner, 'running', name));
  const r = await t.done;
  assert.equal(r.code, 0);
  assert.match(r.err(), /went quiet[\s\S]*running 1 file here/);
  assert.deepEqual(await fsp.readdir(path.join(c.runner, 'cancel')), [name.replace(/\.json$/, '')]);
});

test('an old check-in is no Mac at all', async () => {
  const c = await checkout();
  await checkIn(c.runner);
  const old = new Date(Date.now() - 10 * 60_000);
  await fsp.utimes(path.join(c.runner, 'mac.json'), old, old);
  const r = await tool(c, ['test-browser/ok.test.js']).done;
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.err(), /handed/);
});

test('the Mac runs only what looks like a browser test run', () => {
  const ok = { id: '20260929T021500-0a1b2c3d', checkout: '/home/sprite/src/md-shell', files: ['test-browser/drive.test.js', 'test-browser/sub/x.test.js'] };
  assert.equal(validRequest(ok), true);
  const bad = [
    null,
    { ...ok, id: '../../x' },
    { ...ok, checkout: '/home/sprite/src/../.ssh' },
    { ...ok, checkout: '/home/sprite/src/..' },
    { ...ok, checkout: '/etc' },
    { ...ok, checkout: '/home/sprite/src/a/b' },
    { ...ok, files: [] },
    { ...ok, files: ['test-browser/../../x.test.js'] },
    { ...ok, files: ['tools/x.test.js'] },
    { ...ok, files: ['test-browser/x.js'] },
    { ...ok, files: ['test-browser/x.test.js; rm -rf ~'] },
    { ...ok, files: ['--require=/tmp/evil.js'] },
  ];
  for (const req of bad) assert.equal(validRequest(req), false, JSON.stringify(req));
});
