#!/usr/bin/env bash
# Keep one copy of a sprite's drive on this machine, paired with a restore
# point on Fly, so a drive survives its sprite (docs/HOSTING.md, "Back a drive
# up here").
#
#   tools/drive-backup.sh [<sprite>] [--org <org>] [--to <dir>] [--link <path>] [--why <text>] [--no-checkpoint]
#
# <sprite> defaults to admin-p2, --to to ~/Marble Backups, --link to
# ~/Marble Drive. The copy is <to>/<utc>/, the whole drive as it was at <utc>;
# <link> points at it. Each run makes a Fly checkpoint first (the history lives
# on Fly), copies the drive into <to>/<new utc>/ with every unchanged file a
# hard link to the copy before (so only what changed moves), points <link> at
# the new copy, and removes the old one. A run that fails leaves the old copy
# and the link as they were.
#
# The copy carries its sync reference in .marble/sync.json: which drive, when,
# the Fly checkpoint it matches, documents, files, bytes added, seconds, why.
# tools/drive-restore.sh leaves that file behind.
#
# When to run is tools/backup-agent.mjs's call; this only runs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SPRITE=admin-p2 ORG=marble-drive TO="$HOME/Marble Backups" LINK="$HOME/Marble Drive" WHY=asked CHECKPOINT=1
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
if [[ $# -gt 0 && "$1" != -* ]]; then SPRITE=$1; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG=$2; shift 2 ;;
    --to) TO=$2; shift 2 ;;
    --link) LINK=$2; shift 2 ;;
    --why) WHY=$2; shift 2 ;;
    --no-checkpoint) CHECKPOINT=0; shift ;;
    -h|--help) usage ;;
    *) echo "drive-backup: unknown option $1"; usage ;;
  esac
done
SNAP='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$'
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { printf '%s %s\n' "$(stamp)" "$*"; }

mkdir -p "$TO"
if [[ -e "$LINK" && ! -L "$LINK" ]]; then echo "drive-backup: $LINK is a real folder, not a link; move it aside first"; exit 1; fi
# One run at a time: a stuck sprite holds `sprite exec` for minutes.
LOCK="$TO/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then say "skip: another backup is running (pid $pid)"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

OLD="$(ls -1 "$TO" | grep -E "$SNAP" | sort | tail -1 || true)"
NAME="$(date -u +%Y-%m-%dT%H%M%SZ)"
PARTIAL="$TO/.partial-$NAME"
began="$(date -u +%s)"
say "backing up $SPRITE ($WHY) -> $TO/$NAME"

# The restore point on Fly first, so the copy and the checkpoint are the same
# moment, give or take the copy's length. Sprites' checkpoint store can get
# stuck (docs/HOSTING.md, Troubleshooting); then the copy goes ahead without.
checkpoint=""
checkpoint_error=""
if [[ $CHECKPOINT == 1 ]]; then
  comment="backup $NAME"
  out="$(sprite checkpoint create -o "$ORG" -s "$SPRITE" --comment "$comment" 2>&1 || true)"
  checkpoint="$(sprite api -o "$ORG" "/v1/sprites/$SPRITE/checkpoints" 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const b=JSON.parse(d);const l=Array.isArray(b)?b:(b.data??b.checkpoints??[]);const c=l.find(x=>x.comment===process.argv[1]);process.stdout.write(c?.id??"")}catch{}})' "$comment" || true)"
  if [[ -z "$checkpoint" ]]; then
    checkpoint_error="$(printf '%s' "$out" | grep -v '^●' | tail -1 | sed 's/^✗ *//')"
    say "no Fly checkpoint: ${checkpoint_error:-it did not appear}"
  else
    say "Fly checkpoint $checkpoint"
  fi
fi

LINKDEST=()
[[ -n "$OLD" ]] && LINKDEST=(--link-dest="$TO/$OLD/")
set +e
rsync -a --delete --exclude=/.marble/agents/host.lock --exclude=/.marble/sync.json ${LINKDEST[@]+"${LINKDEST[@]}"} \
  -e "$HERE/sprite-rsh.sh" "$SPRITE:/drive/" "$PARTIAL/"
code=$?
set -e
# 24: files vanished while being read, which a live drive does. The next copy
# has them as they ended up.
if [[ $code != 0 && $code != 24 ]]; then
  rm -rf "$PARTIAL"
  say "FAILED: rsync exit $code; the copy from ${OLD:-nothing} stays"
  exit 1
fi

docs="$(cd "$PARTIAL" && find . -name '*.mrbl' ! -path './.marble/*' | wc -l | tr -d ' ')"
files="$(find "$PARTIAL" -type f | wc -l | tr -d ' ')"
# A file with one link is in no copy before this one: what this run added.
added="$(find "$PARTIAL" -type f -links 1 -print0 | xargs -0 stat -f %z 2>/dev/null | awk '{ s += $1 } END { print s + 0 }')"
json() { local v="${1//\\/\\\\}"; v="${v//\"/\\\"}"; printf '"%s"' "$v"; }
mkdir -p "$PARTIAL/.marble"
printf '{"from":%s,"org":%s,"name":%s,"syncedAt":%s,"checkpoint":%s,"checkpointError":%s,"documents":%s,"files":%s,"added":%s,"took":%s,"why":%s}\n' \
  "$(json "$SPRITE")" "$(json "$ORG")" "$(json "$NAME")" "$(json "$(stamp)")" \
  "$([[ -n "$checkpoint" ]] && json "$checkpoint" || echo null)" "$([[ -n "$checkpoint_error" ]] && json "$checkpoint_error" || echo null)" \
  "$docs" "$files" "$added" "$(( $(date -u +%s) - began ))" "$(json "$WHY")" >"$PARTIAL/.marble/sync.json"

mv "$PARTIAL" "$TO/$NAME"
ln -sfn "$TO/$NAME" "$LINK"
# Only now is the old copy not needed. Its files that did not change live on
# in the new one through their other link.
for snap in $(ls -1 "$TO" | grep -E "$SNAP"); do
  [[ "$snap" == "$NAME" ]] || rm -rf "${TO:?}/$snap"
done
find "$TO" -maxdepth 1 -name ".partial-*" -exec rm -rf {} +
say "done: $NAME, $docs documents${checkpoint:+, Fly checkpoint $checkpoint}"
