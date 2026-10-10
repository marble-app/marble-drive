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

## Day to day

| To | Run |
|---|---|
| Invite someone to make a drive | `node tools/door.mjs invite --note "Ana"` |
| See who asked for access, and let them in | `node tools/door.mjs requests`, then `approve <id>`, then tell them |
| See every drive, and where a failed one stopped | `node tools/door.mjs drives` |
| Stop a drive at the edge, or let it go | `node tools/door.mjs hold <name>`, `hold <name> --off` |
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
| Worker var | `DOOR_SPRITE_URL` | the door sprite, poked when a drive is asked for |
| Worker var | `DOOR_PUBLIC_KEYS` | the public keys a pass may be signed with, as in `MARBLE_DOOR_KEYS`; unset, derived from the signing key |
| drive `sprite.env` | `MARBLE_DOOR_KEYS` | `<kid>:<base64 SPKI>` entries separated by spaces |
| drive `sprite.env` | `MARBLE_DOOR_NAME`, `MARBLE_DOOR_OWNER` | the name a pass must be for, and the account it must name |
| drive `sprite.env` | `MARBLE_DRIVE_GATE` | `on` (the default) or `tools` |
| door sprite `sprite.env` | `MARBLE_SERVE_COMMAND=provisioner`, `DOOR_URL`, `DOOR_ADMIN_TOKEN`, `MARBLE_DOOR_KEYS`, `MARBLE_PROVISION_SCRIPT` | above |

## Not in phase 1

Two-step sign-in (passkeys, an authenticator app, recovery codes) and the rule
that the owner must have it; Console's People view; per-drive monthly budgets;
deleting an account from the account page; a drive kept ready so sign-up takes
seconds; `marbledrive.app` on the Public Suffix List; sprite URLs made private
behind the edge; email links. The spec's "Phases" table has them in order.
