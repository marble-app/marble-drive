# Shareable apps: a link to one document, used live together

2026-09-26. Status: design, approved in conversation; spec awaiting the
owner's review before a plan.

## Why

A drive has one person in it. Everything a Marble app can do (Mashup Studio,
a board, a paper, the Chat app) it does for its owner alone, behind one
passphrase that grants everything. The owner wants apps to be **shareable and
collaborative**: send someone a link to one app, they open it with no drive
and no passphrase, and the two of them use it at the same time.

Collaboration *inside* a drive already works (G3, `ROADMAP.md`): tabs, agents
and a text editor all write one `.mrbl`, disjoint writes both apply,
overlapping ones fork into `<marble-alt>`, presence is drawn
(`runtime/collab.js`, `@bdhmin/marble/collab`). What is missing is everyone
else: a way in scoped to one document, knowing who each person is, and safety.

## Decisions the owner made

1. **Link to anyone.** The first situation is a link to one app, opened by
   anybody: a tester, a stranger, someone with no drive. Not drive-to-drive
   sharing, not publish-and-remix. Those can follow; nothing here blocks them.
2. **Guests change content, not code.** In Marble, editing a document is
   editing its code. A guest who could write a `<script>` would run it, next
   time the owner opens the app, with the owner's whole session: agents, keys,
   every document. So a guest's write that adds or alters anything executable
   is refused. Guest code edits wait for origin isolation (`k-orig` in
   `ACCOUNTS.md`), which becomes the next step when they are wanted.
3. **Testers' drives first.** Sharing is built and proved on drives whose URLs
   are already public (`t-bryan`, the friends'). `admin-p1` stays private to the
   Fly org, so its links open only for org members until the owner decides how
   his own drive should share (open its URL, or a relay sprite; both were laid
   out and deferred).

## Decided in design, with reasons

- **One approach: a share pass on the owner's own host.** Rejected: a separate
  public host holding a synced copy (a second merge engine, two copies that can
  disagree), and isolating documents first (only needed for code edits, which
  are deferred). The pass reuses G3's merge, forks and presence unchanged.
- **Guests get no agents.** The owner would pay for them, and an agent's whole
  job is writing code. `/agent/*` refuses a guest and the agent scripts are not
  injected into a guest's page. The owner's own agents still work in the app
  while guests are there; guests see them as the agent zone they already are.
- **A guest's visit wakes the owner's sprite, and counts.** That is what a link
  to a machine means. Guest tabs rest exactly like the owner's
  (`runtime/tab-rest.js`), and the ledger gains a `guests` count in `why` so
  the Console can tell a guest-kept minute from the owner's.
- **Links do not expire.** They last until revoked. Revoking is immediate.
- **The document's path is visible to a guest** (it is in `?app=` on every
  carrier request). Hiding it means a second addressing scheme through the
  carrier; not worth it now. Stated in the share sheet.
- **Nothing is added to `drive.mrbl` or `agents.mrbl`.** Existing users' pages
  are theirs (CLAUDE.md). Everything the owner needs lives in injected runtime.

## Design

### 1. Links: `server/shares.js`

A link is `{ id, doc, role, created, revoked }` with `role` `view` or `edit`.

- Kept in `<drive>/.marble/shares.jsonl`, append-only and folded on read,
  later lines winning: the same shape as `trash.jsonl` and the op log, so a
  write cannot half-happen. Held in memory, reloaded after its own writes.
- The token is 32 bytes from `crypto.randomBytes`, base64url. Only
  `sha256(token)` is stored, so the file on its own opens nothing. `id` is the
  first 12 hex characters of that hash: how the owner's sheet and the log name
  a link without holding the token. The token itself is shown once, when the
  link is made, and after that only the owner's browser has it (the sheet keeps
  it in `localStorage` so it can copy it again; losing it means making a new
  link, never recovering the old).
- The URL is `https://<drive>/s/<token>`.
- `create({ doc, role })`, `find(token)` (constant-time over the hash),
  `list({ doc })`, `revoke(id)`, `moved(from, to)`, and `trashed(doc)` /
  `restored(doc)`.
- **Move** rewrites each live link's `doc` (a line per link). The Drive's
  `/drive/move` calls it, for a document or a folder prefix.
- **Trash** leaves links in place but a trashed document is not served, so the
  link answers "no longer shared"; `/drive/untrash` brings it back.
- **Revoke** appends `{ id, revoked: <t> }` and closes that link's open
  streams at once (the streams are tagged with the link id, section 2).

### 2. What a guest can reach: `server/guest.js`

Decided in front of the gate, after `/health`, the favicon and `/gate`:

1. `GET /s/<token>`: find the link. None, revoked, or its document gone: a
   plain 404 page, "This link is not shared any more." Otherwise serve the
   document with the guest's carrier (section 5) and set
   `marble_share=<token>[,<token>…]` (the tokens this browser holds, newest
   first, at most 20): `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the
   gate's cookie is, a year long.
2. Any other request with no valid gate cookie but a `marble_share` cookie:
   resolve the pass as the link in the cookie whose `doc` is the request's
   `?app=` (blobs: section 2.4). Then allow only:

   | Route | view | edit | Condition |
   |---|---|---|---|
   | `GET /runtime/*` | yes | yes | always (no document named) |
   | `/events?app=<doc>` | yes | yes | stream tagged with link id and guest name |
   | `GET /presence?app=<doc>` | yes | yes | |
   | `POST /presence?app=<doc>` | yes | yes | same origin |
   | `POST /tab/alive` | yes | yes | |
   | `GET /docs` | yes | yes | answers only the shared document |
   | `POST /ops?app=<doc>` | no, 403 "view only" | yes | same origin, guest guard (section 3), size cap |
   | `GET /blob/<hash>` | yes | yes | the hash appears in a document one of the cookie's links names |

   Everything else answers 403 `{ error: "not shared with you" }`, including
   `/agent/*`, `/console/*`, `/drive/*`, `/history`, `/restore`, `/intent`,
   `/zoom`, `/stems*`, `/usage`, TypeSafe and GenUI routes, `/a/*` and `/`.
   A request with the gate's own cookie is the owner's and never reaches this
   module past `/s/`: the owner opening their own share link is redirected to
   `/a/<doc>` and gets the owner's page.
3. **The route table is the policy.** `guest.js` exports it as data, and a test
   walks every `route` the host answers in `app.js` and requires each to be
   either in the table or refused, so a route added later is refused for guests
   until someone decides otherwise.
4. The carrier names blobs as `/blob/<hash>`, with no document. A guest may
   fetch a blob when its hash appears in the current source of any document one
   of the cookie's live links names, and never otherwise. Hashes are
   content-addressed and unguessable, so this is a check that the guest was
   shown the blob, not that they could not find another.

### 3. Content, not code: `server/guest-guard.js`

A pure function, `checkGuestOps(source, ops) → { ok } | { refused }`, run as
`applyOps`'s `prepare` hook for guest writes, against the document as it is
inside the write queue, so nothing lands between the check and the write.

It parses the current source and each op's `html` with the patcher's own
parser (`parseSource` from `@bdhmin/marble`), and refuses the whole batch with
a plain reason if any op would:

- **Add code.** `html` (in `setInner`, `insert`) containing an element named
  `script`, `style`, `iframe`, `frame`, `frameset`, `object`, `embed`,
  `applet`, `base`, `meta`, `link`, `template`, `noscript`, `portal`, or SVG
  `script`, `foreignObject`, `animate`, `set`, `animateTransform`,
  `animateMotion`, `handler`, `use` with an external href; any attribute whose
  name starts with `on`; `srcdoc`; `formaction`; any URL attribute (`href`,
  `src`, `action`, `xlink:href`, `data`, `poster`, `background`, `ping`,
  `srcset` entries) whose value, with whitespace and control characters
  removed and lowercased, starts with `javascript:`, `vbscript:` or
  `data:text/html`, `data:image/svg`, `data:application`.
- **Set code.** `setAttr` with any of those attribute names or values, or on an
  element that is itself one of those elements.
- **Change code in place.** Any op whose target (`id`, `parentId`) is, or is
  inside, one of those elements or `<head>`.
- **Remove or move code.** `remove` or `move` of a subtree containing one of
  those elements (the app would break under its owner, which is a code change
  by subtraction).
- `assignId` is allowed: it only adds a `data-marble-id` so a gesture can
  name what it is about to point at. Shapes and unknown op types are still
  checked by Marble's own guard, which runs after this one.

Everything else applies: text, attributes other than the above (including
`style="…"`, which runs no script in any current browser), structure made of
ordinary elements, moving and removing ordinary elements.

**Size.** A guest write that would leave the document larger than
`MARBLE_DRIVE_GUEST_MAX_DOC_BYTES` (20 MB) is refused, so a public edit link
cannot fill the disk. Each request body is already capped by
`config.maxBodyBytes`.

**The cost, stated.** An app that keeps its state by writing `on*` handlers or
`<script>` blocks cannot be edited by a guest; its gestures are refused and
the carrier puts the page back (`marble.js`: a refusal resyncs to the file and
reports the reason). Apps written the Marble way, with behaviour in one script
and state in addressed markup, work.

### 4. Who is here: presence with names

- **A guest's name.** The first time a browser opens a link on a drive, the
  page asks for a name in a small sheet ("What should people see you as?"),
  with *Skip* giving "Guest". It is kept in a `marble_name` cookie on that
  drive (not `HttpOnly`: the page reads it), and can be changed from the strip.
- **The owner's name** is `ownerName` in `.marble/drive.json`, set from the
  share sheet the first time a link is made (default "Owner").
- **Colour** is derived from the name (a hash into a fixed set of eight hues
  that read in both themes), so a person keeps their colour across visits.
- **The roster.** `/events` takes `name` in its query; the channel keeps
  `{ client, name, colour, role, link }` per connection and broadcasts a
  `roster` event on the document's channel whenever someone joins or leaves.
  Agents already appear as zones and stay as they are.
- **Presence frames** carry `name` and `colour` alongside `{ client, ids }`,
  added by the host from the connection so a page cannot claim another name
  per frame. `collab.js` washes a person's ids in their colour (it uses the
  accent today) and names them on hover.

### 5. The page: `runtime/share.js`, and a guest's carrier

**Injected for the owner** (the gate's cookie, not `/s/`), with the other
runtime: a **Share** tool in the agent tray (`runtime/agent-ui.js`'s tray, the
bottom-right launcher). A host with agents off has no tray; there `share.js`
mounts the same tool as its own small button in that corner. It opens a sheet:

- Make a link: *Can view* / *Can edit*, and **Copy link**. The first time,
  ask for the owner's name.
- Links on this document: role, when made, who is on it now (from the
  roster), **Copy** (if this browser made it) and **Stop sharing**.
- One line of truth: "Anyone with an edit link can change this app's content,
  not its code. They can see its name and folder."
- On a drive whose URL is private (`admin-p1`), the sheet says links will open
  only for members of the Fly org. The host knows from a setting,
  `MARBLE_DRIVE_URL_PRIVATE=1`, added once by hand to admin-p1's `sprite.env`;
  testers' drives are public and leave it unset.

**Injected for a guest** instead of the owner's list: `tab-rest.js`,
`marble.js`, `affords.js`, `collab.js`, `share.js`. No `drive.js` (its verbs
are all refused), no agent scripts, no tray, no Console. `share.js` in guest
mode draws:

- **Who is here**: a small strip of names in their colours, top-right, and a
  way to change one's own name.
- **View only**: on a view link, a write the host refuses with "view only" is
  shown once as a quiet "You can view this app, not change it", instead of the
  carrier's error.
- **Refused as code**: shown as "This change edits the app's code, which only
  its owner can do."
- **Link revoked**: the stream closes with a `revoked` event; the page says
  "This link was stopped by its owner" and stops filing ops.

### 6. Where each piece touches existing code

| File | Change |
|---|---|
| `server/shares.js` | new |
| `server/guest.js` | new: the pass, the route table, the cookie |
| `server/guest-guard.js` | new: `checkGuestOps` |
| `server/app.js` | call `guest` before the gate; guest variant of `injectCarrier`; `/ops` passes the guard as `prepare` for guests; `/drive/move`, `/drive/trash`, `/drive/untrash` tell `shares`; `POST /share`, `GET /share?app=`, `POST /share/revoke` (owner only, same origin) |
| `server/sse.js` | per-connection `{ name, colour, role, link }`, a `roster` event, close by link id |
| `server/ledger.js` | `why.guests` |
| `server/drive-settings.js` | `ownerName` |
| `runtime/share.js` | new |
| `runtime/collab.js` | a person's colour and name on presence |
| `runtime/agent-ui.js` | register the Share tray tool |
| `server/config.js` | `MARBLE_DRIVE_GUEST_MAX_DOC_BYTES`, `MARBLE_DRIVE_URL_PRIVATE` |
| `docs/HOSTING.md`, `docs/HOSTING-DECISIONS.md`, `docs/ROADMAP.md` | sharing, decision 22, G2 card |

Nothing in `../marble` changes. If the guard proves general, it can move into
the package as "what in this op is code", but not before a second host needs it.

## Guards

Things the tests must meet that ordinary use would not:

- **Spellings of code**: `JaVaScRiPt:`, `java\tscript:`, `&#106;avascript:`
  (the parser decodes entities; the check reads the decoded value),
  `<svg><script>`, `<math><mtext><style>`, `onClick`, `ONLOAD`, `srcset` with a
  `javascript:` entry, `<a href=" javascript:…">`.
- **Code by location**: `setText` on an addressed `<script>`, `setAttr src` on
  a `<script>`, an `insert` whose `parentId` is in `<head>`, a `move` of a card
  that contains a `<style>`.
- **Allowed**: a card inserted with `style`, `class`, `data-*`, an `<a
  href="https://…">`, an `<img src="/blob/…">`; `setText` on a heading;
  reordering cards; removing a card.
- **The pass**: a view token on `/ops` (403), an edit token for document A on
  `/ops?app=B` (403), a revoked token mid-stream (closed), a token after its
  document moved (still works at the new path), a trashed document (404 page),
  the owner's cookie plus a share cookie (owner wins), a forged cookie value
  (403), a cross-origin `POST /ops` with a valid pass (403).
- **Every route**: the table test over every route in `app.js` (section 2.3).
- **Live, two browsers**: owner and guest on one document; the guest's card
  edit appears on the owner's page with the guest's name; a guest's attempt to
  add a `<script>` is refused and rolled back on the guest's page and never
  reaches the owner's; revoking cuts the guest off within a second.
- **The real thing**: on `t-bryan`, a link opened in a private window with no
  passphrase, from a phone as well as a laptop.

## Testing

- Unit: `test/shares.test.js`, `test/guest-guard.test.js` (a table of allowed
  and refused ops, including every spelling in Guards).
- Integration: `test/guest-routes.test.js` against a real host on a temp drive
  (every route × owner, view pass, edit pass, wrong-document pass, no pass).
- Browser: `test-browser/share.test.js`, two Playwright contexts.
- On a sprite: `tools/sprite-deploy.sh t-bryan --local`, then the owner opens a
  link on his phone.

## Out of scope

- Guests changing code, and the origin isolation that would allow it.
- Sharing between drive owners, and a document appearing in someone else's
  drive.
- Publish-and-remix (a guest taking a copy into their own drive).
- Guests using agents.
- How `admin-p1` shares (public URL or relay).
- A "shared" badge in the Drive listing (needs a template change, which reaches
  new drives only).
- Expiring links, passwords on links, per-guest revocation (revoke the link and
  make a new one).
- Guest uploads (`POST /blob`) and files referenced from elsewhere in the drive
  (`/drive/file`): an app that plays a song from the drive will not play it for
  a guest.
