# Accounts, phase 1: sign in with Google or GitHub, and invited people make their own drive

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person with an invite link signs in at `marbledrive.app` with Google or GitHub, names a drive, and is in it at `<name>.marbledrive.app` a few minutes later, with no step by the owner. Existing drives accept the same sign-in beside their passphrase, and move over one at a time without anyone being locked out.

**Architecture:** The lease Worker gains a third job, the **door** (`worker/src/door/`): an accounts **Directory** in a Durable Object (key-value API, like `Lease`), Google and GitHub sign-in, invite links, the sign-up pages, and Ed25519-signed **passes** per drive minted at `/_marble/enter`. The router (`worker/src/router.js`) reads drives from the Directory, refuses requests without a pass before they wake a sprite, and passes share links through. Each drive verifies the same pass with a public key (`server/door.js`) and treats it as the owner, as it treats the gate's cookie. A small **door sprite** runs `marble-drive provisioner`, which takes queued drives from the Directory and runs `tools/sprite-provision.sh --door`.

**Tech Stack:** Node 22 ESM, `node:test`, WebCrypto (Workers and Node), `node:crypto` on the drive, Playwright browser tests, bash. No new npm dependencies; the Worker has none.

**Spec:** `docs/superpowers/specs/2026-10-10-accounts-and-sign-in-design.md`

## Global Constraints

- No new dependency, in the host or the Worker. Crypto is WebCrypto (`crypto.subtle`, Ed25519, SHA-256, HMAC) in the Worker and `node:crypto` on the drive.
- Pass format: `v1.<kid>.<base64url(JSON payload)>.<base64url(Ed25519 signature over "v1.<kid>.<payload>")>`. Payload `{ typ: 'pass'|'grant', drv, acct, sid, role, iat, exp, n? }`; `role` is `owner` in this phase; `n` (nonce) only on grants.
- Lifetimes: grant 60 s, single use; pass 12 h, renewed at the edge after 1 h; apex session 30 days.
- Cookies: `__Host-md_session` (apex), `__Host-md_pass` (each drive host), `__Host-md_oauth` (10 min). All `HttpOnly; Secure; SameSite=Lax; Path=/`, never `Domain`.
- Stored secrets are SHA-256 hashes (session ids, invite codes, grant nonces). Provider access tokens are never stored.
- `sprite.env` values never hold a comma: `MARBLE_DOOR_KEYS` is `<kid>:<base64 SPKI>` entries separated by spaces.
- A drive with no `MARBLE_DOOR_*` settings behaves exactly as today. Every existing gate test still passes unchanged.
- No secret, code, grant, pass or passphrase in a log, an audit line, a job's output or an error message.
- Words on every page follow Design Don'ts `#words`; pages use the Design System token block (`s-sta`); run the Don'ts scan on every page's HTML.
- Drive names: `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`, no `--`, not reserved, not starting `mac-`, `pc-`, `t-`, `d-`.

## Review Focus

1. A pass for drive `ana` presented to `bob.marbledrive.app`, straight to `bob`'s sprite URL, and to the PC's tunnel: refused everywhere.
2. Two tabs redeeming the same last use of an invite, and two people claiming the same drive name at once: one wins, the other is told in words.
3. A grant replayed (same nonce) within its 60 s; a grant whose `to` is `//evil.example`, `/\evil`, or `/%2e//evil`.
4. A drive at home on the PC: the edge sends `bryan.marbledrive.app` through the lease, the PC's host accepts the pass; the same pass works after `drive-home to fly`.
5. `MARBLE_DRIVE_GATE=tools`: the passphrase form is refused to a request through `cloudflared` (`Cf-Ray`) or the Worker (`X-Forwarded-Host`), still works at `127.0.0.1` and as a bearer, and the agent's browser pass still opens the drive.
6. A share link visitor (no account) through the edge: `/s/<token>`, then the page, its events and ops, all reach the drive and are judged there.
7. The OAuth callback with a missing or mismatched `state`, a Google ID token for another `aud`, `email_verified: false`, and a GitHub account with no verified email.

---

### Task 1: Passes and grants, signed at the edge

**Files:**
- Create: `worker/src/door/tokens.js`
- Test: `test/door-tokens.test.js`

**Interfaces:**
- Produces: `importSigningKey(pkcs8Base64)`, `importVerifyKey(spkiBase64)`, `sign(key, kid, payload)` → token string, `verify(keys /* Map kid→CryptoKey */, token, { now, typ, drv })` → payload or `null`, `b64url` helpers, `randomId(bytes)`, `sha256Hex(text)`.

- [ ] **Step 1: Write the failing tests** — a token round-trips its payload; a changed payload byte, a changed signature byte, an unknown `kid`, the wrong `typ`, the wrong `drv`, and `exp` in the past each give `null`; a token with four or six parts gives `null`; a token signed in the Worker's way verifies with `node:crypto.verify(null, data, publicKey, sig)` (the drive's way), and one signed with `node:crypto.sign` verifies here, so both sides are proven against each other.
- [ ] **Step 2: Run** `node --test test/door-tokens.test.js` — FAIL (module missing).
- [ ] **Step 3: Implement** with `crypto.subtle` (`{ name: 'Ed25519' }`) only; no `Buffer`, so it runs in the Worker.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Door: passes and grants, signed with Ed25519 at the edge`.

### Task 2: The drive checks a pass

**Files:**
- Create: `server/door.js`
- Modify: `server/config.js` (`doorKeys` from `MARBLE_DOOR_KEYS`, `doorName`, `doorOwner`, `gateMode` from `MARBLE_DRIVE_GATE`, `on` | `tools`, default `on`)
- Test: `test/door.test.js`, `test/config.test.js` (if present; else in `door.test.js`)

**Interfaces:**
- Produces: `createDoor({ keys, name, owner, cookieName = '__Host-md_pass', now })` → `{ configured, allows(req), who(req), enterUrl(req) }`. `allows` reads the cookie, verifies with `node:crypto`, and requires `typ: 'pass'`, `drv === name`, `acct === owner`, `exp > now`. `enterUrl(req)` is `https://marbledrive.app/enter?drive=<name>&to=<returnPath(req.url)>`.
- `parseDoorKeys('k1:MCow… k2:MCow…')` → `Map`. A malformed entry is a boot error naming the variable, never the value.

- [ ] **Step 1: Failing tests** — keys signed by Task 1's `sign` are accepted; wrong drive, wrong owner, expired, unknown kid, a `grant` instead of a `pass`, and a cookie under another name are refused; no settings means `configured: false` and `allows` is always false; `parseDoorKeys` refuses a comma and a key that is not SPKI Ed25519.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `A drive accepts the door's pass, for its own name and owner only`.

### Task 3: The host lets the pass in, beside the passphrase

**Files:**
- Modify: `server/app.js` (create the door next to the gate; `owner = gate.allows(req) || door.allows(req)` in the check before the routes and in `shareDoor`; HTML without either goes to `door.enterUrl` when the door is configured and the gate is `tools` or the request is not local, else to `/gate`; `gateRoute` shows **Sign in with Marble Drive** above the passphrase when the door is configured, and in `tools` mode refuses the form and `POST /gate` to requests that are not local), `server/gate.js` (export `isLocal(req)`: loopback, no `X-Forwarded-Host`, no `Cf-Ray`)
- Test: `test/door-host.test.js`, `test/gate-page.test.js`

- [ ] **Step 1: Failing tests** on a real host (`createDrive` as `test/console-routes.test.js` does): with door settings, a pass cookie opens `/a/<doc>`, `/docs`, `/ops` and `/events`; without one, an HTML request is redirected to `https://marbledrive.app/enter?drive=…&to=…` with `to` passed through `returnPath`; the passphrase still works with `MARBLE_DRIVE_GATE` unset; with `tools`, `GET /gate` and `POST /gate` are refused when `X-Forwarded-Host` or `Cf-Ray` is present and allowed from loopback without them; a bearer passphrase still works in both modes; the agent's `browserPass` cookie still opens the drive; with no door settings every existing gate test passes untouched.
- [ ] **Step 2: Run** `node --test test/door-host.test.js test/gate.test.js test/gate-page.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `npm test` — PASS.
- [ ] **Step 5: Commit** `The host lets the door's pass in beside the passphrase; tools mode keeps the passphrase for scripts and the desk`.

### Task 4: The Directory

**Files:**
- Create: `worker/src/door/directory.js` (the `Directory` Durable Object class and the pure functions it calls)
- Modify: `worker/src/index.js` (export `Directory`), `worker/wrangler.toml` (binding `DIRECTORY`, migration `v2` with `new_sqlite_classes = ["Directory"]`)
- Test: `test/door-directory.test.js` (a `storage` fake over a `Map` with `get`, `put`, `delete`, `list({ prefix })` and `transaction`, as `test/hub-lease-worker.test.js` fakes the Lease)

**Interfaces (JSON over `fetch` to the object, like `Lease`):**
- `POST /identity` `{ provider, subject, email, name, invite? }` → `{ account, state: 'active'|'asked'|'new-needs-invite' }`. A known identity returns its account. A new one with a live invite makes an account (`member`, or `owner` for the bootstrap invite) and holds the invite for it without spending it.
- `POST /request` `{ provider, subject, email, name, ip }` → records Ask for access once per identity.
- `POST /approve` `{ account | request }` (admin) → the identity may make a drive at its next sign-in.
- `POST /invite` `{ note, uses = 1, days = 14, drive?, sprite? }` (admin) → `{ code }`, kept hashed. `GET /invites` (admin) → without codes.
- `POST /drive` `{ account, name }` → claims the name and spends the held invite in one transaction; refuses taken, reserved, invalid, `MAX_DRIVES` reached, or a second drive for the account; a claim invite (`drive` set) binds the existing drive instead and marks it `ready`.
- `GET /drives/:name` → `{ name, owner, homes, sprite, state }` (for the router). `POST /drives/:name/step` (admin) `{ step, state, url?, sprite? }` for the provisioner. `GET /queue` (admin) → queued drives.
- `POST /session` `{ account, method, device }` → `{ sid }` (the object keeps its hash). `GET /session/:sidHash` → live or not. `DELETE /session/:sidHash`.
- `POST /nonce/:n` → `true` the first time within 2 minutes, `false` after.
- `POST /count` `{ key, limit, windowSeconds }` → `{ ok, retryAfter }` for rate limits.
- Every mutation appends an audit line (`audit:<iso>:<rand>`), with no code, token or secret in it.

- [ ] **Step 1: Failing tests** — a new identity with an invite becomes an account and the invite is not yet spent; two `POST /drive` for the last use of one invite (run together) give one drive and one refusal; two accounts racing for `ana` give one owner; reserved and malformed names are refused with the reason in words; `MAX_DRIVES` refuses and leaves the invite unspent; a claim invite binds `irene` to the account without queuing a sprite; a nonce is true once; a revoked session reads as not live; the counter refuses past its limit and resets after its window; audit lines name the kind and account and never a code.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Door: the Directory holds people, invites, drives and sessions`.

### Task 5: Sign in with Google or GitHub

**Files:**
- Create: `worker/src/door/oauth.js`
- Test: `test/door-oauth.test.js`

**Interfaces:**
- `start(provider, { env, invite, to, now })` → `Response` 302 to the provider with `state`, PKCE `code_challenge` (S256), and for Google `nonce`; sets `__Host-md_oauth` (state, verifier, nonce, invite, to; 10 min, sealed with HMAC under `DOOR_SIGNING_KEY`-derived bytes).
- `finish(provider, request, { env, fetchImpl, now })` → `{ subject, email, name }` or throws a `DoorError` with words for the page.
- Google: `POST https://oauth2.googleapis.com/token`, then the ID token's payload decoded (it came straight from the token endpoint over TLS) and `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = client id, `exp`, `nonce`, `email_verified` checked; subject is `sub`.
- GitHub: `POST https://github.com/login/oauth/access_token` (Accept JSON), `GET https://api.github.com/user` and `/user/emails`; subject is the numeric `id`; email is the primary verified one, else refused with "Your GitHub account has no verified email address."

- [ ] **Step 1: Failing tests** with a fake `fetchImpl` for both providers — the redirect carries client id, redirect URI, scopes, state, S256 challenge; the callback with the right state yields the identity; a wrong or missing state, an expired oauth cookie, a token for another `aud`, a stale `exp`, a wrong `nonce`, `email_verified: false`, and GitHub with no verified email each throw with words and never echo the code; the provider's access token is not in the result.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Door: sign in with Google or GitHub, state, PKCE and nonce checked`.

### Task 6: The apex pages and their routes

**Files:**
- Create: `worker/src/door/pages.js` (HTML for: sign in, join, not invited, asked, name your drive, making your drive, account (drive link and **Sign out**), and an error page; one shared `<style>` with the Design System token block), `worker/src/door/apex.js` (routes on `marbledrive.app`: `/`, `/join/:code`, `/auth/:provider/start`, `/auth/:provider/callback`, `/ask`, `/name` (GET form, POST claim), `/making/:name` (page) and `/making/:name.json` (steps), `/enter`, `/account`, `/signout`, `/privacy`, `/terms`)
- Modify: `worker/src/router.js` (the apex goes to `apex.js` instead of the placeholder)
- Test: `test/door-apex.test.js`, `test-browser/door-pages.test.js`

- [ ] **Step 1: Failing tests** (unit, through `handle(request, env)` with a fake Directory and fake providers): `/` signed out shows both buttons; `/join/<code>` with a dead code says spent or expired and offers Ask for access; a callback for a new identity without an invite lands on "open by invitation"; with an invite, on Name your drive; a POST to `/name` without `Origin: https://marbledrive.app` is 403; `ana` free claims and redirects to `/making/ana`; `/enter?drive=ana&to=/a/x` for the owner redirects to `https://ana.marbledrive.app/_marble/enter?grant=…&to=%2Fa%2Fx`, and for anyone else answers "That drive isn't yours" without saying whose it is; rate limits answer 429 with `Retry-After` and words; `/signout` revokes the session and walks the person's drives' `/_marble/leave`.
- [ ] **Step 2: Failing browser test** — serve `handle` from a Node `http` adapter (Request/Response are global in Node 22), open each page with Playwright in light and dark at 360 and 1100 px: no sideways scroll, the one filled button per page, focus ring visible on Tab, no text under 4.5:1 against its background.
- [ ] **Step 3: Run** `node --test test/door-apex.test.js` and `node tools/browser-tests.mjs test-browser/door-pages.test.js` — FAIL.
- [ ] **Step 4: Implement.** Words as in the spec's "The screens". The provider buttons carry each provider's own mark, unaltered.
- [ ] **Step 5: Run** — PASS. Run the Design Don'ts scan (`sed -n '/data-marble-id="scan-pre">/,/<\/pre>/p' "Design Don'ts.mrbl"`) over each page's HTML, written to a scratch file; answer every hit.
- [ ] **Step 6: Commit** `Door: the sign-in, invite, naming and making pages at marbledrive.app`.

### Task 7: The edge in front of every drive

**Files:**
- Modify: `worker/src/router.js` (drives from `DIRECTORY` `GET /drives/:name`, cached per isolate 30 s, with `DRIVES` kept as the override for drives with several homes; before proxying: `/_marble/enter` verifies the grant, spends its nonce, sets `__Host-md_pass`, 302 to `to` with `Referrer-Policy: no-referrer`; `/_marble/leave` clears it; a request with a valid pass is proxied, and when the pass is over an hour old and its session is live a fresh one is set on the response; a request for `/s/<token>` or carrying `marble_share` is proxied for the drive to judge; anything else is a 302 to `https://marbledrive.app/enter?…` for HTML and a 401 otherwise, and the sprite is not asked), `worker/wrangler.toml` (route `*.marbledrive.app/*`; routes with no script for `pc-bryan.marbledrive.app/*` and `mac-bryan.marbledrive.app/*`; vars `DOOR_KEY_ID`, `MAX_DRIVES`, `DOOR_SPRITE_URL`; comments naming each secret)
- Test: `test/hub-router.test.js` (extend), `test/door-edge.test.js`

- [ ] **Step 1: Failing tests** — a drive from the Directory routes to its sprite URL; `bryan` still routes by its lease to `pc`, `mac` or `fly`; no pass: 302 to the apex and the upstream `fetchImpl` is never called; a forged, expired or other-drive pass: the same; a grant redeemed twice: the second refused; `to` of `//evil.example` becomes `/`; a pass over an hour old with a live session gets a new `Set-Cookie`, with a revoked one is cleared and sent to sign in; `/s/abc` and a `marble_share` cookie reach the upstream; every existing `hub-router` test still passes.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `The edge checks a drive's pass before it wakes the drive`.

### Task 8: Provisioning from the door sprite

**Files:**
- Modify: `tools/sprite-provision.sh` (`--door <name> --account <id> --keys <file>`: sprite `d-<name>`, label `marble-user`, `sprite.env` with a random `MARBLE_DRIVE_SECRET`, `MARBLE_DRIVE_SECURE_COOKIE=1`, `MARBLE_DRIVE_AGENT_PROVIDER=claude-api`, `MARBLE_DOOR_KEYS`, `MARBLE_DOOR_NAME`, `MARBLE_DOOR_OWNER`, `MARBLE_DRIVE_PUBLIC_URL`; its check from outside expects a 302 to `marbledrive.app/enter`; prints `step: <name> <state>` lines and the sprite URL, and no note and no passphrase; does not write `testers.json`)
- Create: `server/provisioner.js` (`createProvisioner({ directoryUrl, adminToken, run, log })` → `{ once(), serve(port) }`: `once` reads `/queue`, takes the oldest, runs the script, forwards each `step:` line to `/drives/:name/step`, marks `ready` with the sprite URL or `failed` with the step), `bin/marble-drive.js` (`provisioner` subcommand; holds a keep-awake task while a job runs)
- Modify: `worker/src/door/apex.js` (after a claim, `POST DOOR_SPRITE_URL/poke` with `Authorization: Bearer SPRITES_TOKEN` and `X-Door-Token`; a failed poke is logged and the queue waits for the next)
- Test: `test/provisioner.test.js`, `test/sprite-provision.test.js` (stub `sprite` CLI and stub deploy, as `test/sprite-release.test.js` stubs `sprite-env`)

- [ ] **Step 1: Failing tests** — the script in `--door` mode writes exactly those `sprite.env` lines (passphrase present, never printed), labels `marble-user`, names `d-ana`, refuses a name that is not a valid drive name, prints step lines; the provisioner takes one job at a time, reports each step, marks `failed` naming the step when the script exits non-zero, never puts a secret into a step; a second `once` while one runs does nothing.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** `bash -n tools/sprite-provision.sh`. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `The door sprite makes a drive for whoever was invited`.

### Task 9: `tools/door.mjs` for the owner

**Files:**
- Create: `tools/door.mjs` (`invite [--note] [--uses] [--days] [--drive <name> --sprite <sprite>] [--owner]`, `invites`, `requests`, `approve <id>`, `drives`, `hold <name>`, `log [--account]`; reads `DOOR_URL` and `DOOR_ADMIN_TOKEN` from `~/.config/marble-drive/door.env`, mode 600)
- Test: `test/door-cli.test.js`

- [ ] **Step 1: Failing tests** against a fake Directory: `invite` prints the link once and nothing else secret; `--owner` makes the bootstrap invite and refuses once an owner exists; a settings file not mode 600 is refused by name.
- [ ] **Step 2–4:** run, implement, run.
- [ ] **Step 5: Commit** `tools/door.mjs: invites, requests and drives from the terminal`.

### Task 10: Docs

**Files:** `docs/HOSTING.md` (a section "Accounts and the door": the pieces, the settings table, day to day, runbooks for a failed provision, a lost key, a revoked session), `docs/DEPLOY.md` ("The gate": what `MARBLE_DOOR_*` and `MARBLE_DRIVE_GATE=tools` change), `docs/ACCOUNTS.md` and `docs/ROADMAP.md` (superseded by the spec, and why), `docs/SHARING.md` (links pass the edge), `docs/HOSTING-DECISIONS.md` (decision 30: identity at the edge, a sprite per person).

- [ ] **Step 1:** Write them. **Step 2:** Commit `Docs: accounts and the door`.

### Task 11: Live, on t-bryan (needs the owner)

- [ ] The owner registers the Google and GitHub apps and puts every secret into the Worker (spec, "What the owner sets up").
- [ ] Generate the signing key on the owner's machine (`node -e` with `crypto.generateKeyPairSync('ed25519')`), private half to `wrangler secret put DOOR_SIGNING_KEY`, public half into `MARBLE_DOOR_KEYS`; nothing printed into a chat.
- [ ] Prove on the zone that the routes with no Worker keep `pc-bryan.marbledrive.app` off the Worker before adding the wildcard.
- [ ] Deploy the Worker. Bootstrap invite (`tools/door.mjs invite --owner`), sign in, see the account page.
- [ ] Give `t-bryan` a public name and the door settings by a claim invite; sign in through the edge; check a share link through the edge; check the passphrase still works; `tools/sprite-deploy.sh t-bryan` keeps the settings.
- [ ] Create the door sprite, sign its CLI in, deploy; an invite to a second Google account of the owner's makes `d-<name>` from start to **Open my drive**; time it; remove it with `sprite-provision.sh --remove`.
- [ ] Fresh reviewer over the branch against the Review Focus; fix what holds up.

### Task 12: Move the owner's drive and the testers (owner-run, one at a time)

- [ ] `bryan`: door settings in `pc-bryan.env` and admin-p2's `sprite.env`; restart the PC's home service; sign in at `bryan.marbledrive.app`; `drive-home` is not needed.
- [ ] Each tester: a claim invite, sent by the owner; when `tools/door.mjs drives` shows they entered through the edge, the owner sets `MARBLE_DRIVE_GATE=tools` on their drive.
- [ ] Push `main`; `tools/sprite-deploy.sh --all --when-idle`, then admin-p2, then the PC's release. Report what shipped and where.
