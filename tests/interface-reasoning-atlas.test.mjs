import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = new URL('../research/interface-reasoning-atlas.mrbl', import.meta.url);

test('the interface reasoning atlas is a self-contained interactive Marble document', async () => {
  const html = await readFile(report, 'utf8');
  assert.match(html, /<title>Interface Reasoning/);
  assert.match(html, /data-marble="1"/);
  assert.match(html, /data-view="model"/);
  assert.match(html, /data-view-target="human"/);
  assert.match(html, /artifact loop/i);
  assert.match(html, /Visual Sketchpad/);
  assert.match(html, /Whiteboard-of-Thought/);
  assert.match(html, /Sensecape/);
  assert.match(html, /Code World Models/);
  assert.ok((html.match(/https:\/\//g) ?? []).length >= 24, 'includes the supplied research links');
});
