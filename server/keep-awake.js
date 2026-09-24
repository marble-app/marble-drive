// A sprite must not pause in the middle of an agent's turn.
//
// A Fly Sprite pauses about thirty seconds after its last activity, freezing
// every process, and an open connection is what counts as activity. A tab
// watching a turn is one; but a turn outlives its tab, and nothing else would
// keep the sprite up while it finishes. So while the host has work running
// (`busy`), it holds a task on the sprite's own API socket, renews it before it
// expires, and lets it go when the work is done.
//
// Checked every 15 seconds, and at once whenever work may have started (nudge):
// the sprite pauses within about a second of its last connection. On any machine
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
          res.on('end', () => (res.statusCode < 300 ? resolve() : reject(Object.assign(new Error(`sprite answered ${res.statusCode}`), { status: res.statusCode }))));
        },
      );
      req.on('timeout', () => req.destroy(new Error('sprite did not answer')));
      req.on('error', reject);
      req.end(payload ?? undefined);
    });

  // A task is made by POST and extended by PUT to its name: a second POST of
  // the same name is refused (409), so renewing that way never renewed, and
  // every hold lapsed after `expire`. Each falls back to the other: a task that
  // is already there (a host restarted) is extended, one that lapsed is made.
  const task = `/v1/tasks/${encodeURIComponent(name)}`;
  const make = () => ask('POST', '/v1/tasks', { name, expire })
    .catch((err) => (err.status === 409 ? ask('PUT', task, { expire }) : Promise.reject(err)));
  const extend = () => ask('PUT', task, { expire })
    .catch((err) => (err.status === 404 ? ask('POST', '/v1/tasks', { name, expire }) : Promise.reject(err)));
  const hold = () => (held ? extend() : make()).then(() => {
    held = true;
    heldAt = Date.now();
  });
  // Already gone (it lapsed) is let go all the same.
  const letGo = () => ask('DELETE', task)
    .catch((err) => (err.status === 404 ? undefined : Promise.reject(err)))
    .then(() => {
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
    /** Work may have started: look now, not at the next check. A sprite pauses
     *  about a second after its last connection closes, and the request that
     *  started the work is often that connection. */
    nudge() {
      if (timer) check();
    },
    state: () => ({ active: Boolean(timer), held }),
  };
}
