// The pure half of runtime/chat-visual.js: what the fence says, what the frame
// is handed, and what a frame is allowed to say back.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIMITS,
  declarations,
  isDark,
  maskStreamingVisuals,
  readVisualInfo,
  readVisualMessage,
  visualDocument,
} from '../runtime/chat-visual.js';

test('the info string names a visual and carries its caption', () => {
  assert.deepEqual(readVisualInfo('marble-visual'), { caption: '' });
  assert.deepEqual(readVisualInfo('  marble-visual  Three ways to lay out the card '), { caption: 'Three ways to lay out the card' });
  assert.deepEqual(readVisualInfo('MARBLE-VISUAL Loud'), { caption: 'Loud' });
  assert.equal(readVisualInfo('html'), null);
  assert.equal(readVisualInfo('marble-visuals'), null);
  assert.equal(readVisualInfo(''), null);
  assert.equal(readVisualInfo(undefined), null);
});

test('a half-written visual never reaches the log as markup', () => {
  const closed = maskStreamingVisuals('Two ways.\n\n```marble-visual Options\n<div onclick="x">a</div>\n```\n\nPick one.');
  assert.equal(closed.visuals, 1);
  assert.equal(closed.text, 'Two ways.\n\nPick one.');

  const open = maskStreamingVisuals('Two ways.\n\n```marble-visual Options\n<div onclick="x">half');
  assert.equal(open.visuals, 1);
  assert.equal(open.text, 'Two ways.');
  assert.equal(open.text.includes('<div'), false);

  const two = maskStreamingVisuals('a\n```marble-visual\n<b>\n```\nb\n```marble-visual\n<i>\n```\nc');
  assert.equal(two.visuals, 2);
  assert.equal(two.text, 'a\nb\nc');
});

test('an ordinary code block is left alone', () => {
  const masked = maskStreamingVisuals('Run it:\n\n```bash\nnpm test\n```\n\nThen look.');
  assert.equal(masked.visuals, 0);
  assert.match(masked.text, /npm test/);
});

test('only tokens that are tokens are written into the frame', () => {
  const css = declarations({
    ink: '#111111',
    accent: 'rgb(155, 182, 207)',
    'ui-font': '"Google Sans", Roboto, sans-serif',
    // A document declares these, so a document could close the rule.
    paper: '#fff; } body { display: none } :root {',
    card: '<script>',
    faint: '',
    nonsense: 'red',
  });
  assert.match(css, /--ink: #111111;/);
  assert.match(css, /--accent: rgb\(155, 182, 207\);/);
  assert.match(css, /--ui-font: "Google Sans", Roboto, sans-serif;/);
  assert.equal(css.includes('display: none'), false);
  assert.equal(css.includes('script'), false);
  assert.equal(css.includes('--faint'), false);
  assert.equal(css.includes('nonsense'), false);
});

test('the frame is a whole document: palette, base sheet, bridge, fragment', () => {
  const html = visualDocument({
    source: '<button data-answer="Side by side">Side by side</button>',
    tokens: { ink: '#e8e6e1', paper: '#16181a', accent: '#7fa8c9' },
    dark: true,
  });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /--ink: #e8e6e1;/);
  assert.match(html, /color-scheme: dark/);
  // The fragment goes in as written — the frame's parser is the only thing
  // that ever sees it.
  assert.match(html, /<button data-answer="Side by side">Side by side<\/button>/);
  assert.match(html, /class="marble-fit"/);
  assert.match(html, /window\.marble = \{/);
  assert.match(html, /ResizeObserver/);
  assert.match(html, /\.pick\[aria-pressed="true"\]/);
});

test('paper says which scheme the frame is in', () => {
  assert.equal(isDark('#16181a'), true);
  assert.equal(isDark('#fafaf7'), false);
  assert.equal(isDark('rgb(22, 24, 26)'), true);
  assert.equal(isDark('rgba(250, 250, 247, 0.9)'), false);
  assert.equal(isDark('#123'), true);
  assert.equal(isDark('oklch(.2 0 0)'), false);
  assert.equal(isDark(''), false);
  assert.equal(isDark(undefined), false);
});

test('a frame may say three things, and nothing else', () => {
  assert.deepEqual(readVisualMessage({ marbleVisual: true, what: 'size', height: 240.4 }), { what: 'size', height: 240 });
  assert.deepEqual(readVisualMessage({ marbleVisual: true, what: 'answer', text: ' Side by side ' }), { what: 'answer', text: 'Side by side' });
  assert.deepEqual(readVisualMessage({ marbleVisual: true, what: 'draft', text: 'Stacked' }), { what: 'draft', text: 'Stacked' });

  // Not ours, malformed, or empty.
  assert.equal(readVisualMessage({ what: 'answer', text: 'x' }), null);
  assert.equal(readVisualMessage({ marbleVisual: true, what: 'eval', text: 'x' }), null);
  assert.equal(readVisualMessage({ marbleVisual: true, what: 'answer', text: '   ' }), null);
  assert.equal(readVisualMessage({ marbleVisual: true, what: 'size', height: -4 }), null);
  assert.equal(readVisualMessage({ marbleVisual: true, what: 'size', height: 'tall' }), null);
  assert.equal(readVisualMessage(null), null);
  assert.equal(readVisualMessage('size'), null);
});

test('a frame cannot fill the composer with a novel, or the page with a mile', () => {
  const long = readVisualMessage({ marbleVisual: true, what: 'answer', text: 'x'.repeat(LIMITS.answer * 3) });
  assert.equal(long.text.length, LIMITS.answer);
  assert.equal(readVisualMessage({ marbleVisual: true, what: 'size', height: 1e9 }).height, 20_000);
});
