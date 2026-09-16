import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-tools-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { enginePath } = await import('../server/engine.js');
const { build } = await import('../server/gallery.js');
const { createTools, TOOL_SCHEMAS } = await import('../server/agent/tools.js');

const drive = await createDrive(loadConfig(), { log: { log() {}, error() {} } });
const tools = createTools({
  store: drive.store,
  writeOps: drive.writeOps,
  createDocument: drive.createDocument,
  buildStarter: build,
  guidePath: enginePath('skills/build-in-marble/SKILL.md'),
});

const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why?</li>
    <li data-marble-id="q2">How?</li>
  </ul>
</body></html>
`;

let n = 0;
async function freshTurn(conversationId = `c${++n}`) {
  const target = `garden-${n}`;
  await drive.createDocument(target, SOURCE, { label: 'test' });
  const events = [];
  return {
    id: `${conversationId}.1`,
    conversationId,
    target,
    writable: new Set([target]),
    undo: [],
    events,
    onEvent: (event) => events.push(event),
  };
}

test('the schemas name exactly the five tools', () => {
  assert.deepEqual(TOOL_SCHEMAS.map((t) => t.name).sort(), [
    'apply_ops', 'create_document', 'list_documents', 'read_document', 'read_guide',
  ]);
  for (const t of TOOL_SCHEMAS) assert.equal(t.inputSchema.type, 'object');
});

test('an edit to an element never read is refused, and the refusal counts as a read', async () => {
  const turn = await freshTurn();
  const first = await tools.call('apply_ops', {
    path: turn.target, note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  assert.equal(first.refused, true);
  assert.match(first.reason, /read/);
  assert.equal(first.current[0].id, 'h');
  assert.deepEqual(turn.events.at(-1), { type: 'ops.refused', path: turn.target, reason: first.reason });

  const second = await tools.call('apply_ops', {
    path: turn.target, note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  assert.equal(second.applied, 1);
  assert.match(await drive.store.read(turn.target), />Backlog</);
});

test('reading the whole document lets the agent edit anything it was shown in full', async () => {
  const turn = await freshTurn();
  const read = await tools.call('read_document', { path: turn.target }, turn);
  assert.equal(read.whole, true);
  assert.match(read.source, /Why\?/);
  const result = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'q1', text: 'Why not?' }],
  }, turn);
  assert.equal(result.applied, 1);
  assert.deepEqual(turn.events.at(-1), { type: 'ops.applied', path: turn.target, count: 1 });
});

test('an element a person changed after the agent read it is refused with its current source', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target, ids: ['q2'] }, turn);
  // The person types into the same item.
  await drive.writeOps(turn.target, [{ type: 'setText', id: 'q2', text: 'How, exactly?' }], { client: 'tab' });

  const result = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'q2', text: 'How come?' }],
  }, turn);
  assert.equal(result.refused, true);
  assert.match(result.reason, /changed since/);
  assert.match(result.current[0].html, /How, exactly\?/);
  assert.match(await drive.store.read(turn.target), /How, exactly\?/, 'the person keeps their text');
});

test('the agent can make consecutive edits without re-reading its own work', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target, ids: ['q'] }, turn);
  const one = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'q1', text: 'A' }],
  }, turn);
  const two = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setAttr', id: 'q', name: 'class', value: 'backlog' }],
  }, turn);
  assert.equal(one.applied, 1);
  assert.equal(two.applied, 1, 'the list changed because of the agent, which is not stale');
});

test('an insert needs only its parent to exist, and its new element is editable next', async () => {
  const turn = await freshTurn();
  const inserted = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'insert', html: '<li>New question</li>', parentId: 'q', beforeId: null }],
  }, turn);
  assert.equal(inserted.applied, 1);
  assert.equal(inserted.introduced.length, 1, 'repairOps minted the id');
  const [id] = inserted.introduced;
  const edited = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'setText', id, text: 'Sharper question' }],
  }, turn);
  assert.equal(edited.applied, 1);
});

test('every applied batch leaves an undo record', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'remove', id: 'q2' }] }, turn);
  assert.equal(turn.undo.length, 1);
  assert.equal(turn.undo[0].path, turn.target);
  assert.equal(turn.undo[0].steps[0].absent, 'q2');
});

test('only the target and what the turn created are writable', async () => {
  const turn = await freshTurn();
  const other = await tools.call('apply_ops', {
    path: 'somewhere-else', note: 'x', ops: [{ type: 'remove', id: 'h' }],
  }, turn);
  assert.match(other.error, /not writable/);

  const made = await tools.call('create_document', { path: `made-${n}`, from: 'doc' }, turn);
  assert.equal(made.path, `made-${n}`);
  assert.ok(turn.writable.has(`made-${n}`));
});

test('a batch the checks reject comes back as a reason, not a crash', async () => {
  const turn = await freshTurn();
  const result = await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [] }, turn);
  assert.equal(result.refused, true);
  assert.match(result.reason, /no ops/);
});

test('list and guide', async () => {
  const turn = await freshTurn();
  const listed = await tools.call('list_documents', {}, turn);
  assert.ok(listed.documents.some((d) => d.path === turn.target));
  const guide = await tools.call('read_guide', {}, turn);
  assert.ok(guide.sections.includes('The op vocabulary'));
  const section = await tools.call('read_guide', { section: 'op vocabulary' }, turn);
  assert.match(section.text, /setInner/);
});

test('a path outside the drive is an error', async () => {
  const turn = await freshTurn();
  const result = await tools.call('read_document', { path: '../etc/passwd' }, turn);
  assert.ok(result.error);
});

test('setInner that introduces new elements gets them minted ids, not left unaddressable', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  const result = await tools.call('apply_ops', {
    path: turn.target, note: 'x',
    ops: [{ type: 'setInner', id: 'q', html: '<li>New one</li><li>New two</li>' }],
  }, turn);
  assert.equal(result.applied, 1);
  const stored = await drive.store.read(turn.target);
  assert.doesNotMatch(stored, /<li>New/, 'every inserted <li> should have gotten a data-marble-id');
});

const { undoTurn } = await import('../server/agent/undo.js');

test('undo reverts the agent and keeps what a person changed afterwards', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'remove', id: 'q2' }] }, turn);
  const inserted = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'insert', html: '<li>Where?</li>', parentId: 'q', beforeId: null }],
  }, turn);
  const [newId] = inserted.introduced;

  // The person rewrites the item the agent added.
  await drive.writeOps(turn.target, [{ type: 'setText', id: newId, text: 'Where, and when?' }], { client: 'tab' });

  const result = await undoTurn({ records: turn.undo, writeOps: drive.writeOps, client: `agent-undo:${turn.conversationId}` });
  assert.deepEqual(result, { reverted: 2, kept: 1, errors: [] });

  const after = await drive.store.read(turn.target);
  assert.match(after, />Research Garden</);
  assert.match(after, /data-marble-id="q2">How\?/);
  assert.match(after, /Where, and when\?/, 'the person\'s edit survives');
});

test('undoing a turn whose document is gone reports it instead of throwing', async () => {
  const result = await undoTurn({
    records: [{ path: 'no-such-doc', steps: [{ inverse: { type: 'remove', id: 'x' }, id: 'x', expect: 'abc', absent: null }] }],
    writeOps: drive.writeOps,
    client: 'agent-undo:x',
  });
  assert.equal(result.reverted, 0);
  assert.equal(result.kept, 1);
  assert.match(result.errors[0], /no document/);
});

test.after(() => drive.close());
