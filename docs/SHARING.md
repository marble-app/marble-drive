# Sharing a page

The passphrase opens the whole drive: every page, the agents, the shell. A
share link opens one page, at one of three levels, for someone who does not
have the passphrase. The owner makes and turns off links from **Share** in the
bar (`runtime/shell.js`, below); the host keeps them in `server/shares.js` and judges
every change a link files in `server/share-policy.js`.

## The three levels

| Level | Can | Cannot |
|---|---|---|
| **Read only** (`view`) | open the page, see every change as it happens, and look around it: step, switch tabs, open notes (below) | file any change, not even an id |
| **Read & write** (`edit`) | change what the page offers to change: anything under an element with an affordance marker (`data-marble-editable`, `-rich`, `-add`, `-sortable`, `-removable`, `-toggle`, `-choose` …; the list is `MARKERS`, and a test fails when Marble's affordances or a starter wire one it lacks), and the element a control points at with `data-marble-of` | change anything else, or add a `<style>` |
| **Read, write & modify** (`modify`) | change any part of the page: rewrite, add or remove sections, restructure, restyle | touch the page's code |

No level can, ever:

- add a `<script>`, an event handler (`on…=`), an `<iframe>`/`<object>`/`<embed>`,
  a `<meta>`/`<base>`/`<link>`, SVG's `<animate>`/`<set>`, or a host component
  (`<marble-…>`);
- point an address (`href`, `src`, `srcset` …) anywhere but `http(s)`, `mailto`,
  `tel`, a path on this host, or a `data:image/`;
- add an automation (`data-marble-run`, `-scope`, `-on`), which would start one
  of the owner's agents when pressed, or pause or let go of one on a schedule
  (`data-marble-paused`), which decides whether the owner's agents run by
  themselves;
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

## Looking is not changing

Where a person is in a page (the step of a mockup, the open tab, the open
note, a row expanded) is looking. What the page says (the words, the ticks,
the rows, an answer) is changing. A level decides only changing: every level
may look, and a visitor's looking stays in their own tab.
(Design: Notes and Sketches/Drive and Sharing, "Sharing permissions", 7.)

A page says which is which, control by control:

| Control | Is | Unless |
|---|---|---|
| `data-marble-step`, `-expand`, `-choose` | looking | the control carries `data-marble-look="off"`: a choose that records an answer or a status |
| `data-marble-toggle` | changing | the control carries `data-marble-look`: a "hide what's done" |
| an op the page's own script files | changing | it is filed with `marble.op(op, { look: true })`, as the Note files its open note |

In a visitor's tab, `runtime/share.js` applies a look and never sends it, at
every level: no level refuses it, nothing snaps back, and nobody else moves.
It keeps what the visitor is looking at and puts it back on after anything
returns the page to the file (someone else's change, a refusal, an edit on
disk). In the owner's tab the carrier files a look like any change, so a link
opens where the owner left it. This differs from `marble.pageOnly`, which keeps
an attribute out of the file for everyone, owner included.

The host does not take a link's word for it: a look never reaches it, and
anything that does is judged by the level as before. The marker list it judges
by is `MARKERS` in `server/share-policy.js`, which a test keeps in step with
what Marble's affordances and the starters wire (`data-marble-rich` for the
Note's and Doc's text, `data-marble-code` for a paper's source).

How it settles the questions the design left open:

- **A visitor's looking does not outlast the tab.** A reload opens where the
  file is, which is where the owner left it. Nothing is kept in storage.
- **A visitor follows the owner until they move.** The owner's looking is saved
  and sent, so a visitor's step, tab or note follows the owner's until the
  visitor moves that one control themselves; from then on that one is theirs
  until they reload. There is no Follow switch yet.
- **Looking is not an undo step** in a visitor's tab, so Mod+Z never files one.
  The owner's tab records what it always did.
- **No migration.** A page already shared needs no change for its steps,
  expands and tabs: `share.js` reads them off the controls, so a page whose
  affordance script predates the flag works too. Only a page's own script has
  to say `{ look: true }`. The Note says it for its open note, which it now
  keeps on the notes rather than on `<body>`, and reads from `<body>` in a
  notebook made before.
- **What a visitor sees is unchanged.** Hiding chrome a level cannot use
  (`data-marble-needs`), opening a spot to answers (`data-marble-open`) and
  holding a region (`data-marble-hold`) are later steps of the design.

## The Share panel

**Share** in the bar opens one panel for the page you are on:

- Three levels as a radio group, Read only chosen to begin with. A level whose
  link is out says **Link on** on its row. Opening the panel on a page that
  already has a link out chooses the newest one, ready to copy again.
- One **Copy link** for the chosen level. The first press makes the link and
  copies it; the button says **Copied** where it was pressed. If the browser
  refuses the clipboard, the link is left selected for ⌘C.
- Under it, when that level's link is on: when it was made, when someone last
  came in by it (or "not opened yet"), and **Turn off** (two presses).
- A warning in caution ink when the link would open only here: the drive is
  open at `127.0.0.1`, `localhost` or a private network address and has no
  public address (below).
- **Your own link**, last and quiet: the page's ordinary address, which asks
  for the passphrase.

Each level is its own link on purpose. Handing one person Read & write never
raises what a Read only link already out there can do; to take a level back,
turn that link off.

## The address a link is written at

A link is written against `MARBLE_DRIVE_PUBLIC_URL` when the drive has one
(`server/config.js`; an http(s) origin, anything after it dropped), and
against the address the owner has the drive open at otherwise. A drive at home
on the Mac is opened at `http://127.0.0.1:4401`, which nobody else can reach,
so its `~/.config/marble-drive/mac-<name>.env` sets
`MARBLE_DRIVE_PUBLIC_URL=https://<name>.marbledrive.app`. A sprite is opened at
its own URL, which is already the address to hand out (admin-p2's is private
to the Fly org, so links to it open only for someone signed in to Fly).

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
  holds `{ id, path, role, made, opened }`, with no secret in it, so the owner
  can copy a link again and the list can be read without handing links out.
  `opened` is the last time someone without the passphrase came in by the
  link (noted at most once a minute; the owner following it does not count).
  The file is read once and written one write at a time, so links made at the
  same moment are all kept.
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
  level in the bottom-left corner (pressed, it says what the level lets them
  do), says why a change was refused, keeps the visitor's looking in their tab
  (above), and for a read-only link blocks typing and puts back anything else
  the page's own script tries to file.
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
