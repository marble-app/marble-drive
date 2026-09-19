/** Working: the one group nobody made. Under Pinned and Active the field
 *  gathers the chats that are running right now and that the stage does not
 *  hold into a premade group of their own, so the live work is not scattered
 *  down the Ungrouped column among everything ever left loose.
 *
 *  It claims only unfiled chats — a chat you filed stays where you filed it —
 *  and it writes nothing: no folder is created, and no chat's folderId moves.
 *
 *  Its own file, with its own copies of the helpers, for the reason
 *  agents-focus-groups.test.js gives: agents-focus.test.js is rewritten
 *  wholesale by other conversations and a test appended there gets dropped.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  // A turn that starts and then waits on the person: running and asking for
  // as long as nobody answers, which is the longest a test can hold a chat
  // live without racing it.
  permission: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }, { say: 'after' }],
  answer: [{ say: 'Just an answer.' }],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async () => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    try { localStorage.removeItem('marble-agents:focus-mode'); } catch { /* private */ }
  });
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 80; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const WORKING = '.focus-basin[data-folder-id="~working"]';

const metaOf = async (page, id) => (
  await page.evaluate((row) => window.marble.agent.conversation(row), id)
)?.meta ?? null;

const enterFocus = async (page) => {
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-modes').waitFor();
};

const ask = async (page, id) => {
  await page.evaluate(async (row) => {
    await window.marble.agent.send(row, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
  }, id);
  await until(page, async () => (await metaOf(page, id))?.asking === true, 'the chat to be asking');
};

/** The ids of the cards standing inside one basin, top to bottom. A card
 *  belongs to a basin when its middle is over it. */
const cardsIn = (page, selector) => page.evaluate((sel) => {
  const box = document.querySelector(sel)?.getBoundingClientRect();
  if (!box) return null;
  return [...document.querySelectorAll('.focus-card')]
    .map((el) => ({ id: el.dataset.id, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => {
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    })
    .sort((a, b) => a.rect.top - b.rect.top)
    .map(({ id }) => id);
}, selector);

test('a running chat nobody filed stands in a premade Working group', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const live = await window.marble.agent.start({ provider: 'fake' });
    const idle = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(live, { title: 'the live one' });
    await window.marble.agent.update(idle, { title: 'the idle one' });
    return { live, idle };
  });
  await enterFocus(page);
  await page.locator('.focus-basin[data-folder-id="ungrouped"]').waitFor();
  assert.equal(await page.locator(WORKING).count(), 0, 'nothing running, no group');

  await ask(page, ids.live);
  await page.locator(WORKING).waitFor();
  await until(page, async () => {
    const inside = await cardsIn(page, WORKING);
    return inside?.length === 1 && inside[0] === ids.live;
  }, 'the live chat to move into Working');
  assert.deepEqual(await cardsIn(page, '.focus-basin[data-folder-id="ungrouped"]'), [ids.idle]);

  // The name says so, and the group is not a folder: it offers no lens, since
  // staging live work is what the pill's Active segment already is.
  assert.equal(await page.locator(`${WORKING} .focus-basin-name`).textContent(), 'Working');
  assert.equal(await page.locator(`${WORKING} .focus-basin-focus`).count(), 1);
  assert.ok(await page.locator(`${WORKING} .focus-basin-focus`).isHidden(), 'no Focus button on Working');

  // Nothing was written: no folder was made, and the chat is still unfiled.
  const folders = await page.evaluate(async () => (await window.marble.agent.folders()).folders ?? []);
  assert.ok(folders.every((row) => row.id !== '~working'), 'Working is drawn, not stored');
  assert.equal((await metaOf(page, ids.live))?.folderId ?? null, null, 'the chat keeps no folder id');
  assert.deepEqual(errors, []);
});

test('a chat you filed stays in its own group however busy it is', async () => {
  const { page, errors } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const filed = await window.marble.agent.start({ provider: 'fake' });
    const loose = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(filed, { title: 'filed and busy' });
    await window.marble.agent.update(loose, { title: 'loose and busy' });
    const folder = await window.marble.agent.createFolder({ conversationIds: [filed], name: 'Alpha', color: 'research' });
    return { filed, loose, folderId: folder.id ?? folder.folder?.id };
  });
  await enterFocus(page);
  await ask(page, seeded.filed);
  await ask(page, seeded.loose);
  await page.locator(WORKING).waitFor();
  await until(page, async () => {
    const inside = await cardsIn(page, WORKING);
    return inside?.length === 1 && inside[0] === seeded.loose;
  }, 'only the unfiled one to be gathered');
  assert.deepEqual(
    await cardsIn(page, `.focus-basin[data-folder-id="${seeded.folderId}"]`),
    [seeded.filed],
    'the filed chat never left the group you put it in',
  );
  assert.deepEqual(errors, []);
});

test('the stage keeps what it holds, and a chat that goes quiet goes back to the drawer', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const staged = await window.marble.agent.start({ provider: 'fake' });
    const held = await window.marble.agent.start({ provider: 'fake' });
    const passing = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(staged, { title: 'pinned and busy', pinned: true });
    await window.marble.agent.update(held, { title: 'loose and asking' });
    await window.marble.agent.update(passing, { title: 'loose and passing' });
    return { staged, held, passing };
  });
  await enterFocus(page);
  await ask(page, ids.staged);
  await ask(page, ids.held);
  await page.locator(WORKING).waitFor();
  await until(page, async () => {
    const inside = await cardsIn(page, WORKING);
    return inside?.length === 1 && inside[0] === ids.held;
  }, 'Working to hold only what the stage does not');

  // A turn that runs to the end: it joins Working while it runs and leaves the
  // moment it stops, because being live is the whole of what puts it there.
  // Needing review is not being busy — it is being finished.
  await page.evaluate(async (id) => {
    await window.marble.agent.send(id, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] });
  }, ids.passing);
  await until(page, async () => {
    const meta = await metaOf(page, ids.passing);
    return Boolean(meta && !meta.running && meta.lastFinishedAt);
  }, 'the passing turn to finish');
  await until(page, async () => {
    const drawer = await cardsIn(page, '.focus-basin[data-folder-id="ungrouped"]');
    return drawer?.includes(ids.passing);
  }, 'the finished chat to fall back to Ungrouped');
  assert.deepEqual(await cardsIn(page, WORKING), [ids.held], 'the one still asking is still working');
  assert.deepEqual(errors, []);
});

test('Group mode has no Working group — the stage is already one group', async () => {
  const { page, errors } = await openAgents();
  const seeded = await page.evaluate(async () => {
    const member = await window.marble.agent.start({ provider: 'fake' });
    const loose = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(member, { title: 'in alpha' });
    await window.marble.agent.update(loose, { title: 'loose and busy' });
    const folder = await window.marble.agent.createFolder({ conversationIds: [member], name: 'Alpha', color: 'research' });
    return { member, loose, folderId: folder.id ?? folder.folder?.id };
  });
  await enterFocus(page);
  await ask(page, seeded.loose);
  await page.locator(WORKING).waitFor();

  await page.locator(`.focus-basin[data-folder-id="${seeded.folderId}"] .focus-basin-focus`).click();
  await until(page, async () => (await page.evaluate(() => document.querySelector('.focus')?.dataset.mode)) === 'group', 'group mode');
  assert.equal(await page.locator(WORKING).count(), 0, 'no Working group under a lens');
  await until(page, async () => {
    const drawer = await cardsIn(page, '.focus-basin[data-folder-id="ungrouped"]');
    return drawer?.includes(seeded.loose);
  }, 'the live chat to be back in the drawer');
  assert.deepEqual(errors, []);
});

test('Active stages the live work itself, so there is nothing left for Working to gather', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const live = await window.marble.agent.start({ provider: 'fake' });
    const idle = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(live, { title: 'the live one' });
    await window.marble.agent.update(idle, { title: 'the idle one' });
    return { live, idle };
  });
  await enterFocus(page);
  await ask(page, ids.live);
  await page.locator(WORKING).waitFor();

  await page.locator('.focus-modes button[data-mode="active"]').click();
  await until(page, async () => (await page.evaluate(() => document.querySelector('.focus')?.dataset.mode)) === 'active', 'active mode');
  // Active's stage *is* the live set: the group and the mode are two answers
  // to one question, so the group stands down where the mode already holds
  // the work. It comes back the moment Pinned does.
  await until(page, async () => (await page.locator(WORKING).count()) === 0, 'Working to stand down under Active');
  await page.locator('.focus-modes button[data-mode="pinned"]').click();
  await page.locator(WORKING).waitFor();
  assert.deepEqual(await cardsIn(page, WORKING), [ids.live]);
  assert.deepEqual(errors, []);
});

test('moving a card inside Working files a rank, never a folder', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const a = await window.marble.agent.start({ provider: 'fake' });
    const b = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(a, { title: 'first and busy' });
    await window.marble.agent.update(b, { title: 'second and busy' });
    return { a, b };
  });
  await enterFocus(page);
  await ask(page, ids.a);
  await ask(page, ids.b);
  await page.locator(WORKING).waitFor();
  await until(page, async () => {
    const inside = await cardsIn(page, WORKING);
    return inside?.length === 2;
  }, 'both live chats to gather');
  const before = await cardsIn(page, WORKING);

  await page.locator(`.focus-card[data-id="${before[1]}"]`).click();
  await page.keyboard.press('Alt+ArrowUp');
  await until(page, async () => (await cardsIn(page, WORKING))?.[0] === before[1], 'the card to move up');

  // Working is drawn, not stored: the move filed a rank and nothing else.
  // The canvas paints a move before it files one — `moveFocusCard` repaints and
  // only then awaits the PATCHes — so the order flipping above says nothing yet
  // about the store. Wait for the write rather than reading into that window.
  let metas = [];
  await until(page, async () => {
    metas = await Promise.all([ids.a, ids.b].map((id) => metaOf(page, id)));
    return metas.some((meta) => typeof meta?.focusY === 'number');
  }, 'the move to file a rank');
  for (const meta of metas) {
    assert.equal(meta?.folderId ?? null, null, 'no chat was filed into a group that does not exist');
  }
  const folders = await page.evaluate(async () => (await window.marble.agent.folders()).folders ?? []);
  assert.ok(folders.every((row) => row.id !== '~working'), 'no folder was created for Working');
  assert.deepEqual(errors, []);
});
