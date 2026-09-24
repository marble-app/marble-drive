#!/usr/bin/env bash
# Make a sprite the owner's workshop: where marble-drive and marble are changed,
# tested and shipped from a conversation in its own Agents
# (docs/superpowers/specs/2026-09-24-the-workshop-design.md).
#
#   tools/sprite-workshop.sh <sprite> [--org <org>] [--github <file>] [--npm <file>] [--sprites <file>]
#
# Checks out marble-drive and marble side by side in /home/sprite/src (updated
# fast-forward only when already there; local changes are reported, never
# touched), installs them, registers them as the agent projects "Marble Drive"
# and "Marble", and commits as you. Each key file holds one token and is
# placed without being printed: --github (contents read/write on
# marble-app/marble-drive and marble-app/marble; needed for the private marble
# clone), --npm (publish @bdhmin/marble), --sprites (org token, for deploys
# from the workshop). Run it again any time: it updates what is there.
set -euo pipefail

ORG=marble-drive GITHUB="" NPM="" SPRITES="" SPRITE=""
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
say() { printf '==> %s\n' "$*"; }
die() { printf 'sprite-workshop: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG=${2:?}; shift 2 ;;
    --github) GITHUB=${2:?}; shift 2 ;;
    --npm) NPM=${2:?}; shift 2 ;;
    --sprites) SPRITES=${2:?}; shift 2 ;;
    -h|--help|-*) usage ;;
    *) [[ -z "$SPRITE" ]] || usage; SPRITE=$1; shift ;;
  esac
done
[[ -n "$SPRITE" ]] || usage
for f in "$GITHUB" "$NPM" "$SPRITES"; do [[ -z "$f" || -r "$f" ]] || die "cannot read $f"; done

on() { sprite exec -o "$ORG" -s "$SPRITE" --no-stdin "$@"; }
SRC=/home/sprite/src
KEYS=/home/sprite/.config/marble-drive
WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
umask 077
token() { tr -d '[:space:]' <"$1"; }

# ---------------------------------------------------------------- identity
say "committing as $(git config user.name) <$(git config user.email)>"
on -- git config --global user.name "$(git config user.name)"
on -- git config --global user.email "$(git config user.email)"
on -- sh -c "mkdir -p $KEYS && chmod 700 $KEYS"

# -------------------------------------------------------------------- keys
if [[ -n "$GITHUB" ]]; then
  say "GitHub token (not printed)"
  token "$GITHUB" >"$WORK/github"
  on --file "$WORK/github:$KEYS/github-token" -- sh -c "chmod 600 $KEYS/github-token && gh auth login --with-token <$KEYS/github-token && gh auth setup-git && rm -f $KEYS/github-token && gh auth status 2>&1 | grep -E 'Logged in|account' | head -1"
fi
if [[ -n "$NPM" ]]; then
  say "npm token (not printed)"
  printf '//registry.npmjs.org/:_authToken=%s\n' "$(token "$NPM")" >"$WORK/npmrc"
  on --file "$WORK/npmrc:/home/sprite/.npmrc" -- sh -c 'chmod 600 ~/.npmrc && npm whoami 2>&1 | sed "s/^/   npm: /"'
fi
if [[ -n "$SPRITES" ]]; then
  say "Sprites token (not printed)"
  token "$SPRITES" >"$WORK/sprites"
  on --file "$WORK/sprites:$KEYS/sprites-token" -- sh -c "chmod 600 $KEYS/sprites-token && sprite auth setup --token \"\$(cat $KEYS/sprites-token)\" >/dev/null && rm -f $KEYS/sprites-token && sprite list -o $ORG 2>&1 | head -1 | sed 's/^/   sees: /'"
fi

# --------------------------------------------------------------- checkouts
say "checkouts in $SRC"
on -- bash -c '
set -uo pipefail
SRC='"$SRC"'
mkdir -p "$SRC"
checkout() { # checkout <name> <url>
  local dir="$SRC/$1"
  if [[ ! -d "$dir/.git" ]]; then
    git clone --quiet "$2" "$dir" && echo "   $1: cloned" || { echo "   $1: could not clone (for the private marble repo, pass --github)"; return 1; }
  elif [[ -n "$(git -C "$dir" status --porcelain)" ]]; then
    echo "   $1: has local changes; left as it is"
  else
    git -C "$dir" fetch --quiet origin && git -C "$dir" merge --ff-only --quiet "origin/$(git -C "$dir" rev-parse --abbrev-ref HEAD)" \
      && echo "   $1: up to date at $(git -C "$dir" rev-parse --short HEAD)" || echo "   $1: could not fast-forward; left as it is"
  fi
}
checkout marble https://github.com/marble-app/marble.git; have_marble=$?
checkout marble-drive https://github.com/marble-app/marble-drive.git
if [[ $have_marble == 0 ]]; then (cd "$SRC/marble" && npm install --no-audit --no-fund --loglevel=error >/dev/null && echo "   marble: installed"); fi
if [[ -d "$SRC/marble" ]]; then (cd "$SRC/marble-drive" && npm install --no-audit --no-fund --loglevel=error >/dev/null && echo "   marble-drive: installed"); else echo "   marble-drive: not installed (needs ../marble)"; fi
'

# ---------------------------------------------------------------- projects
say "agent projects"
on -- node -e '
const fs = require("fs");
const env = fs.readFileSync(process.env.HOME + "/.config/marble-drive/sprite.env", "utf8");
const secret = (/^MARBLE_DRIVE_SECRET=(.*)$/m.exec(env) || [])[1];
const base = "http://localhost:4400";
(async () => {
  let cookie = "";
  if (secret) {
    const g = await fetch(base + "/gate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret }) });
    cookie = (g.headers.get("set-cookie") || "").split(";")[0];
  }
  for (const [name, dir] of [["Marble Drive", "marble-drive"], ["Marble", "marble"]]) {
    const path = "/home/sprite/src/" + dir;
    if (!fs.existsSync(path)) { console.log("   " + name + ": no checkout, not registered"); continue; }
    const r = await fetch(base + "/agent/projects", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name, path }) });
    const p = await r.json();
    console.log("   " + name + ": " + (r.ok ? "registered (" + p.path + ")" : "not registered: " + (p.error || r.status)));
  }
})();
'
say "workshop ready on $SPRITE"
