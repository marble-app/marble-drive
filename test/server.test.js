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
/** The upload route, which takes the document as the body rather than as a
 *  field in a JSON object. The two things it knows about the file — where it
 *  goes and what it was called — travel in the query, the way `/ops` does it. */
const put = (folder, name, source, client = 'up') =>
  fetch(
    `${base}/drive/upload?folder=${encodeURIComponent(folder)}` +
      `&name=${encodeURIComponent(name)}&client=${client}`,
    { method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: source },
  );

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
  assert.match(page, /<script src="\/runtime\/collab\.js"/);
  assert.doesNotMatch(page, /agent-callout\.js/, 'no agents here, so nothing to summon');
  assert.doesNotMatch(page, /agent-marks/, 'no agents here, so nothing to mark up for');
  // The host injects the carrier and nothing else — no affordance, no chrome.
  assert.ok(!page.includes('<script src="/lib/'));
});

test('/today bookmarks whatever the day skill mirrored there most recently, falling back like / does', async () => {
  const before = await get('/today');
  assert.equal(before.status, 302);
  assert.equal(before.headers.get('location'), '/a/drive');

  await drive.store.write("Bryan's Days/today", '<html><body>today</body></html>', { label: 'seeded' });
  const after = await get('/today');
  assert.equal(after.status, 302);
  assert.equal(after.headers.get('location'), `/a/${encodeURIComponent("Bryan's Days/today")}`);
});

test('the carrier and its Drive extension are both served', async () => {
  assert.match(await (await get('/runtime/marble.js')).text(), /window\.marble = \{/);
  assert.match(await (await get('/runtime/drive.js')).text(), /marble\.drive = \{/);
  assert.match(await (await get('/runtime/collab.js')).text(), /marble-collab-host/);
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

// A file in a folder that is not a document. The Drive draws these quietly
// rather than hiding them, and a thing you can see and cannot open is worse
// than one you cannot see — so there is a route, and it is careful.
test('a file that is not a document is in the tree and reachable', async () => {
  await fsp.mkdir(path.join(ROOT, 'work/q3'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'work/q3/refs.bib'), '@article{a}');

  const tree = await asJson(await get('/drive/tree?folder=work%2Fq3'));
  const file = tree.children.find((c) => c.name === 'refs.bib');
  assert.equal(file.kind, 'file');
  assert.equal(file.ext, 'bib');
  // `/docs` is the carrier's surface and it answers with documents, so a file
  // arriving in the tree must not have arrived there too.
  const docs = await asJson(await get('/docs'));
  assert.equal(docs.some((entry) => entry.path.endsWith('.bib')), false);

  const served = await get('/drive/file?path=work%2Fq3%2Frefs.bib');
  assert.equal(served.status, 200);
  assert.equal(await served.text(), '@article{a}');
});

test('a file is served under a type the browser will not execute', async () => {
  // Text, and text only, for anything textual — a `.js` in a folder is
  // something you read, and a type the browser runs would be a script on this
  // origin with this drive's cookie.
  await fsp.writeFile(path.join(ROOT, 'work/q3/tool.js'), 'alert(1)');
  const js = await get('/drive/file?path=work%2Fq3%2Ftool.js');
  assert.equal(js.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
  assert.match(js.headers.get('content-security-policy'), /sandbox/);
  assert.match(js.headers.get('content-disposition'), /^inline/);

  // Not on the allowlist, so it is handed over rather than rendered. An SVG is
  // the one that matters: it looks like a picture and can carry script.
  await fsp.writeFile(path.join(ROOT, 'work/q3/logo.svg'), '<svg/>');
  const svg = await get('/drive/file?path=work%2Fq3%2Flogo.svg');
  assert.equal(svg.headers.get('content-type'), 'application/octet-stream');
  assert.match(svg.headers.get('content-disposition'), /^attachment/);
});

test('the file route refuses a document, a folder and a way out of the drive', async () => {
  assert.equal((await get('/drive/file?path=work%2Fq3%2Fnotes')).status, 404);
  assert.equal((await get('/drive/file?path=work%2Fq3%2Fnotes.mrbl')).status, 400);
  assert.equal((await get('/drive/file?path=work%2Fq3')).status, 404);
  assert.equal((await get('/drive/file?path=..%2F..%2Fetc%2Fpasswd')).status, 400);
  assert.equal((await get('/drive/file?path=.marble%2Ftrash.jsonl')).status, 400);
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
  const source = `<!doctype html>\n<html><head><title>Echo</title></head>\n<body data-marble-id="b">\n<h1 data-marble-id="h">Title</h1>\n</body></html>\n`;
  const made = await asJson(await put('', 'Echo Live.mrbl', source));
  const doc = encodeURIComponent(made.path);

  const mine = collect(`/events?app=${doc}&client=c1`, { want: 1, ms: 900 });
  const theirs = collect(`/events?app=${doc}&client=c2`, { want: 2, ms: 900 });
  await Promise.all([mine.ready, theirs.ready]);

  await fetch(`${base}/ops?app=${doc}&client=c1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ type: 'setText', id: 'h', text: 'A quieter title' }]),
  });

  const heard = (frames) => frames.filter((frame) => frame.data === 'changed');
  assert.equal(heard(await mine.frames).length, 0, 'the writer is not reconciled against its own gesture');
  const theirsFrames = await theirs.frames;
  assert.equal(heard(theirsFrames).length, 1, 'every other client is told');
  const opsFrame = theirsFrames.find((frame) => frame.event === 'ops');
  assert.ok(opsFrame, 'the echo is ops, not only changed');
  assert.match(opsFrame.data, /"type":"setText"/);
});

test('presence is echoed to other tabs and never written into the file', async () => {
  const source = `<!doctype html>\n<html><head><title>Here</title></head>\n<body data-marble-id="b">\n<h1 data-marble-id="h">Title</h1>\n</body></html>\n`;
  const made = await asJson(await put('', 'Presence Live.mrbl', source));
  const doc = encodeURIComponent(made.path);

  const mine = collect(`/events?app=${doc}&client=you`, { want: 1, ms: 900 });
  const theirs = collect(`/events?app=${doc}&client=them`, { want: 1, ms: 900 });
  await Promise.all([mine.ready, theirs.ready]);

  const noted = await fetch(`${base}/presence?app=${doc}&client=you`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ['h'] }),
  });
  assert.equal(noted.status, 200);

  const theirsFrames = await theirs.frames;
  const presence = theirsFrames.find((frame) => frame.event === 'presence');
  assert.ok(presence);
  assert.match(presence.data, /"h"/);
  assert.equal((await mine.frames).filter((frame) => frame.event === 'presence').length, 0);

  const stored = await fsp.readFile(path.join(ROOT, `${made.path}.mrbl`), 'utf8');
  assert.doesNotMatch(stored, /marble-presence/);
});

test('a late second event for a save the host already made is not an edit from outside', async () => {
  const doc = encodeURIComponent('work/q3/notes');
  const page = await (await get('/a/work%2Fq3%2Fnotes')).text();
  const id = idIn(page, 'h1');
  await fetch(`${base}/ops?app=${doc}&client=c3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ type: 'setText', id, text: 'Settled title' }]),
  });
  // Long enough for the save's own event to settle and use up its mark.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const writer = collect(`/events?app=${doc}&client=c3`, { want: 1, ms: 900 });
  await writer.ready;
  // What macOS does to a busy watcher: the same save, reported again, late.
  // The bytes are the ones the host wrote, so nothing changed.
  const file = path.join(ROOT, 'work/q3/notes.mrbl');
  await fsp.writeFile(file, await fsp.readFile(file, 'utf8'));

  const heard = (await writer.frames).filter((frame) => frame.data === 'changed');
  assert.equal(heard.length, 0, 'the writer is not reconciled against its own save');
});

test('an edit from outside the host reaches the page, with the prior state kept', async () => {
  const doc = encodeURIComponent('work/q3/notes');
  const listening = collect(`/events?app=${doc}&client=c9`, { want: 3, ms: 2500 });
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

// ------------------------------------------------------------------ uploading

// A document from somewhere else. Small, but a real one: it has to survive the
// doctor, because the route asks the format's own invariants about anything
// arriving from outside.
const brought = (title, id = 'aa11bb22') =>
  `<!doctype html>\n<html lang="en" data-marble="1">\n<head><meta charset="utf-8"><title>${title}</title></head>\n` +
  `<body data-marble-id="body${id}">\n<h1 data-marble-id="${id}" data-marble-editable>${title}</h1>\n</body>\n</html>\n`;

const collabDoc = (title) =>
  `<!doctype html>\n<html lang="en" data-marble="1">\n<head><meta charset="utf-8"><title>${title}</title></head>\n` +
  `<body data-marble-id="bodyc1">\n<main data-marble-id="rootc1">\n<h1 data-marble-id="hc1" data-marble-editable>${title}</h1>\n</main>\n</body>\n</html>\n`;

test('a document dropped into the drive lands in the folder it was dropped on', async () => {
  const made = await asJson(await put('archive', 'Brought In.mrbl', brought('Brought In')));
  assert.equal(made.path, 'archive/Brought In');
  assert.equal(made.href, '/a/archive%2FBrought%20In');
  assert.deepEqual(made.warnings, []);

  // Served as the app it is, not previewed — the whole point of the drive.
  const page = await (await get('/a/archive%2FBrought%20In')).text();
  assert.match(page, /<script src="\/runtime\/marble\.js" data-marble-app="archive\/Brought In"/);
  assert.match(page, /<h1 data-marble-id="aa11bb22"/);

  // And it is in the tree, in that folder, rather than at the root.
  const tree = await asJson(await get('/docs?tree=1'));
  const folder = tree.children.find((child) => child.path === 'archive');
  assert.ok(folder.children.some((child) => child.path === 'archive/Brought In'));
});

test('a drop at the top level lands at the top level', async () => {
  const made = await asJson(await put('', 'Loose.mrbl', brought('Loose', 'cc33dd44')));
  assert.equal(made.path, 'Loose');
});

test('a filename this grammar would refuse is sanitised, not turned away', async () => {
  // Every one of these is an ordinary name on a filesystem and three separate
  // refusals in `parsePath`. Refusing a drop that could have worked is worse.
  const made = await asJson(await put('', 'Q3 Résumé (final).mrbl', brought('Résumé', 'ee55ff66')));
  assert.equal(made.path, 'Q3 Resume final');

  // The folder a dropped directory came in as gets the same treatment, and the
  // parents are made on the way.
  const nested = await asJson(await put('Photos & Notes/', 'Ünterlagen.html', brought('U', '11aa22bb')));
  assert.equal(nested.path, 'Photos Notes/Unterlagen');
});

test('dropping the same document twice gets a number, the way a new one does', async () => {
  const again = await asJson(await put('', 'Loose.mrbl', brought('Loose', 'dd44ee55')));
  assert.equal(again.path, 'Loose 1');
});

test('what is not a document does not become one', async () => {
  const notHtml = await put('', 'notes.mrbl', 'just some words');
  assert.equal(notHtml.status, 400);
  assert.match((await notHtml.json()).error, /not a document/);

  assert.equal((await put('', 'empty.mrbl', '   ')).status, 400);

  // Two nodes under one id is the one thing that cannot be let in: every op
  // naming it would edit the wrong one, silently, from then on. The doctor is
  // the format's own answer to that, and this route asks it rather than
  // keeping a second opinion.
  const collided = brought('Twins').replace('</body>', '<p data-marble-id="aa11bb22">and again</p></body>');
  const refused = await put('', 'twins.mrbl', collided);
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /not addressable/);
  assert.equal((await get('/a/twins')).status, 404);
});

test('an upload is announced to the drive, and never to whoever filed it', async () => {
  const others = collect('/events?drive=1&client=someone-else', { want: 1, ms: 1500 });
  const uploader = collect('/events?drive=1&client=the-dropper', { want: 1, ms: 900 });
  await Promise.all([others.ready, uploader.ready]);

  await asJson(await put('', 'Announced.mrbl', brought('Announced', '99xx88yy'), 'the-dropper'));

  const heard = await others.frames;
  assert.ok(heard.some((frame) => frame.event === 'created' && JSON.parse(frame.data).path === 'Announced'));
  assert.deepEqual(await uploader.frames, []);
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
  const listId = page.match(/<div class="flow" id="flow" data-marble-id="([^"]+)"/)?.[1];
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

test('a document made here carries its own mark, and the host has one for the rest', async () => {
  // What the host serves is the fallback: a document written before this host
  // had a mark asks for /favicon.ico, the way a browser does when a page names
  // no icon, and gets the marble.
  const ico = await get('/favicon.ico');
  assert.equal(ico.status, 302);
  assert.equal(ico.headers.get('location'), '/favicon.svg');

  const svg = await get('/favicon.svg');
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await svg.text(), /^<svg /);

  // A document made here never asks: the mark is in the file it was served in,
  // and it is still in the file a download hands you.
  const { path: made } = await asJson(await post('/drive/new', { path: 'iconed', from: 'doc' }));
  const served = await (await get(`/a/${encodeURIComponent(made)}`)).text();
  assert.match(served, /<link rel="icon" href="data:image\/svg\+xml,[^"]+">/);
  const taken = await (await get(`/drive/download?path=${encodeURIComponent(made)}`)).text();
  assert.match(taken, /<link rel="icon" href="data:image\/svg\+xml,/);
});

test('the gate cookie is Secure when the secret arrived through a local HTTPS proxy', async () => {
  const closed = await createDrive(loadConfig({ ...process.env, MARBLE_DRIVE_SECRET: 'hunter2' }), {
    log: quiet,
  });
  const shutPort = await new Promise((resolve) => {
    closed.server.listen(0, '127.0.0.1', () => resolve(closed.server.address().port));
  });
  const offer = (headers = {}) =>
    fetch(`http://127.0.0.1:${shutPort}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ secret: 'hunter2' }),
    });

  // What Tailscale Serve looks like from here: loopback, saying https.
  assert.match((await offer({ 'X-Forwarded-Proto': 'https' })).headers.get('set-cookie'), /; Secure/);
  // And http://localhost at the desk still gets a cookie Safari will keep.
  assert.doesNotMatch((await offer()).headers.get('set-cookie'), /Secure/);

  await closed.close();
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
  // The gate has to be able to draw itself, so the mark answers in front of it
  // the way /health does. Everything else still 401s.
  assert.equal((await fetch(`${shut}/favicon.svg`)).status, 200);
  const gatePage = await (await fetch(`${shut}/gate`, { headers: { Accept: 'text/html' } })).text();
  assert.match(gatePage, /<link rel="icon" href="data:image\/svg\+xml,/);

  const cookie = right.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${shut}/docs`, { headers: { cookie } })).status, 200);
  assert.equal(
    (await fetch(`${shut}/docs`, { headers: { authorization: 'Bearer hunter2' } })).status,
    200,
  );

  await closed.close();
});

// `you` claims an element by writing it. A write that changes nothing is not
// noted (applyOps returns before it notes), so each claim below changes text.
const youWrite = (doc, ops) =>
  fetch(`${base}/ops?app=${doc}&client=you`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ops),
  });

test('an outside write to a disjoint id both-applies next to a heading you wrote', async () => {
  const source = collabDoc('Hello');
  const made = await asJson(await put('', 'Collab Live.mrbl', source));
  const doc = encodeURIComponent(made.path);

  const wrote = await youWrite(doc, [{ type: 'setText', id: 'hc1', text: 'Hello!' }]);
  assert.equal(wrote.status, 200);

  const listening = collect(`/events?app=${doc}&client=you`, { want: 3, ms: 2500 });
  await listening.ready;

  const file = path.join(ROOT, `${made.path}.mrbl`);
  const onDisk = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, onDisk.replace('</main>', '<p data-marble-id="pc1">Body</p>\n</main>'));

  const frames = await listening.frames;
  assert.ok(frames.some((frame) => frame.event === 'ops' || frame.data === 'changed'));

  const after = await fsp.readFile(file, 'utf8');
  assert.match(after, /<h1 data-marble-id="hc1"[^>]*>Hello!<\/h1>/);
  assert.match(after, /<p data-marble-id="pc1">Body<\/p>/);
  assert.doesNotMatch(after, /<marble-alt/);
});

test('an outside rewrite of a heading you wrote forks rather than clobbering', async () => {
  const source = collabDoc('Yours');
  const made = await asJson(await put('', 'Collab Fork.mrbl', source));
  const doc = encodeURIComponent(made.path);

  assert.equal((await youWrite(doc, [{ type: 'setText', id: 'hc1', text: 'Yours!' }])).status, 200);

  const listening = collect(`/events?app=${doc}&client=you`, { want: 3, ms: 2500 });
  await listening.ready;

  const file = path.join(ROOT, `${made.path}.mrbl`);
  const onDisk = await fsp.readFile(file, 'utf8');
  assert.match(onDisk, />Yours!<\/h1>/);
  await fsp.writeFile(file, onDisk.replace('>Yours!</h1>', '>Theirs</h1>'));

  await listening.frames;
  const after = await fsp.readFile(file, 'utf8');
  assert.match(after, /<marble-alt data-marble-id="hc1"/);
  assert.match(after, /Yours!/);
  assert.match(after, /Theirs/);
});

test('an undo neither forks against your edit nor leaves a claim behind', async () => {
  const source = collabDoc('Original');
  const made = await asJson(await put('', 'Collab Undo.mrbl', source));
  const doc = encodeURIComponent(made.path);
  const write = (client, text) =>
    fetch(`${base}/ops?app=${doc}&client=${encodeURIComponent(client)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'setText', id: 'hc1', text }]),
    });

  // You edited it; an agent's undo puts it back. The undo's own hash check is
  // its conflict guard (server/agent/undo.js), so the host does not fork it.
  assert.equal((await write('you', 'Yours!')).status, 200);
  const undone = await asJson(await write('agent-undo:zz', 'Original'));
  assert.equal(undone.applied, 1);
  let after = await fsp.readFile(path.join(ROOT, `${made.path}.mrbl`), 'utf8');
  assert.doesNotMatch(after, /<marble-alt/, 'an undo is a retraction, not a second version');
  assert.match(after, />Original<\/h1>/);

  // And the undo left no claim: your next edit lands, it does not fork.
  assert.equal((await write('you', 'Yours again')).status, 200);
  after = await fsp.readFile(path.join(ROOT, `${made.path}.mrbl`), 'utf8');
  assert.doesNotMatch(after, /<marble-alt/, 'an undo does not claim what it restored');
  assert.match(after, />Yours again<\/h1>/);
});

test('an outside rewrite of a heading you only had your caret in applies cleanly', async () => {
  const source = collabDoc('Looking');
  const made = await asJson(await put('', 'Collab Look.mrbl', source));
  const doc = encodeURIComponent(made.path);

  const noted = await fetch(`${base}/presence?app=${doc}&client=you`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ['hc1'] }),
  });
  assert.equal(noted.status, 200);

  const listening = collect(`/events?app=${doc}&client=you`, { want: 3, ms: 2500 });
  await listening.ready;

  const file = path.join(ROOT, `${made.path}.mrbl`);
  const onDisk = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, onDisk.replace(
    '<h1 data-marble-id="hc1" data-marble-editable>Looking</h1>',
    '<h1 data-marble-id="hc1" data-marble-editable>Changed</h1>',
  ));

  await listening.frames;
  const after = await fsp.readFile(file, 'utf8');
  assert.doesNotMatch(after, /<marble-alt/, 'a caret is observation, not a claim');
  assert.match(after, /<h1 data-marble-id="hc1"[^>]*>Changed<\/h1>/);
});

test('two of your own tabs writing the same attribute do not fork each other', async () => {
  // The Agents page files its Focus split on the .focus element from whichever
  // tab last dragged the seam. Two tabs are two clients, and a fork is a
  // person-against-agent thing: a second tab's write is not "the agent".
  const source = collabDoc('Split');
  const made = await asJson(await put('', 'Collab Tabs.mrbl', source));
  const doc = encodeURIComponent(made.path);
  const write = (client, value) =>
    fetch(`${base}/ops?app=${doc}&client=${encodeURIComponent(client)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'setAttr', id: 'hc1', name: 'data-split', value }]),
    });

  assert.equal((await write('tab-one', '0.6')).status, 200);
  const second = await asJson(await write('tab-two', '0.7'));
  assert.deepEqual(second.forks, [], 'a person writing after another person is a write, not a conflict');
  const after = await fsp.readFile(path.join(ROOT, `${made.path}.mrbl`), 'utf8');
  assert.doesNotMatch(after, /<marble-alt/);
  assert.match(after, /<h1[^>]*data-split="0.7"[^>]*>Split<\/h1>/);
});

test.after(async () => {
  await drive.close();
  await fsp.rm(ROOT, { recursive: true, force: true });
});
