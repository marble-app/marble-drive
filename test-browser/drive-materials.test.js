import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

// What the Drive folds away under Materials, what it does not, and who gets
// the last word: the rule guesses, an upload counts as the work, and the row
// menu hides or unhides by hand, kept in the file.

const put = (host, path, text = '{}') =>
  host.drive.store.putFile(path, (async function* () { yield Buffer.from(text); })());

async function dropFiles(page, selector, files) {
  await page.evaluate(
    ({ selector, files }) => {
      const target = selector ? document.querySelector(selector) : document.body;
      const data = new DataTransfer();
      for (const { name, type, text } of files) data.items.add(new File([text], name, { type }));
      const fire = (type) =>
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      fire('dragenter');
      fire('dragover');
      fire('drop');
    },
    { selector, files },
  );
}

async function until(check, what) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, what);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const row = (path) => `#items .item[data-path="${path}"]`;
const folded = (path) => `#items .mats .item[data-path="${path}"]`;
const worked = (path) => `#items > .item[data-path="${path}"]`;

async function menuPick(page, path, label) {
  await page.locator(row(path)).first().click({ button: 'right' });
  await page.locator('#menu[data-open] button', { hasText: label }).click();
}

test('an uploaded file is the work, and a folder of data is still folded away', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    await host.drive.store.mkdir('schemas');
    await put(host, 'schemas/a.json');
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive`);
    await page.locator(folded('schemas')).waitFor({ state: 'attached' });

    await dropFiles(page, null, [{ name: 'notes.json', type: 'application/json', text: '{"a":1}' }]);
    await page.locator(worked('notes.json')).waitFor();
    assert.equal(await page.locator(folded('notes.json')).count(), 0, 'not under the rule');

    await until(
      async () => /<li[^>]*data-path="notes\.json"[^>]*data-place="drive"/.test(await host.drive.store.read('drive')),
      'the upload is written down as the work',
    );
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('Hide in Materials folds a document away for good, and Unhide brings it back', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive`);
    await page.locator(worked('garden')).waitFor();

    await menuPick(page, 'garden', 'Hide in Materials');
    await page.locator(folded('garden')).waitFor({ state: 'attached' });
    assert.equal(await page.locator(worked('garden')).count(), 0);
    await page.waitForFunction(() => /Hid garden in Materials/.test(document.querySelector('#toast').textContent));

    // Kept in the file, so a reload still has it folded away.
    await until(
      async () => /data-path="garden"[^>]*data-place="materials"/.test(await host.drive.store.read('drive')),
      'the placement reached the file',
    );
    await page.reload();
    await page.locator(folded('garden')).waitFor({ state: 'attached' });

    // In every lens, not just the grid.
    for (const lens of ['list', 'timeline', 'weight']) {
      await page.locator(`[data-set-view="${lens}"]`).click();
      await page.locator('#items .mats').waitFor();
    }
    await page.locator('[data-set-view="grid"]').click();

    await page.locator('#items .mats .mats-head').click();
    await menuPick(page, 'garden', 'Unhide from Materials');
    await page.locator(worked('garden')).waitFor();
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('the Materials line takes a press while the drive keeps changing', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    await put(host, 'refs.bib', '@misc{a}');
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive`);
    const head = page.locator('#items .mats .mats-head');
    await head.waitFor();

    // A press that spans a change somewhere else in the drive, which used to
    // throw the line away between the button going down and coming up.
    const box = await head.boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await host.drive.store.mkdir('Elsewhere');
    await host.drive.createDocument('Elsewhere/Busy', GARDEN, { label: 'test' });
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#items .mats')?.dataset.open === '1');

    // The new folder was drawn, without replaying anyone's entrance.
    await page.locator(worked('Elsewhere')).waitFor();
    assert.equal(await page.locator('#items[data-quiet]').count(), 1);
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('the corner card starts where the page does, not under a docked sidebar', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    const { page } = await host.newPage();
    await page.goto(`${host.base}/a/drive`);
    await page.locator(worked('garden')).waitFor();
    await page.evaluate(() => document.documentElement.style.setProperty('--marble-shell-left', '260px'));
    for (const sel of ['#toast', '.uploads']) {
      const left = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().left, sel);
      assert.ok(left >= 260, `${sel} starts at ${left}`);
    }
  } finally {
    await host.close();
  }
});
