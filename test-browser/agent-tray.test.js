// The tray: the launcher, and over it a menu of what an agent can do from
// here. What it has to get right is restraint — at rest it is one round
// button and nothing else, no agent affordance is pinned to a corner the
// document already owns — and, since v4, a card the hand can stay on, with
// switches kept in Agent settings rather than in it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// The fake agents these tests put on the page, followed from this tab as if
// it had asked for the work: only followed work draws a zone.
const FOLLOWED = ['c1', 'open'];

// A page that carries its own conversation chrome mounts no drawer, so there
// is no tray for the work toggle to live in.
const CUSTOM = `<!doctype html>
<html><head><meta charset="utf-8"><title>Custom</title>
<meta name="marble-agent" content="custom">
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; }</style>
</head>
<body data-marble-id="b">
  <p data-marble-id="p">A paragraph an agent is on.</p>
</body></html>
`;

const host = await startDrive({ documents: { garden: GARDEN, custom: CUSTOM } });
test.after(() => host.close());

async function visit(path = 'garden') {
  const { page, errors } = await host.newPage({ attending: FOLLOWED });
  await page.goto(`${host.base}/a/${path}`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  const drawer = page.locator('marble-agent-drawer');
  return { page, errors, drawer, tray: drawer.locator('.tray'), launcher: drawer.locator('.launcher') };
}

const working = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
}, { client: 'agent:c1', ids: ['h'], phase: 'writing', ...detail });

test('at rest the tray is the launcher and nothing else', async () => {
  await host.reset();
  const { page, tray, launcher, errors } = await visit();

  assert.equal(await launcher.isVisible(), true);
  assert.equal(await tray.locator('.tools').isVisible(), false, 'no menu is drawn before you ask');
  // The column above the launcher is empty air: the page under it takes the
  // click, or the tray is standing over a document saying nothing.
  const box = await launcher.boundingBox();
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? null,
    { x: box.x + box.width / 2, y: box.y - 60 },
  );
  assert.notEqual(hit, 'MARBLE-AGENT-DRAWER', 'the empty column does not swallow clicks');
  assert.deepEqual(errors.filter((m) => !/favicon/.test(m)), []);
});

test('hovering the launcher raises the tools, and leaving puts them down', async () => {
  await host.reset();
  const { tray, launcher } = await visit();

  await launcher.hover();
  const newChat = tray.locator('.tool[data-tool="new"]');
  await newChat.waitFor({ state: 'visible' });
  assert.equal(await newChat.getAttribute('aria-label'), 'New chat');
  assert.equal(await newChat.locator('.tool-label').innerText(), 'New chat', 'the row says it in words');
  assert.equal(await newChat.locator('.tool-key').innerText(), '⌘⇧O');

  await tray.page().mouse.move(10, 10);
  await tray.page().waitForFunction(
    () => document.querySelector('marble-agent-drawer')?.shadowRoot.querySelector('.tray')?.dataset.open === 'false',
  );
});

test('the menu is one surface: crossing from the launcher to a row keeps it open', async () => {
  await host.reset();
  const { page, tray, launcher } = await visit();
  await launcher.hover();
  const card = tray.locator('.tools');
  await card.waitFor({ state: 'visible' });
  const a = await launcher.boundingBox();
  const b = await card.boundingBox();
  assert.ok(b.y + b.height <= a.y, 'the card hangs over the launcher');
  assert.ok(Math.abs((b.x + b.width) - (a.x + a.width)) <= 1, 'and lines up with its right edge');
  // Rest in the air between the two, longer than the menu waits to close.
  await page.mouse.move(a.x + a.width / 2, (b.y + b.height + a.y) / 2, { steps: 4 });
  await page.waitForTimeout(450);
  assert.equal(await tray.evaluate((el) => el.dataset.open), 'true', 'the gap is the card\'s, to the hand');
  const rows = await tray.locator('.tool:not([hidden])').evaluateAll((els) => els.map((el) => el.dataset.tool));
  assert.ok(rows.includes('new') && rows.includes('point'), `what an agent can do from here: ${rows}`);
  for (const gone of ['agents', 'offers', 'rest', 'glints']) {
    assert.ok(!rows.includes(gone), `${gone} is not a row: a switch is a setting, and All agents is in the chat's More menu`);
  }
  // Reshape by hand is not a default: its row waits for Settings › Chat.
  assert.ok(!rows.includes('reshape'), `reshape is not a row by default: ${rows}`);
});

test('the switches that left the tray are in Agent settings › Chat', async () => {
  await host.reset();
  const { page } = await visit();
  await page.evaluate(() => window.marble.agent.openSettings('chat'));
  const sheet = page.locator('marble-agent-settings');
  const boxes = sheet.getByRole('checkbox');
  await boxes.first().waitFor();
  const named = await boxes.evaluateAll((els) => els.map((el) => [el.dataset.pref, el.checked]));
  assert.deepEqual(named, [['marble-ask-offers', true], ['marble-ask-rest', false], ['marble-agent-dots', false], ['marble-reshape', false]]);
  assert.match(await sheet.locator('.keys').innerText(), /⌘⇧J\s+Show or hide the chat/);
  await sheet.getByRole('checkbox', { name: 'Show agent dots' }).check();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-agent-dots')), null, 'Cancel keeps what was there');
  await page.evaluate(() => window.marble.agent.openSettings('chat'));
  await sheet.getByRole('checkbox', { name: 'Show agent dots' }).check();
  await sheet.getByRole('button', { name: 'Save' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-agent-dots')), '1');
});

test('the launcher has one mark: a dot that breathes while an agent works, and no spinner', async () => {
  await host.reset();
  const { page, drawer, launcher } = await visit();
  const dot = drawer.locator('.launcher-dot');
  assert.equal(await dot.isVisible(), false, 'nothing to say, no mark');
  await page.evaluate(async () => {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const { id } = await post('/agent/conversations', { provider: 'fake' });
    window.__held = id;
    await post(`/agent/conversations/${id}/turns`, { prompt: 'script:hold', context: { target: 'garden', viewing: 'garden', selection: [], also: [] } });
  });
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher-dot')?.dataset.state === 'working');
  assert.equal(await dot.evaluate((el) => getComputedStyle(el).animationName), 'launcher-breathe');
  assert.equal(await launcher.evaluate((el) => getComputedStyle(el, '::after').content), 'none', 'no arc spins round the button');
  assert.match(await launcher.getAttribute('aria-label'), /an agent is working/);
  await page.evaluate(async () => {
    const d = await window.marble.agent.conversation(window.__held);
    await window.marble.agent.cancel(d.turns.at(-1).id);
  });
});

test('a tool is in the tray only while it has something to do', async () => {
  await host.reset();
  const { page, tray, launcher } = await visit();
  const work = tray.locator('.tool[data-tool="work"]');
  const ask = tray.locator('.tool[data-tool="ask"]');

  await launcher.hover();
  assert.equal(await work.isVisible(), false, 'no agent working here, no work toggle');
  assert.equal(await ask.isVisible(), false, 'nothing selected, nothing to ask about');

  await working(page);
  await launcher.hover();
  await work.waitFor({ state: 'visible' });
  assert.equal(await work.getAttribute('aria-label'), 'Hide work', 'zones are up, so the tool puts them away');

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', { detail: { client: 'agent:c1', ids: [] } }));
  });
  await work.waitFor({ state: 'hidden' });
});

test('the work toggle keeps to the tray, never the page’s own top-right corner', async () => {
  await host.reset();
  const { page } = await visit();
  await working(page);
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', { detail: { client: 'agent:c1', ids: ['h'] } }));
  });

  // The old button sat at top: 20px; right: 20px of the viewport, which is
  // where a document's own chrome is — and where a pinned panel's bar is.
  const corner = page.locator('.marble-zones-show');
  assert.equal(await corner.count(), 1, 'the fallback still exists for pages with no tray');
  assert.equal(await corner.isVisible(), false);
});

test('a page with no drawer keeps the corner button', async () => {
  await host.reset();
  const { page } = await host.newPage({ attending: FOLLOWED });
  await page.goto(`${host.base}/a/custom`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  assert.equal(await page.locator('marble-agent-drawer').count(), 0);

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: ['p'], phase: 'writing' },
    }));
  });
  await page.locator('.marble-zone-label').getByRole('button', { name: 'Hide construction zone' }).click();
  await page.getByRole('button', { name: 'Show work' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Show work' }).click();
  assert.equal(await page.locator('.marble-zone').count(), 1);
});

test('Ask here arrives with a selection and summons the callout', async () => {
  await host.reset();
  const { page, tray, launcher } = await visit();
  const ask = tray.locator('.tool[data-tool="ask"]');

  await page.evaluate(() => {
    window.__summoned = 0;
    addEventListener('marble-callout:summon', (event) => {
      window.__summoned += 1;
      event.preventDefault();
    });
  });
  await launcher.hover();
  assert.equal(await ask.isVisible(), false);

  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await launcher.hover();
  await ask.waitFor({ state: 'visible' });
  await ask.click();
  assert.equal(await page.evaluate(() => window.__summoned), 1);
  assert.equal(
    await page.evaluate(() => document.querySelector('marble-agent-drawer').isOpen),
    false,
    'the callout took it, so the drawer stayed shut',
  );
});

test('with no hover to reveal with, only the contextual tools stand there', async () => {
  await host.reset();
  const { page } = await host.newPage({ attending: FOLLOWED, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);

  const drawn = () => page.evaluate(() => [...document.querySelector('marble-agent-drawer').shadowRoot
    .querySelectorAll('.tool')]
    .filter((el) => el.checkVisibility() && getComputedStyle(el).opacity === '1')
    .map((el) => el.dataset.tool));

  assert.deepEqual(await drawn(), [], 'nothing to do, so nothing is on the page');

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: { client: 'agent:c1', ids: ['h'], phase: 'writing' },
    }));
  });
  // New chat and All agents stay out of it — on a phone they would be
  // permanent furniture, and the drawer's own bar already carries both.
  assert.deepEqual(await drawn(), ['work']);
});

test('an overlay panel takes the tray with it; a pinned one leaves it on the page', async () => {
  await host.reset();
  const { page, drawer, tray, launcher } = await visit();
  const away = () => tray.evaluate((el) => el.dataset.away);

  await launcher.click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(await away(), 'true', 'an overlay covers the page the tools act on');

  await drawer.locator('.pin').click();
  await page.waitForFunction(
    () => document.querySelector('marble-agent-drawer')?.shadowRoot.querySelector('.tray')?.dataset.away === 'false',
  );
  const inset = await tray.evaluate((el) => el.style.getPropertyValue('--tray-inset'));
  const width = await drawer.locator('aside.panel').evaluate((el) => el.getBoundingClientRect().width);
  assert.equal(inset, `${Math.round(width)}px`, 'the tray sits at the page’s corner, not the panel’s');

  // And it clears the panel: the whole reason the old corner button was wrong.
  // It slides there, so give the slide its 220ms before measuring.
  await page.waitForFunction(() => {
    const root = document.querySelector('marble-agent-drawer').shadowRoot;
    const a = root.querySelector('.launcher').getBoundingClientRect();
    const b = root.querySelector('aside.panel').getBoundingClientRect();
    return a.right <= b.left + 1;
  }, undefined, { timeout: 4000 });
});
