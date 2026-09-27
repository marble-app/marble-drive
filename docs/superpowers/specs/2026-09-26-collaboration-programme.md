# Collaboration: the programme

2026-09-26. Status: decomposition agreed with the owner in conversation; each
project gets its own spec, plan and build, in the order below.

## What the owner wants

Marble Drive apps (any `.mrbl`), and whole folders of them, shareable by link
and worked on together: several people, and each person's own agents, on the
same document at once.

- **Content is code.** Editing a Marble app means rearranging it, restyling
  it, and having agents build new components in it live. Collaborators edit
  all of it, code included. (An earlier draft limited guests to "content, not
  code"; the owner rejected it, and it is withdrawn.)
- **Disjoint work merges; overlapping work becomes versions.** Two people in
  different parts of the UI both land, code and all. Two people in the same
  space produce versions the UI shows and lets people choose between. The
  mechanism exists for a person and an agent (G3: merge on `data-marble-id`,
  forks into `<marble-alt>`); it has to grow to many people and many agents.
- **The version interface is central, and needs a large upgrade.** In
  human-human-agent work it is no longer an occasional conflict dialog but the
  main way people see each other's work.
- **The collaboration interface is designed per kind of component**: how a
  text run, a card, a table cell, a slide, a canvas shape, an agent's
  half-built component looks while someone is in it, to them and to others.

## Decisions so far

1. **Link to anyone.** A link opens one document or one folder for somebody with
   no drive and no passphrase.
2. **Isolate documents first.** Collaborators' code will run in the owner's
   browser. Before any edit link exists, a document runs with no powers of its
   own: no reach to the owner's agents, keys, drive or other documents except
   what the host grants that document. Sharing waits for it.
3. **Testers' drives first.** Proved on public drives (`t-bryan`, the
   friends'); `admin-p1` stays private to the Fly org until decided otherwise.
4. **A collaborator's agent never runs on the owner's sprite.** Agents have a
   real shell; a stranger's agent there is a stranger with a shell on the
   owner's machine. It runs on the collaborator's side (their drive, or Claude
   Code) and writes as its person. (Proposed in conversation; confirmed with
   project 4's spec.)
5. **Isolation is an invisible sandbox with passes** (approach A): each
   document is served with `Content-Security-Policy: sandbox` and holds
   per-document passes instead of the owner's cookie. It stays a normal full
   page. Chosen over a host page wrapping a sandboxed frame (stronger, far more
   rework) and over reviewing others' code before it runs. Project 1's spec.
6. **Sharing works like Google Docs, with personal links instead of
   accounts.** A Share sheet on every app and every folder: *People with
   access* (add a person by name and email, *Can view* / *Can edit*, change or
   remove each), *General access* (*Restricted* or *Anyone with the link*),
   *Copy link*, and access requests to approve. Adding a person makes a link
   that is theirs alone: whoever holds it is that person, named by the owner,
   so history and per-author undo can trust the name. On an *Anyone with the
   link* link people type their own name. Rejected: link-only (no people list,
   self-claimed names in history) and real Marble accounts (a central identity
   service; revisit when drive-to-drive sharing and "Shared with me" come).

Open: comments pinned to parts of an app (Google's third pillar). Not in any
project yet; Describe mode's marks already pin to elements.

## The projects, in order

| # | Project | Depends on |
|---|---|---|
| 1 | **Isolation.** Every document runs in an origin of its own that holds no credential; the host grants each page exactly the powers its document is allowed | nothing |
| 2 | **Share pass.** Links to a document or a folder; names and colours; a guest's view of a shared folder; full editing, code included | 1 |
| 3 | **Versions.** Attributed history (every op knows its person or agent), merge and fork for many authors, per-author undo, named versions, "what changed since I looked", and the version interface | 2 |
| 4 | **Their own agents.** A collaborator's agent writes to the shared document through its person's pass, reviewable and undoable as theirs | 2, 3 |
| 5 | **Collaboration design language.** Presence and versions drawn per kind of component, derived from the format's `affords` vocabulary so every app gets it without writing it | 2; designed alongside 3 |

`2026-09-26-shareable-apps-design.md` is the first draft of project 2, written
before decisions 2 and "content is code". Its link store, route table, names
and roster carry over; its guest guard does not.

## What was found about isolation (input to project 1)

Every call a page makes to the host goes through four transport files:
`runtime/agent.js` (`/agent/*`), `runtime/drive.js` (`/drive/*`, `/blob`),
`../marble/runtime/marble.js` (`/ops`, `/events`, `/presence`, `/docs`) and
`runtime/tab-rest.js`. The 8,000 lines of agent UI call none directly.

A page in an origin of its own loses: `localStorage` (Drive and Agents
templates, `agent.js`, `drive.js`, `agent-variations.js`, `console.js`),
`sessionStorage` (`marble.js`, `collab.js`, `agent-ui.js`,
`agent-callout.js`), cookies, and same-origin `import()` of `/runtime/*`
(`agent-ui.js`, `starters/chat.mrbl`), which then needs CORS. The clipboard
(`starters/chat.mrbl`, `console.js`) and fullscreen (`starters/slides.mrbl`)
need checking. Nothing uses service workers or `BroadcastChannel`.
