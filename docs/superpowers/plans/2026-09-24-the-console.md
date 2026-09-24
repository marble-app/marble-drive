# The console: implementation plan

> For agentic workers: executed inline (the owner asked for the whole thing to
> be built autonomously). Steps are TDD: the test first, watched failing.

**Goal:** a Console document on admin-p1 that shows and manages every drive,
ships marble-drive and marble, and hosts the workshop, without waking drives
to draw itself.

**Spec:** `docs/superpowers/specs/2026-09-24-the-console-design.md`

**Architecture:** `server/console/` (Sprites CLI wrapper, probe, jobs,
workshop status, action recipes, routes) behind `MARBLE_DRIVE_CONSOLE=1`; a
seeded thin document; `runtime/console.js` + `runtime/console.css` build the
page from `/console/api/state` and an SSE stream.

## Global constraints

- Never wake a drive to draw the page. Only *Look now*, actions, and drives
  already awake are exec'd.
- Commands are argument arrays; drive names must be in the Sprites list.
- No secret in a log, a cache file, or a response other than *Show*/*Copy*.
- Design tokens, curves and clocks copied from the Design System's `:root`.
- Width answers are container queries on `html`; `@media` for capabilities.

## Tasks

1. **`release.sh apply` / `apply-when-idle`.** Restart the live release with
   the current `sprite.env`. Test in `test/sprite-release.test.js`.
2. **`server/console/envfile.js`.** `parse(text)`, `patch(text, { set, unset })`,
   `SECRET` key test. Keeps comments and order; refuses `,` and newlines.
   Test: `test/console-envfile.test.js`.
3. **`server/console/sprites.js`.** `createSprites({ bin, org, run })`:
   `list()`, `checkpoints(name)`, `exec(name, args, { files })`,
   `urlAuth(name, auth)`, `checkpoint(name, comment)`, `restore(name, id)`.
   A fake CLI in `test/fixtures/fake-sprite.mjs` driven by a JSON state file.
   Test: `test/console-sprites.test.js`.
4. **`server/console/probe.mjs` + `inspect.js`.** The probe prints one JSON
   object; `inspect` splits it into `shown` (cached to
   `.marble/console/sprites/<name>.json`) and `secret` (memory only).
   Test: `test/console-inspect.test.js`.
5. **`server/console/jobs.js`.** `createJobs({ dir, log })`: `start({ kind,
   title, target, run })` where `run(ctx)` gets `ctx.exec(cmd, args, opts)`,
   `ctx.say(line)`, `ctx.secret(value)`; lock per target; persist; stream;
   cancel; `list()`. Test: `test/console-jobs.test.js`.
6. **`server/console/workshop.js`.** Status of each checkout, main's recent
   commits, npm's marble. Test with temp git repos:
   `test/console-workshop.test.js`.
7. **`server/console/actions.js`.** The recipes: deploy, ship, rollback,
   settings, claude, signout, access, passphrase, checkpoint, restore,
   provision, remove, pull, test, publish; the stuck-checkpoint memory; plan.
   Test with fakes: `test/console-actions.test.js`.
8. **`server/console/index.js` + routes, config, app wiring, seeding,
   injection.** Test: `test/console-routes.test.js`.
9. **The page:** `templates/console.mrbl`, `runtime/console.css`,
   `runtime/console.js`.
10. **Browser tests + a screenshot review** at 390/820/1280, light and dark:
    `test-browser/console.test.js`, `tools/console-shots.mjs`.
11. **Docs:** HOSTING.md (the console, its setting, runbooks through it),
    HOSTING-DECISIONS.md (decision 21), CLAUDE.md.
12. **Real:** `MARBLE_DRIVE_CONSOLE=1` on admin-p1, deploy, check the list,
    *Look now*, a settings change and *Try on t-bryan* on t-bryan.
