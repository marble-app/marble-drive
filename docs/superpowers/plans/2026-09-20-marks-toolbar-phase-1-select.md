# Marks toolbar, phase 1: the toolbar and Select — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floating toolbar on every Marble document that can be thrown to any corner, and a Select tool whose marquee reads addressed elements and hands them to the existing callout.

**Architecture:** Two new runtime files. `runtime/agent-marks-geometry.js` is pure functions on plain data (rectangles, boxes, springs) exposed on `globalThis` so node tests can import it, exactly as `runtime/agent-usage-charts.js` is. `runtime/agent-marks.js` is the layer: transient chrome in a manual popover appended to `<html>`, like the callout layer, that draws the toolbar, runs the Select mode, and commits ids through `marble.agent.select(ids)` so the callout's handle and card take over unchanged. The host serves both files and injects them after `agent-callout.js` when agents are on.

**Tech Stack:** Vanilla browser JS (IIFE runtime files, no bundler), Node's built-in test runner, Playwright through the `test-browser/harness.js` scratch drive.

**Spec:** `docs/superpowers/specs/2026-09-20-marks-toolbar-for-every-app-design.md` — sections 4, 5.1, 5.2, 5.7 and 6 are this phase. Read it first.

## Global Constraints

- The layer stands down on any page with `<meta name="marble-agent" content="custom">` (the Agents page).
- No document is edited. Everything drawn carries `data-marble-transient`, lives in one fixed layer on `<html>`, and is shown as a manual popover.
- Anchors are `data-marble-id`s, never pixels. Boxes are measured fresh; nothing caches a rect across frames of user input.
- The right edge is `document.documentElement.getBoundingClientRect().right`, capped at `innerWidth`, never `innerWidth` alone (the pinned drawer sets `margin-inline-end` on `<html>`).
- The layer is `pointer-events: none` at rest; only the toolbar and, inside a mode, the overlay take the pointer. Wheel events are never `preventDefault`ed.
- Escape is the only key bound, and only inside a mode (plus clearing a standing marquee selection, the pick-mode precedent).
- Colour: `--marks-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)))`; paper `var(--card, var(--paper, #fff))`. Never `prefers-color-scheme`.
- Marquee membership: an element counts at 60% area coverage or full containment; leaves win; a parent that is itself a candidate replaces its children when every addressed child is chosen.
- Motion: 180ms and `cubic-bezier(.2, .8, .3, 1)` for state changes (the callout's), 300ms materialise for the strip, one spring (damping 0.8, response 0.4) for the corner throw. `prefers-reduced-motion` turns every transition off and the throw into a jump with a short opacity fade.
- Only `transform` and `opacity` (and `filter` on the strip) animate.
- Browser tests close their pages and never leave conversations running; run a failing browser file alone before calling it a regression (see the load-flaky-tests note).
- Commit messages are sentences, as the log shows, and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

- `runtime/agent-marks-geometry.js` — create. Pure: `coverage`, `idsInRect`, `project`, `nearestCorner`, `spring`, `settled`. No DOM, no `window` at load.
- `runtime/agent-marks.js` — create. The layer: styles, toolbar, corner, strip, Select mode, throw.
- `runtime/agent-callout.js` — modify `placeCard`'s no-anchor branch (one block) so a callout with nothing to point at sits above the toolbar.
- `server/app.js` — two `RUNTIME` entries and two injection lines.
- `docs/AGENTS.md` — a section after "Summoning an agent in a document".
- `test/agent-marks-geometry.test.js` — create.
- `test/server.test.js` — extend the existing injection assertion.
- `test-browser/marks.test.js` — create.

---

### Task 1: Geometry — coverage and which ids a rectangle means

**Files:**
- Create: `runtime/agent-marks-geometry.js`
- Test: `test/agent-marks-geometry.test.js`

**Interfaces:**
- Produces: `globalThis.marbleMarksGeometry.coverage(rect, box) → number` in `[0, 1]`, the fraction of `box`'s area inside `rect`. Both are `{ left, top, width, height }` in the same coordinate space.
- Produces: `globalThis.marbleMarksGeometry.idsInRect(rect, boxes, { threshold = 0.6 } = {}) → string[]`. `boxes` is an array in document order of `{ id, parent, left, top, width, height }` where `parent` is the id of the nearest addressed ancestor that is also in `boxes`, or `null`. Returns ids in the order their boxes appear.

- [ ] **Step 1: Write the failing tests**

```js
// test/agent-marks-geometry.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-marks-geometry.js';

const G = () => globalThis.marbleMarksGeometry;

// A page: a heading, a paragraph, and a list of two items. Body is not a box —
// the layer never offers <body> or <html>.
const PAGE = [
  { id: 'h', parent: null, left: 40, top: 40, width: 600, height: 40 },
  { id: 'p', parent: null, left: 40, top: 100, width: 600, height: 24 },
  { id: 'q', parent: null, left: 40, top: 140, width: 600, height: 60 },
  { id: 'q1', parent: 'q', left: 80, top: 140, width: 560, height: 30 },
  { id: 'q2', parent: 'q', left: 80, top: 170, width: 560, height: 30 },
];
const rect = (left, top, right, bottom) => ({ left, top, width: right - left, height: bottom - top });

test('coverage is the share of the box inside the rect', () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };
  assert.equal(G().coverage(rect(0, 0, 100, 100), box), 1);
  assert.equal(G().coverage(rect(0, 0, 50, 100), box), 0.5);
  assert.equal(G().coverage(rect(200, 200, 300, 300), box), 0);
  assert.equal(G().coverage(rect(-50, -50, 150, 150), box), 1, 'a rect larger than the box contains it');
  assert.equal(G().coverage(rect(0, 0, 100, 100), { left: 0, top: 0, width: 0, height: 0 }), 0, 'an empty box covers nothing');
});

test('a rect that grazes an element does not select it', () => {
  assert.deepEqual(G().idsInRect(rect(30, 121, 700, 130), PAGE), []);
});

test('an element counts at 60% coverage, not below', () => {
  // p spans y 100..124. 60% of 24 is 14.4.
  assert.deepEqual(G().idsInRect(rect(30, 100, 700, 115), PAGE), ['p']);
  assert.deepEqual(G().idsInRect(rect(30, 100, 700, 113), PAGE), []);
});

test('a rect over a whole list selects the list, not its items', () => {
  assert.deepEqual(G().idsInRect(rect(30, 130, 700, 210), PAGE), ['q']);
});

test('a rect over one item selects that item', () => {
  assert.deepEqual(G().idsInRect(rect(30, 135, 700, 172), PAGE), ['q1']);
});

test('a rect over both items but not the list itself still coalesces only when the list is a candidate', () => {
  // The list is 60px tall; a rect covering exactly the two items covers the
  // whole list too, so this coalesces. Shrink the list's box so it is taller
  // than its items and only 50% covered: the items stay items.
  const tall = PAGE.map((b) => (b.id === 'q' ? { ...b, top: 140, height: 120 } : b));
  assert.deepEqual(G().idsInRect(rect(30, 135, 700, 205), tall), ['q1', 'q2']);
});

test('ids come back in document order regardless of drag direction', () => {
  assert.deepEqual(G().idsInRect(rect(30, 30, 700, 210), PAGE), ['h', 'p', 'q']);
});

test('threshold is an option', () => {
  assert.deepEqual(G().idsInRect(rect(30, 100, 700, 113), PAGE, { threshold: 0.5 }), ['p']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/agent-marks-geometry.test.js`
Expected: FAIL — `Cannot find module '../runtime/agent-marks-geometry.js'`.

- [ ] **Step 3: Write the module**

```js
// runtime/agent-marks-geometry.js
// The arithmetic under the marks toolbar, kept apart from the DOM so it can
// be tested in node: what a rectangle means on a page of addressed boxes,
// where a thrown toolbar lands, and the spring that carries it there.
//
// Loaded in the browser before agent-marks.js, and imported in node by the
// tests; it touches neither window nor document.

(() => {
  const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);

  /** The share of `box` that lies inside `rect`, 0 to 1. */
  const coverage = (rect, box) => {
    const whole = area(box);
    if (!whole) return 0;
    const left = Math.max(rect.left, box.left);
    const top = Math.max(rect.top, box.top);
    const right = Math.min(rect.left + rect.width, box.left + box.width);
    const bottom = Math.min(rect.top + rect.height, box.top + box.height);
    if (right <= left || bottom <= top) return 0;
    return ((right - left) * (bottom - top)) / whole;
  };

  /** Every addressed box the rectangle means, said once, in document order.
   *  Candidates are boxes covered by `threshold` of their area or more.
   *  Leaves are the deepest candidates. A candidate parent replaces its
   *  children only when every addressed child is chosen — a rect across a
   *  whole list is the list; a rect across one item is that item. */
  const idsInRect = (rect, boxes, { threshold = 0.6 } = {}) => {
    const order = new Map(boxes.map((box, i) => [box.id, i]));
    const byId = new Map(boxes.map((box) => [box.id, box]));
    const children = new Map();
    for (const box of boxes) {
      if (!box.parent) continue;
      if (!children.has(box.parent)) children.set(box.parent, []);
      children.get(box.parent).push(box.id);
    }
    const under = (id, ancestor) => {
      for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) if (p === ancestor) return true;
      return false;
    };
    const candidates = new Set(boxes.filter((box) => coverage(rect, box) >= threshold).map((box) => box.id));
    let chosen = [...candidates].filter((id) => ![...candidates].some((other) => other !== id && under(other, id)));
    for (;;) {
      let merged = false;
      for (const id of chosen) {
        const parent = byId.get(id)?.parent;
        if (!parent || !candidates.has(parent)) continue;
        const kids = children.get(parent) ?? [];
        if (!kids.every((kid) => chosen.includes(kid))) continue;
        chosen = [parent, ...chosen.filter((other) => !kids.includes(other))];
        merged = true;
        break;
      }
      if (!merged) break;
    }
    return chosen.sort((a, b) => order.get(a) - order.get(b));
  };

  globalThis.marbleMarksGeometry = { coverage, idsInRect };
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/agent-marks-geometry.test.js`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-marks-geometry.js test/agent-marks-geometry.test.js
git commit -m "Marks geometry: which addressed elements a rectangle means.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Geometry — projection, corners, and the spring

**Files:**
- Modify: `runtime/agent-marks-geometry.js`
- Test: `test/agent-marks-geometry.test.js`

**Interfaces:**
- Produces: `project(velocity, decelerationRate = 0.998) → number` — Apple's momentum projection, px given px/s.
- Produces: `nearestCorner({ x, y }, { width, height }) → 'tl' | 'tr' | 'bl' | 'br'` — which quadrant of a `width × height` field the point is in.
- Produces: `spring({ x, v }, target, dt, { damping = 1, response = 0.4 } = {}) → { x, v }` — one semi-implicit Euler step, seconds. Callers clamp `dt` to 0.032.
- Produces: `settled({ x, v }, target) → boolean` — within 0.5px and under 10px/s.

- [ ] **Step 1: Append the failing tests**

```js
// append to test/agent-marks-geometry.test.js

test('project is the exponential-decay form, not v²/2a', () => {
  // 1000 px/s at 0.998 lands 499px out.
  assert.equal(Math.round(G().project(1000)), 499);
  assert.equal(G().project(0), 0);
  assert.ok(G().project(-400) < 0, 'sign follows velocity');
  assert.ok(Math.abs(G().project(1000, 0.99)) < Math.abs(G().project(1000)), 'a snappier rate lands shorter');
});

test('nearestCorner reads the quadrant', () => {
  const field = { width: 1000, height: 600 };
  assert.equal(G().nearestCorner({ x: 10, y: 10 }, field), 'tl');
  assert.equal(G().nearestCorner({ x: 990, y: 10 }, field), 'tr');
  assert.equal(G().nearestCorner({ x: 10, y: 590 }, field), 'bl');
  assert.equal(G().nearestCorner({ x: 990, y: 590 }, field), 'br');
  assert.equal(G().nearestCorner({ x: 2000, y: -50 }, field), 'tr', 'a projection past the field still picks a corner');
});

const fly = (damping, { seconds = 2, dt = 1 / 120 } = {}) => {
  let state = { x: 0, v: 0 };
  let peak = 0;
  for (let t = 0; t < seconds; t += dt) {
    state = G().spring(state, 100, dt, { damping, response: 0.4 });
    peak = Math.max(peak, state.x);
  }
  return { state, peak };
};

test('a critically damped spring reaches the target without overshoot', () => {
  const { state, peak } = fly(1);
  assert.ok(Math.abs(state.x - 100) < 0.5, `ends at ${state.x}`);
  assert.ok(peak <= 100.5, `peaked at ${peak}`);
  assert.ok(G().settled(state, 100));
});

test('an underdamped spring overshoots and still settles', () => {
  const { state, peak } = fly(0.8);
  assert.ok(peak > 101, `peaked at ${peak}`);
  assert.ok(Math.abs(state.x - 100) < 0.5, `ends at ${state.x}`);
});

test('a spring started with velocity carries it', () => {
  const still = G().spring({ x: 0, v: 0 }, 100, 1 / 120, { damping: 1 });
  const thrown = G().spring({ x: 0, v: 2000 }, 100, 1 / 120, { damping: 1 });
  assert.ok(thrown.x > still.x);
});

test('settled needs both a near position and a slow velocity', () => {
  assert.equal(G().settled({ x: 100.2, v: 0 }, 100), true);
  assert.equal(G().settled({ x: 100.2, v: 50 }, 100), false);
  assert.equal(G().settled({ x: 103, v: 0 }, 100), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/agent-marks-geometry.test.js`
Expected: the six new tests FAIL with `G().project is not a function` and similar.

- [ ] **Step 3: Add the functions**

Insert before `globalThis.marbleMarksGeometry = …` and replace that line:

```js
  /** Where a flick comes to rest, from Designing Fluid Interfaces: an
   *  exponential decay, not the textbook v²/2a. 0.998 is scroll feel. */
  const project = (velocity, decelerationRate = 0.998) =>
    ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);

  /** The corner of a `width × height` field a point is nearest. Points past
   *  the field still resolve, so a projected landing can be off-screen. */
  const nearestCorner = ({ x, y }, { width, height }) =>
    `${y < height / 2 ? 't' : 'b'}${x < width / 2 ? 'l' : 'r'}`;

  /** One step of a damped spring, in Apple's two parameters: `damping` is the
   *  damping ratio (1 = no overshoot), `response` the period in seconds.
   *  Semi-implicit Euler; stable for dt up to ~0.03s at response 0.4. */
  const spring = (state, target, dt, { damping = 1, response = 0.4 } = {}) => {
    const omega = (2 * Math.PI) / response;
    const stiffness = omega * omega;
    const drag = 2 * damping * omega;
    const acceleration = -stiffness * (state.x - target) - drag * state.v;
    const v = state.v + acceleration * dt;
    const x = state.x + v * dt;
    return { x, v };
  };

  const settled = (state, target) => Math.abs(state.x - target) < 0.5 && Math.abs(state.v) < 10;

  globalThis.marbleMarksGeometry = { coverage, idsInRect, project, nearestCorner, spring, settled };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/agent-marks-geometry.test.js`
Expected: 14 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-marks-geometry.js test/agent-marks-geometry.test.js
git commit -m "Marks geometry: where a throw lands, and the spring that takes it there.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The layer and the toolbar button, served and injected

**Files:**
- Create: `runtime/agent-marks.js`
- Modify: `server/app.js` — the `RUNTIME` map (after the `'agent-callout.js'` entry, around line 103) and `injectCarrier` (after the `agent-callout.js` injection, around line 198)
- Modify: `test/server.test.js:108` — the injection assertion
- Test: `test-browser/marks.test.js`

**Interfaces:**
- Consumes: `globalThis.marbleMarksGeometry` (Task 1–2), `window.marble.app`, `window.marble.agent`, the `marble:agent` event (fired when the agent client attaches; see the callout's boot).
- Produces: DOM — `.marble-marks-layer` (popover, on `<html>`), `.marble-marks-bar[data-corner]` (transformed to its corner), `.marble-marks-main` (the button), `.marble-marks-badge[hidden]`, `.marble-marks-strip[hidden]` (empty until Task 4). Internal names later tasks extend: `PAD`, `MOTION`, `EASE`, `stillness`, `PHONE`, `layer`, `bar`, `main`, `strip`, `app`, `agent`, `corner`, `pos`, `edges()`, `restingPoint(corner)`, `paint()`, `settle()`, `schedule()`.

- [ ] **Step 1: Write the failing tests**

```js
// test-browser/marks.test.js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async (doc = 'garden', { width = 1200, height = 800, reducedMotion = null } = {}) => {
  await closePages();
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  if (reducedMotion) await page.emulateMedia({ reducedMotion });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

const bar = (page) => page.locator('.marble-marks-bar');
const main = (page) => page.locator('.marble-marks-main');
const barBox = (page) => page.evaluate(() => {
  const r = document.querySelector('.marble-marks-bar').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});

test('every document gets the toolbar at the bottom right; the Agents page does not', async () => {
  const page = await open();
  await bar(page).waitFor();
  const box = await barBox(page);
  assert.ok(Math.abs(box.right - (1200 - 16)) <= 1, `right edge at ${box.right}`);
  assert.ok(Math.abs(box.bottom - (800 - 16)) <= 1, `bottom edge at ${box.bottom}`);
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-layer').hasAttribute('data-marble-transient')), true);
  assert.equal(await main(page).getAttribute('aria-expanded'), 'false');

  const agents = await open('Agents');
  await agents.waitForTimeout(300);
  assert.equal(await agents.locator('.marble-marks-layer').count(), 0, 'no toolbar on the page made of agents');
});

test('pinning the drawer moves the toolbar in with the page edge', async () => {
  const page = await open();
  await bar(page).waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  await drawer.locator('button.pin').click();
  await page.locator('marble-agent-drawer aside.panel[data-pinned="true"]').waitFor();
  await page.waitForFunction(() => document.documentElement.getBoundingClientRect().right < innerWidth - 300);
  await page.waitForFunction(() => {
    const edge = document.documentElement.getBoundingClientRect().right;
    const r = document.querySelector('.marble-marks-bar').getBoundingClientRect();
    return Math.abs(r.right - (edge - 16)) <= 1;
  });
});
```

And extend the assertion in `test/server.test.js` (the `/ lands on the Drive` test, after the `agent-callout` line):

```js
  assert.doesNotMatch(page, /agent-marks/, 'no agents here, so nothing to mark up for');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test-browser/marks.test.js`
Expected: both FAIL — the `.marble-marks-bar` locator times out.

Run: `node --test test/server.test.js`
Expected: PASS (the negative assertion holds before the feature exists; it guards the injection condition once it does).

- [ ] **Step 3: Serve and inject the two files**

In `server/app.js`, after the `'agent-callout.js'` entry in `RUNTIME`:

```js
  // The marks toolbar: mark a document up, then hand the marks to an agent.
  // Geometry first; the layer reads it off globalThis.
  'agent-marks-geometry.js': () => path.join(REPO, 'runtime', 'agent-marks-geometry.js'),
  'agent-marks.js': () => path.join(REPO, 'runtime', 'agent-marks.js'),
```

In `injectCarrier`, after the `agent-callout.js` line:

```js
    // After the callout: Select hands its ids to the callout's handle.
    if (agents) {
      tags += `\n<script src="/runtime/agent-marks-geometry.js" data-marble-transient></script>`;
      tags += `\n<script src="/runtime/agent-marks.js" data-marble-transient></script>`;
    }
```

- [ ] **Step 4: Write the layer**

```js
// runtime/agent-marks.js
// The marks toolbar: mark a document up, then hand the marks to an agent.
//
// A floating button at a corner of any document. It opens into the tools —
// Select in this phase — and each tool is a mode the page is put in and taken
// out of. Everything drawn here is transient chrome in one fixed layer, like
// the callout; no document is edited to get it. Select leaves no mark of its
// own: it names elements and the callout takes them from there.
//
// Spec: docs/superpowers/specs/2026-09-20-marks-toolbar-for-every-app-design.md

(() => {
  const TRANSIENT = 'data-marble-transient';
  const PHONE = matchMedia('(max-width: 719px)');
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  const PAD = 16;
  const SIZE = 40;
  // The callout's duration and curve, so the two layers move as one.
  const MOTION = 180;
  const EASE = 'cubic-bezier(.2, .8, .3, 1)';
  const CORNERS = new Set(['tl', 'tr', 'bl', 'br']);
  const cornerKey = (app) => `marble-marks:corner:${app}`;
  const G = () => globalThis.marbleMarksGeometry;

  // The callout's mark: an outlined bubble with a beak. The toolbar says the
  // same thing the handle does — ask an agent about this — so it wears the
  // same glyph.
  const BUBBLE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 15.1A8 8 0 1 1 10.9 18.2L4.9 21.1a.6.6 0 0 1-.72-.85Z"/></svg>';

  const STYLE = `
    .marble-marks-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none;
      z-index: 2147483002;
      --marks-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --marks-paper: var(--card, var(--paper, #fff));
      --marks-ink: var(--ink, #222);
      /* Small text on glass: a touch heavier and wider than body text. */
      font: 500 12px/1.2 var(--ui-font, system-ui, -apple-system, sans-serif);
      letter-spacing: .01em;
      color: var(--marks-ink);
    }
    /* In the top layer so no document's stacking context can cover it; the UA
       sheet for [popover] would otherwise centre it and give it a border. */
    .marble-marks-layer:popover-open { position: fixed; inset: 0; }

    .marble-marks-bar {
      position: absolute; left: 0; top: 0; width: ${SIZE}px; height: ${SIZE}px;
      pointer-events: auto; will-change: transform;
    }
    .marble-marks-bar[hidden] { display: none; }
    .marble-marks-main {
      all: unset; box-sizing: border-box; position: relative;
      width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
      display: grid; place-items: center; cursor: grab; touch-action: none;
      color: var(--marks-mark);
      background: color-mix(in srgb, var(--marks-paper) 72%, transparent);
      -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent),
        0 1px 2px rgba(0, 0, 0, .08), 0 8px 24px rgba(0, 0, 0, .12);
      transition: transform 100ms ease-out;
    }
    .marble-marks-main:active, .marble-marks-bar[data-dragging] .marble-marks-main { transform: scale(.97); cursor: grabbing; }
    .marble-marks-main:focus-visible { outline: 2px solid var(--marks-mark); outline-offset: 2px; }
    .marble-marks-badge {
      position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px;
      border-radius: 9px; background: var(--marks-mark); color: var(--marks-paper);
      font-size: 11px; display: grid; place-items: center;
    }
    .marble-marks-badge[hidden] { display: none; }

    .marble-marks-strip {
      position: absolute; display: flex; flex-direction: column; gap: 2px; padding: 4px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--marks-paper) 72%, transparent);
      -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent),
        0 1px 2px rgba(0, 0, 0, .08), 0 12px 32px rgba(0, 0, 0, .14);
    }
    .marble-marks-strip[hidden] { display: none; }
    .marble-marks-bar[data-corner^="b"] .marble-marks-strip { bottom: calc(100% + 8px); }
    .marble-marks-bar[data-corner^="t"] .marble-marks-strip { top: calc(100% + 8px); }
    .marble-marks-bar[data-corner$="r"] .marble-marks-strip { right: 0; }
    .marble-marks-bar[data-corner$="l"] .marble-marks-strip { left: 0; }

    @media (prefers-reduced-transparency: reduce) {
      .marble-marks-main, .marble-marks-strip {
        background: var(--marks-paper);
        -webkit-backdrop-filter: none; backdrop-filter: none;
        border: 1px solid color-mix(in srgb, var(--marks-ink) 18%, transparent);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .marble-marks-main { transition: none; }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app || !G()) return;
    // The Agents page is the orchestration view already; a toolbar for
    // briefing agents has no place on the page made of them.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-marks-layer')) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    const layer = document.createElement('div');
    layer.className = 'marble-marks-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('popover', 'manual');
    document.documentElement.append(layer);
    try { layer.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }

    // ------------------------------------------------------------ the toolbar

    const bar = document.createElement('div');
    bar.className = 'marble-marks-bar';
    bar.setAttribute(TRANSIENT, '');

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'marble-marks-main';
    main.setAttribute('aria-label', 'Mark up this page for an agent');
    main.setAttribute('aria-expanded', 'false');
    main.innerHTML = BUBBLE;

    const badge = document.createElement('span');
    badge.className = 'marble-marks-badge';
    badge.hidden = true;
    main.append(badge);

    const strip = document.createElement('div');
    strip.className = 'marble-marks-strip';
    strip.setAttribute('role', 'toolbar');
    strip.setAttribute('aria-label', 'Marks');
    strip.hidden = true;

    bar.append(main, strip);
    layer.append(bar);

    // ------------------------------------------------------------ the corner
    //
    // The page's edge, not the viewport's: a pinned drawer takes the right
    // side of <html> with a margin, and a toolbar under the drawer is lost.

    const edges = () => {
      const r = document.documentElement.getBoundingClientRect();
      return { left: Math.max(0, r.left), right: Math.min(innerWidth, r.right), top: 0, bottom: innerHeight };
    };
    const stored = localStorage.getItem(cornerKey(app));
    let corner = CORNERS.has(stored) ? stored : 'br';
    bar.dataset.corner = corner;
    let pos = { x: 0, y: 0 };
    const restingPoint = (which) => {
      const e = edges();
      return {
        x: which.endsWith('l') ? e.left + PAD : e.right - PAD - bar.offsetWidth,
        y: which.startsWith('t') ? e.top + PAD : e.bottom - PAD - bar.offsetHeight,
      };
    };
    const paint = () => { bar.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`; };
    // Overridden in Task 6 to stay out of the way of a drag or a flight.
    let settle = () => { pos = restingPoint(corner); paint(); };
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; settle(); }); };
    addEventListener('resize', schedule);
    // The dock changes <html>'s width without a resize event.
    new ResizeObserver(schedule).observe(document.documentElement);
    settle();

    // On a phone the drawer is a sheet from the bottom; the toolbar yields.
    const drawerOpen = () => PHONE.matches && Boolean(document.querySelector('marble-agent-drawer[data-open-state="open"]'));
    const syncHidden = () => { bar.hidden = drawerOpen(); };
    new MutationObserver(syncHidden).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-open-state'] });
    PHONE.addEventListener('change', syncHidden);
    syncHidden();
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test-browser/marks.test.js`
Expected: 2 passing.

Run: `node --test test/server.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-marks.js server/app.js test/server.test.js test-browser/marks.test.js
git commit -m "The marks toolbar: a button at the page's corner on every document, served and injected with the callout.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The strip opens out of the button

**Files:**
- Modify: `runtime/agent-marks.js` — `STYLE` and the toolbar section
- Test: `test-browser/marks.test.js`

**Interfaces:**
- Consumes: `bar`, `main`, `strip`, `corner`, `EASE`, `stillness` from Task 3.
- Produces: `.marble-marks-tool[data-tool="select"][aria-pressed]` with `data-label="Select"`; `expand()`, `collapse()`, `toggle()`; `tool(name, label, glyph) → HTMLButtonElement` for later phases to add Comment, Sketch and Send. The strip's `hidden` attribute is the open state.

- [ ] **Step 1: Append the failing tests**

```js
// append to test-browser/marks.test.js

const strip = (page) => page.locator('.marble-marks-strip');
const tool = (page, name) => page.locator(`.marble-marks-tool[data-tool="${name}"]`);

test('the button opens a strip holding Select, out of its own corner, and closes it again', async () => {
  const page = await open();
  await bar(page).waitFor();
  assert.equal(await strip(page).isHidden(), true);
  await main(page).click();
  await strip(page).waitFor();
  assert.equal(await main(page).getAttribute('aria-expanded'), 'true');
  await tool(page, 'select').waitFor();
  assert.equal(await tool(page, 'select').getAttribute('aria-pressed'), 'false');
  assert.equal(await tool(page, 'select').getAttribute('data-label'), 'Select');
  // The strip hangs above the button and shares its right edge.
  const [b, s] = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return [r('.marble-marks-main'), r('.marble-marks-strip')];
  });
  assert.ok(s.bottom < b.top, 'strip sits above the button');
  assert.ok(Math.abs(s.right - b.right) <= 1, 'strip shares the button\'s right edge');
  assert.equal(await strip(page).evaluate((el) => {
    const [x, y] = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
    return Math.round(x) === el.offsetWidth && Math.round(y) === el.offsetHeight;
  }), true, 'grows from the bottom right');
  await main(page).click();
  await page.waitForFunction(() => document.querySelector('.marble-marks-strip').hidden);
  assert.equal(await main(page).getAttribute('aria-expanded'), 'false');
});

test('under reduced motion the strip appears with no animation', async () => {
  const page = await open('garden', { reducedMotion: 'reduce' });
  await bar(page).waitFor();
  await main(page).click();
  await strip(page).waitFor();
  assert.equal(await strip(page).evaluate((el) => el.getAnimations().length), 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test-browser/marks.test.js`
Expected: the two new tests FAIL — the strip stays hidden after the click.

- [ ] **Step 3: Add the strip's motion and the tool factory**

Append to `STYLE` (before the `prefers-reduced-transparency` block):

```css
    /* The strip materialises out of the button: blur, scale and opacity
       together, so it reads as a surface arriving rather than a fade. */
    .marble-marks-strip {
      opacity: 1; transform: scale(1); filter: blur(0);
      transition: opacity 300ms ${EASE}, transform 300ms ${EASE}, filter 300ms ${EASE},
                  display 300ms allow-discrete;
    }
    @starting-style { .marble-marks-strip { opacity: 0; transform: scale(.9); filter: blur(6px); } }
    .marble-marks-strip[hidden] { opacity: 0; transform: scale(.9); filter: blur(6px); }
    .marble-marks-bar[data-corner="br"] .marble-marks-strip { transform-origin: bottom right; }
    .marble-marks-bar[data-corner="bl"] .marble-marks-strip { transform-origin: bottom left; }
    .marble-marks-bar[data-corner="tr"] .marble-marks-strip { transform-origin: top right; }
    .marble-marks-bar[data-corner="tl"] .marble-marks-strip { transform-origin: top left; }

    .marble-marks-tool {
      all: unset; box-sizing: border-box; position: relative;
      width: 36px; height: 36px; border-radius: 10px;
      display: grid; place-items: center; cursor: pointer;
      color: var(--marks-ink);
      transition: transform 100ms ease-out, background 120ms ease, color 120ms ease;
    }
    .marble-marks-tool:hover { background: color-mix(in srgb, var(--marks-ink) 8%, transparent); }
    .marble-marks-tool:active { transform: scale(.97); }
    .marble-marks-tool:focus-visible { outline: 2px solid var(--marks-mark); outline-offset: 2px; }
    .marble-marks-tool[aria-pressed="true"] { background: var(--marks-mark); color: var(--marks-paper); }
    .marble-marks-tool svg { width: 20px; height: 20px; }
    /* The label sits on the side away from the page edge. */
    .marble-marks-tool::after {
      content: attr(data-label); position: absolute; top: 50%; transform: translateY(-50%);
      white-space: nowrap; padding: 4px 8px; border-radius: 6px;
      background: color-mix(in srgb, var(--marks-ink) 88%, transparent); color: var(--marks-paper);
      opacity: 0; pointer-events: none; transition: opacity 120ms ease;
    }
    .marble-marks-tool:hover::after, .marble-marks-tool:focus-visible::after { opacity: 1; }
    .marble-marks-bar[data-corner$="r"] .marble-marks-tool::after { right: calc(100% + 10px); }
    .marble-marks-bar[data-corner$="l"] .marble-marks-tool::after { left: calc(100% + 10px); }
```

Extend the `prefers-reduced-motion` block:

```css
    @media (prefers-reduced-motion: reduce) {
      .marble-marks-main, .marble-marks-strip, .marble-marks-tool, .marble-marks-tool::after { transition: none; }
      .marble-marks-strip, .marble-marks-strip[hidden] { transform: none; filter: none; }
    }
```

In `boot`, after `layer.append(bar);`:

```js
    const GLYPHS = {
      select: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/></svg>',
    };
    const tool = (name, label, glyph) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'marble-marks-tool';
      button.dataset.tool = name;
      button.dataset.label = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = glyph;
      strip.append(button);
      return button;
    };
    const selectTool = tool('select', 'Select', GLYPHS.select);

    const expand = () => { strip.hidden = false; main.setAttribute('aria-expanded', 'true'); };
    const collapse = () => { strip.hidden = true; main.setAttribute('aria-expanded', 'false'); };
    const toggle = () => (strip.hidden ? expand() : collapse());
    main.addEventListener('click', toggle);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test-browser/marks.test.js`
Expected: 4 passing. If the `transformOrigin` assertion is off by a fraction, compare rounded numbers: `Math.round` both sides.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-marks.js test-browser/marks.test.js
git commit -m "The toolbar opens into a strip that grows out of its own corner.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Select — a marquee that reads elements and hands them to the callout

**Files:**
- Modify: `runtime/agent-marks.js` — `STYLE`, and a new mode section in `boot`
- Test: `test-browser/marks.test.js`

**Interfaces:**
- Consumes: `G().idsInRect`, `agent.select(ids | null)`, `agent.context().selection`, `selectTool`, `layer`, `bar`, `collapse()`.
- Produces: `.marble-marks-overlay[hidden]`, `.marble-marks-marquee[hidden]`, `.marble-marks-hit` (a pool), `layer[data-mode="select"]`, `layer[data-pinned]`; `setMode(name | null)` and `collectBoxes()` for the Sketch and Comment phases.

- [ ] **Step 1: Append the failing tests**

```js
// append to test-browser/marks.test.js

const drag = async (page, from, to, { shift = false } = {}) => {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
};
const boxOf = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
const selection = (page) => page.evaluate(() => window.marble.agent.context().selection);
const enterSelect = async (page) => {
  if (await strip(page).isHidden()) await main(page).click();
  await tool(page, 'select').click();
  await page.locator('.marble-marks-layer[data-mode="select"]').waitFor();
};

test('Select outlines elements as the marquee crosses them, and a rect over a list hands the list to the callout', async () => {
  const page = await open();
  await bar(page).waitFor();
  await enterSelect(page);
  assert.equal(await tool(page, 'select').getAttribute('aria-pressed'), 'true');
  const q = await boxOf(page, 'q');
  await page.mouse.move(q.x - 6, q.y - 6);
  await page.mouse.down();
  await page.mouse.move(q.x + q.width + 6, q.y + q.height / 2, { steps: 6 });
  await page.locator('.marble-marks-marquee:not([hidden])').waitFor();
  // Half way down the list only the first item is covered.
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-hit:not([hidden])').length === 1);
  await page.mouse.move(q.x + q.width + 6, q.y + q.height + 6, { steps: 6 });
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-hit:not([hidden])').length === 1);
  await page.mouse.up();
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q"]');
  // The mode ends with the release, and the callout's handle takes over.
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  await page.locator('.marble-callout-handle:not([hidden])').waitFor();
  assert.equal(await page.locator('.marble-marks-marquee:not([hidden])').count(), 0);
});

test('a marquee that grazes an element selects nothing, and a fresh text selection replaces a marquee', async () => {
  const page = await open();
  await bar(page).waitFor();
  await enterSelect(page);
  const p = await boxOf(page, 'p');
  await drag(page, { x: p.x - 6, y: p.y + p.height - 3 }, { x: p.x + p.width + 6, y: p.y + p.height + 3 });
  await page.waitForTimeout(100);
  assert.deepEqual(await selection(page), []);

  await enterSelect(page);
  await drag(page, { x: p.x - 6, y: p.y - 6 }, { x: p.x + p.width + 6, y: p.y + p.height + 6 });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  await page.evaluate(() => {
    const el = document.querySelector('[data-marble-id="h"]');
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
});

test('Shift adds a second marquee; Escape leaves the mode and then clears the selection', async () => {
  const page = await open();
  await bar(page).waitFor();
  await enterSelect(page);
  const q1 = await boxOf(page, 'q1');
  await drag(page, { x: q1.x - 6, y: q1.y - 4 }, { x: q1.x + q1.width + 6, y: q1.y + q1.height + 4 });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q1"]');
  await enterSelect(page);
  const h = await boxOf(page, 'h');
  await drag(page, { x: h.x - 6, y: h.y - 6 }, { x: h.x + h.width + 6, y: h.y + h.height + 6 }, { shift: true });
  await page.waitForFunction(() => JSON.stringify([...window.marble.agent.context().selection].sort()) === '["h","q1"]');

  await enterSelect(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  assert.deepEqual((await selection(page)).sort(), ['h', 'q1'], 'leaving the mode keeps the selection');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
});

test('double-clicking Select pins the mode for several rectangles', async () => {
  const page = await open();
  await bar(page).waitFor();
  await main(page).click();
  await tool(page, 'select').dblclick();
  await page.locator('.marble-marks-layer[data-mode="select"][data-pinned]').waitFor();
  const h = await boxOf(page, 'h');
  await drag(page, { x: h.x - 6, y: h.y - 6 }, { x: h.x + h.width + 6, y: h.y + h.height + 6 });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-layer').dataset.mode), 'select', 'pinned: still in the mode');
  const p = await boxOf(page, 'p');
  await drag(page, { x: p.x - 6, y: p.y - 6 }, { x: p.x + p.width + 6, y: p.y + p.height + 6 });
  // Without Shift the second rectangle replaces the first.
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test-browser/marks.test.js`
Expected: the four new tests FAIL — `[data-mode="select"]` never appears.

- [ ] **Step 3: Add the mode, the overlay and the marquee**

Append to `STYLE` (before the media queries):

```css
    /* Inside a mode the overlay takes the pointer and nothing else changes:
       wheel still scrolls the page under it. */
    .marble-marks-overlay { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; touch-action: none; }
    .marble-marks-overlay[hidden] { display: none; }
    .marble-marks-marquee {
      position: fixed; pointer-events: none; border-radius: 2px;
      border: 1px solid var(--marks-mark);
      background: color-mix(in srgb, var(--marks-mark) 8%, transparent);
    }
    .marble-marks-marquee[hidden] { display: none; }
    /* The same outline the callout's pick mode draws, one per element the
       rectangle means, repainted every frame of the drag. */
    .marble-marks-hit { position: fixed; pointer-events: none; border: 1.5px solid var(--marks-mark); border-radius: 6px; }
    .marble-marks-hit[hidden] { display: none; }
```

In `boot`, after `main.addEventListener('click', toggle);`:

```js
    // ------------------------------------------------------------ modes
    //
    // A tool is a mode the page is put in. The overlay under the toolbar
    // takes the pointer while a mode is on; Escape, or the tool again, gives
    // it back. Later phases add Comment and Sketch through the same switch.

    const overlay = document.createElement('div');
    overlay.className = 'marble-marks-overlay';
    overlay.setAttribute(TRANSIENT, '');
    overlay.hidden = true;
    const marquee = document.createElement('div');
    marquee.className = 'marble-marks-marquee';
    marquee.setAttribute(TRANSIENT, '');
    marquee.hidden = true;
    const hits = [];
    // Under the bar, so the toolbar stays clickable inside a mode.
    bar.before(overlay, marquee);

    let mode = null;
    let pinned = false;
    const tools = { select: selectTool };
    const setMode = (next) => {
      mode = next;
      layer.dataset.mode = next ?? '';
      overlay.hidden = !next;
      for (const [name, button] of Object.entries(tools)) button.setAttribute('aria-pressed', String(name === next));
      if (!next) { pinned = false; delete layer.dataset.pinned; }
    };
    const pin = (name) => { setMode(name); pinned = true; layer.dataset.pinned = ''; };
    setMode(null);
    selectTool.addEventListener('click', () => setMode(mode === 'select' ? null : 'select'));
    selectTool.addEventListener('dblclick', () => pin('select'));

    // ------------------------------------------------------------ boxes

    const collectBoxes = () => {
      const els = [...document.querySelectorAll('[data-marble-id]')].filter((el) =>
        el !== document.body && el !== document.documentElement && !el.closest(`[${TRANSIENT}]`) && el.getRootNode() === document);
      const known = new Set(els);
      return els.map((el) => {
        const r = el.getBoundingClientRect();
        const parent = el.parentElement?.closest('[data-marble-id]');
        return {
          id: el.getAttribute('data-marble-id'),
          parent: parent && known.has(parent) ? parent.getAttribute('data-marble-id') : null,
          left: r.left, top: r.top, width: r.width, height: r.height,
        };
      });
    };
    const paintHits = (ids, boxes) => {
      const byId = new Map(boxes.map((box) => [box.id, box]));
      ids.forEach((id, i) => {
        let hit = hits[i];
        if (!hit) {
          hit = document.createElement('div');
          hit.className = 'marble-marks-hit';
          hit.setAttribute(TRANSIENT, '');
          hits.push(hit);
          marquee.before(hit);
        }
        const box = byId.get(id);
        Object.assign(hit.style, { left: `${box.left - 3}px`, top: `${box.top - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px` });
        hit.hidden = false;
      });
      for (let i = ids.length; i < hits.length; i += 1) hits[i].hidden = true;
    };

    // ------------------------------------------------------------ Select

    let drag = null;
    let fromMarquee = false;
    const rectOf = (d) => ({
      left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1),
      width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
    });
    const frame = () => {
      if (!drag) return;
      drag.raf = 0;
      const r = rectOf(drag);
      Object.assign(marquee.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      drag.ids = G().idsInRect(r, drag.boxes);
      paintHits(drag.ids, drag.boxes);
    };
    const scheduleFrame = () => { if (drag && !drag.raf) drag.raf = requestAnimationFrame(frame); };

    overlay.addEventListener('pointerdown', (event) => {
      if (mode !== 'select' || event.button !== 0) return;
      // The page never sees this press: no text selection starts under it.
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY, boxes: collectBoxes(), ids: [], raf: 0 };
      marquee.hidden = false;
      frame();
    });
    overlay.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag.x1 = event.clientX;
      drag.y1 = event.clientY;
      scheduleFrame();
    });
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      cancelAnimationFrame(drag.raf);
      drag.raf = 0;
      frame();
      const ids = drag.ids;
      drag = null;
      marquee.hidden = true;
      paintHits([], []);
      const prior = event.type === 'pointerup' && event.shiftKey ? agent.context().selection : [];
      const union = [...prior, ...ids.filter((id) => !prior.includes(id))];
      agent.select(union.length ? union : null);
      fromMarquee = union.length > 0;
      if (!pinned) setMode(null);
    };
    overlay.addEventListener('pointerup', finish);
    overlay.addEventListener('pointercancel', finish);
    // Wheel passes through the overlay and the page moves under the drag.
    addEventListener('scroll', () => { if (drag) { drag.boxes = collectBoxes(); scheduleFrame(); } }, true);

    // Escape inside a mode leaves it; Escape with a marquee selection standing
    // clears it, as Escape clears Option-picks.
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (mode) { event.preventDefault(); event.stopPropagation(); setMode(null); return; }
      if (fromMarquee) { fromMarquee = false; agent.select(null); }
    }, true);
    // A fresh text selection is the person choosing something else.
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      if (!fromMarquee || !sel || sel.isCollapsed || !sel.rangeCount) return;
      const node = sel.anchorNode;
      const anchor = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!anchor || anchor.closest(`[${TRANSIENT}]`)) return;
      fromMarquee = false;
      agent.select(null);
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test-browser/marks.test.js`
Expected: 8 passing.

Then run the callout file to confirm nothing there moved: `node --test test-browser/callout.test.js`. Expected: PASS. If a callout test fails only under load, rerun it alone before treating it as a regression.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-marks.js test-browser/marks.test.js
git commit -m "Select: a marquee that outlines the elements it means and hands them to the callout.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Throwing the toolbar to a corner, and the callout making room

**Files:**
- Modify: `runtime/agent-marks.js` — the corner section
- Modify: `runtime/agent-callout.js:183-190` — `placeCard`'s no-anchor branch
- Modify: `docs/AGENTS.md` — after the "Summoning an agent in a document" section (ends at the line "no anchored card. The Agents page draws no callouts of its own.")
- Test: `test-browser/marks.test.js`

**Interfaces:**
- Consumes: `G().project`, `G().nearestCorner`, `G().spring`, `G().settled`, `bar`, `main`, `pos`, `corner`, `edges()`, `restingPoint()`, `paint()`, `settle` (reassigned), `collapse()`, `stillness`.
- Produces: `bar[data-dragging]` while a drag is live; `localStorage['marble-marks:corner:<app>']`.

- [ ] **Step 1: Append the failing tests**

```js
// append to test-browser/marks.test.js

test('the toolbar can be thrown to another corner, and the corner is remembered', async () => {
  const page = await open();
  await bar(page).waitFor();
  const b = await barBox(page);
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 300, cy, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').hasAttribute('data-dragging'));
  await page.mouse.move(cx - 700, cy, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => localStorage.getItem('marble-marks:corner:garden') === 'bl');
  await page.waitForFunction(() => Math.abs(document.querySelector('.marble-marks-bar').getBoundingClientRect().left - 16) <= 1);
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-bar').dataset.corner), 'bl');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await bar(page).waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector('.marble-marks-bar').getBoundingClientRect().left - 16) <= 1);
});

test('a short press is a click, not a throw', async () => {
  const page = await open();
  await bar(page).waitFor();
  const b = await barBox(page);
  await page.mouse.move(b.left + 20, b.top + 20);
  await page.mouse.down();
  await page.mouse.move(b.left + 24, b.top + 22);
  await page.mouse.up();
  await strip(page).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-marks:corner:garden')), null);
});

test('with the strip open, dragging closes it first, and the strip reopens on the new side', async () => {
  const page = await open();
  await bar(page).waitFor();
  await main(page).click();
  await strip(page).waitFor();
  const b = await barBox(page);
  await page.mouse.move(b.left + 20, b.top + 20);
  await page.mouse.down();
  await page.mouse.move(b.left - 900, b.top - 600, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.marble-marks-strip').hidden);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').dataset.corner === 'tl');
  await main(page).click();
  await strip(page).waitFor();
  const [button, s] = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return [r('.marble-marks-main'), r('.marble-marks-strip')];
  });
  assert.ok(s.top > button.bottom, 'in a top corner the strip hangs below');
  assert.ok(Math.abs(s.left - button.left) <= 1, 'and shares the left edge');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test-browser/marks.test.js`
Expected: the three new tests FAIL — `data-dragging` never appears; the corner stays `br`.

- [ ] **Step 3: Add the drag and the spring**

In `boot`, replace `main.addEventListener('click', toggle);` (from Task 4) with the block below, and place it after the corner section so `edges`, `restingPoint`, `paint` and `settle` exist:

```js
    // ------------------------------------------------------------ throwing it
    //
    // The button follows the pointer 1:1 from where it was grabbed. On
    // release the landing point is projected from the release velocity, the
    // nearest corner to that projection wins, and a spring with a little
    // bounce carries the bar there starting at the hand's speed — the only
    // motion in this layer that has momentum behind it.

    let hold = null;
    let flight = 0;
    let justDragged = false;
    const stopFlight = () => { cancelAnimationFrame(flight); flight = 0; };
    const velocityOf = (history) => {
      if (history.length < 2) return { x: 0, y: 0 };
      const last = history[history.length - 1];
      const first = history.find((sample) => last.t - sample.t <= 120) ?? history[0];
      const dt = (last.t - first.t) / 1000;
      if (dt <= 0) return { x: 0, y: 0 };
      return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    };
    const flyTo = (target, velocity) => {
      stopFlight();
      if (stillness.matches) {
        pos = target;
        paint();
        bar.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
        return;
      }
      let sx = { x: pos.x, v: velocity.x };
      let sy = { x: pos.y, v: velocity.y };
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
        last = now;
        sx = G().spring(sx, target.x, dt, { damping: 0.8, response: 0.4 });
        sy = G().spring(sy, target.y, dt, { damping: 0.8, response: 0.4 });
        pos = { x: sx.x, y: sy.x };
        paint();
        if (G().settled(sx, target.x) && G().settled(sy, target.y)) {
          pos = target;
          paint();
          flight = 0;
          return;
        }
        flight = requestAnimationFrame(step);
      };
      flight = requestAnimationFrame(step);
    };
    // Resize and the dock re-seat the bar, unless a hand or a flight has it.
    settle = () => { if (hold?.moved || flight) return; pos = restingPoint(corner); paint(); };

    main.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      main.setPointerCapture(event.pointerId);
      stopFlight();
      hold = { id: event.pointerId, sx: event.clientX, sy: event.clientY, gx: event.clientX - pos.x, gy: event.clientY - pos.y, moved: false, history: [] };
    });
    main.addEventListener('pointermove', (event) => {
      if (!hold || event.pointerId !== hold.id) return;
      if (!hold.moved) {
        if (Math.hypot(event.clientX - hold.sx, event.clientY - hold.sy) < 10) return;
        hold.moved = true;
        collapse();
        bar.dataset.dragging = '';
      }
      pos = { x: event.clientX - hold.gx, y: event.clientY - hold.gy };
      paint();
      hold.history.push({ x: event.clientX, y: event.clientY, t: performance.now() });
      if (hold.history.length > 8) hold.history.shift();
    });
    const release = (event) => {
      if (!hold || event.pointerId !== hold.id) return;
      const done = hold;
      hold = null;
      delete bar.dataset.dragging;
      if (!done.moved) return;
      justDragged = true;
      const velocity = velocityOf(done.history);
      const e = edges();
      const landing = { x: pos.x + G().project(velocity.x), y: pos.y + G().project(velocity.y) };
      corner = G().nearestCorner(
        { x: landing.x + bar.offsetWidth / 2 - e.left, y: landing.y + bar.offsetHeight / 2 - e.top },
        { width: e.right - e.left, height: e.bottom - e.top },
      );
      bar.dataset.corner = corner;
      localStorage.setItem(cornerKey(app), corner);
      flyTo(restingPoint(corner), velocity);
    };
    main.addEventListener('pointerup', release);
    main.addEventListener('pointercancel', release);
    main.addEventListener('click', () => {
      // The click after a throw is the hand letting go, not a press.
      if (justDragged) { justDragged = false; return; }
      toggle();
    });
```

- [ ] **Step 4: Make the callout yield the corner**

In `runtime/agent-callout.js`, `placeCard`'s no-anchor branch currently reads:

```js
      if (!anchor) {
        // Nothing left to point at: the chat is still reachable, bottom-right.
        Object.assign(el.style, { left: 'auto', top: 'auto', right: `${PAD}px`, bottom: `${PAD}px` });
        return;
      }
```

Replace it with:

```js
      if (!anchor) {
        // Nothing left to point at: the chat is still reachable, bottom-right —
        // above the marks toolbar when that is the corner it lives in.
        const toolbar = document.querySelector('.marble-marks-bar[data-corner="br"]:not([hidden])');
        const lift = toolbar ? toolbar.offsetHeight + GAP : 0;
        Object.assign(el.style, { left: 'auto', top: 'auto', right: `${PAD}px`, bottom: `${PAD + lift}px` });
        return;
      }
```

This branch has no browser test in this phase: reaching it needs a callout whose anchor has been removed from the page mid-session. Say so in the commit body; the Comment phase, which stores marks, will cover it.

- [ ] **Step 5: Document it**

Append to `docs/AGENTS.md` after the paragraph ending "The Agents page draws no callouts of its own.":

```markdown
## Marking a document up for an agent

Every document also carries a small round button at its bottom right, wearing
the callout's bubble. It opens into a strip of tools; in this phase the strip
holds **Select**. Pick a tool and the page is in that mode until Escape, or the
tool again, gives it back. Wheel scrolling still works inside a mode.

**Select** draws a marquee. Every addressed element the rectangle covers by
sixty percent or more is outlined as you drag, and a rectangle across a whole
list outlines the list rather than its items. Letting go hands those elements
to the callout — the same handle and card a text selection gets — and leaves
the mode. **Shift** while releasing adds to what is already selected; a
double-click on Select pins the mode for several rectangles; **Escape** with a
marquee selection standing clears it, as it clears Option-picks.

The button can be thrown to any corner: drag it, let go, and it settles in the
corner nearest to where the throw was headed. The corner is remembered per
document. When the drawer is pinned the toolbar moves in with the page's edge,
and on a phone it steps aside while the drawer is open. The Agents page has no
toolbar; it is the orchestration view already.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test-browser/marks.test.js`
Expected: 11 passing.

Run: `node --test test-browser/callout.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS. The agent-http fork test is known to flake under full-suite load; rerun that file alone if it fails.

- [ ] **Step 7: Commit**

```bash
git add runtime/agent-marks.js runtime/agent-callout.js docs/AGENTS.md test-browser/marks.test.js
git commit -m "The toolbar can be thrown to any corner, and a callout with nothing to point at sits above it.

The callout's no-anchor branch has no browser test in this phase: reaching
it needs an anchor removed mid-session. The Comment phase covers it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After phase 1

The host must be restarted for `server/app.js` to serve and inject the new files (runtime files are re-read per request, server files are not). Use `macos/launchd/daemon.sh restart`; never `kill` the process.

Phases 2 (Comment and the store) and 3 (Sketch) get their own plans from the same spec once this one has landed and been looked at in a real document.
