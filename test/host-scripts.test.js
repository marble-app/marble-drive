// The PC's scripts (linux/pc-host): each parses; install.sh installs into a
// folder standing in for / with a stand-in systemctl, runs install.d's pieces
// in order, again without harm, and takes it all away but the drives'
// folders; the polkit rule lets the owner manage the guests' units and
// nothing else; run-guest sets a drive up, supervises node and passes a stop
// on; and tunnel.sh and host.sh refuse before touching systemd or Cloudflare.
// Nothing here runs as root, starts a unit, or reaches outside 127.0.0.1.
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { listen } from './fixtures/host.js';

const DIR = path.resolve(import.meta.dirname, '../linux/pc-host');
const REPO = path.resolve(import.meta.dirname, '..');
const ME = os.userInfo().username;
const asRoot = process.getuid?.() === 0;

const mode = (p) => fs.statSync(p).mode & 0o777;
const scratch = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));

function sh(script, args, env = {}) {
  return new Promise((resolve) => {
    execFile('bash', [script, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ status: error ? error.code : 0, stdout, stderr });
    });
  });
}

test('every script parses', () => {
  for (const name of ['install.sh', 'host.sh', 'tunnel.sh', 'run-guest', ...fs.readdirSync(path.join(DIR, 'install.d')).filter((f) => f.endsWith('.sh')).map((f) => `install.d/${f}`)]) {
    const res = spawnSync('bash', ['-n', path.join(DIR, name)], { encoding: 'utf8' });
    assert.equal(res.status, 0, `${name}: ${res.stderr}`);
  }
});

/** A root to install into, a systemctl that writes down what it is asked,
 *  and two pieces in an install.d of their own that say how they were run. */
async function installRig({ version = '259' } = {}) {
  const root = await scratch('pc-install-');
  const bin = path.join(root, 'bin');
  await fsp.mkdir(bin);
  const calls = path.join(root, 'systemctl.log');
  const systemctl = path.join(bin, 'systemctl');
  await fsp.writeFile(systemctl, `#!/usr/bin/env bash\necho "$*" >> '${calls}'\n[[ $1 == --version ]] && echo "systemd ${version} (${version}.5-0ubuntu3.4)"\nexit 0\n`, { mode: 0o755 });
  const pieces = path.join(root, 'pieces');
  await fsp.mkdir(pieces);
  const said = path.join(root, 'pieces.log');
  for (const name of ['20-second.sh', '10-first.sh']) {
    await fsp.writeFile(path.join(pieces, name), `echo "${name} \${1:-} OWNER=$OWNER OWNER_HOME=$OWNER_HOME OPT=$OPT ETC=$ETC RELEASE_DIR=$RELEASE_DIR ROOT=$MARBLE_INSTALL_ROOT" >> '${said}'\n`);
  }
  await fsp.writeFile(path.join(pieces, 'README'), 'not a piece\n');
  const env = { MARBLE_INSTALL_ROOT: root, MARBLE_SYSTEMCTL: systemctl, MARBLE_INSTALL_D: pieces };
  const lines = async (file) => (await fsp.readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  return { root, env, calls: () => lines(calls), said: () => lines(said), pieces };
}

test('install.sh: the units, the slice, the polkit rule for the owner, run-guest, and the two folders, then install.d in order', async (t) => {
  const r = await installRig();
  t.after(() => fsp.rm(r.root, { recursive: true, force: true }));
  const res = await sh(path.join(DIR, 'install.sh'), [ME], r.env);
  assert.equal(res.status, 0, res.stderr);
  const at = (p) => path.join(r.root, p);
  assert.equal(mode(at('etc/systemd/system/marble-guest@.service')), 0o644);
  assert.equal(fs.readFileSync(at('etc/systemd/system/marble-guest@.service'), 'utf8'), fs.readFileSync(path.join(DIR, 'marble-guest@.service'), 'utf8'));
  assert.equal(mode(at('etc/systemd/system/marble-guests.slice')), 0o644);
  const rule = fs.readFileSync(at('etc/polkit-1/rules.d/50-marble-host.rules'), 'utf8');
  assert.equal(mode(at('etc/polkit-1/rules.d/50-marble-host.rules')), 0o644);
  assert.ok(rule.includes(`subject.user !== "${ME}"`));
  assert.ok(!rule.includes('@OWNER@'));
  for (const d of ['opt/marble', 'opt/marble/bin', 'opt/marble/releases', 'opt/marble/ms-playwright']) assert.equal(mode(at(d)), 0o755, d);
  assert.equal(mode(at('opt/marble/bin/run-guest')), 0o755);
  assert.equal(mode(at('etc/marble-guests')), 0o700);
  assert.deepEqual(fs.readdirSync(at('opt/marble/releases')), [], 'no release copied');
  assert.deepEqual(await r.calls(), ['--version', 'daemon-reload']);
  const home = os.userInfo().homedir;
  assert.deepEqual(await r.said(), [
    `10-first.sh  OWNER=${ME} OWNER_HOME=${home} OPT=${at('opt/marble')} ETC=${at('etc/marble-guests')} RELEASE_DIR=${REPO} ROOT=${r.root}`,
    `20-second.sh  OWNER=${ME} OWNER_HOME=${home} OPT=${at('opt/marble')} ETC=${at('etc/marble-guests')} RELEASE_DIR=${REPO} ROOT=${r.root}`,
  ]);
  assert.match(res.stdout, /the escape check, yours to write/);
  assert.match(res.stdout, /host\.sh install/);

  // Again: the same, with nothing in the way.
  fs.chmodSync(at('etc/marble-guests'), 0o755);
  const again = await sh(path.join(DIR, 'install.sh'), [ME], r.env);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(mode(at('etc/marble-guests')), 0o700, 'put back as it must be');
  assert.equal((await r.said()).length, 4);
});

test('install.sh --uninstall: the guests stopped, install.d in reverse, everything taken away but the drives\' folders', async (t) => {
  const r = await installRig();
  t.after(() => fsp.rm(r.root, { recursive: true, force: true }));
  assert.equal((await sh(path.join(DIR, 'install.sh'), [ME], r.env)).status, 0);
  const kept = path.join(r.root, 'var/lib/private/marble-guests/ana/drive');
  await fsp.mkdir(kept, { recursive: true });
  await fsp.writeFile(path.join(kept, 'Notes.mrbl'), 'hers');
  await fsp.writeFile(path.join(r.root, 'etc/marble-guests/ana.env'), 'PORT=4500\n');
  const res = await sh(path.join(DIR, 'install.sh'), ['--uninstall', ME], r.env);
  assert.equal(res.status, 0, res.stderr);
  for (const gone of ['etc/systemd/system/marble-guest@.service', 'etc/systemd/system/marble-guests.slice', 'etc/polkit-1/rules.d/50-marble-host.rules', 'opt/marble', 'etc/marble-guests']) {
    assert.ok(!fs.existsSync(path.join(r.root, gone)), gone);
  }
  assert.equal(fs.readFileSync(path.join(kept, 'Notes.mrbl'), 'utf8'), 'hers');
  const calls = await r.calls();
  assert.ok(calls.includes('stop marble-guest@*.service'));
  assert.equal(calls.at(-1), 'daemon-reload');
  assert.deepEqual((await r.said()).slice(2).map((l) => l.split(' ').slice(0, 2).join(' ')), ['20-second.sh --uninstall', '10-first.sh --uninstall']);
  assert.match(res.stdout, /kept the drives' own folders/);
});

test('install.sh refuses without sudo, for root or a user who is not there, on an old systemd, and when a piece fails', async (t) => {
  if (!asRoot) {
    const bare = await sh(path.join(DIR, 'install.sh'), [ME], {});
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr, /run it with sudo/);
  }
  const r = await installRig();
  t.after(() => fsp.rm(r.root, { recursive: true, force: true }));
  assert.match((await sh(path.join(DIR, 'install.sh'), ['root'], r.env)).stderr, /not root/);
  assert.match((await sh(path.join(DIR, 'install.sh'), ['nobody-at-all-here'], r.env)).stderr, /there is no user "nobody-at-all-here"/);
  assert.match((await sh(path.join(DIR, 'install.sh'), [ME, '--frob'], r.env)).stderr, /unknown option --frob/);
  assert.match((await sh(path.join(DIR, 'install.sh'), [], { ...r.env, SUDO_USER: '' })).stderr, /who is the owner/);
  const old = await installRig({ version: '255' });
  t.after(() => fsp.rm(old.root, { recursive: true, force: true }));
  const refused = await sh(path.join(DIR, 'install.sh'), [ME], old.env);
  assert.match(refused.stderr, /needs systemd 257 or later \(this is 255\)/);
  assert.ok(!fs.existsSync(path.join(old.root, 'etc/systemd/system/marble-guest@.service')));
  await fsp.writeFile(path.join(r.pieces, '30-broken.sh'), 'exit 3\n');
  const broken = await sh(path.join(DIR, 'install.sh'), [ME], r.env);
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /install\.d\/30-broken\.sh failed/);
});

/** The polkit rule, run the way polkit runs it, with @OWNER@ as `bryan`. */
function polkitRule() {
  const rules = [];
  const Result = { YES: 'yes', NOT_HANDLED: 'not handled' };
  const source = fs.readFileSync(path.join(DIR, '50-marble-host.rules'), 'utf8').replaceAll('@OWNER@', 'bryan');
  vm.runInNewContext(source, { polkit: { addRule: (fn) => rules.push(fn), Result } });
  assert.equal(rules.length, 1);
  return (user, unit, verb, id = 'org.freedesktop.systemd1.manage-units') => rules[0]({ id, lookup: (k) => ({ unit, verb })[k] }, { user });
}

test('the polkit rule: the owner may start, stop and restart the guests\' units and their helpers, and nothing else', () => {
  const ask = polkitRule();
  for (const unit of ['marble-guest@ana.service', 'marble-guest-backup@ana.service', 'marble-guest-export@ana-b.service', 'marble-guest-remove@a1.service', 'marble-guests-backup.service']) {
    for (const verb of ['start', 'stop', 'restart', 'try-restart', 'reload-or-restart']) assert.equal(ask('bryan', unit, verb), 'yes', `${unit} ${verb}`);
  }
  for (const verb of ['enable', 'disable', 'reset-failed', 'kill', 'mask', 'reload', 'freeze', 'set-property']) assert.equal(ask('bryan', 'marble-guest@ana.service', verb), 'not handled', verb);
  for (const unit of ['marble-drive-home-bryan.service', 'ssh.service', 'marble-host.service', 'marble-guest@.service', 'marble-guest@Ana.service', 'marble-guest@ana.service.d', 'marble-guest@ana.socket', 'marble-guest@../x.service', 'marble-guest@ana.service x', 'xmarble-guest@ana.service', 'marble-guests.slice', 'marble-guest-other@ana.service', '']) {
    assert.equal(ask('bryan', unit, 'start'), 'not handled', unit);
  }
  assert.equal(ask('someone', 'marble-guest@ana.service', 'start'), 'not handled');
  assert.equal(ask('root', 'marble-guest@ana.service', 'start'), 'not handled');
  assert.equal(ask('bryan', 'marble-guest@ana.service', 'start', 'org.freedesktop.systemd1.manage-unit-files'), 'not handled');
  assert.equal(ask('bryan', undefined, undefined), 'not handled');
});

/** A release with nothing in it, a node that writes down how it was run and
 *  ends when told, and the settings systemd would have loaded. */
async function guestRig({ exitWith = null } = {}) {
  const root = await scratch('pc-guest-');
  const opt = path.join(root, 'opt');
  const release = '20261025T161133Z-4b2103a';
  const app = path.join(opt, 'releases', release, 'marble-drive');
  await fsp.mkdir(path.join(app, 'bin'), { recursive: true });
  await fsp.writeFile(path.join(app, 'bin', 'marble-drive.js'), '');
  const state = path.join(root, 'state');
  await fsp.mkdir(state, { mode: 0o700 });
  const report = path.join(root, 'node.txt');
  const node = path.join(root, 'node');
  await fsp.writeFile(node, `#!/usr/bin/env bash
{ echo "cwd=$PWD"; echo "args=$*"; env | grep -E '^(HOME|MARBLE_DRIVE_ROOT|HOST|NODE_ENV|MARBLE_DRIVE_AGENTS|MARBLE_DRIVE_AGENT_KEYS|PLAYWRIGHT_BROWSERS_PATH|DISABLE_AUTOUPDATER|MARBLE_GUEST|PATH)=' | sort; } > '${report}.tmp'
mv '${report}.tmp' '${report}'
${exitWith === null ? `trap 'echo stopped >> "${report}"; exit 0' TERM
while :; do sleep 0.05; done` : `exit ${exitWith}`}
`, { mode: 0o755 });
  const env = { MARBLE_GUEST_OPT: opt, MARBLE_GUEST_NODE: node, MARBLE_GUEST_NAME: 'ana', MARBLE_GUEST_RELEASE: release, STATE_DIRECTORY: state, PATH: process.env.PATH };
  return { root, opt, app, state, report, env };
}

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waited too long');
}

test('run-guest: the drive\'s folders and settings, node from its release, and a stop passed on', async (t) => {
  const g = await guestRig();
  t.after(() => fsp.rm(g.root, { recursive: true, force: true }));
  const child = spawn('bash', [path.join(DIR, 'run-guest'), 'ana'], { env: g.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const said = await until(() => fsp.readFile(g.report, 'utf8').catch(() => null));
  const got = Object.fromEntries(said.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  assert.equal(got.cwd, g.app);
  assert.equal(got.args, `--report-on-fatalerror --report-directory=${g.state}/crash bin/marble-drive.js serve`);
  assert.equal(got.HOME, path.join(g.state, 'home'));
  assert.equal(got.MARBLE_DRIVE_ROOT, path.join(g.state, 'drive'));
  assert.equal(got.HOST, '127.0.0.1');
  assert.equal(got.NODE_ENV, 'production');
  assert.equal(got.MARBLE_DRIVE_AGENTS, '1');
  assert.equal(got.MARBLE_DRIVE_AGENT_KEYS, path.join(g.state, 'home', '.config', 'marble-drive', 'agent-keys'));
  assert.equal(got.PLAYWRIGHT_BROWSERS_PATH, path.join(g.opt, 'ms-playwright'));
  assert.equal(got.DISABLE_AUTOUPDATER, '1');
  assert.equal(got.MARBLE_GUEST, '1');
  assert.equal(got.PATH, `${g.app}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin`);
  for (const d of ['drive', 'home/.config/marble-drive', 'crash']) assert.ok(fs.statSync(path.join(g.state, d)).isDirectory(), d);

  child.kill('SIGTERM');
  const [code] = await new Promise((resolve) => child.on('exit', (...a) => resolve(a)));
  assert.equal(code, 0, 'a stop is a clean exit');
  assert.match(fs.readFileSync(g.report, 'utf8'), /stopped$/m, 'node was told');
});

test('run-guest: when node ends on its own, run-guest ends with its status, for systemd to start it again', async (t) => {
  const g = await guestRig({ exitWith: 3 });
  t.after(() => fsp.rm(g.root, { recursive: true, force: true }));
  const res = await sh(path.join(DIR, 'run-guest'), ['ana'], g.env);
  assert.equal(res.status, 3);
  assert.match(res.stderr, /the host for ana exited \(status 3\)/);
});

test('run-guest refuses settings for another drive, a bad release, a missing release, or no folder of its own', async (t) => {
  const g = await guestRig();
  t.after(() => fsp.rm(g.root, { recursive: true, force: true }));
  const refused = async (args, env, why) => {
    const res = await sh(path.join(DIR, 'run-guest'), args, { ...g.env, ...env });
    assert.equal(res.status, 1, why.source);
    assert.match(res.stderr, why);
  };
  await refused(['ben'], {}, /the settings systemd loaded are for ana, not ben/);
  await refused(['A'], {}, /a drive's name is 3 to 40/);
  await refused(['ana'], { MARBLE_GUEST_RELEASE: '../../etc' }, /not a release's name/);
  await refused(['ana'], { MARBLE_GUEST_RELEASE: '20261101T000000Z-gone' }, /the release 20261101T000000Z-gone is not in/);
  await refused(['ana'], { STATE_DIRECTORY: '' }, /STATE_DIRECTORY is not a folder/);
  await refused(['ana'], { STATE_DIRECTORY: path.join(g.root, 'missing') }, /STATE_DIRECTORY is not a folder/);
  assert.ok(!fs.existsSync(g.report), 'node never started');
});

/** tunnel.sh and host.sh with a HOME of their own: what they refuse, before
 *  either touches systemd or Cloudflare. */
async function homeRig(files = {}) {
  const home = await scratch('pc-home-');
  for (const [rel, [text, m = 0o600]] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text, { mode: m });
    fs.chmodSync(path.join(home, rel), m);
  }
  return home;
}
const tunnelConfig = (service, more = '') => `tunnel: x\ncredentials-file: /x.json\ningress:\n  - hostname: pc-host.marbledrive.app\n    service: ${service}\n${more}  - service: http_status:404\n`;

test('tunnel.sh will not start unless its config sends one name to the router alone and the router turns away a request without the key', async (t) => {
  const answering = await listen((req, res) => res.end('{"ok":true}'));
  const router = await listen((req, res) => {
    res.writeHead(req.headers['x-marble-host-key'] ? 200 : 401);
    res.end();
  });
  t.after(async () => {
    await answering.close();
    await router.close();
  });
  const cases = [
    [{}, /no .*marble-pc-host\.yml yet: run linux\/pc-host\/tunnel\.sh setup/],
    [{ '.cloudflared/marble-pc-host.yml': [tunnelConfig('http://127.0.0.1:4401')] }, /must send one hostname to http:\/\/127\.0\.0\.1:4460/],
    [{ '.cloudflared/marble-pc-host.yml': [tunnelConfig('http://127.0.0.1:4460', '  - hostname: ana.marbledrive.app\n    service: http://127.0.0.1:4500\n')] }, /refusing/],
    [{ '.config/marble-drive/host.env': [`HOST_ROUTER_PORT=${answering.port}\n`], '.cloudflared/marble-pc-host.yml': [tunnelConfig(`http://127.0.0.1:${answering.port}`)] }, new RegExp(`127\\.0\\.0\\.1:${answering.port} answered 200 without the key`)],
  ];
  for (const [files, why] of cases) {
    const home = await homeRig(files);
    for (const verb of ['install', 'start']) {
      const res = await sh(path.join(DIR, 'tunnel.sh'), [verb], { HOME: home });
      assert.equal(res.status, 1, `${verb}: ${res.stdout}${res.stderr}`);
      assert.match(res.stderr, why);
    }
    assert.ok(!fs.existsSync(path.join(home, '.config/systemd/user/marble-host-tunnel.service')), 'nothing rendered');
    fs.rmSync(home, { recursive: true, force: true });
  }
  const down = await homeRig({ '.config/marble-drive/host.env': ['HOST_ROUTER_PORT=1\n'], '.cloudflared/marble-pc-host.yml': [tunnelConfig('http://127.0.0.1:1')] });
  t.after(() => fs.rmSync(down, { recursive: true, force: true }));
  assert.match((await sh(path.join(DIR, 'tunnel.sh'), ['install'], { HOME: down })).stderr, /nothing answers on 127\.0\.0\.1:1\. Start marble-host first/);
});

test('tunnel.sh setup refuses a name that is not one label under marbledrive.app, or one the Worker routes, before cloudflared is asked', async (t) => {
  const home = await homeRig();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const [name, why] of [['pc-host.example.com', /one label under marbledrive\.app/], ['a.b.marbledrive.app', /one label/], ['bryan.marbledrive.app', /routed through the front door Worker/]]) {
    const res = await sh(path.join(DIR, 'tunnel.sh'), ['setup', name], { HOME: home, PATH: '/usr/bin:/bin' });
    assert.equal(res.status, 2, name);
    assert.match(res.stderr, why);
  }
  assert.ok(!fs.existsSync(path.join(home, '.cloudflared')));
});

test('host.sh install refuses without host.env, with one others can read, and (in system mode) without the sandbox installed', async (t) => {
  const none = await homeRig();
  t.after(() => fs.rmSync(none, { recursive: true, force: true }));
  let res = await sh(path.join(DIR, 'host.sh'), ['install'], { HOME: none });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /there is no .*host\.env yet: node tools\/pc-host\.mjs init/);
  const open = await homeRig({ '.config/marble-drive/host.env': ['HOST_MODE=system\n', 0o644] });
  t.after(() => fs.rmSync(open, { recursive: true, force: true }));
  res = await sh(path.join(DIR, 'host.sh'), ['install'], { HOME: open });
  assert.match(res.stderr, /can be read by others; chmod 600 it first/);
  if (fs.existsSync('/etc/systemd/system/marble-guest@.service')) return t.skip('the sandbox is installed on this machine');
  const system = await homeRig({ '.config/marble-drive/host.env': ['HOST_MODE=system\n'] });
  t.after(() => fs.rmSync(system, { recursive: true, force: true }));
  res = await sh(path.join(DIR, 'host.sh'), ['install'], { HOME: system });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /the guests' sandbox is not installed: sudo bash .*install\.sh/);
  assert.ok(!fs.existsSync(path.join(system, '.config/systemd/user/marble-host.service')));
});
