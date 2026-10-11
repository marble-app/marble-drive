import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChoiceQuestion, toolShortName } from '../runtime/choice-question.js';

test('parseChoiceQuestion: lettered list with ?', () => {
  const text = `Which approach should we take?

A) First option
B) Second option`;
  const result = parseChoiceQuestion(text);
  assert.deepEqual(result, {
    question: 'Which approach should we take?',
    options: [
      { key: 'A', label: 'First option' },
      { key: 'B', label: 'Second option' },
    ],
    multiHint: false,
  });
});

test('parseChoiceQuestion: numbered list', () => {
  const text = `What do you prefer?

1. Option one
2. Option two`;
  const result = parseChoiceQuestion(text);
  assert.deepEqual(result, {
    question: 'What do you prefer?',
    options: [
      { key: '1', label: 'Option one' },
      { key: '2', label: 'Option two' },
    ],
    multiHint: false,
  });
});

test('parseChoiceQuestion: checkboxes', () => {
  const text = `Which items apply?

- [ ] Item one
- [x] Item two`;
  const result = parseChoiceQuestion(text);
  assert.deepEqual(result, {
    question: 'Which items apply?',
    options: [
      { key: '1', label: 'Item one' },
      { key: '2', label: 'Item two' },
    ],
    multiHint: true,
  });
});

test('parseChoiceQuestion: recap without ? returns null', () => {
  const text = `Next steps:
1. foo
2. bar`;
  assert.equal(parseChoiceQuestion(text), null);
});

test('parseChoiceQuestion: list not at end returns null', () => {
  const text = `Which one?

A) First
B) Second

Thanks!`;
  assert.equal(parseChoiceQuestion(text), null);
});

test('parseChoiceQuestion: fenced numbered list returns null', () => {
  const text = `Which one?

\`\`\`
1. foo
2. bar
\`\`\``;
  assert.equal(parseChoiceQuestion(text), null);
});

test('toolShortName maps shell to Shell', () => {
  assert.equal(toolShortName('shell'), 'Shell');
});
