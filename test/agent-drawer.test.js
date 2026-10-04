import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { cleanDrawing, createDrawer, drawPrompt, readSkill, SKILL_PATH, stepLine } from '../server/agent/drawer.js';

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PACE = { firstMs: 10, gapMs: 60, momentMs: 20, concurrent: 2 };

test('the drawing skill is where the drawer reads it, and loses its front matter', async () => {
  assert.ok(fs.existsSync(SKILL_PATH));
  const body = await readSkill();
  assert.doesNotMatch(body, /^---/);
  assert.match(body, /Only now/);
});

test('a step is one line in the words a reader needs', () => {
  assert.equal(stepLine({ type: 'tool.call', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }), 'run: npm test (Run the tests)');
  assert.match(stepLine({ type: 'tool.call', name: 'apply_ops', input: { path: 'Notes/Plan', note: 'Stage 2 of 4: cards', ops: [{ op: 'insert', html: '<div>Free</div>' }] } }), /change page Notes\/Plan: 1 ops \(insert\) — Stage 2 of 4: cards \| <div>Free<\/div>/);
  assert.match(stepLine({ type: 'tool.result', ok: true, summary: 'start', tail: '# pass 1509\n# fail 0' }), /→ ok: start … # pass 1509 # fail 0/);
  assert.equal(stepLine({ type: 'turn.started' }), '');
});

test('an answer is cut to its markup', () => {
  assert.equal(cleanDrawing('Here it is:\n```html\n<div class="stack"><p>Hi</p></div>\n```\nDone.'), '<div class="stack"><p>Hi</p></div>');
  assert.equal(cleanDrawing('<html><body><div>x</div><script>d.append(1)</script></body></html> ok'), '<div>x</div><script>d.append(1)</script>');
  assert.equal(cleanDrawing('I cannot draw that.'), null);
  assert.equal(cleanDrawing(''), null);
});

test('the prompt carries the ask, the state, the steps and the last drawing', () => {
  const prompt = drawPrompt({ ask: 'Run the tests', state: 'working', ran: '12 s', lines: ['run: npm test'], skipped: 3, last: '<div>old</div>' });
  assert.match(prompt, /Run the tests/);
  assert.match(prompt, /State: working, 12 s/);
  assert.match(prompt, /the 3 before these are left out/);
  assert.match(prompt, /<div>old<\/div>/);
});

test('a turn is drawn once it does something, redrawn as it goes, and drawn again at the end', async () => {
  const drawn = [];
  const asked = [];
  let n = 0;
  const drawer = createDrawer({
    pace: PACE,
    skill: async () => 'SKILL',
    draw: async ({ system, prompt }) => { asked.push({ system, prompt }); n += 1; return `<div>${n}</div>`; },
    emit: async (turn, event) => { drawn.push({ turn: turn.id, ...event }); },
  });
  const turn = { id: 't1', prompt: 'Run the tests' };

  drawer.note(turn, { type: 'text', text: 'Looking.' });
  await tick(30);
  assert.equal(drawn.length, 0, 'words alone are not drawn');

  drawer.note(turn, { type: 'tool.call', name: 'Bash', input: { command: 'npm test' } });
  await tick(30);
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].type, 'progress.drawn');
  assert.equal(drawn[0].state, 'working');
  assert.equal(asked[0].system, 'SKILL');
  assert.match(asked[0].prompt, /run: npm test/);

  drawer.note(turn, { type: 'tool.result', ok: true, summary: '# pass 12' });
  await tick(50);
  assert.equal(drawn.length, 2, 'a test result is a moment');
  assert.match(asked[1].prompt, /<div>1<\/div>/, 'the last drawing is handed back');

  await drawer.end(turn, 'completed');
  assert.equal(drawn.length, 3);
  assert.equal(drawn[2].state, 'done');
  assert.equal(drawn[2].final, true);
  assert.equal(drawer.size, 0);
});

test('a turn that never called a tool is not drawn at its end either', async () => {
  const drawn = [];
  const drawer = createDrawer({ pace: PACE, skill: async () => '', draw: async () => '<div>x</div>', emit: async (t, e) => drawn.push(e) });
  drawer.note({ id: 't2', prompt: 'hi' }, { type: 'text', text: 'Hello.' });
  await drawer.end({ id: 't2' }, 'completed');
  assert.equal(drawn.length, 0);
});

test('a drawing that fails or repeats itself is not sent', async () => {
  const drawn = [];
  const answers = [null, '<div>a</div>', '<div>a</div>'];
  const drawer = createDrawer({ pace: PACE, skill: async () => '', draw: async () => answers.shift() ?? null, emit: async (t, e) => drawn.push(e) });
  const turn = { id: 't3', prompt: 'x' };
  drawer.note(turn, { type: 'tool.call', name: 'Read', input: { file_path: '/a/b' } });
  await tick(30);
  assert.equal(drawn.length, 0);
  drawer.note(turn, { type: 'ops.applied', count: 2, path: 'P' });
  await tick(90);
  assert.equal(drawn.length, 1);
  await drawer.end(turn, 'completed');
  assert.equal(drawn.length, 1, 'the same drawing twice is one');
});
