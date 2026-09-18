# Fast GenUI — Authored Spaces, Jev Decisions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Marble document an *app space* — every design decision an attribute with its options already implemented — and let Jev position within it in one TypeSafe round trip that the host writes to the file, with no LLM in the path.

**Architecture:** `server/genui/` is five small modules: `atlas.js` indexes Space₀ (slug ↔ gloss, `specializes`), `space.js` extracts and validates an app space from a document, `questions.js` turns it into one TypeSafe request, `decide.js` turns answers into gated `setAttr` ops and exposes one `decideDocument()` that the HTTP route and the CLI both call. The route writes through the Drive's existing `writeOps`, so open pages move. Stage A (authoring) is a skill for the existing Claude agent, not new server code.

**Tech Stack:** Node 22 ESM, `node:test`, parse5 trees via `parseSource` from `server/engine.js`, TypeSafe HTTP via `server/typesafe/client.js`, Playwright via `test-browser/harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-18-genui-authored-spaces-design.md`

## Global Constraints

- All work on branch `genui-authored-spaces` (Task 0). Never commit to `main`: another live session has `agents-ui-overhaul` waiting to fast-forward into it.
- `server/app.js` is shared with that session. Its two hunks (Task 5) are the only edits to it; run `ListAgents` before touching it and keep the hunks to the lines named.
- Slug rule, verbatim from the spec: lowercase; every run of characters outside `[a-z0-9]` becomes one `-`; leading and trailing `-` trimmed.
- Key rule: Atlas sub-dimension key in kebab case is the attribute name (`openIn` → `data-open-in`); the declaration is `data-genui-open-in`.
- No `no_match` criterion. Low confidence keeps the authored default. `stop` defaults to `0.75`.
- Stage B imports nothing from `server/typesafe/llm.js`. Test asserts it.
- Unit tests: `npm test` (`node --test "test/**/*.test.js"`). Browser tests: `npm run test:browser`. Fakes only; no network, no real key.
- `drive/` is gitignored. Anything that must be tracked lives under `test/fixtures/genui/` and is *copied* into the drive.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 0: Branch and commit the spec

**Files:**
- Commit: `docs/superpowers/specs/2026-09-18-genui-authored-spaces-design.md`

- [ ] **Step 1: Confirm the working tree state and that no other session is on `app.js`**

Run: `git status --short | head -20` and, in the session, `ListAgents`.
Expected: the pre-existing agents-usage-history modifications are listed; they are not yours and stay untouched. If a listed peer says it is editing `server/app.js`, wait for it before Task 5.

- [ ] **Step 2: Create the branch from `main` without touching the dirty files**

```bash
git switch -c genui-authored-spaces
```

Expected: `Switched to a new branch 'genui-authored-spaces'`. The other session's uncommitted changes come along as uncommitted; do not stage them.

- [ ] **Step 3: Commit only the spec**

```bash
git add docs/superpowers/specs/2026-09-18-genui-authored-spaces-design.md docs/superpowers/plans/2026-09-18-genui-authored-spaces.md
git commit -m "Spec and plan: fast GenUI — authored spaces, Jev decisions.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Atlas index — slugs, keys, and `specializes`

**Files:**
- Create: `server/genui/atlas.js`
- Create: `test/fixtures/genui/atlas.mini.json`
- Test: `test/genui-atlas.test.js`

**Interfaces:**
- Produces: `slug(name) → string`, `kebab(key) → string`, `camel(attr) → string`, `indexAtlas(json) → AtlasIndex`, `loadAtlas(file) → Promise<AtlasIndex>`.
- `AtlasIndex = { has(id): boolean, entry(id): Entry|null, sub(id, key): { entry, dim, sub, vars: Map<slug, { name, gloss }> } | null }`. `sub()` resolves through `relations.specializes`, nearest entry first.

- [ ] **Step 1: Cut the mini Atlas out of the real one**

The tests must run against the codebook's own keys and glosses, not a hand-typed imitation, and `drive/` is gitignored — so a script cuts the entries the three fixtures use out of `atlas.json` and the cut is committed. `tools/genui-mini-atlas.mjs`:

```js
#!/usr/bin/env node
// Cut the entries the genui fixtures use out of the real Atlas, so the tests
// run on the codebook's own keys and glosses. Re-run after an Atlas rebuild:
//   node tools/genui-mini-atlas.mjs [path/to/atlas.json]
import fsp from 'node:fs/promises';
import path from 'node:path';

const IDS = ['overview-detail', 'card', 'inbox', 'dashboard', 'stat-tile', 'chart', 'wizard', 'form', 'stepper'];
const from = process.argv[2] ?? path.join(process.cwd(), 'drive', 'Research', 'Design Pattern Generation', 'atlas.json');
const to = path.join(process.cwd(), 'test', 'fixtures', 'genui', 'atlas.mini.json');

const atlas = JSON.parse(await fsp.readFile(from, 'utf8'));
const entries = IDS.map((id) => {
  const e = atlas.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no entry "${id}" in ${from}`);
  return {
    id: e.id, name: e.name, level: e.level, archetype: e.archetype ?? null, def: e.def,
    relations: { uses: e.relations?.uses ?? [], specializes: e.relations?.specializes ?? [], neighbors: [] },
    dims: (e.dims ?? []).map((d) => ({
      name: d.name, q: d.q,
      subs: (d.subs ?? []).map((s) => ({ name: s.name, key: s.key, sel: s.sel, vars: (s.vars ?? []).map((v) => [v[0], v[1] ?? '', '']) })),
    })),
  };
});
await fsp.mkdir(path.dirname(to), { recursive: true });
await fsp.writeFile(to, `${JSON.stringify({ about: `Mini atlas for genui tests, cut from atlas.json (${atlas.generatedAt ?? 'unknown build'}). Regenerate with tools/genui-mini-atlas.mjs.`, entries }, null, 1)}\n`);
console.log(`${entries.length} entries → ${path.relative(process.cwd(), to)}`);
```

Run: `node tools/genui-mini-atlas.mjs`
Expected: `9 entries → test/fixtures/genui/atlas.mini.json`. The shape below is what it produces (abbreviated; real glosses come from the Atlas):

```json
{
  "about": "Mini atlas for genui tests, cut from atlas.json (…)",
  "entries": [
    {
      "id": "overview-detail",
      "name": "Overview–detail",
      "level": "pattern",
      "def": "An overview of many items, each shown through a few key attributes, paired with a detail view that shows many or all attributes of a selected item.",
      "relations": { "uses": ["card"], "specializes": ["browse-collections"], "neighbors": [] },
      "dims": [
        {
          "name": "Content",
          "q": "Is information shown in the overview, the detail view or both, and how are overview attributes abstracted from detail attributes?",
          "subs": [
            { "name": "Attribute is shown…", "key": "attributePlacement", "sel": "many",
              "vars": [["In overview only", "An attribute that exists only as an overview representation", ""],
                       ["In detail view only", "Present only once the item is opened", ""],
                       ["In both views", "Repeated in overview and detail, interactive elements included", ""]] },
            { "name": "Long text in the overview", "key": "truncation", "sel": "one",
              "vars": [["Ellipsis", "Cut with an ellipsis", ""], ["Fade-out gradient", "Faded at the edge", ""], ["Full text", "Never cut", ""]] }
          ]
        },
        {
          "name": "Layout",
          "q": "How are overviews and detail views arranged, how are items organized, and how many details are open?",
          "subs": [
            { "name": "Overview–detail arrangement", "key": "openIn", "sel": "one",
              "vars": [["Side-by-side", "Detail opens next to the overview", ""],
                       ["New page", "Detail replaces the screen", ""],
                       ["Pop-up", "Detail opens in a modal over the overview", ""],
                       ["Popover", "Detail opens anchored to the item", ""]] },
            { "name": "Overview layout", "key": "overviewType", "sel": "many",
              "vars": [["List", "One item per row", ""], ["Grid", "Items in a grid of cards", ""], ["Table", "Items as rows of columns", ""]] },
            { "name": "Details open at once", "key": "detailMultiplicity", "sel": "one",
              "vars": [["One at a time", "Opening a detail closes the last", ""], ["Many at a time", "Several details stay open", ""]] }
          ]
        },
        {
          "name": "Invocation",
          "q": "What opens a detail view, from which part of the item, and how does a person get back?",
          "subs": [
            { "name": "Opened from", "key": "openFrom", "sel": "one",
              "vars": [["Whole item", "Anywhere on the item", ""], ["Specific attribute", "Only a named attribute opens it", ""]] }
          ]
        }
      ]
    },
    {
      "id": "card",
      "name": "Card",
      "level": "component",
      "def": "A bounded container that summarizes one item; the most common item view inside overviews.",
      "relations": { "uses": [], "specializes": [], "neighbors": [] },
      "dims": [
        { "name": "Card content", "q": "What goes on the card?",
          "subs": [
            { "name": "Media", "key": "media", "sel": "one",
              "vars": [["None", "No image", ""], ["Top image", "Image above the text", ""], ["Side thumbnail", "Small image beside the text", ""]] },
            { "name": "Actions", "key": "actions", "sel": "one",
              "vars": [["None", "No actions on the card", ""], ["One primary action", "A single button", ""], ["Action row", "Several buttons", ""]] }
          ] },
        { "name": "Form", "q": "What shape and weight does the card take?",
          "subs": [
            { "name": "Shape", "key": "shape", "sel": "one",
              "vars": [["Vertical", "Taller than wide", ""], ["Horizontal", "Wider than tall", ""], ["Compact tile", "Small and square", ""]] }
          ] },
        { "name": "Target", "q": "Which part of the card opens the item?",
          "subs": [
            { "name": "Target", "key": "target", "sel": "one",
              "vars": [["Whole card", "The whole card is the link", ""], ["Title only", "Only the title is the link", ""]] }
          ] }
      ]
    },
    {
      "id": "inbox",
      "name": "Inbox",
      "level": "pattern",
      "def": "A list of messages with a reading pane.",
      "relations": { "uses": [], "specializes": ["overview-detail"], "neighbors": [] },
      "dims": [
        { "name": "Triage", "q": "How are messages sorted out of the way?",
          "subs": [
            { "name": "Archive gesture", "key": "archiveBy", "sel": "one",
              "vars": [["Swipe", "Swipe to archive", ""], ["Button", "An archive button", ""]] }
          ] }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`test/genui-atlas.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { camel, indexAtlas, kebab, loadAtlas, slug } from '../server/genui/atlas.js';

const MINI = new URL('./fixtures/genui/atlas.mini.json', import.meta.url);

test('slug lowercases and collapses every non-alphanumeric run to one dash', () => {
  assert.equal(slug('Side-by-side'), 'side-by-side');
  assert.equal(slug('Sum or average'), 'sum-or-average');
  assert.equal(slug('Picture-in-picture'), 'picture-in-picture');
  assert.equal(slug('  One at a time!  '), 'one-at-a-time');
  assert.equal(slug('Overview–detail'), 'overview-detail');
});

test('kebab and camel are inverses on Atlas keys', () => {
  assert.equal(kebab('openIn'), 'open-in');
  assert.equal(kebab('detailMultiplicity'), 'detail-multiplicity');
  assert.equal(kebab('media'), 'media');
  assert.equal(camel('open-in'), 'openIn');
  assert.equal(camel('detail-multiplicity'), 'detailMultiplicity');
  for (const key of ['openIn', 'attributePlacement', 'overviewType', 'shape']) assert.equal(camel(kebab(key)), key);
});

test('sub() finds a sub-dimension on its own entry and maps variations by slug with the Atlas gloss', async () => {
  const atlas = await loadAtlas(MINI);
  const hit = atlas.sub('overview-detail', 'openIn');
  assert.ok(hit);
  assert.equal(hit.entry.id, 'overview-detail');
  assert.equal(hit.dim.name, 'Layout');
  assert.equal(hit.sub.name, 'Overview–detail arrangement');
  assert.equal(hit.vars.get('pop-up').name, 'Pop-up');
  assert.ok(hit.vars.get('pop-up').gloss.length > 0, 'the codebook gloss comes along');
  assert.equal(hit.vars.get('side-by-side').name, 'Side-by-side');
});

test('sub() resolves through specializes, nearest entry first, on real chains', async () => {
  const atlas = await loadAtlas(MINI);
  // inbox has its own openIn; it shadows overview-detail's.
  assert.equal(atlas.sub('inbox', 'openIn').entry.id, 'inbox');
  // inbox has no truncation; overview-detail does.
  assert.equal(atlas.sub('inbox', 'truncation').entry.id, 'overview-detail');
  // wizard specializes form: labels is form's.
  assert.equal(atlas.sub('wizard', 'labels').entry.id, 'form');
  assert.equal(atlas.sub('wizard', 'progress').entry.id, 'wizard');
  assert.equal(atlas.sub('inbox', 'nope'), null);
  assert.equal(atlas.sub('missing', 'openIn'), null);
});

test('has() and entry()', async () => {
  const atlas = await loadAtlas(MINI);
  assert.equal(atlas.has('card'), true);
  assert.equal(atlas.has('carousel'), false);
  assert.equal(atlas.entry('card').name, 'Card');
  assert.equal(atlas.entry('carousel'), null);
});

test('indexAtlas tolerates an entry with no dims and a cycle in specializes', () => {
  const atlas = indexAtlas({
    entries: [
      { id: 'a', name: 'A', relations: { specializes: ['b'] } },
      { id: 'b', name: 'B', relations: { specializes: ['a'] }, dims: [{ name: 'D', q: 'Q?', subs: [{ name: 'S', key: 'k', sel: 'one', vars: [['X', 'x', '']] }] }] },
    ],
  });
  assert.equal(atlas.sub('a', 'k').entry.id, 'b');
  assert.equal(atlas.sub('b', 'k').entry.id, 'b');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/genui-atlas.test.js`
Expected: FAIL — `Cannot find module '../server/genui/atlas.js'`.

- [ ] **Step 4: Write `server/genui/atlas.js`**

```js
// Space₀, indexed. The Atlas is read-only to this work: entries by id,
// sub-dimensions by key (resolved through `specializes`), and every variation
// name slugified once so a document's attribute values and the codebook agree
// on spelling without either copying the other.

import fsp from 'node:fs/promises';

export const slug = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const kebab = (key) => String(key ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export const camel = (attr) => String(attr ?? '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

export function indexAtlas(atlas) {
  const entries = new Map();
  for (const entry of atlas?.entries ?? []) if (entry?.id) entries.set(entry.id, entry);

  const own = new Map();
  const subsOf = (id) => {
    if (own.has(id)) return own.get(id);
    const out = new Map();
    const entry = entries.get(id);
    for (const dim of entry?.dims ?? []) {
      for (const sub of dim?.subs ?? []) {
        if (!sub?.key || out.has(sub.key)) continue;
        const vars = new Map();
        for (const v of sub.vars ?? []) {
          const name = Array.isArray(v) ? v[0] : v?.name;
          const gloss = Array.isArray(v) ? v[1] : v?.gloss;
          if (name) vars.set(slug(name), { name: String(name), gloss: String(gloss ?? '') });
        }
        out.set(sub.key, { entry, dim, sub, vars });
      }
    }
    own.set(id, out);
    return out;
  };

  const resolve = (id, key, seen = new Set()) => {
    if (!entries.has(id) || seen.has(id)) return null;
    seen.add(id);
    const hit = subsOf(id).get(key);
    if (hit) return hit;
    for (const parent of entries.get(id).relations?.specializes ?? []) {
      const inherited = resolve(parent, key, seen);
      if (inherited) return inherited;
    }
    return null;
  };

  return {
    has: (id) => entries.has(id),
    entry: (id) => entries.get(id) ?? null,
    sub: (id, key) => resolve(id, key),
  };
}

export async function loadAtlas(file) {
  return indexAtlas(JSON.parse(await fsp.readFile(file, 'utf8')));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/genui-atlas.test.js`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add server/genui/atlas.js test/genui-atlas.test.js test/fixtures/genui/atlas.mini.json tools/genui-mini-atlas.mjs
git commit -m "genui: index the Atlas — slugs, kebab keys, specializes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The app-space contract — extract and validate, with the 49ers fixture

**Files:**
- Create: `server/genui/space.js`
- Create: `test/fixtures/genui/49ers.mrbl`
- Test: `test/genui-space.test.js`

**Interfaces:**
- Consumes: `slug`, `kebab`, `camel`, `AtlasIndex` from Task 1; `parseSource` from `server/engine.js` (a parse5 tree with `sourceCodeLocationInfo`).
- Produces:
  - `extractSpace(source) → Space` where `Space = { request: string|null, instances: Instance[] }`, `Instance = { name, marbleId, pattern, about, parent, decisions: Decision[] }`, `Decision = { key, attr, current, options: { slug, gloss: string|null }[] }`. `attr` is the fact attribute name, e.g. `data-open-in`.
  - `validateSpace(source, atlas) → { ok: boolean, issues: { instance: string|null, key: string|null, kind, message }[] }`. `kind` ∈ `no-instances | bad-root | missing-marble-id | duplicate-instance | unknown-pattern | unknown-key | too-few-options | missing-gloss | unimplemented-option | current-not-declared`.
  - `parseDeclaration(value) → { slug, gloss }[]`.

- [ ] **Step 1: Write the 49ers fixture**

`test/fixtures/genui/49ers.mrbl`. Eight decisions: four on the overview–detail instance, four on the card. Every option is implemented; one decision (`attribute-placement`) uses authored presets and so carries glosses. Static data for six games (enough to see a grid vs a list). It works with no host.

```html
<!doctype html>
<html lang="en" data-marble="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>49ers</title>
<style data-marble-id="css">
:root { --ink: #191d21; --muted: #5a656f; --line: #e4e6e8; --paper: #fbfaf8; --card: #fff; --accent: #aa0000; --gold: #b3995d; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; padding: 24px; }
h1 { font: 600 24px/1.2 ui-serif, Georgia, serif; margin: 0 0 4px; }
.lede { color: var(--muted); margin: 0 0 18px; }
h2, h3, p { margin: 0; }

/* ---- overview–detail#games: the facts live on the section, the CSS reads them ---- */
#games { position: relative; display: grid; gap: 16px; }
#games[data-open-in="side-by-side"] { grid-template-columns: 1.4fr 1fr; }
#games[data-open-in="side-by-side"] .detail { position: sticky; top: 16px; align-self: start; }
#games[data-open-in="pop-up"] .detail { position: fixed; inset: 10% 20%; z-index: 10; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
#games[data-open-in="pop-up"]::before { content: ""; position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 9; }
#games[data-open-in="new-page"] .overview { display: none; }
#games[data-open-in="new-page"] .detail { max-width: 640px; }
#games[data-open-in="new-page"] .back { display: inline-block; }
.back { display: none; margin-bottom: 10px; color: var(--accent); }

.overview { display: grid; gap: 10px; }
#games[data-overview-type="grid"] .overview { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
#games[data-overview-type="list"] .overview { grid-template-columns: 1fr; }
#games[data-overview-type="table"] .overview { grid-template-columns: 1fr; gap: 0; }
#games[data-overview-type="table"] .card { border-radius: 0; border-bottom: 0; }
#games[data-overview-type="table"] .card:last-child { border-bottom: 1px solid var(--line); }

#games[data-detail-multiplicity="one-at-a-time"] .detail + .detail { display: none; }
#games[data-detail-multiplicity="many-at-a-time"] .detail + .detail { display: block; }

#games[data-attribute-placement="identity"] .card .record { display: none; }
#games[data-attribute-placement="identity"] .card .venue { display: none; }
#games[data-attribute-placement="identity-record"] .card .venue { display: none; }
#games[data-attribute-placement="everything"] .card .record,
#games[data-attribute-placement="everything"] .card .venue { display: block; }

/* ---- card#game-card: its own facts, on the template card and every stamped copy ---- */
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: grid; gap: 4px; }
.card[data-shape="vertical"] { grid-template-columns: 1fr; }
.card[data-shape="horizontal"] { grid-template-columns: auto 1fr; align-items: center; column-gap: 12px; }
.card[data-shape="compact-tile"] { padding: 8px 10px; font-size: 13px; }
.card[data-media="none"] .logo { display: none; }
.card[data-media="side-thumbnail"] .logo { display: block; width: 36px; height: 36px; border-radius: 6px; background: var(--gold); }
.card[data-actions="none"] .act { display: none; }
.card[data-actions="one-primary-action"] .act { display: inline-block; margin-top: 6px; color: var(--accent); }
.card[data-target="whole-card"] { cursor: pointer; }
.card[data-target="title-only"] .title { cursor: pointer; text-decoration: underline; }
.title { font-weight: 600; }
.when, .record, .venue { color: var(--muted); font-size: 13px; }

.detail { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; }
.detail h3 { font-size: 18px; margin-bottom: 8px; }
.detail dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 10px; font-size: 14px; }
.detail dt { color: var(--muted); }
.detail dd { margin: 0; }
@media (max-width: 720px) { #games[data-open-in="side-by-side"] { grid-template-columns: 1fr; } }
</style>
</head>
<body data-marble-id="body" data-genui-request="Create a UI widget that shows San Francisco 49ers games — upcoming and recent — and how the 49ers are doing against each opponent.">
<h1 data-marble-id="h1">49ers</h1>
<p class="lede" data-marble-id="lede">Upcoming and recent games, and the series record against each opponent.</p>

<section id="games" data-marble-id="games"
  data-genui="overview-detail#games"
  data-genui-about="Upcoming and recent 49ers games; opening one shows the full box and the series record against that opponent"
  data-open-in="side-by-side"
  data-genui-open-in="side-by-side | pop-up | new-page"
  data-overview-type="grid"
  data-genui-overview-type="grid | list | table"
  data-detail-multiplicity="one-at-a-time"
  data-genui-detail-multiplicity="one-at-a-time | many-at-a-time"
  data-attribute-placement="identity-record"
  data-genui-attribute-placement="identity: opponent and date only on the card | identity-record: opponent, date, and the series record on the card | everything: opponent, date, series record, and venue on the card">

  <div class="overview" data-marble-id="overview">
    <article class="card" data-marble-id="g1" data-genui="card#game-card"
      data-genui-about="One game: opponent, date, series record, venue"
      data-shape="vertical" data-genui-shape="vertical | horizontal | compact-tile"
      data-media="side-thumbnail" data-genui-media="none | side-thumbnail"
      data-actions="none" data-genui-actions="none | one-primary-action"
      data-target="whole-card" data-genui-target="whole-card | title-only">
      <span class="logo" data-marble-id="g1l"></span>
      <div data-marble-id="g1b">
        <p class="title" data-marble-id="g1t">vs Seahawks</p>
        <p class="when" data-marble-id="g1w">Sun Sep 21 · 1:25 PM</p>
        <p class="record" data-marble-id="g1r">Series 3–1 last four</p>
        <p class="venue" data-marble-id="g1v">Levi's Stadium</p>
        <a class="act" data-marble-id="g1a" href="#">Tickets</a>
      </div>
    </article>
    <article class="card" data-marble-id="g2" data-shape="vertical" data-media="side-thumbnail" data-actions="none" data-target="whole-card">
      <span class="logo" data-marble-id="g2l"></span>
      <div data-marble-id="g2b">
        <p class="title" data-marble-id="g2t">at Rams</p>
        <p class="when" data-marble-id="g2w">Thu Sep 25 · 5:15 PM</p>
        <p class="record" data-marble-id="g2r">Series 2–2 last four</p>
        <p class="venue" data-marble-id="g2v">SoFi Stadium</p>
        <a class="act" data-marble-id="g2a" href="#">Tickets</a>
      </div>
    </article>
    <article class="card" data-marble-id="g3" data-shape="vertical" data-media="side-thumbnail" data-actions="none" data-target="whole-card">
      <span class="logo" data-marble-id="g3l"></span>
      <div data-marble-id="g3b">
        <p class="title" data-marble-id="g3t">vs Cardinals</p>
        <p class="when" data-marble-id="g3w">Sun Oct 5 · 1:05 PM</p>
        <p class="record" data-marble-id="g3r">Series 4–0 last four</p>
        <p class="venue" data-marble-id="g3v">Levi's Stadium</p>
        <a class="act" data-marble-id="g3a" href="#">Tickets</a>
      </div>
    </article>
    <article class="card" data-marble-id="g4" data-shape="vertical" data-media="side-thumbnail" data-actions="none" data-target="whole-card">
      <span class="logo" data-marble-id="g4l"></span>
      <div data-marble-id="g4b">
        <p class="title" data-marble-id="g4t">W 27–17 vs Saints</p>
        <p class="when" data-marble-id="g4w">Sun Sep 14</p>
        <p class="record" data-marble-id="g4r">Series 3–1 last four</p>
        <p class="venue" data-marble-id="g4v">Levi's Stadium</p>
        <a class="act" data-marble-id="g4a" href="#">Recap</a>
      </div>
    </article>
    <article class="card" data-marble-id="g5" data-shape="vertical" data-media="side-thumbnail" data-actions="none" data-target="whole-card">
      <span class="logo" data-marble-id="g5l"></span>
      <div data-marble-id="g5b">
        <p class="title" data-marble-id="g5t">L 20–24 at Vikings</p>
        <p class="when" data-marble-id="g5w">Sun Sep 7</p>
        <p class="record" data-marble-id="g5r">Series 1–3 last four</p>
        <p class="venue" data-marble-id="g5v">U.S. Bank Stadium</p>
        <a class="act" data-marble-id="g5a" href="#">Recap</a>
      </div>
    </article>
    <article class="card" data-marble-id="g6" data-shape="vertical" data-media="side-thumbnail" data-actions="none" data-target="whole-card">
      <span class="logo" data-marble-id="g6l"></span>
      <div data-marble-id="g6b">
        <p class="title" data-marble-id="g6t">W 31–13 vs Jets</p>
        <p class="when" data-marble-id="g6w">Mon Sep 1</p>
        <p class="record" data-marble-id="g6r">Series 2–2 last four</p>
        <p class="venue" data-marble-id="g6v">Levi's Stadium</p>
        <a class="act" data-marble-id="g6a" href="#">Recap</a>
      </div>
    </article>
  </div>

  <aside class="detail" data-marble-id="detail">
    <a class="back" data-marble-id="back" href="#">← All games</a>
    <h3 data-marble-id="dt">vs Seahawks</h3>
    <dl data-marble-id="dl">
      <dt data-marble-id="d1k">When</dt><dd data-marble-id="d1v">Sun Sep 21 · 1:25 PM</dd>
      <dt data-marble-id="d2k">Where</dt><dd data-marble-id="d2v">Levi's Stadium</dd>
      <dt data-marble-id="d3k">Series</dt><dd data-marble-id="d3v">49ers 3–1 in the last four; 49ers won the last meeting 24–20</dd>
      <dt data-marble-id="d4k">Line</dt><dd data-marble-id="d4v">49ers −3.5</dd>
    </dl>
  </aside>
</section>
</body>
</html>
```

Note the card facts are repeated on every stamped card (`g2`–`g6`) so the CSS applies to each, but only `g1` is the **instance root** (`data-genui="card#game-card"`). A decide writes `g1`'s attributes; the plan's Task 8 inspector and any later stamping keep siblings in step. For this plan, the browser test asserts on `g1`.

- [ ] **Step 1b: Write the two fixtures that are not overview–detail**

Same file shape as `49ers.mrbl` (a `<style data-marble-id="css">`, a body with `data-genui-request`, every element with a `data-marble-id`, every option implemented by a `[data-<key>="<slug>"]` rule). What differs is the contract-bearing markup, given exactly here; the CSS for each option is one rule per line under the root, and sample content is static.

`test/fixtures/genui/metrics.mrbl` — `data-genui-request="A dashboard for the on-call engineer: error rate, p95 latency, open incidents, and the last 24 hours of traffic."`:

```html
<section id="ops" data-marble-id="ops"
  data-genui="dashboard#ops"
  data-genui-about="Four operational numbers and one traffic chart for whoever is on call"
  data-arrangement="fixed-grid"
  data-genui-arrangement="fixed-grid | single-scrolling-column | story-layout"
  data-density="a-few-glanceable-tiles"
  data-genui-density="a-few-glanceable-tiles | dense-wall"
  data-alerting="threshold-colours"
  data-genui-alerting="none | threshold-colours | alerts-on-panels"
  data-linking="independent"
  data-genui-linking="independent | global-filters">

  <div class="tiles" data-marble-id="tiles">
    <article class="tile" data-marble-id="k1" data-genui="stat-tile#kpi"
      data-genui-about="One number with its label; error rate, p95, incidents, requests"
      data-encoding="signed-change-with-arrow" data-genui-encoding="number-only | signed-change-with-arrow | sparkline"
      data-drill="none" data-genui-drill="none | open-a-detail-chart | breakdown-on-hover">
      … label, value, delta, a tiny sparkline <svg data-marble-id="k1s">, a hidden breakdown …
    </article>
    … k2, k3, k4 with the same facts, no data-genui …
  </div>

  <figure class="chart" data-marble-id="trend" data-genui="chart#trend"
    data-genui-about="Requests per minute over the last 24 hours"
    data-mark-type="lines" data-genui-mark-type="bars | lines | areas"
    data-faceting="single-plot" data-genui-faceting="single-plot | small-multiples"
    data-adaptation="fixed-desktop-chart" data-genui-adaptation="fixed-desktop-chart | reflow-for-narrow-screens | aggregate-when-dense">
    <svg data-marble-id="trend-svg" viewBox="0 0 600 160">…one path for lines, rects for bars, a filled path for areas; the CSS shows one set…</svg>
  </figure>
</section>
```

Rules the CSS must carry (one per option): `#ops[data-arrangement="fixed-grid"] .tiles { grid-template-columns: repeat(4, 1fr) }`, `…="single-scrolling-column" .tiles { grid-template-columns: 1fr }`, `…="story-layout" .tiles { grid-template-columns: 1fr 1fr } #ops[data-arrangement="story-layout"] .chart { order: -1 }`; `[data-density="dense-wall"] .tile { padding: 6px 8px; font-size: 12px }`; `[data-alerting="none"] .tile.over { border-color: var(--line) }`, `[data-alerting="threshold-colours"] .tile.over { border-color: #d03b3b }`, `[data-alerting="alerts-on-panels"] .tile.over::after { content: "alert" }`; `[data-linking="global-filters"] .filters { display: flex }`, `[data-linking="independent"] .filters { display: none }`; the tile rules for `encoding` (`number-only` hides `.delta` and `.spark`; `signed-change-with-arrow` shows `.delta`; `sparkline` shows `.spark`) and `drill` (`open-a-detail-chart` makes the tile a link; `breakdown-on-hover` shows `.breakdown` on hover; `none` neither); the chart rules for `mark-type` (show `.line`, `.bars`, or `.area`), `faceting` (`small-multiples` splits the svg into two by `.facet`), and `adaptation` (`reflow-for-narrow-screens` sets a `max-width` media rule; `aggregate-when-dense` shows the hourly `.agg` path instead of the minute one).

`test/fixtures/genui/signup.mrbl` — `data-genui-request="A sign-up flow for a team workspace: account, workspace name, invite teammates, plan."`:

```html
<section id="signup" data-marble-id="signup"
  data-genui="wizard#signup"
  data-genui-about="Four steps: account, workspace, teammates, plan; branching is off"
  data-progress="stepper-with-titles"
  data-genui-progress="none | stepper-with-titles | percentage-bar"
  data-density="one-thing-per-page"
  data-genui-density="one-thing-per-page | grouped-questions"
  data-presentation="full-page"
  data-genui-presentation="full-page | modal | inline-accordion"
  data-review="summary-page-with-change-links"
  data-genui-review="no-review | summary-page-with-change-links"
  data-labels="top-aligned"
  data-genui-labels="top-aligned | left-aligned | floating-label">

  <nav class="steps" data-marble-id="steps" data-genui="stepper#steps"
    data-genui-about="The four step names, current one marked"
    data-form="horizontal" data-genui-form="horizontal | vertical-with-content | compact-count"
    data-labels="titles" data-genui-labels="numbers-only | titles | titles-with-entered-values">
    <ol data-marble-id="steps-list">… four <li>, each with a number, a title, an entered value …</ol>
  </nav>
  <form class="step" data-marble-id="step-1">… labelled fields …</form>
  <aside class="review" data-marble-id="review">… a summary list with change links …</aside>
</section>
```

`labels` on the wizard root is **form's** sub-dimension reached through `specializes` — that is the point of this fixture. Note the stepper also has a `labels` key of its own (an Atlas coincidence): they live on different roots, so there is no collision. Rules: `progress` (`none` hides `.steps`; `percentage-bar` shows `.bar` and hides the titles); `density` (`grouped-questions` shows every `.step`); `presentation` (`modal` fixes the section over a backdrop; `inline-accordion` collapses non-current steps to their heading); `review` (`no-review` hides `.review`); `labels` on the wizard (`left-aligned` two-column labels; `floating-label` absolute labels inside the field); stepper `form` and `labels` on the `.steps` root.

- [ ] **Step 1c: Add the two fixtures to the validation test**

Append to `test/genui-space.test.js` (after `validateSpace passes the fixture`):

```js
for (const name of ['metrics', 'signup']) {
  test(`validateSpace passes the ${name} fixture — Stage B is not overview–detail-specific`, async () => {
    const source = await fsp.readFile(new URL(`./fixtures/genui/${name}.mrbl`, import.meta.url), 'utf8');
    const result = validateSpace(source, atlas);
    assert.deepEqual(result.issues, []);
    const space = extractSpace(source);
    assert.ok(space.instances.length >= 2);
  });
}

test('signup: labels on the wizard resolves to form through specializes, and the stepper has its own labels', async () => {
  const source = await fsp.readFile(new URL('./fixtures/genui/signup.mrbl', import.meta.url), 'utf8');
  const space = extractSpace(source);
  const wizard = space.instances.find((i) => i.name === 'signup');
  const stepper = space.instances.find((i) => i.name === 'steps');
  assert.ok(wizard.decisions.some((d) => d.key === 'labels'));
  assert.ok(stepper.decisions.some((d) => d.key === 'labels'));
  assert.equal(atlas.sub('wizard', 'labels').entry.id, 'form');
  assert.equal(atlas.sub('stepper', 'labels').entry.id, 'stepper');
});
```

- [ ] **Step 2: Write the failing tests**

`test/genui-space.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { loadAtlas } from '../server/genui/atlas.js';
import { extractSpace, parseDeclaration, validateSpace } from '../server/genui/space.js';

const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const atlas = await loadAtlas(new URL('./fixtures/genui/atlas.mini.json', import.meta.url));

const doc = (body, style = '') => `<!doctype html><html><head><style>${style}</style></head><body data-marble-id="b">${body}</body></html>`;

test('parseDeclaration splits on | and reads an optional gloss after the first colon', () => {
  assert.deepEqual(parseDeclaration('grid | list | table'), [
    { slug: 'grid', gloss: null }, { slug: 'list', gloss: null }, { slug: 'table', gloss: null },
  ]);
  assert.deepEqual(parseDeclaration('identity: names only | full: everything, incl: colons'), [
    { slug: 'identity', gloss: 'names only' }, { slug: 'full', gloss: 'everything, incl: colons' },
  ]);
  assert.deepEqual(parseDeclaration(' Pop-Up |  '), [{ slug: 'pop-up', gloss: null }]);
});

test('extractSpace reads the request, both instances, their facts, options and nesting', () => {
  const space = extractSpace(FIXTURE);
  assert.match(space.request, /49ers games/);
  assert.equal(space.instances.length, 2);

  const [games, card] = space.instances;
  assert.equal(games.name, 'games');
  assert.equal(games.marbleId, 'games');
  assert.equal(games.pattern, 'overview-detail');
  assert.equal(games.parent, null);
  assert.match(games.about, /^Upcoming and recent/);
  assert.deepEqual(games.decisions.map((d) => d.key), ['openIn', 'overviewType', 'detailMultiplicity', 'attributePlacement']);
  const openIn = games.decisions[0];
  assert.equal(openIn.attr, 'data-open-in');
  assert.equal(openIn.current, 'side-by-side');
  assert.deepEqual(openIn.options.map((o) => o.slug), ['side-by-side', 'pop-up', 'new-page']);
  assert.equal(openIn.options[0].gloss, null);
  const placement = games.decisions[3];
  assert.equal(placement.options[1].slug, 'identity-record');
  assert.equal(placement.options[1].gloss, 'opponent, date, and the series record on the card');

  assert.equal(card.name, 'game-card');
  assert.equal(card.marbleId, 'g1');
  assert.equal(card.pattern, 'card');
  assert.equal(card.parent, 'games');
  assert.deepEqual(card.decisions.map((d) => d.key), ['shape', 'media', 'actions', 'target']);
});

test('extractSpace: a document with no instance roots is an empty space with no request', () => {
  const space = extractSpace(doc('<p data-marble-id="p">hi</p>'));
  assert.equal(space.request, null);
  assert.deepEqual(space.instances, []);
});

test('validateSpace passes the fixture', () => {
  const result = validateSpace(FIXTURE, atlas);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

const kinds = (source) => validateSpace(source, atlas).issues.map((i) => i.kind);

test('validateSpace: no instances', () => {
  assert.deepEqual(kinds(doc('<p data-marble-id="p">hi</p>')), ['no-instances']);
});

test('validateSpace: a root must be pattern#name and carry a marble id', () => {
  assert.ok(kinds(doc('<section data-marble-id="s" data-genui="overview-detail"></section>')).includes('bad-root'));
  assert.ok(kinds(doc('<section data-genui="overview-detail#x"></section>')).includes('missing-marble-id'));
});

test('validateSpace: duplicate instance names and unknown patterns', () => {
  const two = doc('<section data-marble-id="a" data-genui="card#c"></section><section data-marble-id="b" data-genui="card#c"></section>');
  assert.ok(kinds(two).includes('duplicate-instance'));
  assert.ok(kinds(doc('<section data-marble-id="a" data-genui="carousel#c"></section>')).includes('unknown-pattern'));
});

test('validateSpace: a declared key must be a sub-dimension of the entry (or one it specializes)', () => {
  const bad = doc('<section data-marble-id="a" data-genui="card#c" data-colour="red" data-genui-colour="red | blue"></section>', '.x[data-colour="red"]{} .x[data-colour="blue"]{}');
  assert.deepEqual(kinds(bad), ['unknown-key']);
  const inherited = doc('<section data-marble-id="a" data-genui="inbox#i" data-open-in="pop-up" data-genui-open-in="pop-up | popover"></section>', '[data-open-in="pop-up"]{} [data-open-in="popover"]{}');
  assert.deepEqual(kinds(inherited), []);
});

test('validateSpace: fewer than two options, a preset without a gloss, an unimplemented option, a current value not declared', () => {
  const one = doc('<section data-marble-id="a" data-genui="card#c" data-shape="vertical" data-genui-shape="vertical"></section>', '[data-shape="vertical"]{}');
  assert.deepEqual(kinds(one), ['too-few-options']);

  const noGloss = doc('<section data-marble-id="a" data-genui="card#c" data-shape="tall" data-genui-shape="tall | vertical"></section>', '[data-shape="tall"]{} [data-shape="vertical"]{}');
  assert.deepEqual(kinds(noGloss), ['missing-gloss']);

  const notImplemented = doc('<section data-marble-id="a" data-genui="card#c" data-shape="vertical" data-genui-shape="vertical | horizontal"></section>', '[data-shape="vertical"]{}');
  assert.deepEqual(kinds(notImplemented), ['unimplemented-option']);

  const wrongCurrent = doc('<section data-marble-id="a" data-genui="card#c" data-shape="round" data-genui-shape="vertical | horizontal"></section>', '[data-shape="vertical"]{} [data-shape="horizontal"]{}');
  assert.deepEqual(kinds(wrongCurrent), ['current-not-declared']);
});

test('validateSpace: a <marble-alt> under the root implements options too', () => {
  const alt = doc(`<section data-marble-id="a" data-genui="card#c" data-media="none" data-genui-media="none | top-image">
    <marble-alt data-marble-id="m" data-marble-active="none">
      <span data-marble-id="m0" data-marble-alt="none"></span>
      <img data-marble-id="m1" data-marble-alt="top-image">
    </marble-alt></section>`);
  assert.deepEqual(kinds(alt), []);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/genui-space.test.js`
Expected: FAIL — `Cannot find module '../server/genui/space.js'`.

- [ ] **Step 4: Write `server/genui/space.js`**

```js
// The app-space contract, read back off a document. One fact, one place: the
// current position of every decision is the attribute CSS reads; which
// variations this app implements is one declaration line the validator holds
// honest against the stylesheet and the <marble-alt>s.

import { parseSource } from '../engine.js';
import { camel, kebab, slug } from './atlas.js';

const GENUI = 'data-genui';
const ID = 'data-marble-id';
const META = new Set(['data-genui-about', 'data-genui-request']);

const isElement = (node) => typeof node?.tagName === 'string';
const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? null;

function* walk(node, ancestors = []) {
  if (isElement(node)) yield { node, ancestors };
  const next = isElement(node) ? [...ancestors, node] : ancestors;
  for (const child of node.childNodes ?? []) yield* walk(child, next);
}

const textOf = (node) => (node.childNodes ?? []).map((c) => (c.nodeName === '#text' ? c.value : textOf(c))).join('');

export function parseDeclaration(value) {
  return String(value ?? '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const cut = part.indexOf(':');
      if (cut < 0) return { slug: slug(part), gloss: null };
      const gloss = part.slice(cut + 1).trim();
      return { slug: slug(part.slice(0, cut)), gloss: gloss || null };
    });
}

function roots(tree) {
  const out = [];
  for (const { node, ancestors } of walk(tree)) {
    const value = attr(node, GENUI);
    if (value === null) continue;
    const parentRoot = [...ancestors].reverse().find((a) => attr(a, GENUI) !== null) ?? null;
    out.push({ node, value, parentRoot });
  }
  return out;
}

function decisionsOf(node) {
  const out = [];
  for (const a of node.attrs ?? []) {
    if (!a.name.startsWith('data-genui-') || META.has(a.name)) continue;
    const kebabKey = a.name.slice('data-genui-'.length);
    const factAttr = `data-${kebabKey}`;
    out.push({ key: camel(kebabKey), attr: factAttr, current: attr(node, factAttr), options: parseDeclaration(a.value) });
  }
  return out;
}

export function extractSpace(source) {
  const tree = parseSource(String(source ?? ''));
  let request = null;
  for (const { node } of walk(tree)) {
    if (node.tagName === 'body') {
      request = attr(node, 'data-genui-request');
      break;
    }
  }
  const instances = roots(tree).map(({ node, value, parentRoot }) => {
    const [pattern, name = ''] = value.split('#');
    return {
      name: name.trim(),
      marbleId: attr(node, ID),
      pattern: pattern.trim(),
      about: attr(node, 'data-genui-about'),
      parent: parentRoot ? (attr(parentRoot, GENUI).split('#')[1] ?? '').trim() || null : null,
      decisions: decisionsOf(node),
    };
  });
  return { request: request?.trim() || null, instances };
}

function implementedIn(tree) {
  // Every `[data-<key>="<slug>"]` any stylesheet selects, plus every
  // data-marble-alt value under a <marble-alt>, keyed "attr=slug".
  const found = new Set();
  const css = [];
  for (const { node } of walk(tree)) {
    if (node.tagName === 'style') css.push(textOf(node));
    if (node.tagName === 'marble-alt') {
      for (const { node: child } of walk(node)) {
        const alt = attr(child, 'data-marble-alt');
        if (alt !== null) found.add(`alt=${slug(alt)}`);
      }
    }
  }
  const re = /\[\s*(data-[a-z0-9-]+)\s*=\s*["']([^"']*)["']\s*\]/g;
  for (const sheet of css) for (const m of sheet.matchAll(re)) found.add(`${m[1]}=${slug(m[2])}`);
  return found;
}

export function validateSpace(source, atlas) {
  const tree = parseSource(String(source ?? ''));
  const issues = [];
  const push = (instance, key, kind, message) => issues.push({ instance, key, kind, message });
  const found = roots(tree);
  if (!found.length) push(null, null, 'no-instances', 'no element carries data-genui');
  const implemented = implementedIn(tree);
  const names = new Map();

  for (const { node, value } of found) {
    const [patternRaw, nameRaw] = value.split('#');
    const pattern = (patternRaw ?? '').trim();
    const name = (nameRaw ?? '').trim();
    const marbleId = attr(node, ID);
    if (!pattern || !name) {
      push(name || null, null, 'bad-root', `data-genui must be "<atlas-id>#<instance-name>", got "${value}"`);
      continue;
    }
    if (!marbleId) push(name, null, 'missing-marble-id', `instance "${name}" has no data-marble-id`);
    if (names.has(name)) push(name, null, 'duplicate-instance', `instance name "${name}" is used twice`);
    names.set(name, true);
    if (!atlas.has(pattern)) {
      push(name, null, 'unknown-pattern', `"${pattern}" is not an Atlas entry`);
      continue;
    }
    for (const decision of decisionsOf(node)) {
      const { key, attr: factAttr, current, options } = decision;
      const sub = atlas.sub(pattern, key);
      if (!sub) {
        push(name, key, 'unknown-key', `"${key}" is not a sub-dimension of ${pattern}`);
        continue;
      }
      if (options.length < 2) push(name, key, 'too-few-options', `${factAttr} declares ${options.length} option(s); two or more make a decision`);
      for (const option of options) {
        if (option.gloss === null && !sub.vars.has(option.slug)) {
          push(name, key, 'missing-gloss', `"${option.slug}" is not an Atlas variation of ${key}; a preset needs "slug: gloss"`);
        }
        if (!implemented.has(`${factAttr}=${option.slug}`) && !implemented.has(`alt=${option.slug}`)) {
          push(name, key, 'unimplemented-option', `no [${factAttr}="${option.slug}"] rule and no data-marble-alt="${option.slug}" implements it`);
        }
      }
      if (current === null || !options.some((o) => o.slug === slug(current))) {
        push(name, key, 'current-not-declared', `${factAttr}="${current}" is not one of: ${options.map((o) => o.slug).join(', ')}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export { kebab };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/genui-space.test.js`
Expected: 10 passing. If `validateSpace passes the fixture` fails on `unimplemented-option`, the fixture's CSS selector for that option is missing — fix the fixture, not the validator.

- [ ] **Step 6: Commit**

```bash
git add server/genui/space.js test/genui-space.test.js test/fixtures/genui/49ers.mrbl test/fixtures/genui/metrics.mrbl test/fixtures/genui/signup.mrbl
git commit -m "genui: the app-space contract — extract and validate, with the 49ers fixture.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: One TypeSafe request from a space

**Files:**
- Create: `server/genui/questions.js`
- Test: `test/genui-questions.test.js`

**Interfaces:**
- Consumes: `Space` from Task 2; `AtlasIndex` from Task 1.
- Produces: `buildQuestions(space, atlas, { request, context }) → { state, questions }` where `questions[<name>.<key>] = { type: 'choice', instructions: object, criteria: Record<slug, gloss> }` and `state = { request, context, instances: [{ name, pattern, about, children: string[] }] }`. Also `questionId(instance, decision) → string`.

- [ ] **Step 1: Write the failing tests**

`test/genui-questions.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { loadAtlas } from '../server/genui/atlas.js';
import { buildQuestions, questionId } from '../server/genui/questions.js';
import { extractSpace } from '../server/genui/space.js';

const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const atlas = await loadAtlas(new URL('./fixtures/genui/atlas.mini.json', import.meta.url));
const space = extractSpace(FIXTURE);

test('one Choice per decision, ids are instance.key', () => {
  const { questions } = buildQuestions(space, atlas, { context: {} });
  assert.deepEqual(Object.keys(questions), [
    'games.openIn', 'games.overviewType', 'games.detailMultiplicity', 'games.attributePlacement',
    'game-card.shape', 'game-card.media', 'game-card.actions', 'game-card.target',
  ]);
  for (const q of Object.values(questions)) assert.equal(q.type, 'choice');
  assert.equal(questionId(space.instances[1], space.instances[1].decisions[0]), 'game-card.shape');
});

test('criteria are exactly the declared slugs in declared order; Atlas gloss when the slug matches, authored gloss otherwise', () => {
  const { questions } = buildQuestions(space, atlas, { context: {} });
  const vars = atlas.sub('overview-detail', 'openIn').vars;
  assert.deepEqual(questions['games.openIn'].criteria, {
    'side-by-side': vars.get('side-by-side').gloss,
    'pop-up': vars.get('pop-up').gloss,
    'new-page': vars.get('new-page').gloss,
  });
  assert.deepEqual(Object.keys(questions['games.attributePlacement'].criteria), ['identity', 'identity-record', 'everything']);
  assert.equal(questions['games.attributePlacement'].criteria['identity-record'], 'opponent, date, and the series record on the card');
});

test('instructions carry the instance, the Atlas question and sub-dimension name, and never mention TypeSafe or confidence', () => {
  const { questions } = buildQuestions(space, atlas, { context: {} });
  const q = questions['games.openIn'];
  assert.equal(q.instructions.instance, 'games');
  assert.equal(q.instructions.pattern, 'Overview–detail');
  assert.match(q.instructions.about, /^Upcoming and recent/);
  assert.equal(q.instructions.dimension, 'How are overviews and detail views arranged, how are items organized, and how many details are open?');
  assert.equal(q.instructions.subdimension, 'Overview–detail arrangement');
  assert.match(q.instructions.ask, /first show/);
  const text = JSON.stringify(q.instructions);
  assert.doesNotMatch(text, /typesafe|confidence/i);
});

test('state carries the request (call wins over document), the context verbatim, and instance summaries with children', () => {
  const { state } = buildQuestions(space, atlas, { context: { viewport: 'phone', items: 6 } });
  assert.match(state.request, /49ers games/);
  assert.deepEqual(state.context, { viewport: 'phone', items: 6 });
  assert.deepEqual(state.instances, [
    { name: 'games', pattern: 'Overview–detail', about: space.instances[0].about, children: ['game-card'] },
    { name: 'game-card', pattern: 'Card', about: space.instances[1].about, children: [] },
  ]);
  const override = buildQuestions(space, atlas, { request: 'Show only home games', context: {} });
  assert.equal(override.state.request, 'Show only home games');
});

test('a key the Atlas does not know is skipped, not asked', () => {
  const bad = { request: null, instances: [{ name: 'x', marbleId: 'x', pattern: 'card', about: null, parent: null,
    decisions: [{ key: 'colour', attr: 'data-colour', current: 'red', options: [{ slug: 'red', gloss: 'r' }, { slug: 'blue', gloss: 'b' }] }] }] };
  const { questions } = buildQuestions(bad, atlas, { context: {} });
  assert.deepEqual(questions, {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/genui-questions.test.js`
Expected: FAIL — `Cannot find module '../server/genui/questions.js'`.

- [ ] **Step 3: Write `server/genui/questions.js`**

```js
// A space becomes one TypeSafe request: one Choice per decision, all over the
// same state. Question ids are for code and never reach the model, so every
// question carries its own meaning: which instance, what it shows, and the
// Atlas's own wording for the dimension. Criteria are only the options this
// document implements — the model cannot pick a variation the page cannot show.

export const questionId = (instance, decision) => `${instance.name}.${decision.key}`;

const ASK = 'Choose the best first show for this instance given request and context. Options are the only variations this app implements.';

export function buildQuestions(space, atlas, { request = null, context = {} } = {}) {
  const byName = new Map(space.instances.map((i) => [i.name, i]));
  const state = {
    request: request ?? space.request ?? '',
    context: context ?? {},
    instances: space.instances.map((i) => ({
      name: i.name,
      pattern: atlas.entry(i.pattern)?.name ?? i.pattern,
      about: i.about,
      children: space.instances.filter((c) => c.parent === i.name).map((c) => c.name),
    })),
  };
  const questions = {};
  for (const instance of space.instances) {
    const entry = atlas.entry(instance.pattern);
    for (const decision of instance.decisions) {
      const sub = atlas.sub(instance.pattern, decision.key);
      if (!sub) continue;
      const criteria = {};
      for (const option of decision.options) {
        criteria[option.slug] = option.gloss ?? sub.vars.get(option.slug)?.gloss ?? option.slug;
      }
      questions[questionId(instance, decision)] = {
        type: 'choice',
        instructions: {
          instance: instance.name,
          pattern: entry?.name ?? instance.pattern,
          about: instance.about ?? '',
          parent: instance.parent ? byName.get(instance.parent)?.about ?? instance.parent : null,
          dimension: sub.dim.q ?? sub.dim.name,
          subdimension: sub.sub.name,
          ask: ASK,
        },
        criteria,
      };
    }
  }
  return { state, questions };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/genui-questions.test.js`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add server/genui/questions.js test/genui-questions.test.js
git commit -m "genui: one TypeSafe request per decide — a Choice per decision over shared state.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Answers to gated ops, and the one `decideDocument()`

**Files:**
- Create: `server/genui/decide.js`
- Test: `test/genui-decide.test.js`

**Interfaces:**
- Consumes: `Space`, `validateSpace`, `extractSpace` (Task 2); `buildQuestions`, `questionId` (Task 3); `askSystemOne`, `explainTypesafeFailure` from `server/typesafe/client.js`.
- Produces:
  - `answersToOps(space, answers, { stop = 0.75 }) → { ops, decisions }` with `decisions[] = { id, instance, key, current, choice, confidence, applied, reason }`, `reason ∈ 'applied' | 'kept-low-confidence' | 'kept-unchanged' | 'no-answer'`. Throws `{ status: 502 }` on an off-menu choice.
  - `decideDocument({ source, atlas, apiKey, request, context, stop, signal, ask }) → { validation, state, questions, answers, decisions, ops, elapsedMs, usage }`. `ask` defaults to `askSystemOne`; a test passes a fake. Throws `{ status: 422, issues }` when validation fails.

- [ ] **Step 1: Write the failing tests**

`test/genui-decide.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { loadAtlas } from '../server/genui/atlas.js';
import { answersToOps, decideDocument } from '../server/genui/decide.js';
import { extractSpace } from '../server/genui/space.js';

const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const atlas = await loadAtlas(new URL('./fixtures/genui/atlas.mini.json', import.meta.url));
const space = extractSpace(FIXTURE);

const answer = (choice, confidence) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });

test('an applied decision is one setAttr on the instance root with the slug', () => {
  const { ops, decisions } = answersToOps(space, { 'games.openIn': answer('pop-up', 0.9) }, { stop: 0.75 });
  assert.deepEqual(ops, [{ type: 'setAttr', id: 'games', name: 'data-open-in', value: 'pop-up' }]);
  const d = decisions.find((x) => x.id === 'games.openIn');
  assert.equal(d.applied, true);
  assert.equal(d.reason, 'applied');
  assert.equal(d.current, 'side-by-side');
  assert.equal(d.instance, 'games');
  assert.equal(d.key, 'openIn');
});

test('below the stop threshold keeps the authored default', () => {
  const { ops, decisions } = answersToOps(space, { 'games.openIn': answer('pop-up', 0.6) }, { stop: 0.75 });
  assert.deepEqual(ops, []);
  assert.equal(decisions.find((x) => x.id === 'games.openIn').reason, 'kept-low-confidence');
});

test('choosing the current value is kept-unchanged, not an op', () => {
  const { ops, decisions } = answersToOps(space, { 'games.openIn': answer('side-by-side', 0.95) }, { stop: 0.75 });
  assert.deepEqual(ops, []);
  assert.equal(decisions.find((x) => x.id === 'games.openIn').reason, 'kept-unchanged');
});

test('a decision with no answer is reported, not applied; stop is per call', () => {
  const { decisions } = answersToOps(space, {}, { stop: 0.5 });
  assert.equal(decisions.length, 8);
  assert.ok(decisions.every((d) => d.reason === 'no-answer' && d.applied === false));
  const low = answersToOps(space, { 'game-card.shape': answer('horizontal', 0.55) }, { stop: 0.5 });
  assert.equal(low.ops.length, 1);
});

test('an off-menu choice throws — a wrong-shaped answer is a bug, not data', () => {
  assert.throws(() => answersToOps(space, { 'games.openIn': answer('tooltip', 0.99) }), (err) => err.status === 502 && /tooltip/.test(err.message));
});

test('decideDocument runs the whole fast path with a fake gate and never touches the LLM module', async () => {
  const seen = [];
  const ask = async ({ state, questions }) => {
    seen.push({ state, questions });
    return {
      model: 'fake',
      usage: { input_tokens: 10, output_tokens: 1 },
      answers: Object.fromEntries(Object.keys(questions).map((id) => [id, answer(id === 'games.openIn' ? 'pop-up' : Object.keys(questions[id].criteria)[0], 0.9)])),
    };
  };
  const result = await decideDocument({ source: FIXTURE, atlas, apiKey: 'tsk', context: { viewport: 'phone' }, ask });
  assert.equal(seen.length, 1, 'one request');
  assert.equal(Object.keys(seen[0].questions).length, 8);
  assert.deepEqual(seen[0].state.context, { viewport: 'phone' });
  assert.equal(result.validation.ok, true);
  assert.ok(result.ops.some((op) => op.name === 'data-open-in' && op.value === 'pop-up'));
  assert.equal(typeof result.elapsedMs, 'number');
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 1 });
  const loaded = Object.keys(await import('node:module').then((m) => m.default._cache ?? {}));
  assert.ok(!loaded.some((f) => f.endsWith('/server/typesafe/llm.js')), 'llm.js must not be loaded by the decide path');
});

test('decideDocument refuses an invalid space with 422 and the issues', async () => {
  const broken = FIXTURE.replace('data-open-in="side-by-side"', 'data-open-in="tooltip"');
  await assert.rejects(
    () => decideDocument({ source: broken, atlas, apiKey: 'tsk', ask: async () => ({ answers: {} }) }),
    (err) => err.status === 422 && err.issues.some((i) => i.kind === 'current-not-declared'),
  );
});
```

The `llm.js` assertion is G2 made structural: ESM keeps no `_cache` for `import`, so the check below is the honest one — `decide.js` has no import of `llm.js`, and the test additionally asserts via a static read:

Replace the two `loaded` lines above with:

```js
  const src = await fsp.readFile(new URL('../server/genui/decide.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /typesafe\/llm\.js/, 'decide.js must not import llm.js');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/genui-decide.test.js`
Expected: FAIL — `Cannot find module '../server/genui/decide.js'`.

- [ ] **Step 3: Write `server/genui/decide.js`**

```js
// Answers become positions. A Choice above the stop threshold that differs
// from the authored default is one setAttr on the instance root; everything
// else keeps what the author wrote. An answer outside the offered criteria is
// refused outright — the same posture as json-render's evaluator and this
// repo's gateWithRepair: a wrong-shaped answer is a bug to see, not data to
// smooth over. No LLM is imported here, on purpose.

import { askSystemOne } from '../typesafe/client.js';
import { buildQuestions, questionId } from './questions.js';
import { slug } from './atlas.js';
import { extractSpace, validateSpace } from './space.js';

export function answersToOps(space, answers, { stop = 0.75 } = {}) {
  const ops = [];
  const decisions = [];
  for (const instance of space.instances) {
    for (const decision of instance.decisions) {
      const id = questionId(instance, decision);
      const answer = answers?.[id];
      const current = decision.current === null ? null : slug(decision.current);
      const row = { id, instance: instance.name, key: decision.key, current, choice: null, confidence: null, applied: false, reason: 'no-answer' };
      if (!answer) {
        decisions.push(row);
        continue;
      }
      const choice = String(answer.choice ?? '');
      if (!decision.options.some((o) => o.slug === choice)) {
        const err = new Error(`TypeSafe chose "${choice}" for ${id}, which is not one of: ${decision.options.map((o) => o.slug).join(', ')}`);
        err.status = 502;
        throw err;
      }
      const confidence = Number(answer.confidence);
      row.choice = choice;
      row.confidence = Number.isFinite(confidence) ? confidence : 0;
      if (choice === current) row.reason = 'kept-unchanged';
      else if (row.confidence < stop) row.reason = 'kept-low-confidence';
      else {
        row.reason = 'applied';
        row.applied = true;
        ops.push({ type: 'setAttr', id: instance.marbleId, name: decision.attr, value: choice });
      }
      decisions.push(row);
    }
  }
  return { ops, decisions };
}

export async function decideDocument({
  source,
  atlas,
  apiKey,
  request = null,
  context = {},
  stop = 0.75,
  signal,
  ask = askSystemOne,
} = {}) {
  const started = performance.now();
  const validation = validateSpace(source, atlas);
  if (!validation.ok) {
    const err = new Error(`the document is not a valid app space (${validation.issues.length} issue(s))`);
    err.status = 422;
    err.issues = validation.issues;
    throw err;
  }
  const space = extractSpace(source);
  const { state, questions } = buildQuestions(space, atlas, { request, context });
  const response = await ask({ apiKey, state, questions, signal });
  const answers = response?.answers ?? {};
  const { ops, decisions } = answersToOps(space, answers, { stop });
  return {
    validation,
    state,
    questions,
    answers,
    decisions,
    ops,
    elapsedMs: Math.round(performance.now() - started),
    usage: response?.usage ?? null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/genui-decide.test.js`
Expected: 7 passing.

- [ ] **Step 5: Run the whole unit suite to make sure nothing else moved**

Run: `npm test 2>&1 | tail -5`
Expected: all passing (the pre-existing count plus 28 new). A single flaky failure in `test/agent-http.test.js` under load is known — rerun that file alone before chasing it.

- [ ] **Step 6: Commit**

```bash
git add server/genui/decide.js test/genui-decide.test.js
git commit -m "genui: answers to gated setAttr ops, and decideDocument — the whole fast path in one call.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: HTTP surface — `GET /genui/space`, `POST /genui/decide`, and the record

**Files:**
- Create: `server/genui/routes.js`
- Modify: `server/config.js` (one line after `typesafeApiKey`)
- Modify: `server/app.js` — `createDrive` signature (line 101), handler creation after `writeOps` (after line ~255), dispatch after `typesafe.handle` (line 341), and the returned object (line ~980)
- Test: `test/genui-http.test.js`

**Interfaces:**
- Consumes: `decideDocument`, `validateSpace`, `extractSpace`, `loadAtlas`; `writeOps(docPath, ops, { client })` and `store.read(docPath)` from `createDrive`; `json`, `readJson` from `server/http.js`; `docKey` from `server/paths.js`; `explainTypesafeFailure` from `server/typesafe/client.js`.
- Produces: `createGenuiHandler({ store, atlasFile, apiKey, writeOps, marbleDir, ask, log, maxBodyBytes }) → { handle(req, res, url): Promise<boolean>, atlas(): Promise<AtlasIndex> }`. `createDrive(config, { genui: { ask } })` forwards `ask`. `config.genuiAtlas` is the Atlas path.

- [ ] **Step 1: Write the failing tests**

`test/genui-http.test.js`:

```js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-genui-http-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const quiet = { log() {}, error() {} };
const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const ATLAS = new URL('./fixtures/genui/atlas.mini.json', import.meta.url).pathname;

const openEnv = (extra = {}) => ({
  ...process.env,
  MARBLE_DRIVE_SECRET: '',
  MARBLE_DRIVE_AGENTS: '',
  MARBLE_DRIVE_BACKUP_DIR: '',
  MARBLE_DRIVE_BACKUP_CMD: '',
  MARBLE_DRIVE_ROOT: ROOT,
  MARBLE_APPS: ROOT,
  MARBLE_DRIVE_GENUI_ATLAS: ATLAS,
  ...extra,
});

const listen = async (drive) => {
  const port = await new Promise((resolve) => {
    drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port));
  });
  return `http://127.0.0.1:${port}`;
};

const withDrive = async (config, extra, fn) => {
  const drive = await createDrive(config, { log: quiet, agents: false, ...extra });
  try {
    await drive.createDocument('Spaces/49ers', FIXTURE, { label: 'test' });
    const base = await listen(drive);
    return await fn(base, drive);
  } finally {
    await drive.close();
  }
};

const answer = (choice, confidence = 0.9) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });
const fakeAsk = (pick) => async ({ questions }) => ({
  model: 'fake',
  usage: { input_tokens: 5, output_tokens: 1 },
  answers: Object.fromEntries(Object.keys(questions).map((id) => [id, answer(pick(id, questions[id]))])),
});
const firstOption = (id, q) => Object.keys(q.criteria)[0];

test('GET /genui/space returns the extracted space and its validation', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: '' })), {}, async (base) => {
    const body = await (await fetch(`${base}/genui/space?doc=${encodeURIComponent('Spaces/49ers')}`)).json();
    assert.equal(body.validation.ok, true);
    assert.equal(body.space.instances.length, 2);
    assert.equal(body.space.instances[0].name, 'games');
    const missing = await fetch(`${base}/genui/space?doc=nope`);
    assert.equal(missing.status, 404);
  });
});

test('POST /genui/decide without a key is 503 with the existing explanation', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: '' })), {}, async (base) => {
    const response = await fetch(`${base}/genui/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: 'Spaces/49ers' }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.kind, 'no_key');
  });
});

test('POST /genui/decide writes the applied positions into the file and records the run', async () => {
  const ask = fakeAsk((id, q) => (id === 'games.openIn' ? 'pop-up' : id === 'game-card.shape' ? 'horizontal' : Object.keys(q.criteria).find((s) => s === undefined) ?? currentOf(id)));
  const currents = { 'games.overviewType': 'grid', 'games.detailMultiplicity': 'one-at-a-time', 'games.attributePlacement': 'identity-record', 'game-card.media': 'side-thumbnail', 'game-card.actions': 'none', 'game-card.target': 'whole-card' };
  function currentOf(id) { return currents[id]; }
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask } }, async (base, drive) => {
    const response = await fetch(`${base}/genui/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: 'Spaces/49ers', context: { viewport: 'phone', items: 6 }, stop: 0.75 }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.applied, 2);
    assert.equal(typeof body.elapsedMs, 'number');
    assert.deepEqual(body.usage, { input_tokens: 5, output_tokens: 1 });
    assert.ok(body.decisions.find((d) => d.id === 'games.openIn').applied);

    const written = await drive.store.read('Spaces/49ers');
    assert.match(written, /id="games"[^>]*data-open-in="pop-up"/s);
    assert.match(written, /data-marble-id="g1"[^>]*data-shape="horizontal"/s);

    const record = await fsp.readFile(path.join(drive.store.marbleDir, 'Spaces%2F49ers.genui.jsonl'), 'utf8');
    const lines = record.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].doc, 'Spaces/49ers');
    assert.deepEqual(lines[0].context, { viewport: 'phone', items: 6 });
    assert.equal(lines[0].decisions.length, 8);
    assert.equal(lines[0].dry, false);
  });
});

test('POST /genui/decide with dry:true asks but writes nothing', async () => {
  const ask = fakeAsk((id, q) => (id === 'games.openIn' ? 'new-page' : firstOption(id, q)));
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask } }, async (base, drive) => {
    const before = await drive.store.read('Spaces/49ers');
    const body = await (await fetch(`${base}/genui/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: 'Spaces/49ers', dry: true }),
    })).json();
    assert.ok(body.ops.some((op) => op.value === 'new-page'));
    assert.equal(body.applied, 0);
    assert.equal(await drive.store.read('Spaces/49ers'), before);
  });
});

test('POST /genui/decide on an invalid space is 422 with issues; on an unknown doc 404', async () => {
  await withDrive(loadConfig(openEnv({ TYPESAFE_API_KEY: 'tsk_test' })), { genui: { ask: fakeAsk(firstOption) } }, async (base, drive) => {
    await drive.createDocument('Spaces/broken', FIXTURE.replace('data-open-in="side-by-side"', 'data-open-in="tooltip"'), { label: 'test' });
    const bad = await fetch(`${base}/genui/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: 'Spaces/broken' }),
    });
    assert.equal(bad.status, 422);
    assert.ok((await bad.json()).issues.some((i) => i.kind === 'current-not-declared'));
    const missing = await fetch(`${base}/genui/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: 'Spaces/none' }),
    });
    assert.equal(missing.status, 404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/genui-http.test.js`
Expected: FAIL — every `/genui/*` request is 404 (`text(res, 404, 'not found')`) or the fetch of `/genui/space` returns HTML.

- [ ] **Step 3: Add `genuiAtlas` to `server/config.js`**

After the `typesafeApiKey` line (the last entry of the returned object), add:

```js
    // Fast GenUI: where Space₀ lives. Read-only to the host. Defaults to the
    // Atlas the Design Pattern Generation build writes into the drive.
    genuiAtlas: path.resolve(str('MARBLE_DRIVE_GENUI_ATLAS', path.join(root, 'Research', 'Design Pattern Generation', 'atlas.json'))),
```

- [ ] **Step 4: Write `server/genui/routes.js`**

```js
// The Drive surface for Fast GenUI. Keys stay on the host; a document never
// carries TYPESAFE_API_KEY. The route reads the document through the store,
// decides, and writes through the same writeOps a gesture uses — which is why
// an open page moves when Jev decides.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { json, readJson } from '../http.js';
import { docKey } from '../paths.js';
import { explainTypesafeFailure } from '../typesafe/client.js';
import { loadAtlas } from './atlas.js';
import { decideDocument } from './decide.js';
import { extractSpace, validateSpace } from './space.js';

function noKeyFailure() {
  return explainTypesafeFailure({
    status: 503,
    message: 'TYPESAFE_API_KEY is not set. Put it in .env.local and restart the host.',
  });
}

function readStop(value, fallback = 0.75) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 1 ? n / 100 : n;
}

export function createGenuiHandler({
  store,
  atlasFile,
  apiKey = null,
  writeOps,
  marbleDir,
  ask = undefined,
  log = console,
  maxBodyBytes = 16 * 1024 * 1024,
} = {}) {
  let atlasPromise = null;
  const atlas = () => {
    if (!atlasPromise) {
      atlasPromise = loadAtlas(atlasFile).catch((err) => {
        atlasPromise = null;
        const wrapped = new Error(`the Atlas at ${atlasFile} could not be read: ${err.message}`);
        wrapped.status = 503;
        throw wrapped;
      });
    }
    return atlasPromise;
  };

  const record = async (docPath, entry) => {
    try {
      await fsp.mkdir(marbleDir, { recursive: true });
      await fsp.appendFile(path.join(marbleDir, `${docKey(docPath)}.genui.jsonl`), `${JSON.stringify(entry)}\n`);
    } catch (err) {
      log.error?.(`[genui] could not record a decide for ${docPath}: ${err.message}`);
    }
  };

  const readDoc = async (docPath, res) => {
    if (!docPath) {
      json(res, 400, { error: 'which document? pass doc=<path>' });
      return null;
    }
    const source = await store.read(docPath);
    if (source === null) {
      json(res, 404, { error: `no document "${docPath}"` });
      return null;
    }
    return source;
  };

  return {
    atlas,
    async handle(req, res, url) {
      const route = url.pathname;

      if (route === '/genui/space' && req.method === 'GET') {
        const docPath = url.searchParams.get('doc') ?? '';
        const source = await readDoc(docPath, res);
        if (source === null) return true;
        try {
          const index = await atlas();
          json(res, 200, { doc: docPath, space: extractSpace(source), validation: validateSpace(source, index) });
        } catch (err) {
          json(res, err.status ?? 500, { error: err.message });
        }
        return true;
      }

      if (route === '/genui/decide' && req.method === 'POST') {
        if (!apiKey) {
          json(res, 503, { ...noKeyFailure(), error: noKeyFailure().message });
          return true;
        }
        const body = await readJson(req, maxBodyBytes);
        const docPath = String(body.doc ?? '').trim();
        const source = await readDoc(docPath, res);
        if (source === null) return true;
        const dry = body.dry === true;
        const stop = readStop(body.stop);
        const context = body.context && typeof body.context === 'object' ? body.context : {};
        const request = typeof body.request === 'string' && body.request.trim() ? body.request.trim() : null;
        const ac = new AbortController();
        res.on('close', () => ac.abort());
        try {
          const index = await atlas();
          const result = await decideDocument({ source, atlas: index, apiKey, request, context, stop, signal: ac.signal, ...(ask ? { ask } : {}) });
          let applied = 0;
          if (!dry && result.ops.length) {
            const written = await writeOps(docPath, result.ops, { client: 'genui' });
            applied = written.applied ?? 0;
          }
          const out = {
            doc: docPath,
            dry,
            stop,
            context,
            request: result.state.request,
            decisions: result.decisions,
            ops: result.ops,
            applied,
            elapsedMs: result.elapsedMs,
            usage: result.usage,
          };
          await record(docPath, { at: new Date().toISOString(), ...out });
          json(res, 200, out);
        } catch (err) {
          if (err.status === 422 && err.issues) {
            json(res, 422, { error: err.message, issues: err.issues });
          } else {
            const explained = explainTypesafeFailure(err);
            json(res, err.status ?? 500, { error: err.message, ...explained });
          }
        }
        return true;
      }

      return false;
    },
  };
}
```

- [ ] **Step 5: Wire it in `server/app.js` — four small hunks**

Run `ListAgents` first. Then:

(a) Line 101, add `genui: genuiOpts = null` to the options object of `createDrive`:

```js
export async function createDrive(config, { log = console, agentProviders = null, agents: withAgents = true, usage = null, usageHistory = null, typesafe: typesafeOpts = null, genui: genuiOpts = null, agentSandbox = null } = {}) {
```

(b) Add the import next to the typesafe one (line 36):

```js
import { createGenuiHandler } from './genui/routes.js';
```

(c) Directly after the `writeOps` function's closing brace (the function that begins `async function writeOps(docPath, ops, options = {})` at line 243), add:

```js
  // Fast GenUI: Jev positions a document inside the space its author wrote.
  // Created here rather than beside `typesafe` because it writes, and the
  // one write path is defined just above.
  const genui = createGenuiHandler({
    store,
    atlasFile: config.genuiAtlas,
    apiKey: config.typesafeApiKey,
    writeOps,
    marbleDir: store.marbleDir,
    ask: genuiOpts?.ask,
    log,
    maxBodyBytes: config.maxBodyBytes,
  });
```

(d) In the request handler, directly after `if (await typesafe.handle(req, res, url)) return;` (line 341):

```js
      if (await genui.handle(req, res, url)) return;
```

(e) In the returned object (line ~980, after `writeOps,`), add `genui,`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/genui-http.test.js`
Expected: 5 passing. Then `node --test test/typesafe-http.test.js` — still passing (nothing about `/typesafe` changed).

- [ ] **Step 7: Commit**

```bash
git add server/genui/routes.js server/config.js server/app.js test/genui-http.test.js
git commit -m "genui: GET /genui/space and POST /genui/decide — Jev's decision is a host-side write.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The command — `marble-drive genui space|decide`

**Files:**
- Modify: `bin/marble-drive.js` (the header comment, the `switch`, and one new function at the bottom)
- Test: manual (the command is a thin caller of tested modules); one smoke line in the step.

**Interfaces:**
- Consumes: `loadAtlas`, `extractSpace`, `validateSpace`, `decideDocument`, `createDrive`, `config`.
- Produces: `marble-drive genui space <doc>` prints the validation and exits 1 on issues; `marble-drive genui decide <doc> [--dry] [--stop=0.75] [--context='{"viewport":"phone"}'] [--request='…']` prints each decision and, unless `--dry`, writes through the drive.

- [ ] **Step 1: Add the two lines to the header comment** (after the `starters` line):

```
//   marble-drive genui space <doc>       is this document an app space? every issue, or ok
//   marble-drive genui decide <doc>      let Jev position it — --dry to look without writing
```

- [ ] **Step 2: Add the case to the switch** (before `default:`), and extend the `default` message:

```js
  case 'genui':
    await genuiCommand();
    break;
  default:
    fail(`no command "${command}" — there is: serve, new, icon, weigh, backup, remote, agents, starters, genui`);
```

- [ ] **Step 3: Add the function at the end of the file**

```js
// ---------------------------------------------------------------------- genui

async function genuiCommand() {
  const [sub, docArg] = args;
  if (!sub || !['space', 'decide'].includes(sub)) fail('genui needs: space <doc> | decide <doc> [--dry] [--stop=N] [--context=JSON] [--request=…]');
  if (!docArg) fail(`genui ${sub} needs a document path inside the drive, like "Research/TypeSafe AI/Spaces/49ers"`);
  const { loadAtlas } = await import('../server/genui/atlas.js');
  const { extractSpace, validateSpace } = await import('../server/genui/space.js');
  const { decideDocument } = await import('../server/genui/decide.js');

  const docPath = parsePath(docArg);
  const atlas = await loadAtlas(config.genuiAtlas).catch((err) => fail(`could not read the Atlas at ${config.genuiAtlas}: ${err.message}`));
  const store = createStore({ root: config.root });
  await store.ready();
  const source = await store.read(docPath);
  if (source === null) fail(`no document "${docPath}" in ${config.root}`);

  if (sub === 'space') {
    const validation = validateSpace(source, atlas);
    const space = extractSpace(source);
    for (const instance of space.instances) {
      console.log(`${instance.pattern}#${instance.name}  (${instance.decisions.length} decisions)`);
      for (const d of instance.decisions) console.log(`  ${d.attr}=${d.current}   [${d.options.map((o) => o.slug).join(' | ')}]`);
    }
    if (validation.ok) console.log('ok');
    else {
      for (const issue of validation.issues) console.error(`${issue.kind}  ${issue.instance ?? '-'}.${issue.key ?? '-'}  ${issue.message}`);
      process.exit(1);
    }
    return;
  }

  if (!config.typesafeApiKey) fail('TYPESAFE_API_KEY is not set. Put it in .env.local.');
  let context = {};
  if (flags.context) {
    try { context = JSON.parse(String(flags.context)); } catch (err) { fail(`--context must be JSON: ${err.message}`); }
  }
  const stop = flags.stop !== undefined ? Number(flags.stop) : 0.75;
  const result = await decideDocument({
    source, atlas, apiKey: config.typesafeApiKey, context, stop,
    request: typeof flags.request === 'string' ? flags.request : null,
  }).catch((err) => {
    if (err.issues) for (const issue of err.issues) console.error(`${issue.kind}  ${issue.instance ?? '-'}.${issue.key ?? '-'}  ${issue.message}`);
    fail(err.message);
  });
  for (const d of result.decisions) {
    const conf = d.confidence === null ? '  -  ' : d.confidence.toFixed(2);
    console.log(`${d.applied ? '→' : ' '} ${conf}  ${d.id.padEnd(32)} ${d.current} ${d.choice && d.choice !== d.current ? `→ ${d.choice}` : ''}  ${d.reason}`);
  }
  console.log(`${result.ops.length} change(s) in ${result.elapsedMs} ms${flags.dry ? ' (dry — nothing written)' : ''}`);
  if (flags.dry || !result.ops.length) return;
  const drive = await createDrive(config, { log: { log() {}, error: console.error } });
  try {
    const written = await drive.writeOps(docPath, result.ops, { client: 'genui-cli' });
    console.log(`wrote ${written.applied} op(s) to ${docPath}`);
  } finally {
    await drive.close();
  }
}
```

- [ ] **Step 4: Smoke it against the fixture, without a key**

```bash
mkdir -p "drive/Research/TypeSafe AI/Spaces" && cp test/fixtures/genui/{49ers,metrics,signup}.mrbl "drive/Research/TypeSafe AI/Spaces/"
for d in 49ers metrics signup; do node --env-file-if-exists=.env --env-file-if-exists=.env.local bin/marble-drive.js genui space "Research/TypeSafe AI/Spaces/$d"; done
```

Expected: each prints its instances and decision lines and `ok`, exit 0 — three patterns from three archetypes, one validator. (The real Atlas at the default path has these keys; if it reports `unknown-key` for `attributePlacement`, `detailMultiplicity` or `openFrom`, check that `drive/Research/Design Pattern Generation/atlas.json` is the 2026-09-15 build.)

Then, with a key present in `.env.local` — **this spends a TypeSafe request; skip if you are not Bryan**:

```bash
node --env-file-if-exists=.env --env-file-if-exists=.env.local bin/marble-drive.js genui decide "Research/TypeSafe AI/Spaces/49ers" --dry --context='{"viewport":"phone","items":6}'
```

Expected: eight lines with confidences, `N change(s) in <ms> ms (dry — nothing written)`. Note the ms — that is G1's first real number; put it in the commit message.

- [ ] **Step 5: Commit**

```bash
git add bin/marble-drive.js
git commit -m "genui: marble-drive genui space|decide — the same modules from a terminal, no host needed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The page moves — browser test through the harness

**Files:**
- Modify: `test-browser/harness.js:60-95` — accept and forward a `genui` option
- Test: `test-browser/genui-decide.test.js`

**Interfaces:**
- Consumes: `startDrive({ documents, agents, genui: { ask } })`; the fixture; `POST /genui/decide`.
- Produces: G3 asserted: a decide flips the live page's fact without reload, and a second decide with different context flips it again.

- [ ] **Step 1: Forward `genui` in the harness**

Change the signature at line 60 to:

```js
export async function startDrive({ scripts = {}, agents = true, documents = { garden: GARDEN }, genui = null } = {}) {
```

and add `genui,` to the `createDrive(config, { … })` options object (after `agentProviders: …`).

- [ ] **Step 2: Write the failing browser test**

`test-browser/genui-decide.test.js`:

```js
// Jev decides; the host writes; the open page moves. No reload, no script in
// the document — the attribute the CSS reads is the fact that changed.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { startDrive } from './harness.js';

const FIXTURE = await fsp.readFile(new URL('../test/fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const ATLAS = new URL('../test/fixtures/genui/atlas.mini.json', import.meta.url).pathname;
process.env.MARBLE_DRIVE_GENUI_ATLAS = ATLAS;
process.env.TYPESAFE_API_KEY = 'tsk_browser_test';

// The fake gate reads the context the way a real one would: a phone wants the
// detail as a pop-up and the cards as a list; a desktop wants side-by-side.
const answer = (choice) => ({ type: 'choice', choice, confidence: 0.92, probabilities: { [choice]: 0.92 } });
const ask = async ({ state, questions }) => {
  const phone = state.context?.viewport === 'phone';
  const pick = (id, q) => {
    if (id === 'games.openIn') return phone ? 'pop-up' : 'side-by-side';
    if (id === 'games.overviewType') return phone ? 'list' : 'grid';
    return Object.keys(q.criteria)[0];
  };
  return { model: 'fake', answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, answer(pick(id, q))])) };
};

const host = await startDrive({ agents: false, documents: { 'Spaces/49ers': FIXTURE }, genui: { ask } });
test.after(() => host.close());

const decide = (context) =>
  fetch(`${host.base}/genui/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: 'Spaces/49ers', context }),
  }).then((r) => r.json());

test('a decide moves the open page without a reload, and a re-decide moves it back', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${encodeURIComponent('Spaces/49ers')}`);
  await page.waitForFunction(() => Boolean(window.marble));
  const games = page.locator('#games');
  assert.equal(await games.getAttribute('data-open-in'), 'side-by-side');
  assert.equal(await games.getAttribute('data-overview-type'), 'grid');
  const marker = await page.evaluate(() => { window.__notReloaded = true; return true; });
  assert.equal(marker, true);

  const phone = await decide({ viewport: 'phone', items: 6 });
  assert.equal(phone.applied, 2);
  await page.waitForFunction(() => document.querySelector('#games')?.getAttribute('data-open-in') === 'pop-up');
  assert.equal(await games.getAttribute('data-overview-type'), 'list');
  assert.equal(await page.evaluate(() => window.__notReloaded === true), true, 'the page did not reload');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#games .detail')).position), 'fixed');

  const desktop = await decide({ viewport: 'desktop', items: 6 });
  assert.equal(desktop.applied, 2);
  await page.waitForFunction(() => document.querySelector('#games')?.getAttribute('data-open-in') === 'side-by-side');
  assert.equal(await games.getAttribute('data-overview-type'), 'grid');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#games .detail')).position), 'sticky');

  const again = await decide({ viewport: 'desktop', items: 6 });
  assert.equal(again.applied, 0, 'nothing to change is nothing written');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('the same path moves a dashboard — not an overview–detail-only trick', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${encodeURIComponent('Spaces/metrics')}`);
  await page.waitForFunction(() => Boolean(window.marble));
  const ops = page.locator('#ops');
  assert.equal(await ops.getAttribute('data-arrangement'), 'fixed-grid');
  const res = await fetch(`${host.base}/genui/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: 'Spaces/metrics', context: { viewport: 'phone' } }),
  }).then((r) => r.json());
  assert.ok(res.applied >= 1);
  await page.waitForFunction(() => document.querySelector('#ops')?.getAttribute('data-arrangement') === 'single-scrolling-column');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ops .tiles')).gridTemplateColumns.split(' ').length), 1);
  assert.deepEqual(errors, []);
  await page.context().close();
});
```

The fake `ask` above gains one line for this: `if (id === 'ops.arrangement') return phone ? 'single-scrolling-column' : 'fixed-grid';`, and `startDrive` serves both fixtures: `documents: { 'Spaces/49ers': FIXTURE, 'Spaces/metrics': METRICS }` with `METRICS` read the same way as `FIXTURE`.

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test --test-concurrency=1 test-browser/genui-decide.test.js`
Expected: FAIL before Task 5's wiring would have made `/genui/decide` exist; after Task 5 it should pass on the first run. If it fails on `waitForFunction` timing out, the page is not receiving the `changed` channel — check that `writeOps` was called with `client: 'genui'` (the echo rule sends to everyone except the writing client, and `'genui'` is no page).

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-concurrency=1 test-browser/genui-decide.test.js`
Expected: 1 passing.

- [ ] **Step 5: Run the full browser suite**

Run: `npm run test:browser 2>&1 | tail -5`
Expected: the pre-existing count plus 1, all passing.

- [ ] **Step 6: Commit**

```bash
git add test-browser/harness.js test-browser/genui-decide.test.js
git commit -m "genui: the page moves — a decide flips the live document, no reload, and a re-decide flips it back.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The inspector — `Decide.mrbl`

**Files:**
- Create: `drive/Research/TypeSafe AI/Decide.mrbl` (untracked; drive is gitignored — nothing to commit; the deliverable is the file and a screenshot)
- Modify: `drive/Research/TypeSafe AI/Monitor.mrbl` — one rail link (`data-go-doc`) under "Live test"

**Interfaces:**
- Consumes: `GET /docs`, `GET /genui/space?doc=`, `POST /genui/decide` (with `dry`).
- Produces: Monitor's "Sandbox" stage, minimal: pick a document, set context, Preview or Decide, read per-decision bars.

The document follows Monitor's shell so it reads as the same research file. Copy Monitor's stylesheet and affordance script verbatim (they are the document's own, not the host's), then write the rest.

- [ ] **Step 1: Start from Monitor's shell**

```bash
cd "drive/Research/TypeSafe AI"
node -e '
const fs=require("fs");
const src=fs.readFileSync("Monitor.mrbl","utf8");
const css=src.match(/<style data-marble-id="css">[\s\S]*?<\/style>/)[0];
const aff=src.match(/<script data-marble-id="affordance">[\s\S]*?<\/script>/)[0];
fs.writeFileSync("/tmp/decide-parts.json", JSON.stringify({css,aff}));
console.log("css",css.length,"aff",aff.length);'
```

Expected: two lengths printed. These two blocks are pasted where marked below.

- [ ] **Step 2: Write `Decide.mrbl`**

Facts in the file: `data-doc` (which document), `data-viewport`, `data-items`, `data-stop` on `<body>`/the dial; the free-text signal is an editable paragraph. Everything the server returns is rendered into a `data-marble-transient` container — a record on the host, not document state.

```html
<!doctype html>
<html lang="en" data-marble="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="marble:capabilities" content="storage">
<title>Decide</title>
<!-- PASTE Monitor's <link rel="icon" …> line here -->
<!-- PASTE Monitor's <style data-marble-id="css"> … </style> here -->
<style data-marble-id="decide-css">
.pick { display: grid; gap: 10px; }
.pick select, .pick input { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--hair); border-radius: var(--r-2); padding: 8px 10px; width: 100%; }
.ctx { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.ctx .box { background: var(--card); border: 1px solid var(--hair); border-radius: var(--r); padding: 14px 16px; }
.ctx h3 { font-size: 14px; margin: 0 0 8px; }
.signal { min-height: 3.2rem; padding: 8px 10px; border: 1px dashed var(--hair); border-radius: var(--r-2); color: var(--ink-2); font-size: 13.4px; }
.run-row { display: flex; gap: 8px; align-items: center; margin: 10px 0 18px; }
.run-row button { padding: 9px 14px; border-radius: var(--r-2); font: 600 13.5px/1.3 var(--sans); background: var(--sunk); color: var(--ink-2); border: 1px solid var(--hair); }
.run-row button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.run-row .ms { margin-left: auto; font: 600 12px/1 var(--mono); color: var(--muted); }
.results { display: grid; gap: 10px; }
.decision { background: var(--card); border: 1px solid var(--hair); border-left: 3px solid var(--faint); border-radius: var(--r-2); padding: 12px 15px; display: grid; grid-template-columns: 1fr 5.5rem; gap: 6px 12px; }
.decision[data-reason="applied"] { border-left-color: var(--accent); }
.decision[data-reason="kept-low-confidence"] { border-left-color: var(--warn); }
.decision[data-reason="kept-unchanged"] { border-left-color: var(--good); }
.decision .who { font: 600 13.5px/1.3 var(--serif); }
.decision .why { font-size: 12px; color: var(--muted); }
.decision .conf { text-align: right; font: 600 12px/1 var(--mono); color: var(--ink-2); }
.decision .bars { grid-column: 1 / -1; }
.empty { color: var(--faint); font-style: italic; }
.issues { color: var(--critical); font: 12.5px/1.5 var(--mono); white-space: pre-wrap; }
</style>
</head>
<body data-marble-id="body" data-doc="Research/TypeSafe AI/Spaces/49ers" data-viewport="desktop" data-items="6">
  <nav class="rail" data-marble-id="rail">
    <span class="kicker" data-marble-id="kicker">TypeSafe AI</span>
    <div class="rail-title" data-marble-id="rt">Decide</div>
    <p class="rail-sub" data-marble-id="rs">Monitor's Sandbox stage. Pick an app space, set the context, and watch Jev position it. The other document moves; this one records.</p>
    <p class="rail-group" data-marble-id="rg1">Map</p>
    <button type="button" class="run-link" data-marble-id="open-monitor" data-go-doc="Research/TypeSafe AI/Monitor">Open Monitor</button>
    <p class="rail-group" data-marble-id="rg2">Target</p>
    <button type="button" class="run-link" data-marble-id="open-target" data-go-doc="">Open the app space</button>
    <p class="rail-note" data-marble-id="rn">Decide writes into the target through the host. Preview asks and writes nothing.</p>
  </nav>
  <main class="col" data-marble-id="page">
    <div class="reading" data-marble-id="reading">
      <header class="vhead" data-marble-id="mast">
        <h1 data-marble-id="h1" data-marble-editable>Position an app space</h1>
        <p class="lede" data-marble-id="lede" data-marble-editable>The document already holds every option. One TypeSafe request picks a position on each declared dimension; the host writes the picks into the file; the open page moves. No LLM in the path.</p>
      </header>

      <section id="target" data-marble-id="target">
        <h2 data-marble-id="target-h" data-marble-editable>Which document</h2>
        <div class="pick" data-marble-id="pick">
          <select id="doc-pick" data-marble-transient aria-label="Which document"></select>
          <div id="space-summary" data-marble-transient class="empty">Choose a document that carries data-genui.</div>
        </div>
      </section>

      <section id="context" data-marble-id="context">
        <h2 data-marble-id="ctx-h" data-marble-editable>Context</h2>
        <div class="ctx" data-marble-id="ctx">
          <div class="box" data-marble-id="ctx-viewport">
            <h3 data-marble-id="ctx-vh" data-marble-editable>Viewport</h3>
            <div class="paths" data-marble-id="vp-paths">
              <span data-marble-id="vp-pick" data-marble-choose="data-viewport" data-marble-of="body">
                <button type="button" id="vp-phone" data-marble-id="vp-phone" data-marble-value="phone" data-marble-instruction="Decide as if on a phone.">Phone</button>
                <button type="button" id="vp-tablet" data-marble-id="vp-tablet" data-marble-value="tablet" data-marble-instruction="Decide as if on a tablet.">Tablet</button>
                <button type="button" id="vp-desktop" data-marble-id="vp-desktop" data-marble-value="desktop" data-marble-instruction="Decide as if on a desktop.">Desktop</button>
              </span>
            </div>
          </div>
          <div class="box" data-marble-id="ctx-items">
            <h3 data-marble-id="ctx-ih" data-marble-editable>Items in the collection</h3>
            <div class="dial" data-marble-id="items-dial">
              <button type="button" data-marble-id="items-down" data-marble-step="data-items:1:60" data-marble-by="-5" data-marble-of="body" data-marble-instruction="Fewer items.">−</button>
              <div><div class="read" id="items-read" data-marble-transient aria-live="polite"></div><p class="cap" data-marble-id="items-cap">items</p></div>
              <button type="button" data-marble-id="items-up" data-marble-step="data-items:1:60" data-marble-by="5" data-marble-of="body" data-marble-instruction="More items.">+</button>
            </div>
          </div>
          <div class="box" data-marble-id="ctx-signal" style="grid-column: 1 / -1">
            <h3 data-marble-id="ctx-sh" data-marble-editable>What the person said or did</h3>
            <p class="signal" data-marble-id="signal" data-marble-editable data-ph="e.g. keeps opening the series record; is on the train">I care most about how we do against each opponent.</p>
          </div>
          <div class="box" data-marble-id="ctx-stop">
            <h3 data-marble-id="ctx-sth" data-marble-editable>Stop threshold</h3>
            <div class="dial" data-marble-id="dial" data-stop="75">
              <button type="button" data-marble-id="dial-down" data-marble-step="data-stop:50:95" data-marble-by="-5" data-marble-of=".dial" data-marble-instruction="Lower the stop threshold by 0.05.">−</button>
              <div><div class="read" data-marble-id="dial-read" aria-live="polite"></div><p class="cap" data-marble-id="dial-cap">applied at or above</p></div>
              <button type="button" data-marble-id="dial-up" data-marble-step="data-stop:50:95" data-marble-by="5" data-marble-of=".dial" data-marble-instruction="Raise the stop threshold by 0.05.">+</button>
            </div>
          </div>
        </div>
        <div class="run-row" data-marble-transient>
          <button type="button" id="preview">Preview</button>
          <button type="button" id="decide" class="primary">Decide</button>
          <span class="ms" id="ms"></span>
        </div>
      </section>

      <section id="results" data-marble-id="results-sec">
        <h2 data-marble-id="res-h" data-marble-editable>What Jev decided</h2>
        <div class="results" id="results" data-marble-transient><p class="empty">Nothing yet.</p></div>
      </section>

      <section id="notes" data-marble-id="notes">
        <h2 data-marble-id="notes-h" data-marble-editable>Notes on runs</h2>
        <p data-marble-id="n1" data-marble-editable>G4 lives here: for each context, was the first show one a designer would recognize? Write it down next to the confidences.</p>
      </section>
    </div>
  </main>

  <!-- PASTE Monitor's <script data-marble-id="affordance"> … </script> here -->

  <script data-marble-id="pagejs">
(() => {
  const body = document.body;
  const $ = (id) => document.getElementById(id);

  const stopOf = () => Number(document.querySelector('.dial[data-stop]')?.getAttribute('data-stop') ?? 75) / 100;
  const contextOf = () => ({
    viewport: body.getAttribute('data-viewport') || 'desktop',
    items: Number(body.getAttribute('data-items') || 0),
    signal: (document.querySelector('[data-marble-id="signal"]')?.textContent || '').trim(),
  });

  function deriveReads() {
    const items = $('items-read');
    if (items) items.textContent = body.getAttribute('data-items') || '';
    const stop = document.querySelector('[data-marble-id="dial-read"]');
    if (stop) stop.textContent = stopOf().toFixed(2);
    const target = document.querySelector('[data-marble-id="open-target"]');
    if (target) target.setAttribute('data-go-doc', body.getAttribute('data-doc') || '');
  }

  async function loadDocs() {
    const pick = $('doc-pick');
    if (!pick) return;
    let docs = [];
    try { docs = await (await fetch('/docs')).json(); } catch { docs = []; }
    const current = body.getAttribute('data-doc') || '';
    pick.replaceChildren(...docs.map((d) => {
      const o = document.createElement('option');
      o.value = d.path; o.textContent = d.path; o.selected = d.path === current;
      return o;
    }));
    pick.addEventListener('change', () => {
      const id = window.marble?.id(body);
      body.setAttribute('data-doc', pick.value);
      if (id) window.marble.op({ type: 'setAttr', id, name: 'data-doc', value: pick.value });
      deriveReads();
      loadSpace();
    });
    loadSpace();
  }

  async function loadSpace() {
    const out = $('space-summary');
    const doc = body.getAttribute('data-doc') || '';
    if (!out || !doc) return;
    out.className = 'empty'; out.textContent = 'Reading…';
    const res = await fetch(`/genui/space?doc=${encodeURIComponent(doc)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { out.className = 'issues'; out.textContent = data.error || `HTTP ${res.status}`; return; }
    if (!data.validation.ok) {
      out.className = 'issues';
      out.textContent = data.validation.issues.map((i) => `${i.kind}  ${i.instance ?? '-'}.${i.key ?? '-'}  ${i.message}`).join('\n');
      return;
    }
    const n = data.space.instances.reduce((s, i) => s + i.decisions.length, 0);
    out.className = '';
    out.textContent = `${data.space.instances.map((i) => `${i.pattern}#${i.name}`).join(' · ')} — ${n} decisions, valid.`;
  }

  function render(result) {
    const box = $('results');
    if (!box) return;
    box.replaceChildren(...result.decisions.map((d) => {
      const el = document.createElement('article');
      el.className = 'decision';
      el.setAttribute('data-reason', d.reason);
      const q = result.questions?.[d.id];
      const probs = result.answers?.[d.id]?.probabilities ?? {};
      const bars = Object.keys(q?.criteria ?? {}).map((slug) => {
        const p = Number(probs[slug] ?? 0);
        return `<div class="bar"><span>${slug}</span><span class="track"><i class="fill" style="width:${Math.round(p * 100)}%"></i></span><span class="n">${p.toFixed(2)}</span></div>`;
      }).join('');
      el.innerHTML = `<div class="who">${d.id}</div><div class="conf">${d.confidence == null ? '–' : d.confidence.toFixed(2)}</div>` +
        `<div class="why">${d.current ?? '–'}${d.choice && d.choice !== d.current ? ` → ${d.choice}` : ''} · ${d.reason}</div><div></div>` +
        `<div class="bars">${bars}</div>`;
      return el;
    }));
    const ms = $('ms');
    if (ms) ms.textContent = `${result.elapsedMs} ms${result.dry ? ' · preview' : ` · wrote ${result.applied}`}`;
  }

  async function run(dry) {
    const doc = body.getAttribute('data-doc') || '';
    const box = $('results');
    if (box) box.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: dry ? 'Asking…' : 'Deciding…' }));
    const res = await fetch('/genui/decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc, dry, stop: stopOf(), context: contextOf() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (box) box.replaceChildren(Object.assign(document.createElement('p'), { className: 'issues', textContent: data.issues ? data.issues.map((i) => `${i.kind}  ${i.message}`).join('\n') : (data.message || data.error || `HTTP ${res.status}`) }));
      return;
    }
    // The route's response omits questions/answers; fetch the shape once so bars have names.
    const space = await (await fetch(`/genui/space?doc=${encodeURIComponent(doc)}`)).json();
    data.questions = Object.fromEntries(space.space.instances.flatMap((i) => i.decisions.map((d) => [`${i.name}.${d.key}`, { criteria: Object.fromEntries(d.options.map((o) => [o.slug, o.gloss])) }])));
    data.answers = Object.fromEntries(data.decisions.map((d) => [d.id, { probabilities: d.probabilities ?? (d.choice ? { [d.choice]: d.confidence ?? 0 } : {}) }]));
    render(data);
  }

  $('preview')?.addEventListener('click', () => run(true));
  $('decide')?.addEventListener('click', () => run(false));
  document.addEventListener('click', () => requestAnimationFrame(deriveReads));
  document.querySelectorAll('[data-go-doc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-go-doc');
      if (name && window.marble?.href) location.href = window.marble.href(name);
    });
  });

  deriveReads();
  loadDocs();
  const boot = (marble) => { marble.register?.(deriveReads); };
  if (window.marble) boot(window.marble);
  else addEventListener('marble:ready', (e) => boot(e.detail || window.marble), { once: true });
})();
  </script>
</body>
</html>
```

To make the bars honest, extend the route's `decisions[]` rows with the model's distribution: in `server/genui/decide.js` `answersToOps`, after `row.confidence = …`, add `row.probabilities = answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : null;` and add `probabilities: null` to the initial `row`. Update `test/genui-decide.test.js`'s first test to assert `d.probabilities['pop-up'] === 0.9`. Rerun `node --test test/genui-decide.test.js`.

- [ ] **Step 3: Link it from Monitor's rail**

In `Monitor.mrbl`, directly after the `open-run` button:

```html
    <button type="button" class="run-link" data-marble-id="open-decide" data-go-doc="Research/TypeSafe AI/Decide">Open Decide</button>
```

The host is serving; one write, then verify the file still parses (`node -e` tag-balance check from earlier in this branch's history, or `grep -c 'data-marble-id="open-decide"'` = 1).

- [ ] **Step 4: Open it and look**

With the host running: `http://127.0.0.1:4400/a/Research%2FTypeSafe%20AI%2FDecide`. The document list should include `Research/TypeSafe AI/Spaces/49ers`; choosing it shows "Overview–detail#games · Card#game-card — 8 decisions, valid." Preview asks with the real key (one TypeSafe request — this is Bryan's call). Take a screenshot with the Playwright script used for Monitor's json-render section and attach it to the task report.

- [ ] **Step 5: Commit the one tracked change**

```bash
git add server/genui/decide.js test/genui-decide.test.js
git commit -m "genui: carry the distribution on each decision so an inspector can draw it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Stage A — the author skill

**Files:**
- Create: `agent/skills/genui-author/SKILL.md`
- Test: manual (one real agent turn, spends subscription — **Bryan runs this**); the acceptance is `marble-drive genui space` printing `ok` on what the agent wrote.

**Interfaces:**
- Consumes: the app-space contract (Task 2), the CLI (Task 6), the Atlas at `drive/Research/Design Pattern Generation/`.

- [ ] **Step 1: Write the skill**

`agent/skills/genui-author/SKILL.md`:

```markdown
---
name: genui-author
description: Author an app space — a Marble document whose design decisions are attributes with every option already implemented — so Jev can position it in one round trip. Use when asked to generate a UI, build a widget, or make an app space from a prompt.
---

# Author an app space

You are writing a `.mrbl` for Jev to decide inside. Jev never generates; it
picks one of the options you implemented. So the document must hold every
option, and declare them. Read `build-in-marble` first — every rule there holds.

## The contract

1. **Instance roots.** Each pattern instance is one element with
   `data-genui="<atlas-id>#<name>"` and a `data-marble-id`. Nested instances
   (a card inside a grid) are their own roots. Names are unique in the file.
2. **One sentence about it:** `data-genui-about="…"` — what this instance shows.
3. **Facts:** for each design decision you want Jev to make, one attribute on
   the root: `data-<key>="<slug>"`, where `<key>` is the Atlas sub-dimension key
   in kebab case (`openIn` → `data-open-in`). The value is the authored default.
4. **Declarations:** `data-genui-<key>="slug | slug: gloss | …"`. A slug that
   matches an Atlas variation (slugified) needs no gloss. A preset you invented
   (for a `sel: many` sub-dimension like attribute placement or density) needs
   `slug: gloss`. Two or more options, or it is not a decision.
5. **Implement every option.** A CSS rule with `[data-<key>="<slug>"]`, scoped
   under the root, or a `<marble-alt>` with a `data-marble-alt="<slug>"` child.
   Unimplemented options are refused by the validator.
6. **Bind content by role; never author content strings the data supplies.**
   Sample data is fine; invented copy in place of a data path is not.
7. `data-genui-request="<the prompt>"` on `<body>`.

## How to choose

- Pick the root pattern the way `genui/prompt.md` says: archetype → pattern,
  from `drive/Research/Design Pattern Generation/schemas/<id>.schema.json`.
  The root set you choose from is Monitor's Wave 3 list, not all 60:
  `overview-detail`, `inbox`, `kanban-board`, `search-results`, `dashboard`,
  `chart`, `form`, `wizard`, `settings`, `ai-chat`, `calendar`,
  `media-player`, `checkout`. A checkout prompt is not forced through
  overview–detail. A prompt that names an activity rather than a widget goes
  through the archetype first (`taxonomy.json`), then its patterns. Prefer
  coded evidence when two fit equally.
- Spawn a child instance only from the pattern's `relations.uses`, and only when
  a variation you implemented needs it (open-in = pop-up needs a modal; a grid
  needs a card).
- Make a sub-dimension live only if a reasonable person or context would move
  it. Everything else: one authored value, no declaration.
- Two to six options per live decision. More is a menu, not a decision.

## Verify before you stop

```
node bin/marble-drive.js genui space "<doc path>"
```
must print `ok`. Fix every issue in the document — never by weakening the
declaration.

```
node bin/marble-drive.js genui decide "<doc path>" --dry --context='{"viewport":"phone","items":6}'
```
Read the confidences. A decision near uniform means the options are
indistinguishable from their glosses, or the dimension should not be live.
Fix the document. Do not add a question, a split, or a longer gloss to paper
over a space that is not a space.

Say what you made in three lines: the instances, the live decisions, and the
one you are least sure Jev can tell apart.
```

- [ ] **Step 2: Register the skill the way `typesafe-ai` is registered**

Run: `grep -rn "typesafe-ai" server/agent/instructions.js server/agent/*.js | head` and mirror whatever lists skill directories (if skills are discovered by directory, nothing to do). Expected: `agent/skills/genui-author/` is picked up the same way.

- [ ] **Step 3: The real run — Bryan's call**

From Agents.mrbl, in the Marble Drive project, a conversation: *"Use genui-author. Create a UI widget that shows San Francisco 49ers games — upcoming and recent — and how the 49ers are doing against each opponent. Write it to Research/TypeSafe AI/Spaces/49ers-authored."* Acceptance: `marble-drive genui space "Research/TypeSafe AI/Spaces/49ers-authored"` prints `ok`; Decide.mrbl can preview it.

- [ ] **Step 4: Commit**

```bash
git add agent/skills/genui-author/SKILL.md
git commit -m "genui: the author skill — Stage A is an agent turn that writes an app space and checks it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- §1 goals: G1 is measured by `elapsedMs` (Task 4/5) and printed by the CLI (Task 6); G2 is asserted by the static-read test (Task 4); G3 is the browser test (Task 7); G4 is the inspector's notes section (Task 8).
- §3 contract: extract/validate (Task 2), slug and key rules (Task 1), `data-genui-request` (Task 2 fixture + extract).
- §4.1–4.5: Tasks 2, 3, 4, 5, 1 respectively. The record file is Task 5.
- §5 skill: Task 9. §6 inspector: Task 8. §7 fixture: Task 2 + seeded in Task 6 step 4. §8 tests: Tasks 1–5, 7. §9 files: all present; `bin` is Task 6.
- §12.3 (don't block the peer's fast-forward): Task 0 branches.
- Type consistency: `Space`, `Instance`, `Decision` shapes are identical in Tasks 2, 3, 4; `questionId` is defined in Task 3 and used in Task 4; `decideDocument`'s return in Task 4 matches what Task 5 reads (`state.request`, `decisions`, `ops`, `elapsedMs`, `usage`) and what Task 6 prints; `probabilities` on decision rows is added in Task 8 step 2 and asserted there.
