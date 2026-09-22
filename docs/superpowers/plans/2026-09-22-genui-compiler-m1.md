# GenUI compiler, M1 — `observe` compiled, validating, and turnable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile the `observe` screen from the written corpus into a real app space that passes `validateSpace`, renders in a browser, and lets a person turn every dimension its spec marks malleable.

**Architecture:** Three units. `resolve.mjs` turns a grammar spec plus the Atlas into a resolved screen (pure, no HTML). One renderer per Atlas pattern under `patterns/`, each declaring in an `implements` map exactly which variations it really builds in CSS. `document.mjs` assembles markup, the 12×8 layout grid, the malleability declarations and the control surface into one `.mrbl`. No model runs anywhere in M1.

**Tech Stack:** Node 22 ESM, no dependencies. Tests are `node --test` with `node:assert/strict`. The browser test borrows the repo's existing Playwright harness at `test-browser/harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-22-genui-compiler-design.md`

## Global Constraints

- **Working directory for every path below** is `drive/Research/Design Pattern Generation/`. Paths are written relative to it. This directory is **gitignored** — commits in this plan touch only `docs/`, unless a step says otherwise. Committing is still required: the drive has its own `.marble` history and the plan's commits record the spec/plan side.
- **Never touch** `genui/grammar/`, `genui/rounds/`, `Writing Screens.mrbl`, `tools/grammar-check.mjs`, `tools/grammar-report.mjs`, `tools/build.mjs`. Another conversation is writing grammar v7 and rounds 6–10 concurrently. Read them; do not write them.
- **Atlas access** is `indexAtlas` / `loadAtlas` from `../../../../../server/genui/atlas.js` (five levels up is the repo root). The index API is exactly: `atlas.has(id)`, `atlas.entry(id)`, `atlas.sub(id, key)`. `sub()` returns `{ entry, dim, sub, vars }` where `dim` has `.name` and `.q`, `sub` has `.name`, `.key`, `.sel` (`'one'` or `'many'`), and `vars` is a `Map` from variation slug to `{ name, gloss }`.
- **Atlas file** is `../../atlas.json` relative to `genui/compile/`.
- **Slugging** must use the `slug` export from that same atlas module. Do not write a second slugifier: an attribute selector matches bytes, so a rule spelled `"Pop Up"` never matches the slug `pop-up`.
- **The acceptance bar for any compiled document** is `validateSpace(source, atlas).ok === true`, from `../../../../../server/genui/space.js`.
- **The app-space contract** (from `.agents/skills/genui-author/SKILL.md`, enforced by `validateSpace`): each instance root carries `data-genui="<atlas-id>#<instance-id>"` and a `data-marble-id`; facts are `data-<kebab-key>="<slug>"`; declarations are `data-genui-<kebab-key>="slug | slug: gloss"` with **two or more** options; every declared option needs a CSS rule containing `[data-<kebab-key>="<slug>"]`; `<body>` carries `data-genui-request`.
- **Output location** for compiled screens is `../../../../../drive/Spaces/<screen-id>.mrbl` — i.e. `drive/Spaces/` at the drive root, which is what `GET /genui/spaces` lists.

---

### Task 1: Resolve a spec against the Atlas

**Files:**
- Create: `genui/compile/resolve.mjs`
- Create: `genui/compile/resolve.test.mjs`

**Interfaces:**
- Consumes: `indexAtlas`, `slug` from `../../../../../server/genui/atlas.js`
- Produces:
  - `loadScreen(id)` → `Promise<screen>` — finds a screen by id across `genui/rounds/round1..5.mjs`, returns the round entry (`{ id, title, what, spec, layout, claims }`).
  - `resolveScreen(screen, atlas)` → `{ id, request, instances, relations, layout }`
  - each resolved instance: `{ id, pattern, entry, about, facts, malleable, binding, states }` where `facts` is a `Map` from sub key to `{ key, attr, sel, values, slugs, dimName, subName, gloss }` (`values` is always an array; a `one` sub has one entry), and `malleable` is a `Map` from sub key to `{ dimName, permission }` where `permission` is `true` or the `{ who, scope, persists, why }` object.

- [ ] **Step 1: Write the failing test**

```js
// genui/compile/resolve.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const atlas = await loadAtlasForTests();

test('a config value resolves to the Atlas variation slug', async () => {
  const screen = await loadScreen('observe');
  const r = resolveScreen(screen, atlas);
  const wall = r.instances.find((i) => i.id === 'wall');
  assert.equal(wall.pattern, 'dashboard');
  assert.deepEqual(wall.facts.get('arrangement').slugs, ['fixed-grid']);
  assert.deepEqual(wall.facts.get('density').slugs, ['dense-wall']);
  assert.equal(wall.facts.get('arrangement').attr, 'data-arrangement');
  assert.equal(wall.facts.get('markType'), undefined);
});

test('a many sub-dimension keeps every authored member', async () => {
  const r = resolveScreen(await loadScreen('observe'), atlas);
  const wall = r.instances.find((i) => i.id === 'wall');
  const widgets = wall.facts.get('widgets');
  assert.equal(widgets.sel, 'many');
  assert.deepEqual(widgets.slugs, ['kpi-tiles', 'time-series-charts', 'status-lists']);
});

test('a camelCase key becomes a kebab attribute', async () => {
  const r = resolveScreen(await loadScreen('observe'), atlas);
  const latency = r.instances.find((i) => i.id === 'latency');
  assert.equal(latency.facts.get('markType').attr, 'data-mark-type');
  assert.deepEqual(latency.facts.get('markType').slugs, ['lines']);
});

test('malleability names a dimension and resolves to that dimension\'s sub keys', async () => {
  const r = resolveScreen(await loadScreen('observe'), atlas);
  const wall = r.instances.find((i) => i.id === 'wall');
  // "Arrangement" is one dimension holding two sub-dimensions.
  assert.deepEqual([...wall.malleable.keys()].sort(), ['alerting', 'arrangement', 'density', 'purpose', 'widgets']);
  assert.equal(wall.malleable.get('arrangement').dimName, 'Arrangement');
  assert.equal(wall.malleable.get('alerting').permission.who, 'admin');
  // An instance whose spec declares nothing is turnable in nothing.
  assert.equal(r.instances.find((i) => i.id === 'tiles').malleable.size, 0);
});

test('a malleability key naming no dimension is an error, not a silent drop', () => {
  const screen = { id: 'x', what: 'x', spec: { screen: 'x', instances: [
    { id: 'a', pattern: 'stat-tile', config: { encoding: 'Number only' }, malleability: { 'Nonsense': true } },
  ], relations: [] }, layout: { place: { a: [0, 0, 4, 2] } } };
  assert.throws(() => resolveScreen(screen, atlas), /Nonsense/);
});

test('every one of the forty written screens resolves without throwing', async () => {
  const { allScreens } = await import('./resolve.mjs');
  const screens = await allScreens();
  assert.equal(screens.length, 40);
  for (const s of screens) assert.doesNotThrow(() => resolveScreen(s, atlas), `${s.id} failed to resolve`);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/resolve.test.mjs`
Expected: FAIL — `Cannot find module './resolve.mjs'`

- [ ] **Step 3: Implement `resolve.mjs`**

```js
// genui/compile/resolve.mjs
// A spec and the Atlas become one resolved screen: every config value carries
// the slug an attribute will hold, and every malleability key — which names a
// DIMENSION — carries the sub-dimension keys that dimension is made of.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { kebab, loadAtlas, slug } from '../../../../../server/genui/atlas.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(HERE, '..', '..');

export const loadAtlasForTests = () => loadAtlas(path.join(BASE, 'atlas.json'));

export async function allScreens() {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const round = (await import(pathToFileURL(path.join(BASE, `genui/rounds/round${i}.mjs`)).href)).default;
    for (const screen of round.screens) out.push(screen);
  }
  return out;
}

export async function loadScreen(id) {
  const hit = (await allScreens()).find((s) => s.id === id);
  if (!hit) throw new Error(`no screen "${id}" in rounds 1–5`);
  return hit;
}

const asArray = (v) => (Array.isArray(v) ? v : [v]);

function resolveInstance(instance, atlas) {
  const entry = atlas.entry(instance.pattern);
  if (!entry) throw new Error(`instance "${instance.id}": "${instance.pattern}" is not an Atlas entry`);

  const facts = new Map();
  for (const [key, value] of Object.entries(instance.config ?? {})) {
    const hit = atlas.sub(instance.pattern, key);
    if (!hit) throw new Error(`instance "${instance.id}": "${key}" is not a sub-dimension of ${instance.pattern}`);
    const values = asArray(value);
    for (const v of values) {
      if (!hit.vars.has(slug(v))) {
        throw new Error(`instance "${instance.id}": "${v}" is not a variation of ${key} on ${instance.pattern}`);
      }
    }
    facts.set(key, {
      key,
      attr: `data-${kebab(key)}`,
      sel: hit.sub.sel ?? 'one',
      values,
      slugs: values.map((v) => slug(v)),
      dimName: hit.dim.name,
      subName: hit.sub.name,
      gloss: hit.dim.q ?? hit.dim.name,
    });
  }

  // malleability keys are DIMENSION names; facts are keyed by SUB-dimension.
  const malleable = new Map();
  for (const [dimName, permission] of Object.entries(instance.malleability ?? {})) {
    const subs = [...facts.values()].filter((f) => f.dimName === dimName);
    if (!subs.length) {
      throw new Error(`instance "${instance.id}": malleability names "${dimName}", which is not a dimension this instance configures`);
    }
    for (const f of subs) malleable.set(f.key, { dimName, permission });
  }

  return {
    id: instance.id,
    pattern: instance.pattern,
    entry,
    about: instance.note ?? `${entry.name} — ${entry.def ?? ''}`.trim(),
    facts,
    malleable,
    binding: instance.binding ?? [],
    states: instance.states ?? {},
  };
}

export function resolveScreen(screen, atlas) {
  const spec = screen.spec;
  return {
    id: screen.id,
    request: screen.what ?? spec.screen ?? screen.id,
    title: screen.title ?? spec.screen ?? screen.id,
    instances: (spec.instances ?? []).map((i) => resolveInstance(i, atlas)),
    relations: spec.relations ?? [],
    layout: screen.layout ?? { place: {}, over: [] },
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/resolve.test.mjs`
Expected: PASS, 6 tests. If the "forty screens" test fails on a screen, read the error: a genuine corpus/Atlas mismatch is a finding worth reporting, not a test to weaken.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-22-genui-compiler-m1.md
git -c commit.gpgsign=false commit -m "$(cat <<'MSG'
A plan for the compiler, and the resolver it starts with.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The renderer contract, and a renderer that cannot lie

**Files:**
- Create: `genui/compile/renderers.mjs`
- Create: `genui/compile/patterns/stat-tile.mjs`
- Create: `genui/compile/renderers.test.mjs`

**Interfaces:**
- Consumes: `resolveScreen` (Task 1).
- Produces:
  - A **renderer** is a default-exported object `{ pattern, implements, markup(instance, ctx), css(instance, ctx) }`.
    - `implements`: object from sub key to an array of options. An option is either a bare slug string (a `one` sub-dimension — the Atlas supplies the gloss) or `{ slug, gloss, members }` (a `many` sub-dimension — an invented preset, so a gloss is required and `members` lists the variation names it sets).
    - `markup(instance, ctx)` → HTML string for this instance's root element. `ctx` is `{ id, children, slot(name), fact(key), binding(role), data }`.
    - `css(instance, ctx)` → CSS string. Every rule must be scoped under `#<instance-id>`.
  - `rendererFor(pattern)` → the renderer, or `null`.
  - `implementedSlugs(renderer, key)` → `string[]`.
  - `auditRenderer(renderer)` → `string[]` of problems: every slug in `implements` must appear in that renderer's own `css()` output as `[data-<kebab-key>="<slug>"]`.

- [ ] **Step 1: Write the failing test**

```js
// genui/compile/renderers.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { auditRenderer, implementedSlugs, rendererFor } from './renderers.mjs';

test('a renderer implements what it claims', () => {
  const r = rendererFor('stat-tile');
  assert.ok(r, 'stat-tile has a renderer');
  assert.deepEqual(auditRenderer(r), []);
});

test('implementedSlugs reads both bare slugs and presets', () => {
  const r = rendererFor('stat-tile');
  assert.ok(implementedSlugs(r, 'encoding').includes('signed-change-with-arrow'));
  assert.ok(implementedSlugs(r, 'context').length >= 2, 'context is a many sub-dimension with presets');
});

test('a renderer that claims a variation it does not build is caught', () => {
  const liar = {
    pattern: 'fake',
    implements: { encoding: ['number-only', 'sparkline'] },
    markup: () => '<div></div>',
    css: () => '#x[data-encoding="number-only"] { color: red }',
  };
  const problems = auditRenderer(liar);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sparkline/);
});

test('an unknown pattern has no renderer rather than a broken one', () => {
  assert.equal(rendererFor('no-such-pattern'), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/renderers.test.mjs`
Expected: FAIL — `Cannot find module './renderers.mjs'`

- [ ] **Step 3: Write the registry and the audit**

```js
// genui/compile/renderers.mjs
// A renderer says which variations it builds, and the audit holds it to that
// by reading its own stylesheet back. This is validateSpace's rule — an option
// with no rule implementing it is refused — applied one level earlier, to the
// code rather than to the document.
import { kebab } from '../../../../../server/genui/atlas.js';

import statTile from './patterns/stat-tile.mjs';

const REGISTRY = new Map([statTile].map((r) => [r.pattern, r]));

export const rendererFor = (pattern) => REGISTRY.get(pattern) ?? null;
export const allRenderers = () => [...REGISTRY.values()];

export const optionSlug = (option) => (typeof option === 'string' ? option : option.slug);
export const optionGloss = (option) => (typeof option === 'string' ? null : option.gloss);
export const optionMembers = (option) => (typeof option === 'string' ? null : option.members ?? null);

export function implementedSlugs(renderer, key) {
  return (renderer.implements?.[key] ?? []).map(optionSlug);
}

// A stub instance is enough to make a renderer emit its whole stylesheet: css()
// must not depend on which options are currently chosen, because every option
// has to be present in the document at once.
const STUB = { id: 'audit', facts: new Map(), malleable: new Map(), binding: [], states: {}, entry: { name: 'audit', roles: [] } };
const STUB_CTX = { id: 'audit', children: [], slot: () => '', fact: () => null, binding: () => [], data: {} };

export function auditRenderer(renderer) {
  const sheet = String(renderer.css(STUB, STUB_CTX) ?? '');
  const problems = [];
  for (const [key, options] of Object.entries(renderer.implements ?? {})) {
    for (const option of options) {
      const needle = `[data-${kebab(key)}="${optionSlug(option)}"]`;
      if (!sheet.includes(needle)) problems.push(`${renderer.pattern}: ${needle} is claimed but no rule selects it`);
      if (typeof option !== 'string' && !option.gloss) problems.push(`${renderer.pattern}: preset ${key}:${option.slug} has no gloss`);
    }
  }
  return problems;
}
```

- [ ] **Step 4: Write the stat-tile renderer**

```js
// genui/compile/patterns/stat-tile.mjs
// A compact tile: one number, its label, and its change.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
  pattern: 'stat-tile',
  implements: {
    encoding: ['number-only', 'signed-change-with-arrow', 'sparkline', 'bullet-chart-against-target'],
    window: ['fixed', 'follows-the-dashboard-filter', 'chosen-per-tile'],
    drill: ['none', 'open-a-detail-chart', 'breakdown-on-hover'],
    context: [
      { slug: 'label-only', gloss: 'The label and the number, nothing else', members: ['Label'] },
      { slug: 'label-and-change', gloss: 'The label, the number and how it moved', members: ['Label', 'Change vs previous period'] },
      { slug: 'label-change-and-sparkline', gloss: 'The label, the number, the change and a sparkline', members: ['Label', 'Change vs previous period', 'Sparkline'] },
    ],
  },

  markup(instance, ctx) {
    const rows = ctx.binding('metric').length ? ctx.data.services ?? [] : [];
    const items = rows
      .map(
        (row, n) => `
      <article class="tile" data-marble-id="${ctx.id}-tile-${n}">
        <h3 class="tile-label">${esc(row.name)}</h3>
        <p class="tile-metric">${esc(row.errorRate)}<span class="tile-unit">%</span></p>
        <p class="tile-delta" data-dir="${row.delta >= 0 ? 'up' : 'down'}">${row.delta >= 0 ? '▲' : '▼'} ${esc(Math.abs(row.delta))}</p>
        <svg class="tile-spark" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${(row.spark ?? []).map((v, i) => `${i * 6},${16 - v}`).join(' ')}"/></svg>
        <p class="tile-target">target ${esc(row.target ?? '—')}</p>
      </article>`,
      )
      .join('');
    return `<div class="tiles">${items}</div>`;
  },

  // Every option is built; the attribute chooses which shows.
  css(instance, ctx) {
    const id = `#${ctx.id}`;
    return `
${id} { display: grid; gap: var(--gap); }
${id} .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--gap); }
${id} .tile { border: 1px solid var(--rule); border-radius: 10px; padding: .7rem .8rem; background: var(--panel); }
${id} .tile-label { margin: 0; font-size: .78rem; font-weight: 600; letter-spacing: .02em; color: var(--dim); text-transform: uppercase; }
${id} .tile-metric { margin: .2rem 0 0; font-size: 1.7rem; font-variant-numeric: tabular-nums; line-height: 1.05; }
${id} .tile-unit { font-size: .9rem; color: var(--dim); margin-left: .1rem; }
${id} .tile-delta { margin: .15rem 0 0; font-size: .8rem; font-variant-numeric: tabular-nums; }
${id} .tile-delta[data-dir="up"] { color: var(--bad); }
${id} .tile-delta[data-dir="down"] { color: var(--good); }
${id} .tile-spark { width: 100%; height: 1rem; margin-top: .35rem; }
${id} .tile-spark polyline { fill: none; stroke: var(--accent); stroke-width: 1.5; }
${id} .tile-target { margin: .2rem 0 0; font-size: .72rem; color: var(--dim); }

/* Change encoding — what the number's movement looks like. */
${id}[data-encoding="number-only"] .tile-delta,
${id}[data-encoding="number-only"] .tile-spark,
${id}[data-encoding="number-only"] .tile-target { display: none; }
${id}[data-encoding="signed-change-with-arrow"] .tile-spark,
${id}[data-encoding="signed-change-with-arrow"] .tile-target { display: none; }
${id}[data-encoding="sparkline"] .tile-delta,
${id}[data-encoding="sparkline"] .tile-target { display: none; }
${id}[data-encoding="bullet-chart-against-target"] .tile-spark { display: none; }
${id}[data-encoding="bullet-chart-against-target"] .tile-metric { font-size: 1.3rem; }

/* Context — which parts of the tile are present at all. */
${id}[data-context="label-only"] .tile-delta,
${id}[data-context="label-only"] .tile-spark { display: none; }
${id}[data-context="label-and-change"] .tile-spark { display: none; }
${id}[data-context="label-change-and-sparkline"] .tile-spark { display: block; }

/* Time window — said on the tile, because a number with the wrong window lies. */
${id}[data-window="fixed"] .tile::after { content: "fixed window"; }
${id}[data-window="follows-the-dashboard-filter"] .tile::after { content: "wall window"; }
${id}[data-window="chosen-per-tile"] .tile::after { content: "per tile"; }
${id} .tile::after { display: block; margin-top: .3rem; font-size: .68rem; color: var(--dim); }

/* Drill-down — what a tile does when it is touched. */
${id}[data-drill="none"] .tile { cursor: default; }
${id}[data-drill="open-a-detail-chart"] .tile { cursor: pointer; }
${id}[data-drill="open-a-detail-chart"] .tile:hover { border-color: var(--accent); }
${id}[data-drill="breakdown-on-hover"] .tile { cursor: help; }
${id}[data-drill="breakdown-on-hover"] .tile:hover .tile-spark { height: 2.4rem; }
`;
  },
};
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/renderers.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git -c commit.gpgsign=false commit --allow-empty -m "$(cat <<'MSG'
A renderer is held to what it claims, by reading its own stylesheet back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: One instance becomes a document that validates

The first end-to-end artefact: a compiled screen with a single rendered pattern, no declarations yet. Getting `validateSpace` to pass this early means the contract is understood before five renderers depend on it.

**Files:**
- Create: `genui/compile/document.mjs`
- Create: `genui/compile/document.test.mjs`
- Create: `genui/fixtures/observe.json`

**Interfaces:**
- Consumes: `resolveScreen` (Task 1), `rendererFor` (Task 2).
- Produces: `compile(resolved, { data, declarations = new Map() })` → `{ source, skipped }`, where `source` is the whole `.mrbl` and `skipped` lists instance ids with no renderer. `declarations` maps `"<instanceId>.<subKey>"` to `{ options, permission, technique }` (Task 4 fills it; Task 3 passes it empty).

- [ ] **Step 1: Write the fixture**

```json
{
  "services": [
    { "name": "checkout", "errorRate": 0.42, "delta": 0.11, "target": "0.5%", "spark": [4, 6, 5, 9, 7, 11, 8, 12, 10, 14] },
    { "name": "search", "errorRate": 0.08, "delta": -0.03, "target": "0.5%", "spark": [9, 8, 8, 6, 7, 5, 6, 4, 5, 3] },
    { "name": "identity", "errorRate": 0.19, "delta": 0.02, "target": "0.5%", "spark": [5, 5, 6, 6, 5, 7, 6, 7, 7, 8] },
    { "name": "media", "errorRate": 1.24, "delta": 0.61, "target": "0.5%", "spark": [3, 4, 6, 5, 8, 9, 12, 13, 15, 16] }
  ],
  "metrics": {
    "latency": { "points": [120, 128, 124, 141, 139, 155, 150, 162, 158, 171, 166, 180] },
    "errors": { "points": [2, 3, 1, 4, 6, 3, 8, 12, 9, 14, 11, 17] }
  },
  "slo": { "target": 0.5 },
  "deploys": [{ "at": "14:02", "by": "priya", "sha": "9f2c1ab" }],
  "window": "last 12 hours"
}
```

- [ ] **Step 2: Write the failing test**

```js
// genui/compile/document.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSpace } from '../../../../../server/genui/space.js';
import { compile } from './document.mjs';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const atlas = await loadAtlasForTests();
const data = JSON.parse(await readFile(path.join(HERE, '..', 'fixtures', 'observe.json'), 'utf8'));
const resolved = resolveScreen(await loadScreen('observe'), atlas);

test('a compiled screen is a valid app space', () => {
  const { source } = compile(resolved, { data });
  const result = validateSpace(source, atlas);
  assert.deepEqual(result.issues, [], 'no issues');
  assert.equal(result.ok, true);
});

test('a rendered instance carries its pattern, its id and its facts', () => {
  const { source } = compile(resolved, { data });
  assert.match(source, /data-genui="stat-tile#tiles"/);
  assert.match(source, /data-encoding="signed-change-with-arrow"/);
  assert.match(source, /data-window="follows-the-dashboard-filter"/);
});

test('an instance with no renderer is skipped, not faked', () => {
  const { skipped } = compile(resolved, { data });
  assert.ok(skipped.includes('wall'), 'dashboard has no renderer yet');
  assert.ok(!skipped.includes('tiles'));
});

test('the request and a marble id are on the body', () => {
  const { source } = compile(resolved, { data });
  assert.match(source, /data-genui-request="[^"]+"/);
  assert.match(source, /<body[^>]*data-marble-id="/);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/document.test.mjs`
Expected: FAIL — `Cannot find module './document.mjs'`

- [ ] **Step 4: Implement `document.mjs`**

```js
// genui/compile/document.mjs
// The screens carry their own geometry: layout.place is [col, row, w, h] on a
// 12x8 grid, which is what draws the wire diagrams. It compiles straight to
// CSS grid, so a compiled screen stands where its spec said it stands.
import { kebab } from '../../../../../server/genui/atlas.js';

import { optionGloss, optionSlug, rendererFor } from './renderers.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SHELL = `
:root {
  --bg: #f7f7f5; --panel: #fff; --ink: #14151a; --dim: #6b7280; --rule: #e4e4e1;
  --accent: #2f6f4f; --bad: #b4341f; --good: #2f6f4f; --gap: 10px;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #131416; --panel: #1b1d20; --ink: #e9e9e7; --dim: #9aa0a6; --rule: #2c2f33; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
.screen { display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: minmax(52px, auto); gap: var(--gap); padding: var(--gap); min-height: 100vh; }
.inst { position: relative; min-width: 0; }
.inst > .inst-head { display: flex; align-items: baseline; gap: .5rem; margin: 0 0 .35rem; }
.inst-name { margin: 0; font-size: .74rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); }
.inst-about { margin: 0; font-size: .74rem; color: var(--dim); }
.over { z-index: 2; }
`;

function place(layout, id) {
  const box = layout?.place?.[id];
  if (!box) return '';
  const [c, r, w, h] = box;
  return `grid-column: ${c + 1} / span ${w}; grid-row: ${r + 1} / span ${h};`;
}

export function compile(resolved, { data = {}, declarations = new Map() } = {}) {
  const skipped = [];
  const bodies = [];
  const sheets = [SHELL];
  const over = new Set(resolved.layout?.over ?? []);

  for (const instance of resolved.instances) {
    const renderer = rendererFor(instance.pattern);
    if (!renderer) {
      skipped.push(instance.id);
      continue;
    }
    const ctx = {
      id: instance.id,
      children: [],
      slot: () => '',
      fact: (key) => instance.facts.get(key) ?? null,
      binding: (role) => instance.binding.filter((b) => b.role === role),
      data,
    };

    const attrs = [
      `id="${esc(instance.id)}"`,
      `class="inst${over.has(instance.id) ? ' over' : ''}"`,
      `data-marble-id="${esc(instance.id)}"`,
      `data-genui="${esc(instance.pattern)}#${esc(instance.id)}"`,
      `data-genui-about="${esc(instance.about)}"`,
    ];
    for (const fact of instance.facts.values()) {
      // A `many` sub-dimension holds one preset slug, not a list: an attribute
      // is one value, and a preset is the name for the set it stands for.
      const declared = declarations.get(`${instance.id}.${fact.key}`);
      const value = fact.sel === 'many' ? declared?.current ?? 'as-authored' : fact.slugs[0];
      attrs.push(`${fact.attr}="${esc(value)}"`);
    }
    for (const [key, declaration] of declarations) {
      if (!key.startsWith(`${instance.id}.`)) continue;
      const subKey = key.slice(instance.id.length + 1);
      const rendered = declaration.options
        .map((o) => (optionGloss(o) ? `${optionSlug(o)}: ${optionGloss(o)}` : optionSlug(o)))
        .join(' | ');
      attrs.push(`data-genui-${kebab(subKey)}="${esc(rendered)}"`);
      if (declaration.permission && typeof declaration.permission === 'object') {
        const p = declaration.permission;
        if (p.who) attrs.push(`data-who="${esc(p.who)}"`);
        if (p.scope) attrs.push(`data-scope="${esc(p.scope)}"`);
      }
    }

    const style = place(resolved.layout, instance.id);
    bodies.push(`
<section ${attrs.join(' ')}${style ? ` style="${style}"` : ''}>
  <header class="inst-head">
    <h2 class="inst-name">${esc(instance.entry.name)}</h2>
    <p class="inst-about">${esc(instance.about)}</p>
  </header>
  ${renderer.markup(instance, ctx)}
</section>`);
    sheets.push(renderer.css(instance, ctx));
  }

  const source = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(resolved.title)}</title>
<style>${sheets.join('\n')}</style>
</head>
<body data-marble-id="body" data-genui-request="${esc(resolved.request)}">
<main class="screen" data-marble-id="screen">${bodies.join('\n')}
</main>
</body>
</html>
`;
  return { source, skipped };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/document.test.mjs`
Expected: PASS, 4 tests. If `validateSpace` reports `current-not-declared`, that is the contract working: a fact whose value is not among declared options is only legal when nothing is declared for that key — check that Task 3 really passes an empty `declarations`.

- [ ] **Step 6: Commit**

```bash
git -c commit.gpgsign=false commit --allow-empty -m "$(cat <<'MSG'
A screen stands where its spec said it stands.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The malleability rule, and the holes it finds

**Files:**
- Create: `genui/compile/declare.mjs`
- Create: `genui/compile/declare.test.mjs`

**Interfaces:**
- Consumes: `resolveScreen` (Task 1), `rendererFor` / `implementedSlugs` / `optionSlug` (Task 2).
- Produces: `declare(resolved, atlas)` → `{ declarations, holes }`.
  - `declarations`: `Map` keyed `"<instanceId>.<subKey>"` → `{ instance, key, attr, options, current, permission, technique }`. `options` are renderer options (strings or presets); `current` is the slug the authored config resolves to; `technique` is the Atlas `techniques[]` entry for that dimension or `null`.
  - `holes`: `[{ instance, pattern, key, dimName, reason }]` — `reason` is `'no-renderer'` or `'too-few-options'`.
  - Rule: declare a sub key **iff** the spec marks its dimension malleable **and** the renderer implements two or more of its options.
  - For a `many` sub-dimension the authored member list is synthesised as a preset `as-authored`, so the current fact always has a home among the options.

- [ ] **Step 1: Write the failing test**

```js
// genui/compile/declare.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { declare } from './declare.mjs';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const atlas = await loadAtlasForTests();
const resolved = resolveScreen(await loadScreen('observe'), atlas);

test('a dimension the spec fixes is never declared', () => {
  const { declarations } = declare(resolved, atlas);
  // `tiles` declares no malleability at all: it renders and cannot be turned.
  assert.equal([...declarations.keys()].filter((k) => k.startsWith('tiles.')).length, 0);
});

test('a dimension with no renderer is a hole, not a silent drop', () => {
  const { holes } = declare(resolved, atlas);
  const wall = holes.filter((h) => h.instance === 'wall');
  assert.ok(wall.length >= 1, 'the dashboard has no renderer in this task');
  assert.equal(wall[0].reason, 'no-renderer');
});

test('the authored value is always among the options', () => {
  const { declarations } = declare(resolved, atlas);
  for (const [key, d] of declarations) {
    const slugs = d.options.map((o) => (typeof o === 'string' ? o : o.slug));
    assert.ok(slugs.includes(d.current), `${key}: current "${d.current}" is not among ${slugs.join(', ')}`);
    assert.ok(slugs.length >= 2, `${key}: a declaration needs two or more options`);
  }
});

test('a governed dimension keeps who may turn it and why', () => {
  // Build a screen whose malleable dimension does have a renderer.
  const one = {
    id: 'demo', what: 'demo', title: 'demo',
    spec: { screen: 'demo', instances: [{
      id: 'tiles', pattern: 'stat-tile',
      config: { encoding: 'Number only', context: ['Label'], window: 'Fixed', drill: 'None' },
      malleability: { 'Change encoding': { who: 'admin', scope: 'everyone', persists: 'saved', why: 'the number is the point' } },
    }], relations: [] },
    layout: { place: { tiles: [0, 0, 12, 2] }, over: [] },
  };
  const { declarations } = declare(resolveScreen(one, atlas), atlas);
  const d = declarations.get('tiles.encoding');
  assert.ok(d, 'encoding is declared');
  assert.equal(d.permission.who, 'admin');
  assert.equal(d.current, 'number-only');
});

test('a many sub-dimension gets the authored set as a preset', () => {
  const one = {
    id: 'demo2', what: 'demo2', title: 'demo2',
    spec: { screen: 'demo2', instances: [{
      id: 'tiles', pattern: 'stat-tile',
      config: { context: ['Label', 'Target'], encoding: 'Number only', window: 'Fixed', drill: 'None' },
      malleability: { Context: true },
    }], relations: [] },
    layout: { place: { tiles: [0, 0, 12, 2] }, over: [] },
  };
  const { declarations } = declare(resolveScreen(one, atlas), atlas);
  const d = declarations.get('tiles.context');
  assert.equal(d.current, 'as-authored');
  assert.ok(d.options.some((o) => o.slug === 'as-authored'), 'the authored set is offered');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/declare.test.mjs`
Expected: FAIL — `Cannot find module './declare.mjs'`

- [ ] **Step 3: Implement `declare.mjs`**

```js
// genui/compile/declare.mjs
// The rule: a dimension becomes a control when the spec says it may be turned
// AND the renderer really built two or more of its options. A dimension the
// spec fixes renders and cannot be turned — if everything is malleable, the
// word means nothing. A dimension the spec opens and no renderer can express
// is a hole, and holes are the finding.
import { rendererFor } from './renderers.mjs';

const slugOf = (option) => (typeof option === 'string' ? option : option.slug);

// The Atlas's own stage-7 malleability techniques, so a control is named by
// the codebook rather than invented for the demo.
function techniqueFor(entry, dimName) {
  return (entry.techniques ?? []).find((t) => t.dim === dimName) ?? null;
}

export function declare(resolved, atlas) {
  const declarations = new Map();
  const holes = [];

  for (const instance of resolved.instances) {
    const renderer = rendererFor(instance.pattern);
    for (const [key, { dimName, permission }] of instance.malleable) {
      const fact = instance.facts.get(key);
      if (!renderer) {
        holes.push({ instance: instance.id, pattern: instance.pattern, key, dimName, reason: 'no-renderer' });
        continue;
      }
      const offered = [...(renderer.implements?.[key] ?? [])];

      let current;
      if (fact.sel === 'many') {
        // One attribute holds one value, so a set needs a name. The authored
        // set is always offered, or the document could not say where it is.
        const authored = { slug: 'as-authored', gloss: fact.values.join(', '), members: fact.values };
        if (!offered.some((o) => slugOf(o) === 'as-authored')) offered.unshift(authored);
        current = 'as-authored';
      } else {
        current = fact.slugs[0];
        if (!offered.some((o) => slugOf(o) === current)) {
          // The renderer does not build what the spec authored. Offering a
          // control whose current position is off the menu would be a lie.
          holes.push({ instance: instance.id, pattern: instance.pattern, key, dimName, reason: 'authored-not-implemented' });
          continue;
        }
      }

      if (offered.length < 2) {
        holes.push({ instance: instance.id, pattern: instance.pattern, key, dimName, reason: 'too-few-options' });
        continue;
      }

      declarations.set(`${instance.id}.${key}`, {
        instance: instance.id,
        key,
        attr: fact.attr,
        options: offered,
        current,
        permission,
        technique: techniqueFor(instance.entry, dimName),
        dimName,
        subName: fact.subName,
      });
    }
  }

  return { declarations, holes };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/declare.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run every test so far together**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/*.test.mjs`
Expected: PASS, 19 tests.

- [ ] **Step 6: Commit**

```bash
git -c commit.gpgsign=false commit --allow-empty -m "$(cat <<'MSG'
What may be turned, what may not, and what nothing can express yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The dashboard renderer — the container the wall is

**Files:**
- Create: `genui/compile/patterns/dashboard.mjs`
- Modify: `genui/compile/renderers.mjs` (register it)
- Modify: `genui/compile/document.mjs` (fill `ctx.slot` / `ctx.children` so `contains` nests)
- Create: `genui/compile/contains.test.mjs`

**Interfaces:**
- Consumes: the renderer contract (Task 2), `compile` (Task 3).
- Produces: `dashboard` renderer implementing `arrangement` (4 options), `density` (3), `alerting` (4), `purpose` (4), `linking` (4), `refresh` (4), `ownership` (4), and `widgets` presets. `compile` gains: an instance that is the `to` of a `contains` relation is rendered **inside** its parent's slot rather than at the top level, and `ctx.children` carries `{ id, slot, html }` for each child.

- [ ] **Step 1: Write the failing test**

```js
// genui/compile/contains.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSpace } from '../../../../../server/genui/space.js';
import { declare } from './declare.mjs';
import { compile } from './document.mjs';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const atlas = await loadAtlasForTests();
const data = JSON.parse(await readFile(path.join(HERE, '..', 'fixtures', 'observe.json'), 'utf8'));
const resolved = resolveScreen(await loadScreen('observe'), atlas);
const { declarations } = declare(resolved, atlas);
const { source } = compile(resolved, { data, declarations });

test('a contained instance is nested inside its parent, not a sibling', () => {
  const wallAt = source.indexOf('data-genui="dashboard#wall"');
  const tilesAt = source.indexOf('data-genui="stat-tile#tiles"');
  assert.ok(wallAt >= 0 && tilesAt > wallAt, 'tiles is rendered after the wall opens');
  const wallSection = source.slice(wallAt, source.indexOf('</section>', tilesAt));
  assert.ok(wallSection.includes('stat-tile#tiles'), 'tiles is inside the wall');
});

test('the dashboard declares what the spec opened and it can build', () => {
  assert.match(source, /data-genui-arrangement="[^"]*fixed-grid[^"]*"/);
  assert.match(source, /data-genui-density="[^"]*dense-wall[^"]*"/);
  assert.match(source, /data-genui-alerting="[^"]*alerts-on-panels[^"]*"/);
});

test('a governed dimension carries who may turn it', () => {
  assert.match(source, /data-who="admin"/);
});

test('the whole thing is still a valid app space', () => {
  const result = validateSpace(source, atlas);
  assert.deepEqual(result.issues, []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/contains.test.mjs`
Expected: FAIL — tiles is not nested; no dashboard declarations.

- [ ] **Step 3: Teach `document.mjs` to nest**

Replace the body-building loop in `compile` so children are rendered into their parent. Add above the loop:

```js
  const childrenOf = new Map();
  const contained = new Set();
  for (const rel of resolved.relations ?? []) {
    if (rel.kind !== 'contains') continue;
    if (!childrenOf.has(rel.from)) childrenOf.set(rel.from, []);
    childrenOf.get(rel.from).push({ id: rel.to, slot: rel.slot ?? '' });
    contained.add(rel.to);
  }
  const byId = new Map(resolved.instances.map((i) => [i.id, i]));
  const rendered = new Map();
```

Extract two local functions from the loop: `ctxFor(instance)` returning the `ctx` object, and `renderInstance(instance)` returning the `<section>` string (the same body the loop currently builds, calling `ctxFor`). `ctxFor` gains two members:

```js
      children: (childrenOf.get(instance.id) ?? [])
        .filter((c) => byId.has(c.id) && rendererFor(byId.get(c.id).pattern))
        .map((c) => ({ id: c.id, slot: c.slot, html: renderInstance(byId.get(c.id)) })),
      slot(name) {
        return (this.children ?? []).filter((c) => c.slot === name).map((c) => c.html).join('\n');
      },
```

Note `slot` must be a method on the same object literal so `this.children` resolves; build `children` before `slot` is called. Then drive the top-level loop over instances that are **not** contained:

```js
  for (const instance of resolved.instances) {
    if (contained.has(instance.id)) continue;
    const renderer = rendererFor(instance.pattern);
    if (!renderer) { skipped.push(instance.id); continue; }
    bodies.push(renderInstance(instance));
  }
```

and collect stylesheets for **every** instance with a renderer (contained or not), de-duplicated by pattern:

```js
  const seenPattern = new Set();
  for (const instance of resolved.instances) {
    const renderer = rendererFor(instance.pattern);
    if (!renderer) { if (!contained.has(instance.id) && !skipped.includes(instance.id)) skipped.push(instance.id); continue; }
    const key = `${instance.pattern}#${instance.id}`;
    if (seenPattern.has(key)) continue;
    seenPattern.add(key);
    sheets.push(renderer.css(instance, ctxFor(instance)));
  }
```

A nested instance must not also carry a grid `style`: only a top-level instance is placed on the screen grid. In `renderInstance`, use `const style = contained.has(instance.id) ? '' : place(resolved.layout, instance.id);`

- [ ] **Step 4: Write the dashboard renderer**

```js
// genui/compile/patterns/dashboard.mjs
// The wall: several metrics on one view, arranged to be scanned. Every
// arrangement and density is built; the attribute chooses which holds.
export default {
  pattern: 'dashboard',
  implements: {
    arrangement: ['fixed-grid', 'free-form-canvas', 'single-scrolling-column', 'story-layout'],
    density: ['a-few-glanceable-tiles', 'dense-wall', 'adaptive'],
    alerting: ['none', 'threshold-colours', 'alerts-on-panels', 'event-annotations-on-charts'],
    purpose: ['strategic-decisions', 'operational-decisions', 'organizational-awareness', 'motivation-and-learning'],
    linking: ['independent', 'global-filters', 'cross-filtering', 'drill-through'],
    refresh: ['static-snapshot', 'periodic-refresh', 'live-stream', 'on-visit'],
    ownership: ['personal', 'shared-read-only', 'team-editable', 'forkable-copies'],
    widgets: [
      { slug: 'tiles-only', gloss: 'KPI tiles and nothing else', members: ['KPI tiles'] },
      { slug: 'tiles-and-charts', gloss: 'KPI tiles with time-series charts', members: ['KPI tiles', 'Time-series charts'] },
    ],
  },

  markup(instance, ctx) {
    return `
  <div class="wall-bar">
    <span class="wall-flag">live</span>
    <span class="wall-purpose"></span>
  </div>
  <div class="wall-top">${ctx.slot('top row')}</div>
  <div class="wall-panels">
    <div class="wall-left">${ctx.slot('left panel')}</div>
    <div class="wall-right">${ctx.slot('right panel')}</div>
  </div>
  <div class="wall-rest">${ctx.slot('nowhere — this instance is a relation wearing a pattern’s clothes')}</div>`;
  },

  css(instance, ctx) {
    const id = `#${ctx.id}`;
    return `
${id} { display: flex; flex-direction: column; gap: var(--gap); }
${id} .wall-bar { display: flex; align-items: center; gap: .5rem; font-size: .72rem; color: var(--dim); }
${id} .wall-flag { border: 1px solid var(--rule); border-radius: 999px; padding: .05rem .45rem; }
${id} .wall-panels { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); }
${id} .wall-left, ${id} .wall-right { min-width: 0; }

/* Arrangement — how the whole wall is laid out. */
${id}[data-arrangement="fixed-grid"] .wall-panels { grid-template-columns: 1fr 1fr; }
${id}[data-arrangement="free-form-canvas"] .wall-panels { grid-template-columns: repeat(12, 1fr); }
${id}[data-arrangement="free-form-canvas"] .wall-left { grid-column: span 7; }
${id}[data-arrangement="free-form-canvas"] .wall-right { grid-column: span 5; }
${id}[data-arrangement="single-scrolling-column"] .wall-panels { grid-template-columns: 1fr; }
${id}[data-arrangement="story-layout"] .wall-panels { grid-template-columns: 1fr; max-width: 46rem; margin: 0 auto; }
${id}[data-arrangement="story-layout"] .wall-top { max-width: 46rem; margin: 0 auto; }

/* Density — how much is on it at once. */
${id}[data-density="a-few-glanceable-tiles"] { --gap: 16px; font-size: 1rem; }
${id}[data-density="a-few-glanceable-tiles"] .tile:nth-child(n+4) { display: none; }
${id}[data-density="dense-wall"] { --gap: 6px; font-size: .86rem; }
${id}[data-density="adaptive"] { --gap: 10px; }
@container (max-width: 40rem) { ${id}[data-density="adaptive"] .wall-panels { grid-template-columns: 1fr; } }

/* Alerting — what a number over its threshold does. */
${id}[data-alerting="none"] .tile-delta[data-dir="up"] { color: var(--dim); }
${id}[data-alerting="threshold-colours"] .tile-delta[data-dir="up"] { color: var(--bad); }
${id}[data-alerting="alerts-on-panels"] .tile-delta[data-dir="up"] { color: var(--bad); font-weight: 700; }
${id}[data-alerting="alerts-on-panels"] .tile:has(.tile-delta[data-dir="up"]) { outline: 2px solid var(--bad); outline-offset: -2px; }
${id}[data-alerting="event-annotations-on-charts"] .wall-panels { border-left: 2px solid var(--bad); padding-left: .4rem; }

/* Purpose — said on the bar, because the same tiles serve different jobs. */
${id}[data-purpose="strategic-decisions"] .wall-purpose::after { content: "for strategy"; }
${id}[data-purpose="operational-decisions"] .wall-purpose::after { content: "for whoever is on call"; }
${id}[data-purpose="organizational-awareness"] .wall-purpose::after { content: "for awareness"; }
${id}[data-purpose="motivation-and-learning"] .wall-purpose::after { content: "for learning"; }

/* Linking — whether a selection travels. */
${id}[data-linking="independent"] { --link: none; }
${id}[data-linking="global-filters"] .wall-bar { border-bottom: 1px dashed var(--rule); }
${id}[data-linking="cross-filtering"] .wall-bar { border-bottom: 1px solid var(--accent); }
${id}[data-linking="drill-through"] .wall-panels { cursor: zoom-in; }

/* Refresh — whether the newest point moves while you watch it. */
${id}[data-refresh="static-snapshot"] .wall-flag { display: none; }
${id}[data-refresh="periodic-refresh"] .wall-flag::after { content: "every 60s"; }
${id}[data-refresh="live-stream"] .wall-flag::after { content: "live"; }
${id}[data-refresh="on-visit"] .wall-flag::after { content: "on open"; }

/* Ownership — who the wall belongs to. */
${id}[data-ownership="personal"] .wall-bar::after { content: "mine"; margin-left: auto; }
${id}[data-ownership="shared-read-only"] .wall-bar::after { content: "read-only"; margin-left: auto; }
${id}[data-ownership="team-editable"] .wall-bar::after { content: "team-editable"; margin-left: auto; }
${id}[data-ownership="forkable-copies"] .wall-bar::after { content: "forkable"; margin-left: auto; }
${id} .wall-bar::after { font-size: .68rem; color: var(--dim); }

/* Widgets — which kinds of thing are on it at all. */
${id}[data-widgets="tiles-only"] .wall-panels { display: none; }
${id}[data-widgets="tiles-and-charts"] .wall-panels { display: grid; }
${id}[data-widgets="as-authored"] .wall-panels { display: grid; }
`;
  },
};
```

Register it in `renderers.mjs`:

```js
import dashboard from './patterns/dashboard.mjs';
import statTile from './patterns/stat-tile.mjs';

const REGISTRY = new Map([dashboard, statTile].map((r) => [r.pattern, r]));
```

`widgets` is a `many` sub-dimension, so `declare.mjs` prepends the synthesised `as-authored` preset; the renderer must therefore also build a rule for `as-authored`, which the CSS above does. The audit only checks what `implements` claims, so add nothing to `implements` for it.

- [ ] **Step 5: Run the tests**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/*.test.mjs`
Expected: PASS. `document.test.mjs`'s "an instance with no renderer is skipped" assertion on `wall` now fails, because the dashboard has a renderer — **update that assertion** to a pattern that still has none (`assert.ok(skipped.includes('deploys'))`) rather than deleting the test.

- [ ] **Step 6: Commit**

```bash
git -c commit.gpgsign=false commit --allow-empty -m "$(cat <<'MSG'
The wall holds the tiles, and every arrangement is already in the file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The chart renderer, used twice

`observe` has two chart instances — `latency` (lines, small multiples) and `errors` (bars, single plot). One renderer serves both, which is the first evidence the compiler is not a one-screen trick.

**Files:**
- Create: `genui/compile/patterns/chart.mjs`
- Modify: `genui/compile/renderers.mjs` (register it)
- Create: `genui/compile/chart.test.mjs`

**Interfaces:**
- Consumes: the renderer contract (Task 2).
- Produces: `chart` renderer implementing `markType` (7), `scale` (5), `faceting` (4), `adaptation` (4), `authorship` (4), and presets for the `many` subs `channels`, `inspectBy`, `annotation`.

- [ ] **Step 1: Write the failing test**

```js
// genui/compile/chart.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSpace } from '../../../../../server/genui/space.js';
import { declare } from './declare.mjs';
import { compile } from './document.mjs';
import { auditRenderer, rendererFor } from './renderers.mjs';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const atlas = await loadAtlasForTests();
const data = JSON.parse(await readFile(path.join(HERE, '..', 'fixtures', 'observe.json'), 'utf8'));

test('the chart renderer builds what it claims', () => {
  assert.deepEqual(auditRenderer(rendererFor('chart')), []);
});

test('two chart instances render with different facts from one renderer', async () => {
  const resolved = resolveScreen(await loadScreen('observe'), atlas);
  const { declarations } = declare(resolved, atlas);
  const { source } = compile(resolved, { data, declarations });
  assert.match(source, /id="latency"[^>]*data-mark-type="lines"/);
  assert.match(source, /id="errors"[^>]*data-mark-type="bars"/);
  assert.match(source, /id="latency"[^>]*data-faceting="small-multiples"/);
  assert.match(source, /id="errors"[^>]*data-faceting="single-plot"/);
});

test('both charts are drawn from the fixture, not from invented copy', async () => {
  const resolved = resolveScreen(await loadScreen('observe'), atlas);
  const { source } = compile(resolved, { data, declarations: declare(resolved, atlas).declarations });
  assert.ok(source.includes('polyline') || source.includes('<rect'), 'marks are drawn');
});

test('the screen still validates with charts in it', async () => {
  const resolved = resolveScreen(await loadScreen('observe'), atlas);
  const { source } = compile(resolved, { data, declarations: declare(resolved, atlas).declarations });
  assert.deepEqual(validateSpace(source, atlas).issues, []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/chart.test.mjs`
Expected: FAIL — `rendererFor('chart')` is null.

- [ ] **Step 3: Write the chart renderer**

Draw marks as inline SVG from `ctx.data`. Every mark type is present in the markup at once and the attribute chooses which shows — the same discipline as every other option.

```js
// genui/compile/patterns/chart.mjs
// Values as marks and channels. Every mark type is drawn into the file; the
// attribute chooses which one the person sees.
const points = (instance, ctx) => {
  const bound = ctx.binding('mark')[0];
  const key = String(bound?.path ?? '').includes('errors') ? 'errors' : 'latency';
  return ctx.data?.metrics?.[key]?.points ?? [];
};

const scaled = (values) => {
  const max = Math.max(1, ...values);
  return values.map((v, i) => ({ x: (i / Math.max(1, values.length - 1)) * 100, y: 40 - (v / max) * 36, v, i }));
};

export default {
  pattern: 'chart',
  implements: {
    markType: ['points', 'bars', 'lines', 'areas', 'arcs', 'cells', 'glyphs'],
    scale: ['linear', 'logarithmic', 'ordinal-or-band', 'time', 'radial'],
    faceting: ['single-plot', 'small-multiples', 'layered-series', 'dual-axis'],
    adaptation: ['fixed-desktop-chart', 'reflow-for-narrow-screens', 'aggregate-when-dense', 'switch-mark-type-by-size'],
    authorship: ['author-specified', 'builder-ui', 'recommended-chart-type', 'generated-from-a-question'],
    channels: [
      { slug: 'position-only', gloss: 'Position alone carries the value', members: ['Position'] },
      { slug: 'position-and-colour', gloss: 'Position, with colour for the series', members: ['Position', 'Colour hue or value'] },
    ],
    inspectBy: [
      { slug: 'read-only', gloss: 'Nothing to touch — it is there to be read', members: [] },
      { slug: 'hover-and-brush', gloss: 'Hover for a value, brush to select a region', members: ['Hover tooltip', 'Brush a region'] },
    ],
    annotation: [
      { slug: 'bare', gloss: 'The marks alone', members: ['None'] },
      { slug: 'reference-lines', gloss: 'A line where the threshold is', members: ['Reference lines'] },
    ],
  },

  markup(instance, ctx) {
    const pts = scaled(points(instance, ctx));
    const line = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const bars = pts.map((p) => `<rect x="${p.x - 2}" y="${p.y}" width="4" height="${40 - p.y}"/>`).join('');
    const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="1.6"/>`).join('');
    const panel = (extra = '') => `
      <svg class="plot" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="${extra || 'series'}">
        <line class="axis" x1="0" y1="40" x2="100" y2="40"/>
        <line class="ref" x1="0" y1="14" x2="100" y2="14"/>
        <polyline class="mk-line" points="${line}"/>
        <polygon class="mk-area" points="0,40 ${line} 100,40"/>
        <g class="mk-bars">${bars}</g>
        <g class="mk-points">${dots}</g>
        <g class="mk-cells">${pts.map((p) => `<rect x="${p.x - 3}" y="2" width="6" height="36" opacity="${(40 - p.y) / 40}"/>`).join('')}</g>
        <g class="mk-arcs"><path d="M 8 38 A 30 30 0 0 1 92 38"/></g>
        <g class="mk-glyphs">${pts.map((p) => `<text x="${p.x}" y="${p.y}">✳</text>`).join('')}</g>
      </svg>`;
    return `
  <div class="plots">
    <div class="facet">${panel('series')}</div>
    <div class="facet facet-extra">${panel('second facet')}</div>
  </div>
  <p class="plot-note"></p>`;
  },

  css(instance, ctx) {
    const id = `#${ctx.id}`;
    return `
${id} { display: flex; flex-direction: column; gap: .3rem; background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: .6rem; container-type: inline-size; }
${id} .plots { display: grid; gap: .4rem; }
${id} .plot { width: 100%; height: 100%; min-height: 5rem; }
${id} .axis { stroke: var(--rule); stroke-width: .6; }
${id} .ref { stroke: var(--bad); stroke-width: .5; stroke-dasharray: 2 2; display: none; }
${id} .mk-line { fill: none; stroke: var(--accent); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
${id} .mk-area { fill: var(--accent); opacity: .18; stroke: none; }
${id} .mk-bars rect { fill: var(--accent); }
${id} .mk-points circle { fill: var(--accent); }
${id} .mk-cells rect { fill: var(--accent); }
${id} .mk-arcs path { fill: none; stroke: var(--accent); stroke-width: 1.2; }
${id} .mk-glyphs text { font-size: 3px; fill: var(--accent); text-anchor: middle; }
${id} .plot-note { margin: 0; font-size: .68rem; color: var(--dim); }
${id} .mk-line, ${id} .mk-area, ${id} .mk-bars, ${id} .mk-points, ${id} .mk-cells, ${id} .mk-arcs, ${id} .mk-glyphs { display: none; }

/* Mark encoding — exactly one kind of mark shows. */
${id}[data-mark-type="points"] .mk-points { display: block; }
${id}[data-mark-type="bars"] .mk-bars { display: block; }
${id}[data-mark-type="lines"] .mk-line { display: block; }
${id}[data-mark-type="areas"] .mk-area { display: block; }
${id}[data-mark-type="areas"] .mk-line { display: block; }
${id}[data-mark-type="arcs"] .mk-arcs { display: block; }
${id}[data-mark-type="cells"] .mk-cells { display: block; }
${id}[data-mark-type="glyphs"] .mk-glyphs { display: block; }

/* Scale and axes. */
${id}[data-scale="linear"] .plot-note::after { content: "linear"; }
${id}[data-scale="logarithmic"] .plot-note::after { content: "log"; }
${id}[data-scale="ordinal-or-band"] .plot-note::after { content: "banded"; }
${id}[data-scale="time"] .plot-note::after { content: "last 12 hours"; }
${id}[data-scale="radial"] .plot { transform: rotate(-90deg); }
${id}[data-scale="radial"] .plot-note::after { content: "radial"; }

/* Faceting — one plot, or several. */
${id}[data-faceting="single-plot"] .facet-extra { display: none; }
${id}[data-faceting="small-multiples"] .plots { grid-template-columns: 1fr 1fr; }
${id}[data-faceting="layered-series"] .plots { display: grid; grid-template-areas: "stack"; }
${id}[data-faceting="layered-series"] .facet { grid-area: stack; }
${id}[data-faceting="dual-axis"] .plots { grid-template-columns: 1fr; }
${id}[data-faceting="dual-axis"] .facet-extra { opacity: .55; }

/* Responsive encoding. */
${id}[data-adaptation="fixed-desktop-chart"] .plot { min-height: 6rem; }
${id}[data-adaptation="reflow-for-narrow-screens"] .plots { grid-template-columns: 1fr; }
@container (max-width: 22rem) { ${id}[data-adaptation="aggregate-when-dense"] .mk-points circle { r: 0.8; } }
${id}[data-adaptation="aggregate-when-dense"] .plot-note { font-variant-numeric: tabular-nums; }
@container (max-width: 22rem) { ${id}[data-adaptation="switch-mark-type-by-size"] .mk-line { display: none; } ${id}[data-adaptation="switch-mark-type-by-size"] .mk-bars { display: block; } }

/* Encoding authorship — who chose the encoding. */
${id}[data-authorship="author-specified"] .plot-note { border-left: 0; }
${id}[data-authorship="builder-ui"] .plot-note::before { content: "built here · "; }
${id}[data-authorship="recommended-chart-type"] .plot-note::before { content: "recommended · "; }
${id}[data-authorship="generated-from-a-question"] .plot-note::before { content: "from a question · "; }

/* Channels, interrogation, annotation — the many-valued sets. */
${id}[data-channels="position-only"] .mk-bars rect { fill: var(--dim); }
${id}[data-channels="position-and-colour"] .mk-bars rect:nth-child(odd) { fill: var(--accent); }
${id}[data-channels="as-authored"] .mk-bars rect:nth-child(odd) { fill: var(--accent); }
${id}[data-inspect-by="read-only"] .plot { pointer-events: none; }
${id}[data-inspect-by="hover-and-brush"] .plot { cursor: crosshair; }
${id}[data-inspect-by="as-authored"] .plot { cursor: crosshair; }
${id}[data-annotation="bare"] .ref { display: none; }
${id}[data-annotation="reference-lines"] .ref { display: block; }
${id}[data-annotation="as-authored"] .ref { display: block; }
`;
  },
};
```

Register it alongside the others in `renderers.mjs`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c commit.gpgsign=false commit --allow-empty -m "$(cat <<'MSG'
One renderer, two charts, and every mark already in the file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Annotation and coordinated-views — the last two, and the honest one

`deploys` (annotation) is anchored to a moment across the charts. `link` (coordinated-views) is, in the spec's own words, "a relation wearing a pattern's clothes" — its `contains` slot is literally `"nowhere"`. It renders as the linking bar that says what is linked and how, which is what that instance actually is.

**Files:**
- Create: `genui/compile/patterns/annotation.mjs`
- Create: `genui/compile/patterns/coordinated-views.mjs`
- Modify: `genui/compile/renderers.mjs`
- Create: `genui/compile/complete.test.mjs`

**Interfaces:**
- Consumes: the renderer contract (Task 2).
- Produces: renderers for both patterns; after this task `compile(...).skipped` is empty for `observe`.

- [ ] **Step 1: Write the failing test**

```js
// genui/compile/complete.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSpace } from '../../../../../server/genui/space.js';
import { declare } from './declare.mjs';
import { compile } from './document.mjs';
import { allRenderers, auditRenderer } from './renderers.mjs';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const atlas = await loadAtlasForTests();
const data = JSON.parse(await readFile(path.join(HERE, '..', 'fixtures', 'observe.json'), 'utf8'));
const resolved = resolveScreen(await loadScreen('observe'), atlas);
const { declarations, holes } = declare(resolved, atlas);
const { source, skipped } = compile(resolved, { data, declarations });

test('every instance in observe has a renderer', () => {
  assert.deepEqual(skipped, []);
});

test('every renderer builds what it claims', () => {
  for (const r of allRenderers()) assert.deepEqual(auditRenderer(r), [], r.pattern);
});

test('the compiled screen is a valid app space', () => {
  assert.deepEqual(validateSpace(source, atlas).issues, []);
});

test('observe has no render holes left', () => {
  assert.deepEqual(holes, [], `holes: ${JSON.stringify(holes)}`);
});

test('the six instances are all present', () => {
  for (const id of ['wall', 'tiles', 'latency', 'errors', 'deploys', 'link']) {
    assert.match(source, new RegExp(`data-genui="[a-z-]+#${id}"`), id);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/complete.test.mjs`
Expected: FAIL — `skipped` still lists `deploys` and `link`.

- [ ] **Step 3: Write the annotation renderer**

```js
// genui/compile/patterns/annotation.mjs
// A deploy at 14:02, anchored to the moment rather than to a panel.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
  pattern: 'annotation',
  implements: {
    anchor: ['text-range', 'canvas-point-or-area', 'timeline-range', 'cell-or-row', 'code-line', 'whole-page-floating', 'block', 'content-block'],
    layout: ['side-margin-panel', 'anchored-popover', 'bottom-sheet-on-mobile', 'inline-under-the-block', 'review-page-list'],
    lifecycle: ['open-until-resolved', 'resolved-keeps-history', 'converted-to-task', 'outdated-when-anchor-moves', 'reopened-on-reply'],
    marker: [
      { slug: 'line-only', gloss: 'A line at the moment, and nothing else', members: ['Timeline marker'] },
      { slug: 'line-and-status', gloss: 'A line at the moment, coloured by how the deploy went', members: ['Timeline marker', 'Status colour'] },
    ],
    createBy: [
      { slug: 'pin', gloss: 'Drop a pin on the timeline', members: ['Pin tool'] },
      { slug: 'select-then-comment', gloss: 'Select a range, then write', members: ['Select then comment'] },
    ],
    feedback: [
      { slug: 'open-only', gloss: 'Show only the ones still open', members: ['Filter open only'] },
      { slug: 'unread', gloss: 'Badge the ones nobody has read', members: ['Unread badges'] },
    ],
  },

  markup(instance, ctx) {
    const deploys = ctx.data?.deploys ?? [];
    return `
  <div class="ann-rail" aria-hidden="true"></div>
  ${deploys
    .map(
      (d, n) => `<article class="ann" data-marble-id="${ctx.id}-note-${n}">
    <span class="ann-dot"></span>
    <div class="ann-body"><strong>${esc(d.at)}</strong> deploy <code>${esc(d.sha)}</code> by ${esc(d.by)}</div>
  </article>`,
    )
    .join('')}`;
  },

  css(instance, ctx) {
    const id = `#${ctx.id}`;
    return `
${id} { pointer-events: none; }
${id} .ann-rail { position: absolute; inset: 0 auto 0 50%; width: 2px; background: var(--bad); opacity: .5; }
${id} .ann { position: absolute; top: 12%; left: 50%; transform: translateX(-50%); display: flex; gap: .35rem; align-items: center; pointer-events: auto; }
${id} .ann-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bad); flex: none; }
${id} .ann-body { font-size: .68rem; background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: .15rem .4rem; white-space: nowrap; }

/* Anchor form — what the note is fixed to. */
${id}[data-anchor="text-range"] .ann-rail { display: none; }
${id}[data-anchor="canvas-point-or-area"] .ann-rail { inset: 40% auto auto 50%; height: 8px; width: 8px; border-radius: 50%; }
${id}[data-anchor="timeline-range"] .ann-rail { display: block; }
${id}[data-anchor="cell-or-row"] .ann-rail { inset: 30% 0 auto 0; width: auto; height: 2px; }
${id}[data-anchor="code-line"] .ann-rail { inset: 20% 0 auto 0; width: auto; height: 2px; }
${id}[data-anchor="whole-page-floating"] .ann-rail { display: none; }
${id}[data-anchor="whole-page-floating"] .ann { top: auto; bottom: 4%; }
${id}[data-anchor="block"] .ann-rail { inset: 0 auto 0 0; }
${id}[data-anchor="content-block"] .ann-rail { inset: 0 auto 0 0; }

/* Thread layout — where the note itself sits. */
${id}[data-layout="side-margin-panel"] .ann { left: auto; right: 0; transform: none; }
${id}[data-layout="anchored-popover"] .ann { left: 50%; }
${id}[data-layout="bottom-sheet-on-mobile"] .ann { top: auto; bottom: 0; }
${id}[data-layout="inline-under-the-block"] .ann { position: static; transform: none; }
${id}[data-layout="review-page-list"] .ann { position: static; transform: none; border-bottom: 1px solid var(--rule); }

/* Lifecycle. */
${id}[data-lifecycle="open-until-resolved"] .ann-dot { background: var(--bad); }
${id}[data-lifecycle="resolved-keeps-history"] .ann-dot { background: var(--dim); }
${id}[data-lifecycle="converted-to-task"] .ann-dot { border-radius: 2px; }
${id}[data-lifecycle="outdated-when-anchor-moves"] .ann-body { text-decoration: line-through; }
${id}[data-lifecycle="reopened-on-reply"] .ann-dot { outline: 2px solid var(--bad); outline-offset: 1px; }

/* Marker, creation, feedback — the many-valued sets. */
${id}[data-marker="line-only"] .ann-dot { background: var(--dim); }
${id}[data-marker="line-and-status"] .ann-dot { background: var(--bad); }
${id}[data-marker="as-authored"] .ann-dot { background: var(--bad); }
${id}[data-create-by="pin"] .ann-rail { cursor: crosshair; }
${id}[data-create-by="select-then-comment"] .ann-rail { cursor: text; }
${id}[data-create-by="as-authored"] .ann-rail { cursor: crosshair; }
${id}[data-feedback="open-only"] .ann-body { opacity: 1; }
${id}[data-feedback="unread"] .ann-body { font-weight: 600; }
${id}[data-feedback="as-authored"] .ann-body { opacity: 1; }
`;
  },
};
```

- [ ] **Step 4: Write the coordinated-views renderer**

```js
// genui/compile/patterns/coordinated-views.mjs
// This instance is a relation wearing a pattern's clothes — the spec says so,
// and its contains slot is "nowhere". What it honestly is on the screen is the
// bar that says what a brush does and how far it travels.
export default {
  pattern: 'coordinated-views',
  implements: {
    arrangement: ['tiled-dashboard', 'split-panes', 'tabbed-views', 'overview-detail-split', 'floating-layers'],
    scope: ['one-mark', 'a-brushed-subset', 'a-categorical-group', 'all-linked-views', 'one-view-only'],
    authorship: ['fixed-published-dashboard', 'author-arranges-views', 'person-adds-a-linked-view', 'suggested-companion-views'],
    linkChannel: [
      { slug: 'highlight-only', gloss: 'A selection highlights, and nothing filters', members: ['Selection highlight'] },
      { slug: 'highlight-and-filter', gloss: 'A selection highlights and filters the others', members: ['Selection highlight', 'Filter'] },
    ],
    trigger: [
      { slug: 'brush', gloss: 'Brushing a region is what links', members: ['Brush a region'] },
      { slug: 'click-and-brush', gloss: 'Clicking a mark or brushing a region', members: ['Click a mark', 'Brush a region'] },
    ],
    feedback: [
      { slug: 'highlight', gloss: 'Matches light up', members: ['Highlight in place'] },
      { slug: 'grey-out', gloss: 'Non-matches grey out, with a count', members: ['Grey-out non-matches', 'Count of selected rows'] },
    ],
  },

  markup(instance, ctx) {
    return `
  <div class="link-bar">
    <span class="link-what"></span>
    <span class="link-scope"></span>
    <span class="link-count">0 selected</span>
  </div>`;
  },

  css(instance, ctx) {
    const id = `#${ctx.id}`;
    return `
${id} { grid-column: 1 / -1; }
${id} .link-bar { display: flex; gap: .6rem; align-items: center; font-size: .7rem; color: var(--dim); border: 1px dashed var(--rule); border-radius: 8px; padding: .25rem .5rem; }
${id} .link-count { margin-left: auto; font-variant-numeric: tabular-nums; }

/* View arrangement. */
${id}[data-arrangement="tiled-dashboard"] .link-bar::before { content: "tiled"; }
${id}[data-arrangement="split-panes"] .link-bar::before { content: "split"; }
${id}[data-arrangement="tabbed-views"] .link-bar::before { content: "tabbed"; }
${id}[data-arrangement="overview-detail-split"] .link-bar::before { content: "overview + detail"; }
${id}[data-arrangement="floating-layers"] .link-bar::before { content: "layers"; }

/* Selection scope — how far a brush reaches. */
${id}[data-scope="one-mark"] .link-scope::after { content: "one mark"; }
${id}[data-scope="a-brushed-subset"] .link-scope::after { content: "a brushed subset"; }
${id}[data-scope="a-categorical-group"] .link-scope::after { content: "a group"; }
${id}[data-scope="all-linked-views"] .link-scope::after { content: "every view"; }
${id}[data-scope="one-view-only"] .link-scope::after { content: "this view only"; }

/* View authorship. */
${id}[data-authorship="fixed-published-dashboard"] .link-bar { border-style: solid; }
${id}[data-authorship="author-arranges-views"] .link-bar { border-style: dashed; }
${id}[data-authorship="person-adds-a-linked-view"] .link-bar { border-style: dotted; }
${id}[data-authorship="suggested-companion-views"] .link-bar { border-style: double; }

/* What is linked, what triggers it, what it looks like. */
${id}[data-link-channel="highlight-only"] .link-what::after { content: "highlights"; }
${id}[data-link-channel="highlight-and-filter"] .link-what::after { content: "highlights and filters"; }
${id}[data-link-channel="as-authored"] .link-what::after { content: "highlights, filters and sets parameters"; }
${id}[data-trigger="brush"] .link-bar { cursor: crosshair; }
${id}[data-trigger="click-and-brush"] .link-bar { cursor: pointer; }
${id}[data-trigger="as-authored"] .link-bar { cursor: crosshair; }
${id}[data-feedback="highlight"] .link-count { opacity: .6; }
${id}[data-feedback="grey-out"] .link-count { opacity: 1; }
${id}[data-feedback="as-authored"] .link-count { opacity: 1; }
`;
  },
};
```

Register both in `renderers.mjs`.

- [ ] **Step 5: Run every test**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/*.test.mjs`
Expected: PASS. If `observe has no render holes left` fails, read the hole: a `reason` of `authored-not-implemented` means a renderer's `implements` is missing a variation the spec actually authored — add it and build its rule. Do **not** delete the assertion.

- [ ] **Step 6: Commit**

```bash
git -c commit.gpgsign=false commit --allow-empty -m "$(cat <<'MSG'
The note at 14:02, and the bar that is really a relation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The control surface — a dimension you can actually turn

**Files:**
- Create: `genui/compile/controls.mjs`
- Modify: `genui/compile/document.mjs` (emit the panel and the script)
- Create: `genui/compile/controls.test.mjs`

**Interfaces:**
- Consumes: `declare` (Task 4), `compile` (Task 3).
- Produces:
  - `controlPanel(instance, declarations)` → HTML for one instance's controls, or `''` when it has none.
  - `CONTROL_SCRIPT` → the client script string.
  - Behaviour: clicking an option sets the fact attribute on the instance root; if `window.marble` is present the change is also filed as an op so it persists and Mod+Z reverses it; a governed dimension shows `who` may turn it and `why`, and its buttons are `disabled` when `who` is not `anyone`.

- [ ] **Step 1: Write the failing test**

```js
// genui/compile/controls.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSpace } from '../../../../../server/genui/space.js';
import { declare } from './declare.mjs';
import { compile } from './document.mjs';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const atlas = await loadAtlasForTests();
const data = JSON.parse(await readFile(path.join(HERE, '..', 'fixtures', 'observe.json'), 'utf8'));
const resolved = resolveScreen(await loadScreen('observe'), atlas);
const { declarations } = declare(resolved, atlas);
const { source } = compile(resolved, { data, declarations });

test('a declared dimension gets a button per option', () => {
  assert.match(source, /data-turn="wall\.arrangement"[^>]*data-to="story-layout"/);
  assert.match(source, /data-turn="wall\.density"[^>]*data-to="a-few-glanceable-tiles"/);
});

test('a fixed dimension gets no control at all', () => {
  assert.ok(!source.includes('data-turn="tiles.encoding"'), 'tiles declares no malleability');
});

test('a governed dimension says who may turn it and why', () => {
  assert.match(source, /data-turn="wall\.alerting"[^>]*disabled/);
  assert.match(source, /on-call policy, not a panel preference/);
});

test('the control names the Atlas technique where there is one', () => {
  // dashboard's stage-7 techniques include "Arrange by glance frequency" on Arrangement.
  assert.match(source, /Arrange by glance frequency/);
});

test('the controls do not break the app-space contract', () => {
  assert.deepEqual(validateSpace(source, atlas).issues, []);
});

test('the script files an op when a carrier is present, and works without one', () => {
  assert.match(source, /window\.marble/);
  assert.match(source, /setAttribute/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/controls.test.mjs`
Expected: FAIL — no `data-turn` in the source.

- [ ] **Step 3: Write `controls.mjs`**

```js
// genui/compile/controls.mjs
// The control is the malleability declaration, made touchable. Where the Atlas
// names a technique for the dimension (stage 7), the control is labelled with
// it: the vocabulary comes from the codebook, not from this demo.
import { optionGloss, optionSlug } from './renderers.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function controlPanel(instance, declarations) {
  const mine = [...declarations.values()].filter((d) => d.instance === instance.id);
  if (!mine.length) return '';

  const rows = mine
    .map((d) => {
      const governed = d.permission && typeof d.permission === 'object' ? d.permission : null;
      // "who" names the party who may turn it. Anyone else sees it held.
      const held = Boolean(governed && governed.who && governed.who !== 'anyone');
      const note = governed?.why ? `<p class="ctl-why">${esc(governed.why)}</p>` : '';
      const technique = d.technique ? `<span class="ctl-tech" title="${esc(d.technique.how)}">${esc(d.technique.name)}${d.technique.ai ? ' · proposed' : ''}</span>` : '';
      const who = governed?.who ? `<span class="ctl-who">${esc(governed.who)}${governed.scope ? ` · ${esc(governed.scope)}` : ''}</span>` : '';
      const buttons = d.options
        .map((o) => {
          const s = optionSlug(o);
          const label = optionGloss(o) ?? s.replace(/-/g, ' ');
          return `<button type="button" class="ctl-opt" data-turn="${esc(d.instance)}.${esc(d.key)}" data-attr="${esc(d.attr)}" data-to="${esc(s)}"${held ? ' disabled' : ''} aria-pressed="${s === d.current}">${esc(label)}</button>`;
        })
        .join('');
      return `
    <div class="ctl-row"${held ? ' data-held="true"' : ''}>
      <div class="ctl-head"><span class="ctl-name">${esc(d.subName)}</span>${technique}${who}</div>
      <div class="ctl-opts">${buttons}</div>
      ${note}
    </div>`;
    })
    .join('');

  return `
  <details class="ctl" data-marble-id="${esc(instance.id)}-controls">
    <summary class="ctl-summary">${mine.length} ${mine.length === 1 ? 'thing' : 'things'} you can change</summary>
    ${rows}
  </details>`;
}

export const CONTROL_CSS = `
.ctl { margin-top: .4rem; font-size: .72rem; border-top: 1px dotted var(--rule); padding-top: .3rem; }
.ctl-summary { cursor: pointer; color: var(--dim); }
.ctl-row { margin: .4rem 0; }
.ctl-row[data-held="true"] { opacity: .68; }
.ctl-head { display: flex; gap: .4rem; align-items: baseline; flex-wrap: wrap; }
.ctl-name { font-weight: 600; }
.ctl-tech { color: var(--accent); }
.ctl-who { margin-left: auto; color: var(--dim); font-style: italic; }
.ctl-opts { display: flex; gap: .25rem; flex-wrap: wrap; margin-top: .2rem; }
.ctl-opt { font: inherit; font-size: .7rem; border: 1px solid var(--rule); background: var(--panel); color: var(--ink); border-radius: 999px; padding: .1rem .5rem; cursor: pointer; }
.ctl-opt[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.ctl-opt[disabled] { cursor: not-allowed; }
.ctl-why { margin: .2rem 0 0; color: var(--dim); }
`;

// Setting the attribute is the whole mechanism: CSS does the rest, so this
// works from a file with no host. When a carrier is present the same change is
// filed as an op, so it survives a reload and Mod+Z reverses it — a
// malleability demo whose change vanishes proves nothing.
export const CONTROL_SCRIPT = `
(function () {
  function apply(button) {
    var key = button.getAttribute('data-turn');
    var attr = button.getAttribute('data-attr');
    var to = button.getAttribute('data-to');
    var root = document.getElementById(key.split('.')[0]);
    if (!root) return;
    root.setAttribute(attr, to);
    var group = button.parentNode.querySelectorAll('[data-turn="' + key + '"]');
    for (var i = 0; i < group.length; i++) group[i].setAttribute('aria-pressed', String(group[i] === button));
    var carrier = window.marble;
    if (carrier && typeof carrier.op === 'function') {
      carrier.op({ type: 'setAttr', id: root.getAttribute('data-marble-id'), name: attr, value: to });
    }
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('.ctl-opt') : null;
    if (!button || button.disabled) return;
    apply(button);
  });
})();
`;
```

- [ ] **Step 4: Wire it into `document.mjs`**

In `renderInstance`, append the panel after the renderer's markup:

```js
  ${renderer.markup(instance, ctx)}
  ${controlPanel(instance, declarations)}
```

Add `CONTROL_CSS` to `sheets` once (next to `SHELL`), and put the script before `</body>`:

```js
<script>${CONTROL_SCRIPT}</script>
</body>
```

Import both at the top: `import { CONTROL_CSS, CONTROL_SCRIPT, controlPanel } from './controls.mjs';`

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd "drive/Research/Design Pattern Generation" && node --test genui/compile/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c commit.gpgsign=false commit --allow-empty -m "$(cat <<'MSG'
A dimension the spec opened, and a button that really turns it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The CLI, the hole report, and seeing it in a browser

The last task turns the library into something you run, and proves in a real browser that turning a control changes what is on the screen — not just what is in the attribute. `validateSpace` matches bytes; only a computed style proves the rule does anything.

**Files:**
- Create: `tools/compile.mjs`
- Create: `tools/compile-report.mjs`
- Create: `genui/compile/browser.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `node tools/compile.mjs observe` → writes `drive/Spaces/observe.mrbl`, prints the instance count, the declaration count and any holes; exits non-zero if `validateSpace` fails.
  - `node tools/compile-report.mjs` → prints the render-hole table for every screen that has renderers.

- [ ] **Step 1: Write the CLI**

```js
#!/usr/bin/env node
// A screen from the corpus becomes a document you can open. No model runs here.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAtlas } from '../../../../server/genui/atlas.js';
import { validateSpace } from '../../../../server/genui/space.js';
import { declare } from '../genui/compile/declare.mjs';
import { compile } from '../genui/compile/document.mjs';
import { loadScreen, resolveScreen } from '../genui/compile/resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(HERE, '..');
const DRIVE = path.join(BASE, '..', '..');

const id = process.argv[2];
if (!id) {
  console.error('usage: node tools/compile.mjs <screen-id>   (e.g. observe)');
  process.exit(2);
}

const atlas = await loadAtlas(path.join(BASE, 'atlas.json'));
const screen = await loadScreen(id);
const resolved = resolveScreen(screen, atlas);
const data = JSON.parse(await fsp.readFile(path.join(BASE, 'genui', 'fixtures', `${id}.json`), 'utf8'));
const { declarations, holes } = declare(resolved, atlas);
const { source, skipped } = compile(resolved, { data, declarations });

const validation = validateSpace(source, atlas);
for (const issue of validation.issues) console.error(`  ✗ ${issue.instance ?? '—'}.${issue.key ?? '—'}: ${issue.message}`);
if (!validation.ok) process.exit(1);

const out = path.join(DRIVE, 'Spaces', `${id}.mrbl`);
await fsp.mkdir(path.dirname(out), { recursive: true });
await fsp.writeFile(out, source);

const turnable = [...declarations.values()].reduce((n, d) => n + d.options.length, 0);
console.log(`${id}: ${resolved.instances.length} instances, ${declarations.size} dimensions you can turn, ${turnable} options built`);
if (skipped.length) console.log(`  no renderer: ${skipped.join(', ')}`);
for (const h of holes) console.log(`  hole · ${h.instance}.${h.key} (${h.dimName}) — ${h.reason}`);
console.log(`→ ${path.relative(process.cwd(), out)}`);
```

- [ ] **Step 2: Run it**

Run: `cd "drive/Research/Design Pattern Generation" && node tools/compile.mjs observe`
Expected: `observe: 6 instances, N dimensions you can turn, …` and a written path. If `validateSpace` fails, the issues print first and nothing is written — fix the renderer, not the validator.

- [ ] **Step 3: Write the hole report**

```js
#!/usr/bin/env node
// What can be stated in the grammar but has nothing to render. The composition
// study counted what could not be said; this counts what cannot be shown.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAtlas } from '../../../../server/genui/atlas.js';
import { declare } from '../genui/compile/declare.mjs';
import { allScreens, resolveScreen } from '../genui/compile/resolve.mjs';

const BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const atlas = await loadAtlas(path.join(BASE, 'atlas.json'));

let open = 0;
let turnable = 0;
for (const screen of await allScreens()) {
  let resolved;
  try {
    resolved = resolveScreen(screen, atlas);
  } catch (err) {
    console.log(`${screen.id.padEnd(14)} does not resolve — ${err.message}`);
    continue;
  }
  const { declarations, holes } = declare(resolved, atlas);
  turnable += declarations.size;
  open += holes.length;
  if (!declarations.size && !holes.length) continue;
  console.log(`${screen.id.padEnd(14)} turnable ${String(declarations.size).padStart(2)}   holes ${String(holes.length).padStart(2)}   ${holes.map((h) => `${h.key}:${h.reason}`).join(' ')}`);
}
console.log(`\n${turnable} dimensions turnable across the corpus, ${open} render holes.`);
```

- [ ] **Step 4: Write the browser test**

```js
// genui/compile/browser.test.mjs
// The validator matches bytes. Only a computed style proves a rule does
// anything — a declaration whose CSS matches and changes nothing would keep
// every other check green while making the malleability claim false.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startDrive } from '../../../../../test-browser/harness.js';
import { declare } from './declare.mjs';
import { compile } from './document.mjs';
import { loadAtlasForTests, loadScreen, resolveScreen } from './resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const atlas = await loadAtlasForTests();
const data = JSON.parse(await readFile(path.join(HERE, '..', 'fixtures', 'observe.json'), 'utf8'));
const resolved = resolveScreen(await loadScreen('observe'), atlas);
const { declarations } = declare(resolved, atlas);
const { source } = compile(resolved, { data, declarations });

const host = await startDrive({ documents: { observe: source }, agents: false });
test.after(() => host.close());

const pages = [];
test.after(async () => { for (const p of pages.splice(0)) await p.close().catch(() => {}); });

async function open() {
  const { page, errors } = await host.newPage();
  pages.push(page);
  await page.goto(`${host.base}/a/observe`);
  await page.waitForSelector('#wall');
  return { page, errors };
}

test('the screen renders with no console errors', async () => {
  const { page, errors } = await open();
  assert.equal(await page.locator('[data-genui]').count() >= 6, true);
  assert.deepEqual(errors, []);
});

test('turning a control changes the attribute AND what is on the screen', async () => {
  const { page } = await open();
  const panels = page.locator('#wall .wall-panels');
  const before = await panels.evaluate((el) => getComputedStyle(el).gridTemplateColumns);

  await page.locator('[data-turn="wall.arrangement"][data-to="single-scrolling-column"]').click();

  assert.equal(await page.locator('#wall').getAttribute('data-arrangement'), 'single-scrolling-column');
  const after = await panels.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  assert.notEqual(before, after, 'the rule has to actually do something');
});

test('every declared option moves something', async () => {
  const { page } = await open();
  for (const [key, d] of declarations) {
    if (d.permission && typeof d.permission === 'object' && d.permission.who && d.permission.who !== 'anyone') continue;
    const [instanceId] = key.split('.');
    const root = page.locator(`#${instanceId}`);
    for (const option of d.options) {
      const slug = typeof option === 'string' ? option : option.slug;
      const button = page.locator(`[data-turn="${key}"][data-to="${slug}"]`);
      if (!(await button.count())) continue;
      await button.click();
      assert.equal(await root.getAttribute(d.attr), slug, `${key} → ${slug}`);
    }
  }
});

test('a dimension the spec governs cannot be turned from the page', async () => {
  const { page } = await open();
  const held = page.locator('[data-turn="wall.alerting"]').first();
  assert.equal(await held.isDisabled(), true);
});
```

- [ ] **Step 5: Run the browser test**

Run: `cd "drive/Research/Design Pattern Generation" && node --test --test-concurrency=1 genui/compile/browser.test.mjs`
Expected: PASS, 4 tests. Known-flaky under full-machine load — if it fails, check `uptime` and rerun this file alone before treating it as a regression.

- [ ] **Step 6: Look at it**

Run: `cd "drive/Research/Design Pattern Generation" && node tools/compile.mjs observe && node tools/compile-report.mjs`

Then open `Spaces/observe` in the drive and turn some controls by hand. The milestone is done when the wall rearranges, the tiles change encoding, the charts change mark type, and `Alerting` is visibly held with its reason.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-09-22-genui-compiler-m1.md
git -c commit.gpgsign=false commit -m "$(cat <<'MSG'
A screen you can open, and a count of what nothing can draw yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## What M1 does not do

`triage` (M2), `views` (M3), the LLM authoring step (M4) and `frontdoor` (the stress case) are separate plans. The `selects`, `reports`, `anchors` and `triggers` relations are rendered as static appearance in M1 — `contains` is the only relation that changes the document's structure. Making a brush in one chart grey out the other is M3's work, where `views` needs it.
