// test/host-backup.test.js
// The PC drives' backups (linux/pc-host: backup-guest, backup-guests,
// restore-guest, remove-guest, backup-check.sh, install.d/20-backup.sh and the
// units), run as the scripts they are, with every path moved under a
// temporary folder and R2 stood in for by rclone's local backend, under the
// same crypt remote. No root, no R2 and no systemd: a stand-in systemctl
// records what it is asked, and runs a drive's backup when its unit starts.
// rclone is the pinned one in ~/.local/bin, used as it is.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const HOST = path.resolve(import.meta.dirname, '../linux/pc-host');
const PIN = fs.readFileSync(path.resolve(import.meta.dirname, '../tools/sprite/rclone-version'), 'utf8').trim();
const RCLONE = process.env.MARBLE_RCLONE || path.join(os.homedir(), '.local/bin/rclone');
function rcloneProblem() {
  let first;
  try {
    first = execFileSync(RCLONE, ['version'], { encoding: 'utf8' }).split('\n')[0];
  } catch {
    return `no rclone at ${RCLONE} (tools/pc-setup.sh installs the pinned v${PIN} there)`;
  }
  return first === `rclone v${PIN}` ? false : `${RCLONE} is ${first}, not the pinned rclone v${PIN}`;
}
const needsRclone = { skip: rcloneProblem() };
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

// Every folder a test makes, removed when the file is done.
const made = [];
const tmpdir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const LOGIN = 'not-a-real-login-7c41';
const SCRIPTS = ['backup-guest', 'backup-guests', 'restore-guest', 'remove-guest', 'backup-check.sh', 'backup-lib.sh', 'install.d/20-backup.sh'];
const UNITS = ['marble-guest-backup@.service', 'marble-guests-backup.service', 'marble-guests-backup.timer', 'marble-guest-remove@.service'];

// systemctl, as the scripts use it.
const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
echo "$*" >>"$FAKE_ROOT/systemctl.log"
unit="\${*: -1}"
case $1 in
  is-active)
    if [[ -e $FAKE_ROOT/active/$unit ]]; then state=active; else state=inactive; fi
    [[ $* == *--quiet* ]] || echo "$state"
    [[ $state == active ]]
    exit ;;
  start)
    if [[ $unit =~ ^marble-guest-backup@(.+)\\.service$ ]]; then exec "$FAKE_HOST/backup-guest" "\${BASH_REMATCH[1]}"; fi
    touch "$FAKE_ROOT/active/$unit" ;;
  stop) rm -f "$FAKE_ROOT/active/$unit" ;;
esac
exit 0
`;

/** A PC of folders: guests, their settings, the backup's state, and a stand-in R2. */
function makePC() {
  const root = tmpdir('host-backup-');
  const pc = {
    root,
    guests: path.join(root, 'var/lib/private/marble-guests'),
    links: path.join(root, 'var/lib/marble-guests'),
    etc: path.join(root, 'etc/marble-guests'),
    state: path.join(root, 'var/lib/marble-backup'),
    r2: path.join(root, 'r2'),
    settings: path.join(root, 'etc/marble-backup/backup.env'),
    passphrase: crypto.randomBytes(32).toString('hex'),
    salt: crypto.randomBytes(32).toString('hex'),
  };
  for (const dir of [pc.guests, pc.links, pc.etc, pc.r2, path.dirname(pc.settings), path.join(root, 'active')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pc.settings, `GUEST_BACKUP_PASSPHRASE=${pc.passphrase}\nGUEST_BACKUP_SALT="${pc.salt}"\nGUEST_BACKUP_BACKEND=local\nGUEST_BACKUP_LOCAL_DIR=${pc.r2}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'systemctl'), FAKE_SYSTEMCTL, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'systemctl.log'), '');
  pc.env = {
    ...process.env,
    MARBLE_GUESTS_DIR: pc.guests,
    MARBLE_GUESTS_LINKS: pc.links,
    MARBLE_GUESTS_ETC: pc.etc,
    MARBLE_BACKUP_DIR: pc.state,
    MARBLE_BACKUP_ENV: pc.settings,
    MARBLE_RCLONE: RCLONE,
    MARBLE_SYSTEMCTL: path.join(root, 'systemctl'),
    FAKE_ROOT: root,
    FAKE_HOST: HOST,
  };
  pc.run = (script, args = [], env = {}) => {
    const r = spawnSync('bash', [path.join(HOST, script), ...args], { env: { ...pc.env, ...env }, encoding: 'utf8', timeout: 180_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr };
  };
  pc.drive = (name) => path.join(pc.guests, name, 'drive');
  pc.put = (name, rel, data) => {
    const file = path.join(pc.drive(name), rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  pc.status = (name) => JSON.parse(fs.readFileSync(path.join(pc.state, 'status', `${name}.json`), 'utf8'));
  pc.log = () => fs.readFileSync(path.join(root, 'systemctl.log'), 'utf8').trim().split('\n').filter(Boolean);
  pc.clearLog = () => fs.writeFileSync(path.join(root, 'systemctl.log'), '');
  pc.crypt = (name, args) => execFileSync(RCLONE, args, { env: cryptEnv(pc, name), encoding: 'utf8' });
  return pc;
}

function cryptEnv(pc, name) {
  const bare = { PATH: process.env.PATH, RCLONE_CONFIG: '/dev/null' };
  const obscure = (value) => execFileSync(RCLONE, ['obscure', '-'], { input: value, encoding: 'utf8', env: bare }).trim();
  return {
    ...bare,
    RCLONE_CONFIG_RAW_TYPE: 'local',
    RCLONE_CONFIG_C_TYPE: 'crypt',
    RCLONE_CONFIG_C_REMOTE: `raw:${pc.r2}/guests/${name}`,
    RCLONE_CONFIG_C_PASSWORD: obscure(pc.passphrase),
    RCLONE_CONFIG_C_PASSWORD2: obscure(pc.salt),
  };
}

const DOCS = {
  'start-here.mrbl': '<h1>Start here</h1>\n',
  'Notes/Ideas #1.mrbl': '<h1>Ideas</h1>\n',
  'Notes/Café ☕.mrbl': '<h1>Café</h1>\n',
  "System/Design Don'ts.mrbl": "<h1>Design Don'ts</h1>\n",
  'Notes/Empty.mrbl': '',
  ".marble/System%2FDesign Don'ts.history.jsonl": '{"v":1}\n',
  '.marble/agents/c1/events.jsonl': '{"kind":"turn"}\n',
};
const LEFT_OUT = {
  '.marble/agents/host.lock': '4242\n',
  '.marble/usage/2026-10-25.jsonl': '{}\n',
  '.marble/console/backups/report.json': '{}\n',
  '.marble/thumbs/.work-1/t.png': 'png',
};

/** A drive as its own user leaves it: documents, a blob, what a backup leaves
 *  out, links to its login and outside the drive, a pipe, and a login in its
 *  home. Returns the paths a backup keeps. */
function seed(pc, name) {
  for (const [rel, text] of Object.entries({ ...DOCS, ...LEFT_OUT })) pc.put(name, rel, text);
  pc.put(name, '.marble/blobs/0f1e', crypto.randomBytes(200_000));
  const home = path.join(pc.guests, name, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/.credentials.json'), LOGIN);
  fs.symlinkSync(path.join(home, '.claude/.credentials.json'), path.join(pc.drive(name), 'link-to-login'));
  fs.symlinkSync(home, path.join(pc.drive(name), 'link-to-home'));
  execFileSync('mkfifo', [path.join(pc.drive(name), 'pipe')]);
  return [...Object.keys(DOCS), '.marble/blobs/0f1e'].sort();
}

/** sha256 of every regular file a backup keeps, by path. */
function sums(root) {
  const out = {};
  const leftOut = (rel) => rel === '.marble/agents/host.lock' || /^\.marble\/(usage|console\/backups|thumbs\/\.work-[^/]*)\//.test(rel);
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), r);
      else if (entry.isFile() && !leftOut(r)) out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name))).digest('hex');
    }
  };
  walk(root, '');
  return out;
}

/** Every file under a folder, with its bytes. */
function rawFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else out.push({ file, rel: path.relative(root, file), data: fs.readFileSync(file) });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}
const lines = (text) => text.split('\n').filter(Boolean).sort();
const stampOf = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the scripts parse', () => {
  for (const script of SCRIPTS) {
    const r = spawnSync('bash', ['-n', path.join(HOST, script)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${script}: ${r.stderr}`);
  }
  const r = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(open(sys.argv[1]).read())', path.join(HOST, 'backup-tree')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const script of ['backup-guest', 'backup-guests', 'restore-guest', 'remove-guest', 'backup-check.sh', 'backup-tree', 'install.d/20-backup.sh']) {
    assert.ok(fs.statSync(path.join(HOST, script)).mode & 0o111, `${script} is executable`);
  }
});

test('shellcheck finds nothing', { skip: !has('shellcheck') && 'shellcheck is not installed' }, () => {
  const r = spawnSync('shellcheck', ['-x', ...SCRIPTS.map((s) => path.join(HOST, s))], { encoding: 'utf8', cwd: HOST });
  assert.equal(r.status, 0, r.stdout);
});

test('the units verify', { skip: !has('systemd-analyze') && 'systemd-analyze is not installed' }, () => {
  // systemd-analyze checks that each ExecStart exists, so the copies here run
  // the scripts from this checkout; templates are checked as one instance.
  const dir = tmpdir('host-backup-units-');
  for (const unit of UNITS) {
    const text = fs.readFileSync(path.join(HOST, unit), 'utf8').replaceAll('/usr/local/lib/marble-guests/', `${HOST}/`);
    fs.writeFileSync(path.join(dir, unit.replace('@.', '@ana.')), text);
  }
  for (const unit of UNITS.map((u) => u.replace('@.', '@ana.'))) {
    const r = spawnSync('systemd-analyze', ['verify', `./${unit}`], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `${unit}: ${r.stderr}`);
    assert.equal(r.stderr.trim(), '', `${unit}: ${r.stderr}`);
  }
  const timer = fs.readFileSync(path.join(HOST, 'marble-guests-backup.timer'), 'utf8');
  assert.match(timer, /^OnCalendar=hourly$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^RandomizedDelaySec=/m);
  const unit = fs.readFileSync(path.join(HOST, 'marble-guest-backup@.service'), 'utf8');
  for (const line of ['Type=oneshot', 'ProtectHome=yes', 'PrivateTmp=yes', 'ProtectSystem=strict', 'BindReadOnlyPaths=-/var/lib/private/marble-guests/%i', 'LoadCredential=backup.env:/etc/marble-backup/backup.env']) {
    assert.ok(unit.split('\n').includes(line), `marble-guest-backup@.service has ${line}`);
  }
  assert.match(unit, /^InaccessiblePaths=.*-\/etc\/marble-backup .*-\/etc\/marble-guests/m);
});

test('a first backup sends the drive encrypted, and never the home, links, pipes or what is left out', needsRclone, () => {
  const pc = makePC();
  const kept = seed(pc, 'ana');
  const r = pc.run('backup-guest', ['ana']);
  assert.equal(r.status, 0, r.out);

  const status = pc.status('ana');
  assert.deepEqual(Object.keys(status), ['name', 'at', 'ok', 'files', 'bytes', 'changed', 'lastGood']);
  assert.equal(status.name, 'ana');
  assert.equal(status.ok, true);
  assert.equal(status.changed, true);
  assert.equal(status.files, kept.length);
  assert.ok(status.bytes > 200_000);
  assert.equal(status.lastGood, status.at);
  assert.match(status.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(fs.statSync(path.join(pc.state, 'status/ana.json')).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(pc.state, 'status')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(pc.state, 'manifests')).mode & 0o777, 0o700);

  // Through the crypt remote, R2 holds exactly what a backup keeps...
  assert.deepEqual(lines(pc.crypt('ana', ['lsf', '-R', '--files-only', 'c:drive'])), kept);
  assert.deepEqual(lines(pc.crypt('ana', ['lsf', '--files-only', 'c:'])), ['manifest.json']);
  assert.equal(lines(pc.crypt('ana', ['lsf', '--files-only', 'c:manifests'])).length, 1);
  assert.equal(pc.crypt('ana', ['cat', 'c:drive/Notes/Café ☕.mrbl']), DOCS['Notes/Café ☕.mrbl']);
  const manifest = JSON.parse(pc.crypt('ana', ['cat', 'c:manifest.json']));
  assert.equal(manifest.seq, 1);
  assert.deepEqual(Object.keys(manifest.files).sort(), kept);

  // ...and the raw store, R2 itself, holds no name and no byte of it in the clear.
  const raw = rawFiles(path.join(pc.r2, 'guests/ana'));
  assert.ok(raw.length >= kept.length + 2);
  for (const { rel, data } of raw) {
    for (const word of ['start-here', 'Ideas', 'Café', 'Design', '.marble', 'manifest', 'mrbl']) assert.ok(!rel.includes(word), `${rel} names ${word}`);
    for (const text of ['Start here', 'Ideas', LOGIN, '"files"']) assert.ok(!data.includes(text), `${rel} holds ${text}`);
  }
  // The login reached R2 neither as a file nor through a link.
  for (const rel of lines(pc.crypt('ana', ['lsf', '-R', '--files-only', 'c:']))) {
    assert.ok(!pc.crypt('ana', ['cat', `c:${rel}`]).includes(LOGIN), `${rel} holds the login`);
  }
  // The status says nothing of what is in the drive, and holds no key.
  const text = fs.readFileSync(path.join(pc.state, 'status/ana.json'), 'utf8');
  for (const word of ['Ideas', 'start-here', pc.passphrase, pc.salt]) assert.ok(!text.includes(word));
});

test('an unchanged run sends nothing and does not even start rclone', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  const before = rawFiles(pc.r2).map(({ file }) => `${file} ${fs.statSync(file).mtimeMs}`);
  const r = pc.run('backup-guest', ['ana'], { MARBLE_RCLONE: '/nonexistent/rclone' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /unchanged since the backup of/);
  const status = pc.status('ana');
  assert.equal(status.ok, true);
  assert.equal(status.changed, false);
  assert.equal(status.lastGood, status.at);
  assert.deepEqual(rawFiles(pc.r2).map(({ file }) => `${file} ${fs.statSync(file).mtimeMs}`), before);
});

test('changes are sent, and what they replace or delete goes to trash/<utc>/', needsRclone, async () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  await sleep(1100);
  pc.put('ana', 'start-here.mrbl', '<h1>Start here, again</h1>\n');
  fs.rmSync(path.join(pc.drive('ana'), 'Notes/Ideas #1.mrbl'));
  pc.put('ana', 'Notes/New.mrbl', '<h1>New</h1>\n');
  const r = pc.run('backup-guest', ['ana']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /sent 2 files, 1 to trash\/\d{8}T\d{6}Z \(incremental/);
  const status = pc.status('ana');
  assert.equal(status.changed, true);

  const trash = lines(pc.crypt('ana', ['lsf', '--dirs-only', 'c:trash']));
  assert.deepEqual(trash, [`${stampOf(status.at)}/`]);
  const old = `c:trash/${trash[0]}`;
  assert.deepEqual(lines(pc.crypt('ana', ['lsf', '-R', '--files-only', old])), ['Notes/Ideas #1.mrbl', 'start-here.mrbl']);
  assert.equal(pc.crypt('ana', ['cat', `${old}start-here.mrbl`]), DOCS['start-here.mrbl']);
  assert.equal(pc.crypt('ana', ['cat', 'c:drive/start-here.mrbl']), '<h1>Start here, again</h1>\n');
  assert.equal(pc.crypt('ana', ['cat', 'c:drive/Notes/New.mrbl']), '<h1>New</h1>\n');
  assert.ok(!lines(pc.crypt('ana', ['lsf', '-R', '--files-only', 'c:drive'])).includes('Notes/Ideas #1.mrbl'));
  assert.equal(lines(pc.crypt('ana', ['lsf', '--files-only', 'c:manifests'])).length, 2);
  assert.equal(JSON.parse(pc.crypt('ana', ['cat', 'c:manifest.json'])).seq, 2);
});

test('restore --as brings every file back, and leaves the original alone', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  const before = sums(pc.drive('ana'));
  pc.clearLog();
  const r = pc.run('restore-guest', ['ana', '--as', 'ana-copy']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(sums(pc.drive('ana-copy')), before);
  assert.deepEqual(sums(pc.drive('ana')), before);
  assert.ok(!fs.existsSync(path.join(pc.guests, 'ana-copy/home')), 'no home is made');
  assert.ok(!fs.existsSync(path.join(pc.drive('ana-copy'), 'link-to-login')));
  assert.ok(!fs.existsSync(path.join(pc.drive('ana-copy'), 'pipe')));
  assert.ok(!fs.existsSync(path.join(pc.drive('ana-copy'), '.marble/usage')));
  assert.deepEqual(pc.log(), [
    'is-active --quiet marble-guest@ana-copy.service',
    'mask --runtime --quiet marble-guest@ana-copy.service',
    'stop marble-guest@ana-copy.service',
    'unmask --runtime --quiet marble-guest@ana-copy.service',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(pc.state, 'restoring')), []);
});

test('restore --from brings back the drive as an earlier backup saw it', needsRclone, async () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  const first = sums(pc.drive('ana'));
  const firstAt = pc.status('ana').at;
  for (const step of [1, 2]) {
    await sleep(1100);
    pc.put('ana', 'start-here.mrbl', `<h1>Start here, step ${step}</h1>\n`);
    if (step === 1) fs.rmSync(path.join(pc.drive('ana'), "System/Design Don'ts.mrbl"));
    pc.put('ana', `Notes/Step ${step}.mrbl`, `${step}\n`);
    assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  }
  const list = pc.run('restore-guest', ['ana', '--list']);
  assert.equal(list.status, 0, list.out);
  assert.equal(lines(list.stdout).length, 3);
  assert.match(list.stdout, /latest/);

  const r = pc.run('restore-guest', ['ana', '--from', firstAt, '--as', 'ana-then']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(sums(pc.drive('ana-then')), first);
  const stampForm = pc.run('restore-guest', ['ana', '--from', stampOf(firstAt), '--as', 'ana-then2']);
  assert.equal(stampForm.status, 0, stampForm.out);
  assert.deepEqual(sums(pc.drive('ana-then2')), first);
  const early = pc.run('restore-guest', ['ana', '--from', '20000101T000000Z', '--as', 'ana-never']);
  assert.notEqual(early.status, 0);
  assert.match(early.stderr, /no backup of ana is from 20000101T000000Z or before/);
  assert.ok(!fs.existsSync(pc.drive('ana-never')));
});

test('restore in place keeps the drive it replaces, and starts the drive again', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  const backedUp = sums(pc.drive('ana'));
  pc.put('ana', 'Notes/Unsaved.mrbl', 'written after the backup\n');
  fs.writeFileSync(path.join(pc.root, 'active/marble-guest@ana.service'), '');
  pc.clearLog();
  const r = pc.run('restore-guest', ['ana']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /ana is running again/);
  assert.deepEqual(sums(pc.drive('ana')), backedUp);
  const kept = fs.readdirSync(path.join(pc.guests, 'ana')).filter((name) => name.startsWith('drive.kept-'));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /^drive\.kept-\d{8}T\d{6}Z$/);
  assert.equal(fs.readFileSync(path.join(pc.guests, 'ana', kept[0], 'Notes/Unsaved.mrbl'), 'utf8'), 'written after the backup\n');
  assert.equal(fs.readFileSync(path.join(pc.guests, 'ana/home/.claude/.credentials.json'), 'utf8'), LOGIN, 'the home is untouched');
  assert.deepEqual(pc.log(), [
    'is-active --quiet marble-guest@ana.service',
    'mask --runtime --quiet marble-guest@ana.service',
    'stop marble-guest@ana.service',
    'unmask --runtime --quiet marble-guest@ana.service',
    'start marble-guest@ana.service',
  ]);
  // A backup after the restore finds the drive as the backup left it.
  const again = pc.run('backup-guest', ['ana']);
  assert.equal(again.status, 0, again.out);
  assert.equal(pc.status('ana').changed, false);
});

test('a download that does not match its file list changes nothing', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  const before = sums(pc.drive('ana'));
  // One encrypted object lost in R2.
  const encoded = pc.crypt('ana', ['backend', 'encode', 'c:', 'drive/start-here.mrbl']).trim();
  fs.rmSync(path.join(pc.r2, 'guests/ana', encoded));
  fs.writeFileSync(path.join(pc.root, 'active/marble-guest@ana.service'), '');
  pc.clearLog();
  const r = pc.run('restore-guest', ['ana']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match the backup's file list \(files=\d+ differ=0 missing=1 extra=0\); nothing was changed/);
  assert.deepEqual(sums(pc.drive('ana')), before);
  assert.deepEqual(fs.readdirSync(path.join(pc.guests, 'ana')).sort(), ['drive', 'home']);
  assert.deepEqual(pc.log(), [], 'the drive was never stopped');
  assert.deepEqual(fs.readdirSync(path.join(pc.state, 'restoring')), []);
});

test('a drive that lost most of its files is held back until --force', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  const good = pc.status('ana').lastGood;
  // All but start-here.mrbl and the blob: under half, with a document left.
  for (const rel of Object.keys(DOCS).filter((rel) => rel !== 'start-here.mrbl')) fs.rmSync(path.join(pc.drive('ana'), rel));
  const r = pc.run('backup-guest', ['ana']);
  assert.equal(r.status, 1, r.out);
  const status = pc.status('ana');
  assert.equal(status.ok, false);
  assert.equal(status.changed, false);
  assert.match(status.why, /^the drive has 2 files, under half of the 8 last backed up; nothing was sent$/);
  assert.equal(status.lastGood, good);
  assert.equal(lines(pc.crypt('ana', ['lsf', '-R', '--files-only', 'c:drive'])).length, 8);
  const forced = pc.run('backup-guest', ['ana', '--force']);
  assert.equal(forced.status, 0, forced.out);
  assert.equal(pc.status('ana').ok, true);
  assert.equal(lines(pc.crypt('ana', ['lsf', '-R', '--files-only', 'c:drive'])).length, 2);
});

test('a run systemd stops says so in the status', needsRclone, async () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  pc.put('ana', 'Notes/More.mrbl', 'more\n');
  // An rclone that obscures, as the real one does, and hangs on R2.
  const slow = path.join(pc.root, 'slow-rclone');
  fs.writeFileSync(slow, `#!/usr/bin/env bash\nif [[ $1 == obscure ]]; then exec "${RCLONE}" "$@"; fi\nsleep 30\n`, { mode: 0o755 });
  const child = spawn('bash', [path.join(HOST, 'backup-guest'), 'ana'], { env: { ...pc.env, MARBLE_RCLONE: slow }, detached: true, stdio: 'ignore' });
  const ended = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  await sleep(2000);
  // As systemd stops a unit: every process in it at once.
  process.kill(-child.pid, 'SIGTERM');
  assert.equal(await ended, 1);
  const status = pc.status('ana');
  assert.equal(status.ok, false);
  assert.equal(status.why, 'it was stopped before it ended; the next run sends what it did not');
  assert.notEqual(status.lastGood, null);
  const again = pc.run('backup-guest', ['ana']);
  assert.equal(again.status, 0, again.out);
  assert.equal(pc.status('ana').changed, true);
});

test('a backup R2 does not take fails, says so in the status, and keeps the last good time', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  const good = pc.status('ana').lastGood;
  // A stand-in R2 that is a file where a folder should be.
  fs.writeFileSync(path.join(pc.root, 'blocked'), 'not a folder');
  pc.put('ana', 'Notes/Even more.mrbl', 'more\n');
  const blocked = pc.run('backup-guest', ['ana'], { GUEST_BACKUP_LOCAL_DIR: path.join(pc.root, 'blocked') });
  assert.equal(blocked.status, 1, blocked.out);
  const status = pc.status('ana');
  assert.equal(status.ok, false);
  assert.match(status.why, /^R2 (could not be reached|did not take the drive \(rclone exit \d+\))$/);
  assert.notEqual(status.lastGood, null);
  assert.ok(status.lastGood >= good);
  assert.ok(!status.why.includes('Even more'));
});

test('backup-tree never follows a link or opens a pipe swapped in after the scan', () => {
  const root = tmpdir('host-backup-tree-');
  const drive = path.join(root, 'drive');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(drive, 'x'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(drive, 'x/secret.txt'), 'a decoy\n');
  fs.writeFileSync(path.join(drive, 'p'), 'a file\n');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'the key\n');
  const tree = (...args) => spawnSync('python3', ['-I', path.join(HOST, 'backup-tree'), ...args], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(tree('scan', drive, path.join(root, 'scan.json')).status, 0);
  // Between the scan and the copy, the folder becomes a link out and the file a pipe.
  fs.rmSync(path.join(drive, 'x'), { recursive: true });
  fs.symlinkSync(outside, path.join(drive, 'x'));
  fs.rmSync(path.join(drive, 'p'));
  execFileSync('mkfifo', [path.join(drive, 'p')]);
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  const r = tree('prepare', drive, path.join(root, 'scan.json'), '-', work, '1', '2026-10-25T17:00:00Z');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^mode=full differ=0 extra=0 files=0 /);
  assert.deepEqual(fs.readdirSync(path.join(work, 'stage')), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8')).files, {});
  // And a drive folder that is itself a link is not read at all.
  fs.symlinkSync(outside, path.join(root, 'linked'));
  const linked = tree('scan', path.join(root, 'linked'), path.join(root, 'linked.json'));
  assert.equal(linked.status, 3);
  assert.match(linked.stdout, /refused=not-a-folder/);
});

test('a file name with a line break is sent by a full sync and restored', needsRclone, async () => {
  const pc = makePC();
  seed(pc, 'ana');
  pc.put('ana', 'Notes/two\nlines.mrbl', 'two lines\n');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  await sleep(1100);
  pc.put('ana', 'Notes/two\nlines.mrbl', 'two lines, changed\n');
  const r = pc.run('backup-guest', ['ana']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /\(full;/);
  const restored = pc.run('restore-guest', ['ana', '--as', 'ana-copy']);
  assert.equal(restored.status, 0, restored.out);
  assert.deepEqual(sums(pc.drive('ana-copy')), sums(pc.drive('ana')));
});

test('backup-guests backs up each drive folder in turn, and drops the status of drives that are gone', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  seed(pc, 'ben');
  fs.mkdirSync(path.join(pc.guests, 'no-drive-yet'));
  fs.mkdirSync(path.join(pc.state, 'status'), { recursive: true });
  fs.writeFileSync(path.join(pc.state, 'status/gone.json'), '{}');
  const r = pc.run('backup-guests');
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /backed up 2 drives/);
  assert.deepEqual(pc.log(), ['start marble-guest-backup@ana.service', 'start marble-guest-backup@ben.service']);
  assert.equal(pc.status('ana').ok, true);
  assert.equal(pc.status('ben').ok, true);
  assert.deepEqual(fs.readdirSync(path.join(pc.state, 'status')).sort(), ['ana.json', 'ben.json']);
});

test('remove-guest refuses while the drive runs or keeps its settings, then deletes it from the PC and not from R2', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  fs.symlinkSync('../private/marble-guests/ana', path.join(pc.links, 'ana'));
  fs.writeFileSync(path.join(pc.root, 'active/marble-guest@ana.service'), '');
  fs.writeFileSync(path.join(pc.etc, 'ana.env'), 'PORT=4501\n');
  let r = pc.run('remove-guest', ['ana']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /marble-guest@ana.service is active; marble-host stops it before removing the drive/);
  fs.rmSync(path.join(pc.root, 'active/marble-guest@ana.service'));
  r = pc.run('remove-guest', ['ana']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ana.env is still there/);
  assert.ok(fs.existsSync(pc.drive('ana')));
  fs.rmSync(path.join(pc.etc, 'ana.env'));
  r = pc.run('remove-guest', ['ana']);
  assert.equal(r.status, 0, r.out);
  assert.ok(!fs.existsSync(path.join(pc.guests, 'ana')));
  assert.ok(!fs.existsSync(path.join(pc.links, 'ana')));
  assert.ok(!fs.existsSync(path.join(pc.state, 'status/ana.json')));
  assert.ok(!fs.existsSync(path.join(pc.state, 'manifests/ana.json')));
  assert.match(r.stdout, /stays in R2 under guests\/ana\/; to delete that too, by hand: sudo \/usr\/local\/lib\/marble-guests\/backup-guest ana --forget --yes/);
  assert.ok(rawFiles(path.join(pc.r2, 'guests/ana')).length > 0, 'the backup in R2 stays');
  r = pc.run('remove-guest', ['ana']);
  assert.equal(r.status, 0, 'a second removal has nothing to do');
});

test('backup-guest --forget deletes the backup in R2 only once the drive is off the PC, and only with --yes', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  assert.equal(pc.run('backup-guest', ['ana']).status, 0);
  let r = pc.run('backup-guest', ['ana', '--forget', '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /still has a folder on the PC/);
  fs.rmSync(path.join(pc.guests, 'ana'), { recursive: true });
  r = pc.run('backup-guest', ['ana', '--forget']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Add --yes to do it/);
  assert.ok(rawFiles(path.join(pc.r2, 'guests/ana')).length > 0);
  r = pc.run('backup-guest', ['ana', '--forget', '--yes']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(rawFiles(path.join(pc.r2, 'guests/ana')), []);
});

test('backup-guest --trash-prefix prints the encrypted prefix for a lifecycle rule', needsRclone, () => {
  const pc = makePC();
  const r = pc.run('backup-guest', ['ana', '--trash-prefix']);
  assert.equal(r.status, 0, r.out);
  const encoded = pc.crypt('ana', ['backend', 'encode', 'c:', 'trash']).trim();
  assert.equal(r.stdout.trim(), `guests/ana/${encoded}/`);
});

test('names that are not drive names are refused before anything is read', () => {
  const pc = makePC();
  for (const script of ['backup-guest', 'restore-guest', 'remove-guest']) {
    for (const name of ['../etc', 'Ana', 'a', '-x', 'ana/drive']) {
      const r = pc.run(script, [name]);
      assert.equal(r.status, 2, `${script} ${name}: ${r.out}`);
    }
  }
  const r = pc.run('restore-guest', ['ana', '--as', '../x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--as takes a drive's name/);
});

test('backup-check.sh passes end to end, and leaves nothing behind', needsRclone, () => {
  const pc = makePC();
  const r = pc.run('backup-check.sh');
  assert.equal(r.status, 0, r.out);
  const results = lines(r.stdout);
  assert.ok(results.length >= 12, r.stdout);
  for (const line of results) assert.match(line, /^PASS /);
  assert.deepEqual(fs.readdirSync(pc.guests), []);
  assert.deepEqual(fs.readdirSync(path.join(pc.state, 'status')), []);
  assert.deepEqual(rawFiles(path.join(pc.r2, 'guests')), []);
});

test('backup-check.sh with a drive restores a copy of it, and deletes only the copy', needsRclone, () => {
  const pc = makePC();
  seed(pc, 'ana');
  const r = pc.run('backup-check.sh', ['ana']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /^PASS restore: every file came back the same, by checksum \(8 files; 0 changed in ana since the backup, not compared\)$/m);
  assert.deepEqual(fs.readdirSync(pc.guests), ['ana']);
  assert.equal(pc.status('ana').ok, true);
  assert.ok(rawFiles(path.join(pc.r2, 'guests/ana')).length > 0, "ana's backup stays");
});

test('20-backup.sh writes backup.env once, from the hub settings, and never prints a secret', needsRclone, () => {
  const root = tmpdir('host-backup-install-');
  // install.sh hands the piece the owner's real home; under a stand-in root
  // the piece reads it from the stand-in, so a test never reads a real one.
  const ownerHome = '/home/tester';
  const home = path.join(root, 'fs', ownerHome);
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config/marble-drive'), { recursive: true });
  fs.symlinkSync(RCLONE, path.join(home, '.local/bin/rclone'));
  const r2 = { R2_ACCOUNT_ID: 'acct0123456789abcdef', R2_ACCESS_KEY_ID: 'AKIDexample42', R2_SECRET_ACCESS_KEY: 'SeCrEt-example-9876543210', R2_BUCKET: 'marble-drives' };
  fs.writeFileSync(path.join(home, '.config/marble-drive/hub-bryan.env'),
    `HUB_DRIVE=bryan\nHUB_MACHINE=pc\nHUB_PASSPHRASE=the-hubs-own\nHUB_SALT=the-hubs-salt\nR2_ACCOUNT_ID=${r2.R2_ACCOUNT_ID}\nR2_ACCESS_KEY_ID="${r2.R2_ACCESS_KEY_ID}"\nR2_SECRET_ACCESS_KEY=${r2.R2_SECRET_ACCESS_KEY}\nR2_BUCKET=${r2.R2_BUCKET}\n`);
  fs.writeFileSync(path.join(root, 'systemctl'), `#!/usr/bin/env bash\necho "$*" >>"${root}/systemctl.log"\n`, { mode: 0o755 });
  const install = (args = [], env = {}) => {
    const r = spawnSync('bash', [path.join(HOST, 'install.d/20-backup.sh'), ...args], {
      env: { ...process.env, OWNER: 'tester', OWNER_HOME: ownerHome, OPT: '/opt/marble', ETC: '/etc/marble-guests', RELEASE_DIR: path.resolve(HOST, '../..'), MARBLE_INSTALL_ROOT: path.join(root, 'fs'), MARBLE_SYSTEMCTL: path.join(root, 'systemctl'), ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const fsRoot = path.join(root, 'fs');
  const envFile = path.join(fsRoot, 'etc/marble-backup/backup.env');

  const first = install();
  assert.equal(first.status, 0, first.out);
  assert.match(first.out, /save GUEST_BACKUP_PASSPHRASE and GUEST_BACKUP_SALT in your password manager now \(sudo cat .*backup\.env\)/);
  const text = fs.readFileSync(envFile, 'utf8');
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(envFile)).mode & 0o777, 0o700);
  const values = Object.fromEntries(text.split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => l.split('=')));
  assert.deepEqual(Object.keys(values), ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'GUEST_BACKUP_PASSPHRASE', 'GUEST_BACKUP_SALT']);
  for (const [key, value] of Object.entries(r2)) assert.equal(values[key], value);
  assert.match(values.GUEST_BACKUP_PASSPHRASE, /^[0-9a-f]{64}$/);
  assert.match(values.GUEST_BACKUP_SALT, /^[0-9a-f]{64}$/);
  assert.notEqual(values.GUEST_BACKUP_PASSPHRASE, values.GUEST_BACKUP_SALT);
  assert.ok(!text.includes('the-hubs-own') && !text.includes('the-hubs-salt'), 'never the hub passphrase');
  for (const secret of [values.GUEST_BACKUP_PASSPHRASE, values.GUEST_BACKUP_SALT, r2.R2_SECRET_ACCESS_KEY, r2.R2_ACCESS_KEY_ID]) {
    assert.ok(!first.out.includes(secret), 'nothing printed holds a secret');
  }
  const tools = path.join(fsRoot, 'usr/local/lib/marble-guests');
  assert.deepEqual(fs.readdirSync(tools).sort(), ['backup-check.sh', 'backup-guest', 'backup-guests', 'backup-lib.sh', 'backup-tree', 'rclone', 'remove-guest', 'restore-guest']);
  assert.equal(fs.statSync(path.join(tools, 'backup-guest')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(tools, 'backup-lib.sh')).mode & 0o777, 0o644);
  assert.ok(!fs.lstatSync(path.join(tools, 'rclone')).isSymbolicLink(), 'a copy of rclone, not a link into the home');
  assert.deepEqual(fs.readdirSync(path.join(fsRoot, 'etc/systemd/system')).sort(), [...UNITS].sort());
  assert.equal(fs.statSync(path.join(fsRoot, 'var/lib/marble-backup/status')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(fsRoot, 'var/lib/marble-backup/manifests')).mode & 0o777, 0o700);
  assert.deepEqual(fs.readFileSync(path.join(root, 'systemctl.log'), 'utf8').trim().split('\n'), ['daemon-reload', 'enable --now marble-guests-backup.timer']);

  // Again: the settings, and so the passphrase, stay as they were.
  const second = install();
  assert.equal(second.status, 0, second.out);
  assert.match(second.out, /kept .*backup\.env as it was/);
  assert.equal(fs.readFileSync(envFile, 'utf8'), text);

  // The wrong rclone is refused before anything is written.
  fs.rmSync(path.join(home, '.local/bin/rclone'));
  fs.writeFileSync(path.join(home, '.local/bin/rclone'), '#!/bin/sh\necho "rclone v1.60.0"\n', { mode: 0o755 });
  fs.rmSync(envFile);
  const wrong = install();
  assert.equal(wrong.status, 1);
  assert.ok(wrong.out.includes(`is rclone v1.60.0, not rclone v${PIN}`), wrong.out);
  assert.ok(!fs.existsSync(envFile));
  assert.ok(fs.existsSync(path.join(tools, 'rclone')), 'the copy that was checked before stays');

  // Hub settings without the R2 keys write nothing.
  fs.rmSync(path.join(home, '.local/bin/rclone'));
  fs.symlinkSync(RCLONE, path.join(home, '.local/bin/rclone'));
  fs.writeFileSync(path.join(home, '.config/marble-drive/hub-bryan.env'), 'HUB_DRIVE=bryan\nR2_BUCKET=marble-drives\n');
  const lacking = install();
  assert.equal(lacking.status, 1);
  assert.match(lacking.out, /lacks R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; backups stay off/);
  assert.ok(!fs.existsSync(envFile));

  // Handed a real home, as install.sh hands it, a stand-in root reads none of
  // it: the piece looks for the home under the stand-in.
  const elsewhere = path.join(root, 'elsewhere');
  const real = install([], { OWNER_HOME: os.homedir(), MARBLE_INSTALL_ROOT: elsewhere });
  assert.equal(real.status, 1);
  assert.ok(real.out.includes(`no rclone at ${elsewhere}${os.homedir()}/.local/bin/rclone`), real.out);
  assert.ok(!fs.existsSync(path.join(elsewhere, 'etc/marble-backup/backup.env')));

  // Uninstalling takes the units and tools away and keeps the key.
  fs.writeFileSync(envFile, text);
  const gone = install(['--uninstall']);
  assert.equal(gone.status, 0, gone.out);
  assert.ok(!fs.existsSync(tools));
  assert.deepEqual(fs.readdirSync(path.join(fsRoot, 'etc/systemd/system')), []);
  assert.equal(fs.readFileSync(envFile, 'utf8'), text);
  assert.match(gone.out, /kept .*marble-backup \(its passphrase and salt are the only way to read the backups in R2\)/);
});
