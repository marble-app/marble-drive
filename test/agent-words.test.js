import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-words.js';

const W = globalThis.marbleAgentWords;

const run = (events) => {
  const line = W.createLine();
  let said = '';
  for (const event of events) said = W.noteLine(line, event);
  return { line, said };
};

test('while it runs, the line is the card’s sentence for the latest step', () => {
  const { said } = run([
    { type: 'tool.call', name: 'read_document', input: { path: 'Agents.mrbl' } },
    { type: 'tool.call', name: 'Edit', input: { file_path: 'runtime/x.js' } },
    { type: 'tool.call', name: 'Bash', input: { command: 'npm test', description: 'Run the unit tests' } },
  ]);
  assert.equal(said, 'Testing that it works');
});

test('a browser call after something was built reads as checking', () => {
  assert.equal(run([{ type: 'tool.call', name: 'browser_snapshot', input: {} }]).said, 'Looking at the page');
  assert.equal(run([
    { type: 'tool.call', name: 'apply_ops', input: { path: 'Notes/Garden.mrbl', ops: [] } },
    { type: 'tool.call', name: 'browser_snapshot', input: {} },
  ]).said, 'Looking at how it turned out');
});

test('while it waits on you, the line is the question, or that it needs your OK', () => {
  const question = {
    type: 'ask', requestId: 'q1', kind: 'question', tool: 'AskUserQuestion',
    input: { questions: [{ question: 'Ship it to admin-p2 or admin-p1?', options: [] }] },
  };
  const asked = run([{ type: 'tool.call', name: 'Read', input: {} }, question]);
  assert.equal(asked.said, 'Ship it to admin-p2 or admin-p1?');
  // Answered, the line goes back to the work.
  assert.equal(W.noteLine(asked.line, { type: 'ask.answered', requestId: 'q1', response: { behavior: 'allow' } }), 'Reading through the files');

  const permission = { type: 'ask', requestId: 'p1', kind: 'permission', tool: 'Bash', input: { command: 'rm -rf build' } };
  const held = run([permission]);
  assert.equal(held.said, 'Needs your OK');
  assert.equal(W.noteLine(held.line, { type: 'ask.answered', requestId: 'p1', response: { behavior: 'allow' } }), 'Going ahead');
  const refused = run([permission, { type: 'ask.answered', requestId: 'p1', response: { behavior: 'deny' } }]);
  assert.equal(refused.said, 'Stopping there');
});

test('when it ends, the line is the card’s end line', () => {
  const changed = run([
    { type: 'tool.call', name: 'apply_ops', input: { path: 'Agents.mrbl', ops: [] } },
    { type: 'ops.applied', path: 'Agents.mrbl', count: 14 },
  ]);
  assert.equal(W.endLine(changed.line, 'completed'), 'Updated Agents');

  const three = run([
    { type: 'ops.applied', path: 'a/One.mrbl', count: 1 },
    { type: 'document.changed', path: 'b/Two.mrbl' },
    { type: 'tool.call', name: 'create_document', input: { path: 'c/Three.mrbl' } },
  ]);
  assert.equal(W.endLine(three.line, 'completed'), 'Updated One, Two and 1 more');

  const code = run([{ type: 'tool.call', name: 'Edit', input: { file_path: 'server/x.js' } }]);
  assert.equal(W.endLine(code.line, 'completed'), 'Made the changes');

  const looked = run([{ type: 'tool.call', name: 'Grep', input: {} }]);
  assert.equal(W.endLine(looked.line, 'completed'), 'All done');
  assert.equal(W.endLine(looked.line, 'cancelled'), 'Stopped');
  assert.equal(W.endLine(looked.line, 'interrupted'), 'Interrupted');
});

test('a failed turn ends on where it got stuck, or the error’s first sentence', () => {
  const stuck = run([
    { type: 'tool.call', name: 'WebFetch', input: { url: 'https://docs.google.com/x' }, callId: 'c1' },
    { type: 'tool.result', callId: 'c1', ok: false, summary: 'The sheet is private. Sign in to see it.' },
  ]);
  assert.equal(W.endLine(stuck.line, 'failed', { error: 'exit 1' }), 'The sheet is private.');

  const plain = run([{ type: 'tool.call', name: 'Read', input: {} }]);
  assert.equal(W.endLine(plain.line, 'failed', { error: 'You have hit your usage limit. Try again at 3pm.' }), 'You have hit your usage limit.');

  const declined = run([
    { type: 'tool.call', name: 'Bash', input: { command: 'git push' }, callId: 'c1' },
    { type: 'tool.result', callId: 'c1', ok: false, denied: true, summary: '' },
  ]);
  assert.equal(W.endLine(declined.line, 'failed'), 'Stopped at your call');
});

test('a turn that showed nothing a card would has no line, so the caller keeps its own', () => {
  const { line, said } = run([{ type: 'text', text: 'Hello' }]);
  assert.equal(said, '');
  assert.equal(W.endLine(line, 'completed'), '');
});
