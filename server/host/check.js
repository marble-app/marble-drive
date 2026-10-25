// Asking a drive on the PC how it is, over loopback, the way a person's
// browser never does: marble-host's requests carry no forwarded headers, so
// the drive answers them as local (server/gate.js, isLocal). Each goes to the
// drive's own address from 127.0.0.2, since every guest's unit drops anything
// to or from 127.0.0.1 (server/host/addresses.js), and an answer is read only
// up to a size no health answer comes near: a drive's process is someone
// else's, and marble-host is outside every sandbox.
//
// A drive passes its check, after it is made or moved to a release, when
// within a minute: /health answers naming that release, its first page
// answers below 500 (a sign-in redirect is an answer), and /health/deep shows
// both agent CLIs' versions, so its agent can start.
//
// The same probe asks the drive's other routes for its owner on this machine,
// each with the drive's passphrase as the bearer: /health/study's counts and
// POST /health/logout, which signs its CLIs out before it is removed.

import http from 'node:http';

import { guestAddress, HOST_SIDE } from './addresses.js';

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ANSWER = 256 * 1024;
// What /health/logout says of each CLI.
const SIGNED_OUT = new Set(['signed-out', 'was-not-signed-in', 'failed']);

export function createProbe({ timeoutMs = 5000, from = HOST_SIDE } = {}) {
  /** One request to the drive on `port`: { status, body } with the body as
   *  JSON (null when it is not), or null when the drive did not answer.
   *  `statusOnly` reads no body at all, for a page. */
  function ask(port, method, route, { bearer = null, accept = 'application/json', body = null, statusOnly = false, timeoutMs: limit = timeoutMs } = {}) {
    let host;
    try {
      host = guestAddress(port);
    } catch {
      return Promise.resolve(null);
    }
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve) => {
      let req = null;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        req?.destroy();
        finish(null);
      }, limit);
      req = http.request(
        {
          host,
          port,
          localAddress: from,
          method,
          path: route,
          headers: {
            accept,
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          },
        },
        (res) => {
          if (statusOnly) {
            res.resume();
            req.destroy();
            return finish({ status: res.statusCode, body: null });
          }
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_ANSWER) {
              req.destroy();
              return finish(null);
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            let parsed = null;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {}
            finish({ status: res.statusCode, body: parsed });
          });
          res.on('error', () => finish(null));
          res.on('aborted', () => finish(null));
        },
      );
      req.on('error', () => finish(null));
      req.end(payload ?? undefined);
    });
  }
  const get = (port, route, opts = {}) => ask(port, 'GET', route, opts);
  return {
    ask,
    get,
    /** /health's answer, or null when the drive does not give one. */
    async health(port) {
      const r = await get(port, '/health');
      return r?.status === 200 && r.body?.ok ? r.body : null;
    },
    /** /health/deep's answer; the drive's passphrase is the bearer it asks for. */
    async deep(port, secret) {
      const r = await get(port, '/health/deep', { bearer: secret });
      return r?.status === 200 && r.body?.ok ? r.body : null;
    },
    /** The status of the drive's first page, as a browser would ask for it. */
    async page(port) {
      return (await get(port, '/', { accept: 'text/html', statusOnly: true }))?.status ?? null;
    },
    /** /health/study's answer, counts and times only, or null. */
    async study(port, secret) {
      const r = await get(port, '/health/study', { bearer: secret });
      return r?.status === 200 && r.body?.ok ? r.body : null;
    },
    /** The drive signs both its CLIs out: { claude, codex }, each
     *  signed-out, was-not-signed-in or failed; null when it did not answer.
     *  Each CLI's logout is a command of its own, so this waits a minute. */
    async logout(port, secret) {
      const r = await ask(port, 'POST', '/health/logout', { bearer: secret, body: {}, timeoutMs: 60_000 });
      if (r?.status !== 200 || !r.body || typeof r.body !== 'object') return null;
      const said = (v) => (SIGNED_OUT.has(v) ? v : null);
      return { claude: said(r.body.claude), codex: said(r.body.codex) };
    },
  };
}

export async function checkDrive({ probe, port, release, secret, deadlineMs = 60_000, everyMs = 1000, now = Date.now, sleep = sleepFor }) {
  const until = now() + deadlineMs;
  let why = 'it did not answer /health';
  for (;;) {
    const health = await probe.health(port);
    if (!health) why = 'it did not answer /health';
    else if (release && health.release !== release) why = `/health says release ${health.release ?? 'none'}, not ${release}`;
    else {
      const page = await probe.page(port);
      if (page === null || page >= 500) why = `its first page answered ${page ?? 'nothing'}`;
      else {
        const deep = await probe.deep(port, secret);
        if (!deep) why = 'it did not answer /health/deep';
        else if (!deep.claude?.version || !deep.codex?.version) why = `/health/deep has ${deep.claude?.version ? '' : 'no Claude Code version'}${!deep.claude?.version && !deep.codex?.version ? ' and ' : ''}${deep.codex?.version ? '' : 'no Codex version'}`;
        else return { ok: true, health, deep };
      }
    }
    if (now() + everyMs > until) return { ok: false, why };
    await sleep(everyMs);
  }
}
