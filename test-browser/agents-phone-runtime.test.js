// The open conversation on a phone: the runtime's own fold. `data-chrome`
// is the page's word for how much room a conversation has, and at "phone" the
// mast is one line, the setup row is one chip with a sheet behind it, and
// everything a thumb has to hit is 44pt. 393 × 852, touch.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { say: 'Read it.' },
  ],
};

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, ...options });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    localStorage.clear();
  });
  return { page, errors };
};

/** One conversation, open full screen from the Deck — the phone's only way in. */
const openOne = async (page, { target = 'garden' } = {}) => {
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { title: 'Figure 3 redraw', target, running: true, activity: 'drawing' });
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  await page.waitForFunction(() => document.querySelector('marble-conversation')?.getAttribute('data-chrome') === 'phone');
  await page.waitForTimeout(350);
  return id;
};

test('phone: the mast is one line of 36px and the title is not in it', async () => {
  const { page } = await openAgents();
  await openOne(page);
  const mast = await page.locator('marble-conversation .mast').boundingBox();
  assert.ok(mast.height <= 36 + 0.5, `mast is ${mast.height}px`);
  assert.equal(await page.locator('marble-conversation .heading').isVisible(), false);
  // The transcript starts right under it: three headers deep was the finding.
  const log = await page.locator('marble-conversation .log').boundingBox();
  assert.ok(log.y - (mast.y + mast.height) < 2, `log starts ${log.y - (mast.y + mast.height)}px under the mast`);
  // The one link in the line is still a thumb's worth of target.
  const jump = await page.locator('marble-conversation .target-jump').boundingBox();
  assert.ok(jump.height >= 44, `target link is ${jump.height}px`);
  assert.ok(mast.height <= 36 + 0.5, `the link grew the mast to ${mast.height}px`);
});

test('phone: "+N here" replaces the working-here line and asks the page for the list', async () => {
  const { page } = await openAgents();
  const other = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(other, { title: 'bib cleanup', running: true, status: 'running' });
  await openOne(page);
  const also = page.locator('marble-conversation .also');
  await also.waitFor({ state: 'visible' });
  assert.equal((await page.locator('marble-conversation .also-short').textContent()).trim(), '+1 here');
  assert.equal(await page.locator('marble-conversation .also-long').isVisible(), false);
  const box = await also.boundingBox();
  assert.ok(box.height >= 44, `the tag is ${box.height}px of target`);
  const heard = await page.evaluate(async () => {
    const seen = new Promise((resolve) => {
      document.addEventListener('marble:agent-working-here', (event) => resolve(event.detail), { once: true });
    });
    document.querySelector('marble-conversation').shadowRoot.querySelector('.also').click();
    return seen;
  });
  assert.deepEqual(heard.names, ['bib cleanup']);
  assert.deepEqual(heard.ids, [other]);
});

test('phone: the setup row is one chip, and the sheet it opens is all 44pt', async () => {
  const { page } = await openAgents();
  await openOne(page);
  const chip = page.locator('marble-conversation .setup-chip');
  await chip.waitFor({ state: 'visible' });
  const chipBox = await chip.boundingBox();
  assert.ok(chipBox.height >= 40, `the chip is ${chipBox.height}px`);
  assert.match((await chip.textContent()).trim(), / · /);
  // The desk's row is not on the screen; it is still in the bar.
  assert.equal(await page.locator('marble-conversation .bar > .setup').isVisible(), false);
  await chip.click();
  const sheet = page.locator('marble-conversation .setup-sheet');
  await sheet.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const sr = document.querySelector('marble-conversation').shadowRoot;
    return sr.querySelector('.setup-sheet').getBoundingClientRect().bottom <= innerHeight + 1
      && Number(sr.querySelector('.setup-sheet').style.getPropertyValue('--at')) < 0.02;
  });
  assert.equal(await page.evaluate(() => document.querySelector('marble-conversation').shadowRoot.querySelector('.setup-sheet').getAttribute('role')), 'dialog');
  // The same node, moved — not a second copy of the pickers.
  assert.equal(await page.evaluate(() => {
    const sr = document.querySelector('marble-conversation').shadowRoot;
    return sr.querySelectorAll('.setup').length === 1 && sr.querySelector('.setup-sheet .setup') !== null;
  }), true);
  const small = await page.evaluate(() => {
    const sr = document.querySelector('marble-conversation').shadowRoot;
    const controls = [...sr.querySelectorAll('.setup-sheet label, .setup-sheet button')];
    return controls
      .filter((node) => node.offsetParent !== null || node.getClientRects().length)
      .map((node) => ({ what: node.className, ...node.getBoundingClientRect().toJSON() }))
      .filter((box) => box.height < 44 || box.width < 44);
  });
  assert.deepEqual(small, [], `controls under 44pt: ${JSON.stringify(small)}`);
  const count = await page.evaluate(() => document.querySelector('marble-conversation').shadowRoot.querySelectorAll('.setup-sheet label, .setup-sheet button').length);
  assert.ok(count > 0, 'the sheet has no controls in it');
  // The scrim puts it away and the row goes home to the bar.
  await page.locator('marble-conversation .setup-scrim').click({ position: { x: 100, y: 60 } });
  await page.waitForFunction(() => document.querySelector('marble-conversation').shadowRoot.querySelector('.setup-sheet').hidden);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('marble-conversation').shadowRoot.querySelector('.bar > .setup'))), true);
});

test('phone: a drag down the sheet\'s grip tracks the finger and lets go of it', async () => {
  const { page } = await openAgents();
  await openOne(page);
  await page.locator('marble-conversation .setup-chip').click();
  await page.waitForFunction(() => Number(document.querySelector('marble-conversation').shadowRoot.querySelector('.setup-sheet').style.getPropertyValue('--at')) < 0.02);
  const grip = await page.locator('marble-conversation .setup-handle').boundingBox();
  const start = await page.locator('marble-conversation .setup-sheet').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 60);
  const dragged = await page.locator('marble-conversation .setup-sheet').boundingBox();
  assert.ok(Math.abs((dragged.y - start.y) - 60) < 4, `sheet moved ${dragged.y - start.y}px for 60px of finger`);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 120);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('marble-conversation').shadowRoot.querySelector('.setup-sheet').hidden);
});

test('phone: send and stop are 44 × 44 around their disc', async () => {
  const { page } = await openAgents();
  await openOne(page);
  const send = await page.locator('marble-conversation .send').boundingBox();
  assert.ok(send.width >= 44 && send.height >= 44, `send is ${send.width}×${send.height}`);
  const stop = await page.evaluate(() => {
    const button = document.querySelector('marble-conversation').shadowRoot.querySelector('.stop');
    button.hidden = false;
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  assert.ok(stop.width >= 44 && stop.height >= 44, `stop is ${stop.width}×${stop.height}`);
  // A pane is the desk density and keeps the desk's geometry.
  await page.evaluate(() => document.querySelector('marble-conversation').setAttribute('data-chrome', 'pane'));
  const desk = await page.locator('marble-conversation .send').boundingBox();
  assert.ok(desk.height < 44, `a pane's send grew to ${desk.height}px`);
});

test('phone: the fisheye anchors to the bottom when the keyboard takes the room', async () => {
  const { page } = await openAgents();
  const seen = await page.evaluate(() => {
    const { fisheye, pileRuns, TIERS } = window.marbleAgentPhone;
    const roomy = fisheye(12, 5, 700);
    const cramped = fisheye(12, 5, 700 - 336, { anchor: 'bottom' });
    return {
      above: roomy.slice(0, 5).every((card, i) => card.top === cramped[i].top && card.height === cramped[i].height),
      full: cramped[5].height,
      digest: TIERS.digest,
      demoted: cramped.slice(6).every((card, i) => card.height <= roomy[i + 6].height + 0.01),
      total: cramped[11].top + cramped[11].height,
      runs: pileRuns(roomy).map((run) => `${run.side}:${run.count}`),
      plainFull: fisheye(12, 5, 700 - 336)[5].height,
    };
  });
  assert.equal(seen.above, true, 'the cards above the Full moved');
  assert.ok(seen.full >= seen.digest, `the Full fell to ${seen.full}`);
  assert.equal(seen.demoted, true, 'a card below the Full grew');
  assert.ok(Math.abs(seen.total - 364) < 0.01, `the column is ${seen.total} of 364`);
  assert.deepEqual(seen.runs, ['top:3', 'bottom:4']);
  assert.ok(seen.plainFull < seen.digest, 'the unanchored layout should have taken it out of the Full');
});
