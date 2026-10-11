// The door sprite's one job: make the drives people asked for at
// marbledrive.app (docs/superpowers/specs/2026-10-10-accounts-and-sign-in-
// design.md, "The door sprite").
//
// The Worker cannot run the `sprite` CLI or bash, so a small sprite does: it
// takes the oldest queued drive from the Directory, runs
// `tools/sprite-provision.sh --door` for it, and reports each step back, one
// drive at a time. The door pokes it when a drive is asked for; it also looks
// once when it starts, for anything asked while it slept.
//
// Only lines of a known shape are passed on (`step: <step> <state>`, `url:
// <https URL>`), so nothing the script or the sprite CLI says, a secret
// included, can reach the person's page.
//
// When starter credit is on (worker/src/credit.js), each drive is minted its
// own credit token first, and the script writes it into the drive's settings
// beside the proxy's address. It travels in a file only this user can read,
// never in argv, and the file is gone when the script ends.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const STEP = /^step: (machine|install|check) (now|done)$/;
const URL_LINE = /^url: (https:\/\/[A-Za-z0-9.-]+)\/?$/;

const same = (a, b) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a ?? '')).digest(), crypto.createHash('sha256').update(String(b ?? '')).digest());

/** Runs the provisioning script for one drive; each stdout line goes to
 *  `onLine`, in order. Resolves with the exit code. */
export function scriptRunner({ script, keysFile, org = 'marble-drive', log = console, spawnImpl = spawn }) {
  return ({ name, account, credit = null }, onLine) =>
    new Promise((resolve) => {
      const args = [script, '--door', name, '--account', account, '--keys', keysFile, '--org', org];
      let creditDir = null;
      if (credit?.url && credit?.token) {
        creditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marble-credit-'));
        const file = path.join(creditDir, 'credit.env');
        fs.writeFileSync(file, `MARBLE_CREDIT_URL=${credit.url}\nMARBLE_CREDIT_TOKEN=${credit.token}\n`, { mode: 0o600 });
        args.push('--credit-file', file);
      }
      const forget = () => {
        if (creditDir) fs.rmSync(creditDir, { recursive: true, force: true });
      };
      const child = spawnImpl('bash', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let chain = Promise.resolve();
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        chain = chain.then(() => onLine(line)).catch(() => {});
      });
      readline.createInterface({ input: child.stderr }).on('line', (line) => log.error(`[provisioner] ${name}: ${line.slice(0, 300)}`));
      child.on('error', () => {
        forget();
        resolve(127);
      });
      child.on('close', (code) => {
        forget();
        chain.then(() => resolve(code ?? 1));
      });
    });
}

export function createProvisioner({ directoryUrl, adminToken, run, log = console, fetchImpl = fetch }) {
  let working = false;

  async function api(method, path, body) {
    const res = await fetchImpl(new URL(`/_door${path}`, directoryUrl).href, {
      method,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`the door answered ${method} ${path} with ${res.status}`);
    return res.json();
  }

  /** A credit token for the drive, or null when starter credit is off (the
   *  Worker answers 404) or could not be minted: the drive is then made
   *  without it, as before, and its person brings a key. */
  async function mintCredit(name) {
    try {
      const res = await fetchImpl(new URL(`/_credit/admin/drives/${encodeURIComponent(name)}/token`, directoryUrl).href, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        log.error(`[provisioner] ${name}: no starter credit (the door answered ${res.status})`);
        return null;
      }
      const { token } = await res.json();
      return /^mdc_[0-9a-f]{48}$/.test(token ?? '') ? { url: new URL('/_credit', directoryUrl).href, token } : null;
    } catch (err) {
      log.error(`[provisioner] ${name}: no starter credit (${err.message})`);
      return null;
    }
  }

  /** The oldest queued drive, made. A second call while one runs does nothing. */
  async function once() {
    if (working) return { skipped: true };
    working = true;
    try {
      const { drives = [] } = await api('GET', '/queue');
      const job = drives[0];
      if (!job) return { idle: true };
      let current = 'machine';
      let url = null;
      const onLine = async (line) => {
        const step = STEP.exec(line);
        if (step) {
          if (step[2] === 'now') current = step[1];
          try {
            await api('POST', `/drives/${job.name}/step`, { step: step[1], state: step[2] });
          } catch (err) {
            log.error(`[provisioner] ${job.name}: could not report ${step[1]}: ${err.message}`);
          }
          return;
        }
        const at = URL_LINE.exec(line);
        if (at) url = at[1];
      };
      log.log(`[provisioner] making ${job.name}`);
      const credit = await mintCredit(job.name);
      const code = await run({ name: job.name, account: job.owner, ...(credit ? { credit } : {}) }, onLine);
      if (code === 0 && url) {
        await api('POST', `/drives/${job.name}/step`, { state: 'ready', url, sprite: job.sprite });
        log.log(`[provisioner] ${job.name} is ready`);
        return { made: job.name };
      }
      await api('POST', `/drives/${job.name}/step`, { step: current, state: 'failed' });
      log.error(`[provisioner] ${job.name} stopped at ${current} (exit ${code})`);
      return { failed: job.name, step: current };
    } finally {
      working = false;
    }
  }

  /** Every queued drive, one after another. */
  async function drain() {
    for (let i = 0; i < 50; i += 1) {
      const r = await once();
      if (!r.made && !r.failed) return r;
    }
    return { more: true };
  }

  /** `POST /poke` with the door's token starts a drain; `GET /health` answers. */
  function serve(port, host = '0.0.0.0') {
    const server = http.createServer((req, res) => {
      const answer = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url === '/health') return answer(200, { ok: true, working });
      if (req.method === 'POST' && req.url === '/poke') {
        if (!adminToken || !same(req.headers['x-door-token'], adminToken)) return answer(401, { error: 'unauthorised' });
        drain().catch((err) => log.error(`[provisioner] ${err.message}`));
        return answer(202, { ok: true });
      }
      return answer(404, { error: 'not found' });
    });
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  }

  return { once, drain, serve, busy: () => working };
}
