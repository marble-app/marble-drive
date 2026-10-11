# Isolation: a document holds no power it was not given

2026-09-26. Status: design, approved in conversation; spec awaiting the
owner's review before a plan. Project 1 of
[`2026-09-26-collaboration-programme.md`](2026-09-26-collaboration-programme.md).

## Why

Collaborators will edit Marble apps, code included, because in Marble content
is code. Their code then runs in the owner's browser whenever the owner opens
the app. Today every document is served from the drive's own origin, and a
browser gives every script on a page the full power of that origin: the
owner's session cookie rides along on its requests, and it can open the Agents
page or the Drive in a hidden frame and reach straight into them. A host
cannot tell the owner's click from a collaborator's script running in the
owner's tab. So a line inside a shared app could ask the owner's agent, which
has a shell on the sprite, to read the owner's keys, and no permission check
would ever see anything but the owner.

Permissions decide who may *write* code. This project decides what code may
*do* once it runs: a document's scripts, whoever wrote them, can change that
document and reach exactly what the host granted it, and nothing else.
Sharing (project 2) waits for it.

## Decisions

- **Approach A, an invisible sandbox with passes.** Each document is served
  with a `Content-Security-Policy: sandbox` header, which makes the browser run
  it in an origin of its own that holds no cookie and can reach no other page
  of the drive. The page is still an ordinary top-level page at its own URL:
  full screen, links, the same interface; nothing is framed. In place of the
  cookie, the host writes a short-lived **pass** into the page, scoped to what
  that document may do.
- **Rejected: a host page wrapping a sandboxed frame** (the pass never enters
  the document, so nothing can be carried off; but every transport becomes
  messages, and clipboard, fullscreen, navigation, previews and the agent
  drawer all need rework). **Rejected: reviewing others' code before it runs**
  (code collaboration would be live for them and never for the owner).
  **Rejected: isolating only shared documents** (two ways for a page to run, and
  a document's saved state splits the moment it is shared).
- **The cost accepted with A.** Any script in a page can read that page's pass,
  so a collaborator's code could carry it off and use it until it expires.
  It gets exactly what that document was granted, never more. That is why the
  grant per document (and project 2's rule that a document others can edit
  never gets the owner's full agent) carries the weight.
- **`../marble` does not change.** Everything the page needs is done by a host
  script that runs before the carrier (section 4), so no publish is needed.

## What a page depends on today

Found by reading every runtime file, template and starter:

- **Every call to the host goes through four transport files**:
  `runtime/agent.js` (`/agent/*`), `runtime/drive.js` (`/drive/*`, `/blob`,
  the drive stream), `../marble/runtime/marble.js` (`/ops`, `/events`,
  `/presence`, `/docs`, and a `navigator.sendBeacon` on leaving), and
  `runtime/tab-rest.js` (`/tab/alive`). `runtime/collab.js` asks `/presence`,
  `runtime/console.js` its own `/console/api/*`. The agent UI's 8,000 lines
  call the host only through `agent.js`.
- **Storage.** `localStorage`: `templates/drive.mrbl`, `templates/agents.mrbl`,
  `agent.js`, `drive.js`, `agent-variations.js`, `console.js`.
  `sessionStorage`: `marble.js` (scroll restore), `collab.js`, `agent-ui.js`,
  `agent-callout.js`. All of it through `getItem`/`setItem`/`removeItem`; none
  by property. Both throw in a sandboxed page.
- **Imports.** `agent-ui.js` and `starters/chat.mrbl` `import('/runtime/…')`;
  `drive.js` imports pdf.js from jsdelivr.
- **Other browser powers.** Clipboard (`starters/chat.mrbl`, `console.js`),
  fullscreen (`starters/slides.mrbl`), `window.open` (`templates/drive.mrbl`).
- **Not used**: `location.origin`, cookies from script, service workers,
  `BroadcastChannel`, reaching into another frame's document. Chat visuals
  already talk to their sandboxed frames by `postMessage`, which crosses
  origins as it is.

## Design

### 1. Serving

When a request for `/a/<doc>` is a page load (`Sec-Fetch-Dest: document`, or
no such header) from a browser the host lets in (the gate's cookie, or an open
host), and `config.isolate` is on:

- The response carries
  `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals
  allow-popups allow-popups-to-escape-sandbox allow-downloads
  allow-pointer-lock allow-presentation allow-top-navigation-by-user-activation`
  and **not** `allow-same-origin`.
- The injected tags (`injectCarrier`) gain, first of all, one inline
  `<script data-marble-transient>` holding `{ pass, renewAt, storage, grade }`
  as JSON, and `runtime/pass.js` loads before `tab-rest.js`.
- The same header is also sent when a document is loaded as a frame (the
  Drive's live previews, `Sec-Fetch-Dest: iframe`); each preview gets its own
  pass.
- A request that is not a page load (the carrier's own `fetch` of `/a/…`, if
  any) is unchanged.

Everything else the host serves is unchanged: `/gate`, `/`, `/today` still
redirect; the gate still sets its `HttpOnly` cookie.

### 2. Passes: `server/passes.js`

A pass is signed, not stored, like the gate's cookie:

```
v1.<grade>.<scope>.<who>.<expires>.<HMAC-SHA256(key, everything before it)>
```

- `key` is derived from `MARBLE_DRIVE_SECRET`
  (`HMAC(secret, "marble-pass-v1")`), so a pass is not a gate cookie and never
  verifies as one. An open host (no secret) makes a random key at start;
  passes then die with a restart, and pages renew (section 4).
- `scope` is the document path, base64url; `who` is `owner` in this project
  (project 2 adds people); `expires` is milliseconds.
- Verified in constant time over hashes of both sides, as the gate does.
- **Grades in this project.**
  - `full`: everything the gate's cookie allows today. The owner's documents
    are served at `full`, so nothing changes for the owner.
  - `doc`: only this document (section 3's table). No document is served at
    `doc` in this project except by asking: the owner may open any document
    with `?grade=doc` to see it run exactly as a collaborator's code will be
    confined. Project 2 decides who gets `doc` and adds the document agent.
- **Lifetime by grade.** A `full` pass lasts 12 hours; a `doc` pass lasts
  15 minutes, because it is the grade other people's code will hold, and a
  short life bounds both a pass carried off the page and how long a revoked
  link keeps working. `POST /pass/renew` with a live pass returns a fresh
  one of the same grade and scope after asking `grant(scope, who)` again. In
  this project `grant` always agrees; in project 2 it is where a revoked link
  or a removed person is refused. An expired pass cannot renew; the page tells
  the person to reload (section 4).

### 3. The host's check: `authorize(req)`, in front of the routes

One function, in place of today's `gate.allows(req)` for every route after
`/health`, the favicon, `/gate` and `/agent/tools`:

1. **The cookie counts only when the request does not come from a sandboxed
   page.** If `Origin` is `null`, the cookie is ignored whatever it says. (A
   browser does not send a `SameSite=Lax` cookie on a sandboxed page's
   `fetch` anyway; this is the belt to that.) Otherwise a valid gate cookie is
   the owner, exactly as today.
2. **Else a pass**, from the `X-Marble-Pass` header, or `?pass=` for the two
   things that cannot send headers: `EventSource` and `sendBeacon`. A missing,
   forged or expired pass: 401 `{ error: "pass expired", renew: true }` for an
   expired one, 401 otherwise.
3. **The grade's route table decides.** `full` allows every route the cookie
   does. `doc` allows:

   | Route | Condition |
   |---|---|
   | `GET /runtime/*` | always |
   | `POST /ops?app=<scope>` | |
   | `GET /events?app=<scope>` | not `?drive=1` |
   | `GET`/`POST /presence?app=<scope>` | |
   | `GET /docs` | answers only `<scope>` |
   | `GET /blob/<hash>` | the hash appears in `<scope>`'s current source |
   | `POST /tab/alive` | |
   | `GET`/`PUT /storage` | the page's own bucket (section 5) |
   | `POST /pass/renew` | |

   Everything else answers 403 `{ error: "not allowed from this document" }`.
   The tables are data exported by `server/passes.js`, and a test walks every
   route `app.js` answers and requires each to be allowed or refused on
   purpose, so a route added later is refused to `doc` until someone decides.
4. **CORS.** A request with `Origin: null` and a valid pass is answered with
   `Access-Control-Allow-Origin: null`, `Vary: Origin`, and no
   `Allow-Credentials`. Preflights (`OPTIONS`) for pass-carrying routes answer
   `Allow-Headers: X-Marble-Pass, Content-Type`, `Allow-Methods: GET, POST,
   PUT`, `Max-Age: 7200`. `/runtime/*` answers `Allow-Origin: *`: it is the
   same public code the repository holds.
5. **`sameOrigin` checks** on state-changing routes (the Console, the gate
   form) stay as they are for cookie requests; a pass is not ambient, so a
   request carrying one is not a cross-site forgery.

### 4. The page's side: `runtime/pass.js`

Loaded first, before `tab-rest.js`, reading the inline JSON:

- **`fetch`**: a wrapper that adds `X-Marble-Pass` to any request whose URL
  resolves to the drive's host (relative URLs, and the host's absolute URL),
  and to nothing else: a pass never goes to jsdelivr or any other site.
- **`EventSource`** and **`navigator.sendBeacon`**: add `pass=` to the URL,
  same rule. `tab-rest.js` wraps `EventSource` after this, so its rest and
  reconnect logic sees the pass-carrying constructor and keeps working.
- **Renewal**: at `renewAt` (an hour before expiry for `full`, five minutes
  before for `doc`) and whenever a request
  comes back 401 with `renew: true`, one `POST /pass/renew`, then the
  refused request once more. A sprite that paused overnight wakes with an
  expired pass; the renewal fails; the page shows one quiet line, "This page
  was away too long. Reload to carry on", and files nothing more until
  reloaded. (Unsent ops stay in the carrier's queue, as on any network error.)
- **Storage stand-ins** (section 5), installed with
  `Object.defineProperty(window, 'localStorage', …)` before any page script
  runs.

No transport file changes. The probe (section 7) confirms the two browser
behaviours this relies on.

### 5. Storage stand-ins

- **`localStorage`** becomes an object with the whole `Storage` interface
  (`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`), seeded from
  the page's JSON and written back with `PUT /storage` 500 ms after the last
  change and on `pagehide` (`fetch` with `keepalive`).
- **Buckets.** `full` pages share one bucket, `owner`, because that is what
  the drive's origin is today: the Drive and Agents pages read each other's
  keys. A `doc` page gets one bucket per document per person
  (`doc/<scope-hash>/<who>`). Kept at `.marble/storage/<bucket>.json`, written
  atomically, capped at 5 MB like a browser (a write past it is refused and
  `setItem` throws `QuotaExceededError`, as a browser's does).
- **Two tabs** each hold their own copy and write the whole bucket; the later
  write wins, as it does for two tabs of one origin today within a tick. A tab
  sees another's change on its next load, not live (today it would get a
  `storage` event; nothing here listens for one).
- **`sessionStorage`** becomes an in-memory stand-in with the same interface,
  kept across reloads of the same tab in `window.name` (which a sandboxed page
  keeps, and browsers clear on navigating to another site).
- **Migration, once per browser.** The first top-level page load
  (`Sec-Fetch-Dest: document`, never a preview frame) after isolation is on,
  from a browser without a `marble_storage=1` cookie, is answered with a tiny
  host-written page (not sandboxed, no document, no script but its own) that
  sends the origin's whole `localStorage` to `PUT /storage` as the `owner`
  bucket (merged: keys already there win), sets the cookie, and replaces
  itself with the page asked for. The owner's Agents layout, Drive view and
  the rest carry over.

### 6. Everything else a page does

- **`import('/runtime/…')`** works through `/runtime/*`'s CORS header. pdf.js
  from jsdelivr is unaffected.
- **Links and `window.open`** work: a sandboxed top-level page may navigate
  itself, and `allow-popups-to-escape-sandbox` means a document opened in a new
  tab is served, and sandboxed, on its own terms.
- **Clipboard and fullscreen** are expected to work at the top level; the probe
  checks them.
- **The agent's headless browser** keeps the gate's cookie and so gets `full`
  pages, as a person does.
- **The Console, Drive and Agents pages** are documents like any other and run
  sandboxed at `full`. None of them can be shared (project 2).
- **Chat visuals** keep their own sandbox inside the page.

### 7. Probe first

Before any production code, a throwaway page and host (not kept) on Chromium
and WebKit through the repo's Playwright:

1. A top-level page with the header has origin `null`; `document.cookie` is
   empty; a `fetch` to the host carries no cookie.
2. `Object.defineProperty(window, 'localStorage', …)` replaces the throwing
   getter, before and after other scripts.
3. `navigator.clipboard.writeText` after a click, and `requestFullscreen`.
4. `EventSource` and `sendBeacon` with `?pass=` reach the host, and
   `EventSource` reconnects after the host drops it.
5. `import()` of a host module with `Allow-Origin: *`.
6. A same-origin frame of `/a/Agents.mrbl` opened from inside a sandboxed page
   cannot be read.

Any failure revises this design before code. The probe's result is written
into the plan.

### 8. Settings

| Setting | Default | What |
|---|---|---|
| `MARBLE_DRIVE_ISOLATE` | off | serve documents sandboxed with passes |
| `MARBLE_DRIVE_PASS_HOURS` | 12 | a `full` pass's lifetime |
| `MARBLE_DRIVE_DOC_PASS_MINUTES` | 15 | a `doc` pass's lifetime |

## Guards

What the tests must meet that ordinary use would not:

- **The evil document.** A test page served at `doc` grade whose script tries,
  and must fail, to: call `/agent/conversations`, `/drive/tree`,
  `/console/api/…`, `/history`; `fetch('/a/Agents.mrbl')` and read a pass out
  of it; open `/a/Agents.mrbl` in a frame and read its DOM; read
  `document.cookie`; send `/ops` for another document with its own pass; use
  `credentials: 'include'` to make the browser attach the cookie.
- **Passes.** Forged signature, changed grade or scope with the old signature,
  expired, a gate cookie offered as a pass, a pass offered as a gate cookie,
  renewal of an expired pass, renewal when `grant` refuses.
- **The cookie from a sandboxed page.** A request with `Origin: null` and a
  valid gate cookie and no pass is refused.
- **Every route.** The table test over every route in `app.js`.
- **Storage.** The whole `Storage` interface, the 5 MB refusal, two tabs, the
  migration page (existing keys win; runs once; lands on the page asked for),
  `sessionStorage` across a reload.
- **Renewal across a pause.** A page whose pass expired while the sprite slept
  shows the reload line and does not lose queued ops.
- **Nothing else changes.** Every existing `test-browser/` suite passes with
  `MARBLE_DRIVE_ISOLATE=1`. They are the regression net for the pages the owner
  uses every day.

## Testing

- Unit: `test/passes.test.js`, `test/storage.test.js`.
- Integration: `test/authorize.test.js` against a real host on a temp drive
  (every route × cookie, `full` pass, `doc` pass, wrong-document pass, no
  pass, `Origin: null`).
- Browser: `test-browser/isolation.test.js` (the evil document, storage,
  renewal), then the whole browser suite with isolation on.
- On a sprite: `t-bryan` with `MARBLE_DRIVE_ISOLATE=1` in its `sprite.env`,
  used by the owner for a while (Drive, Agents, a starter, Mashup Studio, the
  phone), before the testers, then `admin-p1`, then isolation becomes the
  default and the setting goes.

## Out of scope

- Links, people, roles, the Share sheet (project 2).
- Who is served at `doc` rather than `full`, and the document agent a `doc`
  page may use (project 2).
- Versions and attribution (project 3).
- Revoking a single pass before it expires. Passes are stateless; project 2
  revokes the link or the person, which `grant` checks at the next renewal, so
  a `doc` pass outlives its revocation by at most 15 minutes. Project 2 closes
  the gap by also ending the revoked person's streams at once, as its first
  draft described.
