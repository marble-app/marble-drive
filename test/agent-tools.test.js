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
const { enginePath, examine } = await import('../server/engine.js');
const { build, composeScript } = await import('../server/gallery.js');
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

test('the schemas name the marble tools', () => {
  assert.deepEqual(TOOL_SCHEMAS.map((t) => t.name).sort(), [
    'affordance_script', 'apply_ops', 'check_document', 'create_document', 'fan_out', 'list_agents', 'list_documents', 'read_document', 'read_guide', 'send_message', 'wait_for_reply',
  ]);
  for (const t of TOOL_SCHEMAS) assert.equal(t.inputSchema.type, 'object');
});

test('the messaging tools delegate to the host and pass the turn through', async () => {
  const seen = [];
  const messaging = {
    peers: async (turn) => { seen.push(['peers', turn.conversationId]); return { agents: [] }; },
    deliver: async (turn, input) => { seen.push(['deliver', turn.conversationId, input]); return { messageId: 'm', delivered: 'turn', to: { id: input.to, title: null } }; },
    wait: async (turn, seconds) => { seen.push(['wait', turn.conversationId, seconds]); return { timeout: true }; },
  };
  const t = createTools({
    store: drive.store, writeOps: drive.writeOps, createDocument: drive.createDocument,
    buildStarter: build, guidePath: enginePath('skills/build-in-marble/SKILL.md'), messaging,
  });
  const turn = await freshTurn();
  assert.deepEqual(await t.call('list_agents', {}, turn), { agents: [] });
  assert.equal((await t.call('send_message', { to: 'b', text: 'hi', about: { path: 'garden', ids: ['h'] } }, turn)).messageId, 'm');
  assert.deepEqual(await t.call('wait_for_reply', { seconds: 30 }, turn), { timeout: true });
  assert.deepEqual(seen, [
    ['peers', turn.conversationId],
    ['deliver', turn.conversationId, { to: 'b', text: 'hi', about: { path: 'garden', ids: ['h'] }, inReplyTo: null }],
    ['wait', turn.conversationId, 30],
  ]);
});

test('without a messaging host the tools say so instead of throwing', async () => {
  const turn = await freshTurn();
  assert.match((await tools.call('list_agents', {}, turn)).error, /not available/);
  assert.match((await tools.call('send_message', { to: 'b', text: 'x' }, turn)).error, /not available/);
  assert.match((await tools.call('wait_for_reply', {}, turn)).error, /not available/);
});

test('send_message and wait_for_reply describe the caps and the meaning of a timeout', () => {
  const send = TOOL_SCHEMAS.find((t) => t.name === 'send_message');
  const wait = TOOL_SCHEMAS.find((t) => t.name === 'wait_for_reply');
  assert.deepEqual(send.inputSchema.required, ['to', 'text']);
  assert.equal(send.inputSchema.properties.text.maxLength, 4000);
  assert.match(send.description, /12/);
  assert.equal(wait.inputSchema.properties.seconds.maximum, 300);
  assert.match(wait.description, /nothing/i);
});

test('apply_ops tells an agent the shape of an op, not just an object', () => {
  const applyOps = TOOL_SCHEMAS.find((t) => t.name === 'apply_ops');
  const items = applyOps.inputSchema.properties.ops.items;
  assert.deepEqual(items.properties.type.enum, ['setText', 'setInner', 'setAttr', 'insert', 'move', 'remove']);
  assert.ok(items.required.includes('type'));
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
  assert.ok(guide.sections.includes('Growing the open page'));
  const section = await tools.call('read_guide', { section: 'op vocabulary' }, turn);
  assert.match(section.text, /setInner/);
  const grow = await tools.call('read_guide', { section: 'growing the open page' }, turn);
  assert.match(grow.text, /insert a stub/i);
  // The section carries the whole staged method, subsections included: the
  // splitter cuts on "## " and a "### " heading is not one.
  assert.match(grow.text, /### What a stage is/);
  assert.match(grow.text, /### Filler/);
  assert.match(grow.text, /Whole\./);
  assert.match(grow.text, /Continuous\./);
  assert.match(grow.text, /Named\./);
  assert.match(grow.text, /Stage 2 of 4/);
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

test('an insert of several elements is undone whole', async () => {
  const turn = await freshTurn();
  const inserted = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: [{ type: 'insert', html: '<li data-marble-id="a">two</li><li data-marble-id="bb">three</li>', parentId: 'q', beforeId: null }],
  }, turn);
  assert.equal(inserted.applied, 1);
  assert.deepEqual(inserted.introduced, ['a', 'bb']);
  const result = await undoTurn({ records: turn.undo, writeOps: drive.writeOps, client: `agent-undo:${turn.conversationId}` });
  assert.deepEqual(result, { reverted: 2, kept: 0, errors: [] });
  const after = await drive.store.read(turn.target);
  assert.doesNotMatch(after, /two|three/);
});

test('undo looks before each batch and hands writeOps a matching after-presence', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] }, turn);
  const looks = [];
  const presences = [];
  const recordingWriteOps = async (docPath, ops, options) => {
    const result = await drive.writeOps(docPath, ops, options);
    presences.push(options.presence);
    return result;
  };
  const result = await undoTurn({
    records: turn.undo,
    writeOps: recordingWriteOps,
    client: `agent-undo:${turn.conversationId}`,
    turn: turn.id,
    look: (docPath, ids, extra) => looks.push({ docPath, ids, extra }),
  });
  assert.equal(result.reverted, 1);
  assert.equal(looks.length, 1);
  assert.equal(looks[0].docPath, turn.target);
  assert.deepEqual(looks[0].ids, ['h']);
  assert.deepEqual(looks[0].extra, { stage: 'before', turn: turn.id, parts: ['h'] });
  assert.deepEqual(presences[0], { stage: 'after', turn: turn.id, parts: ['h'] });
});

test('undoing a remove reinserts the element, and names its id in the presence frames', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'remove', id: 'q2' }] }, turn);
  const looks = [];
  const presences = [];
  const recordingWriteOps = async (docPath, ops, options) => {
    const result = await drive.writeOps(docPath, ops, options);
    presences.push(options.presence);
    return result;
  };
  const result = await undoTurn({
    records: turn.undo,
    writeOps: recordingWriteOps,
    client: `agent-undo:${turn.conversationId}`,
    turn: turn.id,
    look: (docPath, ids, extra) => looks.push({ docPath, ids, extra }),
  });
  assert.equal(result.reverted, 1);
  assert.equal(looks.length, 1, 'the inverse of a remove is still one look, even though its own op carries no id');
  assert.deepEqual(looks[0].ids, ['q2']);
  assert.deepEqual(looks[0].extra, { stage: 'before', turn: turn.id, parts: ['q2'] });
  assert.deepEqual(presences[0], { stage: 'after', turn: turn.id, parts: ['q2'] });
  assert.match(await drive.store.read(turn.target), /data-marble-id="q2">How\?</, 'the element itself came back');
});

/** A writeOps that runs `prepare` against `doc` in memory, for undo alone. */
function memoryWrites(doc) {
  const state = { doc };
  const { applyOps } = engine;
  state.writeOps = async (_path, _ops, options) => {
    const { ops } = await options.prepare(state.doc);
    state.doc = applyOps(state.doc, ops);
    return { applied: ops.length };
  };
  return state;
}
const engine = await import('../server/engine.js');
const { inverseSteps } = await import('../server/agent/inverse.js');

test('the redo an undo saves is the inverse of every inverse it ran, read from the page as it ran', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  for (const ops of [
    [{ type: 'setText', id: 'h', text: 'Backlog' }],
    [{ type: 'setAttr', id: 'q', name: 'class', value: 'tidy' }],
    [{ type: 'insert', html: '<li data-marble-id="q3">When?</li><li data-marble-id="q4">Who?</li>', parentId: 'q', beforeId: 'q2' }],
    [{ type: 'remove', id: 'q1' }],
    [{ type: 'move', id: 'q2', parentId: 'q', beforeId: 'q3' }],
    [{ type: 'setInner', id: 'h', html: 'Back<b data-marble-id="hb">log</b>' }],
  ]) {
    const result = await tools.call('apply_ops', { path: turn.target, note: 'x', ops }, turn);
    assert.ok(result.applied, JSON.stringify(result));
  }
  const afterTurn = await drive.store.read(turn.target);

  // What the redo was before: inverseSteps of each inverse, from the page
  // right before it ran.
  const expected = [];
  let current = afterTurn;
  for (const step of turn.undo.flatMap((record) => record.steps).reverse()) {
    if (!step.inverse) continue;
    expected.push(...inverseSteps(current, [step.inverse]));
    current = engine.applyOp(current, step.inverse);
  }

  const memory = memoryWrites(afterTurn);
  let saved = null;
  const result = await undoTurn({ records: turn.undo, writeOps: memory.writeOps, client: 'x', turn: turn.id, saveRedo: async (_id, record) => { saved = record; } });
  assert.equal(result.kept, 0);
  assert.equal(memory.doc, SOURCE, 'the page is back to where the turn started');
  assert.deepEqual(saved, { steps: [{ path: turn.target, steps: expected }], restores: [] });

  // And fed back in, it is the turn again (two rows inserted at once come
  // back one at a time, each on its own line).
  const redone = await undoTurn({ records: saved.steps, writeOps: memory.writeOps, client: 'x' });
  assert.equal(redone.kept, 0);
  const tight = (html) => html.replace(/>\s+</g, '><');
  assert.equal(tight(memory.doc), tight(afterTurn));
});

test('an undo reads the page once for each step it takes back, not again for its redo', async () => {
  const { watchParses } = await import('../server/agent/source.js');
  const rows = Array.from({ length: 20 }, (_, i) => `<li data-marble-id="r${i}">Row ${i}</li>`).join('');
  const start = SOURCE.replace('</ul>', `${rows}</ul>`);
  const records = [];
  let doc = start;
  for (let i = 0; i < 20; i += 1) {
    const op = { type: 'setText', id: `r${i}`, text: `Renamed ${i}` };
    records.push({ path: 'p', steps: inverseSteps(doc, [op]) });
    doc = engine.applyOp(doc, op);
  }
  const memory = memoryWrites(doc);
  let parses = 0;
  let saved = null;
  watchParses(() => {
    parses += 1;
  });
  try {
    await undoTurn({ records, writeOps: memory.writeOps, client: 'x', turn: 't', saveRedo: async (_id, record) => { saved = record; } });
  } finally {
    watchParses(null);
  }
  assert.equal(memory.doc, start);
  assert.equal(saved.steps[0].steps.length, 20);
  assert.ok(parses <= 21, `${parses} parses for 20 steps`);
});

test('an undo that only restored a document saves no redo, and drops one left from before', async () => {
  const calls = [];
  const result = await undoTurn({
    records: [],
    restores: [{ path: 'p', sha: 'abc' }],
    writeOps: async () => ({ applied: 0 }),
    restore: async () => {},
    client: 'x',
    turn: 't',
    saveRedo: async (id, record) => calls.push(['save', id, record]),
    dropRedo: async (id) => calls.push(['drop', id]),
  });
  assert.equal(result.reverted, 1);
  assert.deepEqual(calls, [['drop', 't']]);
});

test('a redo that could not be saved does not fail the undo', async () => {
  const turn = await freshTurn();
  await tools.call('read_document', { path: turn.target }, turn);
  await tools.call('apply_ops', { path: turn.target, note: 'x', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] }, turn);
  const errors = [];
  const result = await undoTurn({
    records: turn.undo,
    writeOps: drive.writeOps,
    client: `agent-undo:${turn.conversationId}`,
    turn: turn.id,
    saveRedo: async () => {
      throw new Error('disk full');
    },
    log: { error: (line) => errors.push(line) },
  });
  assert.deepEqual(result, { reverted: 1, kept: 0, errors: [] });
  assert.match(await drive.store.read(turn.target), />Research Garden</);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /disk full/);
});

test('a refusal only counts as a read for elements it showed in full', async () => {
  const turn = await freshTurn();
  const para = (id) => `<section data-marble-id="${id}">${Array.from({ length: 90 }, (_, i) => `<p data-marble-id="${id}p${i}">Paragraph ${i} of a long section, long enough to matter.</p>`).join('')}</section>`;
  await drive.createDocument(turn.target, SOURCE.replace('</ul>', `</ul>${para('s1')}${para('s2')}`), { label: 'test' });
  const ops = [{ type: 'setAttr', id: 's1', name: 'class', value: 'x' }, { type: 'setAttr', id: 's2', name: 'class', value: 'x' }];
  const first = await tools.call('apply_ops', { path: turn.target, note: 'x', ops }, turn);
  assert.equal(first.refused, true);
  const whole = first.current.filter((c) => !c.outline).map((c) => c.id);
  const outlined = ['s1', 's2'].filter((id) => !whole.includes(id));
  assert.equal(outlined.length, 1, 'the two sections do not both fit the refusal budget whole');

  const retryOutlined = await tools.call('apply_ops', {
    path: turn.target, note: 'x', ops: ops.filter((op) => outlined.includes(op.id)),
  }, turn);
  assert.equal(retryOutlined.refused, true, 'an element shown only as an outline is still unread');
  if (whole.length) {
    const retryWhole = await tools.call('apply_ops', {
      path: turn.target, note: 'x', ops: ops.filter((op) => whole.includes(op.id)),
    }, turn);
    assert.equal(retryWhole.applied, 1, 'an element shown in full is now read');
  }
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

test('check_document reports the format\'s own invariants', async () => {
  const sources = new Map([['notes', '<h1 data-marble-id="h1">Hi</h1>']]);
  const checking = createTools({
    store: { read: async (p) => sources.get(p) ?? null, has: async (p) => sources.has(p), list: async () => [] },
    writeOps: async () => ({ applied: 0 }),
    createDocument: async () => {},
    buildStarter: async () => '',
    guidePath: '/dev/null',
    examine: (name, source) => (source.includes('data-marble-id') ? [] : [{ level: 'error', message: 'no ids' }]),
  });
  const turn = { conversationId: 'c1', target: 'notes', writable: new Set(['notes']), undo: [], onEvent() {} };

  assert.deepEqual(await checking.call('check_document', { path: 'notes' }, turn), { path: 'notes', findings: [] });

  sources.set('notes', '<h1>Hi</h1>');
  const bad = await checking.call('check_document', { path: 'notes' }, turn);
  assert.equal(bad.findings.length, 1);
  assert.match(bad.findings[0].message, /no ids/);

  assert.deepEqual(await checking.call('check_document', { path: 'nope' }, turn), { error: 'no document "nope"' });
});

const lookingTools = (onLook) => createTools({
  store: drive.store,
  writeOps: drive.writeOps,
  createDocument: drive.createDocument,
  buildStarter: build,
  guidePath: enginePath('skills/build-in-marble/SKILL.md'),
  examine: () => [],
  onLook,
});

test('reading a document outlines those ids for the page, without counting as a write', async () => {
  const seen = [];
  const looking = lookingTools((docPath, ids, client, extra) => seen.push({ docPath, ids, client, extra }));
  const turn = await freshTurn();
  await looking.call('read_document', { path: turn.target, ids: ['h'] }, turn);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].docPath, turn.target);
  assert.deepEqual(seen[0].ids, ['h']);
  assert.equal(seen[0].client, `agent:${turn.conversationId}`);
  assert.equal(seen[0].extra?.phase, 'reading');
});

test('apply_ops tapes off the ids it is about to change', async () => {
  const seen = [];
  const looking = lookingTools((docPath, ids, client, extra) => seen.push({ docPath, ids, client, extra }));
  const turn = await freshTurn();
  await looking.call('read_document', { path: turn.target, ids: ['h'] }, turn);
  seen.length = 0;
  await looking.call('apply_ops', {
    path: turn.target, note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  const writing = seen.find((s) => s.extra?.phase === 'writing');
  assert.ok(writing, 'apply_ops should look before it writes');
  assert.deepEqual(writing.ids, ['h']);
  assert.equal(writing.extra.note, 'rename the heading');
  assert.equal(writing.client, `agent:${turn.conversationId}`);
});

test('a refused apply_ops does not tape off the page', async () => {
  const seen = [];
  const looking = lookingTools((docPath, ids, client, extra) => seen.push({ docPath, ids, client, extra }));
  const turn = await freshTurn();
  await looking.call('apply_ops', {
    path: turn.target, note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  assert.equal(seen.length, 0);
});

test('apply_ops tells the page which parts, the step, a running count, and what is coming', async () => {
  const looks = [];
  const presences = [];
  const recordingWriteOps = async (docPath, ops, options) => {
    const result = await drive.writeOps(docPath, ops, options);
    presences.push(options.presence);
    return result;
  };
  const v5Tools = createTools({
    store: drive.store,
    writeOps: recordingWriteOps,
    createDocument: drive.createDocument,
    buildStarter: build,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
    examine: () => [],
    onLook: (docPath, ids, client, extra) => looks.push({ docPath, ids, client, extra }),
  });
  const turn = await freshTurn();
  await v5Tools.call('read_document', { path: turn.target }, turn);

  await v5Tools.call('apply_ops', {
    path: turn.target, note: 'Stage 1 of 2: rename the title', total: 2,
    ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  const before1 = looks.find((l) => l.extra?.stage === 'before');
  assert.equal(before1.extra.turn, turn.id);
  assert.deepEqual(before1.extra.parts, ['h']);
  assert.equal(before1.extra.kind, 'words');
  assert.equal(before1.extra.count, 1);
  assert.deepEqual(before1.extra.step, { n: 1, of: 2, text: 'rename the title' });
  assert.equal(before1.extra.total, 2);
  assert.equal(before1.extra.reach, null);
  assert.equal(presences[0].stage, 'after');
  assert.deepEqual(presences[0].parts, ['h']);

  looks.length = 0;
  await v5Tools.call('apply_ops', {
    path: turn.target, note: 'Stage 2 of 2: tidy the list',
    ops: [{ type: 'setAttr', id: 'q', name: 'class', value: 'x' }],
  }, turn);
  const before2 = looks.find((l) => l.extra?.stage === 'before');
  assert.equal(before2.extra.count, 2, 'count accumulates distinct parts across batches of the turn');
  assert.equal(before2.extra.total, 2, 'total given once is repeated on later batches, even when this call omits it');
});

test('apply_ops reach drops ids that are not in the document', async () => {
  const looks = [];
  const v5Tools = createTools({
    store: drive.store,
    writeOps: drive.writeOps,
    createDocument: drive.createDocument,
    buildStarter: build,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
    examine: () => [],
    onLook: (docPath, ids, client, extra) => looks.push({ docPath, ids, client, extra }),
  });
  const turn = await freshTurn();
  await v5Tools.call('read_document', { path: turn.target }, turn);
  await v5Tools.call('apply_ops', {
    path: turn.target, note: 'x', reach: ['h', 'q1', 'nope-not-here'],
    ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  }, turn);
  const before = looks.find((l) => l.extra?.stage === 'before');
  assert.deepEqual(before.extra.reach, ['h', 'q1']);
});

test('a batch is read against one parse of the document, its reach included', async () => {
  const { watchParses } = await import('../server/agent/source.js');
  const lists = Array.from({ length: 5 }, (_, k) =>
    `<ul data-marble-id="u${k}">${[0, 1, 2].map((i) => `<li data-marble-id="u${k}i${i}">Item ${i}</li>`).join('')}</ul>`).join('\n');
  const looks = [];
  const v5Tools = createTools({
    store: drive.store,
    writeOps: drive.writeOps,
    createDocument: drive.createDocument,
    buildStarter: build,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
    examine: () => [],
    onLook: (docPath, ids, client, extra) => looks.push({ docPath, ids, client, extra }),
  });
  const turn = await freshTurn();
  await drive.writeOps(turn.target, [{ type: 'insert', parentId: 'b', beforeId: null, html: lists }], { client: 'tab' });
  await v5Tools.call('read_document', { path: turn.target }, turn);
  const source = await drive.store.read(turn.target);

  let parses = 0;
  watchParses((text) => {
    if (text === source) parses += 1;
  });
  let result;
  try {
    result = await v5Tools.call('apply_ops', {
      path: turn.target,
      note: 'Rewrite every list',
      reach: ['u0', 'u1', 'u2', 'u3', 'u4', 'nope'],
      ops: Array.from({ length: 5 }, (_, k) => ({
        type: 'setInner',
        id: `u${k}`,
        html: [0, 1].map((i) => `<li data-marble-id="u${k}n${i}">New ${i}</li>`).join(''),
      })),
    }, turn);
  } finally {
    watchParses(null);
  }
  assert.ok(result.applied > 0, JSON.stringify(result).slice(0, 400));
  const before = looks.find((l) => l.extra?.stage === 'before');
  assert.equal(before.extra.parts.length, 25, 'each list\'s three old rows and two new ones');
  assert.equal(before.extra.removes.length, 15);
  assert.deepEqual(before.extra.reach, ['u0', 'u1', 'u2', 'u3', 'u4']);
  assert.equal(parses, 1, 'one parse of the document for the whole batch');
});

test('a total that is not a whole number of parts, one or more, is not taken', async () => {
  const looks = [];
  const v5Tools = createTools({
    store: drive.store,
    writeOps: drive.writeOps,
    createDocument: drive.createDocument,
    buildStarter: build,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
    examine: () => [],
    onLook: (docPath, ids, client, extra) => looks.push({ docPath, ids, client, extra }),
  });
  const turn = await freshTurn();
  await v5Tools.call('read_document', { path: turn.target }, turn);
  const totals = [];
  for (const [k, total] of [0, -3, 2.5, '4', Number.NaN, 3, 7].entries()) {
    looks.length = 0;
    const result = await v5Tools.call('apply_ops', {
      path: turn.target, note: 'x', total,
      ops: [{ type: 'setText', id: 'h', text: `Title ${k}` }],
    }, turn);
    assert.equal(result.applied, 1);
    totals.push(looks.find((l) => l.extra?.stage === 'before').extra.total);
  }
  assert.deepEqual(totals, [null, null, null, null, null, 3, 3], 'none of the wrong ones is frozen, the first right one is');
});

test('apply_ops schema names reach and total', () => {
  const applyOps = TOOL_SCHEMAS.find((t) => t.name === 'apply_ops');
  assert.equal(applyOps.inputSchema.properties.reach.maxItems, 200);
  assert.equal(applyOps.inputSchema.properties.total.minimum, 1);
});

test('check_document is offered to agents', () => {
  const checking = createTools({
    store: {}, writeOps: async () => ({}), createDocument: async () => {},
    buildStarter: async () => '', guidePath: '/dev/null', examine: () => [],
  });
  assert.ok(checking.schemas.some((s) => s.name === 'check_document'));
});

test('affordance_script composes what the markers need, the way a starter does', async () => {
  const composing = createTools({
    store: {}, writeOps: async () => ({}), createDocument: async () => {},
    buildStarter: async () => '', composeAffordances: composeScript, guidePath: '/dev/null', examine: () => [],
  });
  const { script } = await composing.call('affordance_script', { affords: ['editable', 'toggle'] });
  // History always; the five small interactions are one part; each marker named in full.
  assert.match(script, /^\/\/ Affordances: history, editable, state /);
  for (const name of ['data-marble-editable', 'data-marble-toggle']) assert.ok(script.includes(name), name);
  assert.doesNotMatch(script, /data-marble-sortable/);
  // The doctor agrees that a document carrying it is wired.
  const doc = `<!doctype html><html data-marble="1"><body>
    <h1 data-marble-id="h" data-marble-editable>Title</h1>
    <button data-marble-id="b" data-marble-toggle="data-done:yes|no">Done</button>
    <script>${script}</script></body></html>`;
  assert.deepEqual(examine('x.mrbl', doc).filter((f) => /no script in this document reads/.test(f.message)), []);

  assert.match((await composing.call('affordance_script', { affords: ['wobble'] })).error, /no affordance "wobble"/);
});

test.after(() => drive.close());
