# Mac home, phase 1 (moving home by hand) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner's drive can live on his Mac, with Fly (admin-p2) standing
by, an encrypted copy in Cloudflare R2 that is never more than about a minute
behind, and one command that moves home in either direction:
`tools/drive-home.mjs to mac|fly`.

**Architecture:**
- **Hub.** An rclone `crypt` remote over R2. The home host uploads changes
  about once a minute; a machine taking over downloads first.
- **Lease.** A Cloudflare Worker with one Durable Object per drive holds the
  lease (`home`, `epoch`). A host serves the drive only when the lease names
  its machine. Otherwise it runs a standby server that writes nothing.
- **The Mac** runs a release of this repo under launchd, like a sprite runs
  one, through the same `tools/sprite/serve.sh` keeper.

**Tech stack:** Node 22 (ESM, `node:test`), rclone (s3 + crypt backends),
Cloudflare Workers + Durable Objects (wrangler), zsh/bash, launchd.

**Spec:** `docs/superpowers/specs/2026-09-29-mac-home-drive-design.md`.
This plan is the spec's phase 1. Phases 2–4 (the front door on
`marbledrive.app`, automatic moves, sessions and code) get their own plans.

## Global Constraints

- One home at a time. A host serves the drive only while the lease names its
  machine. Two-way live sync is out.
- The hub is encrypted before upload (rclone `crypt`, names and contents).
  Cloudflare holds only ciphertext.
- Excluded from every upload and download: `/.marble/agents/host.lock`,
  `/.marble/usage/**`, `/.marble/console/backups/**`.
- Trash: anything an upload overwrites or deletes goes to `hub:trash/<utc>/`,
  and anything a download replaces goes to
  `~/.cache/marble-drive/hub-trash/<drive>/<utc>/`. Both are kept 7 days.
- An upload refuses when the drive has no documents, or fewer than half the
  files of the last upload.
- Hub settings live in a file named by `MARBLE_HUB_ENV`, mode 600, outside
  every drive and repo. The hub is off unless that variable is set: friends'
  sprites, tests and the dev checkout are untouched.
- Never print, log, commit or copy a key or passphrase: R2 keys,
  `HUB_PASSPHRASE`, `HUB_SALT`, `LEASE_TOKEN` (CLAUDE.md, Rules). The owner
  types secrets himself.
- The lease starts at `{ home: 'fly', epoch: 0 }`, which matches today:
  admin-p2 is home.
- The Mac's real drive runs from a release on port **4401**, rooted at
  **`~/Marble Drive`**. The dev checkout keeps port 4400 and its throwaway
  `drive/`.
- Try everything on **t-bryan** (drive name `t-bryan`, Mac port 4402, root
  `~/Marble Drive (t-bryan)`) before bryan/admin-p2 (CLAUDE.md, "Shipping a
  change").
- `server/app.js` is edited by concurrent sessions: run `ListAgents` before
  touching it, and keep the edit to the one line in Task 6.
- Browser tests: none are touched by this plan. Unit tests run with `npm test`.

## Review Focus

1. **Document names with spaces, apostrophes and accents** ("Bryan's Days",
   "Design Don'ts", "Café") must round-trip through the encrypted hub exactly.
   Test: Task 3, `round trip keeps odd names`.
2. **A Mac restarted while offline** (no Worker) must come up home if the last
   lease it saw named it, and standby if it never saw one. Test: Task 4,
   `offline, the last lease decides`.
3. **The lease moved while this host kept running** (a Mac that was
   partitioned): the next upload tick must not upload, and must stop the host.
   Test: Task 6, `a lost lease stops the host and uploads nothing`.
4. **A drive folder that is suddenly empty or nearly so** (a broken link, the
   wrong root) must never propagate deletions to the hub, and a download from
   an empty hub must never wipe a drive. Tests: Task 3, `refuses to upload an
   empty drive` and `refuses to download from an empty hub`.
5. **Two moves at once, or a lease changed by someone else mid-move:** the move
   that loses must leave the old home serving and the lease untouched. Test:
   Task 8, `a lease that moved underneath aborts and restores the old home`.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/src/lease.js` | the lease as pure data: `INITIAL`, `MACHINES`, `move()` |
| `worker/src/index.js` | Worker entry + `Lease` Durable Object: GET/POST over HTTP, bearer token |
| `worker/wrangler.toml` | Worker config and DO binding |
| `server/hub/settings.js` | reads the hub env file (`parseEnvFile`, `loadHubSettings`) |
| `server/hub/sync.js` | rclone wrapper: `scan`, `looksWrong`, `rcloneEnv`, `readState`, `up`, `down`, `trashPrefix` |
| `server/hub/lease-client.js` | Worker client with a local cache; `decideMode` |
| `server/hub/schedule.js` | the host's once-a-minute upload loop |
| `server/hub/move.js` | `moveHome`: the ordered move with rollback, over two "sides" |
| `server/hub/mac-paths.js` | where a drive lives on the Mac, by name |
| `server/standby.js` | the standby HTTP server |
| `server/agent/projects.js` | (modify) map another machine's project paths onto this one |
| `server/app.js` | (modify, one line) `/health` reports `working` |
| `bin/marble-drive.js` | (modify) `standby` command; start the upload loop in `serve` |
| `server/config.js` | (modify) `hubEnv` |
| `tools/drive-sync.mjs` | CLI: `up`, `down`, `counts`, `state`, `trash-prefix` |
| `tools/home-mode.mjs` | prints `serve` or `standby` for this machine |
| `tools/drive-home.mjs` | CLI: `to mac|fly`, with the real Mac and Fly sides |
| `tools/sprite/serve.sh` | (modify) ask `home-mode.mjs` before each start |
| `tools/sprite/release.sh` | (modify) install pinned rclone once per sprite |
| `tools/sprite/rclone-version` | the pinned rclone version |
| `tools/mac-release.sh` | build a release on the Mac and switch to it |
| `macos/launchd/home.sh` + `com.marble.drive.home.plist.in` | the Mac's real drive under launchd |
| `test/hub-*.test.js`, `test/standby.test.js`, `test/agent-projects.test.js` | tests |
| `docs/HOSTING.md`, `docs/HOSTING-DECISIONS.md`, `CLAUDE.md`, the spec | docs |

---

### Task 1: The lease, as pure data

**Files:**
- Create: `worker/src/lease.js`
- Test: `test/hub-lease.test.js`

**Interfaces:**
- Produces: `INITIAL` (`{home:'fly', epoch:0, since:null}`), `MACHINES`
  (`['mac','fly']`), and `move(lease|null, {to, epoch, now}) →
  {ok:true, lease} | {ok:false, status:400|409, why, lease?}`.

- [ ] **Step 1: Write the failing test**

```js
// test/hub-lease.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL, MACHINES, move } from '../worker/src/lease.js';

const NOW = Date.parse('2026-09-30T10:00:00Z');

test('a new lease says Fly is home at epoch 0, which is today', () => {
  assert.deepEqual(INITIAL, { home: 'fly', epoch: 0, since: null });
  assert.deepEqual(MACHINES, ['mac', 'fly']);
});

test('a move names the current epoch, and raises it', () => {
  const result = move(null, { to: 'mac', epoch: 0, now: NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lease, { home: 'mac', epoch: 1, since: '2026-09-30T10:00:00.000Z' });
});

test('a move with a stale epoch is refused with the lease as it is', () => {
  const lease = { home: 'mac', epoch: 4, since: 'x' };
  const result = move(lease, { to: 'fly', epoch: 3, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(result.lease, lease);
  assert.match(result.why, /epoch 4, not 3/);
});

test('only mac or fly, and only integer epochs', () => {
  assert.equal(move(null, { to: 'pc', epoch: 0, now: NOW }).status, 400);
  assert.equal(move(null, { to: 'mac', epoch: '0', now: NOW }).status, 400);
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `node --test test/hub-lease.test.js`
Expected: FAIL, `Cannot find module '…/worker/src/lease.js'`.

- [ ] **Step 3: Write the implementation**

```js
// worker/src/lease.js
// Which machine is a drive's home. One writer at a time: a host serves the
// drive only while the lease names its machine, and every move names the epoch
// it moves from, so two moves at once cannot both win (docs/superpowers/specs/
// 2026-09-29-mac-home-drive-design.md, piece 2). Pure, so the Worker and the
// Node tests run the same code.

export const MACHINES = ['mac', 'fly'];

// Fly was home before any of this existed.
export const INITIAL = Object.freeze({ home: 'fly', epoch: 0, since: null });

export function move(lease, { to, epoch, now }) {
  const current = lease ?? INITIAL;
  if (!MACHINES.includes(to)) return { ok: false, status: 400, why: `to must be one of ${MACHINES.join(', ')}` };
  if (!Number.isInteger(epoch)) return { ok: false, status: 400, why: 'epoch must be an integer' };
  if (epoch !== current.epoch) {
    return { ok: false, status: 409, why: `the lease is at epoch ${current.epoch}, not ${epoch}`, lease: current };
  }
  return { ok: true, lease: { home: to, epoch: current.epoch + 1, since: new Date(now).toISOString() } };
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `node --test test/hub-lease.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lease.js test/hub-lease.test.js
git commit -m "The lease: one home per drive, moved only from the epoch it is at"
```

---

### Task 2: The lease Worker

**Files:**
- Create: `worker/src/index.js`, `worker/wrangler.toml`
- Test: `test/hub-lease-worker.test.js`

**Interfaces:**
- Consumes: `INITIAL`, `move` from Task 1.
- Produces: HTTP. `GET /lease/<drive>` → `200 {home, epoch, since}`.
  `POST /lease/<drive>/move` with body `{to, epoch}` → `200 <new lease>` |
  `409 {why, lease}` | `400 {why, lease}`. Every route needs
  `Authorization: Bearer <LEASE_TOKEN>` (`401` otherwise). Drive names match
  `^[a-z0-9-]+$`.

- [ ] **Step 1: Write the failing test**

```js
// test/hub-lease-worker.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { handle, Lease } from '../worker/src/index.js';

// Stand-ins for the Durable Object runtime: one object per name, each with a
// Map for storage. The real runtime runs one request per object at a time.
function fakeEnv(token = 'secret') {
  const objects = new Map();
  return {
    LEASE_TOKEN: token,
    LEASE: {
      idFromName: (name) => name,
      get: (id) => {
        if (!objects.has(id)) {
          const store = new Map();
          objects.set(id, new Lease({ storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) } }));
        }
        return objects.get(id);
      },
    },
  };
}
const auth = { authorization: 'Bearer secret' };
const call = (env, method, path, body, headers = auth) =>
  handle(new Request(`https://lease.test${path}`, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);

test('without the token, nothing', async () => {
  const res = await call(fakeEnv(), 'GET', '/lease/bryan', null, {});
  assert.equal(res.status, 401);
});

test('a drive nobody moved is at home on Fly', async () => {
  const res = await call(fakeEnv(), 'GET', '/lease/bryan');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { home: 'fly', epoch: 0, since: null });
});

test('a move is kept, and a second move from the same epoch loses', async () => {
  const env = fakeEnv();
  const first = await call(env, 'POST', '/lease/bryan/move', { to: 'mac', epoch: 0 });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).epoch, 1);
  const second = await call(env, 'POST', '/lease/bryan/move', { to: 'fly', epoch: 0 });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).lease.home, 'mac');
  assert.equal((await (await call(env, 'GET', '/lease/bryan')).json()).home, 'mac');
});

test('drives do not share a lease', async () => {
  const env = fakeEnv();
  await call(env, 'POST', '/lease/t-bryan/move', { to: 'mac', epoch: 0 });
  assert.equal((await (await call(env, 'GET', '/lease/bryan')).json()).home, 'fly');
});

test('a Worker with no token set refuses everyone', async () => {
  const res = await call(fakeEnv(''), 'GET', '/lease/bryan', null, { authorization: 'Bearer ' });
  assert.equal(res.status, 500);
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `node --test test/hub-lease-worker.test.js`
Expected: FAIL, `Cannot find module '…/worker/src/index.js'`.

- [ ] **Step 3: Write the Worker and its config**

```js
// worker/src/index.js
// The lease, on Cloudflare: one Durable Object per drive, so a read after a
// move always sees it (KV can lag by a minute). The Mac, the sprite and
// tools/drive-home.mjs are its only callers, with one shared bearer token.

import { INITIAL, move } from './lease.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class Lease {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const current = (await this.state.storage.get('lease')) ?? INITIAL;
    if (request.method === 'GET') return json(200, current);
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/move')) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { why: 'the body must be JSON', lease: current });
      }
      const result = move(current, { to: body?.to, epoch: body?.epoch, now: Date.now() });
      if (!result.ok) return json(result.status, { why: result.why, lease: result.lease ?? current });
      await this.state.storage.put('lease', result.lease);
      return json(200, result.lease);
    }
    return json(404, { why: 'no such route' });
  }
}

export async function handle(request, env) {
  if (!env.LEASE_TOKEN) return json(500, { why: 'LEASE_TOKEN is not set on this Worker' });
  if (request.headers.get('authorization') !== `Bearer ${env.LEASE_TOKEN}`) return json(401, { why: 'unauthorised' });
  const match = /^\/lease\/([a-z0-9-]+)(\/move)?$/.exec(new URL(request.url).pathname);
  if (!match) return json(404, { why: 'no such route' });
  return env.LEASE.get(env.LEASE.idFromName(match[1])).fetch(request);
}

export default { fetch: handle };
```

```toml
# worker/wrangler.toml
# The lease Worker (docs/HOSTING.md, "The owner's drive on the Mac").
# Deploy: cd worker && npx wrangler@latest deploy
# Its one secret: npx wrangler@latest secret put LEASE_TOKEN
name = "marble-lease"
main = "src/index.js"
compatibility_date = "2026-09-01"

[[durable_objects.bindings]]
name = "LEASE"
class_name = "Lease"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Lease"]
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test test/hub-lease.test.js test/hub-lease-worker.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/ test/hub-lease-worker.test.js
git commit -m "The lease Worker: a Durable Object per drive behind one token"
```

---

### Task 3: The hub: encrypted upload and download

**Files:**
- Create: `server/hub/settings.js`, `server/hub/sync.js`, `tools/drive-sync.mjs`
- Test: `test/hub-settings.test.js`, `test/hub-sync.test.js`

**Interfaces:**
- Produces:
  - `parseEnvFile(text) → {KEY: value}`
  - `loadHubSettings(file) → settings | null` (null when `file` is falsy or
    missing; throws on a bad file). `settings` has `HUB_DRIVE`, `HUB_MACHINE`,
    `HUB_PASSPHRASE`, `HUB_SALT`, `LEASE_URL`, `LEASE_TOKEN`, `file`, and
    either the R2 keys or `HUB_BACKEND=local` + `HUB_LOCAL_DIR`.
  - `EXCLUDES` (rclone filter patterns)
  - `scan(root) → {files, documents, newest}` (`newest` is the largest mtime in
    ms)
  - `looksWrong(counts, lastState|null) → string|null`
  - `rclone(args, env, {input}) → {stdout, stderr}`
  - `rcloneEnv(settings, run) → env`
  - `readState({settings, env, run}) → state|null`
  - `up({root, settings, epoch, force?, run?, now?}) → {ok:true, state, counts} | {ok:false, why, counts}`
  - `down({root, settings, run?, now?, trashRoot?}) → {ok:true, state, counts, matches} | {ok:false, why}`
  - `trashPrefix({settings, run}) → string`, the raw R2 prefix of the
    encrypted `trash/` folder
  - `state` = `{home, epoch, seq, at, files, documents}`
  - CLI: `node tools/drive-sync.mjs <up|down|counts|state|trash-prefix>
    [--root <dir>] [--epoch <n>] [--force]`. It prints one JSON object and
    exits 0 whenever it printed one, 1 only on a crash.

- [ ] **Step 0: Install rclone on the Mac**

Run: `brew install rclone && rclone version | head -1`
Expected: `rclone v1.x.y`. Note the version; Task 9 pins it for the sprites.

- [ ] **Step 1: Write the failing settings test**

```js
// test/hub-settings.test.js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadHubSettings, parseEnvFile } from '../server/hub/settings.js';

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hub-settings-'));
const write = async (name, text) => {
  const file = path.join(dir, name);
  await fsp.writeFile(file, text);
  return file;
};
const BASE = 'HUB_DRIVE=bryan\nHUB_MACHINE=mac\nHUB_PASSPHRASE=p\nHUB_SALT=s\nLEASE_URL=https://l\nLEASE_TOKEN=t\n';

test('KEY=value lines, comments and quotes', () => {
  assert.deepEqual(parseEnvFile('# c\nA=1\nB="two words"\n  C = 3 \nbad line\n'), { A: '1', B: 'two words', C: '3' });
});

test('no file named, or no file there: the hub is off', async () => {
  assert.equal(loadHubSettings(null), null);
  assert.equal(loadHubSettings(path.join(dir, 'nope.env')), null);
});

test('a file missing keys says which', async () => {
  const file = await write('short.env', 'HUB_DRIVE=bryan\n');
  assert.throws(() => loadHubSettings(file), /missing HUB_MACHINE/);
});

test('R2 keys are needed unless the backend is local', async () => {
  assert.throws(() => loadHubSettings(await write('r2.env', BASE)), /R2_ACCOUNT_ID/);
  const local = loadHubSettings(await write('local.env', `${BASE}HUB_BACKEND=local\nHUB_LOCAL_DIR=/tmp/x\n`));
  assert.equal(local.HUB_DRIVE, 'bryan');
  assert.equal(local.file, path.join(dir, 'local.env'));
});

test('the machine is mac or fly, and the drive a plain name', async () => {
  const bad = await write('bad.env', BASE.replace('HUB_MACHINE=mac', 'HUB_MACHINE=pc') + 'HUB_BACKEND=local\nHUB_LOCAL_DIR=/x\n');
  assert.throws(() => loadHubSettings(bad), /mac or fly/);
  const odd = await write('odd.env', BASE.replace('HUB_DRIVE=bryan', 'HUB_DRIVE=../x') + 'HUB_BACKEND=local\nHUB_LOCAL_DIR=/x\n');
  assert.throws(() => loadHubSettings(odd), /HUB_DRIVE/);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test test/hub-settings.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/hub/settings.js`**

```js
// server/hub/settings.js
// The hub's settings: a KEY=value file outside every drive and repo, mode 600,
// named by MARBLE_HUB_ENV. Unset or missing is "no hub": a drive with one home,
// which is every drive but the owner's. Read from a file rather than the
// process environment so the R2 keys never reach an agent's child processes.

import fs from 'node:fs';

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const REQUIRED = ['HUB_DRIVE', 'HUB_MACHINE', 'HUB_PASSPHRASE', 'HUB_SALT', 'LEASE_URL', 'LEASE_TOKEN'];
const R2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

export function loadHubSettings(file) {
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const s = parseEnvFile(text);
  const needs = [...REQUIRED, ...(s.HUB_BACKEND === 'local' ? ['HUB_LOCAL_DIR'] : R2)];
  const missing = needs.filter((key) => !s[key]);
  if (missing.length) throw new Error(`${file} is missing ${missing.join(', ')}`);
  if (!['mac', 'fly'].includes(s.HUB_MACHINE)) throw new Error(`${file}: HUB_MACHINE must be mac or fly`);
  if (!/^[a-z0-9-]+$/.test(s.HUB_DRIVE)) throw new Error(`${file}: HUB_DRIVE must be lowercase letters, digits and dashes`);
  return { ...s, file };
}
```

- [ ] **Step 4: Run it and check it passes**

Run: `node --test test/hub-settings.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing sync test**

The rclone round trips run against rclone's `local` backend under `crypt`, so
they need rclone but no network. They skip when rclone is not installed (a
sprite before Task 9).

```js
// test/hub-sync.test.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EXCLUDES, down, looksWrong, rclone, rcloneEnv, scan, up } from '../server/hub/sync.js';

let hasRclone = true;
try { execFileSync('rclone', ['version'], { stdio: 'ignore' }); } catch { hasRclone = false; }
const needsRclone = { skip: hasRclone ? false : 'rclone is not installed' };

const tmp = (name) => fsp.mkdtemp(path.join(os.tmpdir(), `hub-${name}-`));
async function put(root, rel, text) {
  await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fsp.writeFile(path.join(root, rel), text);
}
async function tree(root) {
  const out = {};
  const walk = async (dir, rel) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out[r] = await fsp.readFile(path.join(dir, e.name), 'utf8');
    }
  };
  await walk(root, '');
  return out;
}
async function fixture() {
  const root = await tmp('drive');
  await put(root, 'notes.mrbl', '<html>notes</html>');
  await put(root, "Bryan's Days/Café — today.mrbl", '<html>day</html>');
  await put(root, "Design Don'ts.mrbl", '<html>donts</html>');
  await put(root, '.marble/notes.history.jsonl', '{"v":1}\n');
  await put(root, '.marble/agents/host.lock', '12345\n');
  await put(root, '.marble/usage/2026-09-30.jsonl', '{}\n');
  await put(root, '.marble/console/backups/admin-p2.json', '{}');
  return root;
}
async function settings() {
  return {
    HUB_DRIVE: 'bryan', HUB_MACHINE: 'mac', HUB_PASSPHRASE: 'correct horse', HUB_SALT: 'battery staple',
    HUB_BACKEND: 'local', HUB_LOCAL_DIR: await tmp('hub'), LEASE_URL: 'https://l', LEASE_TOKEN: 't',
  };
}
const at = (iso) => () => new Date(iso);

test('scan counts files and documents, and skips what is left out', async () => {
  const root = await fixture();
  const counts = await scan(root);
  assert.equal(counts.files, 4); // 3 documents + the history line
  assert.equal(counts.documents, 3);
  assert.ok(counts.newest > 0);
  assert.deepEqual(EXCLUDES, ['/.marble/agents/host.lock', '/.marble/usage/**', '/.marble/console/backups/**']);
});

test('looksWrong: no documents, or under half the files, is refused', () => {
  assert.match(looksWrong({ files: 10, documents: 0 }, null), /no documents/);
  assert.match(looksWrong({ files: 40, documents: 3 }, { files: 100 }), /under half/);
  assert.equal(looksWrong({ files: 60, documents: 3 }, { files: 100 }), null);
  assert.equal(looksWrong({ files: 1, documents: 1 }, null), null);
});

test('round trip keeps odd names, and leaves the excluded files out', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  const result = await up({ root, settings: s, epoch: 3, now: at('2026-09-30T10:00:00Z') });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { home: 'mac', epoch: 3, seq: 1, at: '2026-09-30T10:00:00.000Z', files: 4, documents: 3 });

  const other = await tmp('other');
  const back = await down({ root: other, settings: s, trashRoot: await tmp('trash') });
  assert.equal(back.ok, true);
  assert.equal(back.matches, true);
  assert.deepEqual(await tree(other), {
    'notes.mrbl': '<html>notes</html>',
    "Bryan's Days/Café — today.mrbl": '<html>day</html>',
    "Design Don'ts.mrbl": '<html>donts</html>',
    '.marble/notes.history.jsonl': '{"v":1}\n',
  });
});

test('the hub holds no readable names or contents', needsRclone, async () => {
  const s = await settings();
  await up({ root: await fixture(), settings: s, epoch: 0 });
  const raw = await tree(path.join(s.HUB_LOCAL_DIR, 'bryan', 'data'));
  const text = JSON.stringify(raw);
  for (const secret of ['Bryan', 'notes', 'Café', '<html>']) assert.ok(!text.includes(secret), `hub shows "${secret}"`);
});

test('a download keeps what the other machine left out, and sets aside what it replaces', needsRclone, async () => {
  const s = await settings();
  await up({ root: await fixture(), settings: s, epoch: 0 });
  const here = await tmp('here');
  await put(here, '.marble/agents/host.lock', 'mine\n');
  await put(here, '.marble/usage/2026-09-30.jsonl', 'mine\n');
  await put(here, 'notes.mrbl', '<html>old notes</html>');
  const trashRoot = await tmp('trash');
  await down({ root: here, settings: s, trashRoot, now: at('2026-09-30T11:00:00Z') });
  const after = await tree(here);
  assert.equal(after['.marble/agents/host.lock'], 'mine\n');
  assert.equal(after['.marble/usage/2026-09-30.jsonl'], 'mine\n');
  assert.equal(after['notes.mrbl'], '<html>notes</html>');
  assert.deepEqual(await tree(trashRoot), { '20260930T110000Z/notes.mrbl': '<html>old notes</html>' });
});

test('a second upload puts what it deleted in the hub trash, and counts on', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  await fsp.rm(path.join(root, "Design Don'ts.mrbl"));
  const second = await up({ root, settings: s, epoch: 0, now: at('2026-09-30T12:00:00Z') });
  assert.equal(second.state.seq, 2);
  const env = await rcloneEnv(s);
  const trash = (await rclone(['lsf', '-R', 'hub:trash'], env)).stdout;
  assert.match(trash, /20260930T120000Z\/Design Don'ts\.mrbl/);
});

test('refuses to upload an empty drive', needsRclone, async () => {
  const s = await settings();
  await up({ root: await fixture(), settings: s, epoch: 0 });
  const empty = await tmp('empty');
  const result = await up({ root: empty, settings: s, epoch: 0 });
  assert.equal(result.ok, false);
  assert.match(result.why, /no documents/);
  const other = await tmp('other');
  await down({ root: other, settings: s, trashRoot: await tmp('trash') });
  assert.equal((await tree(other))['notes.mrbl'], '<html>notes</html>');
});

test('refuses to download from an empty hub', needsRclone, async () => {
  const s = await settings();
  const here = await fixture();
  const result = await down({ root: here, settings: s, trashRoot: await tmp('trash') });
  assert.equal(result.ok, false);
  assert.match(result.why, /no upload yet/);
  assert.equal((await tree(here))['notes.mrbl'], '<html>notes</html>');
});
```

- [ ] **Step 6: Run it and check it fails**

Run: `node --test test/hub-sync.test.js`
Expected: FAIL, `Cannot find module '…/server/hub/sync.js'`.

- [ ] **Step 7: Write `server/hub/sync.js`**

```js
// server/hub/sync.js
// The hub: an encrypted copy of a drive in R2, kept by whichever machine is
// home (docs/superpowers/specs/2026-09-29-mac-home-drive-design.md, piece 1).
//
//   <bucket>/<drive>/state.json   the last upload: who, epoch, seq, counts. Plain; no content.
//   <bucket>/<drive>/data/…       rclone crypt: drive/ and trash/<utc>/, names and contents encrypted
//
// rclone is configured through the environment only, so no config file holds
// a key. The passphrase and salt are obscured by rclone itself at call time.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const EXCLUDES = ['/.marble/agents/host.lock', '/.marble/usage/**', '/.marble/console/backups/**'];
const excluded = (rel) =>
  rel === '.marble/agents/host.lock' || rel.startsWith('.marble/usage/') || rel.startsWith('.marble/console/backups/');
const filters = () => EXCLUDES.flatMap((pattern) => ['--exclude', pattern]);
const stampOf = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** What is in a drive, counted the way both machines count it. */
export async function scan(root) {
  let files = 0;
  let documents = 0;
  let newest = 0;
  const walk = async (dir, rel) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!excluded(`${r}/`)) await walk(path.join(dir, entry.name), r);
        continue;
      }
      if (!entry.isFile() || excluded(r)) continue;
      files += 1;
      if (r.endsWith('.mrbl') && !r.startsWith('.marble/')) documents += 1;
      const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null);
      if (stat && stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
  };
  await walk(root, '');
  return { files, documents, newest };
}

/** Why an upload of this drive would do harm, or null. */
export function looksWrong(counts, last) {
  if (counts.documents === 0) return 'the drive has no documents';
  if (last?.files > 0 && counts.files < last.files * 0.5) {
    return `the drive has ${counts.files} files, under half of the ${last.files} last uploaded`;
  }
  return null;
}

export function rclone(args, env, { input = '' } = {}) {
  const bin = process.env.MARBLE_RCLONE || 'rclone';
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, RCLONE_CONFIG: '/dev/null', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`rclone ${args[0]} failed (${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`), { stderr }));
    });
    child.stdin.end(input);
  });
}

const rawBase = (s) =>
  s.HUB_BACKEND === 'local' ? `hubraw:${path.join(s.HUB_LOCAL_DIR, s.HUB_DRIVE)}` : `hubraw:${s.R2_BUCKET}/${s.HUB_DRIVE}`;

export async function rcloneEnv(s, run = rclone) {
  const obscure = async (value) => (await run(['obscure', value], {})).stdout.trim();
  const env = {
    RCLONE_CONFIG_HUB_TYPE: 'crypt',
    RCLONE_CONFIG_HUB_REMOTE: `${rawBase(s)}/data`,
    RCLONE_CONFIG_HUB_PASSWORD: await obscure(s.HUB_PASSPHRASE),
    RCLONE_CONFIG_HUB_PASSWORD2: await obscure(s.HUB_SALT),
  };
  if (s.HUB_BACKEND === 'local') return { ...env, RCLONE_CONFIG_HUBRAW_TYPE: 'local' };
  return {
    ...env,
    RCLONE_CONFIG_HUBRAW_TYPE: 's3',
    RCLONE_CONFIG_HUBRAW_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_HUBRAW_ACCESS_KEY_ID: s.R2_ACCESS_KEY_ID,
    RCLONE_CONFIG_HUBRAW_SECRET_ACCESS_KEY: s.R2_SECRET_ACCESS_KEY,
    RCLONE_CONFIG_HUBRAW_ENDPOINT: `https://${s.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    RCLONE_CONFIG_HUBRAW_NO_CHECK_BUCKET: 'true',
  };
}

export async function readState({ settings, env, run = rclone }) {
  try {
    return JSON.parse((await run(['cat', `${rawBase(settings)}/state.json`], env)).stdout);
  } catch (err) {
    if (/not found|no such file|doesn't exist/i.test(err.stderr ?? err.message)) return null;
    throw err;
  }
}

export async function up({ root, settings, epoch, force = false, run = rclone, now = () => new Date() }) {
  const env = await rcloneEnv(settings, run);
  const counts = await scan(root);
  const last = await readState({ settings, env, run });
  const wrong = looksWrong(counts, last);
  if (wrong && !force) return { ok: false, why: wrong, counts };
  const when = now();
  await run(['sync', root, 'hub:drive', '--backup-dir', `hub:trash/${stampOf(when)}`, ...filters(), '--fast-list', '--transfers', '8'], env);
  const state = {
    home: settings.HUB_MACHINE,
    epoch,
    seq: (last?.seq ?? 0) + 1,
    at: when.toISOString(),
    files: counts.files,
    documents: counts.documents,
  };
  await run(['rcat', `${rawBase(settings)}/state.json`], env, { input: JSON.stringify(state) });
  return { ok: true, state, counts };
}

async function pruneTrash(dir, keepDays, now) {
  const cutoff = now.getTime() - keepDays * 86_400_000;
  for (const name of await fsp.readdir(dir).catch(() => [])) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(name);
    if (!match) continue;
    const when = Date.UTC(+match[1], match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
    if (when < cutoff) await fsp.rm(path.join(dir, name), { recursive: true, force: true });
  }
}

export async function down({
  root,
  settings,
  run = rclone,
  now = () => new Date(),
  trashRoot = path.join(os.homedir(), '.cache', 'marble-drive', 'hub-trash', settings.HUB_DRIVE),
  keepDays = 7,
}) {
  const env = await rcloneEnv(settings, run);
  const state = await readState({ settings, env, run });
  if (!state) return { ok: false, why: 'the hub has no upload yet' };
  const when = now();
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(trashRoot, { recursive: true });
  await run(['sync', 'hub:drive', root, '--backup-dir', path.join(trashRoot, stampOf(when)), ...filters(), '--fast-list', '--transfers', '8'], env);
  await pruneTrash(trashRoot, keepDays, when);
  const counts = await scan(root);
  return { ok: true, state, counts, matches: counts.files === state.files && counts.documents === state.documents };
}

/** The raw R2 prefix the encrypted trash/ lands under, for the bucket's
 *  7-day lifecycle rule. */
export async function trashPrefix({ settings, run = rclone }) {
  const env = await rcloneEnv(settings, run);
  const encoded = (await run(['cryptencode', 'hub:', 'trash'], env)).stdout.trim().split('\t').pop();
  return `${settings.HUB_DRIVE}/data/${encoded}/`;
}
```

- [ ] **Step 8: Run it and check it passes**

Run: `node --test test/hub-settings.test.js test/hub-sync.test.js`
Expected: PASS (13 tests). If `the hub holds no readable names` fails
because `cryptencode` output or the crypt defaults differ in the installed
rclone, check `rclone help backend crypt`, and confirm `filename_encryption`
defaults to `standard`, not `off`.

- [ ] **Step 9: Write the CLI `tools/drive-sync.mjs`**

```js
#!/usr/bin/env node
// The hub by hand, and what tools/drive-home.mjs runs on each machine.
//
//   node tools/drive-sync.mjs up [--root <dir>] [--epoch <n>] [--force]
//   node tools/drive-sync.mjs down [--root <dir>]
//   node tools/drive-sync.mjs counts [--root <dir>]
//   node tools/drive-sync.mjs state
//   node tools/drive-sync.mjs trash-prefix
//
// Settings from the file MARBLE_HUB_ENV names. --root defaults to
// MARBLE_DRIVE_ROOT. Prints one JSON object; exits 0 whenever it printed one
// (a refusal is {"ok":false,"why":…}), 1 only when something broke.

import { loadHubSettings } from '../server/hub/settings.js';
import { createLeaseClient } from '../server/hub/lease-client.js';
import { down, rcloneEnv, readState, scan, trashPrefix, up } from '../server/hub/sync.js';

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at < 0 ? null : rest[at + 1] ?? true;
};
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

try {
  const root = flag('root') ?? process.env.MARBLE_DRIVE_ROOT;
  if (command === 'counts') {
    print(await scan(root));
  } else {
    const settings = loadHubSettings(process.env.MARBLE_HUB_ENV);
    if (!settings) throw new Error('no hub: set MARBLE_HUB_ENV to the hub settings file');
    if (command === 'up') {
      const epoch = flag('epoch') !== null ? Number(flag('epoch')) : (await createLeaseClient({ settings }).get()).epoch;
      print(await up({ root, settings, epoch, force: flag('force') === true }));
    } else if (command === 'down') {
      print(await down({ root, settings }));
    } else if (command === 'state') {
      print(await readState({ settings, env: await rcloneEnv(settings) }));
    } else if (command === 'trash-prefix') {
      print({ prefix: await trashPrefix({ settings }) });
    } else {
      throw new Error(`unknown command ${command ?? '(none)'}: up, down, counts, state, trash-prefix`);
    }
  }
} catch (err) {
  console.error(`drive-sync: ${err.message}`);
  process.exit(1);
}
```

(`createLeaseClient` arrives in Task 4. Until then, `up` without `--epoch`
fails with a module error. Commit this file together with Task 4's, or pass
`--epoch`.)

- [ ] **Step 10: Commit**

```bash
git add server/hub/settings.js server/hub/sync.js tools/drive-sync.mjs test/hub-settings.test.js test/hub-sync.test.js
git commit -m "The hub: an encrypted copy of a drive, uploaded and downloaded with rclone"
```

---

### Task 4: The lease client, and which mode this machine runs

**Files:**
- Create: `server/hub/lease-client.js`, `tools/home-mode.mjs`
- Test: `test/hub-lease-client.test.js`

**Interfaces:**
- Consumes: `settings` from Task 3; the Worker's HTTP from Task 2.
- Produces:
  - `createLeaseClient({settings, fetchImpl?, cacheFile?, timeoutMs?}) →
    {get(), move(to, epoch), cached()}`. `get` and `move` remember the lease
    in `cacheFile`, which defaults to
    `<dirname(settings.file)>/lease-<HUB_DRIVE>.json`. A failed `move` throws
    an Error carrying `.status` and `.lease`.
  - `decideMode({settings, client}) → {mode:'serve'|'standby', why, lease?}`
  - CLI: `node tools/home-mode.mjs` prints `serve` or `standby`, with the
    reason on stderr.

- [ ] **Step 1: Write the failing test**

```js
// test/hub-lease-client.test.js
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLeaseClient, decideMode } from '../server/hub/lease-client.js';
import { handle, Lease } from '../worker/src/index.js';

// The real Worker code behind a local HTTP server.
async function worker() {
  const objects = new Map();
  const env = {
    LEASE_TOKEN: 'tok',
    LEASE: {
      idFromName: (n) => n,
      get: (id) => {
        if (!objects.has(id)) {
          const m = new Map();
          objects.set(id, new Lease({ storage: { get: async (k) => m.get(k), put: async (k, v) => m.set(k, v) } }));
        }
        return objects.get(id);
      },
    },
  };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const headers = { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' };
    const response = await handle(new Request(`http://x${req.url}`, { method: req.method, headers, body: body || undefined }), env);
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(await response.text());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
async function settingsFor(url, machine = 'mac') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lease-client-'));
  return { HUB_DRIVE: 'bryan', HUB_MACHINE: machine, LEASE_URL: url, LEASE_TOKEN: 'tok', file: path.join(dir, 'hub.env') };
}

test('no hub settings: the drive has one home, so serve', async () => {
  assert.deepEqual(await decideMode({ settings: null, client: null }), { mode: 'serve', why: 'no hub settings: this drive has one home' });
});

test('the lease decides, and is remembered', async () => {
  const w = await worker();
  try {
    const s = await settingsFor(w.url, 'mac');
    const client = createLeaseClient({ settings: s });
    assert.equal((await decideMode({ settings: s, client })).mode, 'standby'); // Fly is home at first
    await client.move('mac', 0);
    assert.equal((await decideMode({ settings: s, client })).mode, 'serve');
    assert.equal((await client.cached()).home, 'mac');
  } finally {
    w.close();
  }
});

test('a move from a stale epoch throws with the status and the lease', async () => {
  const w = await worker();
  try {
    const client = createLeaseClient({ settings: await settingsFor(w.url) });
    await client.move('mac', 0);
    await assert.rejects(client.move('fly', 0), (err) => err.status === 409 && err.lease.home === 'mac');
  } finally {
    w.close();
  }
});

test('offline, the last lease decides', async () => {
  const w = await worker();
  const s = await settingsFor(w.url, 'mac');
  const online = createLeaseClient({ settings: s });
  await online.move('mac', 0);
  w.close();
  const offline = createLeaseClient({ settings: { ...s, LEASE_URL: 'http://127.0.0.1:1' }, cacheFile: path.join(path.dirname(s.file), 'lease-bryan.json'), timeoutMs: 500 });
  const decided = await decideMode({ settings: s, client: offline });
  assert.equal(decided.mode, 'serve');
  assert.match(decided.why, /unreachable.*last one seen/);
});

test('offline with no lease ever seen: standby', async () => {
  const s = await settingsFor('http://127.0.0.1:1', 'mac');
  const decided = await decideMode({ settings: s, client: createLeaseClient({ settings: s, timeoutMs: 500 }) });
  assert.equal(decided.mode, 'standby');
  assert.match(decided.why, /none remembered/);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test test/hub-lease-client.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/hub/lease-client.js`**

```js
// server/hub/lease-client.js
// The lease Worker, from a host or a tool. Every answer is remembered beside
// the hub settings, so a machine that starts with no network (the Mac on a
// plane) goes by the last lease it saw: it serves if that named it. A machine
// that never saw one stays on standby.

import fsp from 'node:fs/promises';
import path from 'node:path';

export function createLeaseClient({
  settings,
  fetchImpl = fetch,
  cacheFile = path.join(path.dirname(settings.file), `lease-${settings.HUB_DRIVE}.json`),
  timeoutMs = 5_000,
}) {
  const base = `${settings.LEASE_URL.replace(/\/$/, '')}/lease/${settings.HUB_DRIVE}`;
  const headers = { authorization: `Bearer ${settings.LEASE_TOKEN}`, 'content-type': 'application/json' };
  const remember = async (lease) => {
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(lease));
    return lease;
  };
  return {
    async get() {
      const res = await fetchImpl(base, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw Object.assign(new Error(`the lease answered ${res.status}`), { status: res.status });
      return remember(await res.json());
    },
    async move(to, epoch) {
      const res = await fetchImpl(`${base}/move`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, epoch }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.why ?? `the lease answered ${res.status}`), { status: res.status, lease: body.lease });
      return remember(body);
    },
    async cached() {
      try {
        return JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
      } catch {
        return null;
      }
    },
  };
}

export async function decideMode({ settings, client }) {
  if (!settings) return { mode: 'serve', why: 'no hub settings: this drive has one home' };
  const verdict = (lease, why) => ({ mode: lease.home === settings.HUB_MACHINE ? 'serve' : 'standby', why, lease });
  try {
    return verdict(await client.get(), 'the lease');
  } catch (err) {
    const lease = await client.cached();
    if (!lease) return { mode: 'standby', why: `the lease is unreachable (${err.message}) and none remembered` };
    return verdict(lease, `the lease is unreachable (${err.message}); going by the last one seen`);
  }
}
```

- [ ] **Step 4: Write `tools/home-mode.mjs`**

```js
#!/usr/bin/env node
// Which way this machine should start its host: `serve` or `standby`
// (tools/sprite/serve.sh asks before every start). Without MARBLE_HUB_ENV the
// drive has one home, so always `serve`. A hub file that cannot be read means
// `standby`: better a drive that waits than two that write.

import { createLeaseClient, decideMode } from '../server/hub/lease-client.js';
import { loadHubSettings } from '../server/hub/settings.js';

let decided;
try {
  const settings = loadHubSettings(process.env.MARBLE_HUB_ENV);
  decided = await decideMode({ settings, client: settings ? createLeaseClient({ settings }) : null });
} catch (err) {
  decided = { mode: 'standby', why: `the hub settings could not be read: ${err.message}` };
}
console.error(`[home] ${decided.mode}: ${decided.why}`);
console.log(decided.mode);
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test test/hub-lease-client.test.js`
Expected: PASS (5 tests).
Run: `MARBLE_HUB_ENV= node tools/home-mode.mjs`
Expected: stdout `serve`, stderr `[home] serve: no hub settings: this drive has one home`.

- [ ] **Step 6: Commit**

```bash
git add server/hub/lease-client.js tools/home-mode.mjs test/hub-lease-client.test.js
git commit -m "Each machine asks the lease whether to serve or stand by, and remembers the answer"
```

---

### Task 5: Standby: a host that writes nothing

**Files:**
- Create: `server/standby.js`
- Modify: `bin/marble-drive.js` (add a `standby` command next to `serve`)
- Test: `test/standby.test.js`

**Interfaces:**
- Consumes: `loadHubSettings` (Task 3), `createLeaseClient().cached()` (Task 4).
- Produces: `createStandby({home, since}) → http.Server`. `GET /health` → `200
  {ok:true, standby:true, home, working:0}`. Every other route → `503` with an
  HTML page and `Retry-After: 30`. CLI: `marble-drive standby`, on
  `config.port` / `config.host`.

Standby must answer `/health` with 200: `release.sh switch` and `apply` roll
back a release whose `/health` does not answer.

- [ ] **Step 1: Write the failing test**

```js
// test/standby.test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStandby } from '../server/standby.js';

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health says standby and where home is; everything else waits', async () => {
  const server = createStandby({ home: 'mac', since: '2026-09-30T10:00:00.000Z' });
  const base = await listen(server);
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, standby: true, home: 'mac', working: 0 });
    const page = await fetch(`${base}/a/Agents`);
    assert.equal(page.status, 503);
    assert.equal(page.headers.get('retry-after'), '30');
    assert.match(await page.text(), /on the Mac right now/);
  } finally {
    server.close();
  }
});

test('the standby command touches nothing in the drive', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'standby-drive-'));
  await fsp.writeFile(path.join(root, 'notes.mrbl'), '<html>notes</html>');
  const before = await fsp.readdir(root, { recursive: true });
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'standby'], {
    env: { ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4497', HOST: '127.0.0.1', MARBLE_HUB_ENV: '' },
    stdio: 'ignore',
  });
  try {
    let ok = false;
    for (let i = 0; i < 40 && !ok; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      ok = await fetch('http://127.0.0.1:4497/health').then((r) => r.ok, () => false);
    }
    assert.ok(ok, 'standby answered /health');
    await fetch('http://127.0.0.1:4497/notes.mrbl');
    assert.deepEqual(await fsp.readdir(root, { recursive: true }), before);
  } finally {
    child.kill('SIGTERM');
  }
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test test/standby.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/standby.js`**

```js
// server/standby.js
// The host on the machine that is not home (docs/superpowers/specs/
// 2026-09-29-mac-home-drive-design.md, piece 3). It never opens the drive. It
// answers /health so a deploy's health check passes, and every other request
// with a page saying where the drive is.

import http from 'node:http';

const WHERE = { mac: 'on the Mac', fly: 'on Fly' };

export function createStandby({ home = null, since = null } = {}) {
  const where = WHERE[home] ?? 'somewhere else';
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>Marble Drive</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#222}
@media (prefers-color-scheme:dark){body{background:#1b1b1a;color:#e8e6e1}}main{max-width:28rem;padding:1rem}</style>
<main><h1>This drive is ${where} right now</h1>
<p>Nothing is lost: it is being served from the other machine${since ? ` since ${since.slice(0, 16).replace('T', ' ')} UTC` : ''}.
This page checks again every 30 seconds.</p></main>`;
  return http.createServer((req, res) => {
    const route = new URL(req.url, 'http://standby').pathname;
    if (route === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, standby: true, home, working: 0 }));
      return;
    }
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30', 'cache-control': 'no-store' });
    res.end(page);
  });
}
```

- [ ] **Step 4: Add the `standby` command to `bin/marble-drive.js`**

In the header comment's command list, after the `serve` line, add:

```js
//   marble-drive standby          the host on a machine that is not this drive's home: writes nothing
```

In the imports, add:

```js
import { createStandby } from '../server/standby.js';
import { createLeaseClient } from '../server/hub/lease-client.js';
import { loadHubSettings } from '../server/hub/settings.js';
```

In the `switch (command)`, after the `case 'serve':` block, add:

```js
  case 'standby':
    await standby();
    break;
```

Next to `async function serve()`, add:

```js
async function standby() {
  const settings = loadHubSettings(config.hubEnv);
  const lease = settings ? await createLeaseClient({ settings }).cached() : null;
  const server = createStandby({ home: lease?.home ?? null, since: lease?.since ?? null });
  server.listen(Number(flags.port ?? config.port), config.host, () => {
    console.log(`[drive] standby on ${config.host}:${flags.port ?? config.port}: this drive's home is ${lease?.home ?? 'elsewhere'}`);
  });
}
```

In `server/config.js`, after `open: bool('MARBLE_DRIVE_OPEN', false),`, add:

```js
    // The hub (server/hub/): a file of settings when this drive has two homes
    // (the owner's Mac and Fly), unset for every other drive. Never defaulted,
    // so a test host or the dev checkout can never upload anything.
    hubEnv: str('MARBLE_HUB_ENV', null),
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test test/standby.test.js test/config.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/standby.js bin/marble-drive.js server/config.js test/standby.test.js
git commit -m "Standby: the host on the machine that is not home, which writes nothing"
```

---

### Task 6: The home host uploads once a minute

**Files:**
- Create: `server/hub/schedule.js`
- Modify: `bin/marble-drive.js` (`serve()`), `server/app.js:596` (`/health`)
- Test: `test/hub-schedule.test.js`

**Interfaces:**
- Consumes: `scan`, `up` (Task 3); `createLeaseClient` (Task 4).
- Produces: `scheduleUploads({root, settings, client, upload?, scanImpl?,
  everyMs?, onLost, log?, schedule?}) → {tick(), stop()}`. `/health` gains
  `working: <number of running turns and stem jobs>`.

- [ ] **Step 1: Write the failing test**

```js
// test/hub-schedule.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleUploads } from '../server/hub/schedule.js';

const settings = { HUB_MACHINE: 'mac' };
function harness({ lease = { home: 'mac', epoch: 2 }, newest = 1000, leaseError = null } = {}) {
  const calls = { uploads: [], lost: [], logs: [] };
  const state = { newest };
  const loop = scheduleUploads({
    root: '/drive',
    settings,
    client: { get: async () => { if (leaseError) throw leaseError; return lease; } },
    scanImpl: async () => ({ files: 5, documents: 2, newest: state.newest }),
    upload: async (args) => { calls.uploads.push(args); return { ok: true, state: { seq: calls.uploads.length }, counts: { files: 5 } }; },
    onLost: (l) => calls.lost.push(l),
    log: (m) => calls.logs.push(m),
    schedule: null,
  });
  return { loop, calls, state };
}

test('a change is uploaded with the epoch the lease is at', async () => {
  const { loop, calls } = harness();
  await loop.tick();
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.uploads[0].epoch, 2);
});

test('nothing changed since the last upload: no upload, no lease call', async () => {
  const { loop, calls, state } = harness();
  await loop.tick();
  state.newest = 500; // older than the upload
  await loop.tick();
  assert.equal(calls.uploads.length, 1);
});

test('a lost lease stops the host and uploads nothing', async () => {
  const { loop, calls } = harness({ lease: { home: 'fly', epoch: 5 } });
  await loop.tick();
  assert.equal(calls.uploads.length, 0);
  assert.deepEqual(calls.lost, [{ home: 'fly', epoch: 5 }]);
});

test('lease unreachable: wait for the next minute, do not upload blind', async () => {
  const { loop, calls } = harness({ leaseError: new Error('offline') });
  await loop.tick();
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.lost.length, 0);
  assert.match(calls.logs.join('\n'), /waits: the lease is unreachable/);
});

test('a refused upload is said, and tried again next minute', async () => {
  const calls = [];
  const loop = scheduleUploads({
    root: '/d', settings, client: { get: async () => ({ home: 'mac', epoch: 0 }) },
    scanImpl: async () => ({ newest: 1 }), upload: async () => ({ ok: false, why: 'the drive has no documents' }),
    onLost: () => {}, log: (m) => calls.push(m), schedule: null,
  });
  await loop.tick();
  await loop.tick();
  assert.equal(calls.filter((m) => /refused: the drive has no documents/.test(m)).length, 2);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test test/hub-schedule.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/hub/schedule.js`**

```js
// server/hub/schedule.js
// The home host keeps the hub current: once a minute, only when something in
// the drive is newer than the last upload, and only while the lease still names
// this machine. A lease that moved means another machine is home, so this
// host stops (onLost) instead of uploading over it. A lease it cannot reach
// means waiting a minute, never uploading blind.

import { scan, up } from './sync.js';

export function scheduleUploads({
  root,
  settings,
  client,
  upload = up,
  scanImpl = scan,
  everyMs = 60_000,
  onLost,
  log = console.log,
  schedule = setInterval,
}) {
  let uploadedAt = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { newest } = await scanImpl(root);
      if (newest <= uploadedAt) return;
      let lease;
      try {
        lease = await client.get();
      } catch (err) {
        log(`[hub] upload waits: the lease is unreachable (${err.message})`);
        return;
      }
      if (lease.home !== settings.HUB_MACHINE) {
        log(`[hub] the lease moved to ${lease.home} (epoch ${lease.epoch}); this host stops`);
        onLost(lease);
        return;
      }
      const started = Date.now();
      const result = await upload({ root, settings, epoch: lease.epoch });
      if (result.ok) {
        uploadedAt = started;
        log(`[hub] uploaded seq ${result.state.seq}: ${result.counts.files} files in ${Date.now() - started}ms`);
      } else {
        log(`[hub] upload refused: ${result.why}`);
      }
    } catch (err) {
      log(`[hub] upload failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = schedule ? schedule(tick, everyMs) : null;
  timer?.unref?.();
  return { tick, stop: () => timer && clearInterval(timer) };
}
```

- [ ] **Step 4: Start it from `serve()` in `bin/marble-drive.js`**

Inside `drive.server.listen(port, config.host, () => {`, after the
`if (config.appUpdates) { … }` block, add:

```js
    // Two homes (the owner's Mac and Fly): keep the hub current, and step down
    // the moment the lease names the other machine. Exit 75 so the keeper
    // (tools/sprite/serve.sh) starts again, asks home-mode.mjs, and comes back
    // as standby.
    const hubSettings = loadHubSettings(config.hubEnv);
    if (hubSettings) {
      scheduleUploads({
        root: config.root,
        settings: hubSettings,
        client: createLeaseClient({ settings: hubSettings }),
        onLost: () => setTimeout(() => process.exit(75), 100),
      });
      console.log(`[drive] hub: uploading ${hubSettings.HUB_DRIVE} from ${hubSettings.HUB_MACHINE} while it is home`);
    }
```

and add the import:

```js
import { scheduleUploads } from '../server/hub/schedule.js';
```

- [ ] **Step 5: Report `working` on `/health`**

Run `ListAgents` first; if another session is editing `server/app.js`, wait
or coordinate. Then change `server/app.js:596` from

```js
      if (route === '/health') return json(res, 200, { ok: true, docs: channels.counts, streams: streams.count, memory: memoryGuard?.reading() ?? null });
```

to

```js
      if (route === '/health') return json(res, 200, { ok: true, docs: channels.counts, streams: streams.count, working: work().length, memory: memoryGuard?.reading() ?? null });
```

(`work` is defined at `server/app.js:244`, above the route handler.)

- [ ] **Step 6: Run the tests**

Run: `node --test test/hub-schedule.test.js test/keep-awake-host.test.js`
Expected: PASS. Then `npm test`. Expected: PASS, apart from the known
load-flaky tests; rerun any failure alone before treating it as real.

- [ ] **Step 7: Commit**

```bash
git add server/hub/schedule.js bin/marble-drive.js server/app.js test/hub-schedule.test.js
git commit -m "The home host keeps the hub current, and steps down when the lease moves"
```

---

### Task 7: Agent projects survive a move between machines

**Files:**
- Modify: `server/agent/projects.js:14-16`
- Test: `test/agent-projects.test.js` (append)

**Interfaces:**
- Produces: `parsePrefixes(text) → [[from, to], …]` and
  `mapProjectPath(p, prefixes) → string`. `registered()` maps each project's
  path through `MARBLE_PROJECT_PREFIXES` (`from=to` pairs, comma-separated),
  read at call time.

- [ ] **Step 1: Write the failing tests** (append to `test/agent-projects.test.js`)

```js
import { mapProjectPath, parsePrefixes } from '../server/agent/projects.js';

test('another machine’s project paths are read as this one’s', () => {
  const prefixes = parsePrefixes('/home/sprite/src=/Users/b/Dev/3rd,/x=/y');
  assert.deepEqual(prefixes, [['/home/sprite/src', '/Users/b/Dev/3rd'], ['/x', '/y']]);
  assert.equal(mapProjectPath('/home/sprite/src/marble-drive', prefixes), '/Users/b/Dev/3rd/marble-drive');
  assert.equal(mapProjectPath('/home/sprite/src', prefixes), '/Users/b/Dev/3rd');
  assert.equal(mapProjectPath('/home/sprite/srcx', prefixes), '/home/sprite/srcx');
  assert.equal(mapProjectPath('/elsewhere', prefixes), '/elsewhere');
  assert.deepEqual(parsePrefixes(''), []);
});

test('listProjects maps paths through MARBLE_PROJECT_PREFIXES', () => {
  const before = process.env.MARBLE_PROJECT_PREFIXES;
  process.env.MARBLE_PROJECT_PREFIXES = '/home/sprite/src=/Users/b/src';
  try {
    const list = listProjects({ settings: { projects: [{ id: 'md', name: 'MD', path: '/home/sprite/src/marble-drive' }] }, root: '/drive' });
    assert.equal(list.find((p) => p.id === 'md').path, '/Users/b/src/marble-drive');
  } finally {
    if (before === undefined) delete process.env.MARBLE_PROJECT_PREFIXES;
    else process.env.MARBLE_PROJECT_PREFIXES = before;
  }
});
```

If `listProjects` is not already imported at the top of that file, add it to
the existing import from `../server/agent/projects.js`.

- [ ] **Step 2: Run them and check they fail**

Run: `node --test test/agent-projects.test.js`
Expected: FAIL, `mapProjectPath` is not exported.

- [ ] **Step 3: Implement**

In `server/agent/projects.js`, replace the `registered` constant with:

```js
// A drive moves between the owner's Mac and Fly (docs/superpowers/specs/
// 2026-09-29-mac-home-drive-design.md, piece 4), and its projects name the
// paths of whichever machine registered them. Each machine lists the other's
// prefixes as its own (MARBLE_PROJECT_PREFIXES=/home/sprite/src=/Users/…), so
// the settings stay as they were written and read right on both.
export const parsePrefixes = (text) =>
  String(text ?? '')
    .split(',')
    .map((pair) => pair.split('='))
    .filter((pair) => pair.length === 2 && pair[0] && pair[1])
    .map(([from, to]) => [from.replace(/\/$/, ''), to.replace(/\/$/, '')]);

export function mapProjectPath(p, prefixes = parsePrefixes(process.env.MARBLE_PROJECT_PREFIXES)) {
  for (const [from, to] of prefixes) {
    if (p === from || p.startsWith(`${from}/`)) return to + p.slice(from.length);
  }
  return p;
}

const registered = (settings) => (Array.isArray(settings?.projects) ? settings.projects : [])
  .filter((p) => p && typeof p.id === 'string' && typeof p.path === 'string')
  .map((p) => ({ id: p.id, name: String(p.name || path.basename(p.path)), path: mapProjectPath(p.path), builtIn: false }));
```

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/agent-projects.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agent/projects.js test/agent-projects.test.js
git commit -m "Agent projects registered on one machine resolve on the other"
```

---

### Task 8: Moving home, with a way back from every step

**Files:**
- Create: `server/hub/move.js`, `server/hub/mac-paths.js`, `tools/drive-home.mjs`
- Test: `test/hub-move.test.js`

**Interfaces:**
- Consumes: `createLeaseClient` (Task 4), the `drive-sync.mjs` CLI (Task 3),
  `/health.working` (Task 6).
- Produces:
  - A **side** is `{working(), stop(), start(), healthy(), upload({epoch}),
    download()}`. `upload` and `download` return the objects `up` and `down`
    return; `healthy()` → true once `/health` answers without `standby`.
  - `moveHome({to, sides:{mac, fly}, client, now?, waitIdleMs?, pollMs?,
    sleep?, log?}) → {ok:true, lease, seconds} | {ok:true, already:true,
    lease} | {ok:false, step, why}`.
  - `macPaths(name, home = os.homedir()) → {root, hubEnv, port, label, app}`.
  - CLI: `node tools/drive-home.mjs to <mac|fly> [--drive bryan]
    [--sprite admin-p2] [--now]`.

The order is: wait for idle → stop the leaving host → final upload → move the
lease → download on the arriving side → verify counts → start the arriving
host → start the leaving host (which comes up as standby).

- [ ] **Step 1: Write the failing test**

```js
// test/hub-move.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { macPaths } from '../server/hub/mac-paths.js';
import { moveHome } from '../server/hub/move.js';

function side(name, log, overrides = {}) {
  return {
    working: async () => 0,
    stop: async () => log.push(`${name}.stop`),
    start: async () => log.push(`${name}.start`),
    healthy: async () => true,
    upload: async ({ epoch }) => { log.push(`${name}.upload@${epoch}`); return { ok: true, state: { files: 5, documents: 2 } }; },
    download: async () => { log.push(`${name}.download`); return { ok: true, matches: true, state: { files: 5, documents: 2 }, counts: { files: 5, documents: 2 } }; },
    ...overrides,
  };
}
function lease(initial = { home: 'fly', epoch: 0 }) {
  let current = { ...initial };
  return {
    get current() { return current; },
    get: async () => current,
    move: async (to, epoch) => {
      if (epoch !== current.epoch) throw Object.assign(new Error('stale'), { status: 409, lease: current });
      current = { home: to, epoch: current.epoch + 1 };
      return current;
    },
  };
}
const quick = { sleep: async () => {}, pollMs: 0, log: () => {} };

test('a move runs in order and ends with the lease on the new home', async () => {
  const log = [];
  const client = lease();
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly: side('fly', log) }, client, ...quick });
  assert.equal(result.ok, true);
  assert.deepEqual(log, ['fly.stop', 'fly.upload@0', 'mac.download', 'mac.start', 'fly.start']);
  assert.deepEqual(client.current, { home: 'mac', epoch: 1 });
});

test('already there: nothing moves', async () => {
  const log = [];
  const result = await moveHome({ to: 'fly', sides: { mac: side('mac', log), fly: side('fly', log) }, client: lease(), ...quick });
  assert.equal(result.already, true);
  assert.deepEqual(log, []);
});

test('an agent working the whole time: nothing moves', async () => {
  const log = [];
  const fly = side('fly', log, { working: async () => 1 });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), waitIdleMs: 0, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'idle']);
  assert.deepEqual(log, []);
});

test('--now does not wait for agents', async () => {
  const log = [];
  const fly = side('fly', log, { working: async () => 3 });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client: lease(), now: true, ...quick });
  assert.equal(result.ok, true);
});

test('a refused final upload restarts the old home and leaves the lease', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, { upload: async () => ({ ok: false, why: 'the drive has no documents' }) });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'upload']);
  assert.deepEqual(log, ['fly.stop', 'fly.start']);
  assert.deepEqual(client.current, { home: 'fly', epoch: 0 });
});

test('a lease that moved underneath aborts and restores the old home', async () => {
  const log = [];
  const client = lease();
  const fly = side('fly', log, {
    upload: async () => { await client.move('fly', 0); return { ok: true, state: {} }; }, // someone else moved it
  });
  const result = await moveHome({ to: 'mac', sides: { mac: side('mac', log), fly }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'lease']);
  assert.ok(log.at(-1) === 'fly.start');
  assert.equal(client.current.home, 'fly');
});

test('counts that do not match after download hand the lease back', async () => {
  const log = [];
  const client = lease();
  const mac = side('mac', log, {
    download: async () => ({ ok: true, matches: false, state: { files: 5, documents: 2 }, counts: { files: 4, documents: 2 } }),
  });
  const result = await moveHome({ to: 'mac', sides: { mac, fly: side('fly', log) }, client, ...quick });
  assert.deepEqual([result.ok, result.step], [false, 'verify']);
  assert.match(result.why, /hub 5\/2, here 4\/2/);
  assert.deepEqual(client.current, { home: 'fly', epoch: 2 });
  assert.deepEqual(log.slice(-2), ['mac.start', 'fly.start']);
});

test('where each drive lives on the Mac', () => {
  assert.deepEqual(macPaths('bryan', '/Users/b'), {
    root: '/Users/b/Marble Drive',
    hubEnv: '/Users/b/.config/marble-drive/hub-bryan.env',
    port: 4401,
    label: 'com.marble.drive.home.bryan',
    app: '/Users/b/Library/Application Support/Marble Drive/app',
  });
  assert.equal(macPaths('t-bryan', '/Users/b').root, '/Users/b/Marble Drive (t-bryan)');
  assert.equal(macPaths('t-bryan', '/Users/b').port, 4402);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test test/hub-move.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/hub/mac-paths.js`**

```js
// server/hub/mac-paths.js
// Where a drive lives on the owner's Mac, by name. The real drive (bryan) is
// "~/Marble Drive" on 4401; a trial drive (t-bryan) sits beside it on 4402.
// macos/launchd/home.sh follows the same names.

import os from 'node:os';
import path from 'node:path';

export function macPaths(name, home = os.homedir()) {
  return {
    root: path.join(home, name === 'bryan' ? 'Marble Drive' : `Marble Drive (${name})`),
    hubEnv: path.join(home, '.config', 'marble-drive', `hub-${name}.env`),
    port: name === 'bryan' ? 4401 : 4402,
    label: `com.marble.drive.home.${name}`,
    app: path.join(home, 'Library', 'Application Support', 'Marble Drive', 'app'),
  };
}
```

- [ ] **Step 4: Write `server/hub/move.js`**

```js
// server/hub/move.js
// Moving a drive's home (docs/superpowers/specs/2026-09-29-mac-home-drive-design.md,
// piece 5). The leaving host stops before its last upload, so the upload is
// the whole of it; the lease moves only after that upload, and the arriving
// host starts only after its download matches. Any failure before the
// arriving host serves puts things back: the lease where it was, the old home
// serving. Nothing here deletes anything.

const fail = (step, why) => ({ ok: false, step, why });

export async function moveHome({
  to,
  sides,
  client,
  now = false,
  waitIdleMs = 10 * 60_000,
  pollMs = 5_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}) {
  const from = to === 'mac' ? 'fly' : 'mac';
  const leaving = sides[from];
  const arriving = sides[to];
  const started = Date.now();

  const lease = await client.get();
  if (lease.home === to) return { ok: true, already: true, lease };

  if (!now) {
    const deadline = Date.now() + waitIdleMs;
    for (;;) {
      const working = await leaving.working();
      if (working === 0) break;
      if (Date.now() >= deadline) return fail('idle', `an agent was working on ${from} the whole time; nothing moved (use --now to stop it)`);
      log(`[move] waiting: ${working} running on ${from}`);
      await sleep(pollMs);
    }
  }

  log(`[move] stopping ${from}`);
  await leaving.stop();
  const upload = await leaving.upload({ epoch: lease.epoch }).catch((err) => ({ ok: false, why: err.message }));
  if (!upload.ok) {
    await leaving.start();
    return fail('upload', `the last upload from ${from} did not happen (${upload.why}); ${from} is serving again`);
  }

  let moved;
  try {
    moved = await client.move(to, lease.epoch);
  } catch (err) {
    await leaving.start();
    return fail('lease', `the lease could not move (${err.message}); ${from} is serving again`);
  }

  const handBack = async (step, why) => {
    await client.move(from, moved.epoch).catch((err) => log(`[move] could not hand the lease back: ${err.message}`));
    await arriving.start().catch(() => {});
    await leaving.start();
    return fail(step, `${why}; the lease is back on ${from}, which is serving again`);
  };

  log(`[move] downloading on ${to}`);
  const down = await arriving.download().catch((err) => ({ ok: false, why: err.message }));
  if (!down.ok) return handBack('download', `the download on ${to} failed (${down.why})`);
  if (!down.matches) {
    return handBack('verify', `counts differ: hub ${down.state.files}/${down.state.documents}, here ${down.counts.files}/${down.counts.documents}`);
  }
  await arriving.start();
  if (!(await arriving.healthy())) return handBack('start', `${to} did not come up as home`);
  await leaving.start();
  return { ok: true, lease: moved, seconds: Math.round((Date.now() - started) / 1000) };
}
```

In `handBack`, `arriving.start()` restarts the arriving host after the lease
went back, so it comes up as standby again. The lease test in Step 1 expects
epoch 2 after a hand-back (0 → 1 on the move, 1 → 2 back).

- [ ] **Step 5: Run it and check it passes**

Run: `node --test test/hub-move.test.js`
Expected: PASS (8 tests).

- [ ] **Step 6: Write `tools/drive-home.mjs`, with the real sides**

```js
#!/usr/bin/env node
// Move a drive's home between the owner's Mac and its sprite
// (docs/HOSTING.md, "The owner's drive on the Mac").
//
//   node tools/drive-home.mjs to <mac|fly> [--drive bryan] [--sprite admin-p2] [--now]
//
// Runs on the Mac. Waits (up to 10 minutes) until no agent is working on the
// side it leaves, unless --now. Prints each step, then where the drive is.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { createLeaseClient } from '../server/hub/lease-client.js';
import { macPaths } from '../server/hub/mac-paths.js';
import { moveHome } from '../server/hub/move.js';
import { loadHubSettings } from '../server/hub/settings.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const to = args[0] === 'to' ? args[1] : null;
if (!['mac', 'fly'].includes(to)) {
  console.error('usage: node tools/drive-home.mjs to <mac|fly> [--drive bryan] [--sprite admin-p2] [--now]');
  process.exit(2);
}
const drive = flag('drive', 'bryan');
const sprite = flag('sprite', drive === 'bryan' ? 'admin-p2' : drive);
const mac = macPaths(drive);
const settings = loadHubSettings(mac.hubEnv);
if (!settings) {
  console.error(`drive-home: no hub settings at ${mac.hubEnv}`);
  process.exit(1);
}

const json = (stdout) => JSON.parse(stdout.trim().split('\n').pop());
const healthy = async (read) => {
  for (let i = 0; i < 60; i += 1) {
    const health = await read().catch(() => null);
    if (health?.ok && !health.standby) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

function macSide() {
  const tool = path.join(mac.app, 'current', 'marble-drive', 'tools', 'drive-sync.mjs');
  const env = { ...process.env, MARBLE_HUB_ENV: mac.hubEnv };
  const home = path.join(import.meta.dirname, '..', 'macos', 'launchd', 'home.sh');
  const health = async () => (await fetch(`http://127.0.0.1:${mac.port}/health`)).json();
  return {
    working: async () => (await health()).working ?? 0,
    stop: () => run('/bin/zsh', [home, 'stop', drive]),
    start: () => run('/bin/zsh', [home, 'start', drive]),
    healthy: () => healthy(health),
    upload: async ({ epoch }) => json((await run(process.execPath, [tool, 'up', '--root', mac.root, '--epoch', String(epoch)], { env })).stdout),
    download: async () => json((await run(process.execPath, [tool, 'down', '--root', mac.root], { env })).stdout),
  };
}

function flySide() {
  const sh = (command) => run('sprite', ['exec', '-o', 'marble-drive', '-s', sprite, '--', 'bash', '-lc', command], { maxBuffer: 8 << 20 });
  const tool = 'cd ~/app/current/marble-drive && MARBLE_HUB_ENV=~/.config/marble-drive/hub.env node tools/drive-sync.mjs';
  const health = async () => json((await sh('curl -fsS 127.0.0.1:4400/health')).stdout);
  return {
    working: async () => (await health()).working ?? 0,
    stop: () => sh('sprite-env services stop marble-drive'),
    start: () => sh('bash ~/app/release.sh apply'),
    healthy: () => healthy(health),
    upload: async ({ epoch }) => json((await sh(`${tool} up --root /drive --epoch ${epoch}`)).stdout),
    download: async () => json((await sh(`${tool} down --root /drive`)).stdout),
  };
}

const result = await moveHome({
  to,
  sides: { mac: macSide(), fly: flySide() },
  client: createLeaseClient({ settings }),
  now: args.includes('--now'),
});
if (result.already) console.log(`${drive} is already at home on ${to} (epoch ${result.lease.epoch})`);
else if (result.ok) console.log(`${drive} is at home on ${to} (epoch ${result.lease.epoch}), moved in ${result.seconds}s`);
else {
  console.error(`drive-home: stopped at ${result.step}: ${result.why}`);
  process.exit(1);
}
```

- [ ] **Step 7: Commit**

```bash
git add server/hub/move.js server/hub/mac-paths.js tools/drive-home.mjs test/hub-move.test.js
git commit -m "drive-home: move a drive between the Mac and Fly, and put it back if any step fails"
```

---

### Task 9: The Mac runs releases; the sprites get rclone

**Files:**
- Create: `tools/mac-release.sh`, `macos/launchd/home.sh`,
  `macos/launchd/com.marble.drive.home.plist.in`, `tools/sprite/rclone-version`
- Modify: `tools/sprite/serve.sh` (ask home-mode.mjs), `tools/sprite/release.sh`
  (install rclone once)

**Interfaces:**
- Consumes: `macPaths` naming (Task 8); `tools/home-mode.mjs` (Task 4).
- Produces:
  - `tools/mac-release.sh [--ref <commit>]` builds
    `<app>/releases/<utc>-<sha7>`, smoke-tests it on 4498, points
    `<app>/current` at it, keeps the last 3, and restarts every installed home
    service.
  - `macos/launchd/home.sh <install|start|stop|restart|status|logs|uninstall> [<name>]`
    (default name `bryan`).
  - `serve.sh` runs `bin/marble-drive.js standby` when `home-mode.mjs` says so.

- [ ] **Step 1: Pin rclone for the sprites**

Write the Mac's version from Task 3, Step 0, without the `v`, e.g.:

```bash
rclone version | head -1 | sed -E 's/^rclone v//' > tools/sprite/rclone-version
cat tools/sprite/rclone-version
```

- [ ] **Step 2: Install rclone on sprites in `release.sh stage`**

In `tools/sprite/release.sh`, in `stage()`, after the Chromium lines
(`"$NODE" "$playwright" install chromium >/dev/null`) and before the browser
launch check, add:

```bash
  # The hub (server/hub/sync.js) runs rclone. One pinned copy per sprite in
  # ~/.local/bin, fetched when missing or when the pin moves.
  local rclone_want
  rclone_want="$(tr -d '[:space:]' < tools/sprite/rclone-version 2>/dev/null || true)"
  if [[ -n "$rclone_want" ]] && [[ "$("$HOME/.local/bin/rclone" version 2>/dev/null | head -1)" != "rclone v$rclone_want" ]]; then
    say "installing rclone $rclone_want"
    local arch zip
    case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) die "no rclone for $(uname -m)" ;; esac
    zip="$(mktemp -d)"
    curl -fsSL "https://downloads.rclone.org/v$rclone_want/rclone-v$rclone_want-linux-$arch.zip" -o "$zip/rclone.zip"
    python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$zip/rclone.zip" "$zip"
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$zip/rclone-v$rclone_want-linux-$arch/rclone" "$HOME/.local/bin/rclone"
    rm -rf "$zip"
  fi
```

`SERVICE_PATH` already includes `$HOME/.local/bin`, so the host finds it.

- [ ] **Step 3: Make `serve.sh` ask which mode to start in**

In `tools/sprite/serve.sh`, replace the line

```bash
  "$NODE" --report-on-fatalerror --report-directory="$CRASH_DIR" bin/marble-drive.js serve &
```

with

```bash
  # Two homes (the owner's Mac and Fly): the lease says whether this machine
  # serves the drive or stands by (tools/home-mode.mjs). Every other drive has
  # no MARBLE_HUB_ENV and always serves.
  mode=serve
  if [[ -n "${MARBLE_HUB_ENV:-}" ]]; then
    mode="$("$NODE" tools/home-mode.mjs 2>>"$CRASH_LOG" || echo standby)"
    [[ "$mode" == serve || "$mode" == standby ]] || mode=standby
  fi
  "$NODE" --report-on-fatalerror --report-directory="$CRASH_DIR" bin/marble-drive.js "$mode" &
```

and in the header comment add one line:

```bash
# With MARBLE_HUB_ENV set it asks tools/home-mode.mjs before every start, so a
# host whose lease moved (it exits 75) comes back as standby.
```

- [ ] **Step 4: Write the launchd template**
  `macos/launchd/com.marble.drive.home.plist.in`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- The owner's drive on this Mac, run from a release (tools/mac-release.sh)
     through the same keeper a sprite uses. Rendered by macos/launchd/home.sh. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>@LABEL@</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>tools/sprite/serve.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>@APP@/current/marble-drive</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>@HOME@/Library/Logs/marble-drive/home-@NAME@.log</string>
  <key>StandardErrorPath</key>
  <string>@HOME@/Library/Logs/marble-drive/home-@NAME@.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>@HOME@</string>
    <key>PATH</key><string>@APP@/current/marble-drive/node_modules/.bin:@NODE_DIR@:@HOME@/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>MARBLE_DRIVE_ROOT</key><string>@ROOT@</string>
    <key>PORT</key><string>@PORT@</string>
    <key>HOST</key><string>127.0.0.1</string>
    <key>MARBLE_DRIVE_AGENTS</key><string>1</string>
    <key>MARBLE_DRIVE_AGENT_KEYS</key><string>@HOME@/.config/marble-drive/agent-keys</string>
    <key>MARBLE_HUB_ENV</key><string>@HUB_ENV@</string>
    <key>MARBLE_PROJECT_PREFIXES</key><string>/home/sprite/src=@SRC@</string>
    <key>MARBLE_SERVE_CRASH_DIR</key><string>@HOME@/Library/Logs/marble-drive/home-@NAME@-crash</string>
  </dict>
</dict>
</plist>
```

- [ ] **Step 5: Write `macos/launchd/home.sh`**

```zsh
#!/bin/zsh
# The owner's drive on this Mac, under launchd (docs/HOSTING.md, "The owner's
# drive on the Mac"). Names match server/hub/mac-paths.js.
#
#   macos/launchd/home.sh install [<name>]   render and start (name: bryan, or t-bryan for the trial)
#   macos/launchd/home.sh start|stop|restart [<name>]
#   macos/launchd/home.sh status|logs|uninstall [<name>]
#
# It runs whatever tools/mac-release.sh made current. Whether it serves the
# drive or stands by is the lease's call (tools/home-mode.mjs), not this
# script's.

set -u
emulate -L zsh

name="${2:-bryan}"
repo="${0:A:h:h:h}"
app="$HOME/Library/Application Support/Marble Drive/app"
label="com.marble.drive.home.$name"
plist="$HOME/Library/LaunchAgents/$label.plist"
template="$repo/macos/launchd/com.marble.drive.home.plist.in"
domain="gui/$(id -u)"
if [[ $name == bryan ]]; then root="$HOME/Marble Drive"; port=4401; else root="$HOME/Marble Drive ($name)"; port=4402; fi
hub_env="$HOME/.config/marble-drive/hub-$name.env"
log="$HOME/Library/Logs/marble-drive/home-$name.log"

health() { curl -fsS --max-time 3 "http://127.0.0.1:$port/health" 2>/dev/null }
pid_of() { launchctl print "$domain/$label" 2>/dev/null | awk -F'= ' '/^[[:space:]]*pid = /{print $2; exit}' }

render() {
  [[ -L "$app/current" ]] || { print -u2 "home: no release yet: run tools/mac-release.sh"; return 1 }
  mkdir -p "${plist:h}" "${log:h}" "$root"
  sed -e "s#@LABEL@#$label#g" -e "s#@APP@#$app#g" -e "s#@HOME@#$HOME#g" -e "s#@NAME@#$name#g" \
      -e "s#@ROOT@#$root#g" -e "s#@PORT@#$port#g" -e "s#@HUB_ENV@#$hub_env#g" \
      -e "s#@NODE_DIR@#${$(command -v node):h}#g" -e "s#@SRC@#${repo:h}#g" "$template" > "$plist"
  plutil -lint "$plist" >/dev/null || { print -u2 "home: rendered plist is not valid"; return 1 }
}
boot_out() {
  launchctl bootout "$domain/$label" 2>/dev/null
  repeat 40 do [[ -z $(pid_of) ]] && break; sleep 0.25; done
}
boot_in() {
  launchctl enable "$domain/$label" 2>/dev/null
  launchctl bootstrap "$domain" "$plist" || return 1
  repeat 60 do [[ -n $(health) ]] && { print -r -- "$name on http://127.0.0.1:$port: $(health)"; return 0 }; sleep 0.5; done
  print -u2 "home: started, but /health did not answer; see $log"; return 1
}

case "${1:-status}" in
  install|start|restart) boot_out; render && boot_in ;;
  stop) boot_out; print -r -- "$name stopped (start: macos/launchd/home.sh start $name)" ;;
  status) print -r -- "$label pid ${$(pid_of):-—} port $port root $root"; print -r -- "health ${$(health):-no answer}" ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall) boot_out; rm -f "$plist"; print -r -- "$name uninstalled; the drive at $root is untouched" ;;
  *) print -u2 "usage: home.sh <install|start|stop|restart|status|logs|uninstall> [<name>]"; exit 2 ;;
esac
```

- [ ] **Step 6: Write `tools/mac-release.sh`**

```bash
#!/usr/bin/env bash
# Build a release of marble-drive on this Mac and switch the owner's drive to
# it: the Mac's counterpart of tools/sprite/release.sh (docs/HOSTING.md, "The
# owner's drive on the Mac"). The same sources a sprite runs: marble-drive at
# --ref (default origin/main), @bdhmin/marble at ../marble's version from npm,
# Claude Code at tools/sprite/claude-version.
#
#   tools/mac-release.sh [--ref <commit>]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
APP="$HOME/Library/Application Support/Marble Drive/app"
REF=origin/main
[[ "${1:-}" == --ref ]] && REF=$2
say() { printf '==> %s\n' "$*"; }
die() { printf 'mac-release: %s\n' "$*" >&2; exit 1; }

git -C "$REPO" fetch -q origin
SHA="$(git -C "$REPO" rev-parse "$REF")"
MARBLE_VERSION="$(node -p "require('$REPO/../marble/package.json').version")"
CLAUDE_VERSION="$(tr -d '[:space:]' <"$HERE/sprite/claude-version")"
NAME="$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:7}"
DIR="$APP/releases/$NAME/marble-drive"
mkdir -p "$DIR"
trap 'rm -rf "$APP/releases/$NAME"' EXIT

say "marble-drive $SHA, marble $MARBLE_VERSION, claude $CLAUDE_VERSION"
git -C "$REPO" archive "$SHA" | tar -x -C "$DIR"
cd "$DIR"
npm pkg delete dependencies.@bdhmin/marble
npm install --omit=dev --no-audit --no-fund --loglevel=error "@bdhmin/marble@$MARBLE_VERSION" "@anthropic-ai/claude-code@$CLAUDE_VERSION"
[[ "$(node_modules/.bin/claude --version 2>/dev/null)" == "$CLAUDE_VERSION"* ]] || die "claude $CLAUDE_VERSION did not install"
npx --no-install playwright install chromium >/dev/null

say "smoke test on :4498 with a throwaway drive"
scratch="$(mktemp -d)"
MARBLE_DRIVE_ROOT="$scratch" PORT=4498 HOST=127.0.0.1 MARBLE_DRIVE_AGENTS=0 node bin/marble-drive.js serve >"$scratch.log" 2>&1 &
pid=$!
ok=0
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:4498/health >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
[[ $ok == 1 ]] || { tail -30 "$scratch.log" >&2; rm -rf "$scratch" "$scratch.log"; die "release $NAME did not answer /health"; }
rm -rf "$scratch" "$scratch.log"
trap - EXIT

ln -sfn "$APP/releases/$NAME" "$APP/current"
echo "$NAME" >>"$APP/history"
keep="$( (tail -3 "$APP/history"; echo "$NAME") | sort -u)"
for old in $(ls -1 "$APP/releases"); do grep -qx "$old" <<<"$keep" || rm -rf "${APP:?}/releases/$old"; done
say "current: $NAME"
for plist in "$HOME"/Library/LaunchAgents/com.marble.drive.home.*.plist; do
  [[ -e "$plist" ]] || continue
  name="${plist##*/com.marble.drive.home.}"; name="${name%.plist}"
  /bin/zsh "$REPO/macos/launchd/home.sh" restart "$name"
done
```

- [ ] **Step 7: Check the scripts by hand**

Run: `bash -n tools/mac-release.sh && zsh -n macos/launchd/home.sh && bash -n tools/sprite/serve.sh tools/sprite/release.sh && echo ok`
Expected: `ok`.
Run: `tools/mac-release.sh`
Expected: `==> current: <utc>-<sha7>`, and
`ls "$HOME/Library/Application Support/Marble Drive/app/current/marble-drive/bin"`
shows `marble-drive.js`. No home service is installed yet, so nothing
restarts.

- [ ] **Step 8: Commit**

```bash
chmod +x tools/mac-release.sh macos/launchd/home.sh tools/drive-home.mjs tools/drive-sync.mjs tools/home-mode.mjs
git add tools/mac-release.sh macos/launchd/home.sh macos/launchd/com.marble.drive.home.plist.in tools/sprite/rclone-version tools/sprite/serve.sh tools/sprite/release.sh tools/drive-home.mjs tools/drive-sync.mjs tools/home-mode.mjs
git commit -m "The Mac runs releases of the owner's drive under launchd; sprites carry rclone"
```

---

### Task 10: Set up, try it on t-bryan, move bryan, and write it down

This task is done **with the owner**. Steps marked **(owner)** hand over
secrets or accounts, and the agent never types, prints or reads a secret. Any
step with `sprite exec` into admin-p2 or t-bryan follows CLAUDE.md.

**Files:**
- Modify: `docs/HOSTING.md`, `docs/HOSTING-DECISIONS.md`, `CLAUDE.md`,
  `docs/superpowers/specs/2026-09-29-mac-home-drive-design.md`

- [ ] **Step 1: Amend the spec for the offline case**

In the spec, piece 3, replace
`A host also stays on standby when it cannot confirm it holds the lease.` with:

```markdown
A host that cannot reach the lease goes by the last lease it saw (kept beside
its hub settings): it serves if that named it, so the Mac starts on a plane.
A host that never saw a lease stays on standby.
```

- [ ] **Step 2: Push, and deploy the code to t-bryan**

```bash
npm test
git push origin main
tools/sprite-deploy.sh t-bryan
```

Expected: tests PASS (known load-flaky tests rerun alone), and the deploy
ends `live: …` with an `installing rclone …` line. t-bryan has no hub settings
yet, so it serves as before. Say to check `https://t-bryan-b3fwm.sprites.app`
opens normally.

- [ ] **Step 3 (owner): Cloudflare account, bucket, key, Worker**

The owner, in a terminal on the Mac:
1. Makes a Cloudflare account, then creates an R2 bucket `marble-drives` and an
   R2 API token with **Object Read & Write** on that bucket only. He notes the
   account id, access key id and secret.
2. `cd worker && npx wrangler@latest login && npx wrangler@latest deploy`.
   Note the `https://marble-lease.<account>.workers.dev` URL.
3. `openssl rand -hex 32` as the lease token, then
   `npx wrangler@latest secret put LEASE_TOKEN` and paste it.
4. Makes a hub passphrase and a salt (two `openssl rand -base64 24`), and
   saves both, with the token and the R2 keys, in his password manager.

- [ ] **Step 4 (owner): Hub settings on the Mac and on t-bryan**

On the Mac, `~/.config/marble-drive/hub-t-bryan.env` (then `chmod 600`):

```
HUB_DRIVE=t-bryan
HUB_MACHINE=mac
R2_ACCOUNT_ID=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=marble-drives
HUB_PASSPHRASE=…
HUB_SALT=…
LEASE_URL=https://marble-lease.<account>.workers.dev
LEASE_TOKEN=…
```

On t-bryan, the same with `HUB_MACHINE=fly`, at
`~/.config/marble-drive/hub.env` (mode 600). The owner first saves that copy
on the Mac as `~/.config/marble-drive/hub-t-bryan.env.fly` (`chmod 600`),
then writes it from a Mac terminal: `sprite exec -o marble-drive -s t-bryan -- bash -c 'umask 077;
cat > ~/.config/marble-drive/hub.env' < ~/.config/marble-drive/hub-t-bryan.env.fly`.
Then he adds two lines to t-bryan's `~/.config/marble-drive/sprite.env`:

```
MARBLE_HUB_ENV=/home/sprite/.config/marble-drive/hub.env
MARBLE_PROJECT_PREFIXES=/Users/bryanmin/Development/3rd-year-projects=/home/sprite/src
```

and runs `sprite exec -o marble-drive -s t-bryan -- bash ~/app/release.sh apply`.

Check (agent): `sprite exec -o marble-drive -s t-bryan -- bash -lc 'curl -fsS 127.0.0.1:4400/health'`
shows no `standby` (the lease says Fly), and within two minutes
`MARBLE_HUB_ENV=~/.config/marble-drive/hub-t-bryan.env node tools/drive-sync.mjs state`
on the Mac prints `{"home":"fly","epoch":0,"seq":1,…}`.

- [ ] **Step 5: The trash lifecycle rule**

Run: `MARBLE_HUB_ENV=~/.config/marble-drive/hub-t-bryan.env node tools/drive-sync.mjs trash-prefix`
It prints `{"prefix":"t-bryan/data/<encoded>/"}`. **(owner)** In the
Cloudflare dashboard, the bucket gets a lifecycle rule that deletes objects
under that prefix after 7 days. The same again for `bryan` in Step 9.

- [ ] **Step 6: Move t-bryan to the Mac, and back**

```bash
zsh macos/launchd/home.sh install t-bryan      # comes up as standby: the lease says fly
node tools/drive-home.mjs to mac --drive t-bryan
```

Expected: `t-bryan is at home on mac (epoch 1), moved in <n>s`. Then:
- `open http://127.0.0.1:4402` shows t-bryan's drive, and a new note made
  there appears in `drive-sync state` as a higher `seq` within about a minute.
- `https://t-bryan-b3fwm.sprites.app` shows "This drive is on the Mac right now".
- `node tools/drive-home.mjs to fly --drive t-bryan` moves it back. The note
  is on the sprite URL.

Write down the seconds each move took, for the docs.

- [ ] **Step 7: Try the failure paths on t-bryan**

- With `~/Marble Drive (t-bryan)` temporarily renamed away, then an empty
  folder in its place: `drive-home to fly` must stop at `upload` with "no
  documents", and the lease must stay on mac. Put the folder back.
- With the Mac offline (Wi-Fi off): `home.sh restart t-bryan` must come up
  serving (the last lease named mac), and `~/Library/Logs/marble-drive/home-t-bryan.log`
  must show `[hub] upload waits: the lease is unreachable`.

- [ ] **Step 8: Write it down**

- `docs/HOSTING.md`: in "The shape", the Mac as the owner's home and admin-p2
  as standby. A new section, "The owner's drive on the Mac": the hub (where,
  what's excluded, encryption, trash), the lease Worker, standby,
  `home.sh`, `mac-release.sh`, `drive-home`, the settings files and what is in
  them (names only, never values), and the move times from Step 6. Plus
  troubleshooting rows: "standby page on the sprite URL" (the Mac is home: use
  4401), "upload refused" (a drive that looks empty), "lease unreachable"
  (Worker or network). The tools table gains `drive-home`, `drive-sync`,
  `mac-release.sh`, `home.sh`.
- `docs/HOSTING-DECISIONS.md`: a new decision, "26. The owner's drive lives on
  the Mac; Fly stands by through R2", which amends 24, with the spec's table
  of what was chosen and what was set aside.
- `CLAUDE.md`, "Where it runs": admin-p2 becomes "the owner's standby and
  workshop; his drive is at home on his Mac (`tools/drive-home.mjs`)". Under
  "Shipping a change", step 5 gains "then `tools/mac-release.sh`, so the Mac
  runs what admin-p2 runs".

```bash
git add docs/HOSTING.md docs/HOSTING-DECISIONS.md CLAUDE.md docs/superpowers/specs/2026-09-29-mac-home-drive-design.md
git commit -m "Hosting: the owner's drive at home on the Mac, and how it moves"
git push origin main
```

- [ ] **Step 9: Move bryan (only when the owner says to)**

1. `tools/sprite-deploy.sh admin-p2` (from the Mac), so admin-p2 carries
   rclone and the standby code.
2. **(owner)** `hub-bryan.env` on the Mac, `hub.env` on admin-p2, and the two
   `sprite.env` lines, exactly as in Step 4 with `HUB_DRIVE=bryan`. Then
   `release.sh apply` on admin-p2. Check that admin-p2 still serves and the
   first upload lands (`drive-sync state` shows `home: fly`, seq ≥ 1). That
   first upload is 2.2 GB, from inside Fly.
3. `macos/launchd/backup.sh uninstall`. The backup agent re-points
   `~/Marble Drive` on every run, and from here the hub replaces it.
   `~/Marble Backups/` stays as it is.
4. Make `~/Marble Drive` a real folder, seeded from the last backup so the
   download moves only a delta:
   ```bash
   last="$(readlink "$HOME/Marble Drive")"
   rm "$HOME/Marble Drive"                    # the link only
   rsync -a "$last/" "$HOME/Marble Drive/"
   rm -f "$HOME/Marble Drive/.marble/sync.json"
   ```
5. Step 5's lifecycle rule for `bryan`.
6. `zsh macos/launchd/home.sh install bryan` (standby), then
   `node tools/drive-home.mjs to mac`. Expected: `bryan is at home on mac`.
   This waits for agents on admin-p2 to finish. **Do not run it from a
   conversation hosted on admin-p2**: it stops that host.
7. Say what to look at: `http://127.0.0.1:4401` is the owner's drive. The
   admin-p2 URL shows the standby page. Console, if he wants it on the Mac,
   needs `MARBLE_DRIVE_CONSOLE=1` added to the plist env (phase 2 revisits
   this).

- [ ] **Step 10: Report**

What moved, the move times, the first-upload size and time, anything that
failed, and what phase 2 (the `marbledrive.app` front door) needs from the
owner: moving the Porkbun nameservers to Cloudflare.

---

## Not in this plan (later phases, from the spec)

- Phase 2: `marbledrive.app` nameservers, the routing Worker, the Mac's
  tunnel, `MARBLE_PUBLIC_HOST`, host-only cookies, friends at
  `<name>.marbledrive.app`, the cron ping on the new address.
- Phase 3: heartbeat, the sleep helper, lazy takeover, the set-aside on wake,
  and keeping the Mac awake while an agent works.
- Phase 4: Claude sessions and uncommitted code in the hub.
- Console's "Move to Mac / Move to Fly" and hub status (after phase 3, when
  moves can happen without a terminal).
