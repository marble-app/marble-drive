import assert from 'node:assert/strict';
import test from 'node:test';

import { offerPrompt, readOffer, writeOffer } from '../server/agent/offer.js';

test('the prompt carries the element as text, the title and the selected words', () => {
  const ask = offerPrompt({ title: 'Reading list', html: '<tr data-marble-id="r2"><td>Generative Agents</td><td>—</td></tr><script>x()</script>', words: 'Generative' });
  assert.match(ask, /Reading list/);
  assert.match(ask, /Generative Agents/);
  assert.doesNotMatch(ask, /x\(\)/, 'scripts are not content');
  assert.match(ask, /They selected these words in it:\n"""\nGenerative/);
});

test('an answer is read from the JSON in it, trimmed to three short suggestions', () => {
  const read = readOffer('Sure:\n{"suggestions": ["Fill in the authors", "Add the venue", "Link the PDF", "A fourth"], "automatic": "a Fill button", "interactive": "click to flip the status"}');
  assert.deepEqual(read, { suggestions: ['Fill in the authors', 'Add the venue', 'Link the PDF'], automatic: 'a Fill button', interactive: 'click to flip the status' });
});

test('an answer that is not the shape asked for is no answer', () => {
  assert.equal(readOffer('I cannot help with that.'), null);
  assert.equal(readOffer('{"suggestions": []}'), null);
  assert.equal(readOffer('{"suggestions": "one"'), null);
  const long = readOffer(`{"suggestions": ["${'x'.repeat(200)}", "Short one"]}`);
  assert.deepEqual(long.suggestions, ['Short one'], 'a suggestion too long to be a chip is dropped');
});

test('no CLI, a failure or a timeout leaves the card its defaults', async () => {
  const quiet = { error() {} };
  assert.equal(await writeOffer({ html: '<p>Hi</p>', exec: async () => ({ missing: true }), log: quiet }), null);
  assert.equal(await writeOffer({ html: '<p>Hi</p>', exec: async () => ({ code: 1, stderr: 'no' }), log: quiet }), null);
  assert.equal(await writeOffer({ html: '<p>Hi</p>', exec: async () => ({ timedOut: true }), log: quiet }), null);
  assert.equal(await writeOffer({ html: '', words: '' }), null, 'nothing to read, nothing asked');
});

test('the model is asked on the login, and its answer comes back read', async () => {
  let seen = null;
  const written = await writeOffer({
    html: '<h1>Reading list</h1>',
    env: { ANTHROPIC_API_KEY: 'sk-secret', PATH: '/bin' },
    exec: async (command, args, options) => {
      seen = { command, args, env: options.env };
      return { code: 0, stdout: '{"suggestions": ["A shorter title"], "automatic": null, "interactive": null}' };
    },
  });
  assert.equal(seen.command, 'claude');
  assert.ok(seen.args.includes('haiku'));
  assert.deepEqual(seen.args.slice(seen.args.indexOf('--tools'), seen.args.indexOf('--tools') + 2), ['--tools', ''], 'no tools');
  assert.ok(seen.args.includes('--strict-mcp-config'), 'and no MCP server of the login\'s either');
  assert.equal(seen.env.ANTHROPIC_API_KEY, undefined, 'never billed to a key');
  assert.deepEqual(written, { suggestions: ['A shorter title'], automatic: null, interactive: null });
});
