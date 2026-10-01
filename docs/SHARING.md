# Sharing a page

The passphrase opens the whole drive: every page, the agents, the shell. A
share link opens one page, at one of three levels, for someone who does not
have the passphrase. The owner makes and turns off links from **Share** in the
bar (`runtime/shell.js`); the host keeps them in `server/shares.js` and judges
every change a link files in `server/share-policy.js`.

## The three levels

| Level | Can | Cannot |
|---|---|---|
| **Read only** (`view`) | open the page and see every change as it happens | file any change, not even an id |
| **Read & write** (`edit`) | change what the page offers to change: anything under an element with an affordance marker (`data-marble-editable`, `-add`, `-sortable`, `-removable`, `-toggle`, `-choose` …), and the element a control points at with `data-marble-of` | change anything else, or add a `<style>` |
| **Read, write & modify** (`modify`) | change any part of the page: rewrite, add or remove sections, restructure, restyle | touch the page's code |

No level can, ever:

- add a `<script>`, an event handler (`on…=`), an `<iframe>`/`<object>`/`<embed>`,
  a `<meta>`/`<base>`/`<link>`, SVG's `<animate>`/`<set>`, or a host component
  (`<marble-…>`);
- point an address (`href`, `src`, `srcset` …) anywhere but `http(s)`, `mailto`,
  `tel`, a path on this host, or a `data:image/`;
- add an automation (`data-marble-run`, `-scope`, `-on`), which would start one
  of the owner's agents when pressed;
- change, move or remove a `<script>`, or any element that holds one;
- rewrite an element's `data-marble-id`, or reuse one the file already has;
- send markup that is unfinished (an open quote, tag or comment) or that closes
  the elements around where it lands.

Nor can a link open another page, the tree, the agents, the console, history or
restore, uploads, or any `/drive` route. The host allows a link exactly this
(`visitorMay` in `server/app.js`) and refuses everything else before any route
runs: `/a/<its page>`, that page's `/events`, `/presence` and (from `edit` up)
`/ops`, `/runtime/*`, `/tab/alive`, and `/blob/<hash>` for blobs its page
names.

## Why "its code stays yours" is the line

A document's scripts run with the authority of whoever is reading it, and the
owner reads with the whole drive in hand, including agents that run commands.
A link that could add a script would be a link to the owner's drive. So the
check is the same at every level, and it is what makes `modify` safe to give.

The check reads the op's own text rather than parsing it in place. The file
parses an insert where it lands; the open tabs parse it in a `<template>` and
revive any script in it (`runtime/marble.js`). Those two can disagree (CDATA in
an `<svg>`, a tag inside a `<style>`), so every tag-shaped run counts, inside
comments too. A few harmless strings are refused so that no harmful one gets
through.

## How a link works

- A link is `/s/<token>`: a 12-byte random id and a 128-bit HMAC of it under
  `.marble/shares.key` (made on the first link, mode 600). `.marble/shares.json`
  holds `{ id, path, role, made }`, with no secret in it, so the owner can copy
  a link again and the list can be read without handing links out.
- Opening it trades the token for an HttpOnly, SameSite=Lax cookie
  (`marble_share`, up to 24 links per browser) and redirects to `/a/<path>`, so
  the address bar never keeps the token and the carrier's own requests carry
  the cookie. The owner (who passes the gate) is just redirected.
- One link per level per page: **Copy link** hands back the one that is on, or
  makes it.
- **Turn off** (two presses) deletes the id. The token then opens nothing, the
  page's open event streams are ended at once, and its next change is refused
  with "This link was turned off"; its tab shows that too when it is next
  looked at.
- A link follows its page through a move or rename (`followMove`).
- The visitor's page gets no shell and no agents. `runtime/share.js` shows the
  level in the bottom-left corner, says why a change was refused, and for a
  read-only link blocks typing and puts back anything the page's own script
  tries to file.
- A drive with no passphrase is open to anyone who can reach it, links or not,
  and the Share panel says so.

## What a link does not protect against

- **Words.** A Read & write or Modify link writes text into a page the owner's
  agents may later read. Treat such text as you would an email from that
  person: it is content, not instructions.
- **A page that misleads.** A Modify link can put any words, links and layout
  on the page, including a convincing "sign in again" button that goes to
  another site. The passphrase is only ever asked for at `/gate`.
- **Within its level, anything.** An `edit` link can empty every editable
  field; a `modify` link can rewrite the page. History keeps every version
  (the owner can restore one), and the op log records the tab that filed each
  change.
- **Cost.** A link's batch is judged against the page as each op leaves it,
  which parses the page twice per op. Typing files one op at a time, so this
  matters only for a large page and a long batch.
