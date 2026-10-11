# A sprite per tester

2026-09-23. Status: design, awaiting review. Piece 2 of opening Marble Drive
to other people; piece 1 is `2026-09-23-marble-drive-on-a-sprite-design.md`.

## Why

The owner wants two friends testing Marble Drive, each in their own space. Piece
1 put one Marble Drive on one sprite (`admin-p1`) with a deploy script. This
piece makes a sprite for a named tester with one command, gets the tester in,
decides how their agents are paid for, and keeps every tester's sprite updated,
until the front door (piece 3) replaces the sign-in and provisioning by hand.

Decided with the owner:

- **Getting in before the front door:** the tester's sprite URL is public, with
  Marble's existing passphrase gate in front (`server/gate.js`: one secret,
  constant-time compare, signed cookie). One long random passphrase per sprite,
  sent to the tester by the owner. A tester is never a member of the Fly org:
  members can open every sprite in it, `admin-p1` included.
- **Paying for agents, chosen per tester:**
  - `api` — an Anthropic Console API key (one per tester, with a spend limit
    set in the Console), preloaded on their sprite or typed by them in Agents
    settings. Within Anthropic's terms, and the path real users will take.
  - `subscription` — the owner runs `claude login` on the tester's sprite, as on
    `admin-p1`. The owner was told that Claude subscriptions are for one person
    and sharing one may risk the account; the choice is theirs, per sprite.

## What provisioning has to fix first

- **Saved API keys live inside the release.** The Agents settings panel writes
  keys to `.agent-keys.local` in the host's working directory
  (`MARBLE_DRIVE_AGENT_KEYS`, default `<cwd>/.agent-keys.local`); on a sprite
  that is `~/app/current/marble-drive`, so every deploy drops the key. Every
  sprite puts keys at `~/.config/marble-drive/agent-keys` instead.
- **"KIXLAB API" is shown to everyone.** The API-key agent's name is
  hard-coded in `server/agent/providers/claude.js` and `runtime/agent-ui.js`.

## Design

### 0. The shipped Drive is the product's, not the owner's

A tester's Drive page is copied from `templates/drive.mrbl` once, when their
drive is new, and never updated after (see "Out of scope"). So before any
tester sprite exists:

- **Map** (documents orbiting their folder) and **Pulse** (a GitHub-style
  calendar of day squares) are the owner's own views and leave the template:
  their buttons, styles, drawing code and saved-view values. Grid, List,
  Timeline and Weight stay. A saved view of `map` or `pulse` falls back to Grid.
  The owner's live Drive keeps both.
- **The Drive page does not list itself as a document.** It is the interface,
  not something in the drive: its own entry folds into the materials strip at
  the bottom with the text and data files. The page knows itself by its own
  address (`/a/<path>`), so a renamed Drive still does.

### 1. A sprite's own settings: `~/.config/marble-drive/sprite.env`

`KEY=value` lines, mode 600, on the sprite, outside every release. The release
script reads it every time it (re)creates the service and adds its values to the
service's environment, after its own defaults, so a sprite's settings survive
every deploy. Every sprite gets `MARBLE_DRIVE_AGENT_KEYS=$HOME/.config/marble-drive/agent-keys`
from the release script itself.

A tester's `sprite.env`:

```
MARBLE_DRIVE_SECRET=<passphrase>
MARBLE_DRIVE_SECURE_COOKIE=1
MARBLE_DRIVE_AGENT_PROVIDER=claude-api        # or claude-subscription
```

### 2. `tools/sprite-provision.sh <person> [--agent api|subscription] [--key-file <path>] [--org <org>]`

On the Mac:

1. Sprite name `t-<person>` (lowercased, `a-z0-9-` only). Refuses if it exists.
2. `sprite create --skip-console --label marble-tester t-<person>`.
3. A passphrase: 24 characters from `openssl rand`, easy to paste.
4. Writes `sprite.env` onto the sprite (pushed as a file, mode 600).
5. `--agent api` (the default) with `--key-file`: builds the key file
   (`{"anthropic": "<key>"}`) locally in a mode-600 temporary file, pushes it to
   `~/.config/marble-drive/agent-keys`, and deletes the local copy. The key is
   never printed and never written to the roster. Without `--key-file`, the
   tester adds their own in Agents settings.
6. Deploys with `tools/sprite-deploy.sh t-<person>` (the pushed `main`, public
   sources, no login or key of the owner's).
7. `sprite config update --url-auth public`, then checks from the Mac: `/health`
   answers 200 and `/` answers the gate, not the Drive.
8. `--agent subscription`: prints the one step left to the owner,
   `sprite console -o <org> -s t-<person>`, then `claude login`.
9. Prints a note ready to send: the URL, the passphrase, and what to do about
   agents.
10. Records the tester in `~/.config/marble-drive/testers.json` on the Mac
    (mode 600; outside the repo and any drive): person, sprite, URL, passphrase,
    agent mode, created. Never the API key.

`--remove <person>` destroys `t-<person>` after the owner types the sprite's name
to confirm (it deletes that tester's drive), and removes the roster entry.

### 3. Updating everyone

`tools/sprite-deploy.sh --all [--org <org>]` deploys to every sprite whose name
starts with `t-` (`sprite list --prefix t-`), one after another, continues past
a failure, and ends with one line per sprite: deployed, or the error.
`admin-p1` is never included; it is deployed on its own.

### 4. The API agent's name

`MARBLE_DRIVE_API_LABEL` names the API-key agent (default `Claude API`). The
provider takes its label from it, and `runtime/agent-ui.js` uses the label the
provider list reports instead of its own table. The owner's Mac sets `KIXLAB
API` in `.env.local`.

## Guards

- The shipped template has no Map or Pulse (no buttons, no drawing code), a
  saved `map` or `pulse` view opens as Grid, and a new drive's Drive page shows
  itself in the materials strip, not among the documents.
- `MARBLE_DRIVE_API_LABEL` names the provider; unset, it is `Claude API`; no
  shipped file says `KIXLAB`.
- `release.sh` builds the service environment from its defaults plus
  `sprite.env` (tested with a stub `sprite-env` that records its arguments), and
  sets `MARBLE_DRIVE_AGENT_KEYS` outside the release.
- Real run: provision `t-smoke` (`--agent api`, no key), check from outside
  that `/health` is 200 and `/` is the gate, sign in with the passphrase, save a
  test key in Agents settings, redeploy, and confirm the key is still set.
  Then remove `t-smoke`, with the owner's go-ahead at that moment.

## Out of scope

- **UI updates to existing drives.** Host code, the shared page code
  (`runtime/*.js`), starters and the app's agent skills update for everyone on
  the next deploy; each person's own Drive and Agents pages never do, because
  they are that person's documents. The next spec delivers UI updates as notes
  in a `Marble Updates/` folder in every drive, each with a "Merge into my
  Drive" button that briefs the person's own agent. Until then, shared page code
  stays backwards compatible with older Drive pages.

- The front door (piece 3): sign-up, sign-in, routing. Limits and cost
  (piece 4).
- A tester's own custom domain; Cursor or other agents for testers.
- Rotating a passphrase (re-provisioning covers it for two testers).
