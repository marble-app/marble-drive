# Marble Drive

The host that serves a drive of Marble documents: `server/` (the host),
`runtime/` (page code every document loads), `templates/` (the Drive and Agents
pages a new drive starts with), `starters/` (the new-document gallery),
`agent-plugin/` (the app's own agent skills), `tools/` (deploying and upkeep).
The `marble` package (the format and its carrier) is a sibling checkout,
`../marble`, published to npm as `@bdhmin/marble`.

## Where it runs

Every drive is a Fly Sprite in the org `marble-drive`. How it all works, the
runbooks and troubleshooting: `docs/HOSTING.md`; why each choice was made:
`docs/HOSTING-DECISIONS.md`. Read them before changing how anything is hosted.

- **admin-p2**: the owner's real drive and the workshop (this checkout, in
  `/home/sprite/src`). Private to the org, and deployed by name only.
- **admin-p1**: the owner's sprite until 2026-09-28, when its storage kept
  stalling; kept asleep for Fly to look at. Never deploy to it.
- **t-bryan**: the owner's test user, on an API key. Try changes here first.
- **t-irene, t-sam, t-sangho, t-peiling**: friends testing Marble. They are
  real people's drives: never edit them directly.
- **The owner's drive at home on their own machine**: an encrypted R2 hub, a
  Worker lease, one home at a time (`tools/drive-home.mjs`, `tools/home-release.sh`;
  `docs/HOSTING.md`, "A drive at home on the Mac or the PC"). At home on the Mac
  since 2026-09-30 (`macos/launchd/`); moving to the owner's Windows PC, in
  Ubuntu under WSL2 (`linux/systemd/`, `tools/pc-setup.sh`, decision 29).
  admin-p2 stands by. Move it only when the owner says to, and never run
  `drive-home` from a conversation hosted on any side.

`tools/sprite-deploy.sh --all --list` shows who `--all` reaches.

The owner also runs all of this from **Console** on admin-p2 (`/a/Console`,
`server/console/`): drives, shipping, the workshop, and a log of every job.
It runs the same tools, so a change to them reaches it.

## Shipping a change

1. Make the change. Run `npm test`, and the browser tests it touches:
   `node tools/browser-tests.mjs test-browser/<file>.test.js` (any number of
   files; none means all). On admin-p2 it hands the run to the owner's Mac
   when the Mac is watching (`macos/launchd/test-runner.sh`) and streams the
   output back; otherwise it runs them here, one file at a time. Never plain
   `node --test` on several browser files on a sprite: it runs one per core,
   each with its own Chromium, and that runs the machine (8 GB, no swap) out
   of memory.
2. Try it as a user sees it: `tools/sprite-deploy.sh t-bryan --local`. Say what
   to look at on `https://t-bryan-b3fwm.sprites.app`.
3. A change to `marble` too: bump its version, `npm publish` it from `../marble`,
   then point this repo at that version before step 4.
4. Commit, and push to `main`.
5. Only when the owner says to ship:
   - `tools/sprite-deploy.sh --all`. Several sprites' checkpoint stores are
     stuck ("… in-progress … file exists": t-irene, t-sam, t-bryan, t-eunhye,
     t-rima as of 2026-09-28); the deploy recognises that, goes on without a
     checkpoint, and says so (report stuck ones to Fly). Any other checkpoint
     failure still stops that sprite's deploy with nothing changed there.
   - Then `tools/sprite-deploy.sh admin-p2`. From admin-p2 itself this stages
     the release and switches only when no agent is working, so this
     conversation is not cut off (`~/app/switch.log`).
   - Then `tools/home-release.sh` on whichever of the Mac or the PC the
     owner's drive is at home on, to match.
6. Report what shipped, where, and anything that failed.

`tools/sprite-deploy.sh <sprite> --rollback` undoes a deploy on one sprite.

## Rules

- Each person's Drive, Agents, Chat, Board, Design System and Design Don'ts
  pages, and the notes they make, are their own documents. On start the host brings them
  forward to this release's templates by a three-way merge (`server/app-updates.js`): only a
  clean merge that passes the document check is written, and a page whose owner
  changed the same lines is left as it is (`marble-drive apps` shows which).
  After changing a template or starter listed in `server/app-lineage.js`, run
  `node tools/app-lineage.mjs` and commit `templates/lineage/` with it.
  Still: do not patch an existing user's pages by hand without the owner asking.
- The Claude Code version every sprite runs is `tools/sprite/claude-version`,
  and the Codex version `tools/sprite/codex-version`. Bump each in its own
  commit, after trying it on t-bryan.
- Never print, commit or copy a key: GitHub, npm, Sprites, Anthropic, OpenAI, or a
  sprite's passphrase (`~/.config/marble-drive/testers.json` on the owner's Mac).
