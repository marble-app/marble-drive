# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person, who owns the drive and everything in it. At G0 a drive has one owner,
one shared secret, and no notion of anybody else — the view preference is stored in
the drive document itself because there is only one person to store it for.

That person is a researcher and builder keeping their working life in files they
own: papers in progress, a research vision, a pattern atlas with its corpus and
tooling, travel plans, a run of daily documents. They are technical enough to run a
Node host and open a `.mrbl` in a text editor, and they do both — hand-editing the
file is a first-class path into the product, not a fallback.

The single-owner shape is transitional. Accounts, per-tenant stores and origin
isolation are the next generation (`docs/ROADMAP.md`), so future work should not
treat one-owner as a permanent premise, and should not spend effort defending it
either.

## Product Purpose

Marble Drive is a drive of `.mrbl` documents, in folders, served by a host that runs
each one as a page rather than previewing it. "Google Drive, but every file in it is
the app."

It exists to be a real tool its owner uses daily *and* the cheapest place to check
the claim Marble makes. Those are one job, not two: the thesis is only credible if
someone's actual research and travel and daily notes live in it, and the thesis is
what makes the tool worth building rather than using Drive. The Drive's own
interface is `drive.mrbl`, an ordinary document in the drive it lists — so the
sidebar, the headings and the pinned list are content you can edit by hand, and the
proof is one text editor away.

Success is that the owner reaches for it without thinking about it, and that
anyone who doubts the claim can open the file and settle it.

## Positioning

Modifying the interface is modifying the code. Not an app with an edit feature that
happens to write a file — the gesture *is* the source edit, spliced into the bytes
of a self-contained HTML file as a semantic op.

The parts a neighbouring product could not truthfully copy, together:

- **There is no somewhere else.** No database, no state layer, no separate document
  model. The file is the picture and the picture is the file.
- **Ops splice byte ranges, never whole documents.** The patcher deliberately never
  calls `outerHTML`, because the op is the unit of undo, merge, review and a
  readable diff, and a whole-file rewrite destroys it.
- **The host is a carrier, not a framework.** It offers addressing and
  code-changing and nothing else, ships no interface beyond the gate form, and
  injects no affordance. Any two hosts must render the same file identically.
- **No document names infrastructure.** Not a route, not a server, not a framework.
  Every fetch belongs to the host, reached through `marble.drive`.
- **External writers reconcile without a reload.** A text editor or an agent
  writing the file moves the open page under you, cursor and scroll intact.

Ordinary file managers preview a document or hand it to an application. A local-first
app syncs a database. Neither can offer the one thing here: the artifact you keep and
the program you ran are the same bytes.

## Operating Context

- **Self-hosted.** `npm run dev` on a laptop with no secret; a shared secret for
  anything with a domain; Docker with the host in the image and the drive on a
  volume. Node 22 or newer.
- **Three writers, one file.** The person in the page, the person in a text editor,
  and an agent — all writing the same document, reconciled live over SSE. The
  client that filed an edit is not echoed its own change.
- **The drive is not in the repo.** A drive belongs to whoever runs the host, so
  `drive/` is gitignored and the first run seeds one document into it: the Drive
  itself, from `templates/drive.mrbl`.
- **Documents arrive by starter, by drop, or by agent.** Seven starters (doc, sheet,
  slides, board, canvas, paper, latex), drag-in upload including folders, and skills
  that compose documents directly.
- **Folders hold more than documents.** LaTeX sources, bibliographies, JSON corpora,
  build scripts and image assets sit beside the `.mrbl` files as the folder's own
  paperwork.

## Capabilities and Constraints

Confirmed and working: nested folders; seven starters; drag-in upload of files and
folders; live multi-tab sync and external-edit reconcile; gzipped history before
every write; pin, rename, copy, download, trash and restore; blob extract and
flatten; per-folder colour; six ways to look at a folder (grid, list, timeline, map,
pulse, weight); a shared-secret gate; backups; the `marble-drive` CLI; Docker deploy.

Rules that hold everywhere, each because breaking it would put one fact in two
places:

- A document names no route, no server, no framework.
- The listing is never stored in the drive file — a drive that stored it would have
  two answers to what is in this folder.
- A derived value files no op; it would be a second copy of a fact.
- Nothing above the store names the filesystem.
- The host ships no interface and injects no affordance.
- Writes are serialized per document.
- Starters are never upgraded. Somebody's spreadsheet is theirs, including its bugs.
- Materials are quieted, never hidden: still reachable by pick, drag, menu and Enter.

Known limits, recorded rather than solved:

- `marble:capabilities` is a declaration, not an enforcement. Closing that gap is G2.
- All documents share one origin. Survivable for one owner; not once someone else's
  document can land in the drive.
- A dropped `.mrbl` is trusted the way running a script is trusted. It is not
  sandboxed.
- The op log is written and nothing reads it yet.
- History has no interface.
- Shared links break on rename.
- Externalized blobs sit in tension with "one file, one app"; flatten is always
  available as the answer.

Undecided: the supported browser matrix has never been stated.

## Brand Commitments

**Marble Drive** in prose; `marble-drive` as the package and command; **Marble** for
the format and machinery; `.mrbl` for a document.

The writing argues through architecture. It states a constraint and then says why it
exists, in complete sentences, with almost no adjectives — "A drive that stored its
own listing would have two answers to what is in this folder." Negative definitions
do real work: what the host does *not* ship, what a document may *not* name. Copy
explains a decision rather than selling a feature, and the same voice runs through
the README, the docs and the comments inside `drive.mrbl`.

A document's label is its name in the folder, because that is its address — not the
`<title>` inside it. The two are allowed to disagree after a rename, and the tooltip
is where that disagreement is shown.

## Evidence on Hand

- **A populated working drive** (gitignored, on the owner's disk): 22 active
  documents across Research, Travel, Fun and a run of daily documents, plus 26 in
  the trash, real history and real blobs. The Research folder carries a full working
  project — a pattern atlas with a 16-file JSON corpus, schemas, generation tooling
  and LaTeX paper sources.
- **The Drive's own interface**, `drive.mrbl`, roughly 180 KB, editable by hand.
- **Seven starters** in `starters/`, each a self-contained file.
- **141 passing tests** across 13 files, on ephemeral temp drives rather than
  committed fixtures.
- **A daily-document skill** that composes a themed `.mrbl` per day.

No customers, no benchmarks, no press, no pricing, and no third-party deployments.
Future work must not invent any.

## Product Principles

1. **One fact, one place.** Every bug worth the name here is the same fact written
   twice with nothing keeping the copies honest. Derive the second appearance or
   delete it.
2. **The file is the product.** Anything that cannot survive being opened in a text
   editor, hand-edited and reconciled is not finished — including the Drive's own
   interface.
3. **Prove it where it is cheapest to check.** Prefer the demonstration a doubter can
   verify in one step over the explanation they have to trust.
4. **Quiet, never hidden.** Secondary things lose their salience and keep every
   capability. Reducing what something looks like is not permission to reduce what
   it can do.
5. **Constraints are load-bearing, and they are explained.** A rule ships with the
   reason it exists, so the next person can tell a decision from an accident.

## Accessibility & Inclusion

Two commitments, both because the alternative makes a gesture unreachable rather
than merely awkward:

- **Full keyboard operation.** Every control is a real button or carries its role,
  tab stop, Enter/Space handling and ARIA state. Enter opens, Delete trashes, Escape
  backs out. A menu you can only find with a pointer is a menu the keyboard does not
  have.
- **Touch parity.** Every gesture a finger can make is pointer-driven, and anything
  revealed on hover has a focus twin and an answer for `hover: none`. The one
  exception is dragging a file in from the desktop, which has no touch equivalent to
  match.

Screen-reader support is best-effort: correct semantics and labels are expected,
verification against a real screen reader is not yet part of the work.
