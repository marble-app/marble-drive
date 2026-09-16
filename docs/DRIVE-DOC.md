# The Drive is a document

> `home.mrbl` already lists the folder through the carrier and pins what you care
> about into its own markup. Give it folders and it is the Drive. The browser
> being an app is the smallest test of whether any of this holds.
>
> — the `k-drive` card

`templates/drive.mrbl` is seeded into a new drive as `drive.mrbl`. It is an
ordinary document. The host has no index page; `/` redirects to it, and if you
delete it `/` falls back to whatever else is there.

## The split that makes it honest

Everything on the page is one of two things.

**Content — in the file, changed with ops, permanent.**

- the name of the drive, in the top bar
- the nav labels: My Drive, Recent, Templates, Trash — editable, sortable, removable
- the column headings in list view
- the pinned list
- the note at the bottom of the sidebar
- `data-view="grid|list"`, one attribute on `<body>`

**The listing — not in the file, not addressed, rebuilt from the folder.**

The `.items` container is `data-marble-transient`. Its rows are drawn from
`marble.drive.tree()` every time the drive changes. A Drive that stored its own
listing would have two answers to "what is in this folder" and would show you
the wrong one exactly when it mattered.

## The work and the materials

A folder holds two kinds of thing and only one of them is what you came for.

A `.mrbl` is the work: a document the Drive opens. A file that is not one — the
bibliography beside the paper, the cover images, the JSON a script reads — is the
folder's own paperwork, and so is a folder that holds nothing but paperwork all
the way down. `schemas/`, `corpus/`, `assets/`: real folders, with nothing in
them this Drive can open.

Those are drawn as **materials**: a single quiet line under the listing saying
how much is down there, folded away, and behind it a row of grey chips. Not a
tile at 80% — a tile at 80% is still a tile competing for the same glance, and
what makes something secondary is being in a different register rather than a
smaller one. So a material gets no card, no preview, no folder colour and no
weight bar: none of the identity the Drive spends on documents.

Three rules keep it honest.

- **Nothing is hidden.** A material is still an `.item` with a path and a kind,
  so the pick, the marquee, the drag, the row menu and Enter all reach it. It
  can be opened, renamed, moved and trashed. A representation that hides a file
  is a representation that loses it — which is what the Drive did before this,
  by not listing non-documents at all.
- **A folder of nothing but materials shows them.** Then the materials *are* the
  folder, so they are unfolded and there is no toggle, because a control that
  cannot change anything is worse than no control.
- **It is derived, not stored.** `isMaterial` asks the tree the host handed
  over. The one attribute it writes, `data-material`, is what both the CSS and
  the colour stamp read, so there is one answer rather than two that can drift.

The Map and the Pulse leave materials out entirely. Those are diagrams, not
listings, and neither has a bottom to hang a footnote off.

## What that buys you

Type over "Recent" and it is called something else, for good. Drag "Trash" above
"Templates" and it stays there. Pin a folder and the sidebar has an element in
it that a text editor can see. Add a column heading by hand and it is a column.

That is the claim the whole project is making, and the Drive is where it is
cheapest to check: open `drive.mrbl` in an editor and the sidebar is in it.

## Where you are is not in the file

The current folder lives in `location.hash`, not in the document. Two people in
one drive are allowed to be in different folders, and writing the path into the
file would move one of them every time the other navigated. A folder is still
linkable, which is the thing the hash was for.

`data-view` goes the other way — it *is* written to the file, because at G0 a
drive has one owner and how they like to see their drive is a preference of this
Drive rather than of this tab. When accounts arrive at G2 that decision comes
back up.

## Derived values

Two things on screen are computed rather than stored: which nav item is current,
and whether a pinned path still opens. Both are written into classes prefixed
`marble-` — `marble-current`, `marble-missing` — which is what tells the carrier
they belong to the page, so a reconcile against the file merges them back
instead of replacing them. Both are re-derived from `marble.register`, which
runs after a reconcile.

Neither files an op. A derived value that filed one would be a second copy of a
fact, and the stale copy always wins eventually.

## Touch

Every gesture a finger can make is pointer-driven: the row drag, the sortable
handles, the menus. `touch-action: none` where a drag would otherwise scroll the
page. The sortable is this repo's, not Marble's — see [GALLERY.md](GALLERY.md).

The one thing to know if you extend the drag: the listeners live on the window
for the duration of a drag, and there is no `setPointerCapture`. Capture looks
like the right tool and is not — reordering moves the item in the DOM, which
releases the capture on the first `insertBefore`. The drag then keeps working
visually and silently stops filing the op.

## The one gesture that is not

A file dragged in from outside the browser fires no pointer events at all. It
is a `dataTransfer` on `dragover` and `drop`, and there is no second way to be
handed one — so that gesture, and only that gesture, is on the HTML5
drag-and-drop API. There is nothing lost to touch by it: there is no such thing
as dragging a desktop file with a finger.

The two live side by side and mean different things. The pointer drag moves
something that is *already in* the drive; the drop brings something in. They
mark their target with the same `marble-drop` class, because to a hand they are
one gesture with a different thing in it — and where they land is decided the
same way: the folder under the cursor if there is one, the folder you are
looking at if there is not.

Three details it would be easy to get wrong:

- The listeners are on the **capture** phase. The default action of a drop
  anywhere on this page is to navigate away to the file, and a contenteditable
  label would otherwise be the thing that got it first.
- `dataTransfer.items` and `.files` are read **before the handler returns** and
  everything else waits. A DataTransfer is emptied the moment the event is over,
  and the first `await` is already too late.
- A folder is not in `.files`. Dropping one gives an empty FileList and a
  directory in `.items`, reachable only through `webkitGetAsEntry()` — whose
  `readEntries` answers in batches and signals the end by answering with none.

The overlay has a watchdog under its enter/leave count, because a drag cancelled
with Escape ends without a `dragleave` and a count that never comes back down
would leave the window under an overlay with no way to dismiss it.

## What the drop is allowed to bring in

`POST /drive/upload` asks two questions of a document arriving from outside, and
only two. Is it a document at all — a drive that will serve anything as a page
is a drive that will serve the 404 page somebody dropped by accident. And does
it still address, which it asks by running Marble's own doctor and refusing the
findings it calls errors: two nodes under one `data-marble-id` means every op
naming it edits the wrong one, silently, from then on. Everything else the
doctor notices comes back in the response as a warning and does not stop the
write — a drive that refuses to hold a document it merely has a note about is a
drive you cannot move your work into.

What it does **not** do is sandbox it. A .mrbl is an app, and this host serves
every one of them from its own origin, so a document is already trusted with the
drive's cookie and its routes. That was true of `marble-drive new` and it is
true of a drop; what a drop changes is how easy it is to be handed a document
somebody else wrote. The `marble:capabilities` line in the template is a
declaration, not an enforcement, and closing that gap is G2's problem — until it
is closed, dropping in a .mrbl is exactly as much trust as running a script
somebody sent you.
