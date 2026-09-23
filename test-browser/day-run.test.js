// The days folder starting the day it is missing, and showing the work.
//
// The gallery and its button live in the owner's own drive document, and
// `drive/` is deliberately not tracked by this repo — so this file tests the
// document that actually ships to the drive, and skips plainly when that
// document is not in the checkout.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startDrive } from './harness.js';

// Parked 2026-09-18 at the owner's request, to be settled later. The subject here
// is the day-runner button, which lives in `drive/drive.mrbl` and not in
// `templates/drive.mrbl` — so this file can only ever be green on the one
// machine whose gitignored drive has that button, and a checkout carrying an
// older drive.mrbl fails rather than skips, because the prompt swap below
// silently finds nothing to replace. Flip PARKED to false to bring it back,
// or better, move the button into the template and delete this line.
const PARKED = true;
const SOURCE = PARKED
  ? null
  : await fsp
    .readFile(new URL('../drive/drive.mrbl', import.meta.url), 'utf8')
    .catch(() => null);

// The days folder is found by name in the live document, so the fixtures
// take the name from there.
const FOLDER = /const DAYS = "([^"]+)"/.exec(SOURCE ?? '')?.[1];

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const dayDoc = (key, title) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="day:date" content="${key}"><title>${title}</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; }</style></head>
<body data-marble-id="b"><h1 data-marble-id="h">${title}</h1></body></html>
`;

// The prompt is configuration in the document, which is what lets a test point
// the same button at a scripted agent instead of the real skill.
const aimedAt = (prompt) =>
  SOURCE.replace(/(id="day-runner"[^>]*?)data-prompt="[^"]*"/, `$1data-prompt="${prompt}"`);

const SCRIPTS = {
  writes: [
    { call: 'read_document', args: { path: 'drive' } },
    { silent: 20_000 },
  ],
  stops: [
    { call: 'read_document', args: { path: 'drive' } },
    { fail: 'the model fell over' },
  ],
};

if (!SOURCE) {
  test('the days folder can write the day it is missing', {
    skip: PARKED ? 'parked: the day-runner lives in the gitignored drive, not in templates/drive.mrbl' : 'no drive/drive.mrbl in this checkout',
  }, () => {});
} else {
  const host = await startDrive({
    scripts: SCRIPTS,
    documents: {
      drive: aimedAt('script:writes'),
      'drive-stops': aimedAt('script:stops'),
      [`${FOLDER}/2026-09-07`]: dayDoc('2026-09-07', 'An older day'),
    },
  });
  // The button runs its skill in a project the owner registered, so the test
  // registers one under the name the document names.
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-day-project-'));
  test.after(async () => {
    await host.close();
    await fsp.rm(project, { recursive: true, force: true });
  });

  async function openDays(doc = 'drive') {
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/${doc}#/${encodeURIComponent(FOLDER)}`);
    await page.locator('.items[data-rep="days"]').waitFor();
    await page.evaluate((dir) => window.marble.agent.addProject({ path: dir, name: 'Marble Drive' }), project);
    await page.locator('.day-wait .day-start').waitFor();
    return { page, errors };
  }

  test('the empty day offers to write itself, and says what that runs', async () => {
    const { page, errors } = await openDays();
    assert.equal(await page.locator('.day-start').textContent(), 'Write today’s day');
    assert.match(await page.locator('.day-run .why').textContent(), /Runs script:writes in Marble Drive/);
    assert.deepEqual(errors, []);
  });

  test('a run that stops says so in the folder and offers another go', async () => {
    const { page } = await openDays('drive-stops');
    await page.locator('.day-start').click();
    await page.locator('.day-run .bad').waitFor();
    assert.match(await page.locator('.day-run .bad').textContent(), /fell over/);
    assert.equal(await page.locator('.day-start').textContent(), 'Try again');
  });

  test('pressing it starts an agent, and the folder shows the work', async () => {
    const { page } = await openDays();
    await page.locator('.day-start').click();
    await page.locator('.day-live').waitFor();
    assert.match(await page.locator('.day-live .what b').textContent(), /Writing today’s day/);
    // The step line is the turn's own events, said the way a person would.
    await page.waitForFunction(() => /Reading drive/.test(document.querySelector('.day-live .step')?.textContent ?? ''));

    // It is an ordinary conversation: the Agents page lists it like any other.
    const conversations = await page.evaluate(() => window.marble.agent.conversations());
    const mine = conversations.filter((item) => item.status === 'running');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].title, 'Today’s day');
  });

  test('the day landing puts the day in the slot the panel was holding', async () => {
    const { page } = await openDays();
    await page.locator('.day-start').click();
    await page.locator('.day-live').waitFor();

    await host.drive.createDocument(`${FOLDER}/today`, dayDoc(TODAY, 'The quiet morning'));

    await page.locator('.day-card.is-today').waitFor();
    assert.equal(await page.locator('.day-wait').count(), 0);
  });
}
