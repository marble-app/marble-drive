#!/usr/bin/env bash
# Copy a sprite's drive to this machine, as a mirror to run harnesses and try
# upgrades against real documents (docs/HOSTING.md, "Mirror a drive here").
#
#   tools/drive-pull.sh [<sprite>] [--org <org>] [--into <dir>]
#   tools/drive-pull.sh --hub [<drive>] [--into <dir>]
#
# <sprite> defaults to admin-p2, --into to this checkout's drive/ (the drive a
# local host serves). One way only: nothing goes back to the sprite, and
# anything written to the mirror is lost at the next pull. Real edits happen
# on the drive's home.
#
# --hub copies from the hub instead (R2, encrypted; docs/HOSTING.md, "What the
# hub holds"): the drive as its home last uploaded it, wherever that home is
# (the PC, the Mac or Fly), with no machine woken. <drive> defaults to bryan;
# the settings are ~/.config/marble-drive/hub-<drive>.env. Reading the hub
# never writes to it. Only what changed since the last mirror is fetched.
#
# From a sprite, the sprite must be up: the copy streams through `sprite exec`, and waking it
# can take a minute. The copy is taken while the drive is live, so a file
# written at that moment may be caught half-way; stop the sprite's service
# first when that matters.
#
# What was at --into is set aside, never deleted: an earlier mirror (it has
# .marble/mirror.json) becomes <into>.previous, replacing the one before it;
# anything else becomes <into>.kept-<utc>. Refuses while a host holds the drive
# (its .marble/agents/host.lock names a live pid).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MARBLE_DIR="${MARBLE_DIR:-$(cd "$REPO/.." && pwd)/marble}"

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }

SPRITE=admin-p2 ORG=marble-drive INTO="$REPO/drive" HUB=""
if [[ $# -gt 0 && "$1" != -* ]]; then SPRITE=$1; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hub) HUB=bryan; if [[ $# -gt 1 && "$2" != -* ]]; then HUB=$2; shift; fi; shift ;;
    --org) ORG=$2; shift 2 ;;
    --into) INTO=$2; shift 2 ;;
    -h|--help) usage ;;
    *) echo "drive-pull: unknown option $1"; usage ;;
  esac
done
INTO="$(cd "$(dirname "$INTO")" && pwd)/$(basename "$INTO")"
STAGE="$INTO.pulling"
say() { printf '==> %s\n' "$*"; }

# A host serving the drive would keep writing into the copy being set aside,
# and boot on the new one with the old one's state in memory.
held() {
  local lock="$INTO/.marble/agents/host.lock" pid
  [[ -f "$lock" ]] || return 1
  pid="$(head -n 1 "$lock")"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}
if held; then
  echo "drive-pull: a host is serving $INTO (pid $(head -n 1 "$INTO/.marble/agents/host.lock")). Stop it first"
  echo "  (macos/launchd/daemon.sh stop, or end the terminal running serve), then pull again."
  exit 1
fi

on_sprite() { sprite exec -o "$ORG" -s "$SPRITE" --no-stdin -- "$@"; }

# Counted the same way on both sides: every file but the host's lock, and the
# documents outside .marble/.
COUNT='find . -type f ! -path ./.marble/agents/host.lock | wc -l; find . -name "*.mrbl" ! -path "./.marble/*" | wc -l'

rm -rf "$STAGE"
if [[ -n "$HUB" ]]; then
  HUB_ENV="$HOME/.config/marble-drive/hub-$HUB.env"
  [[ -f "$HUB_ENV" ]] || { echo "drive-pull: no hub settings at $HUB_ENV"; exit 1; }
  # Start from the last mirror, so only what changed comes down (a clone of
  # the files where the disk can, a copy where not).
  if [[ -f "$INTO/.marble/mirror.json" ]]; then
    cp -cR "$INTO" "$STAGE" 2>/dev/null || cp -a --reflink=auto "$INTO" "$STAGE" 2>/dev/null || cp -R "$INTO" "$STAGE"
  else
    mkdir -p "$STAGE"
  fi
  say "downloading $HUB from the hub into $STAGE"
  # A home that is serving keeps uploading, so a long first pass can end a
  # file or two behind the hub's newest list. Each pass after it fetches only
  # those, in seconds; three tries, then give up and say so.
  for try in 1 2 3; do
    RESULT="$(MARBLE_HUB_ENV="$HUB_ENV" node "$REPO/tools/drive-sync.mjs" down --root "$STAGE")" || {
      echo "drive-pull: the download failed; left what came down at $STAGE and changed nothing"
      exit 1
    }
    node -e 'const r = JSON.parse(process.argv[1]); if (!r.ok) { console.log(`drive-pull: ${r.why}`); process.exit(2); } console.log(`==> the hub has ${r.state.files} files, ${r.state.documents} documents, uploaded by ${r.state.home} at ${r.state.at}; ${r.matches ? "the copy matches it" : "the copy is behind it (the drive changed during the pull)"}`); process.exit(r.matches ? 0 : 1);' "$RESULT" && break
    status=$?
    if (( status == 2 || try == 3 )); then
      echo "drive-pull: left the copy at $STAGE and changed nothing"
      exit 1
    fi
    say "catching up"
  done
  SOURCE="hub:$HUB"
else
  say "reaching $SPRITE (a sleeping sprite takes up to a minute to wake)"
  REMOTE="$(on_sprite sh -c "cd /drive && { $COUNT; }" | tr -s ' \n' ' ')" || {
    echo "drive-pull: could not reach $SPRITE. It has to be running; see docs/HOSTING.md, Troubleshooting."
    exit 1
  }
  read -r R_FILES R_DOCS <<<"$REMOTE"
  say "$SPRITE:/drive has $R_FILES files, $R_DOCS documents"

  mkdir -p "$STAGE"
  say "copying into $STAGE"
  # GNU tar exits 1 when a file changed while it was read: expected on a live
  # drive, and the next pull catches it up.
  on_sprite sh -c 'tar -C /drive -czf - --warning=no-file-changed --exclude=./.marble/agents/host.lock . ; s=$?; [ "$s" -le 1 ] || exit "$s"' \
    | tar -xzf - -C "$STAGE"
  SOURCE="$SPRITE"
fi

read -r L_FILES L_DOCS <<<"$(cd "$STAGE" && sh -c "$COUNT" | tr -s ' \n' ' ')"
say "copy has $L_FILES files, $L_DOCS documents"
if [[ "$L_DOCS" -eq 0 ]]; then
  echo "drive-pull: the copy has no documents; left it at $STAGE and changed nothing"
  exit 1
fi
if [[ -z "$HUB" ]]; then
  [[ "$L_FILES" == "$R_FILES" && "$L_DOCS" == "$R_DOCS" ]] \
    || say "counts differ from a moment ago: the drive was being written to while it was copied"
fi

# Agent projects name paths on the sprite, or on the PC or the Mac. Point the
# workshop checkouts at this machine's, and drop the rest, as a drive move does.
SETTINGS="$STAGE/.marble/agents/settings.json"
if [[ -f "$SETTINGS" ]]; then
  node - "$SETTINGS" "$REPO" "$MARBLE_DIR" <<'JS'
const fs = require('fs');
const [file, repo, marble] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const here = { 'marble-drive': repo, marble };
const checkout = /^(?:\/home\/sprite\/src|\/(?:home|Users)\/[^/]+\/Development\/3rd-year-projects)\/(marble-drive|marble)$/;
const kept = [];
for (const p of s.projects ?? []) {
  const path = here[checkout.exec(p.path)?.[1]] ?? p.path;
  if (fs.existsSync(path)) kept.push({ ...p, path });
  else console.log(`==> dropped agent project "${p.name}" (${p.path} is not on this machine)`);
}
s.projects = kept;
if (s.defaultProject && !kept.some((p) => p.id === s.defaultProject)) delete s.defaultProject;
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
JS
fi

NOW="$(date -u +%Y%m%dT%H%M%SZ)"
cat >"$STAGE/.marble/mirror.json" <<EOF
{
  "mirrorOf": "$SOURCE",
  "org": "$ORG",
  "pulledAt": "$NOW",
  "files": $L_FILES,
  "documents": $L_DOCS,
  "note": "A copy, pulled one way by tools/drive-pull.sh. Edits made here are lost at the next pull."
}
EOF

if held; then
  echo "drive-pull: a host started on $INTO during the copy; the copy is at $STAGE, nothing was swapped"
  exit 1
fi
if [[ -e "$INTO" ]]; then
  if [[ -f "$INTO/.marble/mirror.json" ]]; then
    rm -rf "$INTO.previous"
    mv "$INTO" "$INTO.previous"
    say "the last mirror is now $INTO.previous"
  else
    mv "$INTO" "$INTO.kept-$NOW"
    say "what was there is kept at $INTO.kept-$NOW"
  fi
fi
mv "$STAGE" "$INTO"
say "done: $INTO mirrors $SOURCE as of $NOW"
