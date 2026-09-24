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

- **admin-p1**: the owner's real drive and the workshop (this checkout, in
  `/home/sprite/src`). Private to the org, and deployed by name only.
- **t-bryan**: the owner's test user, on an API key. Try changes here first.
- **t-irene, t-sam, t-sangho, t-peiling**: friends testing Marble. They are
  real people's drives: never edit them directly.

`tools/sprite-deploy.sh --all --list` shows who `--all` reaches.

The owner also runs all of this from **Console** on admin-p1 (`/a/Console`,
`server/console/`): drives, shipping, the workshop, and a log of every job.
It runs the same tools, so a change to them reaches it.

## Shipping a change

1. Make the change. Run `npm test`, and the browser tests it touches:
   `node --test test-browser/<file>.test.js`.
2. Try it as a user sees it: `tools/sprite-deploy.sh t-bryan --local`. Say what
   to look at on `https://t-bryan-b3fwm.sprites.app`.
3. A change to `marble` too: bump its version, `npm publish` it from `../marble`,
   then point this repo at that version before step 4.
4. Commit, and push to `main`.
5. Only when the owner says to ship:
   - `tools/sprite-deploy.sh --all`. Irene's and Sam's sprites cannot make
     checkpoints right now; where one fails with "Failed to create checkpoint",
     `tools/sprite-deploy.sh <sprite> --no-checkpoint` (nothing was changed there).
   - Then `tools/sprite-deploy.sh admin-p1`. From admin-p1 itself this stages
     the release and switches only when no agent is working, so this
     conversation is not cut off (`~/app/switch.log`).
6. Report what shipped, where, and anything that failed.

`tools/sprite-deploy.sh <sprite> --rollback` undoes a deploy on one sprite.

## Rules

- Each person's Drive and Agents pages are their own documents. A change to
  `templates/drive.mrbl` or `templates/agents.mrbl` reaches new drives only;
  do not patch an existing user's pages without the owner asking.
- The Claude Code version every sprite runs is `tools/sprite/claude-version`.
  Bump it in its own commit, after trying it on t-bryan.
- Never print, commit or copy a key: GitHub, npm, Sprites, Anthropic, or a
  sprite's passphrase (`~/.config/marble-drive/testers.json` on the owner's Mac).
