import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildBrief, phraseOf, resumeBrief } from '../server/build/brief.js';
import { kindOf, outlineOf, pieceFrom, previewOf, regionsOf } from '../server/build/pieces.js';
import { readReply } from '../server/build/reply.js';
import { cleanMark, cleanPlan, createBuildStore } from '../server/build/store.js';
import { linesOf, partNow, stepOf } from '../server/build/steps.js';
import { timelineOf } from '../server/build/history.js';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-build-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-build-work-'));
const KEYS = path.join(WORK, 'agent-keys.local');
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
process.env.MARBLE_DRIVE_AGENT_KEYS = KEYS;

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const quiet = { log() {}, error() {} };

const APP = `<!doctype html>
<html><head><title>Untitled</title><style>.list { display: grid; }</style></head>
<body data-marble-id="b">
  <main data-marble-id="m">
    <h1 data-marble-id="h">Untitled</h1>
  </main>
</body></html>
`;

const SOURCE_APP = `<!doctype html>
<html><head><title>Calendar</title><style>.weeks { display: flex; }</style></head>
<body data-marble-id="b">
  <section class="weeks" data-marble-id="w" aria-label="Weeks ahead">
    <h2 data-marble-id="w1">Weeks ahead</h2>
    <ol data-marble-id="w2"><li data-marble-id="w3">Fri 9 · VinCa review due, and a few more words to pass the size</li><li data-marble-id="w4">Mon 12 · Second pass on all five invitations</li></ol>
  </section>
  <aside data-marble-id="a"><h3 data-marble-id="a1">Notes</h3><p data-marble-id="a2">Short</p></aside>
</body></html>
`;

const build = (doc) => [
  { call: 'build_plan', args: { parts: [{ title: 'Title', state: 'now' }, { title: 'Invitations list', state: 'ahead' }], title: 'CHI reviews', folder: 'UCSD' } },
  { call: 'read_document', args: { path: doc } },
  { call: 'apply_ops', args: { path: doc, note: 'Stage 1 of 2: the title', ops: [{ type: 'setText', id: 'h', text: 'CHI reviews' }] } },
  { call: 'build_plan', args: { parts: [{ title: 'Title', state: 'done' }, { title: 'Invitations list', state: 'done' }] } },
  { say: 'Built the title.' },
];

const SCRIPTS = {
  first: build('Untitled'),
  second: build('Second'),
  slow: [
    { call: 'build_plan', args: { parts: [{ title: 'Title', state: 'now' }] } },
    { call: 'read_document', args: { path: 'Slow' } },
    { call: 'apply_ops', args: { path: 'Slow', note: 'Stage 1 of 2', ops: [{ type: 'setText', id: 'h', text: 'Half built' }] } },
    { sleep: 8000 },
    { say: 'late' },
  ],
  resumed: [{ say: 'Carried on.' }],
  held: build('Held'),
  drawn: [
    { call: 'build_plan', args: { parts: [{ title: 'Title', state: 'now' }] } },
    { call: 'read_document', args: { path: 'Drawn' } },
    { sleep: 8000 },
    { say: 'late' },
  ],
};

const config = loadConfig({
  ...process.env,
  MARBLE_DRIVE_AGENTS: '1',
  MARBLE_DRIVE_AGENT_NAMING: '0',
  MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
  MARBLE_DRIVE_AGENT_WORKDIR: WORK,
  MARBLE_DRIVE_AGENT_KEYS: KEYS,
});
const drive = await createDrive(config, {
  log: quiet,
  agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
});
await drive.createDocument('Untitled', APP);
await drive.createDocument('Second', APP);
await drive.createDocument('Slow', APP);
await drive.createDocument('Calendar', SOURCE_APP);
await drive.createDocument('Held', APP);
await drive.createDocument('Drawn', APP);
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;
const api = async (method, route, body) => {
  const response = await fetch(base + route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const until = async (check, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out');
};
const state = async (doc) => (await api('GET', `/agent/builds?path=${encodeURIComponent(doc)}`)).body;
const note = (id, text, extra = {}) => ({ id, type: 'note', anchorId: 'h', u: 0.5, v: 1.2, text, ...extra });

test.after(async () => {
  await drive.close();
  await fsp.rm(ROOT, { recursive: true, force: true });
  await fsp.rm(WORK, { recursive: true, force: true });
});

test('a mark is kept to the shape the page draws, and nothing else', () => {
  assert.equal(cleanMark({ id: 'x', type: 'banner' }), null);
  assert.equal(cleanMark({ type: 'note' }), null);
  const kept = cleanMark({ id: 'm1', type: 'note', anchorId: 'h', u: 99, v: '0.5', text: 'hi', state: 'built', evil: '<script>' });
  assert.deepEqual(Object.keys(kept).sort(), ['anchorId', 'at', 'build', 'id', 'state', 'text', 'type', 'u', 'v']);
  assert.equal(kept.u, 5);
  assert.equal(kept.v, 0.5);
  assert.equal(cleanMark({ id: 's', type: 'stroke', parts: [{ pairs: [[0, 0]] }] }), null, 'a stroke needs a line');
  const stroke = cleanMark({ id: 's', type: 'stroke', kind: 'box', ids: ['a', 'b c', 'd'], parts: [{ pairs: [[0, 0], [1, 1]] }] });
  assert.deepEqual(stroke.ids, ['a', 'd']);
});

test('a plan keeps what it was given and what it was told before', () => {
  const first = cleanPlan({ parts: [{ title: 'List', state: 'now' }, { title: '' }], title: 'CHI / reviews', folder: '/UCSD/' });
  assert.deepEqual(first.parts.map((p) => p.title), ['List']);
  assert.equal(first.title, 'CHI reviews');
  assert.equal(first.folder, 'UCSD');
  const next = cleanPlan({ parts: [] }, first);
  assert.deepEqual(next.parts, first.parts, 'no parts keeps the parts');
  assert.equal(next.title, first.title);
});

test('the brief reads every mark into words, and a piece brings its markup', () => {
  const marks = [
    cleanMark(note('n1', 'Track my CHI review invitations', { first: true })),
    cleanMark({ id: 's1', type: 'stroke', kind: 'box', ids: ['w', 'a'], parts: [{ pairs: [[0, 0], [1, 1]] }] }),
    cleanMark({ id: 'p1', type: 'piece', anchorId: 'h', piece: { id: 'pp', title: 'Weeks ahead', kind: 'Widget', line: 'Your deadlines, on a line', source: { path: 'Calendar', id: 'w' } } }),
  ];
  const pieces = new Map([['pp', { html: '<section>weeks</section>', css: '.weeks{}', script: '' }]]);
  const brief = buildBrief({ path: 'Untitled', n: 1, marks, pieces, empty: true, untitled: true });
  assert.match(brief, /make the app in "Untitled"/);
  assert.match(brief, /The prompt the app was made from, on #h: "Track my CHI review invitations"/);
  assert.match(brief, /A box sketched around #w and #a/);
  assert.match(brief, /"Weeks ahead", a widget from "Calendar" \(#w\) — Your deadlines, on a line/);
  assert.match(brief, /<section>weeks<\/section>/);
  assert.match(brief, /build_plan/);
  assert.match(brief, /`title`/);
  assert.match(phraseOf(cleanMark({ id: 'c', type: 'comment', anchorId: 'h', thread: [{ who: 'you', text: 'why?' }, { who: 'agent', text: 'because' }] })), /Person: why\?\n\s+Agent: because/);
  assert.match(resumeBrief({ path: 'x', n: 2, plan: { parts: [{ title: 'A', state: 'done' }, { title: 'B', state: 'now' }] } }), /Done already: A\.\nStill to do: B\./);
});

test('a note keeps what was pasted onto it, and the brief says where to look', async () => {
  const mark = cleanMark({
    id: 'm1', type: 'note', anchorId: 's1', text: 'Like this',
    images: [{ name: 'a'.repeat(24) + '.png', w: 240, h: 120 }, { name: '../etc/passwd' }],
    clips: [{ html: '<button>Accept</button>', text: 'Accept' }, { html: '  ' }],
  });
  assert.deepEqual(mark.images, [{ name: `${'a'.repeat(24)}.png`, w: 240, h: 120 }], 'only names the store made');
  assert.deepEqual(mark.clips, [{ html: '<button>Accept</button>', text: 'Accept' }]);
  const said = phraseOf(mark, { imagePath: (name) => `/drive/.marble/builds/images/${name}` });
  assert.match(said, /A note on #s1: "Like this"/);
  assert.match(said, /open it with Read/);
  assert.match(said, new RegExp(`/drive/\\.marble/builds/images/${'a'.repeat(24)}\\.png`));
  assert.match(said, /<button>Accept<\/button>/);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-build-images-'));
  const store = createBuildStore({ dir });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const { name } = await store.putImage(png, 'image/png');
  assert.match(name, /^[0-9a-f]{24}\.png$/);
  assert.equal((await store.putImage(png, 'image/png')).name, name, 'the same picture is one file');
  assert.deepEqual((await store.image(name)).bytes, png);
  assert.equal(await store.image('../x.png'), null);
  await assert.rejects(store.putImage(png, 'text/html'), /PNG, JPEG/);
});

test('archived is kept on a mark; a plan names the comments it settles; the brief asks for them by id', () => {
  assert.equal(cleanMark({ id: 'm1', type: 'note', text: 'x', archived: true }).archived, true);
  assert.equal(cleanMark({ id: 'm1', type: 'note', text: 'x', archived: 'yes' }).archived, undefined);
  assert.equal(cleanMark({ id: 'm1', type: 'note', text: 'x', archived: false }).archived, false, 'put back is said');
  const plan = cleanPlan({ parts: [{ title: 'A' }], settled: ['mc1', { id: 'mc2', said: 'Shown now.' }, { said: 'no id' }] });
  assert.deepEqual(plan.settled, [{ id: 'mc1', said: '' }, { id: 'mc2', said: 'Shown now.' }]);
  assert.deepEqual(cleanPlan({ parts: [{ title: 'B' }] }, plan).settled, plan.settled, 'kept from before when not given');
  const brief = buildBrief({
    path: 'Reviews', n: 2,
    marks: [cleanMark({ id: 'm1', type: 'note', anchorId: 'h', text: 'Bigger title' })],
    context: [cleanMark({ id: 'mc1', type: 'comment', anchorId: 's2', thread: [{ who: 'you', text: 'Two weeks?' }] })],
  });
  assert.match(brief, /- Comment mc1, pinned to #s2/);
  assert.match(brief, /Person: Two weeks\?/);
  assert.match(brief, /build_plan's `settled`/);
});

test('marks done before the archive are read as archived; one put back stays put back', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-build-old-'));
  const store = createBuildStore({ dir });
  await store.update('Old', (s) => {
    s.marks.push(
      { id: 'm1', type: 'note', text: 'built long ago', state: 'built' },
      { id: 'm2', type: 'note', text: 'put back', state: 'built', archived: false },
      { id: 'm3', type: 'comment', thread: [], resolved: true, state: 'waiting' },
      { id: 'm4', type: 'note', text: 'waiting', state: 'waiting' },
    );
    return null;
  });
  const marks = Object.fromEntries((await store.read('Old')).marks.map((m) => [m.id, m.archived]));
  assert.deepEqual(marks, { m1: true, m2: false, m3: true, m4: undefined });
});

test('a build\'s steps are said plainly, under the stage being made, with what each change touched', () => {
  assert.deepEqual(stepOf('mcp__marble__read_document', { path: 'Reviews.mrbl' }, { app: 'Reviews' }), { kind: 'read', head: 'Read this app', path: 'Reviews' });
  assert.equal(stepOf('WebSearch', { query: 'CalDigit TS5 Plus' }).head, 'Searched the web for "CalDigit TS5 Plus"');
  const change = stepOf('apply_ops', { note: 'Stage 2 of 4: the list says how many', ops: [{ type: 'setText', id: 'a' }, { type: 'insert', parentId: 'b', html: '<p>x</p>' }] });
  assert.deepEqual(change, { kind: 'change', head: 'The list says how many', path: '2 changes', ids: ['a', 'b'] });
  assert.equal(stepOf('build_plan', {}), null, 'planning is not a step');
  assert.deepEqual(linesOf('# CalDigit TS5\n**Brand:** CalDigit\nLinks: [{"title":"x"}]\n12: some line'), ['CalDigit TS5', 'Brand: CalDigit', 'some line']);
  assert.equal(partNow({ parts: [{ title: 'A', state: 'done' }, { title: 'B', state: 'now' }] }), 'B');
});

test('History: builds and the person\'s own edits on one timeline, each with what it changed and the way back', () => {
  const t0 = 1_000_000;
  const builds = [{ id: 'b1', n: 1, title: 'Group them', status: 'finished', conversation: 'c1', startedAt: t0 + 10_000, endedAt: t0 + 20_000, showing: true, hasEnd: true }];
  const lines = [
    { t: t0, client: 'tabA', type: 'setText', id: 'h', text: 'My reviews' },
    { t: t0 + 2_000, client: 'tabA', type: 'setText', id: 's1p', text: 'Five' },
    { t: t0 + 12_000, client: 'agent:c1', type: 'insert', parentId: 'm', html: '<p data-marble-id="n1">new</p>' },
    { t: t0 + 12_000, client: 'agent:c1', type: 'setText', id: 'h', text: 'CHI reviews' },
    { t: t0 + 15_000, client: 'agent:c1', type: 'remove', id: 'old' },
    { t: t0 + 400_000, client: 'agent:c9', type: 'setText', id: 's2', text: 'From a chat' },
  ];
  const checkpoints = [{ t: t0 - 3, sha: 'a'.repeat(64), label: 'ops' }];
  const [chat, build, edit] = timelineOf({ builds, lines, checkpoints, now: t0 + 500_000 });
  assert.equal(chat.kind, 'chat');
  assert.deepEqual(build.ids, ['m', 'n1', 'h', 'old']);
  assert.deepEqual(build.changes.map((c) => c.count), [2, 1], 'one step per write it made');
  assert.equal(edit.kind, 'edit');
  assert.deepEqual(edit.ids, ['h', 's1p']);
  assert.equal(edit.said, 'Wrote “Five” and 1 more');
  assert.equal(edit.before, 'a'.repeat(64), 'the version just before it');
});

test('pieces: regions of an app, taken whole with what draws them', () => {
  const regions = regionsOf(SOURCE_APP, 'Calendar');
  assert.deepEqual(regions.map((r) => r.title), ['Weeks ahead'], 'a short aside is not a piece');
  const piece = pieceFrom(SOURCE_APP, 'w', { path: 'Calendar' });
  assert.equal(piece.title, 'Weeks ahead');
  assert.match(piece.html, /^<section class="weeks"/);
  assert.match(piece.css, /\.weeks \{ display: flex; \}/);
  assert.equal(kindOf('<div data-marble-run="x"></div>'), 'Automation');
  const preview = previewOf({ html: '<p>hi</p><script>alert(1)</script>', css: 'p{}' });
  assert.doesNotMatch(preview, /alert/);
  assert.match(outlineOf(SOURCE_APP), /h2#w1: Weeks ahead/);
});

test('a reply is read only when it has the shape asked for', () => {
  assert.equal(readReply('no'), null);
  assert.deepEqual(readReply('{"answer":"Because it is due.","offer":null}'), { answer: 'Because it is due.', offer: null, change: false });
  assert.deepEqual(readReply('x {"answer":"Yes.","offer":"Group the overdue on top"} y'), { answer: 'Yes.', offer: 'Group the overdue on top', change: false });
  // A sent note that asks for a change is built at once rather than answered.
  assert.equal(readReply('{"answer":"Making it.","offer":"Bigger","change":true}').change, true);
});

test('the store keeps one document\'s state per path, and moves it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-build-store-'));
  const store = createBuildStore({ dir });
  await Promise.all([1, 2, 3].map((n) => store.update('a', (s) => { s.marks.push({ id: `m${n}` }); })));
  assert.equal((await store.read('a')).marks.length, 3, 'three writers at once lose nothing');
  await store.move('a', 'f/b');
  assert.equal((await store.read('a')).marks.length, 0);
  assert.equal((await store.read('f/b')).marks.length, 3);
  const sha = await store.putSnapshot('<p>x</p>');
  assert.equal(await store.snapshot(sha), '<p>x</p>');
  assert.equal(await store.snapshot('nope'), null);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('marks over HTTP: put, keep, remove', async () => {
  const put = await api('PUT', '/agent/builds/marks?path=Second', { mark: note('k1', 'Keep me') });
  assert.equal(put.status, 200);
  assert.equal(put.body.mark.state, 'waiting');
  assert.deepEqual((await state('Second')).marks.map((m) => m.id), ['k1']);
  assert.equal((await api('PUT', '/agent/builds/marks?path=Second', { mark: { id: 'x', type: 'nope' } })).status, 400);
  const gone = await api('DELETE', '/agent/builds/marks?path=Second', { ids: ['k1'] });
  assert.equal(gone.body.removed, 1);
  assert.equal((await api('POST', '/agent/builds/start?path=Second', {})).status, 409, 'nothing to build');
});

test('a first build takes the prompt, plans, builds, names the app and suggests a folder', async () => {
  await api('PUT', '/agent/builds/marks?path=Untitled', { mark: note('p1', 'script:first Track my CHI review invitations', { first: true }) });
  const started = await api('POST', '/agent/builds/start?path=Untitled', {});
  assert.equal(started.status, 202);
  assert.equal(started.body.running, 'b1');
  assert.equal(started.body.marks[0].state, 'building');
  // The tabs are told of the new address before the builds follow the
  // document there, so wait for the builds, not just the document.
  const moved = await until(async () => {
    if (!(await drive.store.has('CHI reviews'))) return null;
    const s = await state('CHI reviews');
    return s?.builds?.[0]?.hasEnd ? s : null;
  });
  const b1 = moved.builds[0];
  assert.equal(b1.status, 'finished');
  assert.equal(b1.title, 'From your prompt');
  assert.deepEqual(b1.plan.parts.map((p) => [p.title, p.state]), [['Title', 'done'], ['Invitations list', 'done']]);
  assert.equal(b1.plan.title, 'CHI reviews');
  assert.equal(b1.said, 'Built the title.');
  assert.equal(moved.marks[0].state, 'built');
  assert.equal(moved.folder, 'UCSD', 'the folder the lead suggested');
  assert.equal(b1.showing, true);
  assert.equal(await drive.store.has('Untitled'), false, 'renamed, not copied');
  assert.match(await drive.store.read('CHI reviews'), /<h1 data-marble-id="h">CHI reviews<\/h1>/);
  const conversation = await drive.agents.store.conversation(moved.conversation);
  assert.equal(conversation.title, 'Build · Untitled');
  assert.equal(conversation.target, 'CHI reviews', 'the conversation follows the rename');

  // Going back to before the first build, and forward again.
  const back = await api('POST', '/agent/builds/origin/view?path=CHI%20reviews', {});
  assert.equal(back.status, 200);
  assert.match(await drive.store.read('CHI reviews'), /<h1 data-marble-id="h">Untitled<\/h1>/);
  assert.equal(back.body.origin.showing, true);
  const forward = await api('POST', '/agent/builds/b1/view?path=CHI%20reviews', {});
  assert.equal(forward.body.builds[0].showing, true);
  assert.match(await drive.store.read('CHI reviews'), /CHI reviews<\/h1>/);

  // The folder chip, dismissed.
  const dismissed = await api('POST', '/agent/builds/folder?path=CHI%20reviews', { dismiss: true });
  assert.equal(dismissed.body.folder, null);
});

test('build_plan outside a build says so', async () => {
  const tools = drive.agents.runner;
  assert.ok(tools);
  const answer = await drive.agents.builds.plan({ conversationId: 'aaaaaaaaaaaa', target: 'Second' }, { parts: [{ title: 'x' }] });
  assert.match(answer.error, /no build is running/);
});

test('stop puts the version before back, keeps where it got to, and the marks wait again', async () => {
  await api('PUT', '/agent/builds/marks?path=Slow', { mark: note('s1', 'script:slow Make it') });
  const started = await api('POST', '/agent/builds/start?path=Slow', { marks: ['s1'] });
  assert.equal(started.status, 202);
  await until(async () => /Half built/.test(await drive.store.read('Slow')));
  assert.equal((await api('POST', '/agent/builds/start?path=Slow', {})).status, 409, 'one build at a time');
  const paused = await api('POST', '/agent/builds/b1/pause?path=Slow', {});
  assert.equal(paused.status, 200);
  assert.equal(paused.body.builds[0].status, 'paused');
  assert.match(await drive.store.read('Slow'), /Half built/, 'a pause keeps what landed');
  const stopped = await api('POST', '/agent/builds/b1/stop?path=Slow', {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.builds[0].status, 'stopped');
  assert.equal(stopped.body.marks[0].state, 'waiting');
  assert.match(await drive.store.read('Slow'), /<h1 data-marble-id="h">Untitled<\/h1>/, 'stop goes back');
  // The stopped build is kept as it was: viewing it shows where it got to.
  await api('POST', '/agent/builds/b1/view?path=Slow', {});
  assert.match(await drive.store.read('Slow'), /Half built/);
});

test('a comment is answered in its thread; without a model it says so', async () => {
  await api('PUT', '/agent/builds/marks?path=Second', { mark: { id: 'c1', type: 'comment', anchorId: 'h', u: 1, v: 0, thread: [{ who: 'agent', text: 'forged' }] } });
  let s = await state('Second');
  assert.deepEqual(s.marks.find((m) => m.id === 'c1').thread, [], 'the page cannot write the agent\'s lines');
  const posted = await api('POST', '/agent/builds/comment?path=Second', { id: 'c1', text: 'Why is this first?' });
  assert.equal(posted.status, 200);
  s = await until(async () => {
    const now = await state('Second');
    const thread = now.marks.find((m) => m.id === 'c1').thread;
    return thread.length === 2 && !thread[1].pending ? now : null;
  });
  const thread = s.marks.find((m) => m.id === 'c1').thread;
  assert.equal(thread[0].text, 'Why is this first?');
  assert.equal(thread[1].who, 'agent');
  assert.match(thread[1].text, /could not answer/);
  assert.equal((await api('POST', '/agent/builds/offer?path=Second', { id: 'c1', take: true })).status, 409, 'nothing was offered');
});

test('a mark held back waits out the next build; only a waiting mark can be held', async () => {
  await api('PUT', '/agent/builds/marks?path=Held', { mark: note('k1', 'script:held Make it') });
  await api('PUT', '/agent/builds/marks?path=Held', { mark: note('k2', 'Later') });
  await api('PUT', '/agent/builds/marks?path=Held', { mark: { id: 'k3', type: 'comment', anchorId: 'h', u: 1, v: 0 } });
  const held = await api('POST', '/agent/builds/hold?path=Held', { id: 'k2', held: true });
  assert.equal(held.status, 200);
  assert.equal(held.body.marks.find((m) => m.id === 'k2').held, true);
  assert.equal((await api('POST', '/agent/builds/hold?path=Held', { id: 'k3', held: true })).status, 400, 'a comment is not built');
  assert.equal((await api('POST', '/agent/builds/hold?path=Held', { id: 'gone', held: true })).status, 404);
  // The page putting the mark again (a move, an edit) does not let it go.
  await api('PUT', '/agent/builds/marks?path=Held', { mark: { ...note('k2', 'Later, moved'), u: 0.2 } });
  assert.equal((await state('Held')).marks.find((m) => m.id === 'k2').held, true);

  const started = await api('POST', '/agent/builds/start?path=Held', {});
  assert.equal(started.status, 202);
  assert.deepEqual(started.body.builds[0].marks, ['k1'], 'the held mark is left out');
  const done = await until(async () => {
    const s = await state('Held');
    return s.builds[0]?.status === 'finished' ? s : null;
  });
  assert.equal(done.marks.find((m) => m.id === 'k1').state, 'built');
  assert.equal(done.marks.find((m) => m.id === 'k2').state, 'waiting');
  assert.equal((await api('POST', '/agent/builds/hold?path=Held', { id: 'k1', held: true })).status, 409, 'a built mark is not waiting');
  const back = await api('POST', '/agent/builds/hold?path=Held', { id: 'k2', held: false });
  assert.equal(back.body.marks.find((m) => m.id === 'k2').held, undefined);
});

test('a comment is resolved and opened again, and a new line opens it', async () => {
  await api('PUT', '/agent/builds/marks?path=Second', { mark: { id: 'c2', type: 'comment', anchorId: 'h', u: 1, v: 0 } });
  const resolved = await api('POST', '/agent/builds/resolve?path=Second', { id: 'c2', resolved: true });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.marks.find((m) => m.id === 'c2').resolved, true);
  await api('PUT', '/agent/builds/marks?path=Second', { mark: { id: 'c2', type: 'comment', anchorId: 'h', u: 0.5, v: 0 } });
  assert.equal((await state('Second')).marks.find((m) => m.id === 'c2').resolved, true, 'putting it again keeps it resolved');
  const reopened = await api('POST', '/agent/builds/resolve?path=Second', { id: 'c2', resolved: false });
  assert.equal(reopened.body.marks.find((m) => m.id === 'c2').resolved, false);
  await api('POST', '/agent/builds/resolve?path=Second', { id: 'c2', resolved: true });
  await api('POST', '/agent/builds/comment?path=Second', { id: 'c2', text: 'One more thing' });
  assert.equal((await state('Second')).marks.find((m) => m.id === 'c2').resolved, false);
  assert.equal((await api('POST', '/agent/builds/resolve?path=Held', { id: 'k2', resolved: true })).status, 404, 'only a comment is resolved');
});

test('a build keeps the latest drawing of its work, sends it, and drops a late one', async () => {
  await api('PUT', '/agent/builds/marks?path=Drawn', { mark: note('d1', 'script:drawn Make it') });
  const started = await api('POST', '/agent/builds/start?path=Drawn', {});
  assert.equal(started.status, 202);
  const running = await until(async () => {
    const s = await state('Drawn');
    return s.builds[0]?.turn && s.conversation ? s : null;
  });
  const { conversation } = running;
  const { turn } = running.builds[0];
  await drive.agents.builds.onEvent(conversation, { type: 'progress.drawn', turn, html: '<p>first</p>' });
  await drive.agents.builds.onEvent(conversation, { type: 'progress.drawn', turn, html: '<p>second</p>' });
  let s = await state('Drawn');
  assert.equal(s.builds[0].drawn.html, '<p>second</p>', 'the latest, in the state every tab is sent');
  assert.equal(s.builds[0].hasDrawn, true);
  await drive.agents.builds.onEvent(conversation, { type: 'progress.drawn', turn, html: 'x'.repeat(40_001) });
  assert.equal((await state('Drawn')).builds[0].drawn.html, '<p>second</p>', 'one too large is dropped');

  await api('POST', '/agent/builds/b1/stop?path=Drawn', {});
  await drive.agents.builds.onEvent(conversation, { type: 'progress.drawn', turn, html: '<p>late</p>' });
  assert.equal((await state('Drawn')).builds[0].drawn.html, '<p>second</p>', 'a drawing after the end is stale');
  await drive.agents.builds.onEvent(conversation, { type: 'progress.drawn', turn, html: '<p>final</p>', final: true });
  s = await state('Drawn');
  assert.equal(s.builds[0].drawn.html, '<p>final</p>', 'unless it is the last one');
  const got = await api('GET', '/agent/builds/b1/drawn?path=Drawn');
  assert.equal(got.status, 200);
  assert.equal(got.body.drawn.html, '<p>final</p>');
  assert.equal((await api('GET', '/agent/builds/b9/drawn?path=Drawn')).status, 404);
});

test('pieces: saved from an app, listed, drawn in a sandbox, and found in the drive', async () => {
  const saved = await api('POST', '/agent/pieces', { path: 'Calendar', id: 'w', line: 'Your deadlines, on a line' });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.title, 'Weeks ahead');
  assert.equal(saved.body.html, undefined, 'the list does not carry markup');
  const list = await api('GET', '/agent/pieces?path=Second');
  assert.equal(list.body.saved[0].id, saved.body.id);
  assert.ok(list.body.drive.some((p) => p.title === 'Weeks ahead' && p.doc === 'Calendar'));
  const preview = await fetch(`${base}/agent/pieces/preview?id=${saved.body.id}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-security-policy'), /sandbox/);
  assert.match(await preview.text(), /Weeks ahead/);
  assert.equal((await api('DELETE', `/agent/pieces/${saved.body.id}`)).body.removed, true);
});
