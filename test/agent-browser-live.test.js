import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createBrowserSession, loadChromium } from '../server/agent/browser.js';

const PAGE = `<!doctype html>
<html><body>
  <h1>Garden</h1>
  <button>Count</button>
  <p id="n">0</p>
  <script>
    document.querySelector('button').onclick = () => { document.getElementById('n').textContent = '1'; };
  </script>
</body></html>`;

test('live Chromium navigates a local page, snapshots a ref, and clicks it', async (t) => {
  let chromium;
  try {
    chromium = await loadChromium();
    const probe = await chromium.launch({ headless: true });
    await probe.close();
  } catch (err) {
    t.skip(`Chromium missing (${err.message}). Run \`npx playwright install chromium\`.`);
    return;
  }

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const session = createBrowserSession({ chromium });
  try {
    const opened = await session.call('browser_navigate', { url });
    assert.equal(opened.error, undefined, opened.error);
    assert.equal(opened.url, url);

    const snap = await session.call('browser_snapshot', {});
    assert.match(snap.snapshot, /Garden/);
    const ref = /button(?:\s+"Count")?\s+\[ref=(e\d+)\]/.exec(snap.snapshot)?.[1];
    assert.ok(ref, `no button ref in:\n${snap.snapshot}`);

    const clicked = await session.call('browser_click', { ref });
    assert.equal(clicked.error, undefined, clicked.error);

    const after = await session.call('browser_snapshot', {});
    assert.match(after.snapshot, /1/, after.snapshot);

    const shot = await session.call('browser_take_screenshot', {});
    assert.equal(shot.image[0], 0x89);
    assert.equal(shot.image[1], 0x50);
    assert.equal(shot.image[2], 0x4e);
    assert.equal(shot.image[3], 0x47);
  } finally {
    await session.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
