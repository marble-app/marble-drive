# Agent browser and web search — design

> Status: **approved to build**, 2026-09-17. Continues
> [`2026-09-17-agent-full-code-expression-design.md`](2026-09-17-agent-full-code-expression-design.md).
> Lives in Marble Drive, not the Marble package.

Same constraints as the rest of agents: no new npm dependencies, Node 22,
loopback single-owner host. Playwright is imported from `@bdhmin/marble`, the
way Drive's browser tests already do.

## 1. What we are building

A `full` Marble agent can search the web and drive a real browser.

- **Search** is each CLI's native `WebSearch` / `WebFetch`. No search API key.
  Cursor already allows its own (non-`MCP:`) tools at `full`. Claude's
  `--tools` list and `settings.json` allow-list gain `WebSearch` and
  `WebFetch`.
- **Browser** is a Marble-owned Playwright MCP (`bin/marble-browser-mcp.js`).
  Headless Chromium, empty profile, dies with the turn. It can open any
  `http:` / `https:` URL, including the local Drive host.

`documents` capability, and `MARBLE_DRIVE_AGENT_POWER=documents`, get neither.
User-level `~/.cursor/mcp.json` still turns Cursor off. The Cursor hook still
refuses any `MCP:` name we did not list.

## 2. Why this shape

Cursor agents already call `browser_tabs`. That call is denied today because
the hook treats every non-Marble MCP tool as a foreign server. The model knows
those names; matching them is the point.

Search stays native because the person already pays Cursor and Claude. A
Marble search API would be a second product.

The browser is a **second MCP process**, not a new handler in
`server/agent/tools.js`. That file is the document ledger. A live Chromium
does not belong there. The host never sees browser calls; they do not go
through `/agent/tools/*`.

## 3. Architecture

```
full turn
  marble  MCP  → bin/marble-mcp.js          (ops, unchanged)
  browser MCP  → bin/marble-browser-mcp.js  (Playwright, this spec)
  CLI tools    → Read/Grep/Shell/… plus WebSearch/WebFetch
```

The runner already builds the marble MCP spec (`command`, `args`, `env` with
the turn token). At `full` it also builds a browser spec:

```
{ command: process.execPath, args: [browserPath],
  env: { MARBLE_BROWSER_PROFILE: <workspace>/browser-profile } }
```

`prepare({ workspace, mcp, browser, capability })` writes both into the
provider's mcp config when `capability === 'full'` and `browser` is present.
A `documents` prepare writes only `marble`, even if a browser spec was passed.

The CLI starts `marble-browser-mcp.js` the same way it starts `marble-mcp.js`.
Chromium lives in that child. Killing the turn kills the CLI, which kills the
MCP, which closes the browser.

Cursor at `full` also gets `--sandbox disabled`. `--yolo` force-allows
commands; sandbox is what can still Block network tools. Claude keeps
`--restricted`. If a live probe shows `--restricted` drops `WebSearch`, keep
file confinement and record the finding — do not weaken `--restricted`.

Claude `settings.json` allow-list at `full`:

```
Bash, Read, Write, Edit, Glob, Grep, TodoWrite, WebSearch, WebFetch, mcp__browser
```

`mcp__browser` is Claude's permission name for the whole server. Cursor's hook
allowlists the exact `MCP:browser_*` tool names this server implements.

## 4. Browser tools

`server/agent/browser.js` owns the session. The bin is a stdio wrapper.

Exported names, verbatim, in this order:

```
browser_tabs
browser_navigate
browser_navigate_back
browser_snapshot
browser_click
browser_type
browser_take_screenshot
browser_close
```

Not shipped: `browser_evaluate`, `browser_run_code_unsafe`, file upload, PDF,
wait, hover, fill. Search is not a browser tool.

| Tool | Input | Result |
|---|---|---|
| `browser_tabs` | `{ action: "list"\|"new"\|"close"\|"select", index?: number }` | `{ tabs, selected }` — `tabs` is `{ index, url, title }[]` |
| `browser_navigate` | `{ url }` | `{ url, title }` after load |
| `browser_navigate_back` | `{}` | `{ url, title }` |
| `browser_snapshot` | `{}` | `{ snapshot }` — Playwright `page.ariaSnapshot({ mode: "ai" })`, which includes `[ref=eN]` |
| `browser_click` | `{ ref }` | `{ ok: true }` — `page.locator("aria-ref=" + ref).click()` |
| `browser_type` | `{ ref, text, submit?: boolean }` | `{ ok: true }` — fill, then Enter if `submit` |
| `browser_take_screenshot` | `{}` | MCP image content plus `{ url }` |
| `browser_close` | `{}` | `{ ok: true }` — closes Chromium; the next navigate relaunches |

First `browser_navigate` (or `browser_tabs` `new`) launches headless Chromium
with an empty context. Viewport 1280×720. User data dir is
`MARBLE_BROWSER_PROFILE` when set, otherwise Playwright's default empty
profile.

**URL rule:** only `http:` and `https:`. `file:`, `javascript:`, `data:` and
anything else return an error. Localhost is allowed — that is how the agent
opens the live Drive page.

A thrown Playwright error (timeout, unknown ref, net failure, missing
Chromium) becomes `{ error: message }` and the MCP result has `isError: true`.
The conversation already paints that as `Blocked: browser_navigate`. No retry
inside the MCP.

Missing Chromium binary: the error text includes `npx playwright install chromium`.

Stdin close on the MCP process calls `session.close()`.

## 5. Cursor hook

At `full`, allow:

- Marble's six `MCP:` tools (unchanged)
- The eight `MCP:browser_*` names above, exact match, not a prefix
- Any non-empty name that does **not** start with `MCP:` (Cursor's own tools,
  including `WebSearch` / `WebFetch` / `Grep` / `Shell`)

At `documents`, allow only Marble's six. `MCP:browser_navigate` is denied.
`MCP:browser_evaluate` is denied at both capabilities.

User MCP servers in `~/.cursor/mcp.json` still refuse Cursor turns before
spawn. That is what keeps a colliding `MCP:browser_tabs` from another server
out.

## 6. Instructions

`FULL_INSTRUCTIONS` tells the agent it has `WebSearch`, `WebFetch`, and the
browser tools, in addition to the file/shell belt and Marble's ops tools.

- Use `WebSearch` / `WebFetch` to look something up.
- Use the browser when the page must render or be clicked (the live Drive
  document, a JS-heavy doc site).
- Preserve `data-marble-id` when rewriting documents. Unchanged.

`documents` instructions stay MCP-only. They do not mention a browser.

## 7. Out of scope

- Official `@playwright/mcp` / a new npm dependency
- The person's real Chrome profile
- User-level MCP plugins
- Codex
- An OS sandbox for the CLI (the existing runner `sandbox` seam still stands)
- Wait / hover / fill / evaluate
- A Marble-owned search API

## 8. Testing

- **Unit, fake Chromium** — `createBrowserSession({ chromium })` with a stub
  that records launch options and implements `newContext` / `newPage` /
  `goto` / `ariaSnapshot` / `locator` / `screenshot`. Covers: launch is
  headless; `file:` is refused; tabs list/new/select/close; snapshot then
  click uses `aria-ref=`; type with `submit` presses Enter; errors become
  `{ error }`; close then navigate relaunches.
- **MCP stdio** — same shape as `test/agent-bridge.test.js`: initialize,
  `tools/list` is exactly the eight names, a call returns JSON text,
  unknown tool is an error result, stdin end closes the session.
- **Hook** — full allows `MCP:browser_tabs` and `WebSearch`; documents
  denies `MCP:browser_tabs`; both deny `MCP:browser_evaluate`. The allowed
  `MCP:browser_*` set equals `BROWSER_TOOLS`.
- **Providers** — Claude `full` spawn includes `WebSearch,WebFetch` and
  `mcp__browser` in settings.json; mcp.json at full has `marble` and
  `browser`; documents mcp.json has only `marble`. Cursor `full` spawn
  includes `--sandbox disabled` and mcp.json has both servers.
- **Live Chromium** — navigate to a local `http.Server` page, snapshot
  contains the heading, click a ref, screenshot is a PNG. Skip (do not
  fail) if Chromium is not installed, with a message to install it.

## 9. Decisions taken without asking

1. **http(s) only.** Open web does not mean `file:` of the rest of the disk.
2. **Exact hook names, not a `browser_` prefix.** A prefix would bless a
   tool we did not write.
3. **Playwright `ariaSnapshot({ mode: "ai" })` and `aria-ref=` locators.**
   That is what Playwright 1.62 already uses for its own agent tools.
4. **`--sandbox disabled` only at Cursor `full`.** Documents turns do not
   need the network.
