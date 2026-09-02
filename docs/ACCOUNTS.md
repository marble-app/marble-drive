# Accounts, sessions, and a drive per person

> The gate is one shared secret for one owner, and the vision is explicit that
> it gets thrown away at G2. This is what replaces it: identity, a session that
> knows whose it is, and a store rooted under a person rather than under the
> host.
>
> — the `k-gate` card, coming due

## The switch

Nothing here changes a single-tenant drive. `MARBLE_DRIVE_ROOT` on its own is
still G0/G1: one drive, one owner, the gate in front of it.

Set **`MARBLE_DRIVE_DATA`** and the host is multi-tenant. The data directory
holds every account and every person's drive:

```
<data>/accounts/accounts.jsonl     the identity log — append-only, folded on read
<data>/accounts/invites.jsonl      invite codes, and which have been spent
<data>/users/<id>/                  one person's drive root — exactly what
<data>/users/<id>/.marble/         MARBLE_DRIVE_ROOT points at today, per person
```

A `<data>/users/<id>` directory *is* a drive root in the sense every other
module already means it: `createStore({ root })` takes it unchanged, the
history tree lands in its `.marble/`, the seam does not know it is one of many.
That is the whole reason the store was named work at G1 — "a store per account
at G2 is a sibling of `fs-store.js`, not a change to a route." It turns out not
even to need the sibling: the same `fs` store, rooted a level deeper.

## Identity — `server/accounts.js`

One dependency in this whole repo, and it is not a password library. So:

- **scrypt**, from `node:crypto`, with a per-user random salt. Stored as
  `scrypt$<salt>$<hash>`, compared in constant time. The parameters are written
  next to the code and are the standard ones; a login is not a hot path.
- **Invite-gated.** `register()` refuses without a code that `mintInvite()`
  minted and nobody has spent. A research preview that anybody can flood is a
  research preview that is down. Codes carry a `uses` count, so one code can
  seat a lab.
- **Append-only JSONL**, folded on read, later lines winning — the same shape
  as `trash.jsonl` and the op log, for the same reason: a write that is only
  ever an append cannot half-happen.

```
createAccounts({ dir })
  ready()
  register({ email, password, invite })  → {id, email, created}   spends the invite
  authenticate({ email, password })      → {id, email, created} | null
  get(id) / byEmail(email)               → {id, email, created} | null
  setPassword(id, password)
  list() / count()
  mintInvite({ note, uses })             → {code}
  invites()                              → [{code, note, uses, used}]
```

`id` is 16 hex characters — a legal path segment, which is what lets it be a
folder name under `<data>/users/` with nothing to sanitise. The identity log
never leaves `<data>/accounts/`, which is *not* under any drive root, because a
file the Drive can see is a file the Drive can edit and the password hash is not
content.

## Sessions — `server/sessions.js`

The gate got one thing right that survives the rewrite: the cookie is *signed,
not stored*. No session table to grow, no restart that signs everybody out. So
the session keeps that and adds the one field the gate had no use for — whose it
is.

```
token = `<userId>.<expires>.<HMAC-SHA256(key, "<userId>.<expires>")>`
```

- `key` is `MARBLE_DRIVE_SECRET`, which stops being a password and becomes a
  signing key. **Required** when `MARBLE_DRIVE_DATA` is set — an unsigned
  multi-tenant host is every account at once.
- `identify(req)` returns the `userId` a valid cookie names, or `null`. A
  tampered payload fails the HMAC; an expired one fails the clock.
- Constant-time comparison, over hashes of both sides so a length mismatch
  leaks nothing — carried over from the gate verbatim, because it was right.

CSRF: the cookie is `SameSite=Lax`, which already keeps it off cross-site
POSTs. `sameOrigin(req)` is the belt to that suspenders — it refuses a
state-changing request whose `Origin` is set and is not the host. Read routes
do not call it; `/ops` and every `/drive/*` verb do.

## The store, per account

`createDrive` builds one `store`, one `channels`, one `oplog`, one `watcher`,
and two `Map`s (`queues`, `lastKnown`) at module scope. Multi-tenant makes each
of those per-person. The shape that keeps the routes readable is a
`userContext(id)` factory, memoised in a `Map`, holding everything that is
currently a closure variable — `{ store, oplog, channels, applyOps, putDocument,
queues, lastKnown }` — with the route handler resolving the context from the
session before it dispatches.

Two things do not divide cleanly and are called out so increment 2 does not
discover them the hard way:

- **The watcher.** `fs.watch` takes one real directory. One recursive watch on
  `<data>/users` sees every person's writes; its callback has to read the first
  path segment as the `userId`, look up that context, and reconcile within it.
  The alternative — a watcher per context — is a file handle per active account
  and a walk per login, which is worse.
- **`/events` and the drive channel.** A person's Drive is a live view of
  *their* space. The channel key becomes `(userId, docPath)`, or — simpler —
  each context owns its own `createChannels()` and the SSE route subscribes on
  the context it resolved.

## Origin isolation — `k-orig`, still the precondition

Every `.mrbl` is author-written JavaScript, and today every document shares an
origin with the host and with every other document. That is survivable while a
drive has one owner. It is **not** survivable the moment one account's document
can be opened in a tab that also holds another account's session — the
document's `<script>` can read the cookie and file ops as them.

So accounts without origin isolation is a regression, not a generation. The two
ways, and the call:

1. **Sandboxed iframe per document.** The Drive chrome is the top page; each
   document renders in `<iframe sandbox="allow-scripts">` *without*
   `allow-same-origin`, so its script runs in an opaque origin and cannot make
   a credentialed request to anything. The carrier reaches the host by
   `postMessage` to the parent, which brokers. No DNS or TLS work. Cost: the
   carrier's `fetch` calls to `/ops`, `/docs`, `/events`, `/blob` become a
   message channel — bounded, because `window.marble` is already a defined
   surface generated from `runtime/marble.js`, so it is one transport swapped
   under one API. **This is the plan.**
2. **A subdomain per document.** `<id>.docs.example` serves the document,
   `example` serves the app and the API, cookies scoped so the document cannot
   see the host's. Keeps the carrier's transport. Cost: wildcard DNS and
   wildcard TLS. Better when documents need their own shareable URL and a life
   without the host — which is the G2 sharing story, and a move to make then.

Increment 2 is the `userContext` refactor and lands behind a still-closed door.
Increment 3 is origin isolation and is what opens it.

## Quotas

Per account: a document count and a byte ceiling, both checked in `putDocument`
and `/ops` against numbers `marble-drive weigh` already computes. A signup is
gated by an invite; a drive is gated by a quota; neither is an accident waiting
for a bill.

## This increment

Lands: `server/accounts.js`, `server/sessions.js`, their tests, the config
knobs, and this document. Nothing imports the two modules yet — the same move
the op log made with `client` and `seq`, which is that the hard-to-migrate
thing goes in first and the wiring follows.

Next: `userContext` in `server/app.js` (increment 2), then origin isolation
(increment 3), then quotas and an admin subcommand for minting invites.
