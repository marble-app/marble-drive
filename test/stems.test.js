import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createStems, stemPaths } from '../server/stems/index.js';
import { createStore } from '../server/store/index.js';

// A stand-in for split.py: speaks the same JSON lines and writes the same two
// files, in a few milliseconds, so the queue can be tested without a model.
const FAKE = `
const [, input, out, mode] = process.argv;
const fs = require('node:fs');
const say = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
say({ stage: 'splitting', device: 'fake' });
if (mode === 'fail') { process.stderr.write('the model fell over\\n'); process.exit(3); }
const hold = mode === 'hang' ? 60000 : 30;
say({ progress: 0.5 });
setTimeout(() => {
  fs.mkdirSync(out, { recursive: true });
  const bytes = fs.readFileSync(input);
  fs.writeFileSync(out + '/vocals.flac', Buffer.concat([Buffer.from('V:'), bytes]));
  fs.writeFileSync(out + '/instrumental.flac', Buffer.concat([Buffer.from('I:'), bytes]));
  say({ done: true, files: { vocals: out + '/vocals.flac', instrumental: out + '/instrumental.flac' }, device: 'fake', took: 0.03, seconds: 1 });
}, hold);
`;

async function setup(mode = 'ok') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'stems-test-'));
  const store = createStore({ root });
  await store.ready();
  await store.putFile('Songs/one.mp3', Readable.from([Buffer.from('song-one')]));
  await store.putFile('Songs/two.mp3', Readable.from([Buffer.from('song-two')]));
  const created = [];
  const stems = createStems({
    store,
    channels: { toDrive: (event, data) => created.push(data.path) },
    log: { info() {}, error() {} },
    command: (input, out) => [process.execPath, ['-e', FAKE, input, out, mode]],
  });
  return { root, store, stems, created };
}

const settle = async (stems, id) => {
  for (let i = 0; i < 200; i += 1) {
    const job = stems.list().jobs.find((j) => j.id === id);
    if (job && !['queued', 'running'].includes(job.state)) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job never settled');
};

test('stemPaths names the pair beside the song', () => {
  assert.deepEqual(stemPaths('Fun/Song Mashups/thank u next.mp3'), {
    vocals: 'Fun/Song Mashups/thank u next - vocals.flac',
    instrumental: 'Fun/Song Mashups/thank u next - instrumental.flac',
  });
});

test('a long title is shortened so both names fit the grammar', () => {
  const long = stemPaths('Songs/Billie Eilish - BIRDS OF A FEATHER Official Lyric Video.mp3');
  assert.equal(long.instrumental, 'Songs/Billie Eilish - BIRDS OF A FEATHER Official - instrumental.flac');
  for (const p of Object.values(long)) assert.ok(p.split('/').pop().length <= 64);
});

test('a split writes the pair into the folder and says so', async () => {
  const { root, stems, created } = await setup();
  const asked = await stems.split('Songs/one.mp3');
  assert.ok(['queued', 'running'].includes(asked.state));
  const job = await settle(stems, asked.id);
  assert.equal(job.state, 'done', job.error);
  assert.equal(job.device, 'fake');
  assert.deepEqual(job.stems, stemPaths('Songs/one.mp3'));
  assert.equal(await fsp.readFile(path.join(root, 'Songs/one - vocals.flac'), 'utf8'), 'V:song-one');
  assert.equal(await fsp.readFile(path.join(root, 'Songs/one - instrumental.flac'), 'utf8'), 'I:song-one');
  assert.deepEqual(created.sort(), ['Songs/one - instrumental.flac', 'Songs/one - vocals.flac']);
  // Nothing half-written is left beside them.
  assert.deepEqual((await fsp.readdir(path.join(root, 'Songs'))).filter((n) => n.startsWith('.')), []);

  // Asking again finds the pair and does no work.
  const again = await stems.split('Songs/one.mp3');
  assert.equal(again.state, 'done');
  assert.equal(again.stage, 'already split');
});

test('two asks for one song are one job, and songs wait their turn', async () => {
  const { stems } = await setup();
  const a = await stems.split('Songs/one.mp3');
  const b = await stems.split('Songs/one.mp3');
  const c = await stems.split('Songs/two.mp3');
  assert.equal(a.id, b.id);
  assert.equal(stems.list().jobs.filter((j) => j.state === 'running').length, 1);
  assert.equal((await settle(stems, a.id)).state, 'done');
  assert.equal((await settle(stems, c.id)).state, 'done');
  assert.equal(stems.list({ folder: 'Songs' }).jobs.length, 2);
  assert.equal(stems.list({ folder: 'Elsewhere' }).jobs.length, 0);
});

test('a stem, a document or a missing song is refused', async () => {
  const { stems } = await setup();
  await assert.rejects(stems.split('Songs/one - vocals.flac'), /already a stem/);
  await assert.rejects(stems.split('Songs/notes.txt'), /not a song/);
  await assert.rejects(stems.split('Songs/gone.mp3'), /no file/);
});

test('a failed split says why, and a cancelled one leaves nothing', async () => {
  const failing = await setup('fail');
  const bad = await settle(failing.stems, (await failing.stems.split('Songs/one.mp3')).id);
  assert.equal(bad.state, 'failed');
  assert.match(bad.error, /fell over/);

  const hanging = await setup('hang');
  const job = await hanging.stems.split('Songs/one.mp3');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(hanging.stems.cancel(job.id).state, 'cancelled');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await hanging.store.hasFile('Songs/one - vocals.flac'), false);
  assert.equal(hanging.stems.cancel('nope'), null);
});
