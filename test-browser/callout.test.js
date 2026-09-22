import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  building: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { sleep: 1500 },
    { say: 'done' },
  ],
  hold: [{ silent: 20_000 }],
  quiet: [{ say: 'Nothing to change.' }],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

// A reset drive keeps its conversations, and this layer rebuilds a callout
// for every unreviewed chat about the document it opens — so one test's chat
// would hang over the next test's page.
// A turn left running is a live child process, so this stops them as well as
// filing them: several 20-second holds at once is a slow machine, not a test.
const clearConversations = async () => {
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  for (const summary of list) {
    if (summary.status === 'running' || summary.queued) {
      const detail = await (await fetch(`${host.base}/agent/conversations/${summary.id}`)).json();
      for (const turn of detail.turns ?? []) {
        if (turn.status === 'running') await fetch(`${host.base}/agent/turns/${turn.id}/cancel`, { method: 'POST' });
        if (turn.status === 'queued') await fetch(`${host.base}/agent/turns/${turn.id}`, { method: 'DELETE' });
      }
    }
    await fetch(`${host.base}/agent/conversations/${summary.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
  }
};

// Every page left open keeps its streams and rebuilds its own callouts; a
// file's worth of them is a busy machine, not a test.
const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async (doc = 'garden', { width = 1200, height = 800 } = {}) => {
  await closePages();
  await host.reset();
  await clearConversations();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

// selectionchange is queued, not synchronous: a gesture that reads the
// context has to wait for it the way a person's hand does.
const select = async (page, id) => {
  await page.evaluate((mid) => {
    const el = document.querySelector(`[data-marble-id="${mid}"]`);
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, id);
  await page.waitForFunction((mid) => window.marble.agent.context().selection.includes(mid), id);
};

const handle = (page) => page.locator('.marble-callout-handle:not([hidden])');
const card = (page) => page.locator('.marble-callout[data-state="card"]');

test('a settled selection grows a handle, and collapsing takes it away', async () => {
  const page = await open();
  assert.equal(await handle(page).count(), 0);
  await select(page, 'h');
  await handle(page).waitFor();
  const [h, dot] = await Promise.all([
    page.locator('[data-marble-id="h"]').boundingBox(),
    handle(page).boundingBox(),
  ]);
  assert.ok(dot.y >= h.y + h.height - 2, 'the handle hangs below the selection');
  assert.ok(Math.abs(dot.x - (h.x - 10)) < 3, 'left edge lines up with where the zone label will hang');
  await page.evaluate(() => getSelection().collapse(document.querySelector('[data-marble-id="p"]').firstChild, 1));
  await page.locator('.marble-callout-handle[hidden]').waitFor({ state: 'attached' });
});

test('the handle opens a card holding a callout conversation, and typing does not lose the selection', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await card(page).waitFor();
  const convo = card(page).locator('marble-conversation[data-chrome="callout"]');
  await convo.locator('.editor').waitFor();
  assert.equal(await page.locator('.marble-callout-status').innerText(), 'Ask about this');
  await convo.locator('.editor').click();
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['q1'], 'focus into the card is not a new selection');
  assert.equal(await handle(page).count(), 0, 'the handle steps aside for the card');
});

test('⌘J with a selection summons a card; without one it toggles the drawer', async () => {
  const page = await open();
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === false);
  await select(page, 'p');
  await page.keyboard.press('Control+j');
  await card(page).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen), false, 'the drawer stayed shut');
});

test('at phone width the handle opens the drawer with the selection instead of a card', async () => {
  const page = await open('garden', { width: 393, height: 700 });
  await select(page, 'h');
  await handle(page).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(await card(page).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['h']);
});

test('at phone width the in-situ handle starts a new conversation', async () => {
  const page = await open('garden', { width: 393, height: 700 });
  const earlier = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    window.marble.agent.remember(id);
    return id;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForFunction((id) => document.querySelector('marble-agent-drawer')?.shadowRoot.querySelector('marble-conversation')?.getAttribute('conversation') === id, earlier);
  await select(page, 'h');
  await handle(page).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  const shown = await page.evaluate(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation').getAttribute('conversation'));
  assert.notEqual(shown, earlier, 'spawning in the document does not continue the chat this tab was in');
});

test('the Agents page draws no callout layer', async () => {
  const page = await open('Agents');
  await page.waitForFunction(() => Boolean(document.querySelector('marble-conversation')));
  assert.equal(await page.locator('.marble-callout-layer').count(), 0);
});

test('Option-click picks elements, Escape clears, and a new text selection replaces the picks', async () => {
  const page = await open();
  const q2 = await page.locator('[data-marble-id="q2"]').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(q2.x + 10, q2.y + q2.height / 2);
  await page.locator('.marble-callout-pick:not([hidden])').waitFor();
  await page.mouse.click(q2.x + 10, q2.y + q2.height / 2);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q2"]');
  const p = await page.locator('[data-marble-id="p"]').boundingBox();
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q2","p"]');
  await handle(page).waitFor();

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);

  await page.keyboard.down('Alt');
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  // A fresh text selection is the person choosing something else.
  await select(page, 'h');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
});

test('Option-clicking the same element twice takes it back off', async () => {
  const page = await open();
  const p = await page.locator('[data-marble-id="p"]').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
  assert.equal(await page.locator('.marble-callout-pick:not([hidden])').count(), 0, 'the outline goes with the key');
});

const sendFromCard = async (page, prompt) => {
  const editor = card(page).locator('marble-conversation .editor');
  await editor.click();
  await page.keyboard.type(prompt);
  await page.keyboard.press('Enter');
};
const firstConversation = (page) => page.evaluate(async () => {
  const [summary] = await window.marble.agent.conversations();
  return summary ? { summary, detail: await window.marble.agent.conversation(summary.id) } : null;
});

test('a brief sent from the card carries the selection, docks to the zone, and ends with Undo and Done', async () => {
  const page = await open();
  await select(page, 'h');
  await handle(page).click();
  await sendFromCard(page, 'script:building');
  await page.locator('.marble-zone').waitFor();
  const { summary, detail } = await firstConversation(page);
  assert.deepEqual(detail.turns[0].context.selection, ['h'], 'the turn carries the selection');
  assert.equal(detail.turns[0].context.target, 'garden');

  await page.locator('.marble-zone-label[hidden]').waitFor({ state: 'attached' });
  await page.locator('.marble-callout-status', { hasText: 'Agent · rename the heading' }).waitFor();
  assert.ok(await page.locator('.marble-callout[data-live]').count(), 'the head pulses while the turn runs');

  await page.locator('.marble-callout-status', { hasText: 'Changed 1 element' }).waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('.marble-zone').count(), 0, 'the zone went with the turn');
  assert.equal(await page.locator('[data-marble-id="h"].marble-trail').count(), 1);

  await page.getByRole('button', { name: 'Undo this turn' }).click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="h"]').textContent === 'Research Garden');
  await page.locator('.marble-callout-status', { hasText: 'Undone' }).waitFor();

  await page.getByRole('button', { name: 'Mark reviewed and put the callout away' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout').length === 0);
  assert.equal(await page.locator('.marble-trail').count(), 0);
  const after = await page.evaluate(async (cid) => (await window.marble.agent.conversations()).find((s) => s.id === cid), summary.id);
  assert.equal(after.needsReview, false, 'Done reviewed the chat');
});

test('a turn that changes nothing says so, and folding a live card gives the zone its label back', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:hold');
  await page.locator('.marble-zone').waitFor();
  await page.locator('.marble-zone-label[hidden]').waitFor({ state: 'attached' });

  await page.getByRole('button', { name: 'Minimize' }).click();
  // Folded while the agent works: the zone's own label is the folded callout.
  await page.locator('.marble-callout[data-state="pill"][hidden]').waitFor({ state: 'attached' });
  await page.locator('.marble-zone-label:not([hidden])').waitFor();
  // The pill under the overlay opens the tooltip. It does not open the drawer.
  await page.locator('.marble-zone-label:not([hidden]) span:not(.marble-zone-live)').click();
  await card(page).waitFor();
  assert.equal(
    await page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen === true),
    false,
    'the pill under the zone opens the tooltip',
  );
  await page.getByRole('button', { name: 'Minimize' }).click();

  await page.evaluate(async () => {
    const [s] = await window.marble.agent.conversations();
    const d = await window.marble.agent.conversation(s.id);
    await window.marble.agent.cancel(d.turns.at(-1).id);
  });
  await page.locator('.marble-callout-status', { hasText: 'Stopped' }).waitFor({ timeout: 10_000 });
});

test('a turn that touches nothing reads No changes', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  assert.equal(await page.getByRole('button', { name: 'Undo this turn' }).count(), 0, 'nothing to undo');
  await page.getByRole('button', { name: 'Mark reviewed and put the callout away' }).waitFor();
});

const cancelLast = (page) => page.evaluate(async () => {
  const [s] = await window.marble.agent.conversations();
  const d = await window.marble.agent.conversation(s.id);
  await window.marble.agent.cancel(d.turns.at(-1).id);
});

test('a reload while the agent works rebuilds the card at its region, and a fold is remembered', async () => {
  const page = await open();
  await select(page, 'q1');
  await handle(page).click();
  await sendFromCard(page, 'script:hold');
  await page.locator('.marble-zone').waitFor();

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await card(page).waitFor();
  const [q1, box] = await Promise.all([page.locator('[data-marble-id="q1"]').boundingBox(), card(page).boundingBox()]);
  assert.ok(box.y > q1.y, 'the card hangs at the question it was about');

  await page.getByRole('button', { name: 'Minimize' }).click();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  // Still running, so the fold is remembered and the zone's label carries it.
  await page.locator('.marble-callout[data-state="pill"]').waitFor({ state: 'attached' });
  await page.locator('.marble-zone-label:not([hidden])').waitFor();
  await cancelLast(page);
  // The turn over, the pill comes back with what it has to say.
  await page.locator('.marble-callout[data-state="pill"]:not([hidden])').waitFor({ timeout: 10_000 });
});

test('a prompt sent from the drawer with a selection gets a callout too, and Open chat on its zone unfolds it', async () => {
  const page = await open();
  // The drawer first, then the selection: opening the drawer takes focus, and
  // a selection made before it goes with it.
  await page.evaluate(() => window.marble.agent.open());
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  await select(page, 'h');
  const drawerEditor = page.locator('marble-agent-drawer marble-conversation .editor');
  await drawerEditor.click();
  await page.keyboard.type('script:building');
  await page.keyboard.press('Enter');
  await page.locator('.marble-callout').waitFor();

  await page.getByRole('button', { name: 'Minimize' }).click();
  await page.locator('.marble-zone-label:not([hidden]) button', { hasText: 'Open chat' }).click();
  await card(page).waitFor();
});

test('a finished chat that was never reviewed comes back as a pill', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await sendFromCard(page, 'script:building');
  await page.locator('.marble-callout-status', { hasText: 'Changed' }).waitFor({ timeout: 15_000 });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const pill = page.locator('.marble-callout[data-state="pill"]');
  await pill.waitFor();
  assert.match(await pill.innerText(), /\S/, 'a pill says which chat it is');
  // Undo and Done live in the card: they come after looking.
  assert.equal(await page.getByRole('button', { name: 'Mark reviewed and put the callout away' }).isVisible(), false);
  await pill.locator('.marble-callout-status').click();
  await card(page).waitFor();
  await page.getByRole('button', { name: 'Mark reviewed and put the callout away' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout').length === 0);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.marble-callout').count(), 0, 'a reviewed chat does not come back');
});

test('a summoned callout starts a new conversation, and Open beside moves that chat to the drawer', async () => {
  const page = await open();
  // The chat this tab was last in. Spawning at a selection must not pick it up.
  const earlier = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.send(id, { prompt: 'script:quiet', target: 'garden' });
    await new Promise((resolve) => {
      const off = window.marble.agent.on(id, (e) => { if (e.type === 'turn.completed') { off(); resolve(); } });
    });
    window.marble.agent.remember(id);
    return id;
  });
  await select(page, 'q2');
  await handle(page).click();
  await card(page).waitFor();
  assert.equal(await page.locator('.marble-callout-tools button', { hasText: 'Continue in' }).count(), 0);
  const convo = card(page).locator('marble-conversation');
  assert.equal(await convo.getAttribute('conversation'), null);

  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const id = await convo.getAttribute('conversation');
  assert.ok(id && id !== earlier, 'the brief is a new conversation');

  await page.getByRole('button', { name: 'Open this chat on the side' }).click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  assert.equal(
    await page.evaluate(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation').getAttribute('conversation')),
    id,
  );
  await page.locator('.marble-callout[data-state="pill"]').waitFor();
});

test('the corner buttons line up, and resting on one names it', async () => {
  const page = await open();
  await select(page, 'h');
  await handle(page).click();
  await card(page).waitFor();
  const side = page.getByRole('button', { name: 'Open this chat on the side' });
  const minimize = page.getByRole('button', { name: 'Minimize' });
  const [a, b] = await Promise.all([side.boundingBox(), minimize.boundingBox()]);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.ok(Math.abs(a.y - b.y) < 1, 'the two icons share a line');

  await side.hover();
  const tip = page.locator('.marble-callout-tip');
  await tip.waitFor();
  assert.equal(await tip.innerText(), 'Open on the side');
  const tipBox = await tip.boundingBox();
  const overlaps = tipBox.y < a.y + a.height && tipBox.y + tipBox.height > a.y
    && tipBox.x < a.x + a.width && tipBox.x + tipBox.width > a.x;
  assert.equal(overlaps, false, 'the tip sits clear of the button');

  await minimize.hover();
  await page.locator('.marble-callout-tip', { hasText: 'Minimize' }).waitFor();
});

test('the side button is on the card before a chat exists, and it does not resume the last one', async () => {
  const page = await open();
  const earlier = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    window.marble.agent.remember(id);
    return id;
  });
  await select(page, 'h');
  await handle(page).click();
  await card(page).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open this chat on the side' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Minimize' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Open this chat on the Agents page' }).isVisible(), false);

  await page.getByRole('button', { name: 'Open this chat on the side' }).click();
  await page.locator('.marble-callout[data-state="pill"]').waitFor();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.isOpen === true);
  const drawerId = await page.evaluate(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation').getAttribute('conversation'));
  assert.notEqual(drawerId, earlier, 'opening the side before a send does not resume the last chat');

  await page.locator('.marble-callout-status').click();
  await card(page).waitFor();
});

test('Open in Agents leaves for the Agents page with the chat open', async () => {
  const page = await open();
  await select(page, 'h');
  await handle(page).click();
  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const { summary } = await firstConversation(page);
  await page.getByRole('button', { name: 'Open this chat on the Agents page' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/a/Agents'));
  await page.waitForFunction((cid) => document.querySelector(`marble-conversation[conversation="${cid}"]`) !== null, summary.id);
  assert.equal(new URL(page.url()).searchParams.has('open'), false, 'the parameter is spent');
});

test('Minimize hides the card as a pill, and the pill opens the card again', async () => {
  const page = await open();
  await select(page, 'p');
  await handle(page).click();
  await card(page).waitFor();
  await page.getByRole('button', { name: 'Minimize' }).click();
  const pill = page.locator('.marble-callout[data-state="pill"]');
  await pill.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open this chat on the side' }).isVisible(), false, 'the pill has no way to open the drawer');
  await page.locator('.marble-callout-status').click();
  await card(page).waitFor();
  assert.equal(
    await page.evaluate(() => document.querySelector('marble-agent-drawer')?.isOpen === true),
    false,
    'opening the pill opens the tooltip',
  );

  await sendFromCard(page, 'script:quiet');
  await page.locator('.marble-callout-status', { hasText: 'No changes' }).waitFor({ timeout: 10_000 });
  const { summary } = await firstConversation(page);
  await page.getByRole('button', { name: 'Minimize' }).click();
  await pill.waitFor();
  const after = await page.evaluate(async (cid) => (await window.marble.agent.conversations()).find((s) => s.id === cid), summary.id);
  assert.equal(after.needsReview, true, 'minimizing does not review the chat');
});
