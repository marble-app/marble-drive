// Where each tab is looking is its own (runtime/looks.js). Two of the owner's
// tabs on one page: a section picked in one is saved, but does not move the
// other; typing and a tick reach both at once; a reread of the file, a reload
// and a brand-new tab each open where they should; an agent changing the view
// still moves the page.

import assert from 'node:assert/strict';
import test from 'node:test';

import { composeScript } from '../server/gallery.js';
import { startDrive } from './harness.js';

// A choose that switches views (looking by default), a section switcher the
// page's own script files without saying it is looking (as older apps do), a
// choose that records an answer (data-marble-look="off"), a toggle (a change),
// and a paragraph that files its words.
const APP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sections</title>
<style>
  .pane { display: none; }
  .app[data-view="a"] .pa, .app[data-view="b"] .pb, .app[data-view="c"] .pc { display: block; }
  .doc section { display: none; }
  .doc[data-active="intro"] .intro, .doc[data-active="method"] .method { display: block; }
</style>
</head>
<body data-marble-id="b">
  <main class="app" data-marble-id="app" data-view="a">
    <span data-marble-id="views" data-marble-choose="data-view" data-marble-of=".app">
      <button data-marble-id="va" data-marble-value="a">A</button>
      <button data-marble-id="vb" data-marble-value="b">B</button>
      <button data-marble-id="vc" data-marble-value="c">C</button>
    </span>
    <p class="pane pa" data-marble-id="pa">Pane A</p>
    <p class="pane pb" data-marble-id="pb">Pane B</p>
    <p class="pane pc" data-marble-id="pc">Pane C</p>
    <p data-marble-id="words" contenteditable="true">Words</p>
    <button data-marble-id="done" data-marble-toggle="data-done:yes|no" data-marble-of=".app">Done</button>
    <span data-marble-id="answer" data-marble-choose="data-answer" data-marble-of=".app" data-marble-look="off">
      <button data-marble-id="yes" data-marble-value="yes">Yes</button>
      <button data-marble-id="no" data-marble-value="no">No</button>
    </span>
  </main>
  <article class="doc" data-marble-id="doc" data-active="intro">
    <button data-marble-id="to-intro" data-go="intro">Intro</button>
    <button data-marble-id="to-method" data-go="method">Method</button>
    <section class="intro" data-marble-id="intro">Intro text</section>
    <section class="method" data-marble-id="method">Method text</section>
  </article>
  <script data-marble-id="own">
    addEventListener('input', (e) => {
      const el = e.target.closest?.('[data-marble-id][contenteditable]');
      if (el && window.marble) marble.op({ type: 'setText', id: el.getAttribute('data-marble-id'), text: el.textContent });
    });
    addEventListener('click', (e) => {
      const go = e.target.closest?.('[data-go]');
      if (!go || !window.marble) return;
      const doc = document.querySelector('.doc');
      doc.setAttribute('data-active', go.dataset.go);
      marble.op({ type: 'setAttr', id: 'doc', name: 'data-active', value: go.dataset.go }, { immediate: true });
    });
  </script>
  <script>
${await composeScript(['state'])}
  </script>
</body></html>
`;

const host = await startDrive({ agents: false, documents: { sections: APP } });
test.after(() => host.close());

const pages = [];
test.afterEach(async () => {
  for (const page of pages.splice(0)) await page.context().close().catch(() => {});
});

async function tab(doc = 'sections') {
  const { page, errors } = await host.newPage({ shell: false });
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.looksWrapped && Number.isInteger(window.marble.status?.v)));
  return { page, errors };
}

/** Asks `check` until it holds, for up to `ms`. */
async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const attr = (page, selector, name) => page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [selector, name]);
const file = () => host.drive.store.read('sections');
const at = (page) => page.evaluate(() => window.marble.status.v);
const hostV = () => host.drive.versions.current('sections');
const caughtUp = (pages) => until(async () => {
  const v = await hostV();
  for (const page of pages) if ((await at(page)) !== v) return false;
  return true;
}, 'every tab at the host version');
const real = (errors) => errors.filter((e) => !/favicon/.test(e));

test('a view picked in one tab is saved but leaves the other tab where it is; typing and a tick reach both', async () => {
  await host.reset();
  const a = await tab();
  const b = await tab();

  await a.page.click('[data-marble-id="vb"]');
  await until(async () => /data-view="b"/.test(await file()), 'the view to be saved');
  await caughtUp([a.page, b.page]);
  assert.equal(await attr(a.page, '.app', 'data-view'), 'b');
  assert.equal(await attr(b.page, '.app', 'data-view'), 'a', 'the other tab did not follow');
  assert.ok(await b.page.isVisible('text=Pane A'));
  assert.equal(await attr(b.page, '[data-marble-id="va"]', 'aria-pressed'), 'true', 'and its control still says where it is');

  // The page's own section switcher, filed with no look flag, is looking too.
  await a.page.click('[data-marble-id="to-method"]');
  await until(async () => /data-active="method"/.test(await file()), 'the section to be saved');
  await caughtUp([a.page, b.page]);
  assert.equal(await attr(b.page, '.doc', 'data-active'), 'intro');

  // Changes still reach every tab.
  await a.page.click('[data-marble-id="words"]');
  await a.page.keyboard.press('End');
  await a.page.keyboard.type(' typed in A');
  await a.page.click('[data-marble-id="done"]');
  await a.page.click('[data-marble-id="yes"]');
  await until(async () => (await b.page.textContent('[data-marble-id="words"]')) === 'Words typed in A', 'the words in the other tab');
  await until(async () => (await attr(b.page, '.app', 'data-done')) === 'yes', 'the tick in the other tab');
  await until(async () => (await attr(b.page, '.app', 'data-answer')) === 'yes', 'the answer in the other tab');
  assert.equal(await attr(b.page, '.app', 'data-view'), 'a', 'and still where it was');

  // The other tab's own pick is saved and moves nobody either.
  await b.page.click('[data-marble-id="vc"]');
  await until(async () => /data-view="c"/.test(await file()), 'the second tab’s view to be saved');
  await caughtUp([a.page, b.page]);
  assert.equal(await attr(a.page, '.app', 'data-view'), 'b');
  assert.deepEqual(real([...a.errors, ...b.errors]), []);
});

test('a reread of the file and a reload keep the tab where it was; a new tab opens where the file is', async () => {
  await host.reset();
  const a = await tab();
  const b = await tab();
  await a.page.click('[data-marble-id="vb"]');
  await a.page.click('[data-marble-id="to-method"]');
  await until(async () => /data-view="b"/.test(await file()) && /data-active="method"/.test(await file()), 'both looks saved');
  await caughtUp([a.page, b.page]);

  await b.page.evaluate(() => window.marble.patch());
  await caughtUp([b.page]);
  await b.page.waitForTimeout(200);
  assert.equal(await attr(b.page, '.app', 'data-view'), 'a', 'a reread keeps the view');
  assert.equal(await attr(b.page, '.doc', 'data-active'), 'intro');

  await b.page.reload();
  await b.page.waitForFunction(() => Boolean(window.marble?.looksWrapped));
  assert.equal(await attr(b.page, '.app', 'data-view'), 'a', 'a reload opens where this tab was');
  assert.equal(await attr(b.page, '.doc', 'data-active'), 'intro');
  assert.ok(await b.page.isVisible('text=Pane A'));

  const c = await tab();
  assert.equal(await attr(c.page, '.app', 'data-view'), 'b', 'a new tab opens where the file is');
  assert.equal(await attr(c.page, '.doc', 'data-active'), 'method');
  assert.deepEqual(real([...a.errors, ...b.errors, ...c.errors]), []);
});

test('someone else changing the page around a tab’s view keeps the view; an agent moving the view moves it', async () => {
  await host.reset();
  const b = await tab();
  await host.drive.writeOps('sections', [{ type: 'setAttr', id: 'app', name: 'data-view', value: 'c', look: true }], { client: 'othertab' });
  await caughtUp([b.page]);
  assert.equal(await attr(b.page, '.app', 'data-view'), 'a');

  // A switch another tab files without the flag is known by its name.
  await b.page.click('[data-marble-id="to-method"]');
  await until(async () => /data-active="method"/.test(await file()), 'the section saved');
  await host.drive.writeOps('sections', [{ type: 'setAttr', id: 'doc', name: 'data-active', value: 'intro' }], { client: 'othertab' });
  await caughtUp([b.page]);
  assert.equal(await attr(b.page, '.doc', 'data-active'), 'method');

  await host.drive.writeOps('sections', [{ type: 'setAttr', id: 'app', name: 'data-view', value: 'b' }], { client: 'agent:test' });
  await caughtUp([b.page]);
  assert.equal(await attr(b.page, '.app', 'data-view'), 'b', 'an agent showing the person something moves the page');
  assert.deepEqual(real(b.errors), []);
});
