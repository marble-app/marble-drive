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

## Everything else

| | |
|---|---|
| `MARBLE_DRIVE_ROOT` | where the documents and the one `.marble/` live |
| `PORT`, `HOST` | asking for a port by name means that port; not asking means the host will step to the next free one |
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
