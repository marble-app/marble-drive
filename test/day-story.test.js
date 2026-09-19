// The day, cut into story screens.
//
// The build decides the editorial half — what becomes a unit, what stands alone
// on a screen, what order the day reads in — and stamps it on the markup as
// `data-story*`. The page decides geometry, because only the page knows how tall
// a screen is. This file is about the first half.
//
// Every case builds a real issue through `assemble --out`, so it never touches
// `today.mrbl`, and pins the palette so a test run does not rotate Bryan's.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const BUILD = path.join(ROOT, '.claude/skills/my-day/lib/build.mjs');

const build = (payload) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-story-'));
  const pj = path.join(dir, 'p.json');
  const out = path.join(dir, 'issue.mrbl');
  fs.writeFileSync(pj, JSON.stringify(payload));
  const report = JSON.parse(
    execFileSync('node', [BUILD, 'assemble', '--payload', pj, '--out', out], { encoding: 'utf8' }),
  );
  return { html: fs.readFileSync(out, 'utf8'), report, out };
};

const readbackOf = (html) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-story-rb-'));
  const f = path.join(dir, 'prev.mrbl');
  fs.writeFileSync(f, html);
  return JSON.parse(execFileSync('node', [BUILD, 'readback', f], { encoding: 'utf8' }));
};

const sectionOf = (html, comp) =>
  (new RegExp(`<section class="[^"]*" data-comp="${comp}"[^>]*>`).exec(html) || [''])[0];
const rowOf = (html, key) =>
  (new RegExp(`<li class="row [^"]*"[^>]*data-key="${key}"[^>]*>`).exec(html) || [''])[0];
const cardOf = (html, key) =>
  (new RegExp(`<div class="pcard[^"]*"[^>]*data-key="${key}"[^>]*>`).exec(html) || [''])[0];
const seqOf = (html, comp) => Number(/data-story-seq="(\d+)"/.exec(sectionOf(html, comp))[1]);

// No `id` and no `pdfUrl` on a paper: the build screenshots the first PDF page
// through the network when it has one, and a test must not go out to arXiv.
const DAY = {
  date: '2026-09-19',
  title: 'Story fixture',
  palette: 'Sax Blue & Sulphur',
  greeting: 'Good morning, Bryan.',
  summary: 'A fixture day.',
  layout: {
    rail: [{ type: 'weather', treatment: 'card' }],
    stream: [
      { type: 'focus', treatment: 'bare' },
      { type: 'todos', treatment: 'bare' },
      { type: 'papers', treatment: 'bare' },
    ],
    tail: [{ type: 'calendar', treatment: 'card' }],
  },
  focus: [{ key: 'short-one', title: 'Send the email' }],
  todos: [
    { key: 'listy', title: 'Plan the course', note: 'one\ntwo\nthree' },
    { key: 'terse', title: 'Book the flight' },
  ],
  keyDates: [{ label: 'UIST', date: '2026-10-20' }],
  weather: { error: 'none today' },
  arxiv: {
    papers: [
      { key: 'core', title: 'A core paper', authors: ['A. One'], relevance: 3, absUrl: 'https://arxiv.org/abs/1' },
      { key: 'field', title: 'A field paper', authors: ['B. Two'], relevance: 0, absUrl: 'https://arxiv.org/abs/2' },
    ],
  },
};

test('every component declares how it becomes story units', () => {
  const { html } = build(DAY);
  assert.match(sectionOf(html, 'focus'), /data-story="items"/);
  assert.match(sectionOf(html, 'focus'), /data-story-pack="3"/);
  assert.match(sectionOf(html, 'todos'), /data-story-pack="5"/);
  assert.match(sectionOf(html, 'papers'), /data-story="items"/);
  assert.match(sectionOf(html, 'weather'), /data-story="unit"/);
  assert.match(sectionOf(html, 'calendar'), /data-story="unit"/);
  assert.match(sectionOf(html, 'calendar'), /data-story-view="l"/);
});

test('the story order is weather, the to-do components, the calendar, the rest', () => {
  const { html } = build(DAY);
  assert.deepEqual(
    ['weather', 'focus', 'todos', 'calendar', 'papers'].map((c) => seqOf(html, c)),
    [1, 2, 3, 4, 5],
  );
});

test('layout.story.order and .skip override the default order', () => {
  const { html } = build({
    ...DAY,
    layout: { ...DAY.layout, story: { order: ['papers', 'focus'], skip: ['weather'] } },
  });
  assert.match(sectionOf(html, 'weather'), /data-story="skip"/);
  assert.doesNotMatch(sectionOf(html, 'weather'), /data-story-seq/);
  assert.ok(seqOf(html, 'papers') < seqOf(html, 'focus'), 'papers leads');
  assert.ok(seqOf(html, 'focus') < seqOf(html, 'todos'), 'named types come before unnamed ones');
});

test('a row stands alone when its note is a list, and packs when it is short', () => {
  const { html } = build(DAY);
  assert.match(rowOf(html, 'listy'), /data-story-own/);
  assert.doesNotMatch(rowOf(html, 'terse'), /data-story-own/);
  assert.doesNotMatch(rowOf(html, 'short-one'), /data-story-own/);
});

test('a long note stands alone even on one line', () => {
  const { html } = build({ ...DAY, todos: [{ key: 'longy', title: 'Write it', note: 'x'.repeat(170) }] });
  assert.match(rowOf(html, 'longy'), /data-story-own/);
});

test('papers stand alone at Adjacent and above', () => {
  const { html } = build(DAY);
  assert.match(cardOf(html, 'core'), /data-story-own/);
  assert.doesNotMatch(cardOf(html, 'field'), /data-story-own/);
});

test('storyOwn on an item promotes it', () => {
  const { html } = build({ ...DAY, todos: [{ key: 'promoted', title: 'Tiny', storyOwn: true }] });
  assert.match(rowOf(html, 'promoted'), /data-story-own/);
});

test('the report estimates units and screens', () => {
  const { report } = build(DAY);
  assert.equal(typeof report.story.units, 'number');
  assert.ok(report.story.units >= 7, `units counted every row, paper and widget, got ${report.story.units}`);
  assert.ok(report.story.screens >= 6, `cover, the widgets, the reading, end — got ${report.story.screens}`);
});

test('an empty push is skipped rather than given a screen of nothing', () => {
  const { html } = build({
    ...DAY,
    layout: { ...DAY.layout, stream: [...DAY.layout.stream, { type: 'push', treatment: 'tint' }] },
  });
  assert.match(sectionOf(html, 'push'), /data-story="skip"/);
});

test('the reading mode is carried forward and read back', () => {
  const { html } = build(DAY);
  assert.equal(readbackOf(html).read, null, 'a day nobody has chosen a mode on says nothing');
  const chosen = html.replace(
    '<main class="page" data-marble-id="nl-root">',
    '<main class="page" data-marble-id="nl-root" data-read="story">',
  );
  assert.notEqual(chosen, html, 'the main tag is where the mode is filed');
  assert.equal(readbackOf(chosen).read, 'story');
});

test('data-story attributes do not disturb readback of rows', () => {
  const { html } = build(DAY);
  const rb = readbackOf(html);
  assert.equal(rb.rows.listy.note, 'one\ntwo\nthree');
  assert.equal(rb.rows.terse.title, 'Book the flight');
  assert.equal(rb.rows.core.kind, 'arxiv');
});
