// The Mac's backup agent (tools/backup-agent.mjs) against a fake `sprite` that
// runs each exec on this machine, in a folder standing in for the sprite's
// /drive/.marble/console/backups, and fake backup and restore tools. What
// matters: it never touches a sleeping sprite with nothing to do, it reports
// while the sprite is awake, and each request is acted on once.

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

const FAKE_SPRITE = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
if [[ $1 == api ]]; then printf '{"name":"admin-p1","status":"%s"}' "$(cat "$FAKE_STATUS")"; exit 0; fi
if [[ $1 == exec ]]; then
  while [[ $# -gt 0 && $1 != -- ]]; do shift; done; shift
  exec "$@"
fi
exit 1
`;
const FAKE_BACKUP = `#!/usr/bin/env bash
sprite=$1; shift; to=""; why=asked; sched=0
while [[ $# -gt 0 ]]; do case $1 in --to) to=$2; shift 2;; --why) why=$2; shift 2;; --if-changed) sched=1; shift;; *) shift;; esac; done
[[ $sched == 1 && ! -f "$FAKE_DIR/scheduled-due" ]] && exit 0
rm -f "$FAKE_DIR/scheduled-due"
n=$(ls "$to/$sprite" 2>/dev/null | grep -c Z$ || true)
name=$(printf '2026-09-27T12%02d00Z' "$n")
mkdir -p "$to/$sprite/$name"
printf '{"name":"%s","documents":3,"files":9,"added":100,"took":1,"why":"%s"}\\n' "$name" "$why" >> "$to/$sprite/.snapshots.jsonl"
echo "t backing up $sprite ($why) -> $to/$sprite/$name"
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
  const remote = path.join(dir, 'remote');
  const to = path.join(dir, 'backups');
  fs.writeFileSync(path.join(dir, 'status'), 'warm');
  const env = {
    ...process.env,
    SPRITE_BIN: bin('sprite', FAKE_SPRITE),
    BACKUP_TOOL: bin('backup', FAKE_BACKUP),
    RESTORE_TOOL: bin('restore', FAKE_RESTORE),
    BACKUP_REMOTE_DIR: remote,
    FAKE_LOG: path.join(dir, 'calls'),
    FAKE_STATUS: path.join(dir, 'status'),
    FAKE_DIR: dir,
  };
  return {
    dir,
    remote,
    to,
    status: (s) => fs.writeFileSync(path.join(dir, 'status'), s),
    due: () => fs.writeFileSync(path.join(dir, 'scheduled-due'), ''),
    agent: async () => (await run(process.execPath, [AGENT, 'admin-p1', '--to', to], { env })).stdout,
    calls: () => (fs.existsSync(env.FAKE_LOG) ? fs.readFileSync(env.FAKE_LOG, 'utf8').trim().split('\n') : []),
    report: () => JSON.parse(fs.readFileSync(path.join(remote, 'admin-p1.json'), 'utf8')),
    ask: (req) => {
      fs.mkdirSync(path.join(remote, 'requests'), { recursive: true });
      const full = { sprite: 'admin-p1', at: new Date().toISOString(), ...req };
      fs.writeFileSync(path.join(remote, 'requests', `${full.id}.json`), `${JSON.stringify(full)}\n`);
    },
    requests: () => (fs.existsSync(path.join(remote, 'requests')) ? fs.readdirSync(path.join(remote, 'requests')) : []),
  };
}

test('asleep with nothing due: one API call, and the sprite is never touched', async () => {
  const w = await world();
  await w.agent();
  assert.deepEqual(w.calls().map((c) => c.split(' ')[0]), ['api']);
  assert.ok(!fs.existsSync(path.join(w.remote, 'admin-p1.json')));
});

test('awake: it checks in with a report of what it keeps', async () => {
  const w = await world();
  w.status('running');
  w.due();
  await w.agent();
  const r = w.report();
  assert.equal(r.sprite, 'admin-p1');
  assert.equal(r.schedule, 'on');
  assert.equal(r.snapshots.length, 1);
  assert.equal(r.snapshots[0].documents, 3);
  assert.equal(r.last.ok, true);
  assert.equal(r.last.why, 'asked');
  assert.ok(Date.now() - Date.parse(r.heardAt) < 60_000);
  assert.ok(Number.isFinite(r.disk.free));
});

test('asleep but a backup was due: it reports, since the backup woke it anyway', async () => {
  const w = await world();
  w.due();
  await w.agent();
  assert.equal(w.report().snapshots.length, 1);
});

test('a request is taken off the sprite, done once, and never replayed', async () => {
  const w = await world();
  w.status('running');
  w.ask({ id: 'req-1', kind: 'backup' });
  await w.agent();
  assert.deepEqual(w.requests(), []);
  let r = w.report();
  assert.equal(r.results[0].id, 'req-1');
  assert.equal(r.results[0].state, 'done');
  assert.equal(r.snapshots.length, 1);
  assert.equal(r.snapshots[0].why, 'asked from the Console');

  // The same request again, as a restored snapshot might bring it back.
  w.ask({ id: 'req-1', kind: 'backup' });
  await w.agent();
  assert.deepEqual(w.requests(), []);
  r = w.report();
  assert.equal(r.snapshots.length, 1, 'not backed up twice');
});

test('a request older than an hour is refused', async () => {
  const w = await world();
  w.status('running');
  w.ask({ id: 'old-1', kind: 'backup', at: new Date(Date.now() - 2 * 3600_000).toISOString() });
  await w.agent();
  const r = w.report();
  assert.equal(r.results[0].state, 'failed');
  assert.match(r.results[0].note, /Older than an hour/);
  assert.equal(r.snapshots.length, 0);
});

test('schedule off stops scheduled backups, not requests; on starts them again', async () => {
  const w = await world();
  w.status('running');
  w.ask({ id: 's-1', kind: 'schedule', on: false });
  await w.agent();
  assert.equal(w.report().schedule, 'off');
  w.due();
  await w.agent();
  assert.equal(w.report().snapshots.length, 0, 'no scheduled backup while off');
  w.ask({ id: 'b-1', kind: 'backup' });
  await w.agent();
  assert.equal(w.report().snapshots.length, 1, 'a request still works');
  w.ask({ id: 's-2', kind: 'schedule', on: true });
  await w.agent();
  assert.equal(w.report().schedule, 'on');
});

test('restore runs the restore tool on that snapshot and target, confirmed', async () => {
  const w = await world();
  w.status('running');
  w.ask({ id: 'b-1', kind: 'backup' });
  await w.agent();
  const snap = w.report().snapshots[0].name;
  w.ask({ id: 'r-1', kind: 'restore', snapshot: snap, target: 't-bryan' });
  w.ask({ id: 'r-2', kind: 'restore', snapshot: '2020-01-01T000000Z', target: 't-bryan' });
  await w.agent();
  const restores = fs.readFileSync(path.join(w.dir, 'restores'), 'utf8').trim().split('\n');
  assert.equal(restores.length, 1);
  assert.equal(restores[0], `${path.join(w.to, 'admin-p1', snap)} t-bryan --org marble-drive --yes`);
  const r = w.report();
  assert.equal(r.results.find((x) => x.id === 'r-1').state, 'done');
  assert.match(r.results.find((x) => x.id === 'r-2').note, /No snapshot/);
});
