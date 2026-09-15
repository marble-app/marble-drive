import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = new URL('../drive/Research/interface-reasoning-atlas.mrbl', import.meta.url);
const read = () => readFile(report, 'utf8');

test('the research note is a self-contained Marble document', async () => {
  const html = await read();
  assert.match(html, /<title>Interface Reasoning/);
  assert.match(html, /data-marble="1"/);
  assert.match(html, /marble:capabilities/);
  // Nothing in the file may name a host, a route, or a server.
  assert.doesNotMatch(html, /\/intent\b|localhost|127\.0\.0\.1/);
});

test('every addressed element carries its own id, and no id appears twice', async () => {
  const html = await read();
  const ids = [...html.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 400, `expected a fully addressed document, got ${ids.length} ids`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate data-marble-id');
});

test('it reads as a report rather than a landing page', async () => {
  const html = await read();
  for (const section of ['s-loop', 's-coverage', 's-fields', 's-harness', 's-gap', 's-refs', 's-questions']) {
    assert.match(html, new RegExp(`id="${section}"`), `missing section ${section}`);
  }
  assert.match(html, /Short answer\./);
  assert.match(html, /<b>Figure 1\.<\/b>/);
  assert.match(html, /<b>Figure 2\.<\/b>/);
  assert.match(html, /class="rail"/, 'has a contents rail');
});

test('the interactions are Marble affordances, filed against one attribute each', async () => {
  const html = await read();
  // Figure 1: the loop is stepped and jumped to, both writing data-step.
  assert.match(html, /data-marble-choose="data-step" data-marble-of="body"/);
  assert.match(html, /data-marble-step="data-step:1:4" data-marble-by="-1"/);
  assert.match(html, /data-marble-step="data-step:1:4" data-marble-by="1"/);
  // Figure 2: one cell is current, held on the body.
  assert.match(html, /data-marble-choose="data-cell" data-marble-of="body"/);
  assert.match(html, /data-step="\d"[^>]*data-cell="[a-z-]+"|data-cell="[a-z-]+"/);
  // The bibliography: reorder, remove, and a per-entry reading status.
  assert.match(html, /data-marble-sortable="refs"/);
  assert.match(html, /data-marble-choose="data-status" data-marble-of="\.entry"/);
  // Open questions: added from a template in the file.
  assert.match(html, /data-marble-add="#tpl-q" data-marble-into="#qs-list"/);
  assert.match(html, /<template id="tpl-q">/);
});

test('every source has a summary, a relevance note, and a notes field', async () => {
  const html = await read();
  const entries = [...html.matchAll(/<li class="entry" id="r-([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(entries.length, 26, 'expected all 26 sources');

  for (const slug of entries) {
    const block = html.slice(html.indexOf(`id="r-${slug}"`), html.indexOf(`</li>`, html.indexOf(`id="r-${slug}"`)));
    assert.match(block, /class="summary"[^>]*data-marble-editable>\S/, `${slug} has no summary`);
    assert.match(block, /class="rel"[^>]*data-marble-editable>\S/, `${slug} has no relevance note`);
    assert.match(block, /class="notes"[^>]*data-marble-editable data-ph=/, `${slug} has no notes field`);
    assert.match(block, /class="thumb"/, `${slug} has no cover`);
    assert.match(block, /href="https?:\/\//, `${slug} has no source link`);
  }
});

test('a summary written from the title alone says so', async () => {
  const html = await read();
  assert.match(html, /from title \u2014 verify/, 'unverified summaries must be flagged');
  assert.match(html, /class="conf ok"/, 'checked summaries must be marked');
});

test('prose with inline markup is edited with setInner, not setText', async () => {
  const html = await read();
  // A setText target may not hold an addressed element, and may not hold markup
  // it would destroy on the first keystroke.
  for (const match of html.matchAll(/<(p|h1|h4|span)\b[^>]*data-marble-editable[^>]*>([\s\S]*?)<\/\1>/g)) {
    assert.doesNotMatch(match[2], /<(b|i|em|strong|span|a)\b/, `editable holds inline markup: ${match[0].slice(0, 70)}`);
    assert.doesNotMatch(match[2], /data-marble-id/, `editable holds an addressed element: ${match[0].slice(0, 70)}`);
  }
  assert.match(html, /data-marble-rich/, 'prose paragraphs use the rich affordance');
});

test('it still carries the sources it was built from', async () => {
  const html = await read();
  for (const title of ['Visual Sketchpad', 'Whiteboard-of-Thought', 'Sensecape', 'Code World Models']) {
    assert.match(html, new RegExp(title));
  }
  assert.ok((html.match(/https:\/\//g) ?? []).length >= 24, 'includes the supplied research links');
});
