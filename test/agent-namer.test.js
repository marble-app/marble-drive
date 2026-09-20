import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanTitle, fallbackTitle, nameConversation, titlePrompt } from '../server/agent/namer.js';

test('the placeholder is the prompt, without the composer’s markup', () => {
  assert.equal(fallbackTitle('  Fix the focus   view  '), 'Fix the focus view');
  assert.equal(
    fallbackTitle('<pasted-image index="1" name="image.png" bytes="17150" path="/x" url="/y"></pasted-image>\n\nWhat is wrong here?'),
    'What is wrong here?',
  );
  assert.equal(
    fallbackTitle('<pasted-text index="1" lines="2" chars="9">\nsome code\n</pasted-text>'),
    'some code',
  );
  // An attachment and nothing else leaves no quotation at all.
  assert.equal(fallbackTitle('<pasted-image index="1" name="a.png" bytes="1" path="/x" url="/y"></pasted-image>'), '');
  assert.ok(fallbackTitle('x'.repeat(200)).length <= 60);
});

test('a title is taken from the last line, stripped and capped', () => {
  assert.equal(cleanTitle('Naming Chats With A Model'), 'Naming Chats With A Model');
  assert.equal(cleanTitle('"Focus View Panel Bug"'), 'Focus View Panel Bug');
  assert.equal(cleanTitle('Title: Dark Mode Palette.'), 'Dark Mode Palette');
  assert.equal(cleanTitle('Here is a good title:\n\nNFL Widget Crests'), 'NFL Widget Crests');
  const long = 'Naming Every Chat On The Board With A Small Model';
  assert.ok(long.length > 48);
  assert.ok(cleanTitle(long).length <= 48);
  // A cap never cuts a word in half.
  assert.ok(long.startsWith(cleanTitle(long)));
  assert.ok(!/\s$/.test(cleanTitle(long)));
});

test('an answer that is not a title is refused', () => {
  assert.equal(cleanTitle(''), null);
  assert.equal(cleanTitle('   \n  '), null);
  assert.equal(cleanTitle("I'm sorry, I can't help with that"), null);
  assert.equal(cleanTitle('Error: model overloaded'), null);
  assert.equal(cleanTitle('This chat is about a long and winding discussion of how the focus view should behave when a pane closes'), null);
});

test('the prompt carries the question and the answer, and never the markup', () => {
  const text = titlePrompt({
    prompt: '<pasted-image index="1" name="a.png" bytes="1" path="/x" url="/y"></pasted-image>\nWhy is the title wrong?',
    reply: 'Because the store slices the prompt.',
  });
  assert.ok(text.includes('Why is the title wrong?'));
  assert.ok(text.includes('Because the store slices the prompt.'));
  assert.ok(!text.includes('pasted-image'));
});

test('naming falls through to the next CLI when the first is not installed', async () => {
  const tried = [];
  const title = await nameConversation({
    prompt: 'make the board readable',
    reply: 'renamed every chat',
    exec: async (command) => {
      tried.push(command);
      if (command === 'claude') return { missing: true, code: null, stdout: '', stderr: '' };
      return { missing: false, code: 0, stdout: 'Readable Agent Board\n', stderr: '' };
    },
  });
  assert.deepEqual(tried, ['claude', 'cursor-agent']);
  assert.equal(title, 'Readable Agent Board');
});

test('naming gives up quietly rather than throwing', async () => {
  const title = await nameConversation({
    prompt: 'anything',
    exec: async () => ({ missing: true, code: null, stdout: '', stderr: '' }),
  });
  assert.equal(title, null);
});

test('a CLI that fails is logged, not thrown', async () => {
  const errors = [];
  const title = await nameConversation({
    prompt: 'anything',
    exec: async (command) => (command === 'claude'
      ? { missing: false, code: 1, stdout: '', stderr: 'usage limit reached' }
      : { missing: true, code: null, stdout: '', stderr: '' }),
    log: { error: (message) => errors.push(message) },
  });
  assert.equal(title, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /usage limit reached/);
});

test('naming runs on the login: no API key reaches the CLI', async () => {
  let seen = null;
  await nameConversation({
    prompt: 'anything',
    env: { PATH: '/usr/bin', HOME: '/home/x', ANTHROPIC_API_KEY: 'sk-secret' },
    exec: async (command, args, opts) => {
      if (command === 'claude') seen = opts.env;
      return { missing: true, code: null, stdout: '', stderr: '' };
    },
  });
  assert.equal(seen.ANTHROPIC_API_KEY, undefined);
  assert.equal(seen.PATH, '/usr/bin');
});

test('a prompt with nothing in it is not worth a model call', async () => {
  let called = false;
  const title = await nameConversation({ prompt: '   ', reply: '', exec: async () => { called = true; return {}; } });
  assert.equal(title, null);
  assert.equal(called, false);
});
