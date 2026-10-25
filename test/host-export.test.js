// test/host-export.test.js
// The probe study's export of a PC drive's logs (linux/pc-host: export-guest,
// the consent and export commands of backup-tree, marble-guest-export@.service
// and install.d/30-export.sh), run as the scripts they are, with every path
// moved under a temporary folder. No root and no systemd: the user running
// the test stands in for the owner, which is who the unit runs the export as.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const HOST = path.resolve(import.meta.dirname, '../linux/pc-host');
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const made = [];
const tmpdir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const CONSENT = '2026-11-irb-v1@2026-11-02T17:00:03.123Z';
const LOGIN = 'not-a-real-login-31b7';
const ME = os.userInfo();

/** A PC of folders: guests, their settings, and the owner's Research folder. */
function makePC() {
  const root = tmpdir('host-export-');
  const pc = {
    root,
    guests: path.join(root, 'var/lib/private/marble-guests'),
    etc: path.join(root, 'etc/marble-guests'),
    exports: path.join(root, 'home/owner/Marble Drive/Research/Probe study'),
  };
  for (const dir of [pc.guests, pc.etc, pc.exports]) fs.mkdirSync(dir, { recursive: true });
  pc.env = { ...process.env, MARBLE_GUESTS_DIR: pc.guests, MARBLE_GUESTS_ETC: pc.etc, MARBLE_EXPORT_DIR: pc.exports };
  pc.run = (args, env = {}) => {
    const r = spawnSync('bash', [path.join(HOST, 'export-guest'), ...args], { env: { ...pc.env, ...env }, encoding: 'utf8', timeout: 60_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr };
  };
  pc.drive = (name) => path.join(pc.guests, name, 'drive');
  pc.put = (name, rel, data) => {
    const file = path.join(pc.drive(name), rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  pc.settings = (name, lines) => fs.writeFileSync(path.join(pc.etc, `${name}.env`), `${lines.join('\n')}\n`, { mode: 0o600 });
  pc.exported = (name) => (fs.existsSync(path.join(pc.exports, name)) ? fs.readdirSync(path.join(pc.exports, name)) : []);
  return pc;
}

// What an export takes, and what it never does.
const LOGS = {
  '.marble/agents/0123456789ab/events.jsonl': '{"seq":1,"t":1,"type":"user","text":"my ask"}\n',
  '.marble/agents/0123456789ab/turns/0123456789ab-t1.json': '{"id":"0123456789ab-t1"}\n',
  '.marble/agents/0123456789ab/turns/0123456789ab-t1.undo.json': '{"steps":[]}\n',
  '.marble/agents/0123456789ab/raw/0123456789ab-t1.jsonl': '{"type":"message_start"}\n',
  '.marble/agents/ba9876543210/events.jsonl': '{"seq":1,"t":2,"type":"user","text":"another"}\n',
  '.marble/Notes%2FIdeas.ops.jsonl': '{"t":3,"doc":"Notes/Ideas","client":"a1b2"}\n',
  '.marble/start-here.ops.jsonl': '{"t":4,"doc":"start-here","client":"agent:0123456789ab"}\n',
};
const NEVER = {
  'Notes/Ideas.mrbl': '<h1>A document of mine</h1>\n',
  'Pictures/cat.png': 'png bytes',
  '.marble/Notes%2FIdeas.history.jsonl': '{"v":1}\n',
  '.marble/blobs/0f/0f1e': 'blob bytes',
  '.marble/agents/settings.json': '{"defaultProvider":"claude-subscription"}\n',
  '.marble/agents/0123456789ab/meta.json': '{"title":"My chat"}\n',
  '.marble/agents/0123456789ab/inbox.jsonl': '{}\n',
  '.marble/agents/uploads/0f1e.png': 'pasted picture',
  '.marble/usage/2026-10-25.jsonl': '{}\n',
  '.marble/apps.json': '{"seeded":{}}\n',
};

/** A study drive as its person and their agents leave it, with links planted
 *  to its login, to another drive's chats and out of the drive. */
function seed(pc, name = 'ana') {
  for (const [rel, text] of Object.entries({ ...LOGS, ...NEVER })) pc.put(name, rel, text);
  const home = path.join(pc.guests, name, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/.credentials.json'), LOGIN);
  const agents = path.join(pc.drive(name), '.marble/agents');
  fs.symlinkSync(path.join(home, '.claude/.credentials.json'), path.join(agents, '0123456789ab/raw/0123456789ab-t2.jsonl'));
  fs.symlinkSync(path.join(home, '.claude/.credentials.json'), path.join(pc.drive(name), '.marble/stolen.ops.jsonl'));
  fs.symlinkSync(path.join(home, '.claude'), path.join(agents, '0123456789ab/turns/from-home'));
  // Bob's drive, and a "conversation" of Ana's that is a link to his chats.
  pc.put('bob', '.marble/agents/b0b0b0b0b0b0/events.jsonl', '{"seq":1,"t":1,"type":"user","text":"bob\'s own ask"}\n');
  fs.symlinkSync(path.join(pc.drive('bob'), '.marble/agents/b0b0b0b0b0b0'), path.join(agents, 'b0b0b0b0b0b0'));
  fs.mkdirSync(path.join(agents, 'feedfacecafe'));
  fs.symlinkSync(path.join(pc.drive('bob'), '.marble/agents/b0b0b0b0b0b0/events.jsonl'), path.join(agents, 'feedfacecafe/events.jsonl'));
  if (has('mkfifo')) spawnSync('mkfifo', [path.join(agents, '0123456789ab/raw/pipe.jsonl')]);
  pc.settings(name, ['MARBLE_GUEST_NAME=ana', 'PORT=4501', 'MARBLE_DRIVE_SECRET=0000', 'MARBLE_STUDY=1', `MARBLE_CONSENT=${CONSENT}`]);
}

/** Every file under a folder, by path relative to it, with its bytes. */
function files(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), r);
      else out[r] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    }
  };
  walk(root, '');
  return out;
}

test('the scripts parse, and are executable', () => {
  for (const script of ['export-guest', 'install.d/30-export.sh']) {
    const r = spawnSync('bash', ['-n', path.join(HOST, script)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${script}: ${r.stderr}`);
    assert.ok(fs.statSync(path.join(HOST, script)).mode & 0o111, `${script} is executable`);
  }
  const r = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(open(sys.argv[1]).read())', path.join(HOST, 'backup-tree')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('shellcheck finds nothing', { skip: !has('shellcheck') && 'shellcheck is not installed' }, () => {
  const r = spawnSync('shellcheck', ['-x', path.join(HOST, 'export-guest'), path.join(HOST, 'install.d/30-export.sh')], { encoding: 'utf8', cwd: HOST });
  assert.equal(r.status, 0, r.stdout);
});

test('an export copies only the study\'s logs, laid out as in the drive, with export.json beside them', () => {
  const pc = makePC();
  seed(pc);
  const r = pc.run(['ana']);
  assert.equal(r.status, 0, r.out);
  const runs = pc.exported('ana');
  assert.equal(runs.length, 1);
  assert.match(runs[0], /^\d{8}T\d{6}Z$/);
  assert.match(r.stdout, new RegExp(`ana: copied 7 files of study logs \\(.*\\) to .*/ana/${runs[0]}\\n`));
  const got = files(path.join(pc.exports, 'ana', runs[0]));
  const note = JSON.parse(got['export.json']);
  delete got['export.json'];
  assert.deepEqual(got, LOGS, 'every log, byte for byte, and nothing else');
  assert.deepEqual(Object.keys(note), ['name', 'at', 'consent', 'files', 'bytes']);
  assert.equal(note.name, 'ana');
  assert.equal(note.consent, CONSENT);
  assert.equal(note.files, Object.keys(LOGS).length);
  assert.equal(note.bytes, Object.values(LOGS).reduce((n, text) => n + Buffer.byteLength(text), 0));
  assert.match(note.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(runs[0], note.at.replace(/[-:]/g, ''));
  // Nothing half-made is left beside it, and the drive is as it was.
  assert.deepEqual(fs.readdirSync(path.join(pc.exports, 'ana')), runs);
  assert.equal(fs.readFileSync(path.join(pc.drive('ana'), '.marble/agents/0123456789ab/events.jsonl'), 'utf8'), LOGS['.marble/agents/0123456789ab/events.jsonl']);
  // Times travel with the copies.
  const from = fs.statSync(path.join(pc.drive('ana'), '.marble/agents/0123456789ab/events.jsonl')).mtimeMs;
  const to = fs.statSync(path.join(pc.exports, 'ana', runs[0], '.marble/agents/0123456789ab/events.jsonl')).mtimeMs;
  assert.ok(Math.abs(from - to) < 2);
});

test('a link planted anywhere in the drive is never followed: not to its login, not to another drive', () => {
  const pc = makePC();
  seed(pc);
  assert.equal(pc.run(['ana']).status, 0);
  const [run] = pc.exported('ana');
  const got = files(path.join(pc.exports, 'ana', run));
  for (const [rel, text] of Object.entries(got)) {
    assert.ok(!text.includes(LOGIN), `${rel} holds the login`);
    assert.ok(!text.includes("bob's own ask"), `${rel} holds bob's chat`);
  }
  for (const rel of ['.marble/stolen.ops.jsonl', '.marble/agents/b0b0b0b0b0b0', '.marble/agents/feedfacecafe/events.jsonl', '.marble/agents/0123456789ab/turns/from-home', '.marble/agents/0123456789ab/raw/pipe.jsonl']) {
    assert.ok(!fs.existsSync(path.join(pc.exports, 'ana', run, rel)), `${rel} was copied`);
  }
  // A drive folder that is itself a link is not read at all.
  fs.renameSync(pc.drive('ana'), path.join(pc.guests, 'ana', 'drive.real'));
  fs.symlinkSync(pc.drive('bob'), pc.drive('ana'));
  const linked = pc.run(['ana']);
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, /ana's drive folder is a link or a file, not a folder; nothing was copied/);
  assert.equal(pc.exported('ana').length, 1, 'no second export');
});

test('without consent on file nothing is copied', () => {
  const pc = makePC();
  seed(pc);
  const cases = [
    [['MARBLE_STUDY=1'], /ana has no consent on file \(its settings have no MARBLE_CONSENT\)/],
    [[`MARBLE_CONSENT=${CONSENT}`], /ana is not in the study \(its settings have no MARBLE_STUDY=1\)/],
    [['MARBLE_STUDY=0', `MARBLE_CONSENT=${CONSENT}`], /ana is not in the study/],
    [['MARBLE_STUDY=1', 'MARBLE_CONSENT='], /ana has no consent on file/],
    [['MARBLE_STUDY=1', 'MARBLE_CONSENT=v1@$(touch /tmp/x)'], /MARBLE_CONSENT is not <version>@<time>/],
    [['MARBLE_STUDY=1', 'MARBLE_CONSENT=2026-11-irb-v1'], /MARBLE_CONSENT is not <version>@<time>/],
  ];
  for (const [lines, why] of cases) {
    pc.settings('ana', ['MARBLE_GUEST_NAME=ana', ...lines]);
    const r = pc.run(['ana']);
    assert.equal(r.status, 1, `${lines.join(' ')}: ${r.out}`);
    assert.match(r.stderr, why);
    assert.match(r.stderr, /nothing was copied/);
  }
  // No settings at all, and settings that are a link to a file with consent in it.
  fs.rmSync(path.join(pc.etc, 'ana.env'));
  assert.match(pc.run(['ana']).stderr, /ana has no settings on this PC/);
  const elsewhere = path.join(pc.root, 'consent.env');
  fs.writeFileSync(elsewhere, `MARBLE_STUDY=1\nMARBLE_CONSENT=${CONSENT}\n`);
  fs.symlinkSync(elsewhere, path.join(pc.etc, 'ana.env'));
  assert.match(pc.run(['ana']).stderr, /are not a file marble-host wrote/);
  assert.deepEqual(pc.exported('ana'), [], 'nothing was copied, ever');
});

test('names that are not drive names are refused before anything is read', () => {
  const pc = makePC();
  for (const name of ['../etc', 'Ana', 'a', '-x', 'ana/drive', '']) {
    const r = pc.run(name ? [name] : []);
    assert.equal(r.status, 2, `${name}: ${r.out}`);
  }
  assert.equal(pc.run(['ana', 'bob']).status, 2);
});

test('the owner owns the result: made by the user the unit runs it as, for him alone', () => {
  const pc = makePC();
  seed(pc);
  assert.equal(pc.run(['ana']).status, 0);
  const top = path.join(pc.exports, 'ana');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      const st = fs.lstatSync(at);
      assert.equal(st.uid, ME.uid, `${at} is the owner's`);
      assert.equal(st.mode & 0o777, entry.isDirectory() ? 0o700 : 0o600, `${at} is for the owner alone`);
      if (entry.isDirectory()) walk(at);
    }
  };
  assert.equal(fs.statSync(top).uid, ME.uid);
  walk(top);
  // Without MARBLE_EXPORT_DIR, or with nowhere to put it, nothing is made.
  assert.match(pc.run(['ana'], { MARBLE_EXPORT_DIR: '' }).stderr, /MARBLE_EXPORT_DIR is not set; marble-guest-export@ana\.service sets it/);
  assert.match(pc.run(['ana'], { MARBLE_EXPORT_DIR: path.join(pc.root, 'nowhere') }).stderr, /is not there; sudo bash linux\/pc-host\/install\.sh makes it/);
});

test('two exports in the same second go to two folders', () => {
  const pc = makePC();
  seed(pc);
  assert.equal(pc.run(['ana']).status, 0);
  assert.equal(pc.run(['ana']).status, 0);
  const runs = pc.exported('ana');
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0], runs[1]);
});

/** The unit as 30-export.sh writes it, for a given owner and home. */
function rendered(owner, home) {
  const exports = `${home}/Marble Drive/Research/Probe study`;
  return fs.readFileSync(path.join(HOST, 'marble-guest-export@.service'), 'utf8').replaceAll('@OWNER@', owner).replaceAll('@EXPORTS@', exports);
}

test('the unit: oneshot, as the owner, able to read the drive and write only the Research folder', () => {
  const unit = rendered('tester', '/home/tester');
  const lines = unit.split('\n');
  for (const line of [
    'Type=oneshot',
    'ExecStart=/usr/local/lib/marble-guests/export-guest %i',
    'User=tester',
    'AmbientCapabilities=CAP_DAC_READ_SEARCH',
    'CapabilityBoundingSet=CAP_DAC_READ_SEARCH',
    'Environment="MARBLE_EXPORT_DIR=/home/tester/Marble Drive/Research/Probe study"',
    'ProtectSystem=strict',
    'ProtectHome=tmpfs',
    'BindPaths=-"/home/tester/Marble Drive/Research/Probe study"',
    'TemporaryFileSystem=/var/lib/private:ro',
    'BindReadOnlyPaths=-/var/lib/private/marble-guests/%i',
    'PrivateNetwork=yes',
    'NoNewPrivileges=yes',
  ]) assert.ok(lines.includes(line), `the unit has ${line}`);
  assert.match(unit, /^InaccessiblePaths=.*-\/etc\/marble-backup .*-\/var\/lib\/marble-backup/m);
  assert.doesNotMatch(unit, /InaccessiblePaths=.*marble-guests/, '/etc/marble-guests stays readable');
  assert.doesNotMatch(unit, /^\[Install\]/m, 'never enabled');
  assert.doesNotMatch(unit, /@[A-Z]+@/);
});

test('the unit verifies', { skip: !has('systemd-analyze') && 'systemd-analyze is not installed' }, () => {
  // systemd-analyze checks that ExecStart exists and the user is real, so the
  // copy runs the script from this checkout as the user running the test.
  const dir = tmpdir('host-export-unit-');
  const text = rendered(ME.username, path.join(dir, 'home')).replaceAll('/usr/local/lib/marble-guests/', `${HOST}/`);
  fs.writeFileSync(path.join(dir, 'marble-guest-export@ana.service'), text);
  const r = spawnSync('systemd-analyze', ['verify', './marble-guest-export@ana.service'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.trim(), '', r.stderr);
});

test('30-export.sh installs the helper and the unit for the owner, makes his Research folder, and takes them away again', () => {
  const root = tmpdir('host-export-install-');
  const fsRoot = path.join(root, 'fs');
  fs.writeFileSync(path.join(root, 'systemctl'), `#!/usr/bin/env bash\necho "$*" >>"${root}/systemctl.log"\n`, { mode: 0o755 });
  const install = (args = [], env = {}) => {
    const r = spawnSync('bash', [path.join(HOST, 'install.d/30-export.sh'), ...args], {
      env: { ...process.env, OWNER: 'tester', OWNER_HOME: '/home/tester', OPT: '/opt/marble', ETC: '/etc/marble-guests', RELEASE_DIR: path.resolve(HOST, '../..'), MARBLE_INSTALL_ROOT: fsRoot, MARBLE_SYSTEMCTL: path.join(root, 'systemctl'), ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const calls = () => fs.readFileSync(path.join(root, 'systemctl.log'), 'utf8').trim().split('\n');
  const tools = path.join(fsRoot, 'usr/local/lib/marble-guests');
  const unit = path.join(fsRoot, 'etc/systemd/system/marble-guest-export@.service');
  const research = path.join(fsRoot, 'home/tester/Marble Drive/Research/Probe study');

  const first = install();
  assert.equal(first.status, 0, first.out);
  assert.match(first.out, /exports go to \/home\/tester\/Marble Drive\/Research\/Probe study \(made just now\)/);
  assert.deepEqual(fs.readdirSync(tools).sort(), ['backup-lib.sh', 'backup-tree', 'export-guest']);
  assert.equal(fs.statSync(path.join(tools, 'export-guest')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(tools, 'backup-tree')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(tools, 'backup-lib.sh')).mode & 0o777, 0o644);
  assert.equal(fs.readFileSync(path.join(tools, 'export-guest'), 'utf8'), fs.readFileSync(path.join(HOST, 'export-guest'), 'utf8'));
  assert.equal(fs.readFileSync(unit, 'utf8'), rendered('tester', '/home/tester'));
  assert.equal(fs.statSync(unit).mode & 0o777, 0o644);
  assert.ok(fs.statSync(research).isDirectory());
  assert.deepEqual(calls(), ['daemon-reload'], 'reloaded, never enabled');

  // Again: the same files, and the folder (and what is in it) as it was.
  fs.writeFileSync(path.join(research, 'kept.txt'), 'an earlier export');
  const second = install();
  assert.equal(second.status, 0, second.out);
  assert.doesNotMatch(second.out, /made just now/);
  assert.equal(fs.readFileSync(path.join(research, 'kept.txt'), 'utf8'), 'an earlier export');
  assert.equal(fs.readFileSync(unit, 'utf8'), rendered('tester', '/home/tester'));

  // A home a unit file would misread, or no owner, writes nothing.
  for (const [env, why] of [[{ OWNER_HOME: '/home/te%st' }, /characters a unit file would read as something else/], [{ OWNER: '' }, /OWNER and OWNER_HOME are not set/], [{ OWNER: 'root' }, /not a user the export can run as/]]) {
    const bad = install([], { ...env, MARBLE_INSTALL_ROOT: path.join(root, 'other') });
    assert.equal(bad.status, 1, bad.out);
    assert.match(bad.out, why);
    assert.ok(!fs.existsSync(path.join(root, 'other/etc/systemd/system/marble-guest-export@.service')));
  }
  assert.match(install(['--frob']).out, /unknown option --frob/);

  // Uninstalling takes its own two away and keeps the exports.
  const gone = install(['--uninstall']);
  assert.equal(gone.status, 0, gone.out);
  assert.ok(!fs.existsSync(unit));
  assert.ok(!fs.existsSync(path.join(tools, 'export-guest')));
  assert.ok(fs.existsSync(path.join(tools, 'backup-tree')), "backup-tree is 20-backup.sh's to take away");
  assert.equal(fs.readFileSync(path.join(research, 'kept.txt'), 'utf8'), 'an earlier export');
  assert.match(gone.out, /the exports in the owner's Research folder are his, and stay/);
  assert.deepEqual(calls().slice(-2), ['stop marble-guest-export@*.service', 'daemon-reload']);
});

test('the polkit rule lets the owner start an export, and nothing like it', () => {
  const rule = fs.readFileSync(path.join(HOST, '50-marble-host.rules'), 'utf8');
  const pattern = new RegExp(/\/(\^marble-guest[^/]+)\//.exec(rule)[1]);
  assert.ok(pattern.test('marble-guest-export@ana.service'));
  assert.ok(!pattern.test('marble-guest-export@.service'));
  assert.ok(!pattern.test('marble-guest-exporter@ana.service'));
});
