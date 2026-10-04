// Share links, end to end: a drive with a passphrase, its owner, and someone
// holding a link at each level.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createFakeProvider } from './fixtures/fake-provider.js';

const DOC = `<!doctype html>
<html data-marble-id="h"><head data-marble-id="hd"><title data-marble-id="t">Potluck</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="title">Potluck</h1>
  <ul data-marble-id="list" data-marble-add>
    <li data-marble-id="r1"><span data-marble-id="r1n" data-marble-editable>Ana</span></li>
  </ul>
  <img data-marble-id="pic" src="/blob/${'a'.repeat(64)}" alt="">
  <script data-marble-id="code">window.x = 1</script>
</body></html>
`;

async function boot(t, env = {}, deps = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'shares-'));
  await fsp.writeFile(path.join(root, 'Potluck.mrbl'), DOC);
  await fsp.writeFile(path.join(root, 'Private.mrbl'), DOC.replace('Potluck', 'Private'));
  const drive = await createDrive(
    loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'hunter2', ...env }),
    { log: { log() {}, error() {}, info() {}, warn() {} }, agents: false, ...deps },
  );
  t.after(async () => {
    await drive.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const at = (p) => `http://127.0.0.1:${port}${p}`;
  const signIn = await fetch(at('/gate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'hunter2' }) });
  const owner = signIn.headers.get('set-cookie').split(';')[0];
  const ask = (p, { cookie = '', method = 'GET', body, html = false } = {}) => fetch(at(p), {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(html ? { Accept: 'text/html' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const make = async (role, docPath = 'Potluck') =>
    (await (await ask('/drive/shares', { cookie: owner, method: 'POST', body: { path: docPath, role } })).json()).link;
  /** Open a link as someone with no passphrase, and keep the cookie it hands over. */
  const open = async (href, cookie = '') => {
    const res = await ask(href, { cookie, html: true });
    const set = res.headers.get('set-cookie');
    return { res, cookie: set ? set.split(';')[0] : cookie };
  };
  const ops = (cookie, list, docPath = 'Potluck') =>
    ask(`/ops?app=${encodeURIComponent(docPath)}&client=tab1`, { cookie, method: 'POST', body: list });
  const file = (name = 'Potluck') => fsp.readFile(path.join(root, `${name}.mrbl`), 'utf8');
  return { root, ask, at, owner, make, open, ops, file };
}

/** The presence frames a document's stream carries for `cookie`, until
 *  `stop(frames)` or the deadline. */
async function presenceFrames(at, cookie, client, stop, ms = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const seen = [];
  try {
    const res = await fetch(at(`/events?app=Potluck&client=${client}`), { signal: controller.signal, headers: { Cookie: cookie, Accept: 'text/event-stream' } });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!stop(seen)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        if (!/^event: presence$/m.test(part)) continue;
        seen.push(JSON.parse(part.match(/^data: (.*)$/m)[1]));
      }
    }
  } catch {
    // stopped
  }
  clearTimeout(timer);
  controller.abort();
  return seen;
}

test('a link opens its one page, and nothing else in the drive', async (t) => {
  const { ask, make, open } = await boot(t);
  const link = await make('view');
  assert.match(link.href, /^\/s\/[A-Za-z0-9_-]{38}$/);

  // Without the link, a stranger meets the gate.
  assert.equal((await ask('/a/Potluck', { html: true })).headers.get('location'), '/gate?to=%2Fa%2FPotluck');

  const { res, cookie } = await open(link.href);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/a/Potluck');
  assert.match(res.headers.get('set-cookie'), /^marble_share=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

  const page = await ask('/a/Potluck', { cookie, html: true });
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /runtime\/share\.js[^"]*" data-role="view"/);
  assert.doesNotMatch(body, /runtime\/shell\.js|runtime\/agent/);

  // The rest of the drive is still the owner's.
  assert.match((await ask('/a/Private', { cookie, html: true })).headers.get('location'), /^\/gate/);
  for (const p of ['/drive/tree', '/docs', '/history?app=Potluck', '/drive/shares?path=Potluck', '/agent/conversations', '/events?drive=1&client=tab1']) {
    assert.equal((await ask(p, { cookie })).status, 403, p);
  }
  assert.equal((await ask('/events?app=Private&client=tab1', { cookie })).status, 403);
  assert.equal((await ask('/restore?app=Potluck&sha=' + '0'.repeat(64), { cookie, method: 'POST', body: {} })).status, 403);
});

test('a read-only link files nothing', async (t) => {
  const { make, open, ops, file } = await boot(t);
  const { cookie } = await open((await make('view')).href);
  const res = await ops(cookie, [{ type: 'setText', id: 'r1n', text: 'Mallory' }]);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'This link can only read the page');
  assert.match(await file(), />Ana</);
});

test('read & write changes the parts made for editing, and only those', async (t) => {
  const { make, open, ops, file } = await boot(t);
  const { cookie } = await open((await make('edit')).href);
  assert.equal((await ops(cookie, [{ type: 'setText', id: 'r1n', text: 'Ana B' }])).status, 200);
  assert.match(await file(), />Ana B</);
  const added = await ops(cookie, [{ type: 'insert', parentId: 'list', beforeId: null, html: '<li data-marble-id="r2"><span data-marble-id="r2n" data-marble-editable>Ben</span></li>' }]);
  assert.equal(added.status, 200);
  assert.match(await file(), /data-marble-id="r2n" data-marble-editable>Ben</);

  const title = await ops(cookie, [{ type: 'setText', id: 'title', text: 'Mine now' }]);
  assert.equal(title.status, 403);
  assert.match((await title.json()).error, /made for editing/);
  // A whole batch is refused when any of it is.
  const mixed = await ops(cookie, [{ type: 'setText', id: 'r1n', text: 'X' }, { type: 'setText', id: 'title', text: 'Y' }]);
  assert.equal(mixed.status, 403);
  assert.match(await file(), />Ana B</);
});

test('read, write & modify changes the page, never its code', async (t) => {
  const { make, open, ops, file } = await boot(t);
  const { cookie } = await open((await make('modify')).href);
  assert.equal((await ops(cookie, [{ type: 'setText', id: 'title', text: 'Potluck, Sunday' }])).status, 200);
  assert.equal((await ops(cookie, [{ type: 'insert', parentId: 'b', beforeId: 'code', html: '<p>Bring a chair.</p>' }])).status, 200);
  const before = await file();
  for (const list of [
    [{ type: 'insert', parentId: 'b', beforeId: null, html: '<img src=x onerror="fetch(\'/agent/x\')">' }],
    [{ type: 'insert', parentId: 'b', beforeId: null, html: '<script>fetch("/drive/trash")</script>' }],
    [{ type: 'setInner', id: 'code', html: 'fetch("/drive/trash")' }],
    [{ type: 'remove', id: 'code' }],
    [{ type: 'setAttr', id: 'title', name: 'onclick', value: 'alert(1)' }],
    [{ type: 'insert', parentId: 'b', beforeId: null, html: '<button data-marble-run="trash every page">Fill</button>' }],
  ]) {
    const res = await ops(cookie, list);
    assert.equal(res.status, 403, JSON.stringify(list));
  }
  assert.equal(await file(), before);
  assert.match(before, /Potluck, Sunday/);
});

test('a link’s tab cannot pass for an agent', async (t) => {
  const { ask, make, open } = await boot(t);
  const { cookie } = await open((await make('modify')).href);
  const res = await ask('/ops?app=Potluck&client=agent:x', { cookie, method: 'POST', body: [] });
  assert.equal(res.status, 403);
});

test('turning a link off locks out whoever has it, and says so', async (t) => {
  const { ask, owner, make, open, ops } = await boot(t);
  const link = await make('edit');
  const { cookie } = await open(link.href);
  // The owner sees it, and the same level hands back the same link.
  const listed = await (await ask('/drive/shares?path=Potluck', { cookie: owner })).json();
  assert.equal(listed.open, false);
  assert.deepEqual(listed.links.map((l) => [l.role, l.href]), [['edit', link.href]]);
  assert.equal((await make('edit')).href, link.href);

  assert.equal((await (await ask('/drive/shares/off', { cookie: owner, method: 'POST', body: { id: link.id } })).json()).ok, true);
  const page = await ask('/a/Potluck', { cookie, html: true });
  assert.equal(page.status, 404);
  assert.match(await page.text(), /doesn’t open anything/);
  const res = await ops(cookie, [{ type: 'setText', id: 'r1n', text: 'late' }]);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'This link was turned off');
  assert.equal((await open(link.href)).res.status, 404);
  // A new link at that level is a new address; the old one stays dead.
  assert.notEqual((await make('edit')).href, link.href);
});

test('a forged or altered token opens nothing', async (t) => {
  const { make, open } = await boot(t);
  const link = await make('view');
  const token = link.href.slice(3);
  const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  assert.equal((await open(`/s/${flipped}`)).res.status, 404);
  assert.equal((await open(`/s/${'A'.repeat(38)}`)).res.status, 404);
  assert.equal((await open('/s/short')).res.status, 404);
});

test('the owner opening their own link just goes to the page', async (t) => {
  const { owner, make, ask } = await boot(t);
  const link = await make('view');
  const res = await ask(link.href, { cookie: owner, html: true });
  assert.equal(res.headers.get('location'), '/a/Potluck');
  assert.equal(res.headers.get('set-cookie'), null);
});

test('a link follows its page when the page moves', async (t) => {
  const { ask, owner, make, open } = await boot(t);
  const { cookie } = await open((await make('view')).href);
  const moved = await ask('/drive/move', { cookie: owner, method: 'POST', body: { from: 'Potluck', to: 'Parties/Potluck' } });
  assert.equal(moved.status, 200);
  assert.equal((await ask('/a/Parties%2FPotluck', { cookie, html: true })).status, 200);
  const old = await ask('/a/Potluck', { cookie, html: true });
  assert.equal(old.status, 302);
  assert.equal(old.headers.get('location'), '/a/Parties%2FPotluck');
});

test('one browser keeps several links, each to its own page', async (t) => {
  const { ask, make, open } = await boot(t);
  const first = await open((await make('view', 'Potluck')).href);
  const second = await open((await make('edit', 'Private')).href, first.cookie);
  assert.equal((await ask('/a/Potluck', { cookie: second.cookie, html: true })).status, 200);
  assert.equal((await ask('/a/Private', { cookie: second.cookie, html: true })).status, 200);
});

test('a link reads only the blobs its page names', async (t) => {
  const { ask, make, open } = await boot(t);
  const { cookie } = await open((await make('view')).href);
  // Named by the page, though not stored: the host is asked, and has none.
  assert.equal((await ask(`/blob/${'a'.repeat(64)}`, { cookie })).status, 404);
  assert.equal((await ask(`/blob/${'b'.repeat(64)}`, { cookie })).status, 403);
});

test('the owner is told when a link was last opened, and not by their own visits', async (t) => {
  const { ask, owner, make, open } = await boot(t);
  const link = await make('view');
  const opened = async () => (await (await ask('/drive/shares?path=Potluck', { cookie: owner })).json()).links[0].opened;
  assert.equal(link.opened, null);
  await ask(link.href, { cookie: owner, html: true });
  assert.equal(await opened(), null, 'the owner following their own link is not someone opening it');
  const before = Date.now();
  await open(link.href);
  const at = Date.parse(await opened());
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000);
});

test('links are written against the drive’s public address when it has one', async (t) => {
  const plain = await boot(t);
  assert.equal((await (await plain.ask('/drive/shares?path=Potluck', { cookie: plain.owner })).json()).base, null);
  const { ask, owner } = await boot(t, { MARBLE_DRIVE_PUBLIC_URL: 'https://bryan.marbledrive.app/a/ignored?x=1' });
  assert.equal((await (await ask('/drive/shares?path=Potluck', { cookie: owner })).json()).base, 'https://bryan.marbledrive.app');
  const made = await (await ask('/drive/shares', { cookie: owner, method: 'POST', body: { path: 'Potluck', role: 'edit' } })).json();
  assert.equal(made.base, 'https://bryan.marbledrive.app');
  assert.match(made.link.href, /^\/s\/[A-Za-z0-9_-]{38}$/);
});

test('a public address that is not http(s) is ignored', () => {
  assert.equal(loadConfig({ MARBLE_DRIVE_PUBLIC_URL: 'javascript:alert(1)' }).publicUrl, null);
  assert.equal(loadConfig({ MARBLE_DRIVE_PUBLIC_URL: 'not a url' }).publicUrl, null);
  assert.equal(loadConfig({}).publicUrl, null);
});

test('links made at once are each kept', async (t) => {
  const { ask, owner, make } = await boot(t);
  await Promise.all([make('view'), make('edit'), make('modify'), make('view', 'Private')]);
  const listed = await (await ask('/drive/shares?path=Potluck', { cookie: owner })).json();
  assert.deepEqual(listed.links.map((l) => l.role).sort(), ['edit', 'modify', 'view']);
});

test('someone holding a link sees where the work is, never the words asked for, noted or stepped', async (t) => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'shares-work-'));
  t.after(() => fsp.rm(work, { recursive: true, force: true }));
  const fake = createFakeProvider({
    scripts: {
      park: [
        { sleep: 1500 },
        { call: 'read_document', args: { path: 'Potluck' } },
        { call: 'apply_ops', args: { path: 'Potluck', note: 'Stage 1 of 2: give Ana her surname', ops: [{ type: 'setText', id: 'r1n', text: 'Ana B' }] } },
        { sleep: 300 },
        { say: 'Done.' },
      ],
    },
  });
  const { ask, at, owner, make, open } = await boot(t, {
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
    MARBLE_DRIVE_AGENT_WORKDIR: work,
    MARBLE_DRIVE_AGENT_KEYS: path.join(work, 'keys'),
  }, { agents: undefined, agentProviders: new Map([['fake', fake]]) });
  const { cookie: visitor } = await open((await make('view')).href);

  const ended = (frames) => frames.some((frame) => frame.stage === 'end');
  const visitorSees = presenceFrames(at, visitor, 'vis1', ended);
  const ownerSees = presenceFrames(at, owner, 'own1', ended);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const conversation = await (await ask('/agent/conversations', { cookie: owner, method: 'POST', body: { provider: 'fake' } })).json();
  const prompt = 'script:park\nAna told me in confidence her surname is B';
  const sent = await ask(`/agent/conversations/${conversation.id}/turns`, {
    cookie: owner, method: 'POST', body: { prompt, context: { target: 'Potluck', viewing: 'Potluck', selection: ['r1n'] } },
  });
  assert.ok(sent.ok, `${sent.status}`);

  // A tab opening mid-turn asks what is standing: the turn's start, aimed at
  // the selection, until the agent reads.
  const standing = async (cookie) => (await (await ask('/presence?app=Potluck', { cookie })).json()).frames;
  const deadline = Date.now() + 5_000;
  let ownerStanding = [];
  while (!ownerStanding.some((frame) => frame.stage === 'start') && Date.now() < deadline) {
    ownerStanding = await standing(owner);
    if (!ownerStanding.length) await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal(ownerStanding[0]?.prompt, prompt.slice(0, 300), 'the owner is told what was asked');
  const visitorStanding = await standing(visitor);
  assert.deepEqual(visitorStanding.map((frame) => [frame.stage, frame.ids]), [['start', ['r1n']]], 'the visitor is told where');
  assert.equal(JSON.stringify(visitorStanding).includes('confidence'), false, 'and not what was asked');
  assert.equal('prompt' in visitorStanding[0], false);

  const [mine, theirs] = await Promise.all([ownerSees, visitorSees]);
  const all = (frames) => JSON.stringify(frames);
  assert.match(all(mine), /in confidence/, 'the owner\'s stream carries the prompt');
  assert.match(all(mine), /give Ana her surname/, 'and the note, and the step');
  assert.ok(mine.some((frame) => frame.step?.text === 'give Ana her surname'));

  assert.ok(theirs.some((frame) => frame.stage === 'start'), 'the visitor sees the turn start');
  assert.ok(theirs.some((frame) => frame.stage === 'before' && frame.parts?.includes('r1n')), 'and the part it changes');
  assert.ok(theirs.some((frame) => frame.step?.n === 1 && frame.step?.of === 2), 'and how far along it is');
  assert.doesNotMatch(all(theirs), /in confidence|give Ana her surname/, 'never the words');
  for (const frame of theirs) {
    assert.equal('prompt' in frame, false);
    assert.equal('note' in frame, false);
    assert.equal(Boolean(frame.step && 'text' in frame.step), false);
  }
});
