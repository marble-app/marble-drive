// A share page ends with a quiet line offering a drive of your own, linking to
// Ask for access at the door (runtime/share.js, data-door from server/app.js).
// The owner looking at their own page never sees it.

import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import test from 'node:test';

import { startDrive } from './harness.js';

const SECRET = 'hunter2';
const { publicKey } = nodeCrypto.generateKeyPairSync('ed25519');
const SPKI = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const DOOR = { MARBLE_DOOR_KEYS: `k1:${SPKI}`, MARBLE_DOOR_NAME: 'ana', MARBLE_DOOR_OWNER: 'a1b2c3d4e5f60718' };

const POTLUCK = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Potluck</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="title">Potluck</h1>
  <ul data-marble-id="list"><li data-marble-id="r1">Ana: bread</li><li data-marble-id="r2">Sam: salad</li></ul>
</body></html>
`;

const host = await startDrive({ agents: false, documents: { potluck: POTLUCK }, env: { MARBLE_DRIVE_SECRET: SECRET, ...DOOR } });
test.after(() => host.close());

const footOf = (page) => page.evaluate(() => {
  const foot = document.querySelector('marble-share-foot');
  if (!foot) return null;
  const box = foot.getBoundingClientRect();
  const last = document.querySelector('ul').getBoundingClientRect();
  return { below: box.top >= last.bottom, width: box.width, last: document.body.lastElementChild === foot };
});

test('a visitor sees "Ask for a drive of your own" after the page; the owner does not', async () => {
  const owner = await host.newPage({ shell: false });
  assert.equal((await owner.page.request.post(`${host.base}/gate`, { data: { secret: SECRET } })).status(), 200);
  await owner.page.goto(`${host.base}/a/potluck`);
  await owner.page.waitForFunction(() => Boolean(window.marble));
  assert.equal(await footOf(owner.page), null, 'the owner sees no footer');
  assert.equal(await owner.page.getByText('Ask for a drive of your own').count(), 0);

  const { link } = await (await owner.page.request.post(`${host.base}/drive/shares`, { data: { path: 'potluck', role: 'view' } })).json();
  for (const [viewport, colorScheme] of [[{ width: 390, height: 760 }, 'dark'], [{ width: 1280, height: 800 }, 'light']]) {
    const them = await host.newPage({ shell: false, viewport, colorScheme });
    await them.page.goto(`${host.base}${link.href}`);
    await them.page.waitForFunction(() => Boolean(window.marble?.shareWrapped));
    const foot = await footOf(them.page);
    assert.ok(foot, 'the visitor has the footer');
    assert.ok(foot.below, 'after the content');
    const ask = them.page.getByRole('link', { name: 'Ask for a drive of your own' });
    assert.equal(await ask.getAttribute('href'), 'https://marbledrive.app/ask');
    assert.ok(await ask.isVisible());
    if (process.env.SHARE_FOOT_SHOTS) await them.page.screenshot({ path: `${process.env.SHARE_FOOT_SHOTS}/foot-${viewport.width}-${colorScheme}.png`, fullPage: true });
    await them.page.close();
  }
  await owner.page.close();
});
