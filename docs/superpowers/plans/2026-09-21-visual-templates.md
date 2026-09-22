# Visual Templates + Build-From-Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a template recognisable without reading — a live picture of the
document, one word, one colour — and make picking one open a brief ("what do you
want to build?") that clones the starter and hands it to an agent.

**Architecture:** The gallery list gains per-starter identity (accent, three idea
prompts, a placeholder) and a new `GET /drive/starters/<id>/preview` route that
returns the built starter with `<script>` stripped and `<pre>` capped, cached in
memory. The Drive document draws one card component at two densities (page grid,
popover grid), each card mounting that preview in the same `sandbox=""` iframe the
grid tiles already use. Clicking a card opens a `#start` panel; commit creates the
document and, when the prompt field has text, starts a conversation aimed at it
and navigates to `/a/<path>#chat=<id>`, a deep link added to the drawer.

**Tech Stack:** Node 22 ESM, `node:test`, Playwright (via the Marble package), no
build step. The Drive page is one `.mrbl` file: vanilla DOM, CSS custom
properties, `data-marble-*` affordances.

**Spec:** `docs/superpowers/specs/2026-09-21-visual-templates-design.md`

## Global Constraints

- **Documents never name routes.** Anything the Drive document fetches goes
  through `window.marble.drive`; the preview URL is
  `marble.drive.starterPreviewHref(id)`.
- **Two copies of the Drive page.** `templates/drive.mrbl` (git-tracked, what
  `buildDrive()` seeds and what the browser tests load) and `drive/drive.mrbl`
  (live, gitignored, ~3000 lines ahead). Change the template first, then the live
  doc by **exact-string replace of the shared snippet**, asserting a match count
  of 1 before replacing. Never diff the whole files.
- **The live doc is served while you edit it.** `<style>`/`<script>` carry no
  `data-marble-id`, so a write that touches only those lands verbatim and the open
  tab reloads itself; a write that mixes them with addressed markup is clobbered
  (`label:"merge"`). So: **one write for `<style>` + `<script>`, a second write
  for the markup**, verifying `drive/.marble/drive.history.jsonl` after each.
- **Preserve `data-marble-id`s.** New addressed markup in the live doc gets fresh
  8-hex ids that appear nowhere else in the file.
- **Design tokens only.** `--ink --muted --faint --line --paper --paper-2
  --paper-3 --card --accent --accent-soft --accent-ink --radius --shadow
  --shadow-lift --settle --snap --t-fast --t --t-slow`. No new hex in the page
  except the starter accents, which come from the server.
- **Motion:** `--settle` for arrive/settle, `--snap` for a press, `--t` as the
  clock. Press feedback on pointer-down. `transform-origin` set from the trigger's
  rect. Honour `prefers-reduced-motion: reduce` with a cross-fade and no scale.
- **Another session is editing `runtime/agent-marks.js`.** Do not touch it, do not
  stash, do not reset.
- Accents, verbatim: `doc #3d6b8a`, `note #7e91a3`, `sheet #2f6f5b`,
  `board #b45309`, `slides #c45c3e`, `canvas #6f8f7d`, `paper #8b5e3c`,
  `latex #8b5e3c`.
- Card order, verbatim: `doc, note, sheet, board, canvas, slides, paper, latex`.

---

### Task 1: Starter identity and the preview build

**Files:**
- Modify: `server/gallery.js` (the `STARTERS` array; add `preview()` and its cache)
- Test: `test/gallery.test.js`

**Interfaces:**
- Produces: `list()` → `[{ id, title, blurb, accent, hint, ideas }]` where `hint`
  is a string and `ideas` is an array of exactly three strings.
- Produces: `preview(id)` → `Promise<string>` — the built starter with every
  `<script>` element removed and every `<pre>` body truncated to 1200 characters.
  Throws `Error` with `status: 404` for an unknown id. Cached per id.

- [ ] **Step 1: Write the failing tests** in `test/gallery.test.js`

```js
test('every starter carries what a card needs to be recognised without prose', () => {
  const seen = new Map();
  for (const starter of list()) {
    assert.match(starter.accent, /^#[0-9a-f]{6}$/, `${starter.id} has a hex accent`);
    assert.ok(starter.hint.length > 10, `${starter.id} has a prompt placeholder`);
    assert.equal(starter.ideas.length, 3, `${starter.id} offers three ideas`);
    for (const idea of starter.ideas) assert.ok(idea.length > 10 && idea.length < 120);
    seen.set(starter.accent, [...(seen.get(starter.accent) ?? []), starter.id]);
  }
  // One accent is shared, deliberately: paper and latex are one family.
  const shared = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  assert.deepEqual(shared.map(([, ids]) => ids), [['paper', 'latex']]);
});

test('the order on the page groups related templates', () => {
  assert.deepEqual(list().map((s) => s.id),
    ['doc', 'note', 'sheet', 'board', 'canvas', 'slides', 'paper', 'latex']);
});

test('a preview is the document with nothing that could run in it', async () => {
  const source = await preview('latex');
  assert.match(source, /^<!doctype html>/);
  assert.ok(!/<script/i.test(source), 'no script survives');
  // The typesetter is most of this starter; without it the preview is small.
  assert.ok(source.length < 120_000, `stripped to ${source.length} bytes`);
  for (const [, body] of source.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)) {
    assert.ok(body.length <= 1200, `a pre came through at ${body.length}`);
  }
});

test('a preview is built once', async () => {
  assert.equal(await preview('board'), await preview('board'));
});

test('an unknown starter has no preview', async () => {
  await assert.rejects(() => preview('telekinesis'), (err) => err.status === 404);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test --test-reporter=spec test/gallery.test.js`
Expected: FAIL — `preview` is not exported; `starter.hint` is undefined.

- [ ] **Step 3: Add the metadata and the preview build**

In `STARTERS`, reorder to `doc, note, sheet, board, canvas, slides, paper, latex`
and give each entry its accent from the Global Constraints plus `hint` and
`ideas`. Keep every existing comment — they are the reasons, and they are the most
valuable text in the file. Then, after `composeScript`:

```js
// A picture of a starter, which is the starter. The page mounts this in a
// `sandbox=""` iframe, so nothing in it can run — which is what makes the two
// transforms here free rather than lossy:
//
//   - every <script> goes. It is most of the payload (the latex starter carries
//     a typesetter: 934 KB becomes 50 KB) and none of it would have run.
//   - every <pre> is capped. `paper` carries acmart.cls as a file in its
//     project; forty lines of it and four thousand are the same grey rectangle
//     at a fifth of scale.
//
// Built once per id: the starters do not change while this host runs.
const PREVIEW_PRE = 1200;
const previews = new Map();

export async function preview(id) {
  if (previews.has(id)) return previews.get(id);
  const source = (await build(id, { name: byId.get(id)?.title ?? id }))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/(<pre\b[^>]*>)([\s\S]*?)(<\/pre>)/gi,
      (_, open, body, close) => open + body.slice(0, PREVIEW_PRE) + close);
  previews.set(id, source);
  return source;
}
```

`build()` already throws a 404 for an unknown id, so the rejection test passes
without a second check.

- [ ] **Step 4: Run the tests**

Run: `node --test --test-reporter=spec test/gallery.test.js`
Expected: PASS, including the eight pre-existing per-starter build tests.

- [ ] **Step 5: Commit**

```bash
git add server/gallery.js test/gallery.test.js
git commit -m "A starter carries its own colour, its hint and three ideas — and can be previewed without being made."
```

---

### Task 2: The preview route and the carrier href

**Files:**
- Modify: `server/app.js` (beside `GET /drive/starters`)
- Modify: `runtime/drive.js` (the `marble.drive` surface)
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `preview(id)` from Task 1.
- Produces: `GET /drive/starters/<id>/preview` → `200 text/html; charset=utf-8`,
  `Cache-Control: private, max-age=300`; `404` JSON for an unknown id.
- Produces: `marble.drive.starterPreviewHref(id)` → the same URL as a string.

- [ ] **Step 1: Write the failing test** in `test/server.test.js`

```js
test('a starter can be previewed without a document being made', async () => {
  const { base, close } = await start();
  try {
    const before = await (await fetch(`${base}/drive/tree`)).json();
    const res = await fetch(`${base}/drive/starters/board/preview`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /^<!doctype html>/);
    assert.ok(!/<script/i.test(html));
    const after = await (await fetch(`${base}/drive/tree`)).json();
    assert.deepEqual(after.children, before.children, 'nothing was created');

    assert.equal((await fetch(`${base}/drive/starters/nope/preview`)).status, 404);
  } finally {
    await close();
  }
});
```

Use whatever `start()`/session helper the neighbouring tests in the file already
use; read one first rather than inventing a second harness.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test --test-reporter=spec test/server.test.js`
Expected: FAIL — the preview route answers 404 for `board` too.

- [ ] **Step 3: Add the route**, directly under the `'/drive/starters'` block

```js
// A picture of a starter, so the gallery can show the document instead of
// describing it. Deliberately not under /a/: there is no document here, nothing
// is written, and what comes back has had everything runnable taken out of it.
const previewing = /^\/drive\/starters\/([\w-]+)\/preview$/.exec(route);
if (previewing && req.method === 'GET') {
  try {
    const source = await starterPreview(previewing[1]);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    });
    return res.end(source);
  } catch (err) {
    return json(res, err.status ?? 500, { error: err.message });
  }
}
```

and extend the import at `server/app.js:33`:

```js
import { build as buildStarter, list as listStarters, preview as starterPreview } from './gallery.js';
```

- [ ] **Step 4: Add the href to the carrier** in `runtime/drive.js`, beside
  `starters`

```js
// The picture of a starter, for a gallery that shows the document rather than
// describing it. A href rather than the bytes: it is mounted in an iframe, and
// the document is not the one that decides what a preview may run.
const starterPreviewHref = (id) => `/drive/starters/${encodeURIComponent(id)}/preview`;
```

and add `starterPreviewHref` to the `marble.drive = { … }` literal.

- [ ] **Step 5: Run the tests**

Run: `node --test --test-reporter=spec test/server.test.js test/gallery.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/app.js runtime/drive.js test/server.test.js
git commit -m "A route that answers with a picture of a starter, and the carrier href for it."
```

---

### Task 3: `#chat=<id>` — arriving at a document with a conversation open

**Files:**
- Modify: `runtime/agent-ui.js` (the drawer's boot, where `OPEN_KEY` is read —
  around line 6586)
- Test: `test-browser/drawer.test.js`

**Interfaces:**
- Produces: loading `/a/<path>#chat=<id>` opens the drawer on conversation `<id>`
  and leaves it remembered, whatever the stored open state was.

- [ ] **Step 1: Write the failing test** in `test-browser/drawer.test.js`,
  following the file's existing setup

```js
test('a document opened with #chat= arrives with that conversation open', async () => {
  const page = await openGarden();               // whatever this file already uses
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await page.goto(`${host.base}/a/garden#chat=${id}`);
  const panel = page.locator('marble-agent-drawer').first();
  await panel.waitFor();
  await page.waitForFunction(
    (want) => document.querySelector('marble-agent-drawer')
      ?.shadowRoot?.querySelector('marble-conversation')?.getAttribute('conversation') === want,
    id,
  );
  assert.equal(await page.evaluate(() => window.marble.agent.current()), id);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/drawer.test.js`
Expected: FAIL — the drawer boots closed, `conversation` attribute unset.

- [ ] **Step 3: Read the hash at boot.** Where the drawer currently does
  `if (api.storage.get(OPEN_KEY) === '1') this.open({ animate: false });`, put the
  deep link in front of it:

```js
// A conversation handed over by something else — the Drive after it has made a
// document from a template, a link somebody sent. It sits beside collab's
// `#at=<ids>`, which lands you on elements rather than on a chat.
const handed = /(?:^|[#&])chat=([\w-]+)/.exec(location.hash);
if (handed) {
  this.switchTo(handed[1]);
  this.open({ animate: false });
} else if (api.storage.get(OPEN_KEY) === '1') {
  this.open({ animate: false });
}
```

- [ ] **Step 4: Run the test**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/drawer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/drawer.test.js
git commit -m "A document can be opened with a conversation already open in it."
```

---

### Task 4: The card, the two grids, and the panel — in `templates/drive.mrbl`

**Files:**
- Modify: `templates/drive.mrbl` — the `.starters`/`.starter` CSS block
  (~lines 682–697 equivalent), the `#sheet` markup, `drawTemplates`,
  `starterButton`, `make`, the `#new` handler, the outside-click and Escape
  handlers
- Test: `test-browser/drive-templates.test.js` (new)

**Interfaces:**
- Produces markup ids/classes the tests and the live-doc patch both depend on:
  `.tgrid`, `.tgrid[data-compact]`, `.tcard` (with `data-id`, `data-accent`),
  `.tcard .tpeek`, `.tcard .tfoot`, `#start`, `#start-preview`, `#start-title`,
  `#start-blurb`, `#start-name`, `#start-prompt`, `#start-ideas`, `#start-where`,
  `#start-go`, `#start-cancel`, `#scrim`.
- Produces script functions: `templateCard(starter, { compact })`,
  `openStart(starter, anchorRect)`, `closeStart()`, `commitStart()`,
  `briefFor(starter, words)`.

- [ ] **Step 1: Write the failing browser test** `test-browser/drive-templates.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  scripts: { default: [{ type: 'text', text: 'On it.' }] },
  documents: { drive: await buildDrive(), garden: GARDEN },
});
test.after(() => host.close());

async function openTemplates() {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#nav .nav-item[data-nav="templates"]').click();
  await page.locator('#items .tgrid .tcard[data-id="board"]').waitFor();
  return { page, errors };
}

test('the gallery shows eight documents, not eight descriptions', async () => {
  const { page } = await openTemplates();
  const cards = page.locator('#items .tgrid .tcard');
  assert.equal(await cards.count(), 8);
  assert.deepEqual(
    await cards.evaluateAll((els) => els.map((el) => el.dataset.id)),
    ['doc', 'note', 'sheet', 'board', 'canvas', 'slides', 'paper', 'latex'],
  );
  // Each card is a picture of its own starter.
  const src = await page.locator('.tcard[data-id="sheet"] .tpeek iframe')
    .getAttribute('src');
  assert.match(src, /\/drive\/starters\/sheet\/preview$/);
  // And says nothing that has to be read.
  const text = await page.locator('.tcard[data-id="sheet"]').innerText();
  assert.equal(text.trim(), 'Sheet');
  // The colours are not all one colour any more.
  const accents = await cards.evaluateAll((els) => els.map((el) => el.dataset.accent));
  assert.equal(new Set(accents).size, 7);
});

test('picking a template opens a brief, not a prompt()', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="board"]').click();
  await page.locator('#start[data-open="1"]').waitFor();
  assert.equal(await page.locator('#start-title').innerText(), 'Board');
  assert.equal(await page.locator('#start-name').inputValue(), 'Board');
  assert.equal(await page.locator('#start-ideas button').count(), 3);
  assert.match(await page.locator('#start-where').innerText(), /My Drive/);
  assert.equal((await page.locator('#start-go').innerText()).trim(), 'Create');
  await page.keyboard.press('Escape');
  await page.locator('#start:not([data-open])').waitFor();
});

test('an idea fills the field and the button changes what it promises', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="board"]').click();
  await page.locator('#start-ideas button').first().click();
  assert.ok((await page.locator('#start-prompt').inputValue()).length > 10);
  assert.equal((await page.locator('#start-go').innerText()).trim(), 'Create & build');
});

test('an empty brief makes the document and goes there', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="sheet"]').click();
  await page.locator('#start-name').fill('Readings');
  await page.locator('#start-go').click();
  await page.waitForURL(/\/a\/Readings$/);
  assert.equal(await page.locator('h1').first().innerText(), 'Readings');
});

test('a brief makes the document, briefs an agent at it, and lands on the chat', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="board"]').click();
  await page.locator('#start-name').fill('Sprint');
  await page.locator('#start-prompt').fill('columns for triage, doing and shipped');
  await page.locator('#start-go').click();
  await page.waitForURL(/\/a\/Sprint#chat=/);

  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  assert.equal(list.length, 1);
  const detail = await (await fetch(`${host.base}/agent/conversations/${list[0].id}`)).json();
  const turn = detail.turns.at(-1);
  assert.equal(turn.context.target, 'Sprint');
  assert.match(turn.prompt, /columns for triage, doing and shipped/);
  assert.match(turn.prompt, /Board/);
});

test('the New popover offers the same cards, compactly', async () => {
  const { page } = await openTemplates();
  await page.locator('#new').click();
  await page.locator('#sheet[data-open="1"] .tgrid[data-compact] .tcard').first().waitFor();
  assert.equal(await page.locator('#sheet .tcard').count(), 8);
  await page.locator('#sheet .tcard[data-id="canvas"]').click();
  await page.locator('#start[data-open="1"]').waitFor();
  assert.equal(await page.locator('#start-title').innerText(), 'Canvas');
});
```

Read the conversation/turn JSON shapes off `test/agent-http.test.js` before
trusting `turn.prompt` / `turn.context.target`; fix the assertions to the real
field names rather than the route's input names if they differ.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/drive-templates.test.js`
Expected: FAIL — no `.tgrid`.

- [ ] **Step 3: Replace the starter CSS** with the card, the two densities and
  the panel. Delete the `.starters`/`.starter`/`.sheet .starter*` rules; write in
  their place, keeping the existing comment style (a rule that needed a decision
  says why):

  - `.tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; padding: 0 1.4rem 2rem; }`
  - `.tgrid[data-compact] { grid-template-columns: 1fr 1fr; gap: .5rem; padding: 0; }`
  - `.tcard` — `border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); overflow: hidden; padding: 0; text-align: left; cursor: pointer;`
    plus `--tint` from `data-accent`, a `translateY(-2px)` + `--shadow-lift` hover,
    and `:focus-visible { outline: 2px solid var(--tint); outline-offset: 2px; }`
  - `.tpeek` — `aspect-ratio: 4 / 3; position: relative; overflow: hidden; background: var(--card); display: grid; place-items: center; color: var(--tint);`
    with the iframe at `width: 500%; height: 500%; transform: scale(.2); transform-origin: top left; border: 0; opacity: 0; transition: opacity var(--t-slow) var(--settle); pointer-events: none;`
    and `.tpeek.marble-is-loaded iframe { opacity: 1 }`, `.tpeek.marble-is-loaded .tglyph { display: none }`
  - `.tpeek` gets a 2% scale-up on `.tcard:hover` — the room is the preview
  - `.tfoot` — `display: flex; align-items: center; gap: .5rem; padding: .55rem .7rem; border-top: 2px solid var(--tint); font-weight: 500;`
    and in `[data-compact]`, `padding: .4rem .5rem; font-size: .82rem;`
  - `.tglyph { color: var(--tint); opacity: .5 }` — the schematic, shown until the
    frame loads and if it never does
  - `#scrim` — `position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,.28); opacity: 0; pointer-events: none; transition: opacity var(--t) var(--settle); backdrop-filter: blur(2px);` and `[data-open="1"] { opacity: 1; pointer-events: auto }`
  - `#start` — `position: fixed; z-index: 41; width: min(46rem, calc(100vw - 2rem)); left/top placed from script; background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow-lift); padding: 1rem; display: grid; grid-template-columns: 17rem 1fr; gap: 1.1rem; transform: scale(.92); opacity: 0; pointer-events: none; transition: transform var(--t) var(--settle), opacity var(--t) var(--settle);`
    `[data-open="1"] { transform: none; opacity: 1; pointer-events: auto }`
  - Below 44rem `#start` collapses to one column and the preview shortens to
    `8rem` — a phone still has to be able to use this.
  - `#start-prompt` — `min-height: 4.5rem; resize: vertical; font: inherit; width: 100%;` with the drive's editable focus ring
  - `#start-ideas button` — a chip: `border: 1px solid var(--line); border-radius: 999px; padding: .25rem .6rem; font-size: .78rem; color: var(--muted); background: var(--paper-2);`
  - `.sheet { width: 23rem }` (was 19rem) and `.sheet p { … }` kept
  - `@media (prefers-reduced-motion: reduce) { #start { transform: none; transition: opacity var(--t) linear } .tcard:hover { transform: none } }`

- [ ] **Step 4: Replace the `#sheet` markup and add the panel**, after the
  existing `#sheet` block

```html
<div class="sheet" id="sheet" data-marble-transient>
  <p>A starter is a document you clone. The copy is yours — including the parts of it you would rather were different.</p>
  <div class="tgrid" id="starters" data-compact></div>
</div>

<!-- Picking a template does not make a document, it opens a brief: what to call
     it, and what you want built in it. Leave the second field alone and this is
     the clone it always was. Transient, all of it — a panel about making a
     document is not part of any document. -->
<div class="scrim" id="scrim" data-marble-transient></div>
<div class="start" id="start" data-marble-transient role="dialog" aria-modal="true" aria-labelledby="start-title">
  <div class="start-shot"><span class="tpeek" id="start-preview"><span class="tglyph"></span></span></div>
  <div class="start-body">
    <h2 id="start-title"></h2>
    <p id="start-blurb"></p>
    <label class="start-label" for="start-name">Name</label>
    <input id="start-name" type="text" autocomplete="off" spellcheck="false">
    <label class="start-label" for="start-prompt">What do you want to build? <span>optional</span></label>
    <textarea id="start-prompt" rows="3"></textarea>
    <div class="start-ideas" id="start-ideas"></div>
    <div class="start-foot">
      <span id="start-where"></span>
      <button type="button" id="start-cancel">Cancel</button>
      <button type="button" id="start-go">Create</button>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Replace `starterButton`/`make` with the card and the panel
  script.** The functions, exactly:

```js
// The schematic each starter falls back to — shown while its frame loads, and
// left standing if it never does. A drawing of the structure, not of the
// category: lines on a page, a grid, columns, notes lying about.
const STARTER_GLYPH = { doc, note, sheet, board, canvas, slides, paper, latex };

function templateCard(starter, { compact = false } = {}) {
  // button.tcard[data-id][data-accent], style.setProperty('--tint', accent),
  // .tpeek + .tglyph + .tfoot(title), aria-label 'Start from the X template'.
  // The frame is mounted by the shared peekObserver: set peek.dataset.src to
  // drive.starterPreviewHref(starter.id) and observe it, so one observer serves
  // the listing and the gallery.
  // click → openStart(starter, card.getBoundingClientRect())
}

async function drawTemplates() {
  // items.replaceChildren(lead, grid) where lead is a transient <p class="tlead">
  // 'Every template is a document you clone. The copy is yours.' and grid is
  // .tgrid of templateCard(starter) in server order.
}

function openStart(starter, from) {
  // fill title/blurb/name/prompt(placeholder=hint)/ideas/where; mount the big
  // preview at scale .34; set #start's transform-origin from `from` relative to
  // the panel's own placed rect, then data-open=1 on #scrim and #start; select
  // the name field's text.
}

function closeStart() { /* drop data-open on both; return focus to the card */ }

const briefFor = (starter, words) =>
  `I just made this document from the “${starter.title}” template in Marble Drive — a fresh clone, so all of it is mine to change.\n\n` +
  `What I want: ${words}\n\n` +
  'Build it in this document. Keep it one file that works on its own, the way the template does.';

async function commitStart() {
  // 1. name = #start-name.value.trim() || starter.title; words = #start-prompt.value.trim()
  // 2. button → 'Creating…', disabled
  // 3. made = await drive.create({ path: [here, name].join('/'), from: starter.id })
  // 4. if (!words) → location.href = made.href
  // 5. else try: settings = await marble.agent.settings();
  //            id = await marble.agent.start({ provider: settings.defaultProvider });
  //            await marble.agent.send(id, { prompt: briefFor(starter, words),
  //              target: made.path, viewing: made.path, selection: [] });
  //            location.href = made.href + '#chat=' + id
  //    catch → say('Made ' + made.path + ' — no agent here to build it') and
  //            location.href = made.href
  // Any failure at step 3 leaves the panel open with the button restored.
}
```

- [ ] **Step 6: Wire the openers and the closers**

  - `#new` keeps its held-reference rect fix; it now fills `#starters` with
    `templateCard(starter, { compact: true })`.
  - The outside-click handler that closes `#sheet` must not close it when the
    click landed inside `#start` (the panel is opened by a card inside the sheet).
  - `#scrim` click and `#start-cancel` close the panel.
  - The existing Escape handler closes `#start` **first** if it is open, before
    the menu and the sheet — innermost layer first.
  - `#start-prompt` `input` → the button label flips between `Create` and
    `Create & build`.
  - `#start-name` `keydown` Enter → `commitStart()`; `#start-prompt` keydown
    `(metaKey||ctrlKey) && Enter` → `commitStart()`.

- [ ] **Step 7: Run the browser test**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/drive-templates.test.js`
Expected: PASS, and the page reports no console errors other than the
pre-existing `Blocked script execution … sandboxed` lines from preview frames.

- [ ] **Step 8: Run the neighbours that load this page**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/drive-pins.test.js test-browser/drive-trash.test.js test-browser/drive-aim.test.js test-browser/drive-days-almanac.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add templates/drive.mrbl test-browser/drive-templates.test.js
git commit -m "A template is a picture of the document, and picking one opens a brief."
```

---

### Task 5: The same change in the live document

**Files:**
- Modify: `drive/drive.mrbl` (gitignored; two separate writes)

- [ ] **Step 1: Confirm the shared regions are byte-identical.** For each snippet
  you are about to replace, assert one match in each file:

```bash
python3 - <<'PY'
import pathlib
live = pathlib.Path('drive/drive.mrbl').read_text()
tmpl = pathlib.Path('templates/drive.mrbl').read_text()
for name, snip in SNIPPETS.items():
    print(name, live.count(snip), tmpl.count(snip))
PY
```

Any count that is not `1` means the region drifted — read both and reconcile by
hand rather than replacing.

- [ ] **Step 2: Write the `<style>` + `<script>` change, alone.** One python
  write that replaces the CSS block and every script region (card, grid, panel,
  handlers) and **nothing addressed**. Use function replacers
  (`s.replace(old, lambda m: new)` / `re.sub` with a function) — a literal
  replacement expands `$&`/`$'` and has silently broken this file's script
  before.

- [ ] **Step 3: Verify it landed**

```bash
tail -3 drive/.marble/drive.history.jsonl
```

Expected: a `pre-external` row and **no** `merge` row. A `merge` row means the
host rebuilt the file from its own DOM and your script is gone — recover from
`drive/.marble/history/drive/<sha>.mrbl.gz` and retry once the open tab's stream
has dropped.

- [ ] **Step 4: Write the markup change, alone** — the `#sheet` grid swap and the
  `#scrim`/`#start` block. Every new addressed element gets a fresh 8-hex
  `data-marble-id`; these are all transient, so in fact none of them takes an id,
  which is why this write is safe.

- [ ] **Step 5: Verify the document**

Run `check_document` on `drive`. Expected: the two pre-existing warnings
(`is-current`, `has-tint`) and nothing new.

- [ ] **Step 6: Drive the live bytes in a browser**

```js
const host = await startDrive({ agents: true, documents: {
  drive: await fsp.readFile('drive/drive.mrbl', 'utf8'), garden: GARDEN } });
```

Click through Templates → a card → Escape, and screenshot the gallery and the
panel in both colour schemes. Expected: eight cards with eight previews, the
panel anchored at the card, no console errors but the sandbox lines.

- [ ] **Step 7: No commit** — `drive/` is gitignored. Note in the summary that
  the live doc was patched.

---

### Task 6: Documentation and the full sweep

**Files:**
- Modify: `docs/GALLERY.md`

- [ ] **Step 1: Document it** — a "What a card shows" section (the preview route,
  the two transforms and why they are free, the accent table, why there is no
  prose on the card) and a "Starting from one" section (the brief, the composed
  prompt, `#chat=`, and that an empty prompt is still just a clone).

- [ ] **Step 2: Run the node suite**

Run: `npm test`
Expected: PASS. `test/agent-http.test.js`'s fork test is known to fail under
machine load — if it does, check `uptime` and rerun that file alone before
believing it.

- [ ] **Step 3: Run the browser suites that touch the Drive and the drawer**

Run: `node --test --test-concurrency=1 --test-reporter=spec test-browser/drive-*.test.js test-browser/drawer.test.js test-browser/callout.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/GALLERY.md
git commit -m "Write down what a template card shows and what briefing one does."
```

---

## Self-review

**Spec coverage.** Preview route → Task 1–2. Accents → Task 1. Card/grids/two
densities → Task 4. Panel, ideas, where-it-lands, dynamic button, keys, motion →
Task 4. Create with and without a brief, the composed prompt, the failure path →
Task 4. `#chat=` → Task 3. Live doc → Task 5. Docs and the sweep → Task 6. No
section of the spec is unimplemented.

**Placeholders.** The document-script steps carry signatures and behaviour rather
than 400 lines of finished CSS and JS; every name the tests touch is fixed here,
which is what a later task needs from an earlier one. No "TBD", no "handle errors
appropriately" — the failure path is spelled out in Task 4 step 5.

**Type consistency.** `preview(id)` (Task 1) is imported as `starterPreview`
(Task 2) and reached as `starterPreviewHref` (Task 2, runtime) — checked.
`list()` gains `hint`/`ideas`, consumed by `openStart` (Task 4) — checked.
`marble.agent.send(id, { prompt, target, viewing, selection })` matches
`runtime/agent.js` — checked. `.tcard[data-id]`/`#start-*` ids are the same in the
test (Task 4 step 1) and the markup (step 4) — checked.
