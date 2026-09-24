# Running it somewhere

> Package the host, mount a volume at the drive root, put HTTPS and a domain in
> front of it. Nothing about the format changes, because the format never named a
> server in the first place.
>
> — the `k-box` card

```
cp .env.example .env      # put a real secret in it
docker compose up -d
```

The image holds the host and the Marble package. The drive is a volume. That
split is the point: nothing about a document depends on the image, so the
container can be replaced under a running drive and the files are still files.

## The gate

`MARBLE_DRIVE_SECRET` unset means an **open host** — anybody who can reach the
port can edit everything. That is right for a laptop and wrong for anything with
a domain in front of it, so the host says so at boot, every time, and
`docker compose` refuses to start without one.

With a secret set:

- `GET /gate` is a single form. It is the only HTML this host ships that is not
  a document.
- `POST /gate {"secret":"…"}` exchanges it for a signed cookie. Nothing is
  stored, so a restart does not sign anybody out and there is no session table
  to grow.
- The same secret works as `Authorization: Bearer …`, for a script or a backup job.
- `GET /health` answers before the gate, so a load balancer needs no secret.

The comparison is constant-time, over hashes of both sides so a length mismatch
leaks nothing either.

**This is thrown away at G2.** It is one shared secret for one owner. Accounts,
capability URLs and per-document policy are the next generation's work, and the
vision is explicit that building identity now would be building it before
knowing what sharing needs of it.

## From your own devices: Tailscale Serve

The drive stays on the machine it runs on, and your other devices reach it over
your tailnet. Serve holds an HTTPS certificate for the machine's tailnet name
and forwards to the host on loopback. Only devices signed in to your tailnet can
resolve or reach that name, so the gate is the second lock rather than the only
one. Funnel — the same thing, public — is deliberately not used: once an agent
runs on this machine, a passphrase form on the open internet is the whole of
what stands in front of it.

In `.env.local` (git-ignored, loaded by `npm run dev` and `npm run remote`):

```
MARBLE_DRIVE_SECRET=…     openssl rand -base64 32
PORT=4400
HOST=127.0.0.1
```

```
npm run dev                  the host, on 127.0.0.1:4400
npm run remote on            point https://<machine>.<tailnet>.ts.net at it
npm run remote check         what a device on the tailnet will see
npm run remote status
npm run remote off           this address only; anything else served is left alone
```

`remote on` refuses a host without a secret, without an explicit `PORT`, or
listening on anything but loopback. The port matters because Serve's config
lives in `tailscaled`: it survives restarts of the host and of the machine, and
a host that stepped to the next free port would leave it pointing at whatever
took this one.

The first time, Serve may not be enabled on the tailnet. `remote on` prints the
admin page that enables it; visit it once and run `remote on` again.

`remote check` asks, from this machine, the four things you would otherwise
find out on the laptop: `/health` answers, `/` without a cookie is sent to the
gate, the secret opens it, and a live event stream's first frame arrives through
the proxy (a buffered stream is a page that never hears an edit). Over https it
also checks that the gate's cookie comes back `Secure`.

The cookie is `Secure` per request: set when the request came from loopback
with `X-Forwarded-Proto: https`, which is what Serve sends, and not set on
`http://localhost` at the desk, where Safari would drop it. A forwarded-proto
header from any other address is ignored. `MARBLE_DRIVE_SECURE_COOKIE=1` still
means always.

The tailnet identity headers Serve adds (`Tailscale-User-Login`) are not used
for sign-in: anything else running on this machine can send them to loopback.

## HTTPS

Terminate in front. Anything will do — Caddy is two lines:

```
drive.example.com {
  reverse_proxy drive:4400
}
```

Set `MARBLE_DRIVE_SECURE_COOKIE=1` (the default when `NODE_ENV=production`) so
the cookie is HTTPS-only. Make sure the proxy does not buffer
`text/event-stream`; the host sends `X-Accel-Buffering: no` for nginx, and
sends a comment frame every 25 seconds so an idle-timeout proxy does not close
a stream a tab is still using.

## Backups

The documents *and* `.marble/history/`. The history is the only undo that
outlives a tab, and it is the thing nobody thinks to copy.

```
MARBLE_DRIVE_BACKUP_DIR=/backups        a bind mount, a share, or a synced path
MARBLE_DRIVE_BACKUP_MINUTES=60
MARBLE_DRIVE_BACKUP_KEEP=24
```

or, for object storage proper:

```
MARBLE_DRIVE_BACKUP_CMD=aws s3 sync "$MARBLE_DRIVE_ROOT" s3://my-bucket/drive
```

Deliberately *your* command. This host has no business holding cloud
credentials or choosing an SDK. `MARBLE_DRIVE_ROOT` and `MARBLE_DRIVE_STAMP` are
in its environment.

`marble-drive backup` runs one now. A failed scheduled backup logs and does not
take the host down.

## Restoring

A backup is a copy of the drive root. Stop the host, put it back, start the
host. There is no import step, because there was no export step.

## On a Fly Sprite

One sprite per person, each running this host as it runs on a laptop
(docs/superpowers/specs/2026-09-23-marble-drive-on-a-sprite-design.md). From
this checkout:

```
tools/sprite-deploy.sh <sprite> --org <org>            # a pushed commit, from GitHub + npm
tools/sprite-deploy.sh <sprite> --org <org> --local    # this Mac's working copies
tools/sprite-deploy.sh <sprite> --org <org> --rollback # the release before
```

- **Sources.** By default the sprite fetches `marble-drive` at `--ref`
  (default `origin/main`, which must be pushed) from GitHub and installs
  `@bdhmin/marble@<version>` from npm, so it holds no credentials. `--local`
  packs this Mac's working copies instead, for trying unreleased changes.
- **Claude Code is pinned per release** (`--claude`, default the version on
  this Mac): the host passes flags a given CLI must know. The release runs
  Claude Code's own installer, because npm on a sprite blocks install scripts.
- **Releases** live side by side in `~/app/releases/`, `~/app/current` points
  at the live one, and the last three are kept. A release that does not answer
  `/health` on a throwaway drive never goes live; one whose service does not
  come up is switched back.
- **The service** is `marble-drive` (`sprite-env services`), port 4400, drive
  at `/drive`, recreated on every switch so its settings are always the
  script's. Logs: `/.sprite/logs/services/marble-drive.log`.
- **Staying awake.** A sprite pauses about 30 seconds after its last
  connection. While an agent turn or a stem split runs, the host holds a Sprites
  task (`server/keep-awake.js`), so a turn outlives its tab.
- **Checkpoints.** Every deploy checkpoints first and prints how to restore.
- **A sprite per tester.** `tools/sprite-provision.sh <person> [--agent
  api|subscription] [--key-file <file>]` makes `t-<person>`: a passphrase and
  its own settings in `~/.config/marble-drive/sprite.env` on the sprite (kept
  across deploys, like saved API keys in `~/.config/marble-drive/agent-keys`),
  a deploy, a public URL behind the passphrase, and a note to send. The roster
  is `~/.config/marble-drive/testers.json` on the Mac. `--remove <person>`
  destroys it after a typed confirmation. `tools/sprite-deploy.sh --all`
  updates every user's sprite: those labelled `marble-tester` (testers) or
  `marble-owner` (the owner's own drive); `--all --list` shows which. A sprite
  with neither label, like a test bed, is deployed by name only. A tester's Drive and Agents pages are theirs once made:
  a deploy updates the host, the shared page code and starters, never those.
- **Signing in.** Every sprite has a Marble passphrase (`MARBLE_DRIVE_SECRET`
  in its `sprite.env`): a drive with none answers agent routes only when asked
  for as `localhost`, which a sprite's URL never is. The owner's own sprite keeps
  its URL private to the org as well ("sprite" auth), so it has both.
  Agents need a `claude login` in `sprite console` or an API key in Agents
  settings; a sprite made for someone else never carries anyone's login.

## Everything else

| | |
|---|---|
| `MARBLE_DRIVE_ROOT` | where the documents and the one `.marble/` live |
| `PORT`, `HOST` | asking for a port by name means that port; not asking means the host will step to the next free one. `HOST` defaults to `127.0.0.1`; the image sets `0.0.0.0` |
| `MARBLE_DRIVE_HOME` | the document `/` lands on. Default `drive` |
| `MARBLE_DRIVE_MAX_BODY` | 16 MB. An ops batch, or a document |
| `MARBLE_DRIVE_MAX_BLOB` | 64 MB |
| `ANTHROPIC_API_KEY` | the intent layer. Direct manipulation works without one |

## What is not here

No wildcard origin and no per-document isolation, which means **every document
in a drive shares an origin with every other and with the host**. At G0 that is
survivable because a drive has one owner and every document in it is theirs. The
moment somebody else's document can land in your drive it is not, and that is
`k-orig` — the first card of G2, and a precondition rather than a feature.
