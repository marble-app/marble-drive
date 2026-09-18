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

const TYPING = `<!doctype html>
<html><head><meta charset="utf-8"><title>Typing</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; }</style>
</head>
<body data-marble-id="b">
  <h1 data-marble-id="h" contenteditable="true">Head</h1>
  <p data-marble-id="p">A paragraph the agent is on.</p>
</body></html>
`;

const host = await startDrive({
  agents: true,
  documents: { forked: FORKED, authored: AUTHORED, typing: TYPING },
});
test.after(() => host.close());

test('a conflict fork says why it is there, and shows You, Agent, Keep this, and Ask an agent to combine', async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const bar = page.locator('marble-alt > .marble-fork');
  await bar.waitFor();

  const labels = await bar.locator('button').allTextContents();
  assert.deepEqual(labels.map((t) => t.trim()), ['You', 'Agent', 'Keep this', 'Ask an agent to combine']);
  assert.equal(await bar.locator('.marble-fork-why').textContent(), 'You and the agent both changed this.');
  assert.equal(await bar.getByRole('button', { name: 'Approve' }).count(), 0);
  assert.equal(await bar.getByRole('button', { name: 'Reject' }).count(), 0);
  assert.equal(await page.locator('h1.marble-alt-shown').textContent(), 'Yours');
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('Ask an agent to combine hands both versions to the agent drawer', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.locator('marble-alt > .marble-fork').waitFor();
  await page.evaluate(() => {
    window.__agent = { selected: null, aimed: null, opened: 0 };
    window.marble.agent = {
      select: (ids) => { window.__agent.selected = ids; },
      aim: (app) => { window.__agent.aimed = app; },
      current: () => null,
      send: () => {},
      open: () => { window.__agent.opened += 1; },
    };
  });
  await page.getByRole('button', { name: 'Ask an agent to combine both versions' }).click();
  const seen = await page.evaluate(() => window.__agent);
  assert.deepEqual(seen.selected, ['hy', 'ha']);
  assert.equal(seen.opened, 1);
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
  assert.match(await zone.innerText(), /Agent · working/);
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
      detail: { client: 'agent:c1', ids: ['p'], phase: 'writing', note: 'Rename the heading.' },
    }));
  });
  const zone = page.locator('.marble-zone');
  assert.match(await zone.innerText(), /Agent · rename the heading(?!\.)/);

  await page.getByRole('button', { name: 'Hide' }).click();
  assert.equal(await page.locator('.marble-zone').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Show work' }).count(), 1);

  await page.getByRole('button', { name: 'Show work' }).click();
  assert.equal(await page.locator('.marble-zone').count(), 1);
});

const zoneTop = (page) => page.locator('.marble-zone').evaluate((el) => el.getBoundingClientRect().top);
const targetTop = (page, id) => page.locator(`[data-marble-id="${id}"]`).evaluate((el) => el.getBoundingClientRect().top);

test('the construction zone follows its target when the person’s own typing moves it', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/typing`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: ['p'], phase: 'writing', note: 'grow the page' },
    }));
  });
  await page.locator('.marble-zone').waitFor();
  const before = await zoneTop(page);

  // The person's own edits never come back as ops or presence, so nothing
  // but the page itself says the target moved.
  await page.click('[data-marble-id="h"]');
  await page.keyboard.press('End');
  await page.keyboard.type(' ' + 'words '.repeat(120));
  await page.waitForTimeout(300);

  const target = await targetTop(page, 'p');
  const after = await zoneTop(page);
  assert.ok(target - before > 300, `the target moved (${before} → ${target})`);
  assert.ok(Math.abs(after - (target - 10)) < 2, `zone top ${after} should sit 10px above the target at ${target}`);
});

test('the construction zone finds its target again after it is replaced', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/typing`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: ['p'], phase: 'writing' },
    }));
  });
  await page.locator('.marble-zone').waitFor();

  // Applied locally so no presence frame arrives to repaint the zone for us.
  await page.evaluate(() => {
    window.marble.apply({ type: 'remove', id: 'p' });
    window.marble.apply({
      type: 'insert',
      html: '<div data-marble-id="tall" style="height:400px"></div><p data-marble-id="p">Back again.</p>',
      parentId: 'b',
      beforeId: null,
    });
  });
  await page.waitForTimeout(300);

  const target = await targetTop(page, 'p');
  const after = await zoneTop(page);
  assert.ok(target > 300, `the new target sits low on the page (${target})`);
  assert.ok(Math.abs(after - (target - 10)) < 2, `zone top ${after} should sit 10px above the target at ${target}`);
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
  assert.match(await page.locator('.marble-zone-page').innerText(), /Agent · working/);
});

test('the construction label keeps an all-caps first word and names the phase without a note', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const labelFor = async (detail) => {
    await page.evaluate((d) => {
      document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
    }, { client: 'agent:c1', ids: ['p'], ...detail });
    return (await page.locator('.marble-zone-label').innerText()).replace(/\s*Hide\s*$/, '').trim();
  };
  assert.equal(await labelFor({ phase: 'writing', note: 'PDF export gets a footer.' }), 'Agent · PDF export gets a footer');
  assert.equal(await labelFor({ phase: 'reading' }), 'Agent · reading');
  assert.equal(await labelFor({ phase: 'writing' }), 'Agent · writing');
  assert.equal(await labelFor({ phase: 'working' }), 'Agent · working');
});
