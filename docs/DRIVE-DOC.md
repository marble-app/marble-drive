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

Every gesture is pointer-driven: the row drag, the sortable handles, the
menus. `touch-action: none` where a drag would otherwise scroll the page. The
sortable is this repo's, not Marble's — see [GALLERY.md](GALLERY.md).

The one thing to know if you extend the drag: the listeners live on the window
for the duration of a drag, and there is no `setPointerCapture`. Capture looks
like the right tool and is not — reordering moves the item in the DOM, which
releases the capture on the first `insertBefore`. The drag then keeps working
visually and silently stops filing the op.
