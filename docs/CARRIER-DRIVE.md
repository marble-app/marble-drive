# `marble.drive` — a proposal for the carrier surface

Marble's carrier answers the question a *document* has: address a node, file an
op, hear that the file moved, ask what documents exist. It is the whole contract
between a document and its host, and the reason two hosts render the same file
identically.

A Drive has a second question, and no member of that surface answers it: make a
folder, clone a starter, move this, throw that away. So this repo's host injects
a second script that adds `window.marble.drive`.

It is a **namespace rather than new top-level members** on purpose. Everything
under it is a proposal, not part of the surface, and a document can tell the
difference by checking whether it is there:

```js
if (!window.marble?.drive) return;   // a host with no Drive under it
```

The `k-tree` card is explicit that this is the shape of the change:

> `marble.docs()` gains a shape, which makes this a change to the carrier surface
> rather than to one host — so `carrier.md` regenerates and every host has to
> answer the same way.

## The members

| | |
|---|---|
| `marble.drive.tree(folder = '')` | the folder, nested. Falls back to an empty drive rather than throwing |
| `marble.drive.starters()` | what you can make |
| `marble.drive.create({path, from, copy})` | a document from a starter, or a copy of another document |
| `marble.drive.mkdir(path)` | |
| `marble.drive.upload({folder, name, source})` | a document from outside the drive. The body is the document itself, not JSON with one inside it; `name` is what it was called where it came from, and the host is what decides what this drive can call it |
| `marble.drive.move(from, to)` | rename and move are one verb, because on a folder they are one operation |
| `marble.drive.remove(path)` | to the trash, not to nowhere |
| `marble.drive.trash()` | what is in it |
| `marble.drive.restore(id, to)` | |
| `marble.drive.weigh(path)` | bytes, nodes, and how much of it is base64 |
| `marble.drive.downloadHref(path)` | one self-contained file, blobs inlined |
| `marble.drive.fileHref(path)` | where a `kind: 'file'` entry lives — the one address in the drive that is not a document's, so its path carries its extension |
| `marble.drive.on(event, fn)` | `created`, `changed`, `moved`, `trashed`, `restored`, `removed`, or `'*'` |
| `marble.drive.resolveBlobs(root)` | resolve `data-marble-blob` to a source. Registered already; exposed for a document that inserts markup itself |
| `marble.drive.client` | this page's id, so the Drive can ignore its own echoes |

## What stays true

**A document still names no route.** Every fetch in `runtime/drive.js` is the
host's, not the file's. `templates/drive.mrbl` contains no path, and there is a
test that says so.

**The host decides what a file is safe to render.** `fileHref` hands back an
address and nothing else. Whether the bytes behind it come back as a picture you
look at or a download you save is the host's call, made against a short
allowlist of types — because a file served under a type the browser executes is
a script running on the drive's own origin with the drive's own cookie. A
document asking for the href is deliberately not making that call, and could not
make it correctly if it wanted to.

**The blob resolution is page-only.** A document whose heavy bytes have been
extracted carries `data-marble-blob="<hash>"` and a placeholder `src`. The
carrier extension sets the real `src` on the page and never files it — writing a
route into the file would be the document naming this server, and the flattened
copy has no attribute pointing anywhere at all.

It re-resolves through `marble.register`, which the carrier calls for newly
inserted subtrees and again over the whole body after reconciling against the
file — which is exactly when a resolved `src` has just been replaced by the
placeholder the file holds. Deliberately *not* `marble.pageOnly('src')`: that
would make every `src` in the document page-only, including the ones a person is
entitled to edit.

## What would have to happen to upstream it

1. `marble.docs()` returns entries carrying `path` and `folder`, and `/docs?tree=1`
   answers nested. Both are true of this host already, and a flat-namespace host
   can answer with `folder: ''` for everything.
2. The verbs above become optional members of the surface, with the same
   "absent means no host for this" convention the whole carrier already uses.
3. `carrier.md` regenerates, and every host answers the same way or says it
   cannot.

Until then this file is the specification, and `runtime/drive.js` is the only
implementation.

## `marble.agent`

Injected (with `runtime/agent-ui.js`, the drawer) only when the host runs agents — see [AGENTS.md](AGENTS.md). Its absence is the answer to "can I talk to an agent here".

| call | |
|---|---|
| `marble.agent.providers()` | `[{id, label, installed, signedIn, detail, default, defaultModel}]` |
| `marble.agent.conversations({archived})` / `.conversation(id)` | summaries / `{meta, turns, events}` |
| `marble.agent.start({provider, model, handoffFrom})` | → conversation id |
| `marble.agent.send(id, {prompt, target, viewing, selection, also})` | missing context comes from `context()` |
| `marble.agent.cancel(turn)` / `.undo(turn)` / `.dequeue(turn)` | |
| `marble.agent.archive(id, bool)` / `.markReviewed(id)` / `.handoff(id, provider)` | |
| `marble.agent.restore(path, sha)` | the watchdog's restore point |
| `marble.agent.on(id \| '*', fn)` | a conversation's events (replayed, then live) / summaries; returns unsubscribe |
| `marble.agent.context()` | `{viewing, target, selection, also}` — viewing is this page; target is the aimed document, or this page if none; `also` is extra documents in view, not extra writable targets. The element selection survives focus moving into transient chrome |
| `marble.agent.select(ids)` | for documents with their own selection model; `null` clears |
| `marble.agent.aim(path, {also}?)` | the writable target while you stay on this page; `null` clears. Drive's listing `pick()` calls this so a picked document is what a turn writes, without opening it |
| `marble.agent.current()` / `.remember(id)` | the conversation that follows you between pages |
| `marble.agent.open(id)` / `.close()` | ask the drawer |

A document that draws its own agent interface says `<meta name="marble-agent" content="custom">`: the host still injects `agent-ui.js` so `<marble-conversation>` is available, but the drawer does not mount.
