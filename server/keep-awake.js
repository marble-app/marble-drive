// A sprite must not pause in the middle of an agent's turn.
//
// A Fly Sprite pauses about thirty seconds after its last activity, freezing
// every process, and an open connection is what counts as activity. A tab
// watching a turn is one; but a turn outlives its tab, and nothing else would
// keep the sprite up while it finishes. So while the host has work running
// (`busy`), it holds a task on the sprite's own API socket, renews it before it
// expires, and lets it go when the work is done.
//
// Checked every 15 seconds, inside the sprite's idle window. On any machine
// without `/.sprite/api.sock` this does nothing, not even a timer.

import fs from 'node:fs';
import http from 'node:http';

export function createKeepAwake({
  socket = '/.sprite/api.sock',
  busy,
  checkMs = 15_000,
  renewMs = 60_000,
  expire = '5m',
  name = 'marble-drive',
  log = console,
} = {}) {
  let timer = null;
  let held = false;
  let heldAt = 0;
  let asking = null;

  const ask = (method, route, body = null) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          socketPath: socket,
          method,
          path: route,
          headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
          timeout: 5_000,
        },
        (res) => {
          res.resume();
          res.on('end', () => (res.statusCode < 300 ? resolve() : reject(new Error(`sprite answered ${res.statusCode}`))));
        },
      );
      req.on('timeout', () => req.destroy(new Error('sprite did not answer')));
      req.on('error', reject);
      req.end(payload ?? undefined);
    });

  const hold = () => ask('POST', '/v1/tasks', { name, expire }).then(() => {
    held = true;
    heldAt = Date.now();
  });
  const letGo = () => ask('DELETE', `/v1/tasks/${encodeURIComponent(name)}`).then(() => {
    held = false;
  });

  // One request at a time. A turn that ends while a renewal is in flight is
  // let go on the next check, once that renewal has landed.
  async function check() {
    if (asking) return;
    let want;
    try {
      want = Boolean(busy());
    } catch {
      want = false;
    }
    const due = want ? !held || Date.now() - heldAt >= renewMs : held;
    if (!due) return;
    asking = (want ? hold() : letGo())
      .catch((err) => log.error?.(`[keep-awake] ${err.message}`))
      .finally(() => {
        asking = null;
      });
    await asking;
  }

  return {
    start() {
      if (timer || !fs.existsSync(socket)) return;
      timer = setInterval(check, checkMs);
      timer.unref?.();
      check();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await asking;
      if (held) await letGo().catch(() => {});
    },
    state: () => ({ active: Boolean(timer), held }),
  };
}
