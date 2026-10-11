// The Projects page: suggestions from the chats become projects in the file,
// the views are drawn around them, and every change to a project is an op
// that a reload keeps and Mod+Z takes back.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'projects.mrbl');
const PROJECTS = (await fsp.readFile(TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Projects')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({
  documents: { garden: GARDEN, Projects: PROJECTS, 'Thesis/Notes': GARDEN, 'Thesis/Draft': GARDEN },
});
test.after(() => host.close());

const file = () => host.drive.store.read('Projects');
const settle = async (page) => { await page.evaluate(() => window.marble.flush?.()); await page.waitForTimeout(300); };

// Three chats on a document in Thesis, so the page has something to suggest.
const seedChats = async (page) => page.evaluate(async () => {
  const agent = window.marble.agent;
  for (let i = 0; i < 3; i++) {
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: `note ${i}`, target: 'Thesis/Notes', viewing: 'Thesis/Notes' });
  }
});

const openProjects = async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/Projects`);
  await page.waitForFunction(() => window.marbleProjects?.state.loaded);
  return { page, errors };
};

test('a suggestion from the chats becomes a project the file keeps', async () => {
  const { page, errors } = await openProjects();
  await seedChats(page);
  await page.reload();
  await page.waitForFunction(() => window.marbleProjects?.state.loaded);
  const suggestion = page.locator('.x-sug', { hasText: 'Thesis' });
  await suggestion.waitFor();
  assert.match(await suggestion.textContent(), /3 chats/);
  await suggestion.getByRole('button', { name: 'Add project' }).click();
  const card = page.locator('article.project', { hasText: 'Thesis' });
  await card.waitFor();
  assert.match(await card.textContent(), /3 chats this week/);
  await settle(page);
  assert.match(await file(), /<article data-marble-id="[^"]+" class="project" data-level="[a-z]+"[^>]*>.*data-kind="folder" data-path="Thesis"/s);

  await page.reload();
  await page.waitForFunction(() => window.marbleProjects?.state.loaded);
  await page.locator('article.project', { hasText: 'Thesis' }).waitFor();
  assert.equal(await page.locator('.x-sug', { hasText: 'Thesis' }).count(), 0, 'a project is no longer suggested');
  assert.deepEqual(errors, []);
});

test('Not a project is remembered, so the guess does not come back', async () => {
  const { page } = await openProjects();
  await seedChats(page);
  await page.reload();
  await page.waitForFunction(() => window.marbleProjects?.state.loaded);
  await page.locator('.x-sug', { hasText: 'Thesis' }).getByRole('button', { name: 'Not a project' }).click();
  await settle(page);
  assert.match(await file(), /data-key="folder:Thesis"/);
  await page.reload();
  await page.waitForFunction(() => window.marbleProjects?.state.loaded);
  assert.equal(await page.locator('.x-sug', { hasText: 'Thesis' }).count(), 0);
});

test('a project opened: its sentence, a date and a place are ops, and Mod+Z takes the date back', async () => {
  const { page, errors } = await openProjects();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  // New opens the project with its name selected, ready to be typed over.
  await page.keyboard.type('Thesis');
  await page.keyboard.press('Enter');
  assert.ok(await page.evaluate(() => document.querySelector('main[data-projects]').hasAttribute('data-open')));

  await page.locator('article.project .p-sentence').click();
  await page.keyboard.type('Chapter three this month.');
  await page.keyboard.press('Enter');

  await page.locator('.x-add input[type=date]').fill('2026-11-20');
  await page.locator('.x-add input[placeholder="What is due"]').fill('Draft to Jim');
  await page.locator('.x-add input[placeholder="What is due"]').press('Enter');
  await page.waitForFunction(() => document.querySelector('.x-body')?.textContent.includes('Draft to Jim'));

  await page.locator('.x-add input[list]').fill('Thesis/');
  await page.locator('.x-add input[list]').press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.x-body .x-row .x-a')].some((a) => a.textContent === 'Thesis'));
  await settle(page);

  let source = await file();
  assert.match(source, /class="p-name">Thesis</);
  assert.match(source, /data-by="you"[^>]*class="p-sentence">Chapter three this month\.</);
  assert.match(source, /data-date="2026-11-20"><span data-marble-id="[^"]+" class="d-name">Draft to Jim</);
  assert.match(source, /data-kind="folder" data-path="Thesis"/);

  // The place was the last gesture; undo it, then the date.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+z');
  await settle(page);
  source = await file();
  assert.doesNotMatch(source, /data-path="Thesis"/);
  assert.doesNotMatch(source, /Draft to Jim/);
  assert.match(source, /Chapter three this month\./);
  assert.deepEqual(errors, []);
});

test('the timeline draws a row a project, and dragging its end sets when it ends', async () => {
  const { page } = await openProjects();
  await seedChats(page);
  await page.reload();
  await page.waitForFunction(() => window.marbleProjects?.state.loaded);
  await page.locator('.x-sug', { hasText: 'Thesis' }).getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('button', { name: 'Timeline' }).click();
  const row = page.locator('.x-timeline .x-tl-tr[data-name="Thesis"]');
  await row.waitFor();
  assert.equal(await row.locator('.x-tl-bar').count(), 1, 'the past is drawn from the chats');
  const handle = row.locator('.x-tl-end');
  const box = await handle.boundingBox();
  const track = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.8, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  assert.match(await file(), /class="project"[^>]*data-end="\d{4}-\d{2}-\d{2}"/);
  assert.equal(await row.locator('.x-tl-plan:not(.open)').count(), 1, 'a set end is drawn dashed to it');
  // Which view is showing is looking, filed as such.
  assert.match(await file(), /data-view="timeline"/);
});
