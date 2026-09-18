import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const FORKED = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fork</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; } h1 { font-size: 32px; }</style>
</head>
<body data-marble-id="b">
  <marble-alt data-marble-id="h" data-marble-active="you">
    <h1 data-marble-id="hy" data-marble-alt="you" data-marble-by="person">Yours</h1>
    <h1 data-marble-id="ha" data-marble-alt="agent:c1" data-marble-by="agent">Theirs</h1>
  </marble-alt>
  <p data-marble-id="p">A paragraph the fork does not own.</p>
</body></html>
`;

const AUTHORED = `<!doctype html>
<html><head><meta charset="utf-8"><title>Authored</title>
<style>
  body { font: 16px/1.5 Georgia, serif; margin: 40px; }
  marble-alt > [data-marble-alt] { display: none; }
  marble-alt[data-marble-active="v1"] > [data-marble-alt="v1"] { display: inline; }
  marble-alt[data-marble-active="v2"] > [data-marble-alt="v2"] { display: inline; }
</style>
</head>
<body data-marble-id="b">
  <p data-marble-id="p">Nature
    <marble-alt data-marble-id="n" data-marble-active="v1">
      <span data-marble-id="n1" data-marble-alt="v1">Modest</span>
      <span data-marble-id="n2" data-marble-alt="v2">Timid</span>
    </marble-alt>
  </p>
  <div class="marble-alts" data-marble-id="chips">v1 v2</div>
</body></html>
`;

const host = await startDrive({
  agents: true,
  documents: { forked: FORKED, authored: AUTHORED },
});
test.after(() => host.close());

test('a conflict fork shows You, Agent, Keep this, and Merge', async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const bar = page.locator('marble-alt > .marble-fork');
  await bar.waitFor();

  const labels = await bar.locator('button').allTextContents();
  assert.deepEqual(labels.map((t) => t.trim()), ['You', 'Agent', 'Keep this', 'Merge']);
  assert.equal(await bar.getByRole('button', { name: 'Approve' }).count(), 0);
  assert.equal(await bar.getByRole('button', { name: 'Reject' }).count(), 0);
  assert.equal(await page.locator('h1.marble-alt-shown').textContent(), 'Yours');
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('Keep this commits the version that is showing', async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const bar = page.locator('marble-alt > .marble-fork');
  await bar.waitFor();

  await bar.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('h1.marble-alt-shown')?.textContent === 'Theirs');
  await bar.getByRole('button', { name: 'Keep this' }).click();

  const deadline = Date.now() + 8000;
  let stored = await host.drive.store.read('forked');
  while (Date.now() < deadline && stored.includes('<marble-alt')) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    stored = await host.drive.store.read('forked');
  }

  assert.match(stored, />Theirs</);
  assert.doesNotMatch(stored, /<marble-alt/);
  assert.doesNotMatch(stored, /Yours/);
  assert.match(stored, /A paragraph the fork does not own/);
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('Keep this on You keeps the person’s version', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const bar = page.locator('marble-alt > .marble-fork');
  await bar.waitFor();
  await bar.getByRole('button', { name: 'Keep this' }).click();

  const deadline = Date.now() + 8000;
  let stored = await host.drive.store.read('forked');
  while (Date.now() < deadline && stored.includes('<marble-alt')) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    stored = await host.drive.store.read('forked');
  }

  assert.match(stored, />Yours</);
  assert.doesNotMatch(stored, /<marble-alt/);
  assert.doesNotMatch(stored, /Theirs/);
});

test('an authoring alt does not get Drive conflict chrome', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/authored`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.waitForFunction(() => Boolean(window.marble));

  assert.equal(await page.locator('marble-alt > .marble-fork').count(), 0);
  assert.equal(await page.locator('.marble-alts').count(), 1, 'generic chips stay on authoring alts');
  assert.equal(
    await page.locator('[data-marble-id="n1"]').evaluate((el) => getComputedStyle(el).display),
    'inline',
    'Drive must not force authoring alts to display:block',
  );
});

test('a remote op flashes the component it changed', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:ops', {
      detail: { ops: [{ type: 'setText', id: 'p', text: 'A paragraph the fork does not own.' }] },
    }));
  });
  assert.equal(await page.locator('[data-marble-id="p"]').evaluate((el) => el.classList.contains('marble-flash')), true);
});

test('person presence washes the id they are on, then fades out', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'person:c1', ids: ['p'] },
    }));
  });
  assert.equal(await page.locator('[data-marble-id="p"]').evaluate((el) => el.classList.contains('marble-presence')), true);
  assert.equal(await page.locator('.marble-zone').count(), 0, 'people get a wash, not a construction zone');

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'person:c1', ids: [] },
    }));
  });
  assert.equal(await page.locator('[data-marble-id="p"]').evaluate((el) => el.classList.contains('marble-presence-out')), true);
  assert.equal(await page.locator('[data-marble-id="p"]').evaluate((el) => el.classList.contains('marble-presence')), false);
});

test('agent presence tapes off the region it is working on', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: ['p'], phase: 'working' },
    }));
  });
  const zone = page.locator('.marble-zone');
  assert.equal(await zone.count(), 1);
  assert.match(await zone.innerText(), /Working/);
  assert.equal(
    await page.locator('[data-marble-id="p"]').evaluate((el) => el.classList.contains('marble-presence')),
    false,
    'agent work is a construction zone, not a per-id wash',
  );

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: [] },
    }));
  });
  assert.equal(await page.locator('.marble-zone').count(), 0);
});

test('the construction label uses the apply_ops note, and Hide puts it away', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: ['p'], phase: 'writing', note: 'rename the heading' },
    }));
  });
  const zone = page.locator('.marble-zone');
  assert.match(await zone.innerText(), /rename the heading/);

  await page.getByRole('button', { name: 'Hide' }).click();
  assert.equal(await page.locator('.marble-zone').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Show work' }).count(), 1);

  await page.getByRole('button', { name: 'Show work' }).click();
  assert.equal(await page.locator('.marble-zone').count(), 1);
});

test('agent work with no ids is a page banner, not a box around the document', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: [], phase: 'working' },
    }));
  });
  assert.equal(await page.locator('.marble-zone-page').count(), 1);
  assert.match(await page.locator('.marble-zone-page').innerText(), /Working/);
});
