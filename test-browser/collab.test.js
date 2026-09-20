import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

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

const DEEP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Deep</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; } .spacer { height: 2400px; }</style>
</head>
<body data-marble-id="b">
  <p data-marble-id="top">The top of the page.</p>
  <div class="spacer" data-marble-id="spacer"></div>
  <p data-marble-id="deep">Where the agent is working.</p>
</body></html>
`;

// A page that hosts its own conversation UI says so, and that is also what
// keeps the dock from mounting on it.
const CUSTOM = `<!doctype html>
<html><head><meta charset="utf-8"><title>Custom</title>
<meta name="marble-agent" content="custom">
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; }</style>
</head>
<body data-marble-id="b">
  <p data-marble-id="p">A paragraph an agent is on.</p>
</body></html>
`;

const host = await startDrive({
  agents: true,
  documents: { forked: FORKED, authored: AUTHORED, typing: TYPING, deep: DEEP, custom: CUSTOM, garden: GARDEN },
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

test('agent work with nothing to point at draws nothing', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const presence = async (detail) => {
    await page.evaluate((d) => {
      document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
    }, detail);
  };

  await presence({ client: 'agent:c1', ids: [], phase: 'working' });
  assert.equal(await page.locator('.marble-zone').count(), 0, 'no ids is no zone, not a banner over the page');

  await presence({ client: 'agent:c1', ids: ['not-on-this-page'], phase: 'working' });
  assert.equal(await page.locator('.marble-zone').count(), 0, 'ids that are not here have nowhere to land');

  assert.equal(await page.getByRole('button', { name: 'Show work' }).count(), 0, 'nothing hidden, nothing to show');
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
    return (await page.locator('.marble-zone-label').innerText()).replace(/\s*Open chat\s*Hide\s*$/, '').trim();
  };
  assert.equal(await labelFor({ phase: 'writing', note: 'PDF export gets a footer.' }), 'Agent · PDF export gets a footer');
  assert.equal(await labelFor({ phase: 'reading' }), 'Agent · reading');
  assert.equal(await labelFor({ phase: 'writing' }), 'Agent · writing');
  assert.equal(await labelFor({ phase: 'working' }), 'Agent · working');
});

// ------------------------------------------------------- the zone is someone else

const paint = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
}, detail);

test('the zone is a closed box with a wash, and it wears the document’s own accent', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await paint(page, { client: 'agent:c1', ids: ['p'], phase: 'writing' });

  const box = await page.locator('.marble-zone').evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      widths: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
      color: s.borderTopColor,
      fill: s.backgroundColor,
      clicks: s.pointerEvents,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    };
  });
  assert.equal(new Set(box.widths).size, 1, 'a full box, not four corners');
  assert.ok(parseFloat(box.widths[0]) > 0, 'a full box, not four corners');
  assert.notEqual(box.fill, 'rgba(0, 0, 0, 0)', 'the box is washed, not empty');
  assert.match(box.fill, /0\.1\d?\)?$/, 'and the wash is thin enough to read through');
  assert.equal(box.clicks, 'none', 'the work under the wash is still yours to click');
  // This fixture names no accent, so the agent falls back to its own violet
  // rather than to nothing.
  assert.equal(box.accent, '', 'the fixture declares no accent');
  // A color-mix() resolves to color(srgb …), not rgb(…).
  assert.match(box.color, /^(rgb|color\()/, 'and the zone is still drawn in something');

  // A document that does name an accent is what the agent works in. The zone
  // used to be deliberately outside every document's palette; its shape, its
  // wash and its label carry "someone else is here" now, and belonging to the
  // page it stands on costs nothing.
  const wearing = await page.evaluate(() => {
    document.documentElement.style.setProperty('--accent-ink', 'rgb(90, 114, 71)');
    return getComputedStyle(document.querySelector('.marble-zone')).borderTopColor;
  });
  assert.equal(wearing, 'rgb(90, 114, 71)', 'the zone wears the document’s accent');
});

test('Open chat opens the conversation in the dock, and on the Agents page on its own stage', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await paint(page, { client: 'agent:c1', ids: ['p'], phase: 'writing' });
  await page.evaluate(() => {
    window.opened = [];
    window.marble.agent.open = (id) => window.opened.push(id);
    addEventListener('marble-agent:open', (e) => window.opened.push(['stage', e.detail.id]));
  });
  await page.getByRole('button', { name: 'Open the conversation working here' }).click();
  assert.deepEqual(await page.evaluate(() => window.opened), ['c1'], 'an ordinary document opens the dock');

  const custom = await host.newPage();
  await custom.page.goto(`${host.base}/a/custom`);
  await custom.page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await paint(custom.page, { client: 'agent:c1', ids: ['p'], phase: 'writing' });
  await custom.page.evaluate(() => {
    window.opened = [];
    document.addEventListener('marble-agent:open', (e) => window.opened.push(e.detail.id));
  });
  await custom.page.getByRole('button', { name: 'Open the conversation working here' }).click();
  assert.deepEqual(await custom.page.evaluate(() => window.opened), ['c1'], 'a page with its own conversation UI keeps it');
});

test('an undo draws no zone, so it offers no chat', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await paint(page, { client: 'agent-undo:c1', ids: ['p'], phase: 'writing' });
  assert.equal(await page.getByRole('button', { name: 'Open the conversation working here' }).count(), 0);
});

test('arriving with #at= scrolls to the work, and spends the hash', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/deep#at=deep`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-marble-id="deep"]').getBoundingClientRect();
    return r.top > 0 && r.top < innerHeight;
  }, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => location.hash), '', 'the hash is an instruction, spent on arrival');
});

test('a conversation on the page it is working in scrolls there without a navigation', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/deep`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  assert.ok(await page.evaluate(() => scrollY) < 10);
  await page.evaluate(() => dispatchEvent(new CustomEvent('marble:jump-to', { detail: { ids: ['deep'] } })));
  await page.waitForFunction(() => scrollY > 1000, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => location.hash), '', 'no hash left in the history to get back past');
});

// ---------------------------------------------------------------- the trail
// These drive collab.js the way the rest of this file does, with the events
// the carrier and the host really send. The end-to-end path — a real turn
// leaving a real trail — is test-browser/callout.test.js.

const onTyping = async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/typing`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  return page;
};

const agentOps = (page, client, ops) => page.evaluate(([c, o]) => {
  document.dispatchEvent(new CustomEvent('marble:ops', { detail: { ops: o, client: c } }));
}, [client, ops]);

const zoneFor = (page, client, detail = {}) => page.evaluate(([c, d]) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: { client: c, ...d } }));
}, [client, detail]);

test('an agent op leaves a trail on the element, and reviewing the chat clears it', async () => {
  const page = await onTyping();
  await agentOps(page, 'agent:c1', [{ type: 'setText', id: 'h', text: 'Backlog' }]);
  await page.locator('[data-marble-id="h"].marble-trail').waitFor();
  // The flash is an animated box-shadow over the same element; the trail is
  // what is left when it has gone.
  await page.locator('[data-marble-id="h"].marble-flash').waitFor({ state: 'detached' });
  const shadow = await page.locator('[data-marble-id="h"]').evaluate((el) => getComputedStyle(el).boxShadow);
  assert.match(shadow, /inset/, 'the trail is an inset rule, not a border');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id: 'c1' } })));
  assert.equal(await page.locator('[data-marble-id="h"].marble-trail').count(), 0);
});

test('an undo of an agent turn takes the trail back off', async () => {
  const page = await onTyping();
  await agentOps(page, 'agent:c1', [{ type: 'setText', id: 'h', text: 'Backlog' }]);
  await page.locator('[data-marble-id="h"].marble-trail').waitFor();
  await agentOps(page, 'agent-undo:c1', [{ type: 'setText', id: 'h', text: 'Head' }]);
  assert.equal(await page.locator('[data-marble-id="h"].marble-trail').count(), 0);
});

test("a person's own ops leave no trail", async () => {
  const page = await onTyping();
  await agentOps(page, 'person:someone', [{ type: 'setText', id: 'h', text: 'Mine' }]);
  assert.equal(await page.locator('.marble-trail').count(), 0);
});

test('a claimed zone hides its label, and Open chat can be taken by a callout', async () => {
  const page = await onTyping();
  await zoneFor(page, 'agent:c1', { ids: ['p'], phase: 'writing', note: 'Rename the heading.' });
  await page.locator('.marble-zone-label').waitFor();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('marble-callout:docked', { detail: { id: 'c1' } })));
  await page.locator('.marble-zone-label[hidden]').waitFor({ state: 'attached' });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('marble-callout:undocked', { detail: { id: 'c1' } })));
  await page.locator('.marble-zone-label:not([hidden])').waitFor();
  const taken = await page.evaluate(() => new Promise((resolve) => {
    document.addEventListener('marble-callout:open', (event) => { event.preventDefault(); resolve(event.detail.id); }, { once: true });
    document.querySelector('.marble-zone-label button').click();
  }));
  assert.equal(taken, 'c1');
  assert.equal(
    await page.evaluate(() => Boolean(document.querySelector('marble-agent-drawer')?.isOpen)),
    false,
    'the drawer did not open: the callout took the click',
  );
});

test('a zone nobody claimed still opens its chat in the dock', async () => {
  const page = await onTyping();
  await zoneFor(page, 'agent:c1', { ids: ['p'], phase: 'writing' });
  await page.getByRole('button', { name: 'Open the conversation working here' }).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
});

test('marble.collab exposes the zone geometry and label helpers', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  const out = await page.evaluate(() => {
    const els = ['q1', 'q2'].map((id) => document.querySelector(`[data-marble-id="${id}"]`));
    return {
      tape: window.marble.collab.tapeTarget(els)?.getAttribute('data-marble-id'),
      body: window.marble.collab.tapeTarget([document.body]),
      label: window.marble.collab.phaseLabel({ phase: 'writing', note: 'Rename the heading.' }),
    };
  });
  assert.deepEqual(out, { tape: 'q', body: null, label: 'Agent · rename the heading' });
});
