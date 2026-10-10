# Accounts and sign-in: anyone can sign up and get a drive of their own

2026-10-10. Status: design, written autonomously for the owner's review.
Phase 1 is built on the `accounts` branch and is not switched on: nothing
changes until the settings in [`../../ACCOUNTS.md`](../../ACCOUNTS.md) are made.
The plan for phase 1 is
[`../plans/2026-10-10-accounts-phase-1.md`](../plans/2026-10-10-accounts-phase-1.md).
A readable copy for the owner is the drive page
`Notes and Sketches/Drive and Sharing/Accounts and sign-in`.

## What the owner asked for

> Support authentication. I want people to be able to create their own
> accounts, log in and create a new drive for themselves. Right now I have to
> build these drives manually for people, so I want a process where it's easy
> for anyone to log in and create an account. I also want two-factor, or
> sign-in through GitHub or Google, so that the drive people access is more
> secure.

Three things, then: **sign-up that makes a drive** without the owner running
`tools/sprite-provision.sh`; **sign-in with Google or GitHub**; and **a second
factor**. Under all three, the passphrase goes: today every drive has one
shared secret (`server/gate.js`) that the owner copies out of
`~/.config/marble-drive/testers.json` into a message, and `docs/DEPLOY.md` has
said since G0 that the gate "is thrown away at G2".

## Where things stand (read 2026-10-10)

| Piece | State | Where |
|---|---|---|
| The gate | one passphrase per drive, a signed cookie for 30 days, the same secret as a bearer for scripts | `server/gate.js`, `server/app.js` `gateRoute` |
| A drive per person | one Fly Sprite per person, made by hand: `sprite-provision.sh <person>` or Console's **New drive**, which runs it as a job; prints a note with the URL and passphrase | `tools/sprite-provision.sh`, `server/console/actions.js` `provision` |
| The front door | the lease Worker routes `<name>.marbledrive.app` to the drive's home (the PC's tunnel, the Mac's, or the sprite); names are a static `DRIVES` table and explicit routes, never a wildcard | `worker/src/router.js`, `worker/wrangler.toml` |
| Share links | `/s/<token>` at three levels, a visitor cookie, judged per op; links are written at `MARBLE_DRIVE_PUBLIC_URL` | `server/shares.js`, `server/share-policy.js`, `docs/SHARING.md` |
| Isolation | designed (each document in a sandbox with passes), not built | `specs/2026-09-26-isolation-design.md` |
| G2 accounts | `server/accounts.js` (email + scrypt password, invite codes, JSONL) and `server/sessions.js` (the gate's cookie plus a user id, and `sameOrigin`). Merged into main on 2026-09-02 from `worktree-multi-tenant-g2`, whose only commit (`d3ae650`) is already in main. Only `sameOrigin` is imported | `docs/ACCOUNTS.md` |
| Who pays for agents | each drive: the person's own Anthropic or OpenAI key, pasted in the first-visit **Connect an agent** popup; or a Claude/ChatGPT login run by the owner in `sprite console` (two friends are on the owner's) | `server/agent/routes.js` `setupState`, HOSTING-DECISIONS 12 |

## What was decided, and why

| Question | Chose | Over | Why |
|---|---|---|---|
| What a sign-up makes | **a sprite per person, as today** | a multi-tenant host with a store per person (`docs/ACCOUNTS.md`) | agents have a real shell, a browser and registered projects; on a shared host one person's agent is a shell next to everyone else's drive (HOSTING-DECISIONS 7). A sprite costs nothing measurable while it sleeps |
| Where identity lives | **one accounts service at `marbledrive.app`**, in the Worker that is already the front door, with its data in a Durable Object | each drive keeping its own accounts; a Node accounts host on a sprite; a hosted identity product | the Worker is always on (a sign-in never waits 9 to 70 s for a sprite to wake), already sees every request for every drive, and is the one place OAuth callbacks can be registered (providers take exact redirect addresses, not wildcards) |
| How a sign-in reaches a drive | **a signed pass per drive**, minted at the edge, verified by the drive with a **public key** | a shared HMAC key on every drive; trusting a header the Worker adds | a person's agent can read their own sprite's settings. With a public key there, it can verify passes and never mint one, so a drive cannot forge its way into another. A header alone would be believed from anyone who reached the sprite or tunnel directly |
| Sign-in methods, first | **Google and GitHub** | passwords; email links first | no password to store, reset or have stuffed; both need nothing but two OAuth apps. An email link needs a mail service, so it waits |
| Second factor | **Marble's own: passkeys and an authenticator app (TOTP)**, with recovery codes; **required for the owner**, offered to everyone | relying only on Google's or GitHub's own two-step; SMS | the providers do not reliably tell us whether their two-step was used. SMS is the weakest factor and costs per message |
| Who may sign up | **invite links** in phase 1; **Ask for access** recorded for the owner to approve; open sign-up only after per-drive spending limits exist | open sign-up now | a stranger's drive is a Linux machine with a shell on the owner's Fly bill. Invites keep it to people he chooses |
| Who pays for agents | **the person**, with their own key or their own subscription, as **Connect an agent** does today | the owner's key or login | the model bill is theirs; Anthropic's consumer terms are for one person (HOSTING-DECISIONS 12) |
| The passphrase | **kept on every drive as a key for scripts and a way in at the desk**; the browser form is switched off per drive, by the owner, once its person has signed in the new way | removing it in one deploy | no one is locked out: each drive moves only after its own person has got in, and taking the three settings out puts it back |

### Rejected, with reasons

- **Multi-tenant drives on one host** (the G2 plan in `docs/ACCOUNTS.md`:
  `MARBLE_DRIVE_DATA`, `<data>/users/<id>/`, the `userContext` refactor). It
  would make a person cheaper, but every agent turn would need a sandbox of its
  own, the store, channels, watcher and op log would all become per person, and
  the isolation project would be a precondition for the first sign-up. One
  sprite per person needs none of it.
- **Each drive signs in its own people** (a Google client on every drive). Every
  drive would need its own redirect address registered with Google and GitHub
  by hand, which is the manual step this is meant to remove.
- **A Node accounts host on its own sprite**, reusing `server/accounts.js`. A
  sign-in would wake it (seconds paused, about 70 s stopped), and when Fly is
  down nobody could reach a drive at home on the PC either.
- **Cloudflare Access in front of `*.marbledrive.app`.** Almost no code: Google,
  GitHub and one-time codes are built in, and the drive could verify Access's
  JWT. Rejected because the free tier stops at 50 people, sign-up is not its
  model (each drive would need its own policy managed through Cloudflare's
  API), the screens are Cloudflare's, and two-step is whatever the provider
  did. Worth keeping as the fallback if phase 1 stalls.
- **Clerk, Auth0, Supabase Auth.** They would hold every person's identity and
  bring an SDK. Google, GitHub, TOTP and WebAuthn verification are each small
  with `fetch` and WebCrypto, which both Workers and Node 22 have.
- **Passwords.** `server/accounts.js` has them, done well (scrypt, constant
  time). They need a reset path (email), invite credential stuffing, and add
  nothing a passkey does not do better.
- **Linking accounts by matching email.** A Google and a GitHub sign-in with
  the same address are not merged by themselves: a second method is added only
  while signed in with the first. Matching on email hands an account to anyone
  who can get a provider to vouch for that address.
- **A cookie for `.marbledrive.app`.** Every drive is its own origin because
  documents are code; a cookie for the parent domain would be sent to all of
  them, and any drive could overwrite it.

## The account model

| Thing | What it holds | Notes |
|---|---|---|
| **Person** (account) | id (16 hex), name, primary email, role (`owner` or `member`), state (`asked`, `active`, `held`, `deleted`), created | the owner is Bryan, the one account with role `owner`. Created by a one-time bootstrap invite |
| **Sign-in method** | Google `sub` or GitHub numeric `id` (never the email) and the email it vouched for; later passkeys and email | at least one; the last cannot be removed |
| **Second factor** | passkeys (credential id, public key, counter, name), a TOTP secret (encrypted), recovery codes (hashed) | phase 2 |
| **Drive** | name (`<name>.marbledrive.app`), owner account, homes (`fly`: the sprite URL; for `bryan` also `pc` and `mac`, by lease), sprite name, state (`queued`, `making`, `ready`, `held`, `removed`), created, last entered | one per person to begin with. A person may later have more; nothing in the shape assumes one |
| **Invite** | code (stored hashed), note, uses left, made by, expires, and optionally the drive it hands over | an invite that names an existing drive is how testers claim theirs |
| **Session** | id (stored hashed), account, created, last seen, method, second factor satisfied, a short description of the device | revocable; 30 days |
| **Audit line** | time, account, kind, IP, device, detail | the person sees their own; the owner sees all |

**The owner.** Bryan's account is an ordinary account with role `owner`. It can
mint invites, approve requests, hold or remove a drive, and read the audit log,
from Console. It **cannot enter anyone else's drive** through the front door:
the edge grants a drive's pass only to that drive's owner. The sign-up page
says plainly that Bryan runs the service and can reach the machines drives run
on (he is in the Fly org, and `sprite console` opens any sprite). That is a
policy, not cryptography, and the page should not pretend otherwise.

## Signing up makes a drive

```
marbledrive.app/join/<code>  →  Continue with Google / GitHub  →  Name your drive
   →  Making your drive (a few minutes)  →  Open my drive  →  ana.marbledrive.app
   →  the drive's own first visit: Connect an agent (their key, or later their login)
```

1. **The invite link.** Bryan makes one from Console or `tools/door.mjs invite
   --note "Ana"` and sends it however he likes. The code rides in a short-lived
   cookie through the provider round trip; it is spent only when a drive is
   asked for, so a sign-in that stops halfway does not use it up.
2. **Sign-in with the provider.** A new identity with a live invite becomes a
   new account. A new identity without one sees "Marble Drive is open by
   invitation for now" and **Ask for access**, which records the request; the
   owner approves it from Console and tells them, and their next sign-in carries
   on as if they had an invite. (Telling them by email is phase 3.)
3. **Name your drive.** One field, `[ ana ].marbledrive.app`, checked as it is
   typed: 3 to 30 of `a-z 0-9 -`, not starting or ending with `-`, no `--`, not
   reserved (`www`, `app`, `api`, `docs`, `status`, `admin`, `mail`, `auth`,
   `account`, `join`, the testers' names until claimed), and not starting with
   `mac-`, `pc-`, `t-` or `d-` (tunnels and sprites). The name is public in the
   way a GitHub username is.
4. **Making your drive.** The Directory records the drive as `queued` and pokes
   the **door sprite** (below), which runs the provisioning that
   `sprite-provision.sh` runs today, adapted: sprite `d-<name>`, label
   `marble-user`, a random passphrase the person never sees (it is the drive's
   key for scripts and the agent's browser pass), and the door settings in place
   of a note to send. Each step is reported back, and the page shows them:
   *Making its machine · Installing Marble Drive · Checking it answers*. A
   deploy builds a release with its own Claude Code, Codex and Chromium, so this
   takes minutes, and the page says so and that the tab can be closed. A failed
   step says which one and that Bryan has been told; the sprite is left for him
   to finish with `--resume` or remove.
5. **Open my drive.** Through the edge to the drive, signed in (next section).
   The drive's existing first-visit popup asks them to connect an agent. Nothing
   in sign-up asks for a key.

### The door sprite

Provisioning needs the `sprite` CLI signed in to the Fly org and a bash
environment; a Worker has neither. So one small sprite, `door` (label
`marble-door`, URL private to the org), runs `marble-drive provisioner`:
it takes queued drives from the Directory with an admin token, runs the
provisioning script for each, one at a time, and reports each step. The Worker
pokes it on each new request (with `SPRITES_TOKEN`, which the private URL
needs, and a token of its own); it holds a Sprites task while it works and
sleeps after. It runs no agents and serves no documents.

Considered: provisioning from Console on the owner's drive (already a job
there). Rejected because the drive's home is the PC, and a sign-up would wait
for the PC to be on; and because admin-p2, which could run it, is on standby
while the PC is home and runs nothing. Also considered: driving the Sprites API
from the Worker directly, which would mean rewriting `sprite-deploy.sh` in
JavaScript.

**Later (phase 2): a drive kept ready.** One spare sprite, provisioned and
asleep, so a sign-up only names it, writes its settings and restarts it: seconds
instead of minutes. Its cost is one sprite's cold storage.

### Cost, sleep and limits

Sprites bill CPU and memory per second **only while running**, plus storage
(`docs/HOSTING.md`, "Costs", rates from 2026-10-01). A sprite sleeps about a
second after its last connection; tabs rest after 60 s hidden or 10 min idle;
an agent's work holds it up at most 24 h unattended.

| | Rate | A drive used about 2 h a day, at about 1 GB |
|---|---|---|
| Memory | $0.021875 / GB-hour | 60 h × 1 GB ≈ $1.31 a month |
| CPU | $0.03825 / CPU-hour | mostly idle while a person reads; a busy agent adds to it |
| Storage | ≈ $0.50 / GB-month hot (awake), ≈ $0.02 cold | cents |

That row is arithmetic on the published rates, not a measurement; the only
measured bill so far is $6.75 for six drives over 2026-09-19 to 09-25, the
owner's heavy use included. The real risk is not a person reading documents but
an agent (or something it was asked to run) keeping 8 CPUs busy for a day:
8 × 24 × $0.03825 ≈ $7.34 a day. So, in order:

1. **Invites** (phase 1). Only people Bryan chooses get a machine.
2. **A cap on drives** (phase 1): the Directory refuses a new drive past
   `MAX_DRIVES` (set by the owner) and says "Bryan has made as many drives as
   he can for now"; the invite stays unspent.
3. **The edge keeps strangers from waking drives** (phase 1). A request for
   `<name>.marbledrive.app` without a valid pass or a share-link cookie is
   answered by the Worker (sent to sign in) and never reaches the sprite.
4. **A monthly budget per drive** (phase 2): each drive already writes its own
   ledger of awake minutes, CPU and memory (`server/ledger.js`). Past its
   budget the host starts no new agent turn and lets go of its keep-awake
   holds, and says why, in the Agents page; the sprite sleeps when the tabs
   do. Console shows each drive against its budget. Freeze, never kill
   (HOSTING-DECISIONS 20).
5. **Open sign-up** (phase 3) only once 4 is in.

The Worker's own cost: the free plan's 100,000 requests a day is shared with the
lease, and live updates add up; the mac-home spec already planned the $5 Workers
Paid plan before friends move over. Durable Object storage at this size is
cents.

## Signing in

### Methods, by phase

| Method | Phase | How | What the owner registers |
|---|---|---|---|
| **Continue with Google** | 1 | OpenID Connect, authorization code with PKCE, `openid email profile`; the ID token taken straight from Google's token endpoint, then `iss`, `aud`, `exp`, `nonce` and `email_verified` checked; the account keyed on `sub` | a Google Cloud project, an OAuth consent screen (External, published to Production; basic scopes need no review), a Web client with the redirect `https://marbledrive.app/auth/google/callback`; the consent screen wants a home page, a privacy page and a terms page on the domain |
| **Continue with GitHub** | 1 | OAuth app, `read:user user:email`, `state` (and PKCE where GitHub accepts it); `GET /user` for the numeric id, `GET /user/emails` for the primary verified address; the access token is dropped once read | a GitHub OAuth App: home page `https://marbledrive.app`, callback `https://marbledrive.app/auth/github/callback` |
| **Passkey** | 2 | WebAuthn, relying party `marbledrive.app`, discoverable credentials, user verification required, attestation `none`. Verified in the Worker with WebCrypto (ES256, RS256, Ed25519) and a small CBOR reader. Usable alone as a first factor and as a second factor | nothing |
| **Authenticator app** | 2 | TOTP (RFC 6238, SHA-1, 6 digits, 30 s, one step either side), secret shown as a QR and as text, confirmed with a first code before it counts; a code used once is refused again | nothing |
| **Recovery codes** | 2 | ten single-use codes, shown once when two-step is turned on, stored as hashes; making new ones voids the old | nothing |
| **Email me a link** | 3 | a single-use link, 15 min, stored hashed; opening it shows **Sign in** (a POST), so a mail scanner that fetches links signs nobody in. The same answer whether or not the address has an account | a mail sending service and its DNS records (SPF, DKIM) on `marbledrive.app` |

**Two-step.** Once a person has a passkey or an authenticator app, every sign-in
by Google, GitHub or email asks for it before the session counts: **Confirm
it's you**, with the passkey button first, a code field, and a recovery code
link. A sign-in by passkey alone is already two factors (the device and its
lock). The owner's account must have two-step on before Console's people
actions work; everyone else is offered it on their account page and after
their first sign-in, not forced.

**Recovery.** Lost the second factor: a recovery code. Lost those too: ask
Bryan. From Console he can clear a person's second factors after checking with
them some other way; it is written to the audit log and the person sees it on
their account page. Lost the Google or GitHub account itself: the other method,
if they added one; else the same.

### Where a session lives and how it reaches a drive

Two cookies, on two different origins, never one for the whole domain:

| Cookie | Origin | Holds | Life |
|---|---|---|---|
| `__Host-md_session` | `marbledrive.app` only | a random session id (the Directory keeps its hash) | 30 days; revoked by sign-out, sign-out everywhere, a removed method, deletion |
| `__Host-md_pass` | each `<name>.marbledrive.app` | a pass: `v1.<key id>.<payload>.<Ed25519 signature>` where the payload says drive, account, session, role, issued, expires | 12 hours, renewed at the edge |

Both `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`. The `__Host-` prefix
also means a document on one drive cannot set a cookie that the apex or another
drive would read.

```
browser → ana.marbledrive.app/a/Notes        no pass
   Worker: 302 → marbledrive.app/enter?drive=ana&to=/a/Notes        (the sprite is not woken)
browser → marbledrive.app/enter               session cookie
   Worker: session live, second factor satisfied, the account owns "ana"
           → a grant: signed, 60 s, audience "ana", a nonce
           302 → ana.marbledrive.app/_marble/enter?grant=…&to=/a/Notes
browser → ana.marbledrive.app/_marble/enter
   Worker: grant signature, audience, expiry, nonce not used before (the Directory spends it)
           Set-Cookie __Host-md_pass, 302 → /a/Notes, Referrer-Policy: no-referrer
browser → ana.marbledrive.app/a/Notes        pass
   Worker: pass verifies (signature, drive, expiry) → proxied to the sprite
   Drive:  verifies the same pass with MARBLE_DOOR_KEYS (public), drive name and owner → the owner, as the gate's cookie is today
```

- **The edge checks first so strangers cost nothing**; the drive checks again
  because its sprite URL and the PC's tunnel can be reached without the Worker.
  A request that came straight to the sprite URL or tunnel carries no pass
  (the cookie belongs to the public name) and is sent to sign in.
- **Renewal.** When a pass is more than an hour old, the edge asks the Directory
  whether its session is still live (at most once an hour per session) and sets
  a fresh one on the response. A revoked session's drive passes stop at the
  next renewal, at most an hour later, and at most 12 hours for a tab that never
  makes a request through the edge.
- **Sign-out** clears the apex session, then sends the browser through each of
  the person's drives' `/_marble/leave` to clear its pass, and back.
- **The PC or Mac at home.** Nothing changes: the router already sends
  `bryan.marbledrive.app` through the lease to the PC's tunnel, and the PC's
  host, with the same public key, accepts the same pass. One sign-in is good on
  the PC, the Mac and Fly, which the passphrase only managed by being the same
  string on all three.
- **At the desk** (`http://127.0.0.1:4401`): the passphrase still opens it, for
  loopback requests that did not come through `cloudflared` (no `Cf-Ray`), so
  the owner never needs the internet to reach his own drive.
- **Keys.** The Worker holds the Ed25519 private key (`DOOR_SIGNING_KEY`, a
  Worker secret). Each drive's `sprite.env` holds `MARBLE_DOOR_KEYS`: public
  keys separated by spaces (a `sprite.env` value may not hold a comma), each
  with its key id, so a new key can be added everywhere before the old one is
  retired.
- **Native apps, later.** The Mac and iOS apps sign in at the apex in the
  system's web sign-in sheet and receive a device key for their drive, which
  replaces the pairing code the apps spec planned.

## Security

| Concern | Answer |
|---|---|
| **Cross-site requests to the apex** | `SameSite=Lax`, and every state-changing apex request must carry `Origin: https://marbledrive.app` exactly. Until `marbledrive.app` is on the Public Suffix List, every drive is *same-site* with the apex, so `SameSite` alone does not stop a document on one drive from posting to the apex; the exact-origin check does |
| **Cross-site requests to a drive** | as today: `sameOrigin` on every state-changing drive route, comparing `Origin` with `X-Forwarded-Host` |
| **The OAuth round trip** | a `__Host-md_oauth` cookie for 10 minutes holds `state`, the PKCE verifier, the nonce, the invite and where to go after; the callback refuses anything that does not match it |
| **Open redirects** | `to` is only ever a path on the drive it names (the gate's `returnPath`, which already survives `//`, `/\`, dot segments and control characters); `drive` must be one the account owns |
| **Grants in the address bar** | single-use, 60 s, one audience; the edge strips them with a redirect before the page loads, and sends `Referrer-Policy: no-referrer` |
| **Rate limits** | counted in the Directory, per IP and per account: starting a sign-in 20 a minute per IP; a second-factor code 5 tries per 5 minutes per account, then 15 minutes' wait, said in words; invite redemptions 10 an hour per IP; Ask for access 3 a day per IP; one drive per account in phase 1 |
| **Account enumeration** | an OAuth sign-in reveals nothing about other people. The email link answers the same whether or not an address has an account. Drive names are public by design (an unknown name says "No drive lives here"); the sign-up page says names are public |
| **Token storage** | provider access tokens are dropped once the identity is read. Session ids, invite codes, email links and recovery codes are stored as SHA-256 hashes (they are long and random, so a slow hash adds nothing). TOTP secrets are sealed with AES-GCM under a Worker secret (`DOOR_DATA_KEY`). Passkey public keys are stored as they are. Nothing secret is logged |
| **A drive forging its way into another** | drives hold public keys only. The passphrase on a new drive is random, never shown, and opens only that drive |
| **The audit log** | sign-ins and failures, second factor added or removed, sessions revoked, invites made and spent, requests approved, drives made, held or removed, and every owner action on someone else's account. Kept 180 days. A person sees their own on the account page, the owner sees all in Console |
| **Deleting an account** (phase 2) | from the account page, by typing the drive's name: the drive is held at once (the edge refuses it, the sprite is stopped), and after 7 days the door sprite destroys the sprite, its checkpoints with it, and the account's personal details are deleted; the audit lines keep only the account id. Signing in during the 7 days offers **Keep my account**. **Download my drive** first is offered as a tar of `/drive` |
| **Share links** | unchanged. A share link is the drive's, not the account's: the edge lets through `/s/<token>` and any request carrying the `marble_share` cookie, and the drive judges it as now. Links are written at `MARBLE_DRIVE_PUBLIC_URL=https://<name>.marbledrive.app` |
| **Agents** | unchanged. A turn's browser carries the gate's own cookie for `127.0.0.1` and `localhost` (decision 23), which still works because every drive keeps its signing secret. The MCP bridge keeps its per-turn token. No agent ever holds a pass or a key that could open another drive |
| **Documents are code** | within one drive, documents still share its origin; in phases 1 to 3 every document in a drive is its owner's, so that is today's position. A person opening someone else's drive (phase 4) waits for the isolation project, as `docs/ACCOUNTS.md` already said: accounts without origin isolation is a regression |
| **Abuse of the machine** | invites, the drive cap, budgets (phase 2) and the audit log; terms of use the person accepts at sign-up (an open question for the wording) |

## Moving today's drives over

No drive changes until its owner can sign in the new way; each step is undone by
taking three lines out of a `sprite.env`.

| Drive | Who | Steps |
|---|---|---|
| `t-bryan` | the owner's test drive | first. Give it a public name (`tbryan` or similar), add the door settings, sign in through the edge, keep the passphrase on; leave it a week |
| `bryan` (the PC, admin-p2 on standby, the Mac retired) | the owner | the same three lines in `pc-bryan.env` and admin-p2's `sprite.env`, so both homes take the same pass. The owner signs in with the bootstrap invite and turns on two-step. The passphrase stays for `127.0.0.1` and for scripts |
| `t-irene`, `t-sam`, `t-sangho`, `t-peiling` | friends | one at a time: a **claim invite** that names the existing drive (`tools/door.mjs invite --drive irene --sprite t-irene`). Signing in with it makes the account the drive's owner and adds the name to the router; the drive gets the door settings. The friend keeps their passphrase until they say they are in |
| afterwards, per drive | | `MARBLE_DRIVE_GATE=tools`: the passphrase is no longer offered to a browser, only accepted as a bearer from scripts and at the desk. Set by the owner when `tools/door.mjs drives` (Console's People view in phase 2) shows the drive's person has entered through the edge |

Nothing here touches a drive's documents, so there is no data migration. The
break-glass is the one that exists today: `sprite console` reaches any sprite,
and the owner can take the settings out.

## The screens

All at `marbledrive.app`, served by the Worker as single HTML pages with the
drive's tokens inline (Design System `s-sta`): paper behind, one card in the
middle column at about 24rem, the sans at 14/1.5, the dusty blue as the only
accent, no webfont, both schemes, no gradients, no fingernail borders, no
emoji. Headings and buttons in sentence case; every line tells the person
something they need (Design Don'ts `#words`). The provider buttons carry each
provider's own mark, unaltered, as their brand rules ask; that is the one place
colour that is not ours appears.

1. **Sign in** (`/`). "Marble Drive", one line saying what it is, **Continue
   with Google**, **Continue with GitHub**. Under them, quiet: "New here? You
   need an invite link from Bryan." No "welcome back".
2. **Join** (`/join/<code>`). "Bryan invited you to Marble Drive", "Sign in to
   make your drive. You'll choose its name next.", the two buttons. A spent or
   expired code says which, and **Ask for access**.
3. **Not invited.** "Marble Drive is open by invitation for now." **Ask for
   access** (it says what is sent: your name and email); after it, "Asked. Bryan
   will tell you when there's room."
4. **Name your drive.** The field with `.marbledrive.app` after it, a line under
   it that says *free*, *taken* or what is wrong with the name, and **Make my
   drive**. Two short lines below: names are public; Bryan runs the service and
   can reach the machine your drive runs on, and nobody else can open it unless
   you share a page.
5. **Making your drive.** The three steps as rows with a state each (done, now,
   waiting), the only moving thing being the row that is working. "This takes a
   few minutes. You can close this tab: your drive will be at
   ana.marbledrive.app." When done, **Open my drive**.
6. **Confirm it's you** (phase 2). **Use a passkey**, a six-digit field,
   "Use a recovery code".
7. **Your account** (`/account`). Your drive, with its address. Sign-in methods
   (each with **Remove**, and **Add GitHub** or **Add Google**). Two-step
   sign-in (passkeys by name, the authenticator app, recovery codes left). Where
   you're signed in (each session with **Sign out**). Recent activity. **Delete
   account and drive**, in the danger colour as words, not a red box.

**Console** gets a **People** view (phase 2; a CLI in phase 1): requests to
approve, invites (make a link, what each is for, uses left, turn off), people
and their drives, the audit log.

## Phases

| Phase | Ships | Leaves out |
|---|---|---|
| **1. Sign in with Google or GitHub, and invited people make their own drive** | the Directory; Google and GitHub sign-in; invite links and Ask for access; name your drive; the door sprite provisioning `d-<name>`; the edge's passes and the drive's check; the wildcard route; `tools/door.mjs`; migration of `t-bryan`, then `bryan`, then the testers | two-step, passkeys, email, deletion by the person, budgets, Console's People view |
| **2. Two-step, and limits** | passkeys (first or second factor), the authenticator app, recovery codes, two-step required for the owner; the account page in full; Console People view; per-drive monthly budgets; deletion with 7 days' grace and download; a drive kept ready; `marbledrive.app` on the Public Suffix List; sprite URLs made private once the edge's bearer to Sprites is proven | email |
| **3. Open the door** | email links, the waitlist with an email when approved, connecting a Claude or ChatGPT subscription from the browser (`codex login --device-auth`, `claude setup-token`), terms and privacy pages in full, open sign-up behind budgets | sharing with accounts |
| **4. Accounts in sharing** | after isolation (collaboration project 1): Share's *People with access* names a Marble account, the person enters someone else's drive with a `doc`-grade pass for one page or folder, *Shared with me* on the apex | |

## What of the G2 work is reusable

`origin/worktree-multi-tenant-g2` has one commit, `d3ae650`, and main already
contains it. Of what it added:

- **Kept as is:** `sameOrigin` in `server/sessions.js` (the drive's CSRF check,
  imported by `app.js` and the agent routes).
- **Carried over in spirit, rewritten for the Worker:** the signed, unstored
  token with the account in it (here it is asymmetric and per drive); invite
  codes with a `uses` count and a note; the constant-time comparison.
- **Not used:** passwords and `server/accounts.js`'s JSONL store (identity lives
  at the apex now), `MARBLE_DRIVE_DATA` and `<data>/users/<id>/` (one sprite per
  person), `createSessions` itself.
- **Later, maybe:** `quotaDocs` and `quotaBytes` in `server/config.js` as a
  storage ceiling per drive, next to the phase 2 budget.

`docs/ACCOUNTS.md` and ROADMAP's G2 rows should say that this spec supersedes
them; whether to delete `server/accounts.js` is a cleanup for after phase 1.

## Settings

| Where | Name | What |
|---|---|---|
| Worker secret | `DOOR_SIGNING_KEY` | the Ed25519 private key (PKCS#8, base64) |
| Worker secret | `DOOR_DATA_KEY` | AES-GCM key for sealed fields (phase 2) |
| Worker secret | `DOOR_ADMIN_TOKEN` | for `tools/door.mjs` and the door sprite |
| Worker secret | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | the two OAuth apps |
| Worker var | `DOOR_KEY_ID`, `MAX_DRIVES`, `DOOR_SPRITE_URL` | |
| Worker secret | `SPRITES_TOKEN` (exists) | to poke the door sprite's private URL |
| drive `sprite.env` | `MARBLE_DOOR_KEYS` | `<kid>:<public key>` entries separated by spaces |
| drive `sprite.env` | `MARBLE_DOOR_NAME`, `MARBLE_DOOR_OWNER` | the public name the pass must be for; the account it must name |
| drive `sprite.env` | `MARBLE_DRIVE_GATE` | `on` (default: the passphrase form and the door), `tools` (the door for browsers; the passphrase as a bearer and at the desk) |
| drive `sprite.env` | `MARBLE_DRIVE_PUBLIC_URL` (exists) | `https://<name>.marbledrive.app` |

## What the owner sets up outside the code

1. **Google:** a Cloud project; the OAuth consent screen (External, app name,
   support email, `marbledrive.app` as an authorised domain, home, privacy and
   terms links), published to Production; a Web client with the Google redirect
   above. Client id and secret into the Worker.
2. **GitHub:** an OAuth App with the GitHub callback above. Client id and secret
   into the Worker.
3. **Cloudflare:** a proxied wildcard DNS record (`*`, `AAAA 100::`); a Worker
   route `*.marbledrive.app/*`, plus routes with no Worker for each tunnel name
   (`pc-bryan.marbledrive.app/*`, `mac-bryan.marbledrive.app/*`) so tunnels
   never pass through it (to be proven on the zone before relying on it); the $5
   Workers plan; the secrets above.
4. **Fly:** create the `door` sprite and sign its `sprite` CLI in to the org;
   check whether Fly can alert on spend.
5. **Phase 2:** the Public Suffix List request for `marbledrive.app` (a pull
   request to `publicsuffix/list`; it takes weeks, so start early).
6. **Phase 3:** a mail sending service and its DNS records; terms and privacy
   text.

## Guards

- A request for a drive with no pass, a forged pass, a pass for another drive,
  or an expired one never reaches the drive through the edge; straight to the
  sprite or tunnel, the drive refuses it the same way.
- A pass signed with a key not in `MARBLE_DOOR_KEYS` is refused; a drive whose
  settings name no key accepts no pass and behaves exactly as today.
- A grant used twice, after 60 s, or on another drive is refused.
- `MARBLE_DRIVE_GATE=tools` refuses the passphrase form to a request that came
  through `cloudflared` or the Worker, and still accepts it as a bearer and at
  `127.0.0.1`.
- An invite is spent exactly once per use, even with two tabs racing; a drive
  name is claimed exactly once.
- The owner cannot enter another person's drive through the edge.
- No secret, code, grant or pass appears in a log, an audit line, a page or
  an error.

## Open questions for Bryan

Phase 1 was built without answers, taking the proposals below. Each is
**defaulted, pending Bryan**: one setting or one line of words to change, not
a rebuild.

| # | Defaulted, pending Bryan | Where it lives |
|---|---|---|
| 1 | Invite links only, plus Ask for access that you approve. No domain sign-up | `worker/src/door/directory.js` `identity` |
| 2 | `MAX_DRIVES` = 10; drives handed over by a claim invite don't count. Budgets wait for phase 2 | `worker/wrangler.toml` |
| 3 | Irene and Sam stay on your Claude login; phase 1 changes nothing about agents | nothing to change |
| 4 | The person chooses the name, checked as typed. The testers' public names are `irene`, `sam`, `sangho`, `peiling`, with `tbryan` for t-bryan and `bryan` as it is; the Directory keeps those for them until a claim invite hands each over | `worker/src/door/names.js` `KEPT_FOR_CLAIM` |
| 5 | One drive per person. Your account (role `owner`) is exempt, since claim invites hand you both `bryan` and `tbryan` | `directory.js` `claimDrive` |
| 6 | Two-step required for you, offered to others: phase 2. Phase 1 has no second factor at all | phase 2 |
| 7 | The sign-up page says you can reach the machine a drive runs on and nobody else can open it unless they share a page; `/privacy` lists what is kept and promises nothing more | `worker/src/door/pages.js` `nameDrive`, `privacy` |
| 8 | No mail service chosen; nothing in phase 1 sends mail | phase 3 |
| 9 | `/terms`: no mining, scraping at scale, bulk mail or harm, and you may hold a drive that does and say why; agents run on the person's own account; no warranty. Wording yours to change | `pages.js` `terms` |

The questions as they were asked:

1. **Who should be able to sign up now?** Invite links only (recommended), or
   invite links plus anyone with a Google account at a chosen domain (for
   example `ucsd.edu`)?
2. **How many drives** may exist before the Directory says no (`MAX_DRIVES`)?
   And what monthly budget per drive for phase 2?
3. **Your two friends on your Claude login** (`t-irene`, `t-sam`): move them to
   their own keys or subscriptions as part of the migration, or leave them?
4. **Drive names:** the person's choice (recommended), or always derived from
   their name? And what public names do the testers' drives get?
5. **Should a person be able to have more than one drive?** The model allows it;
   phase 1 caps it at one.
6. **Two-step for everyone, or offered?** Recommended: required for you,
   offered to others, revisited at phase 3.
7. **What should the sign-up page promise about privacy?** The honest line is
   that you can reach the machines; do you want to commit to never doing so
   without the person's say, in writing?
8. **Email:** which sending service, and from what address, when phase 3 comes.
9. **Terms of use**, before strangers: is there anything a drive must not be
   used for (crypto mining, scraping, sending mail)?
