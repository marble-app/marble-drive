/** The seam between the field and the stage.
 *
 *  Focus balances the two sides at φ, which is a good answer to a question
 *  nobody asked. This is the question: a seam in the bar between them, the
 *  split it sets written into the document, and φ still there to go back to.
 *
 *  Its own file, for the reason agents-focus-piles.test.js gives: the older
 *  focus test files are rewritten wholesale by other conversations and a test
 *  appended there gets dropped without anything failing.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(async () => {
  await openPage?.close().catch(() => {});
  await host.close();
});

// Every pin is a live pane on an event stream. Each test hands its page back
// before the next one asks for one.
let openPage = null;

const openAgents = async () => {
  if (openPage) {
    await openPage.close().catch(() => {});
    openPage = null;
  }
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1440, height: 900 } });
  openPage = page;
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) await window.marble.agent.archive(row.id, true);
    } catch { /* fresh agent */ }
    try { localStorage.removeItem('marble-agents:focus-mode'); } catch { /* private */ }
  });
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** The split as the document has it. `data-split="…"` with a double quote is
 *  the attribute and nothing else: where the script names it, it is in single
 *  quotes. `null` is the attribute not being there at all, which is the
 *  layout's own answer rather than a number that happens to equal it. */
const splitInFile = async () => {
  const source = await host.drive.store.read('Agents');
  const found = /data-split="([\d.]+)"/.exec(source);
  return found ? Number(found[1]) : null;
};

/** The op reaches the file a beat after the pointer comes up. */
const untilSplit = async (want, tries = 60) => {
  let last;
  for (let n = 0; n < tries; n += 1) {
    last = await splitInFile();
    if (want(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the document still says ${last}`);
};

/** One pin on the stage and a folder of four in the field: both sides exist,
 *  so there is a seam between them. */
const seed = async (page) => {
  await page.evaluate(async () => {
    const mk = async (title) => {
      const id = await window.marble.agent.start({ provider: 'fake' });
      await window.marble.agent.update(id, { title });
      return id;
    };
    const pinned = await mk('staged');
    await window.marble.agent.update(pinned, { pinned: true });
    const alpha = [];
    for (let i = 0; i < 4; i += 1) alpha.push(await mk(`alpha ${i + 1}`));
    await window.marble.agent.createFolder({ conversationIds: alpha, name: 'Research', color: 'research' });
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-modes').waitFor();
  await page.locator('.focus-seam').waitFor();
};

const widths = (page) => page.evaluate(() => {
  const basin = document.querySelector('.focus-basin:not([data-pile])');
  const pane = document.querySelector('.pane');
  return { field: basin.getBoundingClientRect().width, stage: pane.getBoundingClientRect().width };
});

/** A basin eases to its new width, so a measurement taken the instant the
 *  pointer comes up is the old one. This waits for it to stop moving. */
const settled = async (page) => {
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    const now = await widths(page);
    if (last && Math.abs(now.field - last.field) < 0.5 && Math.abs(now.stage - last.stage) < 0.5) return now;
    last = now;
    await page.waitForTimeout(40);
  }
  return last;
};

const dragSeamBy = async (page, dx) => {
  const box = await page.locator('.focus-seam').boundingBox();
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 10 });
  await page.mouse.up();
};

test('the two sides rest at φ, with a seam standing between them', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const { field, stage } = await widths(page);
  assert.ok(Math.abs(stage / field - 1.618) / 1.618 < 0.05, `stage/field should be about φ, got ${stage / field}`);
  const seam = await page.locator('.focus-seam').boundingBox();
  const gap = await page.evaluate(() => {
    const basin = document.querySelector('.focus-basin:not([data-pile])').getBoundingClientRect();
    return { right: basin.right, paneLeft: document.querySelector('.pane').getBoundingClientRect().left };
  });
  const centre = seam.x + seam.width / 2;
  assert.ok(centre > gap.right - 2 && centre < gap.paneLeft + 2, `the seam stands in the bar, at ${centre}`);
  assert.deepEqual(errors, []);
});

test('dragging the seam gives the field the width, and writes the split into the file', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const before = await widths(page);
  await dragSeamBy(page, 180);
  const after = await settled(page);
  assert.ok(after.field > before.field + 120, `the field should have grown: ${before.field} → ${after.field}`);
  assert.ok(after.stage < before.stage - 120, `and the stage given it up: ${before.stage} → ${after.stage}`);

  const split = await untilSplit((value) => value != null);
  const shown = after.stage / (after.stage + after.field);
  assert.ok(Math.abs(split - shown) < 0.03, `filed ${split}, showing ${shown}`);
  assert.deepEqual(errors, []);
});

test('the split a drag left is the one the next visit opens with', async () => {
  const { page } = await openAgents();
  await seed(page);
  await dragSeamBy(page, 160);
  await untilSplit((value) => value != null);
  const wanted = (await settled(page)).field;

  const { page: second } = await host.newPage({ viewport: { width: 1440, height: 900 } });
  await second.goto(`${host.base}/a/Agents`);
  await second.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await second.locator('.views [data-view="focus"]').click();
  await second.locator('.focus-seam').waitFor();
  await until(second, async () => Math.abs((await widths(second)).field - wanted) < 6, 'the field to reopen at its width');
  await second.close();
});

test('the seam answers the arrow keys, and two presses put φ back', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const rest = await widths(page);
  await page.locator('.focus-seam').focus();
  for (let n = 0; n < 3; n += 1) await page.keyboard.press('ArrowRight');
  const nudged = await settled(page);
  assert.ok(nudged.field > rest.field + 40, `arrows should widen the field: ${rest.field} → ${nudged.field}`);
  await untilSplit((value) => value != null);
  assert.equal(
    await page.locator('.focus-seam').getAttribute('aria-valuetext'),
    `${Math.round((1 - nudged.stage / (nudged.stage + nudged.field)) * 100)}% of the canvas to the field`,
  );

  // Two presses close together are the reset — and the attribute goes out of
  // the file, rather than being written back as a number that means φ.
  await page.locator('.focus-seam').click();
  await page.locator('.focus-seam').click({ delay: 20 });
  await until(page, async () => Math.abs((await widths(page)).field - rest.field) < 8, 'the field to go back to φ');
  await untilSplit((value) => value == null);
  assert.deepEqual(errors, []);
});

test('the seam never squeezes a side past the width it needs to be read', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  await dragSeamBy(page, -1200);
  const wide = await widths(page);
  assert.ok(wide.stage > 280, `a pane keeps reading width, got ${wide.stage}`);
  await dragSeamBy(page, 1200);
  const narrow = await widths(page);
  assert.ok(narrow.field > 180, `a field column keeps its floor, got ${narrow.field}`);
  assert.equal(
    await page.evaluate(() => {
      const el = document.querySelector('.focus');
      return el.scrollWidth > el.clientWidth + 1;
    }),
    false,
    'and the canvas still does not scroll sideways',
  );
  assert.deepEqual(errors, []);
});
