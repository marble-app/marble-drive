import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { backupNow, sweep } from '../server/backup.js';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-backup-'));
const OUT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-backups-'));

await fsp.mkdir(path.join(ROOT, '.marble/history/notes'), { recursive: true });
await fsp.writeFile(path.join(ROOT, 'notes.mrbl'), '<html>notes</html>');
await fsp.writeFile(path.join(ROOT, '.marble/history/notes/abc.mrbl.gz'), 'gz');

test('a backup carries the documents and the history, because the history is the undo', async () => {
  const result = await backupNow({ root: ROOT, dir: OUT, at: new Date('2026-01-01T09:00:00Z') });
  assert.equal(result.ok, true);
  assert.equal(await fsp.readFile(path.join(result.target, 'notes.mrbl'), 'utf8'), '<html>notes</html>');
  assert.equal(
    await fsp.readFile(path.join(result.target, '.marble/history/notes/abc.mrbl.gz'), 'utf8'),
    'gz',
  );
});

test('with nowhere to send it, it says so instead of pretending', async () => {
  const result = await backupNow({ root: ROOT, dir: null, command: null });
  assert.equal(result.ok, false);
  assert.match(result.why, /MARBLE_DRIVE_BACKUP_DIR/);
});

test('a command is run with the root and the stamp in its environment', async () => {
  const marker = path.join(OUT, 'ran.txt');
  const result = await backupNow({
    root: ROOT,
    command: `printf '%s' "$MARBLE_DRIVE_ROOT" > ${JSON.stringify(marker)}`,
  });
  assert.equal(result.ok, true);
  assert.equal(await fsp.readFile(marker, 'utf8'), ROOT);
});

test('old backups are swept, newest kept, by name', async () => {
  for (const stamp of ['2026-01-01_09-00-00', '2026-01-02_09-00-00', '2026-01-03_09-00-00']) {
    await fsp.mkdir(path.join(OUT, stamp), { recursive: true });
  }
  const before = (await fsp.readdir(OUT)).filter((name) => /^\d{4}-/.test(name));
  const dropped = await sweep(OUT, 2);
  const left = (await fsp.readdir(OUT)).filter((name) => /^\d{4}-/.test(name)).sort();
  assert.equal(dropped, before.length - 2);
  assert.deepEqual(left, ['2026-01-02_09-00-00', '2026-01-03_09-00-00']);
});

test.after(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
  await fsp.rm(OUT, { recursive: true, force: true });
});
