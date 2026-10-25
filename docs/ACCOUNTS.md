# Accounts and sign-in

People sign in at `marbledrive.app` with Google or GitHub, an invite link lets
them make a drive of their own, and each drive checks a signed pass from the
edge beside its passphrase. The design, what was decided and what was rejected
is the spec:
[`superpowers/specs/2026-10-10-accounts-and-sign-in-design.md`](superpowers/specs/2026-10-10-accounts-and-sign-in-design.md).
Phase 1 was built from
[`superpowers/plans/2026-10-10-accounts-phase-1.md`](superpowers/plans/2026-10-10-accounts-phase-1.md).

This page used to describe G2's multi-tenant host (`MARBLE_DRIVE_DATA`, a store
per person under `<data>/users/<id>/`, passwords in `server/accounts.js`). The
spec supersedes it: a sign-up makes a sprite of its own, as a tester's drive is
made today, because an agent has a real shell and a shared host would put it
next to everyone else's drive. `server/accounts.js` and `MARBLE_DRIVE_DATA` are
still in the tree, imported by nothing but their tests; removing them is a
cleanup for after phase 1.

## What phase 1 built

| Piece | Where |
|---|---|
| Passes and grants, Ed25519, signed at the edge | `worker/src/door/tokens.js` |
| The Directory: people, invites, drives, sessions and the audit log, in a Durable Object | `worker/src/door/directory.js` |
| Sign in with Google (OpenID Connect, PKCE, nonce) or GitHub (OAuth, PKCE) | `worker/src/door/oauth.js` |
| The pages and routes at `marbledrive.app`, and the owner's API at `/_door/*` | `worker/src/door/apex.js`, `pages.js` |
| The edge in front of every drive with an owner: no pass, no wake | `worker/src/router.js` |
| The drive's own check of the pass, with public keys only | `server/door.js`, `server/app.js` |
| The door sprite, which makes the drives people asked for | `server/provisioner.js`, `marble-drive provisioner`, `tools/sprite-provision.sh --door` |
| Invites, requests and drives from the terminal | `tools/door.mjs` |
| A drive kept ready, so sign-up takes seconds (off until set) | `server/provisioner.js`, `tools/sprite-provision.sh --spare` and `--from-spare`, the Directory's spares; below, "The spare drive" |

**Nothing changes until it is configured.** With no `DOOR_SIGNING_KEY` on the
Worker, `marbledrive.app` is the placeholder and every drive name is routed as
before. With no `MARBLE_DOOR_*` settings on a drive, its gate is the passphrase
exactly as before. Each side turns on by its own settings, below.

## To turn it on

Run these on your own machine. None of them prints a key; keep it that way, and
never paste one into a chat.

### 1. The edge's signing key and the admin token

```sh
mkdir -p ~/.config/marble-drive && chmod 700 ~/.config/marble-drive
node -e '
  const c = require("crypto"), fs = require("fs"), dir = process.env.HOME + "/.config/marble-drive/";
  const { privateKey, publicKey } = c.generateKeyPairSync("ed25519");
  fs.writeFileSync(dir + "door-signing.key", privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), { mode: 0o600 });
  fs.writeFileSync(dir + "door-keys", "k1:" + publicKey.export({ type: "spki", format: "der" }).toString("base64") + "\n", { mode: 0o600 });
  fs.writeFileSync(dir + "door.env", "DOOR_URL=https://marbledrive.app\nDOOR_ADMIN_TOKEN=" + c.randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
'
cd worker
npx wrangler@latest secret put DOOR_SIGNING_KEY < ~/.config/marble-drive/door-signing.key
sed -n 's/^DOOR_ADMIN_TOKEN=//p' ~/.config/marble-drive/door.env | npx wrangler@latest secret put DOOR_ADMIN_TOKEN
```

`door-keys` holds the public half as `k1:<base64>`: it is what every drive gets
as `MARBLE_DOOR_KEYS`, and `DOOR_KEY_ID` in `worker/wrangler.toml` is `k1` to
match. Put the same line in the Worker as the var `DOOR_PUBLIC_KEYS` (it is
public); unset, the edge derives it from the private key. To roll the key
later: make a `k2`, put its private half in `DOOR_SIGNING_KEY` and `k2` in
`DOOR_KEY_ID`, and keep `k1`'s public half beside `k2`'s in `DOOR_PUBLIC_KEYS`
and in every drive's `MARBLE_DOOR_KEYS` until the passes signed with it have
run out (12 hours); then drop it.

### 2. Google

1. In Google Cloud Console, make a project (say `marble-drive`).
2. **OAuth consent screen**: External; app name Marble Drive; your support
   email; authorised domain `marbledrive.app`; home page
   `https://marbledrive.app`, privacy `https://marbledrive.app/privacy`, terms
   `https://marbledrive.app/terms`. Scopes `openid`, `email` and `profile`,
   which need no review. Publish it to Production.
3. **Credentials**, Create OAuth client ID, type Web application. Authorised
   redirect URI: `https://marbledrive.app/auth/google/callback`.
4. Into the Worker: `npx wrangler@latest secret put GOOGLE_CLIENT_ID`, then
   `GOOGLE_CLIENT_SECRET`.

### 3. GitHub

1. GitHub, Settings, Developer settings, **OAuth Apps**, New OAuth App. Home
   page `https://marbledrive.app`; authorization callback
   `https://marbledrive.app/auth/github/callback`.
2. Generate a client secret. Into the Worker:
   `npx wrangler@latest secret put GITHUB_CLIENT_ID`, then `GITHUB_CLIENT_SECRET`.

A provider with no client set is not offered on the sign-in page.

### 4. Cloudflare

1. The Workers Paid plan ($5 a month): the free plan's 100,000 requests a day
   would be shared by every drive's live updates once they come through the edge.
2. DNS: a proxied wildcard record, `*` `AAAA` `100::`. The apex and `bryan`
   records already exist.
3. Routes with **no Worker** for the tunnels, in the dashboard (Workers Routes,
   Add route, Worker: None): `pc-bryan.marbledrive.app/*` and
   `mac-bryan.marbledrive.app/*`. Prove it before the next step: request
   `https://pc-bryan.marbledrive.app/health` while `npx wrangler@latest tail`
   runs, and see the PC answer and the tail stay empty. (The router also sends
   any `pc-` or `mac-` name straight on to its tunnel, as a second guard.)
4. In `worker/wrangler.toml`, uncomment the `*.marbledrive.app/*` route.
   `MAX_DRIVES` is 10.
5. Deploy: `cd worker && npx wrangler@latest deploy`. This also creates the
   `Directory` Durable Object (migration `v2`).
6. Check: `https://marbledrive.app` shows **Sign in** with both buttons.

### 5. The door sprite

It makes each drive someone asks for, by running `tools/sprite-provision.sh
--door`. That needs the `sprite` CLI signed in to the org and a git checkout of
marble-drive with marble beside it, as on admin-p2.

```sh
sprite create -o marble-drive --skip-console --label marble-door door
tools/sprite-workshop.sh door --github <file with a GitHub token> --sprites <file with an org Sprites token>
```

(`sprite-workshop.sh` puts the two checkouts in `/home/sprite/src` and signs the
sprite CLI in; it also tries to register agent projects, which the door does
not use.) Then its `~/.config/marble-drive/sprite.env`, mode 600, placed with
`sprite exec -o marble-drive -s door --file <local file>:/home/sprite/.config/marble-drive/sprite.env -- chmod 600 /home/sprite/.config/marble-drive/sprite.env`:

```
MARBLE_SERVE_COMMAND=provisioner
DOOR_URL=https://marbledrive.app
DOOR_ADMIN_TOKEN=<the token in door.env>
MARBLE_DOOR_KEYS=<the line in door-keys>
MARBLE_PROVISION_SCRIPT=/home/sprite/src/marble-drive/tools/sprite-provision.sh
```

To keep a drive made ahead so a sign-up takes seconds, add
`MARBLE_SPARE_DRIVES=1` to that file too ("The spare drive", below). It can
wait until the door has made its first drive the slow way.

Then `tools/sprite-deploy.sh door`. Keep its URL private to the org (the
default); the Worker pokes it with `SPRITES_TOKEN`, which it already has. Set
`DOOR_SPRITE_URL` in `worker/wrangler.toml` to its URL and deploy the Worker
again. Before a release that changes provisioning, pull its checkout:
`sprite exec -o marble-drive -s door -- git -C /home/sprite/src/marble-drive pull --ff-only`.

### 6. You, first

```sh
node tools/door.mjs invite --owner
```

Open the link it prints and sign in: that makes the one account with role
`owner`. It makes no drive; your own drives come to you by claim invites.

### 7. Each drive moves over, one at a time

In the spec's order: `t-bryan` first, then `bryan`, then the testers.

1. **A claim invite.** `node tools/door.mjs invite --drive tbryan --sprite t-bryan --note "t-bryan"`.
   Signing in with it makes that account the drive's owner; from then on the
   edge wants a pass for `<name>.marbledrive.app`. For a tester, send them the
   link. For your own, open it while signed in. A name not in `DRIVES` is reached
   through the wildcard route (step 4).
2. **The drive's own settings**, in its `sprite.env` (for `bryan`, in
   `pc-bryan.env` and admin-p2's `sprite.env` too, so every home takes the same
   pass):

   ```
   MARBLE_DOOR_KEYS=<the line in door-keys>
   MARBLE_DOOR_NAME=tbryan
   MARBLE_DOOR_OWNER=<its owner's account id, from node tools/door.mjs drives>
   MARBLE_DRIVE_PUBLIC_URL=https://tbryan.marbledrive.app
   ```

   then `tools/sprite-deploy.sh t-bryan` (or restart the PC's home service).
   The drive's gate page now offers **Sign in with Marble Drive** above the
   passphrase, and a browser reaching it through a tunnel or the edge without a
   pass is sent to sign in.
3. **When its person has signed in through the edge**, set
   `MARBLE_DRIVE_GATE=tools` on it. The passphrase is then refused to a browser
   that came through a tunnel or the edge (the form, `POST /gate`, and its
   cookie), and still works at `127.0.0.1` and as `Authorization: Bearer` for
   scripts. Taking the lines out puts the drive back as it was.

## Starter credit

A new drive's agent runs on a capped budget the owner pays for, so it works
before anyone brings a key. The owner's Anthropic key never reaches a drive:
it is a Worker secret. Each drive gets a token of its own, and its Claude Code
talks to the credit proxy at `https://marbledrive.app/_credit` with that token
as its key. The proxy checks the token, checks the drive's spend against its
cap, passes the request on to Anthropic with the owner's key, and streams the
answer back. On the way out it reads the usage, prices it by model, and adds
the cost to the drive's total in the Directory. At the cap it answers a 402
that the drive shows as "Starter credit used up", with Connect your Claude.

There are two caps. Each drive has its own in the Directory ($5 unless set
otherwise). The key's Console workspace has a monthly spend limit, so a bug in
the first can never spend past the second.

| Piece | Where |
|---|---|
| The proxy, the price table, reading usage from a stream | `worker/src/credit.js` |
| Each drive's token (as a hash), cap and spend | `worker/src/door/directory.js`, `credit:` records |
| The default cap, `DEFAULT_CREDIT_USD` | `worker/src/door/directory.js` |
| Claude Code pointed at the proxy | the `claude-credit` provider, `server/agent/providers/claude.js` |
| The line in Agents › Settings › Claude, and the chat's notes | `runtime/agent-ui.js`; the balance through `server/agent/credit.js` |
| Minting a token when a drive is made or handed a spare | `server/provisioner.js`, `tools/sprite-provision.sh --settings` (door) or `--credit` (by hand) |
| The owner's view of it | `node tools/door.mjs credit` |

Like the door, nothing changes until it is configured. With no
`CREDIT_ANTHROPIC_KEY` on the Worker, every `/_credit` path is a 404 and the
door sprite makes drives without credit, as before. A drive without
`MARBLE_CREDIT_URL` and `MARBLE_CREDIT_TOKEN` has no `claude-credit` agent and
behaves exactly as it did. Credit does not need the door to be on: a drive
made by hand can use it.

### To turn it on

1. **An Anthropic workspace for credit.** In the Anthropic Console, Settings,
   Workspaces, make one called `marble-credit`. Give it a monthly spend limit
   of $5 times the most drives you will allow on credit (with `MAX_DRIVES` at
   10, that is $50), so the worst month is a number you chose. Make one API
   key in it. Nothing else uses this workspace.
2. **The key into the Worker**, never into a file a drive can read:
   `cd worker && npx wrangler@latest secret put CREDIT_ANTHROPIC_KEY`, and
   paste it at the prompt.
3. **The admin token.** The credit admin routes use `DOOR_ADMIN_TOKEN`, the
   same as the door's (step 1 of "To turn it on" above). Set it even if the
   door itself stays off.
4. **Deploy the Worker**: `cd worker && npx wrangler@latest deploy`. The
   `marbledrive.app/*` route it already has carries `/_credit`.
5. **Check**: `node tools/door.mjs credit` answers "No drive has starter
   credit yet." rather than "starter credit is off".

### Giving a drive credit

- **A drive the door makes** gets it by itself: the door sprite mints its
  token before making it (or before handing it a spare, "The spare drive"),
  passes it in a mode-600 file with `--settings`, and `sprite-provision.sh` writes
  `MARBLE_CREDIT_URL` and `MARBLE_CREDIT_TOKEN` into its `sprite.env` and makes
  `claude-credit` its agent. `invite --credit <dollars>` gives the drive an
  invite makes a different amount; with `--credit 0` it is made without
  credit, and its person brings a key or their own Claude. A drive the door
  makes on the PC host gets none, whatever its invite says ("A drive on the
  PC host", below).
- **A new drive made by hand**: `tools/sprite-provision.sh ana --credit`. It
  mints the token with `door.mjs` (so it needs `door.env`) and the note it
  prints says there is nothing to set up.
- **A drive that already exists**, such as `t-irene`:

  ```sh
  node tools/door.mjs credit mint t-irene --by Bryan --write /tmp/t-irene-credit.env
  sprite exec -o marble-drive -s t-irene --file /tmp/t-irene-credit.env:/tmp/credit.env -- \
    sh -c 'cat /tmp/credit.env >> ~/.config/marble-drive/sprite.env && rm /tmp/credit.env'
  rm /tmp/t-irene-credit.env
  tools/sprite-deploy.sh t-irene
  ```

  A drive with no key and no Claude login of its own goes on credit when it
  restarts. One already on a key or a login stays on it, and has Starter
  credit to choose in Agents settings.

`--by` is the name in "On Bryan's starter credit". Unset, it is the owner
account's first name; with neither, the line says "On starter credit".

### Day to day

| To | Run |
|---|---|
| See each drive's spend and cap | `node tools/door.mjs credit` |
| Change a drive's cap | `node tools/door.mjs credit cap <name> <dollars>` |
| Give a drive its spend back | `node tools/door.mjs credit reset <name>` |
| Stop a drive's token | `node tools/door.mjs credit off <name>` (mint again to turn it back on) |
| A new token for a drive (the old one stops) | `node tools/door.mjs credit mint <name>` |

The audit log (`node tools/door.mjs log`) has `credit-minted`, `credit-set`,
`credit-revoked`, and `credit-used-up` at the moment a drive reaches its cap.

### What the proxy passes, and what it prices

It passes only what Claude Code needs: `POST /v1/messages` (the one that
costs), `POST /v1/messages/count_tokens`, and `GET /v1/models`. Batches, files
and anything else are a 404, so a drive cannot spend outside the count. It
sends on `content-type`, `accept`, `anthropic-version`, `anthropic-beta`, the
SDK's own `x-stainless-*` headers and the user agent; never the drive's
token, its cookies, or Cloudflare's headers.

Prices are dollars per million tokens, one table in `worker/src/credit.js`
(`PRICES`), matched on the model id the answer names. Cache writes are 1.25
times input for five minutes and 2 times for an hour, cache reads have their
own column, fast mode is double, and a web search is a cent. A model the table
does not know is priced as the dearest row, so it can only be overcounted.
Update the table when Anthropic's prices change.

Spend is counted after an answer finishes, so a drive at $4.99 can finish one
more request past its cap. The workspace's monthly limit is what bounds that.

## The spare drive

With `MARBLE_SPARE_DRIVES=1` in the door sprite's `sprite.env`, the door sprite
keeps one drive made ahead: created, deployed, checked, and then left to sleep
with nobody's name on it. The next person to name a drive is given it. The door
sprite writes its settings (her name, her account, the door's keys, and her
starter credit when it is on), restarts it, and she is in about
ten seconds later, where without it she would wait three to five minutes. Once
it has handed the spare over, it starts making the next one, beside anything
else it is doing, so a sign-up never waits behind a spare being made.

Fly can't rename a sprite (the `sprite` CLI has create, list, info, config,
exec, checkpoint, restore, destroy and url; `config update` changes only URL
access and labels). So the spare keeps its own name, `d-spare-<hex>`, and the
Directory maps her drive's name to it: `node tools/door.mjs drives` shows
`ana` on sprite `d-spare-3fa9c1d2`. The router already finds a drive by its
name in the Directory and sends it to the sprite URL recorded there, so nothing
else changes. No drive can be called `spare-…`, so no drive's own sprite can
have a spare's name.

**What it costs while it waits.** A sprite that is asleep bills only its
storage, at the cold rate (about $0.02 a GB a month, "Cost, sleep and limits"
in the spec). A spare with its release, Claude Code, Codex and Chromium is a
few GB, so a few cents a month. It is awake for the few minutes it takes to
make, and for a few seconds when it is handed over.

**What it does not do.** It is off until the setting is there: without it the
door sprite makes nothing ahead, the Directory has no spares, and every drive
is made from nothing as before. It makes no spare once `MAX_DRIVES` is reached,
since that one could never be given out. A spare is labelled `marble-user`, so
`tools/sprite-deploy.sh --all` keeps it on the current release like any drive.

**When something goes wrong.** If handing the spare over fails, the drive goes
back to the queue and is made from nothing; her page turns into the three-step
one that says it takes a few minutes. The spare that failed is kept in the list
as failed, and while one is there no new spare is made, so a fault can't make
sprite after sprite. A spare that failed while it was being made is kept the
same way.

| To | Run |
|---|---|
| See the spare, and whether one failed | `node tools/door.mjs spares` |
| Stop a spare being given out | `node tools/door.mjs forget-spare <sprite>` |
| Then remove its sprite | on the door sprite, `tools/sprite-provision.sh --remove <sprite> --spare <sprite>` |
| Turn it off | take `MARBLE_SPARE_DRIVES` out of the door sprite's `sprite.env`, `tools/sprite-deploy.sh door`, then forget and remove the spare |

`SPARE_DRIVES` in `server/provisioner.js` is how many are kept when the setting
is `on` (1); a number in the setting keeps that many, at most three.

**For the starter credit.** A spare has no credit while it waits: it is
nobody's, so no token is minted for it. It gets its token at hand-over. The
door sprite mints the token for the drive's name (`ana`, not the spare's
`d-spare-…` sprite), the same as for a drive made from nothing, and the
provisioning script writes `MARBLE_CREDIT_URL` and `MARBLE_CREDIT_TOKEN` into
its settings (`--settings <file>`, only `MARBLE_CREDIT_*` lines) and makes
`claude-credit` its agent before it restarts. So `node tools/door.mjs credit`
lists the drive by its name, and the proxy finds it by its token wherever it
runs. An invite's `--credit` amount applies to a spare handed over just as it
does to a drive made from nothing.

## A drive on the PC host

With `NEW_DRIVE_HOME=pchost`, sign-up makes each new drive on the owner's PC
instead of on Fly. marble-host runs it there in a sandbox of its own, and the
Worker reaches every such drive through one tunnel, `pc-host.marbledrive.app`
([HOSTING.md](HOSTING.md), "Other people's drives on the PC"). A drive made
there gets no starter credit: its person connects their own Claude or
ChatGPT. Unset, or `fly`, sign-up makes drives on Fly as before.

### To turn it on

The door has to be on (above, through step 4's wildcard route, so that
`<name>.marbledrive.app` reaches the Worker), and marble-host has to be
installed and answering on the PC. From any machine, `curl -s -o /dev/null -w
'%{http_code}\n' https://pc-host.marbledrive.app/_host/health` then prints
`401`: the tunnel is up, and the router refuses a request without the key.

1. In the Cloudflare dashboard, add a route with no Worker for
   `pc-host.marbledrive.app/*` (Workers Routes, Add route, Worker: None), as
   step 4 does for `pc-bryan` and `mac-bryan`.
2. Give the Worker the key it adds to every request it sends the PC: `HOST_KEY`
   in the PC's `host.env`. On the PC, in a checkout of marble-drive:

   ```sh
   cd worker
   sed -n 's/^HOST_KEY=//p' ~/.config/marble-drive/host.env | npx wrangler@latest secret put PC_HOST_KEY
   ```

3. Give the Worker a private ntfy topic to tell you when the PC isn't
   answering. Make one, subscribe to it in the ntfy app, and paste its URL at
   the prompt. The same URL can go in `host.env` as `HOST_NTFY_URL`, so
   marble-host's own alerts come to the same place.

   ```sh
   echo "https://ntfy.sh/marble-$(openssl rand -hex 12)"
   npx wrangler@latest secret put ALERT_NTFY_URL
   ```

4. In `worker/wrangler.toml`, uncomment `NEW_DRIVE_HOME = "pchost"`, and raise
   `MAX_DRIVES` if the PC is to hold more than ten drives. `PC_HOST_URL` is
   already set there. Deploy: `cd worker && npx wrangler@latest deploy`.
5. Check. `npx wrangler@latest tail` prints no `pc-host watch:` line over the
   next five minutes. An invite, a name, and the making page goes through its
   three steps to Open my drive.

To stop making drives on the PC, comment `NEW_DRIVE_HOME` out again and
deploy. New drives are made on Fly again; drives already on the PC stay there.

| To | Run |
|---|---|
| See which drives are on the PC | `node tools/door.mjs drives` (it says "the PC host") |
| See the Worker's looks at the PC | `cd worker && npx wrangler@latest tail` (a failed look is a `pc-host watch:` line) |

## The study

A study invite puts one screen between signing in and naming a drive. It is
"Taking part in the study", with the protocol's approved consent form and two
choices: Take part and Don't take part. The answer is kept on the account as
`{ version, at, choice }`. A drive made on the PC host after a yes carries
`cohort: 'study'`, which is what marble-host turns the study's settings on
by. After a no the drive is made all the same, with no cohort. Any other
invite never sees the screen.

The consent words are not written in this repo. The screen shows the form
your lab's IRB protocol approved, from one constant, `CONSENT_FORM` in
`worker/src/door/pages.js`, and the form's version comes from the Worker var
`CONSENT_VERSION`. Until the placeholder in `CONSENT_FORM` is replaced and
`CONSENT_VERSION` is set, the screen says "The study isn't ready yet", nobody
can answer it, and no study drive is made. Study invites still work in the
meantime: their people sign in, and are asked when they come back.

### To turn it on

1. Replace the placeholder in `CONSENT_FORM` (`worker/src/door/pages.js`)
   with the approved consent text, word for word. Put a blank line between
   paragraphs; a single line break is kept as one.
2. In `worker/wrangler.toml`, uncomment `CONSENT_VERSION` and set it to the
   version the protocol gives that text, such as `2026-11-irb-v1`. It is
   letters, digits, dots, hyphens and underscores, because marble-host writes
   it into the drive's settings.
3. Deploy: `cd worker && npx wrangler@latest deploy`.
4. Check: `node tools/door.mjs invite --study --note "Test"`, open the link in
   a private window and sign in. The screen shows the form and its version.

When the form changes, change both in the same deploy. Someone who had the
old form open and answers is shown the new one again, and their answer to the
old one is not kept.

If someone's invite runs out before they name a drive, send them a new one.
It replaces the old one when they sign in with it, and its consent screen
asks again.

### What its people can do

The account page has Leave the study while they are in it. Leaving is logged
as `consent-withdrawn`, and marble-host takes the study's settings off the
drive at its next look. Deleting what was collected is a second, separate
choice, offered once they have left, and logged as `study-delete-asked`. The
door only records that ask and when it came; you carry it out.

The page also has Download my drive, a link to the drive's own
`/drive/export.zip`, and Delete my drive for a drive on the PC host. Delete
asks for the drive's name, sets the drive `deleting` (`drive-delete-asked`),
and from then on the edge answers "This drive is being deleted". marble-host
deletes it and reports `removed`. Its encrypted backup in R2 stays, and the
delete page says so, until you forget it once the drive is removed:
`sudo /usr/local/lib/marble-guests/backup-guest <name> --forget --yes`
([HOSTING.md](HOSTING.md), "Backups of PC drives"). A drive on Fly has no
Delete my drive, because nothing there would carry it out; its person asks
you. Each of these is a POST that must come from `marbledrive.app` itself,
like every other change at the door.

### The admin routes

They are behind `DOOR_ADMIN_TOKEN` like the rest of `/_door/*`. The Console
and marble-host call them, and `tools/door.mjs` has `people`, `remove` and
`revoke` for the first three.

| Route | Does |
|---|---|
| `GET /_door/people` | `{ people: [...] }`: a row per account with a drive or an open invite, then one per open invite nobody has signed in with yet |
| `POST /_door/drives/<name>/remove` `{ confirm: <name> }` | state `removing`, so the edge says "This drive has been removed", and every session of its owner ends. Answers `{ drive, sessions }`, or `{ drive, sessions: 0, already: true }` for a drive already ending |
| `POST /_door/accounts/<id>/revoke` | ends every session of that account: `{ ok: true, count }` |
| `POST /_door/events` `{ drive, kind, detail? }` | marble-host's reports, into the audit log under the drive's owner |
| `POST /_door/drives/<name>/step` `{ state: 'removed' }` | marble-host's last word on a `removing` or `deleting` drive on the PC host. The record stays, as `removed`, so the name is never given out again |

A row of `people`:

```js
{
  account: { id, name, email, created, seen } | null,       // null: an invite nobody has signed in with
  drive: { name, state, home, created } | null,
  invite: { id, note, made, expires, used, study } | null,  // null: an account let in from a request
  study: { cohort, consent: { version, at, choice } | null, withdrawn: at | null, deleteAsked: at | null },
  timeline: { invited, signedIn, consented, named, ready, agentConnected, firstDocument, updated },
}
```

Someone is in the study when `study.cohort` is `'study'`,
`study.consent.choice` is `'given'` and `study.withdrawn` is null. Once a
drive is made, `cohort` is the drive's, so a no or a drive made on Fly leaves
it null. Before that it is the invite's, unless its person said no.
`invite.used` is when this person spent the invite by naming a drive. Each
timeline step is the time it first happened, read from the audit log, or null
until it does. `consented` is the time of a yes, and `updated` is the last
time marble-host moved the drive to a release. Your own account is not a
row; `drives` lists your drives. No row carries an invite code, a session, a
sign-in subject, or anything from inside a drive.

The kinds marble-host may report are `agent-connected`, `first-document`,
`drive-updated` and `drive-restarted`. The first two are logged once per
drive, and a repeat answers `{ ok: true, already: true }`. `detail` is
optional. It holds at most eight values, each a number, true, false, null, or
one word of up to 80 characters with no spaces, such as a release or `claude`.
Anything else is a 400, so a document's title or a prompt can't reach the
log. `step` refuses anything but `removed` for a drive that is ending, with a
409, so a maker half way through making one stops there.

The audit log gains `consent-given`, `consent-declined`, `consent-withdrawn`,
`study-delete-asked`, `drive-delete-asked`, `drive-remove-asked`,
`drive-removed` and the four kinds marble-host reports.

## Day to day

| To | Run |
|---|---|
| Invite someone to make a drive | `node tools/door.mjs invite --note "Ana"` |
| Invite someone into the study | `node tools/door.mjs invite --study --note "Ana"` |
| See everyone, their drive, the study and how far each got | `node tools/door.mjs people` |
| See who asked for access, and let them in | `node tools/door.mjs requests`, then `approve <id>`, then tell them |
| See every drive, and where a failed one stopped | `node tools/door.mjs drives` |
| Stop a drive at the edge, or let it go | `node tools/door.mjs hold <name>`, `hold <name> --off` |
| Take a drive away for good | `node tools/door.mjs remove <name> --confirm <name>` (its owner is signed out; on the PC host marble-host deletes it) |
| Sign someone out everywhere | `node tools/door.mjs revoke <account id>` (a drive they have open keeps working until its pass is an hour old; hold or remove it to stop it at once) |
| Read what happened | `node tools/door.mjs log [--account <id>]` |
| Finish a drive whose making failed | on the door sprite, `tools/sprite-provision.sh --resume <name> --door <name> --account <id> --keys <file>` (the id is in `drives`), then `curl -X POST -H "Authorization: Bearer $DOOR_ADMIN_TOKEN" -d '{"state":"ready","url":"<sprite URL>"}' https://marbledrive.app/_door/drives/<name>/step`. Or remove it: `--remove <name> --door <name>` |

## Settings

| Where | Name | What |
|---|---|---|
| Worker secret | `DOOR_SIGNING_KEY` | the Ed25519 private key, PKCS#8 in base64. Without it the door is off |
| Worker secret | `DOOR_ADMIN_TOKEN` | for `tools/door.mjs` and the door sprite |
| Worker secret | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | the two OAuth apps |
| Worker secret | `SPRITES_TOKEN` (exists) | pokes the door sprite's private URL |
| Worker var | `DOOR_KEY_ID` | the key id the edge signs with (`k1`) |
| Worker var | `MAX_DRIVES` | how many drives sign-up may make, claimed drives aside (10) |
| Worker var | `DOOR_SPRITE_URL` | the door sprite, poked when a drive on Fly is asked for |
| Worker secret | `CREDIT_ANTHROPIC_KEY` | the starter credit workspace's one key. Without it starter credit is off |
| Worker var | `DOOR_PUBLIC_KEYS` | the public keys a pass may be signed with, as in `MARBLE_DOOR_KEYS`; unset, derived from the signing key |
| Worker var | `NEW_DRIVE_HOME` | where sign-up makes drives: `pchost` (the PC host) or `fly`. Unset is `fly` |
| Worker var | `PC_HOST_URL` | the PC host's router, through its tunnel (`https://pc-host.marbledrive.app`) |
| Worker secret | `PC_HOST_KEY` | the key the Worker adds to every request it sends the PC host: `HOST_KEY` in the PC's `host.env`. Without it nothing is sent there |
| Worker secret | `ALERT_NTFY_URL` | optional: the ntfy topic the Worker's check posts to when the PC isn't answering |
| Worker var | `CONSENT_VERSION` | the version of the consent form in `CONSENT_FORM` (`worker/src/door/pages.js`): letters, digits, dots, hyphens and underscores. Unset, or with the placeholder still in `CONSENT_FORM`, the study's consent screen says it isn't ready and no study drive is made ("The study") |
| Worker cron | `*/5 * * * *` | that check, `[triggers]` in `wrangler.toml`; it asks nothing until `PC_HOST_URL` and `PC_HOST_KEY` are set |
| drive `sprite.env` | `MARBLE_DOOR_KEYS` | `<kid>:<base64 SPKI>` entries separated by spaces |
| drive `sprite.env` | `MARBLE_DOOR_NAME`, `MARBLE_DOOR_OWNER` | the name a pass must be for, and the account it must name |
| drive `sprite.env` | `MARBLE_DRIVE_GATE` | `on` (the default) or `tools` |
| drive `sprite.env` | `MARBLE_CREDIT_URL`, `MARBLE_CREDIT_TOKEN` | the credit proxy (`https://marbledrive.app/_credit`) and the drive's own token for it |
| door sprite `sprite.env` | `MARBLE_SERVE_COMMAND=provisioner`, `DOOR_URL`, `DOOR_ADMIN_TOKEN`, `MARBLE_DOOR_KEYS`, `MARBLE_PROVISION_SCRIPT` | above |
| door sprite `sprite.env` | `MARBLE_SPARE_DRIVES` | `1` keeps one drive made ahead ("The spare drive"); unset, none |
| PC drive `/etc/marble-guests/<name>.env` | `MARBLE_HOST_OWNER` | who hosts the drive, for the connect sheet's "so Bryan never sees your password". Unset, it says "nobody else" |
| PC drive, set by run-guest | `MARBLE_GUEST` | `1`: the usage meter asks Claude Code's `/usage` and never opens the login, agents take keys only from the drive's own key file, and starter credit is off (HOSTING.md, "People sign in to their own Claude or ChatGPT") |
| any drive | `MARBLE_DRIVE_CLAUDE_SIGNIN_SECONDS`, `MARBLE_DRIVE_CODEX_SIGNIN_SECONDS` | how long a Claude sign-in waits for its code (600) and a ChatGPT one for the person on OpenAI's page (900, the life of its code) |

## Not in phase 1

Two-step sign-in (passkeys, an authenticator app, recovery codes) and the rule
that the owner must have it; Console's People view; per-drive monthly budgets
(starter credit is a cap that does not reset by itself);
deleting an account from the account page; `marbledrive.app` on the Public
Suffix List; sprite URLs made private behind the edge; email links. The spec's
"Phases" table has them in order.
