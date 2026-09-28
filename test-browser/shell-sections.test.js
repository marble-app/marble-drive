// The shell's tree, section by section: Pinned is read out of the Drive's own
// file, Agents is every document an agent is at with a pip per agent, and the
// sections fold and move where you put them. What it has to get right is that
// none of this is a second copy of anything — a pin is the Drive's, a state is
// the conversation's — and that the order you give the sections is kept.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// The Drive's pins, the way templates/drive.mrbl writes them.
const DRIVE = `<!doctype html>
<html><head><meta charset="utf-8"><title>My Drive</title></head>
<body data-marble-id="b">
  <ul class="pins" id="pins" data-marble-id="pins">
    <li class="pin" data-marble-id="p1" data-path="Travel/plans" data-kind="doc"><span class="ico" data-marble-id="p1i">·</span><span data-marble-id="p1l" data-marble-editable>plans</span></li>
    <li class="pin" data-marble-id="p2" data-path="Travel" data-kind="folder"><span class="ico" data-marble-id="p2i">·</span><span data-marble-id="p2l" data-marble-editable>Travel</span></li>
  </ul>
</body></html>
`;

const host = await startDrive({
  documents: { garden: GARDEN, 'Travel/plans': GARDEN, 'Research/atlas': GARDEN, drive: DRIVE },
  scripts: {
    slow: [{ sleep: 60_000 }],
    ask: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }],
    done: [{ text: 'Done.' }],
  },
});
test.after(() => host.close());

async function visit(path = 'garden') {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${path.split('/').map(encodeURIComponent).join('/')}`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot && window.marble?.agent);
  const shell = page.locator('marble-shell');
  return { page, errors, shell };
}

const open = async (page) => {
  await page.keyboard.press('Control+j');
  await page.locator('marble-shell').locator('.sec[data-sec="drive"]').waitFor();
};
const order = (shell) => shell.locator('.scroll > .sec').evaluateAll((els) => els.map((el) => el.dataset.sec));

test('Pinned is the Drive\'s own pins, in the Drive\'s order, and a pinned folder opens the Drive there', async () => {
  const { page, shell } = await visit();
  await open(page);
  const pins = shell.locator('.sec[data-sec="pinned"] a.row');
  await pins.first().waitFor();
  assert.deepEqual(await pins.locator('span:first-of-type').allInnerTexts(), ['plans', 'Travel']);
  assert.equal(await pins.nth(0).getAttribute('href'), '/a/Travel%2Fplans');
  assert.equal(await pins.nth(1).getAttribute('href'), `/#/${encodeURIComponent('Travel')}`);
  assert.deepEqual(await order(shell), ['pinned', 'recent', 'agents', 'drive']);
});

test('Agents: a row per document, a pip per agent most urgent first, bold while unread, and a count of who needs you', async () => {
  const { page, shell } = await visit();
  const ids = await page.evaluate(async () => {
    const a = window.marble.agent;
    const go = async (target, prompt) => {
      const id = await a.start({ provider: 'fake' });
      await a.send(id, { prompt, target, viewing: target });
      return id;
    };
    return {
      done: await go('Research/atlas', 'script:done'),
      slow: await go('Travel/plans', 'script:slow'),
      ask: await go('Travel/plans', 'script:ask'),
    };
  });
  await open(page);
  const plans = shell.locator('.row.app[data-app="Travel/plans"]');
  await page.waitForFunction(() => {
    const row = document.querySelector('marble-shell').shadowRoot.querySelector('.row.app[data-app="Travel/plans"]');
    return [...(row?.querySelectorAll('.pip') ?? [])].map((p) => p.dataset.st).join() === 'waiting,working';
  });
  assert.equal(await plans.getAttribute('data-unread'), '', 'an agent waiting on you is unread');
  assert.equal(await plans.locator('.pips').getAttribute('aria-label'), '1 needs you, 1 working');
  assert.match(await shell.locator('.sec[data-sec="agents"] .sec-meta').innerText(), /1 needs you/);
  // The one that needs you comes first.
  assert.equal(await shell.locator('.row.app').first().getAttribute('data-app'), 'Travel/plans');
  const atlas = shell.locator('.row.app[data-app="Research/atlas"]');
  await page.waitForFunction(() => document.querySelector('marble-shell').shadowRoot.querySelector('.row.app[data-app="Research/atlas"] .pip')?.dataset.st === 'done');
  assert.equal(await atlas.getAttribute('data-unread'), '', 'finished and not yet looked at');

  // Two agents at one document fold into one row that opens to show both.
  await plans.locator('[data-fold-app]').click();
  const threads = shell.locator('.thread');
  assert.equal(await threads.count(), 2);

  // A conversation opens at its document with the chat beside it, showing it.
  await shell.locator(`.row.app[data-app="Research/atlas"] [data-thread="${ids.done}"]`).click();
  await page.waitForURL(/\/a\/Research(%2F|\/)atlas/);
  await page.waitForFunction((id) => {
    const drawer = document.querySelector('marble-agent-drawer');
    return drawer?.isOpen && drawer.shadowRoot.querySelector('marble-conversation').getAttribute('conversation') === id;
  }, ids.done);
  // Seen, it is no longer bold.
  await page.waitForFunction(() => {
    const row = document.querySelector('marble-shell')?.shadowRoot.querySelector('.row.app[data-app="Research/atlas"]');
    return row && !row.hasAttribute('data-unread');
  });
  await page.evaluate((all) => Promise.all(Object.values(all).map((id) => window.marble.agent.archive(id, true))), ids);
});

test('sections fold, and the fold is remembered', async () => {
  const { page, shell } = await visit();
  await open(page);
  await shell.locator('.sec[data-sec="recent"] .sec-fold').click();
  assert.equal(await shell.locator('.sec[data-sec="recent"] ul').isVisible(), false);
  await page.reload();
  await page.locator('marble-shell').locator('.sec[data-sec="recent"]').waitFor();
  assert.equal(await page.locator('marble-shell').locator('.sec[data-sec="recent"]').getAttribute('data-folded'), '');
});

test('a section moves by its grip, with the pointer or with Alt and the arrows, and stays where it was put', async () => {
  const { page, shell } = await visit();
  await open(page);
  // Drag Drive up above Recent.
  const grip = shell.locator('.sec[data-sec="drive"] .sec-grip');
  await shell.locator('.sec[data-sec="drive"] .sec-h').hover();
  const g = await grip.boundingBox();
  const recent = await shell.locator('.sec[data-sec="recent"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, recent.y + 4, { steps: 12 });
  assert.equal(await shell.locator('.sec[data-sec="drive"]').getAttribute('data-lifted'), '', 'held while it moves');
  await page.mouse.up();
  assert.deepEqual(await order(shell), ['pinned', 'drive', 'recent', 'agents']);
  assert.equal(await shell.locator('.sec[data-lifted]').count(), 0);

  // Alt+Down on a grip moves its section one place down.
  await shell.locator('.sec[data-sec="pinned"] .sec-grip').focus();
  await page.keyboard.press('Alt+ArrowDown');
  assert.deepEqual(await order(shell), ['drive', 'pinned', 'recent', 'agents']);
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  assert.deepEqual(await order(shell), ['pinned', 'drive', 'recent', 'agents'], 'the top is as far up as it goes');

  await page.goto(`${host.base}/a/Travel%2Fplans`);
  await page.locator('marble-shell').locator('.sec[data-sec="drive"]').waitFor();
  assert.deepEqual(await order(page.locator('marble-shell')), ['pinned', 'drive', 'recent', 'agents'], 'kept on the next document');
});

const startDone = (page, target) => page.evaluate(async (target) => {
  const a = window.marble.agent;
  const id = await a.start({ provider: 'fake' });
  await a.send(id, { prompt: 'script:done', target, viewing: target });
  return id;
}, target);
const settledDone = (page, id) => page.waitForFunction(async (id) => (await window.marble.agent.conversations()).find((c) => c.id === id)?.status === 'done', id);

test('Agents keeps to the Agents page\'s idle cut: older conversations are left out and counted, and "all" brings them back', async () => {
  const { page, shell } = await visit();
  // The old one first: the newest is the one the chat shows, and the one
  // showing is never hidden.
  const old = await startDone(page, 'Research/atlas');
  const fresh = await startDone(page, 'Travel/plans');
  await settledDone(page, fresh);
  await settledDone(page, old);
  // Two days since anyone touched it.
  const then = Date.now() - 2 * 24 * 60 * 60 * 1000;
  // Written straight into its record: the store stamps updatedAt on every
  // update. The runner may still be finishing the turn's own write, so it is
  // written until the host reads it back old.
  const file = path.join(host.drive.store.marbleDir, 'agents', old, 'meta.json');
  for (let tries = 0; tries < 20; tries += 1) {
    const meta = JSON.parse(await fsp.readFile(file, 'utf8'));
    await fsp.writeFile(file, JSON.stringify({ ...meta, createdAt: then, updatedAt: then, lastFinishedAt: then, lastInteractedAt: then }));
    await page.waitForTimeout(150);
    const seen = await page.evaluate(async (id) => (await window.marble.agent.conversations()).find((c) => c.id === id), old);
    if (seen && seen.updatedAt === then && seen.lastFinishedAt === then) break;
  }
  await page.evaluate(() => localStorage.setItem('marble-agents:idle', String(24 * 60)));
  await page.reload();
  await open(page);
  await shell.locator('.row.app[data-app="Travel/plans"]').waitFor();
  assert.equal(await shell.locator('.row.app[data-app="Research/atlas"]').count(), 0, 'older than a day: out');
  assert.equal(await shell.locator('.sec[data-sec="agents"] .older').innerText(), '1 older than 1 day');

  await page.evaluate(() => localStorage.setItem('marble-agents:idle', 'all'));
  await page.reload();
  await open(page);
  await shell.locator('.row.app[data-app="Research/atlas"]').waitFor();
  assert.equal(await shell.locator('.sec[data-sec="agents"] .older').count(), 0);
  await page.evaluate((ids) => Promise.all(ids.map((id) => window.marble.agent.archive(id, true))), [fresh, old]);
});

test('Mark all as read takes the bold off everything finished, and says so to the host', async () => {
  const { page, shell } = await visit();
  const ids = [await startDone(page, 'Travel/plans'), await startDone(page, 'Research/atlas')];
  for (const id of ids) await settledDone(page, id);
  await open(page);
  const button = shell.locator('.sec[data-sec="agents"] [data-mark-read]');
  await button.waitFor();
  assert.equal(await shell.locator('.row.app[data-unread]').count(), 2);
  await button.click();
  assert.equal(await shell.locator('.row.app[data-unread]').count(), 0);
  assert.equal(await button.count(), 0, 'nothing left to mark');
  await page.waitForFunction(async (ids) => (await window.marble.agent.conversations()).filter((c) => ids.includes(c.id)).every((c) => !c.needsReview), ids);
  await page.evaluate((ids) => Promise.all(ids.map((id) => window.marble.agent.archive(id, true))), ids);
});
