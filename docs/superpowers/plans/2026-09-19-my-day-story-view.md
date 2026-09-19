# Bryan's Days story view — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a day document a second reading mode on the phone — a tap-through story of adaptively packed screens, with swipe-up into the live component — toggled against the scrolling page it already has.

**Architecture:** `build.mjs` decides everything editorial at generation time and emits it as `data-story*` attributes on elements that already exist; the runtime in `shell.mrbl` measures real clones against the real viewport, packs them into screens, and drives the overlay. Glance screens are sanitised clones inside one `data-marble-transient` subtree, so the story can file nothing; hold is the real document scrolled to the component, so there is exactly one set of live controls.

**Tech Stack:** Node ESM (`build.mjs`), vanilla DOM + Pointer Events + `requestAnimationFrame` springs (`shell.mrbl`), `node --test`, Playwright via `test-browser/harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-19-my-day-story-view-design.md`

## Global Constraints

- **All story CSS lives in a runtime-injected `<style data-marble-transient>`, not in `design.css`.** `lib/layoutcheck.mjs:66` fails the build on `position: absolute|fixed` for any selector not matching its `SAFE_ABSOLUTE` regex, and skips `<style>` blocks carrying `data-marble-transient` (`lib/layoutcheck.mjs:32`). The overlay is chrome the page invents, never document content, so this is also where it belongs. *(This is a deviation from spec §5, which said design.css; recorded here, and the spec is amended.)*
- **The JS string must never contain the literal text `<script`, `</script`, `<style`, `</style`, `<section`, `</section`, `<template` or `</template`.** `selfCheck` (`lib/build.mjs:1476`) counts those substrings across the whole file and fails on an imbalance. Build elements with `document.createElement`.
- **Never write `overflow-y: auto` or `overflow-y: scroll`, and never a bare `class="scroll"`.** `selfCheck` rejects both anywhere in the file, including inside a script string. Glance never scrolls.
- **Never write the literal `data-setview="` in the story code.** `selfCheck` treats every occurrence as a view that must have matching `design.css` rules. The read toggle uses `data-setread`.
- **Every `data-story*` attribute is ignored by `readback`, `carry`, `harvest` and `sweepFeedback`.** Only `data-read` on `main.page` is read back.
- **Motion values are the apple-design skill's:** placement spring `damping 1.0 / response 0.35`; flick spring `damping 0.8 / response 0.35`; hold `damping 0.8 / response 0.3`; projection `(v/1000)·0.998/(1−0.998)`; rubber band `(over·dim·0.55)/(dim + 0.55·|over|)`; hysteresis 10 px; press feedback on `pointerdown`.
- **Pack ceilings:** focus 3, todos 5, news 3, papers 3.
- **Own-screen thresholds:** note contains `\n`, or note ≥ 160 chars, or title+why+note ≥ 320 chars, or `storyOwn: true`; papers relevance ≥ 2; news relevance = 3.
- **Estimate model:** unit share = `<80 chars → 1/5`, `<200 → 1/4`, `<450 → 1/2`, else `1`; a screen holds shares summing to ≤ 1, capped by the ceiling.
- Repo root is `/Users/bryanmin/Development/3rd-year-projects/marble-drive`. Two peer sessions are live: touch only the files named below, never `server/app.js` or `../marble`.

---

### Task 1: The build emits the story's editorial decisions

**Files:**
- Modify: `.claude/skills/my-day/lib/build.mjs`
- Modify: `.claude/skills/my-day/shell.mrbl` (one placeholder on the `<main>` tag)
- Test: `test/day-story.test.js` (create)

**Interfaces:**
- Produces, for Task 2 to read from the DOM:
  - `section.comp[data-story="items"|"unit"]`, `[data-story-seq="<1-based int>"]`,
    `[data-story-pack="<int>"]`, optional `[data-story-view="<view name>"]`,
    optional `[data-story-label="<text>"]`
  - `li.row[data-story-own]`, `.pcard[data-story-own]`, `.ncard[data-story-own]`
  - `main.page[data-read="page"|"story"]` (absent when never chosen)
- Produces, for Task 5: `assemble`'s JSON report gains `story: { units, screens }`.
- Produces, for Task 6: payload keys `layout.story.order`, `layout.story.skip`, item key `storyOwn`.

- [ ] **Step 1: Write the failing test**

Create `test/day-story.test.js`. It builds two fixture days through the real
`assemble` and asserts on the emitted attributes. `--out` keeps it away from
`today.mrbl`.

```js
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
  const report = JSON.parse(execFileSync('node', [BUILD, 'assemble', '--payload', pj, '--out', out], { encoding: 'utf8' }));
  return { html: fs.readFileSync(out, 'utf8'), report };
};

const sectionOf = (html, comp) =>
  (new RegExp(`<section class="[^"]*" data-comp="${comp}"[^>]*>`).exec(html) || [''])[0];

const DAY = {
  date: '2026-09-19',
  title: 'Story fixture',
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
      { id: '2609.1', title: 'A core paper', authors: ['A. One'], relevance: 3, absUrl: 'https://arxiv.org/abs/2609.1' },
      { id: '2609.2', title: 'A field paper', authors: ['B. Two'], relevance: 0, absUrl: 'https://arxiv.org/abs/2609.2' },
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
  const seq = (c) => Number(/data-story-seq="(\d+)"/.exec(sectionOf(html, c))[1]);
  assert.deepEqual(
    ['weather', 'focus', 'todos', 'calendar', 'papers'].map(seq),
    [1, 2, 3, 4, 5],
  );
});

test('layout.story.order and .skip override the default order', () => {
  const { html } = build({
    ...DAY,
    layout: { ...DAY.layout, story: { order: ['papers', 'focus'], skip: ['weather'] } },
  });
  assert.match(sectionOf(html, 'weather'), /data-story="skip"/);
  const seq = (c) => Number(/data-story-seq="(\d+)"/.exec(sectionOf(html, c))[1]);
  assert.ok(seq('papers') < seq('focus'), 'papers leads');
  assert.ok(seq('focus') < seq('todos'), 'named types come before unnamed ones');
});

test('a row stands alone when its note is a list, and packs when it is short', () => {
  const { html } = build(DAY);
  const row = (key) => (new RegExp(`<li class="row [^"]*"[^>]*data-key="${key}"[^>]*>`).exec(html) || [''])[0];
  assert.match(row('listy'), /data-story-own/);
  assert.doesNotMatch(row('terse'), /data-story-own/);
  assert.doesNotMatch(row('short-one'), /data-story-own/);
});

test('a long note stands alone even on one line', () => {
  const { html } = build({
    ...DAY,
    todos: [{ key: 'longy', title: 'Write it', note: 'x'.repeat(170) }],
  });
  assert.match(/<li class="row [^"]*"[^>]*data-key="longy"[^>]*>/.exec(html)[0], /data-story-own/);
});

test('papers stand alone at Adjacent and above', () => {
  const { html } = build(DAY);
  const card = (key) => (new RegExp(`<div class="pcard[^"]*"[^>]*data-key="${key}"[^>]*>`).exec(html) || [''])[0];
  assert.match(card('2609-1'), /data-story-own/);
  assert.doesNotMatch(card('2609-2'), /data-story-own/);
});

test('storyOwn on an item promotes it', () => {
  const { html } = build({ ...DAY, todos: [{ key: 'promoted', title: 'Tiny', storyOwn: true }] });
  assert.match(/<li class="row [^"]*"[^>]*data-key="promoted"[^>]*>/.exec(html)[0], /data-story-own/);
});

test('the report estimates units and screens', () => {
  const { report } = build(DAY);
  assert.equal(typeof report.story.units, 'number');
  assert.ok(report.story.screens >= 5, 'cover, four components, end');
});

test('an empty push is skipped rather than given a screen', () => {
  const { html } = build({
    ...DAY,
    layout: { ...DAY.layout, stream: [...DAY.layout.stream, { type: 'push', treatment: 'tint' }] },
  });
  assert.match(sectionOf(html, 'push'), /data-story="skip"/);
});

test('the reading mode is carried forward and read back', () => {
  const { html } = build(DAY);
  assert.match(html, /<main class="page" data-marble-id="nl-root">/);
  const withRead = html.replace('<main class="page" data-marble-id="nl-root">',
    '<main class="page" data-marble-id="nl-root" data-read="story">');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-story-rb-'));
  const f = path.join(dir, 'prev.mrbl');
  fs.writeFileSync(f, withRead);
  const rb = JSON.parse(execFileSync('node', [BUILD, 'readback', f], { encoding: 'utf8' }));
  assert.equal(rb.read, 'story');
});

test('data-story attributes do not disturb readback of rows', () => {
  const { html } = build(DAY);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-story-rows-'));
  const f = path.join(dir, 'prev.mrbl');
  fs.writeFileSync(f, html);
  const rb = JSON.parse(execFileSync('node', [BUILD, 'readback', f], { encoding: 'utf8' }));
  assert.equal(rb.rows.listy.note, 'one\ntwo\nthree');
  assert.equal(rb.rows.terse.title, 'Book the flight');
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd /Users/bryanmin/Development/3rd-year-projects/marble-drive
node --test test/day-story.test.js
```

Expected: every case fails — no `data-story` attribute is emitted yet, and
`readback` has no `read` key.

- [ ] **Step 3: Add the story vocabulary and the order planner to `build.mjs`**

Insert immediately above `function componentBody` (around `lib/build.mjs:1143`):

```js
// ------------------------------------------------------------------ story ---
// How a component becomes screens when the day is read as a story. `items`
// means its rows or cards are the units; `unit` means the whole component is
// one screen; `view` names the one reading that travels (a phone reads the
// news as Reading and the dates as a List). The build decides the editorial
// half — what splits, what stands alone, what order — and the page decides
// geometry, because only the page knows how tall a screen is.
const STORY = {
  focus:     { mode: 'items', pack: 3 },
  todos:     { mode: 'items', pack: 5 },
  news:      { mode: 'items', pack: 3, view: 'list' },
  papers:    { mode: 'items', pack: 3 },
  push:      { mode: 'unit' },
  weather:   { mode: 'unit' },
  calendar:  { mode: 'unit', view: 'l' },
  usopen:    { mode: 'unit', view: 'top' },
  nfl:       { mode: 'unit', view: 'week' },
  nflseason: { mode: 'unit', view: 'arc' },
  art:       { mode: 'unit' },
  roadahead: { mode: 'unit' },
  custom:    { mode: 'unit' },
};
// Cover, then the window; then what has to happen and the dates behind it;
// then the reading; the painting last, full screen, before the end card.
const STORY_RANK = { weather: 10, focus: 20, push: 20, todos: 20, calendar: 30, art: 50 };

// A row Bryan can take in at a glance shares a screen. One he has to read —
// a note he typed as a list, or a paragraph — gets the screen to itself.
function storyOwnRow(t, note) {
  if (t.storyOwn === true) return true;
  const n = String(note || '');
  if (/\n/.test(n)) return true;
  if (n.length >= 160) return true;
  return (String(t.title || '') + String(t.why || '') + n).length >= 320;
}
const storyAttr = (on) => (on ? ' data-story-own' : '');

// Which screen a component lands on. Returns nothing; it stamps the nodes, so
// renderComponent can read the decision back off the node it is handed.
function planStory(layout, P) {
  const cfg = (P.layout && P.layout.story) || {};
  const skip = new Set(cfg.skip || []);
  const order = Array.isArray(cfg.order) ? cfg.order : null;
  const rank = (t) => {
    if (order) { const i = order.indexOf(t); if (i >= 0) return i; return 100 + (STORY_RANK[t] ?? 40); }
    return STORY_RANK[t] ?? 40;
  };
  const nodes = [...(layout.rail || layout.deck || []), ...(layout.stream || []), ...(layout.tail || [])];
  const live = [];
  for (const n of nodes) {
    const s = STORY[n.type];
    const empty = n.type === 'push' && !((P.push || {}).title);
    if (!s || skip.has(n.type) || n.story === false || empty) { n.__story = 'skip'; continue; }
    n.__story = s.mode;
    n.__storyPack = s.pack || 1;
    n.__storyView = s.view || null;
    live.push(n);
  }
  live.map((n, i) => ({ n, i }))
    .sort((a, b) => rank(a.n.type) - rank(b.n.type) || a.i - b.i)
    .forEach(({ n }, k) => { n.__storySeq = k + 1; });
}

// What the run is told before it looks at the page: roughly how many screens
// the day it just composed will be. The build cannot measure a phone, so it
// counts characters — a unit's share of a screen — and packs by the same two
// rules the page uses: one group per screen, and the ceiling.
const storyShare = (chars) => (chars < 80 ? 0.2 : chars < 200 ? 0.25 : chars < 450 ? 0.5 : 1);
function storyEstimate(layout, P) {
  const nodes = [...(layout.rail || layout.deck || []), ...(layout.stream || []), ...(layout.tail || [])]
    .filter((n) => n.__storySeq).sort((a, b) => a.__storySeq - b.__storySeq);
  let units = 0, screens = 2;   // the cover and the end card
  for (const n of nodes) {
    if (n.__story !== 'items') { units += 1; screens += 1; continue; }
    const groups = storyUnitsOf(n.type, P);
    for (const list of groups) {
      let used = 0, count = 0, open = false;
      for (const u of list) {
        const share = u.own ? 1 : storyShare(u.chars);
        units += 1;
        if (!open || u.own || count >= n.__storyPack || used + share > 1.0001) {
          screens += 1; used = share; count = 1; open = !u.own;
        } else { used += share; count += 1; }
      }
    }
  }
  return { units, screens };
}
// The same units the page will find, counted from the payload instead of the
// DOM. Grouped, because a screen never mixes two groups.
function storyUnitsOf(type, P) {
  const chars = (...xs) => xs.filter(Boolean).join(' ').length;
  if (type === 'focus' || type === 'todos') {
    return [(P[type] || []).filter((t) => String(t.title || '').trim()).map((t) => ({
      own: storyOwnRow(t, t.note), chars: chars(t.title, t.why, t.note),
    }))];
  }
  if (type === 'papers') {
    return [((P.arxiv || {}).papers || []).filter((p) => String(p.title || '').trim()).map((p) => ({
      own: p.storyOwn === true || (relOf(p) ?? 0) >= 2,
      chars: chars(p.title, (p.authors || []).join(', '), p.why),
    }))];
  }
  if (type === 'news') {
    const f = P.feed || {};
    return ['genui', 'industry', 'hci'].map((k) => (f[k] || []).filter((it) => String(it.title || '').trim())
      .map((it) => ({ own: it.storyOwn === true || relOf(it) === 3, chars: chars(it.title, it.meta, it.why) })))
      .filter((g) => g.length);
  }
  return [];
}
```

- [ ] **Step 4: Stamp the attributes onto the rendered markup**

In `renderComponent` (`lib/build.mjs:1283`), extend `viewAttrs`. Find:

```js
  const viewAttrs = (built.view ? ` data-view="${escAttr(built.view)}" data-view-key="${escAttr(built.viewKey)}"` : '')
    + (built.more ? ` data-exp-key="${escAttr(expKey)}"${isOpen ? ' data-expanded' : ''}` : '');
```

and append:

```js
  const storyAttrs = node.__story === 'skip' || !node.__storySeq
    ? ' data-story="skip"'
    : ` data-story="${escAttr(node.__story)}" data-story-seq="${node.__storySeq}"`
      + ` data-story-pack="${node.__storyPack || 1}"`
      + (node.__storyView ? ` data-story-view="${escAttr(node.__storyView)}"` : '')
      + (node.storyLabel ? ` data-story-label="${escAttr(node.storyLabel)}"` : '');
```

then add `${storyAttrs}` to the returned `<section …>` string, immediately
after `${viewAttrs}`.

In `rChecklist` (`lib/build.mjs:389`), change the opening `<li>` line from

```js
      `  <li class="row ${klass}" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
```

to

```js
      `  <li class="row ${klass}" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}${storyAttr(storyOwnRow(t, note))}>`,
```

In `rPapers` (`lib/build.mjs:531`), change the opening `<div class="pcard">` line to append
`${storyAttr(p.storyOwn === true || (r ?? 0) >= 2)}`.

In `rNewsCards` (`lib/build.mjs:411`), change the opening `<div class="ncard…">` line to append
`${storyAttr(it.storyOwn === true || r === 3)}`.

- [ ] **Step 5: Call the planner and report the estimate**

In `assemble` (`lib/build.mjs:1365`), immediately after

```js
  const layout = P.layout && (P.layout.rail || P.layout.stream) ? P.layout : DEFAULT_LAYOUT;
```

add:

```js
  planStory(layout, P);
```

In the `out` object, beside `counts`, add:

```js
    story: storyEstimate(layout, P),
```

and after the layout-doctor call, warn when the day has grown past reading length:

```js
  if (out.story.screens > 40) {
    console.error(`[day] story: ~${out.story.screens} screens — long for one sitting. `
      + `Cut by relevance (SKILL.md §Adapting to the day), not by truncation.`);
  }
```

- [ ] **Step 6: Carry the reading mode through the shell and readback**

In `shell.mrbl` change

```html
<main class="page" data-marble-id="nl-root">
```

to

```html
<main class="page" data-marble-id="nl-root"__READ__>
```

In `assemble`, beside the other `html.replace` calls, add:

```js
  html = html.replace('__READ__', prev.read ? ` data-read="${escAttr(prev.read)}"` : '');
```

In `readback` (`lib/build.mjs:189`), add before the `return`:

```js
  const readM = /<main class="page"[^>]*\sdata-read="(page|story)"/.exec(html);
```

and add `read: readM ? readM[1] : null,` to the returned object. Also add
`read: null` to the early `return` for a missing file.

- [ ] **Step 7: Run the test and watch it pass**

```bash
cd /Users/bryanmin/Development/3rd-year-projects/marble-drive
node --test test/day-story.test.js
```

Expected: all cases pass.

- [ ] **Step 8: Prove the existing pipeline still builds clean**

```bash
cd /Users/bryanmin/Development/3rd-year-projects/marble-drive
node .claude/skills/my-day/lib/build.mjs assemble \
  --payload .claude/skills/my-day/sample-payload.json --out /tmp/story-smoke.mrbl
node .claude/skills/my-day/lib/layoutcheck.mjs /tmp/story-smoke.mrbl
```

Expected: the assemble report prints `"layout": "clean"` and carries a `story`
block; the doctor prints `[layoutcheck] clean` or warnings only, never an error.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/my-day/lib/build.mjs .claude/skills/my-day/shell.mrbl test/day-story.test.js
git commit -m "Days: the build cuts a day into story units and says how many screens it is."
```

---

### Task 2: The story runtime — units, packing, chrome

**Files:**
- Modify: `.claude/skills/my-day/shell.mrbl` (a new IIFE after the existing behaviour block, ending before the affordance block at `shell.mrbl:220`)

**Interfaces:**
- Consumes: every attribute from Task 1.
- Produces, for Tasks 3 and 4 (module-scope names inside the same IIFE):
  - `state.screens: Array<{ kind?: 'cover'|'end', group, label, cat, units: Unit[], clamped?: boolean }>`
  - `Unit = { el: Element, sec: Element, node: Element, group, label, cat, pack, own }`
  - `state.cur: number`, `state.dx: number`, `state.dy: number`
  - `place()`, `mountWindow()`, `repack()`, `chrome()`, `enter(at)`, `leave()`
  - DOM: `.story` overlay, `.story-track`, `.story-screen`, `.story-stack`,
    `.story-bar`, `.story-seg`, `.story-kick`, `.story-zone[data-dir="prev"|"next"]`,
    `.story-open`, `.story-gauge`, `.story-read`, `.story-return`

- [ ] **Step 1: Write the failing test**

Create `test-browser/day-story.test.js` with the packing cases only (gestures
arrive in Task 3, hold in Task 4). It builds a real issue with `build.mjs` and
serves it through the drive harness.

```js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startDrive } from './harness.js';

const ROOT = new URL('../', import.meta.url).pathname;
const BUILD = path.join(ROOT, '.claude/skills/my-day/lib/build.mjs');
const PHONE = { width: 393, height: 852 };

const DAY = {
  date: '2026-09-19', title: 'Story fixture',
  greeting: 'Good morning, Bryan.', summary: 'A fixture day.',
  layout: {
    rail: [{ type: 'weather', treatment: 'card' }],
    stream: [{ type: 'focus', treatment: 'bare' }, { type: 'todos', treatment: 'bare' }],
    tail: [{ type: 'calendar', treatment: 'card' }],
  },
  focus: [{ key: 'f1', title: 'Send the email' }],
  todos: [
    { key: 't1', title: 'Book the flight' },
    { key: 't2', title: 'Plan the course' },
    { key: 't3', title: 'Write the grant' },
    { key: 'big', title: 'The long one', note: 'line\n'.repeat(40) },
  ],
  keyDates: [{ label: 'UIST', date: '2026-10-20' }],
  weather: { error: 'none' },
};

function issue(payload = DAY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-story-b-'));
  const pj = path.join(dir, 'p.json');
  const out = path.join(dir, 'issue.mrbl');
  fs.writeFileSync(pj, JSON.stringify(payload));
  execFileSync('node', [BUILD, 'assemble', '--payload', pj, '--out', out], { encoding: 'utf8' });
  return fs.readFileSync(out, 'utf8');
}

async function openStory(page, host) {
  await page.setViewportSize(PHONE);
  await page.goto(`${host.base}/a/${encodeURIComponent("Bryan's Days/story")}`);
  await page.waitForSelector('.story-read');
  await page.click('[data-setread="story"]');
  await page.waitForSelector('.story-screen');
}

test('the day reads as a story on a phone', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await openStory(page, host);

  const total = await page.$eval('.story-kick .story-of', (el) => Number(el.textContent.split('/')[1]));
  const segs = await page.$$eval('.story-seg > *', (els) => els.length);
  assert.equal(segs, total, 'one progress segment per screen');

  const keys = await page.$$eval('.story-gauge, .story-track', () => {
    const seen = [];
    for (const el of document.querySelectorAll('[data-key]')) seen.push(el.getAttribute('data-key'));
    return seen;
  });
  assert.ok(keys.includes('t1'), 'the live document still holds its rows');

  await page.click('.story-zone[data-dir="next"]');
  const at = await page.$eval('.story-kick .story-of', (el) => Number(el.textContent.split('/')[0]));
  assert.equal(at, 2, 'tapping the right advances one screen');
});

test('a unit taller than the screen is clamped, not split', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await openStory(page, host);
  const clamped = await page.evaluate(async () => {
    const zone = document.querySelector('.story-zone[data-dir="next"]');
    for (let i = 0; i < 40; i++) {
      if (document.querySelector('.story-screen[data-clamped]')) return true;
      zone.click();
      await new Promise((r) => setTimeout(r, 30));
    }
    return !!document.querySelector('.story-screen[data-clamped]');
  });
  assert.equal(clamped, true, 'the 40-line note gets a clamped screen of its own');
});

test('no overlay on a desktop-width tab, and one behind #story', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${host.base}/a/${encodeURIComponent("Bryan's Days/story")}`);
  assert.equal(await page.$('.story-read'), null, 'no toggle at desktop width');
  assert.equal(await page.$('.story'), null, 'no overlay');
  await page.goto(`${host.base}/a/${encodeURIComponent("Bryan's Days/story")}#story`);
  await page.waitForSelector('.story-screen');
  assert.ok(await page.$('.story'), 'the hash reaches the story for a screenshot pass');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/bryanmin/Development/3rd-year-projects/marble-drive
node --test --test-concurrency=1 test-browser/day-story.test.js
```

Expected: fails waiting for `.story-read` — the module does not exist.

- [ ] **Step 3: Write the module's CSS and scaffolding**

Append a new IIFE to `shell.mrbl`'s first script block (after the reveal
fallback, before the block closes). Build every element with
`document.createElement`; never a markup literal (see Global Constraints).

The stylesheet goes in via a transient `<style>` element created in JS:

```js
  const SHEET = `
    .story { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column;
      background: var(--bg); color: var(--ink); touch-action: none; overscroll-behavior: contain;
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
               env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
    .story[hidden] { display: none; }
    .story-bar { flex: none; display: flex; gap: 3px; padding: .55rem var(--s4) .35rem; }
    .story-seg { flex: 1 1 0; min-width: 0; height: 2.5px; border-radius: 999px;
      background: color-mix(in srgb, var(--faint) 35%, transparent); overflow: hidden; }
    .story-seg[data-on] { background: var(--segcat, var(--accent)); }
    .story-kick { flex: none; display: flex; align-items: center; gap: .5rem;
      padding: .1rem var(--s4) .5rem; min-width: 0; }
    .story-label { font: 600 .72rem/1 var(--font-sans); letter-spacing: .12em;
      text-transform: uppercase; color: var(--muted); display: flex; align-items: center;
      gap: .45rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .story-label::before { content: ""; width: .5rem; height: .5rem; border-radius: 50%;
      background: var(--segcat, var(--accent)); flex: none; }
    .story-of { margin-left: auto; font: 600 .72rem/1 var(--font-mono); color: var(--faint); flex: none; }
    .story-x { appearance: none; border: 0; background: none; color: var(--muted); cursor: pointer;
      font: 500 1rem/1 var(--font-sans); min-width: 2.75rem; min-height: 2.75rem; flex: none;
      border-radius: 8px; }
    .story-track { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
    .story-screen { position: absolute; inset: 0; display: flex; flex-direction: column;
      justify-content: center; padding: 0 var(--s4); will-change: transform; }
    .story-stack { display: flex; flex-direction: column; gap: var(--s4); min-width: 0; }
    .story-screen[data-clamped] .story-stack { max-height: 100%; overflow: hidden;
      mask-image: linear-gradient(to bottom, #000 78%, transparent 100%); }
    .story-unit { min-width: 0; }
    .story-unit .ptitle, .story-unit .ntitle, .story-unit .title { font-size: 1.2rem; line-height: 1.3; }
    .story-unit.comp { padding: 0; background: none; border: 0; }
    .story-unit.comp.card, .story-unit.comp.tint { padding: var(--s4); }
    .story-unit li.row { padding-left: 0; padding-right: 0; margin-inline: 0;
      grid-template-columns: minmax(0, 1fr); }
    .story-unit .pgrid, .story-unit .nsub { display: block; }
    .story-zone { position: absolute; top: 0; bottom: 0; appearance: none; border: 0; padding: 0;
      background: none; cursor: pointer; z-index: 2; }
    .story-zone[data-dir="prev"] { left: 0; width: 35%; }
    .story-zone[data-dir="next"] { right: 0; width: 65%; }
    .story-zone[data-press] { background: color-mix(in srgb, var(--ink) 4%, transparent); }
    .story-foot { flex: none; display: flex; justify-content: center; padding: .4rem 0 .9rem; }
    .story-open { appearance: none; border: 0; background: none; cursor: pointer; color: var(--muted);
      display: flex; flex-direction: column; align-items: center; gap: .15rem;
      font: 500 .74rem/1.2 var(--font-sans); min-height: 2.75rem; padding: 0 1rem; border-radius: 10px; }
    .story-chev { display: block; width: 1.1rem; height: .6rem; }
    .story-gauge { position: absolute; left: 0; top: 0; visibility: hidden; pointer-events: none;
      display: flex; flex-direction: column; gap: var(--s4); }
    .story-cover .greet { font-size: 2.1rem; }
    .story-count { margin: .6rem 0 0; font: 500 .74rem/1 var(--font-mono); color: var(--faint); }
    .story-end { display: flex; flex-direction: column; gap: var(--s3); }
    .story-end h2 { margin: 0; font: 500 1.9rem/1.15 var(--font-serif); letter-spacing: -.02em; }
    .story-end p { margin: 0; font-size: .92rem; color: var(--muted); }
    .story-acts { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: var(--s3); }
    .story-btn { appearance: none; cursor: pointer; border: 1px solid var(--line);
      background: var(--panel); color: var(--ink); border-radius: 999px;
      font: 600 .82rem/1 var(--font-sans); padding: .75rem 1.1rem; min-height: 2.75rem; }
    .story-read { display: flex; justify-content: flex-end; margin-bottom: var(--s3); }
    .story-read .seg button[aria-pressed="true"] { background: var(--accent); color: var(--bg); }
    .story-return { position: fixed; left: 0; right: 0; top: 0; z-index: 80;
      padding-top: env(safe-area-inset-top, 0px);
      background: color-mix(in srgb, var(--bg) 72%, transparent);
      backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid var(--line); }
    .story-return[hidden] { display: none; }
    .story-back { appearance: none; border: 0; background: none; cursor: pointer; width: 100%;
      color: var(--ink); font: 600 .8rem/1 var(--font-sans); padding: .95rem var(--s4);
      text-align: left; min-height: 2.75rem; }
    .story-zone:focus-visible, .story-open:focus-visible, .story-x:focus-visible,
    .story-btn:focus-visible, .story-back:focus-visible, .story-read button:focus-visible {
      outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 8px; }
    @media (prefers-reduced-transparency: reduce) {
      .story-return { background: var(--bg); backdrop-filter: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .story-screen { transition: opacity .2s ease; }
    }
  `;
```

Then the scaffolding:

```js
  const PHONE = matchMedia('(max-width: 62rem)');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.querySelector('main.page');
  const S = { on: false, hold: false, cur: 0, dx: 0, dy: 0, screens: [], units: [] };
  let sheet = null, overlay = null, track = null, gauge = null, bar = null,
      label = null, of = null, openBtn = null, ret = null, retLabel = null, segs = [];

  function ensureSheet() {
    if (sheet) return;
    sheet = document.createElement('style');
    sheet.setAttribute('data-marble-transient', '');
    sheet.textContent = SHEET;
    document.head.append(sheet);
  }
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    n.setAttribute('data-marble-transient', '');
    return n;
  };
```

- [ ] **Step 4: Collect units, sanitise clones, pack, mount, and draw the chrome**

```js
  function collect() {
    const secs = [...document.querySelectorAll('.comp[data-story-seq]')]
      .sort((a, b) => Number(a.dataset.storySeq) - Number(b.dataset.storySeq));
    const out = [];
    for (const sec of secs) {
      const mode = sec.dataset.story;
      if (mode === 'skip') continue;
      const cat = (sec.style.getPropertyValue('--cat') || '').trim() || 'var(--accent)';
      const head = sec.querySelector('.chead h2');
      const name = (sec.dataset.storyLabel || (head && head.textContent) || '').trim();
      if (mode === 'items') {
        const view = sec.dataset.storyView;
        const scope = view ? sec.querySelector('.v-' + view) : sec;
        if (!scope) continue;
        const pack = Math.max(1, Number(sec.dataset.storyPack) || 1);
        const subs = [...scope.querySelectorAll('.nsub')];
        for (const node of scope.querySelectorAll('li.row, .pcard, .ncard')) {
          const sub = node.closest('.nsub');
          const h3 = sub && sub.querySelector('h3');
          out.push({
            el: node, sec, cat, pack,
            group: sec.dataset.comp + (sub ? ':' + subs.indexOf(sub) : ''),
            label: (sub && h3 ? h3.textContent : name).trim(),
            own: node.hasAttribute('data-story-own'),
          });
        }
      } else {
        out.push({ el: sec, sec, cat, pack: 1, whole: true,
          group: 'c' + sec.dataset.storySeq, label: name, own: true });
      }
    }
    return out;
  }

  // A glance screen is a picture of the document, never the document. Nothing
  // addressable survives the copy, so nothing the story shows can be edited by
  // accident and nothing it does can be filed. The live element is one swipe
  // away, which is where every control lives.
  const STRIP = '.acts, .chk, .add, .exp-toggle, .exp, .seg, .comp-exp, .comp-more,'
    + ' .marble-grip, .chead .right, [data-marble-transient]';
  function shot(u) {
    const node = u.el.cloneNode(true);
    node.classList.add('story-unit');
    node.classList.remove('reveal', 'marble-armed', 'marble-item');
    if (u.whole && u.sec.dataset.storyView) node.setAttribute('data-view', u.sec.dataset.storyView);
    for (const k of node.querySelectorAll(STRIP)) k.remove();
    for (const n of [node, ...node.querySelectorAll('*')]) {
      n.removeAttribute('data-marble-id');
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
      n.removeAttribute('tabindex');
      n.removeAttribute('id');
      if (n.tagName === 'A') { n.removeAttribute('href'); n.removeAttribute('target'); }
    }
    for (const n of node.querySelectorAll('.note, .why')) if (!n.textContent.trim()) n.remove();
    return node;
  }

  const GAP = 20;
  function repack(keepEl) {
    S.units = collect();
    const H = track.clientHeight, W = track.clientWidth;
    gauge.textContent = '';
    gauge.style.width = W - 2 * 20 + 'px';
    const nodes = S.units.map((u) => { const n = shot(u); gauge.append(n); return n; });
    const hs = nodes.map((n) => n.getBoundingClientRect().height);
    for (const n of nodes) n.remove();

    const screens = [{ kind: 'cover', group: 'cover', label: '', cat: 'var(--accent)', units: [] }];
    let open = null, used = 0;
    S.units.forEach((u, i) => {
      const h = hs[i];
      const fits = open && open.group === u.group && !u.own && !open.own
        && open.units.length < u.pack && used + GAP + h <= H;
      if (!fits) {
        open = { group: u.group, label: u.label, cat: u.cat, units: [], own: u.own };
        screens.push(open); used = 0;
      }
      open.units.push({ ...u, node: nodes[i] });
      used += (open.units.length > 1 ? GAP : 0) + h;
      if (h > H) open.clamped = true;
    });
    screens.push({ kind: 'end', group: 'end', label: '', cat: 'var(--accent)', units: [] });
    S.screens = screens;

    let at = Math.min(S.cur, screens.length - 1);
    if (keepEl) {
      const found = screens.findIndex((s) => s.units.some((u) => u.el === keepEl));
      if (found >= 0) at = found;
    }
    S.cur = Math.max(0, at);
    drawBar(); for (const [, n] of mounted) n.remove(); mounted.clear();
    mountWindow(); chrome();
  }

  const mounted = new Map();
  function mount(i) {
    if (i < 0 || i >= S.screens.length || mounted.has(i)) return;
    const s = S.screens[i];
    const scr = el('div', 'story-screen');
    if (s.clamped) scr.setAttribute('data-clamped', '');
    const stack = el('div', 'story-stack');
    if (s.kind === 'cover') stack.append(coverNode());
    else if (s.kind === 'end') stack.append(endNode());
    else for (const u of s.units) stack.append(u.node);
    scr.append(stack);
    track.append(scr);
    mounted.set(i, scr);
  }
  function mountWindow() {
    for (const [i, n] of [...mounted]) if (Math.abs(i - S.cur) > 1) { n.remove(); mounted.delete(i); }
    mount(S.cur - 1); mount(S.cur); mount(S.cur + 1);
    place();
  }
  function place() {
    const W = track.clientWidth, H = track.clientHeight;
    for (const [i, n] of mounted) {
      const x = (i - S.cur) * W + S.dx;
      const y = i === S.cur ? S.dy : 0;
      n.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      n.style.opacity = i === S.cur && S.dy < 0 ? String(Math.max(0, 1 + S.dy / (H * 0.9))) : '1';
    }
  }
  function drawBar() {
    bar.textContent = ''; segs = [];
    for (const s of S.screens) {
      const seg = el('span', 'story-seg');
      seg.style.setProperty('--segcat', s.cat);
      bar.append(seg); segs.push(seg);
    }
  }
  function chrome() {
    const s = S.screens[S.cur] || { label: '', cat: 'var(--accent)' };
    segs.forEach((seg, i) => { if (i <= S.cur) seg.setAttribute('data-on', ''); else seg.removeAttribute('data-on'); });
    label.textContent = s.kind === 'cover' ? 'Today' : s.kind === 'end' ? 'The end' : s.label;
    label.style.setProperty('--segcat', s.cat);
    of.textContent = (S.cur + 1) + ' / ' + S.screens.length;
    const clamped = !!(mounted.get(S.cur) && mounted.get(S.cur).hasAttribute('data-clamped'));
    openBtn.hidden = s.kind === 'cover' || s.kind === 'end';
    openBtn.querySelector('.story-word').textContent = clamped ? 'swipe up for all of it' : 'Open';
  }
```

`coverNode()` clones `.masthead`, strips it the same way, adds a
`.story-count` line reading `<n> screens`. `endNode()` builds
*That's your day*, the colophon's text, and two `.story-btn`s —
*Read as a page* and *Start over*.

- [ ] **Step 5: Build the overlay, the toggle, and entry/exit**

```js
  function build() {
    ensureSheet();
    overlay = el('div', 'story');
    bar = el('div', 'story-bar');
    const kick = el('div', 'story-kick');
    label = el('span', 'story-label');
    of = el('span', 'story-of');
    const x = el('button', 'story-x', '✕');
    x.setAttribute('aria-label', 'Read as a page');
    x.addEventListener('click', () => leave());
    kick.append(label, of, x);
    track = el('div', 'story-track');
    gauge = el('div', 'story-gauge');
    const prev = el('button', 'story-zone'); prev.dataset.dir = 'prev';
    prev.setAttribute('aria-label', 'Previous screen');
    const next = el('button', 'story-zone'); next.dataset.dir = 'next';
    next.setAttribute('aria-label', 'Next screen');
    for (const z of [prev, next]) z.addEventListener('click', () => {
      if (suppressClick) return;
      go(S.cur + (z.dataset.dir === 'next' ? 1 : -1), 0);
    });
    track.append(gauge, prev, next);
    const foot = el('div', 'story-foot');
    openBtn = el('button', 'story-open');
    const chev = el('span', 'story-chev');
    chev.textContent = '⌃';
    const word = el('span', 'story-word', 'Open');
    openBtn.append(chev, word);
    openBtn.addEventListener('click', () => hold());
    foot.append(openBtn);
    overlay.append(bar, kick, track, foot);
    document.body.append(overlay);
    ret = el('div', 'story-return'); ret.hidden = true;
    retLabel = el('button', 'story-back', '');
    retLabel.addEventListener('click', () => unhold());
    ret.append(retLabel);
    document.body.append(ret);
  }

  function enter(at) {
    if (S.on) return;
    if (!overlay) build();
    S.on = true; overlay.hidden = false;
    S.cur = 0; S.dx = 0; S.dy = 0;
    repack();
    if (at) { const i = S.screens.findIndex((s) => s.units.some((u) => u.sec === at)); if (i > 0) { S.cur = i; mountWindow(); chrome(); } }
    watch();
  }
  function leave() {
    if (!S.on) return;
    S.on = false; S.hold = false;
    overlay.hidden = true; ret.hidden = true;
    unwatch();
    file('page'); syncToggle();
  }
```

The toggle is a `.story-read` wrapper holding the document's own `.seg`
pattern, prepended to `main.page`, present only while `PHONE.matches`:

```js
  let toggle = null;
  function syncToggle() {
    if (!PHONE.matches) { if (toggle) { toggle.remove(); toggle = null; } return; }
    if (!toggle) {
      ensureSheet();
      toggle = el('div', 'story-read');
      const seg = el('span', 'seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'How to read today');
      for (const [v, t] of [['page', 'Page'], ['story', 'Story']]) {
        const b = el('button', '', t);
        b.dataset.setread = v;
        b.addEventListener('click', () => { if (v === 'story') { file('story'); enter(current()); } else leave(); syncToggle(); });
        seg.append(b);
      }
      toggle.append(seg);
      root.prepend(toggle);
    }
    for (const b of toggle.querySelectorAll('[data-setread]')) {
      b.setAttribute('aria-pressed', String((b.dataset.setread === 'story') === S.on));
    }
  }
  function file(v) {
    if (root.getAttribute('data-read') === v) return;
    root.setAttribute('data-read', v);
    const id = window.marble && window.marble.id(root);
    if (id) window.marble.op({ type: 'setAttr', id, name: 'data-read', value: v });
  }
  const current = () => {
    for (const sec of document.querySelectorAll('.comp[data-story-seq]')) {
      if (sec.getBoundingClientRect().bottom > 0) return sec;
    }
    return null;
  };
```

Start-up, at the end of the IIFE:

```js
  syncToggle();
  PHONE.addEventListener('change', () => { if (!PHONE.matches && S.on) leave(); syncToggle(); });
  if (location.hash === '#story' || (PHONE.matches && root.getAttribute('data-read') === 'story')) {
    addEventListener('DOMContentLoaded', () => enter(null));
    if (document.readyState !== 'loading') enter(null);
  }
```

`watch()` installs a debounced `MutationObserver` on `.shell` (never on
`body`, which holds the overlay) plus `resize`, `orientationchange` and
`load` listeners, each calling `repack(keep)` where `keep` is
`S.screens[S.cur].units[0] && S.screens[S.cur].units[0].el`. `unwatch()`
removes them.

- [ ] **Step 6: Run the browser test**

```bash
cd /Users/bryanmin/Development/3rd-year-projects/marble-drive
node --test --test-concurrency=1 test-browser/day-story.test.js
```

Expected: the three cases in this file pass.

- [ ] **Step 7: Rebuild a real issue and re-check**

```bash
node .claude/skills/my-day/lib/build.mjs assemble \
  --payload .claude/skills/my-day/sample-payload.json --out /tmp/story-smoke.mrbl
node .claude/skills/my-day/lib/layoutcheck.mjs /tmp/story-smoke.mrbl
```

Expected: `layout: clean`, and no new doctor error. The doctor must not report
an `absolute-content` finding, which is the proof the sheet stayed transient.

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/my-day/shell.mrbl test-browser/day-story.test.js
git commit -m "Days: a day reads as a story — units, adaptive packing, the overlay and its chrome."
```

---

### Task 3: Gestures — tap, drag, projection, springs

**Files:**
- Modify: `.claude/skills/my-day/shell.mrbl` (the same IIFE)
- Modify: `test-browser/day-story.test.js`

**Interfaces:**
- Consumes: `S`, `place()`, `mountWindow()`, `chrome()` from Task 2.
- Produces: `go(target, velocity)`, `hold()`, `unhold()`, `suppressClick` —
  all referenced by Task 2's buttons and Task 4's bar.

- [ ] **Step 1: Write the failing test**

Append to `test-browser/day-story.test.js`:

```js
test('dragging sideways moves the story and a flick carries it', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await openStory(page, host);
  await page.click('.story-zone[data-dir="next"]');

  const box = await page.$eval('.story-track', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x - i * 40, box.y);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.story').dataset.moving);
  const at = await page.$eval('.story-kick .story-of', (el) => Number(el.textContent.split('/')[0]));
  assert.equal(at, 3, 'a leftward flick advances one screen');
});

test('the cover and the end card rubber-band instead of falling off', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await openStory(page, host);
  await page.click('.story-zone[data-dir="prev"]');
  const at = await page.$eval('.story-kick .story-of', (el) => Number(el.textContent.split('/')[0]));
  assert.equal(at, 1, 'previous on the cover stays on the cover');
});

test('nothing animates transform under reduced motion', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStory(page, host);
  const before = await page.$eval('.story-screen', (el) => el.style.transform);
  await page.click('.story-zone[data-dir="next"]');
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  assert.equal(running, 0, 'no running animations');
  assert.ok(typeof before === 'string');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --test-concurrency=1 test-browser/day-story.test.js
```

Expected: the drag case fails — the track does not follow the pointer.

- [ ] **Step 3: Add the spring integrator and the physics helpers**

```js
  // A spring, in the two parameters a designer reasons with: response is how
  // fast it reaches the target in seconds, damping is how much it overshoots
  // (1 = not at all). It always starts from where the thing actually is and
  // from the velocity it actually has, which is what makes it interruptible —
  // grab a moving screen and it re-targets rather than jumping.
  function spring(from, to, v0, damping, response, onFrame, onDone) {
    const w = (2 * Math.PI) / response;
    let x = from - to, v = v0, last = performance.now(), raf = 0;
    raf = requestAnimationFrame(function step(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
      v += (-w * w * x - 2 * damping * w * v) * dt;
      x += v * dt;
      if (Math.abs(x) < 0.4 && Math.abs(v) < 24) { onFrame(to); onDone && onDone(); return; }
      onFrame(to + x);
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }
  const project = (v) => (v / 1000) * 0.998 / 0.002;
  const rubber = (over, dim) => (over * dim * 0.55) / (dim + 0.55 * Math.abs(over));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
```

- [ ] **Step 4: Add `go()` and the pointer handlers**

```js
  let cancelX = null, suppressClick = false;
  function go(target, v0) {
    const t = clamp(target, 0, S.screens.length - 1);
    if (cancelX) { cancelX(); cancelX = null; }
    const d0 = S.dx + (t - S.cur) * track.clientWidth;
    S.cur = t; S.dx = d0;
    mountWindow(); chrome();
    if (REDUCED.matches || Math.abs(S.dx) < 0.5) { S.dx = 0; place(); return; }
    overlay.dataset.moving = '1';
    cancelX = spring(S.dx, 0, v0, Math.abs(v0) > 900 ? 0.8 : 1.0, 0.35,
      (val) => { S.dx = val; place(); },
      () => { cancelX = null; delete overlay.dataset.moving; });
  }

  let g = null;
  track.addEventListener('pointerdown', (e) => {
    if (!S.on || S.hold) return;
    if (cancelX) { cancelX(); cancelX = null; }
    if (cancelY) { cancelY(); cancelY = null; }
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY,
          t: e.timeStamp, vx: 0, vy: 0, axis: null };
    track.setPointerCapture(e.pointerId);
    const zone = e.target.closest('.story-zone');
    if (zone) zone.setAttribute('data-press', '');
    suppressClick = false;
  });
  track.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dt = e.timeStamp - g.t;
    if (dt > 0) { g.vx = ((e.clientX - g.px) / dt) * 1000; g.vy = ((e.clientY - g.py) / dt) * 1000; }
    g.px = e.clientX; g.py = e.clientY; g.t = e.timeStamp;
    const ddx = e.clientX - g.x0, ddy = e.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(ddx, ddy) < 10) return;
      g.axis = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
      suppressClick = true;
      for (const z of track.querySelectorAll('[data-press]')) z.removeAttribute('data-press');
    }
    const W = track.clientWidth, H = track.clientHeight;
    if (g.axis === 'x') {
      const edge = (S.cur === 0 && ddx > 0) || (S.cur === S.screens.length - 1 && ddx < 0);
      S.dx = edge ? rubber(ddx, W) : ddx;
    } else {
      S.dy = ddy < 0 ? ddy : rubber(ddy, H);
    }
    place();
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    for (const z of track.querySelectorAll('[data-press]')) z.removeAttribute('data-press');
    const axis = g.axis, vx = g.vx, vy = g.vy;
    const W = track.clientWidth, H = track.clientHeight;
    g = null;
    if (!axis) return;
    if (axis === 'x') {
      const landing = S.dx + project(vx);
      go(S.cur - Math.round(clamp(landing / W, -1, 1)), vx);
    } else {
      const landing = S.dy + project(vy);
      if (landing < -H * 0.3) hold(vy); else springY(0, vy);
    }
    requestAnimationFrame(() => { suppressClick = false; });
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);

  let cancelY = null;
  function springY(to, v0) {
    if (cancelY) { cancelY(); cancelY = null; }
    if (REDUCED.matches) { S.dy = to; place(); return; }
    cancelY = spring(S.dy, to, v0, 0.8, 0.3,
      (val) => { S.dy = val; place(); }, () => { cancelY = null; });
  }
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
node --test --test-concurrency=1 test-browser/day-story.test.js
```

Expected: all six cases pass.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/my-day/shell.mrbl test-browser/day-story.test.js
git commit -m "Days: the story tracks the finger, carries a flick, and rubber-bands at both ends."
```

---

### Task 4: Hold — the real document, the return bar, the keyboard

**Files:**
- Modify: `.claude/skills/my-day/shell.mrbl` (the same IIFE)
- Modify: `test-browser/day-story.test.js`

**Interfaces:**
- Consumes: `S`, `go()`, `springY()`, `place()`, `chrome()`.
- Produces: `hold(v)`, `unhold()`, and the keyboard bindings.

- [ ] **Step 1: Write the failing test**

Append:

```js
test('swiping up opens the live component and returning shows the edit', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await openStory(page, host);

  // walk to the first screen carrying a to-do row
  await page.evaluate(async () => {
    const zone = document.querySelector('.story-zone[data-dir="next"]');
    for (let i = 0; i < 40; i++) {
      const n = document.querySelector('.story-screen .story-stack li.row');
      if (n) return;
      zone.click();
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  await page.click('.story-open');
  await page.waitForSelector('.story-return:not([hidden])');
  const bar = await page.$eval('.story-back', (el) => el.textContent);
  assert.match(bar, /back to the story/i);
  const top = await page.evaluate(() => {
    const sec = document.querySelector('.comp[data-comp="todos"]');
    return Math.abs(sec.getBoundingClientRect().top) < 120;
  });
  assert.equal(top, true, 'the document is scrolled to the component');

  await page.click('.comp[data-comp="todos"] li.row [data-act="done"]');
  await page.click('.story-back');
  await page.waitForSelector('.story:not([hidden])');
  const struck = await page.$$eval('.story-screen .story-stack li.row', (els) =>
    els.some((e) => e.hasAttribute('data-done')));
  assert.equal(struck, true, 'the glance is rebuilt from the edited document');
});

test('the keyboard reaches every move', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await openStory(page, host);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => !document.querySelector('.story').dataset.moving);
  assert.equal(await page.$eval('.story-of', (el) => Number(el.textContent.split('/')[0])), 2);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => !document.querySelector('.story').dataset.moving);
  assert.equal(await page.$eval('.story-of', (el) => Number(el.textContent.split('/')[0])), 1);
});

test('the story files the reading mode and nothing else', async (t) => {
  const host = await startDrive();
  t.after(() => host.stop());
  await host.drive.createDocument("Bryan's Days/story", issue());
  const page = await host.page();
  t.after(() => page.close());
  await page.setViewportSize(PHONE);
  await page.goto(`${host.base}/a/${encodeURIComponent("Bryan's Days/story")}`);
  await page.waitForSelector('.story-read');
  await page.evaluate(() => {
    window.__ops = [];
    const real = window.marble.op.bind(window.marble);
    window.marble.op = (op, o) => { window.__ops.push(op); return real(op, o); };
  });
  await page.click('[data-setread="story"]');
  await page.waitForSelector('.story-screen');
  await page.click('.story-zone[data-dir="next"]');
  const ops = await page.evaluate(() => window.__ops);
  assert.deepEqual(ops.map((o) => o.name), ['data-read']);
  assert.equal(ops[0].value, 'story');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --test-concurrency=1 test-browser/day-story.test.js
```

Expected: the hold cases fail — `.story-return` never appears.

- [ ] **Step 3: Implement hold, unhold and the keyboard**

```js
  // Swipe up and the picture gives way to the thing itself: the document,
  // scrolled to the component this screen came from, with every control it
  // always had. The story files nothing; the page files what it always did.
  let heldEl = null, heldScroll = 0;
  function hold(v0) {
    const s = S.screens[S.cur];
    if (!s || s.kind) { springY(0, v0 || 0); return; }
    const u = s.units[0];
    heldEl = u.el;
    S.hold = true;
    ret.hidden = false;
    retLabel.textContent = '↓ ' + (s.label || 'the day') + ' · back to the story';
    const barH = ret.getBoundingClientRect().height;
    const y = u.sec.getBoundingClientRect().top + scrollY - barH - 8;
    const finish = () => {
      overlay.hidden = true;
      S.dy = 0; place();
      scrollTo({ top: Math.max(0, y), behavior: 'auto' });
      retLabel.focus();
    };
    if (REDUCED.matches) return finish();
    cancelY = spring(S.dy, -track.clientHeight, v0 || 0, 0.8, 0.3,
      (val) => { S.dy = val; place(); }, () => { cancelY = null; finish(); });
  }
  function unhold() {
    if (!S.hold) return;
    S.hold = false;
    heldScroll = scrollY;
    ret.hidden = true;
    overlay.hidden = false;
    repack(heldEl);
    if (REDUCED.matches) { S.dy = 0; place(); return; }
    S.dy = -track.clientHeight; place();
    springY(0, 0);
  }
  addEventListener('keydown', (e) => {
    if (!S.on) return;
    if (S.hold) { if (e.key === 'Escape') { e.preventDefault(); unhold(); } return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(S.cur + 1, 0); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(S.cur - 1, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hold(0); }
    else if (e.key === 'Escape') { e.preventDefault(); leave(); }
  });
```

Add a downward drag on `.story-return` that calls `unhold()` past 30 px, and
have `unhold()` restore `heldScroll` on a later hold of the same unit.

- [ ] **Step 4: Run the test and watch it pass**

```bash
node --test --test-concurrency=1 test-browser/day-story.test.js
```

Expected: all nine cases pass.

- [ ] **Step 5: Run the wider suites to prove nothing regressed**

```bash
node --test test/day-story.test.js
node --test --test-concurrency=1 test-browser/conversation.test.js test-browser/day-story.test.js
```

Expected: green. A failure in an unrelated browser file is the known load
flake — rerun that file alone before treating it as a regression.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/my-day/shell.mrbl test-browser/day-story.test.js
git commit -m "Days: swipe up holds the real component, and the bar brings the story back."
```

---

### Task 5: Teach the skill

**Files:**
- Modify: `.claude/skills/my-day/SKILL.md`
- Modify: `docs/superpowers/specs/2026-09-19-my-day-story-view-design.md` (record the two deviations)

- [ ] **Step 1: Add §The story to SKILL.md**

Insert after *Adapting to the day*, using the text in spec §7 verbatim, plus:

- a *story* column in the component vocabulary table summarising spec §2;
- `storyOwn` on items and `layout.story` in the Payload block;
- a new invariant: *The story files nothing but `data-read`. Glance is
  read-only; hold is the page.*;
- in step 7, the phone pass: screenshot at 393 × 852 with `#story`, walk every
  screen, and look for a clamped screen that is really two thoughts, a screen
  carrying one short line, and type that has gone small.

- [ ] **Step 2: Record the deviations in the spec**

Add a short *Amendments* section naming the two: story CSS ships in the
runtime-injected transient sheet rather than `design.css` (the doctor rejects
`position: fixed` in the design system), and the over-40-screens warning is
printed by `assemble` rather than the doctor (the doctor has no character
model).

- [ ] **Step 3: Check the skill still parses and the build still runs**

```bash
node .claude/skills/my-day/lib/build.mjs assemble \
  --payload .claude/skills/my-day/sample-payload.json --out /tmp/story-smoke.mrbl
node .claude/skills/my-day/lib/build.mjs check --file /tmp/story-smoke.mrbl
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/my-day/SKILL.md docs/superpowers/specs/2026-09-19-my-day-story-view-design.md
git commit -m "Days: teach the skill the story — what earns a screen, and the phone pass."
```

---

## Self-review

**Spec coverage.** §1 shape → Tasks 2–4. §2 units and the table → Task 1 (`STORY`)
and Task 2 (`collect`). §3 order → Task 1 (`planStory`, `STORY_RANK`). §4
attributes, own-screen rule, ceilings, estimate → Task 1. §5.1 overlay → Task 2
step 5. §5.2 packing → Task 2 step 4. §5.3 gestures and motion → Task 3 and Task 4
step 3. §5.4 glance look → Task 2 (`shot`, the sheet). §5.5 cover and end → Task 2
step 4. §5.6 no host → nothing to build; the module never calls the carrier except
in `file()`, which is already guarded. §6 toggle → Task 2 step 5. §7 skill → Task 5.
§8 testing → Tasks 1–4.

**Placeholders.** None; every step carries the code it asks for.

**Type consistency.** `S`, `place`, `mountWindow`, `chrome`, `repack`, `go`,
`hold`, `unhold`, `springY`, `spring`, `project`, `rubber`, `file`, `shot`,
`collect`, `suppressClick` are each defined once in Task 2 or 3 and used under
the same name afterwards. `data-story`, `data-story-seq`, `data-story-pack`,
`data-story-view`, `data-story-label`, `data-story-own`, `data-read`,
`data-setread` match between Task 1's emitter and Task 2's reader.
