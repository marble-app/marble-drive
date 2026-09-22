// The tray: the launcher, and above it the agent tools that have something to
// do right now. What it has to get right is restraint — at rest it is one
// round button and nothing else, and no agent affordance is pinned to a corner
// the document already owns.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

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
  const { page, errors } = await host.newPage();
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
  for (const tool of await tray.locator('.tool').all()) {
    assert.equal(await tool.evaluate((el) => getComputedStyle(el).opacity), '0', 'no tool is drawn before you ask');
  }
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
  const agents = tray.locator('.tool[data-tool="agents"]');
  await newChat.waitFor({ state: 'visible' });
  assert.equal(await agents.isVisible(), true);
  assert.equal(await newChat.getAttribute('aria-label'), 'New chat');
  assert.equal(await agents.getAttribute('aria-label'), 'All agents');

  await tray.page().mouse.move(10, 10);
  await tray.page().waitForFunction(
    () => document.querySelector('marble-agent-drawer')?.shadowRoot.querySelector('.tray')?.dataset.open === 'false',
  );
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
  const { page } = await host.newPage();
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
  const { page } = await host.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
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
