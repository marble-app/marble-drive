// The console's actions, run against a fake fleet and fake tools: what each
// runs, in what order, with what it refuses, and that no secret reaches a log.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createActions, slug } from '../server/console/actions.js';
import { createInspector } from '../server/console/inspect.js';
import { createJobs } from '../server/console/jobs.js';
import { createSprites } from '../server/console/sprites.js';
import { createWorkshop } from '../server/console/workshop.js';
import { fakeFleet, probe } from './fixtures/console-fleet.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const DEPLOY = `#!/usr/bin/env bash
echo "$(basename "$(dirname "$(dirname "$0")")") $*" >> "$FAKE_TOOL_LOG"
for a in "$@"; do [[ $a == --print-plan ]] && { printf 'target: %s\\nrelease: R\\nsource: S\\nmarble: @bdhmin/marble@0.2.1\\nclaude: 2.1.281\\n' "$1"; exit 0; }; done
if [[ " $* " == *" $FAKE_STUCK "* && " $* " != *" --no-checkpoint "* ]]; then echo "✗ Failed to create checkpoint: JuiceFS rename clone: file exists"; exit 1; fi
if [[ -n "$FAKE_FAIL" && " $* " == *" $FAKE_FAIL "* ]]; then echo "boom"; exit 1; fi
echo "==> done: live on $1"
`;
const PROVISION = `#!/usr/bin/env bash
echo "$(basename "$(dirname "$(dirname "$0")")") provision $*" >> "$FAKE_TOOL_LOG"
if [[ $1 == --remove ]]; then read -r typed; echo "typed $typed" >> "$FAKE_TOOL_LOG"; exit 0; fi
for a in "$@"; do [[ -f "$a" ]] && echo "key file holds $(cat "$a")" >> "$FAKE_TOOL_LOG"; done
echo "  https://t-new-b3fwm.sprites.app"
echo "  passphrase: Zq8TopSecretPass"
`;

async function world(fleetState = {}, envExtra = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-actions-'));
  const src = path.join(root, 'src');
  await fsp.mkdir(src);
  const bare = path.join(root, 'md.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(src, 'clone', '-q', bare, 'marble-drive');
  const md = path.join(src, 'marble-drive');
  git(md, 'checkout', '-q', '-b', 'main');
  await fsp.mkdir(path.join(md, 'tools', 'sprite'), { recursive: true });
  await fsp.writeFile(path.join(md, 'tools', 'sprite-deploy.sh'), DEPLOY, { mode: 0o755 });
  await fsp.writeFile(path.join(md, 'tools', 'sprite-provision.sh'), PROVISION, { mode: 0o755 });
  await fsp.writeFile(path.join(md, 'package.json'), '{}');
  git(md, 'add', '.');
  git(md, 'commit', '-q', '-m', 'first');
  git(md, 'push', '-q', '-u', 'origin', 'main');
  const sha = git(md, 'rev-parse', 'HEAD');

  const fleet = await fakeFleet({
    probe: Object.fromEntries(['admin-p1', 't-bryan', 't-irene', 't-peiling', 't-sam', 't-sangho'].map((n) => [n, probe(n)])),
    ...fleetState,
  });
  const toolLog = path.join(root, 'tools.log');
  const stateDir = path.join(root, 'state');
  const sprites = createSprites({ bin: fleet.bin, org: 'marble-drive' });
  const inspector = createInspector({ sprites, dir: path.join(stateDir, 'sprites') });
  const jobs = createJobs({ dir: path.join(stateDir, 'jobs') });
  await jobs.ready();
  const make = () => createActions({
    sprites, inspector, jobs,
    workshop: createWorkshop({ src, npmVersion: async () => '0.2.1', npmUser: async () => 'owner' }),
    src, self: 'admin-p1', stateDir,
    env: { ...process.env, FAKE_TOOL_LOG: toolLog, ...envExtra },
  });
  const tools = async () => (await fsp.readFile(toolLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { root, src, md, sha, fleet, jobs, inspector, actions: make(), make, tools, stateDir };
}

const settle = async (jobs, job) => {
  for (let i = 0; i < 500; i += 1) {
    const now = jobs.get(job.id);
    if (now.state !== 'running') return now;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job never settled');
};

test('deploying main runs the deploy script from a checkout of main itself', async () => {
  const w = await world();
  const done = await settle(w.jobs, await w.actions.deploy('t-sam'));
  assert.equal(done.state, 'done', await w.jobs.output(done.id));
  assert.equal(done.result.sha, w.sha);
  assert.deepEqual(await w.tools(), [`marble-drive-ship t-sam --ref ${w.sha}`]);
  assert.equal(git(path.join(w.src, 'marble-drive-ship'), 'rev-parse', 'HEAD'), w.sha);
  assert.ok((await w.fleet.calls()).some((c) => c[0] === 'exec' && c.includes('t-sam')), 'it looked inside afterwards');
});

test('the workshop copy is deployed from the workshop checkout, --local', async () => {
  const w = await world();
  const done = await settle(w.jobs, await w.actions.deploy('t-bryan', { source: 'workshop' }));
  assert.equal(done.state, 'done');
  assert.deepEqual(await w.tools(), ['marble-drive t-bryan --local']);
});

test('a stuck checkpoint store is retried without one, remembered, and said', async () => {
  const w = await world({}, { FAKE_STUCK: 't-irene' });
  const first = await settle(w.jobs, await w.actions.deploy('t-irene'));
  assert.equal(first.state, 'done');
  assert.deepEqual(await w.tools(), [`marble-drive-ship t-irene --ref ${w.sha}`, `marble-drive-ship t-irene --ref ${w.sha} --no-checkpoint`]);
  assert.match(await w.jobs.output(first.id), /cannot make a checkpoint/);
  const again = w.make();
  assert.deepEqual(again.stuck(), ['t-irene'], 'remembered across a restart');
  await settle(w.jobs, await again.deploy('t-irene'));
  assert.equal((await w.tools()).at(-1), `marble-drive-ship t-irene --ref ${w.sha} --no-checkpoint`);
  await again.clearStuck('t-irene');
  assert.deepEqual(again.stuck(), []);
});

test('shipping goes to t-bryan first, the other users, then admin-p1, and carries on past a failure', async () => {
  const w = await world({}, { FAKE_FAIL: 't-sam' });
  assert.deepEqual(await w.actions.shipTargets(), ['t-bryan', 't-irene', 't-peiling', 't-sam', 't-sangho', 'admin-p1']);
  const done = await settle(w.jobs, await w.actions.ship());
  assert.equal(done.state, 'failed');
  assert.match(done.error, /t-sam did not take/);
  assert.deepEqual((await w.tools()).map((l) => l.split(' ')[1]), ['t-bryan', 't-irene', 't-peiling', 't-sam', 't-sangho', 'admin-p1']);
  await assert.rejects(w.actions.deploy('t-sam').then(() => w.actions.ship()), /busy/);
});

test('the plan says what a ship would be before it is one', async () => {
  const w = await world();
  const plan = await w.actions.plan();
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.sha, w.sha);
  assert.equal(plan.marble, '@bdhmin/marble@0.2.1');
  assert.equal(plan.claude, '2.1.281');
  assert.deepEqual(plan.targets, ['t-bryan', 't-irene', 't-peiling', 't-sam', 't-sangho', 'admin-p1']);
});

const ENV = '# t-sam\nMARBLE_DRIVE_SECRET=hushhush-sam\nMARBLE_DRIVE_AGENT_PROVIDER=claude-api\n';

test('a settings change rewrites sprite.env from a fresh read, applies it, and logs no secret', async () => {
  // The restart echoes the settings back, as a failing service's log would.
  const echo = { stdout: `==> service env: ${ENV.replace(/\n/g, ' ')}\n` };
  const w = await world({ exec: { 't-sam': { cat: { stdout: ENV }, '/home/sprite/app/release.sh': echo }, 'admin-p1': { cat: { stdout: ENV } } } });
  const done = await settle(w.jobs, await w.actions.settings('t-sam', { set: { MARBLE_DRIVE_AWAKE_MAX_HOURS: '12' } }));
  assert.equal(done.state, 'done', await w.jobs.output(done.id));
  const up = (await w.fleet.uploads()).find((c) => c.files['/tmp/marble-console-sprite.env'] !== undefined);
  assert.equal(up.files['/tmp/marble-console-sprite.env'], `${ENV}MARBLE_DRIVE_AWAKE_MAX_HOURS=12\n`);
  assert.ok(up.files['/home/sprite/app/release.sh'].includes('apply-when-idle'), 'the release script that knows apply goes with it');
  const calls = await w.fleet.calls();
  assert.ok(calls.some((c) => c.at(-1) === 'apply' && c.includes('t-sam')));
  assert.ok(!(await w.jobs.output(done.id)).includes('hushhush'));

  const own = await settle(w.jobs, await w.actions.settings('admin-p1', { set: { MARBLE_DRIVE_AWAKE_MAX_HOURS: '8' } }));
  assert.equal(own.state, 'done');
  assert.ok((await w.fleet.calls()).some((c) => c.at(-1) === 'apply-when-idle' && c.includes('admin-p1')), 'admin-p1 restarts when no agent is working');

  assert.throws(() => w.actions.settings('t-sam', { unset: ['MARBLE_DRIVE_SECRET'] }), /passphrase/);
  assert.throws(() => w.actions.settings('t-sam', { set: { X: 'a,b' } }), /comma/);
});

test('a new passphrase is made here, written there, and never printed', async () => {
  const w = await world({ exec: { 't-sam': { cat: { stdout: ENV } } } });
  const done = await settle(w.jobs, await w.actions.newPassphrase('t-sam'));
  assert.equal(done.state, 'done');
  const written = (await w.fleet.uploads()).find((c) => c.files['/tmp/marble-console-sprite.env']).files['/tmp/marble-console-sprite.env'];
  const pass = /MARBLE_DRIVE_SECRET=(\w+)/.exec(written)[1];
  assert.equal(pass.length, 24);
  assert.notEqual(pass, 'hushhush-sam');
  const out = await w.jobs.output(done.id);
  assert.ok(!out.includes(pass) && !out.includes('hushhush'));
});

test('Claude login or key is set through the drive\'s own host, with its passphrase, which no log shows', async () => {
  const w = await world();
  const done = await settle(w.jobs, await w.actions.claude('t-irene', 'login'));
  assert.equal(done.state, 'done', await w.jobs.output(done.id));
  const up = (await w.fleet.uploads()).find((c) => c.files['/tmp/marble-console-payload.json']);
  assert.deepEqual(JSON.parse(up.files['/tmp/marble-console-payload.json']), { secret: 'pass-t-irene', settings: { claudeAuth: 'login' } });
  assert.ok(up.files['/tmp/marble-console-settings.mjs'].includes('/agent/settings'));
  assert.ok(!(await w.jobs.output(done.id)).includes('pass-t-irene'));
  assert.throws(() => w.actions.claude('t-irene', 'both'), /login or api/);
});

test('restore asks for the name, never restores admin-p1, and only to a checkpoint that exists', async () => {
  const w = await world({ checkpoints: { 't-sam': [{ id: 'v3', create_time: '2026-09-24T00:00:00Z', comment: 'x' }] } });
  await assert.rejects(w.actions.restore('t-sam', 'v3', 't-sa'), /type t-sam/);
  await assert.rejects(w.actions.restore('admin-p1', 'v3', 'admin-p1'), /not restored/);
  await assert.rejects(w.actions.restore('t-sam', 'v9', 't-sam'), /no checkpoint v9/);
  const done = await settle(w.jobs, await w.actions.restore('t-sam', 'v3', 't-sam'));
  assert.equal(done.state, 'done');
  assert.ok((await w.fleet.calls()).some((c) => c.join(' ') === 'restore v3 -o marble-drive -s t-sam'));
});

test('removing is for testers only, and types the name the way a person would', async () => {
  const w = await world();
  await assert.rejects(w.actions.remove('admin-p1', 'admin-p1'), /not a tester/);
  await assert.rejects(w.actions.remove('t-peiling', 'nope'), /type t-peiling/);
  const done = await settle(w.jobs, await w.actions.remove('t-peiling', 't-peiling'));
  assert.equal(done.state, 'done');
  assert.deepEqual(await w.tools(), ['marble-drive provision --remove peiling', 'typed t-peiling']);
});

test('a new drive masks the passphrase the tool prints, and hands the key over as a file', async () => {
  const w = await world();
  assert.equal(slug('  Jo Ann! '), 'jo-ann');
  await assert.rejects(w.actions.provision({ person: 'Sam' }), /t-sam already exists/);
  await assert.rejects(w.actions.provision({ person: 'Nia', key: 'hello' }), /Anthropic API key/);
  const done = await settle(w.jobs, await w.actions.provision({ person: 'Nia', agent: 'api', key: 'sk-ant-test-key-123' }));
  assert.equal(done.state, 'done', await w.jobs.output(done.id));
  const out = await w.jobs.output(done.id);
  assert.match(out, /passphrase: ••••/);
  assert.ok(!out.includes('Zq8TopSecretPass') && !out.includes('sk-ant-test-key-123'));
  const log = await w.tools();
  assert.match(log[0], /^marble-drive-ship provision Nia --agent api --key-file /);
  assert.equal(log[1], 'key file holds sk-ant-test-key-123');
});

test('admin-p1 stays private', async () => {
  const w = await world();
  assert.throws(() => w.actions.access('admin-p1', 'public'), /stays private/);
  const done = await settle(w.jobs, await w.actions.access('t-sam', 'private'));
  assert.equal(done.state, 'done');
  assert.ok((await w.fleet.calls()).some((c) => c.join(' ') === 'config update --url-auth sprite -o marble-drive -s t-sam'));
});

// Publishing marble: the version and both plugin manifests move together (the
// package's own test holds them to it), the release is committed, tagged and
// pushed before npm is asked (marble's prepublish guard wants it pushed), and
// marble-drive is left alone: it depends on ../marble, and a deploy installs
// whatever version that checkout declares.
async function publishWorld({ npm: behaviour = {} } = {}) {
  const w = await world();
  const bare = path.join(w.root, 'marble.git');
  git(w.root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(w.src, 'clone', '-q', bare, 'marble');
  const marble = path.join(w.src, 'marble');
  git(marble, 'checkout', '-q', '-b', 'main');
  await fsp.mkdir(path.join(marble, '.claude-plugin'));
  await fsp.writeFile(path.join(marble, 'package.json'), `${JSON.stringify({ name: '@bdhmin/marble', version: '0.2.2' }, null, 2)}\n`);
  await fsp.writeFile(path.join(marble, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'marble', version: '0.2.2' }, null, 2)}\n`);
  await fsp.writeFile(path.join(marble, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({ plugins: [{ name: 'marble', version: '0.2.2' }] }, null, 2)}\n`);
  git(marble, 'add', '.');
  git(marble, 'commit', '-q', '-m', 'first');
  git(marble, 'push', '-q', '-u', 'origin', 'main');
  const bin = path.join(w.root, 'bin');
  await fsp.mkdir(bin);
  const state = path.join(w.root, 'npm.json');
  await fsp.writeFile(state, JSON.stringify({ published: '0.2.2', user: 'owner', publish: 'ok', ...behaviour }));
  // A stand-in npm. `version patch --no-git-tag-version` bumps package.json;
  // `whoami`, `view` and `publish` answer from npm.json, the way the real one
  // would for a signed-in, signed-out or refusing registry.
  await fsp.writeFile(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
fs.appendFileSync(process.env.FAKE_TOOL_LOG, 'npm ' + a.join(' ') + '\\n');
if (a[0] === 'whoami') { if (st.user) console.log(st.user); else { console.error('npm error code E401'); process.exit(1); } }
if (a[0] === 'view') console.log(st.published);
if (a[0] === 'version') {
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const v = p.version.split('.').map(Number); v[2] += 1; p.version = v.join('.');
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\\n');
  console.log('v' + p.version);
}
if (a[0] === 'publish') {
  if (st.publish === 'e404') { console.error('npm error code E404\\nnpm error 404 Not Found - PUT https://registry.npmjs.org/@bdhmin%2fmarble - Not found'); process.exit(1); }
  if (st.publish === 'approve') console.log('Authenticate your account at:\\nhttps://www.npmjs.com/auth/cli/abc123');
  console.log('+ @bdhmin/marble@' + JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
}
`, { mode: 0o755 });
  const actions = createActions({
    sprites: createSprites({ bin: w.fleet.bin, org: 'marble-drive' }), inspector: w.inspector, jobs: w.jobs,
    workshop: createWorkshop({ src: w.src, npmVersion: async () => '0.2.2', npmUser: async () => 'owner' }),
    src: w.src, self: 'admin-p1', stateDir: w.stateDir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_TOOL_LOG: path.join(w.root, 'tools.log') },
  });
  const npmSet = async (over) => fsp.writeFile(state, JSON.stringify({ ...JSON.parse(await fsp.readFile(state, 'utf8')), ...over }));
  const npmCalls = async () => (await w.tools()).filter((l) => l.startsWith('npm ')).map((l) => l.split(' ')[1]);
  return { ...w, bare, marble, actions, npmSet, npmCalls };
}

test('publishing marble checks first, then bumps the version and its manifests, pushes, then publishes, and leaves marble-drive alone', async () => {
  const w = await publishWorld({ npm: { publish: 'approve' } });
  const mdBefore = git(w.md, 'rev-parse', 'HEAD');
  const done = await settle(w.jobs, w.actions.publish());
  assert.equal(done.state, 'done', await w.jobs.output(done.id));
  assert.equal(done.result.version, '0.2.3');
  const read = async (f) => JSON.parse(await fsp.readFile(path.join(w.marble, f), 'utf8'));
  assert.equal((await read('.claude-plugin/plugin.json')).version, '0.2.3');
  assert.equal((await read('.claude-plugin/marketplace.json')).plugins[0].version, '0.2.3');
  assert.equal(git(w.marble, 'status', '--porcelain'), '', 'all of it committed');
  assert.equal(git(w.marble, 'log', '-1', '--format=%s'), 'marble 0.2.3');
  assert.equal(git(w.marble, 'rev-parse', 'v0.2.3^{commit}'), git(w.marble, 'rev-parse', 'HEAD'), 'tagged');
  assert.equal(git(w.bare, 'rev-parse', 'main'), git(w.marble, 'rev-parse', 'HEAD'), 'pushed before publishing');
  assert.equal(git(w.bare, 'rev-parse', 'v0.2.3^{commit}'), git(w.marble, 'rev-parse', 'HEAD'), 'and the tag with it');
  assert.equal(git(w.bare, 'cat-file', '-t', 'v0.2.3'), 'tag', 'annotated, so it is a release and not a bookmark');
  assert.deepEqual(await w.npmCalls(), ['whoami', 'view', 'version', 'publish'], 'no separate full test run: prepublishOnly runs the guard and unit tests');
  assert.deepEqual(done.steps.map((s) => [s.name, s.state]), [
    ['Check this copy has no loose edits', 'done'],
    ['Get the latest from GitHub', 'done'],
    ['Check this machine is signed in to npm', 'done'],
    ['Make version 0.2.3', 'done'],
    ['Push it to GitHub', 'done'],
    ['Test and upload 0.2.3 to npm', 'done'],
  ]);
  assert.deepEqual(done.links, [{ url: 'https://www.npmjs.com/auth/cli/abc123', label: 'Approve on npmjs.com' }]);
  assert.equal(git(w.md, 'rev-parse', 'HEAD'), mdBefore, 'marble-drive untouched');
});

test('signed out of npm, publishing stops before it changes anything, and says to sign in', async () => {
  const w = await publishWorld({ npm: { user: null } });
  const before = git(w.marble, 'rev-parse', 'HEAD');
  const done = await settle(w.jobs, w.actions.publish());
  assert.equal(done.state, 'failed');
  assert.equal(done.fix, 'npm-login');
  assert.match(done.error, /not signed in to npm.*Nothing was changed/);
  assert.equal(done.steps.at(-1).state, 'failed');
  assert.equal(git(w.marble, 'rev-parse', 'HEAD'), before, 'no version made');
  assert.deepEqual(await w.npmCalls(), ['whoami']);
});

test('an upload npm refuses leaves the version made; pressing again uploads it rather than making another', async () => {
  const w = await publishWorld({ npm: { publish: 'e404' } });
  const failed = await settle(w.jobs, w.actions.publish());
  assert.equal(failed.state, 'failed');
  assert.equal(failed.fix, 'npm-login', 'a 404 on the upload is npm not knowing who this is');
  assert.match(failed.error, /0\.2\.3 is committed and pushed/);
  assert.equal(git(w.bare, 'rev-parse', 'main'), git(w.marble, 'rev-parse', 'HEAD'));

  await w.npmSet({ publish: 'ok' });
  const finished = await settle(w.jobs, w.actions.publish());
  assert.equal(finished.state, 'done', await w.jobs.output(finished.id));
  assert.equal(finished.result.version, '0.2.3', 'finished, not 0.2.4');
  assert.equal(git(w.marble, 'log', '-1', '--format=%s'), 'marble 0.2.3');
  assert.ok(!finished.steps.some((s) => /Make version/.test(s.name)));
  assert.match(await w.jobs.output(finished.id), /0\.2\.3 was made before and never reached npm/);
});

test('signing in to npm opens npm’s own page and checks who it is afterwards', async () => {
  const w = await publishWorld({ npm: { user: null } });
  await fsp.appendFile(path.join(w.root, 'bin', 'npm'), `
if (a[0] === 'login') { console.log('Login at:\\nhttps://www.npmjs.com/login?next=/login/cli/xyz'); const s = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(w.root, 'npm.json'))}, 'utf8')); s.user = 'owner'; fs.writeFileSync(${JSON.stringify(path.join(w.root, 'npm.json'))}, JSON.stringify(s)); }
`);
  const done = await settle(w.jobs, w.actions.npmLogin());
  assert.equal(done.state, 'done', await w.jobs.output(done.id));
  assert.deepEqual(done.result, { user: 'owner' });
  assert.deepEqual(done.links, [{ url: 'https://www.npmjs.com/login?next=/login/cli/xyz', label: 'Sign in on npmjs.com' }]);
  assert.deepEqual(await w.npmCalls(), ['login', 'whoami']);
});
