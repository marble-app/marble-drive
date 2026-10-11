// The Mac's backup agent (tools/backup-agent.mjs) against a fake `sprite` that
// runs each exec on this machine, in a folder standing in for the sprite's
// /drive, and fake backup and restore tools. What matters: it never touches a
// sleeping sprite with nothing to do; it copies only after real changes, once
// they have gone quiet or an hour into a stream of them, and once when the
// drive goes to sleep with changes; and each request is acted on once.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'backup-agent.mjs');

// GNU find's -printf is the sprite's; this Mac's find says the same with stat.
const FAKE_SPRITE = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case $1 in
  api) printf '{"name":"admin-p1","status":"%s"}' "$(cat "$FAKE_STATUS")"; exit 0 ;;
  checkpoint|restore) exit 0 ;;
  exec)
    while [[ $# -gt 0 && $1 != -- ]]; do shift; done; shift
    if [[ $1 == sh && $2 == -c ]]; then
      script=$3
      script=\${script//"-printf '%T@\\\\n'"/"-exec stat -f %m {} +"}
      exec sh -c "$script"
    fi
    exec "$@" ;;
esac
exit 1
`;
const FAKE_BACKUP = `#!/usr/bin/env bash
sprite=$1; shift; to=""; link=""; why=asked
while [[ $# -gt 0 ]]; do case $1 in --to) to=$2; shift 2;; --link) link=$2; shift 2;; --why) why=$2; shift 2;; *) shift;; esac; done
n=$(cat "$FAKE_DIR/count" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE_DIR/count"
name=$(printf '2026-09-28T00%02d00Z' "$n")
mkdir -p "$to/$name/.marble"
printf '{"from":"%s","checkpoint":"v%s","syncedAt":"%s","documents":3,"files":9,"added":100,"took":1,"why":"%s"}\\n' "$sprite" "$((40 + n))" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$why" > "$to/$name/.marble/sync.json"
ln -sfn "$to/$name" "$link"
for d in "$to"/2026-*; do [[ $d == "$to/$name" ]] || rm -rf "$d"; done
echo "$why" >> "$FAKE_DIR/whys"
echo "t backing up $sprite ($why) -> $to/$name"
echo "t done: $name, 3 documents"
`;
const FAKE_RESTORE = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/restores"
echo "==> done: $2 serves the restored drive"
`;

async function world() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'backup-agent-'));
  const bin = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body, { mode: 0o755 });
    return p;
  };
  const drive = path.join(dir, 'drive');
  const remote = path.join(drive, '.marble', 'console', 'backups');
  const to = path.join(dir, 'Marble Backups');
  const link = path.join(dir, 'Marble Drive');
  fs.mkdirSync(path.join(drive, '.marble', 'usage'), { recursive: true });
  const long = new Date(Date.now() - 3 * 3600_000);
  const doc = path.join(drive, 'notes.mrbl');
  fs.writeFileSync(doc, '<p>hi</p>');
  fs.utimesSync(doc, long, long);
  fs.writeFileSync(path.join(dir, 'status'), 'warm');
  const env = {
    ...process.env,
    SPRITE_BIN: bin('sprite', FAKE_SPRITE),
    BACKUP_TOOL: bin('backup', FAKE_BACKUP),
    RESTORE_TOOL: bin('restore', FAKE_RESTORE),
    BACKUP_REMOTE_DRIVE: drive,
    FAKE_LOG: path.join(dir, 'calls'),
    FAKE_STATUS: path.join(dir, 'status'),
    FAKE_DIR: dir,
  };
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : []);
  const statePath = path.join(to, '.agent.json');
  return {
    dir,
    to,
    link,
    status: (s) => fs.writeFileSync(path.join(dir, 'status'), s),
    /** A file in the drive changed `minutesAgo` minutes ago. */
    touch: (rel, minutesAgo = 0) => {
      const f = path.join(drive, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, String(Math.random()));
      const t = new Date(Date.now() - minutesAgo * 60_000);
      fs.utimesSync(f, t, t);
    },
    state: () => JSON.parse(fs.readFileSync(statePath, 'utf8')),
    setState: (patch) => fs.writeFileSync(statePath, JSON.stringify({ ...JSON.parse(fs.readFileSync(statePath, 'utf8')), ...patch })),
    agent: async () => (await run(process.execPath, [AGENT, 'admin-p1', '--to', to, '--link', link], { env })).stdout,
    calls: () => read(env.FAKE_LOG),
    whys: () => read(path.join(dir, 'whys')),
    report: () => JSON.parse(fs.readFileSync(path.join(remote, 'admin-p1.json'), 'utf8')),
    ask: (req) => {
      fs.mkdirSync(path.join(remote, 'requests'), { recursive: true });
      const full = { sprite: 'admin-p1', at: new Date().toISOString(), ...req };
      fs.writeFileSync(path.join(remote, 'requests', `${full.id}.json`), `${JSON.stringify(full)}\n`);
    },
    requests: () => (fs.existsSync(path.join(remote, 'requests')) ? fs.readdirSync(path.join(remote, 'requests')) : []),
  };
}

test('asleep with nothing to do: one API call, and the sprite is never touched', async () => {
  const w = await world();
  await w.agent();
  assert.deepEqual(w.calls().map((c) => c.split(' ')[0]), ['api']);
  assert.deepEqual(w.whys(), []);
});

test('awake: the first copy, then nothing while nothing changes', async () => {
  const w = await world();
  w.status('running');
  await w.agent();
  assert.deepEqual(w.whys(), ['first backup']);
  let r = w.report();
  assert.equal(r.copy.name, fs.realpathSync(w.link).split('/').at(-1));
  assert.equal(r.copy.checkpoint, 'v40');
  assert.equal(r.changes.waiting, false);
  assert.deepEqual(r.rule, { quiet: 10, most: 60 });

  // Awake and untouched, however long: the ledger and the report are not changes.
  w.touch('.marble/usage/2026-09-28.jsonl');
  w.touch('.marble/usage-last.json');
  await w.agent();
  await w.agent();
  assert.deepEqual(w.whys(), ['first backup']);
  r = w.report();
  assert.equal(r.changes.waiting, false);
  assert.ok(Date.now() - Date.parse(r.heardAt) < 60_000, 'it still checks in');
});

test('a change waits until the drive has been quiet for ten minutes', async () => {
  const w = await world();
  w.status('running');
  await w.agent();
  w.touch('notes.mrbl', 0);
  await w.agent();
  let r = w.report();
  assert.equal(r.changes.waiting, true);
  assert.ok(Date.parse(r.changes.next) - Date.now() > 8 * 60_000, 'next is about ten minutes out');
  assert.deepEqual(w.whys(), ['first backup']);

  w.touch('notes.mrbl', 11);
  const now = Math.floor(Date.now() / 1000);
  w.setState({ synced: now - 20 * 60, changed: now - 11 * 60 });
  await w.agent();
  assert.deepEqual(w.whys(), ['first backup', 'quiet after changes']);
  r = w.report();
  assert.equal(r.changes.waiting, false);
});

test('changes that keep coming are copied once an hour', async () => {
  const w = await world();
  w.status('running');
  await w.agent();
  w.setState({ synced: Math.floor(Date.now() / 1000) - 61 * 60 });
  w.touch('Research/paper.mrbl', 0);
  await w.agent();
  assert.deepEqual(w.whys(), ['first backup', 'hourly while working']);
});

test('asleep with changes not yet copied: one copy, then it is left asleep', async () => {
  const w = await world();
  w.status('running');
  await w.agent();
  w.touch('notes.mrbl', 0);
  await w.agent();
  w.status('warm');
  await w.agent();
  assert.deepEqual(w.whys(), ['first backup', 'went to sleep with changes']);
  const before = w.calls().length;
  await w.agent();
  await w.agent();
  assert.deepEqual(w.whys(), ['first backup', 'went to sleep with changes'], 'its own wake is not a change');
  assert.deepEqual(w.calls().slice(before).map((c) => c.split(' ')[0]), ['api', 'api']);
});

test('a request is taken off the sprite, done once, and never replayed', async () => {
  const w = await world();
  w.status('running');
  await w.agent();
  w.ask({ id: 'req-1', kind: 'backup' });
  await w.agent();
  assert.deepEqual(w.requests(), []);
  let r = w.report();
  assert.equal(r.results[0].id, 'req-1');
  assert.equal(r.results[0].state, 'done');
  assert.deepEqual(w.whys(), ['first backup', 'asked from the Console']);

  // The same request again, as a restored drive might bring it back.
  w.ask({ id: 'req-1', kind: 'backup' });
  await w.agent();
  assert.deepEqual(w.requests(), []);
  assert.deepEqual(w.whys(), ['first backup', 'asked from the Console'], 'not done twice');

  w.ask({ id: 'old-1', kind: 'backup', at: new Date(Date.now() - 2 * 3600_000).toISOString() });
  await w.agent();
  r = w.report();
  assert.match(r.results.find((x) => x.id === 'old-1').note, /Older than an hour/);
});

test('schedule off stops the automatic copies, not a request; on starts them again', async () => {
  const w = await world();
  w.status('running');
  w.ask({ id: 's-1', kind: 'schedule', on: false });
  await w.agent();
  assert.equal(w.report().schedule, 'off');
  assert.deepEqual(w.whys(), []);
  w.ask({ id: 'b-1', kind: 'backup' });
  await w.agent();
  assert.deepEqual(w.whys(), ['asked from the Console']);
  w.ask({ id: 's-2', kind: 'schedule', on: true });
  await w.agent();
  assert.equal(w.report().schedule, 'on');
});

test('restoring the copy runs the restore tool on it; restoring a checkpoint checkpoints first, then copies again', async () => {
  const w = await world();
  w.status('running');
  await w.agent();
  const name = w.report().copy.name;
  w.ask({ id: 'r-1', kind: 'restore', snapshot: name, target: 't-bryan' });
  w.ask({ id: 'r-2', kind: 'restore', snapshot: '2020-01-01T000000Z', target: 't-bryan' });
  await w.agent();
  const restores = fs.readFileSync(path.join(w.dir, 'restores'), 'utf8').trim().split('\n');
  assert.deepEqual(restores, [`${fs.realpathSync(w.link)} t-bryan --org marble-drive --yes`]);
  let r = w.report();
  assert.equal(r.results.find((x) => x.id === 'r-1').state, 'done');
  assert.match(r.results.find((x) => x.id === 'r-2').note, /not 2020/);

  w.ask({ id: 'c-1', kind: 'checkpoint', checkpoint: 'v41' });
  await w.agent();
  const calls = w.calls();
  const made = calls.findIndex((c) => c.startsWith('checkpoint create') && c.includes('before restoring v41'));
  const restored = calls.findIndex((c) => c.startsWith('restore v41 -o marble-drive -s admin-p1'));
  assert.ok(made >= 0 && restored > made, 'a checkpoint of what is there, then the restore');
  assert.deepEqual(w.whys().at(-1), 'after a restore', 'restored files keep old times, so it copies regardless');
  r = w.report();
  assert.match(r.results.find((x) => x.id === 'c-1').note, /Restored v41/);
});
