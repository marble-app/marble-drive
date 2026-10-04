// A few words about the look of a page, turned into one rule by a small model
// (v5, Notes and Sketches/Ask at Anything, "How a change runs": Intent). The
// reply is untrusted: anything that is not one selector and a few allowed
// declarations is no rule, and the words go to the agent as they were.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createHub } from '../server/agent/hub.js';
import { createAgentRoutes } from '../server/agent/routes.js';
import { intentPrompt, parseIntent, readIntent } from '../server/change/intent.js';

const OUTLINE = [
  { selector: 'div.card', count: 4, radius: '12px', padding: '14px', fontSize: '15px', color: 'rgb(29, 29, 31)', background: 'rgb(255, 255, 255)' },
  { selector: 'div.panel', count: 1, radius: '12px', padding: '14px', fontSize: '15px', color: 'rgb(29, 29, 31)', background: 'rgb(250, 250, 250)' },
];
const quiet = { error() {} };
const answer = (stdout) => async () => ({ code: 0, stdout });

test('the prompt carries the words, the page\'s parts as selectors with their look, and the scope', () => {
  const ask = intentPrompt({ words: 'round the corners', outline: OUTLINE, ids: ['cards'] });
  assert.match(ask, /round the corners/);
  assert.match(ask, /div\.card ×4/);
  assert.match(ask, /radius 12px/);
  assert.match(ask, /\[data-marble-id="cards"\]/, 'the scope is named so the selector stays inside it');
  assert.match(ask, /border-radius/, 'the allowed properties are listed');
  assert.doesNotMatch(intentPrompt({ words: 'x', outline: [] }), /data-marble-id/, 'no scope, the whole page');
});

test('a good reply is read: one selector, the declarations, the unit and the verb', async () => {
  const rule = await readIntent({
    words: 'round the corners',
    outline: OUTLINE,
    exec: answer('Here it is:\n{"selector": "div.card", "declarations": {"border-radius": "20px"}, "unit": "cards", "verb": "Rounding"}'),
    log: quiet,
  });
  assert.deepEqual(rule, { selector: 'div.card', declarations: { 'border-radius': '20px' }, unit: 'cards', verb: 'Rounding' });
});

test('a reply with a property outside the few a rule may set is no rule', async () => {
  const rule = await readIntent({
    words: 'round the corners',
    outline: OUTLINE,
    exec: answer('{"selector": "div.card", "declarations": {"border-radius": "20px", "box-shadow": "0 0 4px red"}, "unit": "cards", "verb": "Rounding"}'),
    log: quiet,
  });
  assert.equal(rule, null);
  assert.equal(parseIntent('{"selector": ".card", "declarations": {"background-image": "url(x.png)"}}'), null);
});

test('a reply without a selector, or saying there is none, is no rule', async () => {
  assert.equal(await readIntent({ words: 'make it calmer', outline: OUTLINE, exec: answer('{"declarations": {"opacity": "0.8"}}'), log: quiet }), null);
  assert.equal(await readIntent({ words: 'add a chart', outline: OUTLINE, exec: answer('{"selector": null}'), log: quiet }), null);
  assert.equal(await readIntent({ words: 'round them', outline: OUTLINE, exec: answer('I would round the cards.'), log: quiet }), null);
});

test('values that could run or load something, or break out of the rule, are no rule', () => {
  for (const value of ['url(https://x/y.png)', 'expression(alert(1))', 'red; color: blue', 'red }', 'javascript:alert(1)', '12px !important', '</style><script>']) {
    assert.equal(parseIntent(JSON.stringify({ selector: '.card', declarations: { color: value } })), null, value);
  }
  for (const selector of ['.card { color: red } .x', '</style>', '@media print', '.a /* x */']) {
    assert.equal(parseIntent(JSON.stringify({ selector, declarations: { color: 'red' } })), null, selector);
  }
});

test('padding and margin sides, gaps and type are allowed; a number for opacity or weight is read as one', () => {
  const rule = parseIntent(JSON.stringify({
    selector: 'li',
    declarations: { 'padding-top': '4px', 'margin-inline': '0', gap: '8px', 'font-weight': 600, opacity: 0.9, 'line-height': '1.4' },
    unit: 'rows',
    verb: 'tightening',
  }));
  assert.deepEqual(rule.declarations, { 'padding-top': '4px', 'margin-inline': '0', gap: '8px', 'font-weight': '600', opacity: '0.9', 'line-height': '1.4' });
  assert.equal(rule.verb, 'Tightening');
  assert.equal(parseIntent(JSON.stringify({ selector: 'li', declarations: {} })), null, 'nothing to set is no rule');
});

test('no CLI, a failure, an abort or a timeout is no rule, and the model is asked within 8 seconds on the login', async () => {
  assert.equal(await readIntent({ words: 'round', outline: OUTLINE, exec: async () => ({ missing: true }), log: quiet }), null);
  assert.equal(await readIntent({ words: 'round', outline: OUTLINE, exec: async () => ({ code: 1, stderr: 'no' }), log: quiet }), null);
  assert.equal(await readIntent({ words: 'round', outline: OUTLINE, exec: async () => ({ timedOut: true }), log: quiet }), null);
  assert.equal(await readIntent({ words: 'round', outline: OUTLINE, exec: async () => ({ aborted: true }), log: quiet }), null);
  assert.equal(await readIntent({ words: '', outline: OUTLINE, exec: async () => { throw new Error('asked'); } }), null, 'no words, nothing asked');
  let seen = null;
  await readIntent({
    words: 'round the corners',
    outline: OUTLINE,
    env: { ANTHROPIC_API_KEY: 'sk-secret', PATH: '/bin' },
    exec: async (command, args, options) => { seen = { command, args, options }; return { code: 0, stdout: '{"selector": null}' }; },
  });
  assert.equal(seen.command, 'claude');
  assert.ok(seen.args.includes('haiku'));
  assert.deepEqual(seen.args.slice(seen.args.indexOf('--tools'), seen.args.indexOf('--tools') + 2), ['--tools', '']);
  assert.equal(seen.options.timeout, 8000);
  assert.equal(seen.options.env.ANTHROPIC_API_KEY, undefined, 'never billed to a key');
});

// The route the line asks: POST /agent/change-intent.
async function post(intent, body) {
  const hub = createHub();
  const routes = createAgentRoutes({ store: {}, runner: {}, tools: {}, hub, providers: new Map(), writeOps: null, maxBody: 64 * 1024, intent });
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: { host: 'localhost' } });
  const out = { status: 0, body: '' };
  const res = { writeHead(status) { out.status = status; return res; }, end(chunk) { out.body = String(chunk ?? ''); } };
  await routes.handle(req, res, new URL('http://localhost/agent/change-intent'));
  hub.close();
  return { status: out.status, body: out.body ? JSON.parse(out.body) : null };
}

test('the route hands the words, the scope and the outline to the model and answers with its rule', async () => {
  let asked = null;
  const rule = { selector: 'div.card', declarations: { 'border-radius': '20px' }, unit: 'cards', verb: 'Rounding' };
  const answered = await post(async (input) => { asked = input; return rule; }, { path: 'board', words: 'round the corners', ids: ['cards', 7, ''], outline: OUTLINE });
  assert.equal(answered.status, 200);
  assert.deepEqual(answered.body, { rule });
  assert.equal(asked.words, 'round the corners');
  assert.deepEqual(asked.ids, ['cards'], 'only ids that are ids');
  assert.equal(asked.outline.length, 2);
});

test('the route answers no rule without a model, without words, or when the model fails', async () => {
  assert.deepEqual((await post(null, { words: 'round the corners', outline: OUTLINE })).body, { rule: null });
  let asked = false;
  assert.deepEqual((await post(async () => { asked = true; return null; }, { words: '   ', outline: OUTLINE })).body, { rule: null });
  assert.equal(asked, false, 'no words, nothing asked');
  assert.deepEqual((await post(async () => { throw new Error('boom'); }, { words: 'round', outline: OUTLINE })).body, { rule: null });
});
