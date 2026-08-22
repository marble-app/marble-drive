import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-http-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { seedDrive } = await import('../server/seed.js');

const quiet = { log() {}, error() {} };
const config = loadConfig();
const drive = await createDrive(config, { log: quiet });
await seedDrive(drive.store);

const port = await new Promise((resolve) => {
  drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port));
});
const base = `http://127.0.0.1:${port}`;

const get = (route, init) => fetch(base + route, { redirect: 'manual', ...init });
const post = (route, body) =>
  fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
const asJson = async (response) => {
  const body = await response.json();
  assert.ok(response.ok, `${response.status} ${JSON.stringify(body)}`);
  return body;
};

/** Read named SSE events off a stream until `want` of them have arrived or the
 *  deadline passes. Resolves with what it got either way, so a test can assert
 *  that nothing arrived as easily as that something did.
 *
 *  `.ready` resolves once the host has sent its opening comment, which is the
 *  only reliable signal that the subscription is registered. Sleeping instead
 *  is a test that passes on an idle machine and fails on a busy one. */
function collect(route, { want = 1, ms = 900 } = {}) {
  const controller = new AbortController();
  let connected;
  const ready = new Promise((resolve) => {
    connected = resolve;
  });

  const frames = (async () => {
    const response = await fetch(base + route, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const seen = [];

    const deadline = setTimeout(() => controller.abort(), ms);
    try {
      while (seen.length < want) {
        const { value, done } = await reader.read();
        if (done) break;
        connected();
        for (const frame of decoder.decode(value, { stream: true }).split('\n\n')) {
          const data = frame.match(/^data: (.*)$/m)?.[1];
          const event = frame.match(/^event: (.*)$/m)?.[1] ?? 'message';
          if (data !== undefined) seen.push({ event, data });
        }
      }
    } catch {
      // The abort is how this ends when nothing more is coming.
    }
    clearTimeout(deadline);
    controller.abort();
    return seen;
  })();

  frames.catch(() => {});
  return { ready, frames };
}

const idIn = (source, tag) => source.match(new RegExp(`<${tag} data-marble-id="([^"]+)"`))?.[1];

test('/ lands on the Drive, which is an ordinary document in the drive', async () => {
  const response = await get('/');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/a/drive');

  const page = await (await get('/a/drive')).text();
  assert.match(page, /<script src="\/runtime\/marble\.js" data-marble-app="drive"/);
  assert.match(page, /<script src="\/runtime\/drive\.js"/);
  // The host injects the carrier and nothing else — no affordance, no chrome.
  assert.ok(!page.includes('<script src="/lib/'));
});

test('the carrier and its Drive extension are both served', async () => {
  assert.match(await (await get('/runtime/marble.js')).text(), /window\.marble = \{/);
  assert.match(await (await get('/runtime/drive.js')).text(), /marble\.drive = \{/);
  assert.equal((await get('/runtime/../server/app.js')).status, 404);
  assert.equal((await get('/runtime/nope.js')).status, 404);
});

test('a document three folders down is created, served and listed', async () => {
  await asJson(await post('/drive/new', { path: 'work/q3/notes', from: 'doc' }));
  assert.equal((await get('/a/work%2Fq3%2Fnotes')).status, 200);

  const docs = await asJson(await get('/docs'));
  const found = docs.find((entry) => entry.path === 'work/q3/notes');
  assert.ok(found);
  // `name` is the whole path, so Marble's own `marble.href(doc.name)` opens it.
  assert.equal(found.name, 'work/q3/notes');

  const tree = await asJson(await get('/docs?tree=1'));
  assert.equal(tree.children.find((c) => c.path === 'work').children[0].path, 'work/q3');
});

test('the loop: an op splices the file and the bytes on disk change', async () => {
  const page = await (await get('/a/work%2Fq3%2Fnotes')).text();
  const id = idIn(page, 'h1');
  const before = await fsp.readFile(path.join(ROOT, 'work/q3/notes.mrbl'), 'utf8');

  const result = await asJson(
    await fetch(`${base}/ops?app=${encodeURIComponent('work/q3/notes')}&client=c1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'setText', id, text: 'Field journal' }]),
    }),
  );
  assert.equal(result.applied, 1);

  const after = await fsp.readFile(path.join(ROOT, 'work/q3/notes.mrbl'), 'utf8');
  assert.match(after, />Field journal</);
  // An untouched region stays byte-identical, which is what makes the diff
  // read as the change somebody made.
  assert.equal(after.slice(0, after.indexOf('<h1')), before.slice(0, before.indexOf('<h1')));
});

test('the op log records who filed it and their count of it', async () => {
  const lines = (await fsp.readFile(path.join(ROOT, '.marble/work%2Fq3%2Fnotes.ops.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines.at(-1).client, 'c1');
  assert.equal(lines.at(-1).doc, 'work/q3/notes');
  assert.ok(Number.isInteger(lines.at(-1).seq));
});

test('the echo reaches every other client and never the one that wrote', async () => {
  const doc = encodeURIComponent('work/q3/notes');
  const page = await (await get('/a/work%2Fq3%2Fnotes')).text();
  const id = idIn(page, 'h1');

  const mine = collect(`/events?app=${doc}&client=c1`, { want: 1, ms: 900 });
  const theirs = collect(`/events?app=${doc}&client=c2`, { want: 2, ms: 900 });
  await Promise.all([mine.ready, theirs.ready]);

  await fetch(`${base}/ops?app=${doc}&client=c1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ type: 'setText', id, text: 'A quieter title' }]),
  });

  const heard = (frames) => frames.filter((frame) => frame.data === 'changed');
  assert.equal(heard(await mine.frames).length, 0, 'the writer is not reconciled against its own gesture');
  assert.equal(heard(await theirs.frames).length, 1, 'every other client is told');
});

test('an edit from outside the host reaches the page, with the prior state kept', async () => {
  const doc = encodeURIComponent('work/q3/notes');
  const listening = collect(`/events?app=${doc}&client=c9`, { want: 1, ms: 2500 });
  await listening.ready;

  const file = path.join(ROOT, 'work/q3/notes.mrbl');
  const source = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, source.replace('<title>', '<title>Edited '));

  assert.ok((await listening.frames).some((frame) => frame.data === 'changed'), 'the watcher saw it');

  const history = await asJson(await get(`/history?app=${doc}`));
  assert.ok(history.some((entry) => entry.label === 'pre-external'), 'what it said before is kept');
});

test('a restore is an ordinary write, undoable by the same gesture', async () => {
  const doc = encodeURIComponent('work/q3/notes');
  const history = await asJson(await get(`/history?app=${doc}`));
  const oldest = history.at(-1);

  const restored = await asJson(await post(`/restore?app=${doc}&sha=${oldest.sha}`));
  assert.equal(restored.restored, true);
  assert.equal(
    await fsp.readFile(path.join(ROOT, 'work/q3/notes.mrbl'), 'utf8'),
    await drive.store.snapshot('work/q3/notes', oldest.sha),
  );
  assert.equal((await post(`/restore?app=${doc}&sha=${'0'.repeat(64)}`)).status, 404);
});

test('the Drive hears about the folder changing, not just about one file', async () => {
  const listening = collect('/events?drive=1&client=cd', { want: 1, ms: 1500 });
  await listening.ready;
  await post('/drive/mkdir', { path: 'archive' });

  assert.ok((await listening.frames).some((frame) => frame.event === 'created'));
});

test('moving, trashing and restoring, over HTTP', async () => {
  await asJson(await post('/drive/new', { path: 'scratch', from: 'board' }));
  await asJson(await post('/drive/move', { from: 'scratch', to: 'archive/scratch' }));
  assert.equal((await get('/a/scratch')).status, 404);
  assert.equal((await get('/a/archive%2Fscratch')).status, 200);

  const gone = await asJson(await post('/drive/trash', { path: 'archive/scratch' }));
  assert.equal((await get('/a/archive%2Fscratch')).status, 404);
  await asJson(await post('/drive/untrash', { id: gone.id }));
  assert.equal((await get('/a/archive%2Fscratch')).status, 200);
});

test('a name that is taken gets a number rather than a refusal', async () => {
  const first = await asJson(await post('/drive/new', { path: 'twice', from: 'doc' }));
  const second = await asJson(await post('/drive/new', { path: 'twice', from: 'doc' }));
  assert.equal(first.path, 'twice');
  assert.equal(second.path, 'twice 1');
});

test('a copy is a copy of the bytes, because a document is one file', async () => {
  const copy = await asJson(await post('/drive/new', { path: 'twice copy', copy: 'twice' }));
  const [original, made] = await Promise.all([
    drive.store.read('twice'),
    drive.store.read(copy.path),
  ]);
  assert.equal(made.replace(/<title>[^<]*/, ''), original.replace(/<title>[^<]*/, ''));
  assert.match(made, /<title>twice copy<\/title>/);
});

test('a bad path is a 400 with a sentence, not a stack trace', async () => {
  for (const bad of ['../../etc/passwd', 'work//notes', '.marble/x']) {
    const response = await post('/drive/mkdir', { path: bad });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /\w+/);
  }
  assert.equal((await get('/a/..%2F..%2Fetc%2Fpasswd')).status, 400);
});

test('ops that would destroy addressed content nobody asked to remove are refused', async () => {
  const doc = encodeURIComponent('work/q3/notes');
  const page = await (await get('/a/work%2Fq3%2Fnotes')).text();
  const listId = page.match(/<ol class="sections" data-marble-id="([^"]+)"/)?.[1];
  assert.ok(listId);

  const before = await drive.store.read('work/q3/notes');
  const response = await fetch(`${base}/ops?app=${doc}&client=cx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ type: 'setText', id: listId, text: 'gone' }]),
  });
  assert.equal(response.ok, false);
  assert.equal(await drive.store.read('work/q3/notes'), before, 'nothing reached disk');
});

test('health answers before the gate, and the gate closes everything else', async () => {
  const closed = await createDrive(loadConfig({ ...process.env, MARBLE_DRIVE_SECRET: 'hunter2' }), {
    log: quiet,
  });
  const shutPort = await new Promise((resolve) => {
    closed.server.listen(0, '127.0.0.1', () => resolve(closed.server.address().port));
  });
  const shut = `http://127.0.0.1:${shutPort}`;

  assert.equal((await fetch(`${shut}/health`)).status, 200);
  assert.equal((await fetch(`${shut}/docs`)).status, 401);
  assert.equal(
    (await fetch(`${shut}/a/drive`, { headers: { Accept: 'text/html' }, redirect: 'manual' })).status,
    302,
  );

  const wrong = await fetch(`${shut}/gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'nope' }),
  });
  assert.equal(wrong.status, 401);

  const right = await fetch(`${shut}/gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'hunter2' }),
  });
  assert.equal(right.status, 200);
  const cookie = right.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${shut}/docs`, { headers: { cookie } })).status, 200);
  assert.equal(
    (await fetch(`${shut}/docs`, { headers: { authorization: 'Bearer hunter2' } })).status,
    200,
  );

  await closed.close();
});

test.after(async () => {
  await drive.close();
  await fsp.rm(ROOT, { recursive: true, force: true });
});
