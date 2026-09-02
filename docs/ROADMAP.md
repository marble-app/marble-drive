# This repo against the five generations

The plan is [`ecosystem-vision.mrbl`](../../marble/apps/ecosystem-vision.mrbl).
This is what of it exists here, card by card. `TODO.md` is the working list;
this is the map.

## G0 — Hosted for one

| card | | where |
|---|---|---|
| `k-loop` | The loop, over a network | `server/app.js`, `POST /ops` → guard → snapshot → atomic write → echo |
| `k-echo` | Who the echo is for | `server/sse.js`, `toDocument({except})`. Tested from both sides |
| `k-box` | A container and a disk | `Dockerfile`, `docker-compose.yml`, volume at `/data` |
| `k-gate` | One gate, not an account system | `server/gate.js`. Constant-time, signed cookie, thrown away at G2 |
| `k-back` | Backups off the box | `server/backup.js`. Documents *and* `.marble/history/` |
| `k-hist` | Fold the two history trees into one | `server/config.js` points Marble's history at the drive root. One `.marble/` |
| `k-ord` | Ops that can be ordered later | `server/oplog.js`. `client` and `seq` alongside `t` |
| `k-touch` | Touch | `lib/affordances.drive.js` overrides `sortable`; every drag a finger can make is pointer-driven. The one exception is a file dragged in from outside the browser, which fires no pointer events and cannot be made by a finger — see [DRIVE-DOC.md](DRIVE-DOC.md) |
| `k-wt` | Measure what a document weighs | `marble-drive weigh`, and `GET /drive/weigh` |

## G1 — The Drive

| card | | where |
|---|---|---|
| `k-seam` | The storage seam | `server/store/`. No route names the filesystem |
| `k-path` | Nested paths | `server/paths.js` |
| `k-watch` | A watcher that sees into folders | `server/watch.js`, recursive, with a walking fallback for platforms without the flag |
| `k-tree` | The listing becomes a tree | `/docs` flat for the carrier, `/docs?tree=1` and `/drive/tree` nested. Proposed for the surface in `docs/CARRIER-DRIVE.md` |
| `k-gal` | The template gallery | `server/gallery.js`, `starters/`. Five of them |
| `k-blob` | Blobs, with a way back | `server/flatten.js`, `server/store/blobs.js`. The round trip is byte-exact |
| `k-drive` | A Drive that is itself a document | `templates/drive.mrbl` |

## G2 — isolation, accounts, sharing (in progress)

Being built on `worktree-multi-tenant-g2`. The plan and the disk layout are in
[ACCOUNTS.md](ACCOUNTS.md).

| card | | where |
|---|---|---|
| `k-acct` | Identity, invite-gated, scrypt over an append-only log | `server/accounts.js` |
| `k-sess` | A session that knows whose it is — the gate's signed cookie, plus the account id | `server/sessions.js`, `sameOrigin` for CSRF |
| `k-tenant` | A store per person at `<data>/users/<id>/` | `MARBLE_DRIVE_DATA` in `server/config.js`; the `userContext` refactor of `server/app.js` is increment 2 |
| `k-orig` | Each document in its own origin | increment 3 — sandboxed iframe + a `postMessage` carrier. The precondition that opens the door |
| `k-quota` | A document ceiling and a byte ceiling per account | `quotaDocs` / `quotaBytes` in config; checked in `putDocument` at increment 2 |

Increment 1 lands the two hard-to-migrate modules and the config, imported by
nothing — the same move the op log made with `client` and `seq`.

**G3 — collaboration and versions.** Ops are broadcast as "something changed"
rather than as ops, so a second tab refetches and reconciles rather than
applying a move. The history exists and has no view. Both are the next
generation's work, and both are cheaper for the op log carrying `client` and
`seq` already.

**G4 — local-first, desktop, agent as peer.** `oplog.since()` is written and
tested and nothing reads it. That is the shape the vision asked for: the two
fields are free now and a migration later.

**G5 — shared drives.** Needs every other one to be true first.

## Where this disagrees with the Marble spec

The repository's own `SPEC.md` carries a three-version roadmap that the vision
splits into five generations and reorders — most visibly by pulling op-log
ordering forward to G0 and treating the storage seam as named work. This repo
follows the vision. Reconciling the two is a job for whoever ships G0, and it is
being done here rather than written down a third time.
