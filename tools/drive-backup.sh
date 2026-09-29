#!/usr/bin/env bash
# Keep one copy of a sprite's drive on this machine, paired with a restore
# point on Fly, so a drive survives its sprite (docs/HOSTING.md, "Back a drive
# up here").
#
#   tools/drive-backup.sh [<sprite>] [--org <org>] [--to <dir>] [--link <path>] [--why <text>] [--no-checkpoint] [--no-workshop]
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
# Then the workshop, where the sprite has one: its checkouts
# (/home/sprite/src), each with its .git (local commits, branches, stashes)
# and its uncommitted work, so code not yet pushed survives the sprite too.
# One copy, <to>/workshop/<utc>/, linked from --workshop-link (~/Marble
# Workshop), made the same way; node_modules stays behind (npm install brings
# it back). Its workshop.json says which checkouts hold work that is nowhere
# else: uncommitted changes, or commits no remote has. A failure there is said
# and leaves the last copy; the drive's backup stands. tools/workshop-restore.sh
# puts checkouts back on a sprite. Sign-ins are not copied: they are the
# owner's to carry.
#
# When to run is tools/backup-agent.mjs's call; this only runs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SPRITE=admin-p2 ORG=marble-drive TO="$HOME/Marble Backups" LINK="$HOME/Marble Drive" WHY=asked CHECKPOINT=1
WORKSHOP=1 WLINK="$HOME/Marble Workshop"
# Where things are on the sprite, and how rsync gets there; only tests change them.
REMOTE_DRIVE="${BACKUP_REMOTE_DRIVE:-/drive}" REMOTE_SRC="${BACKUP_REMOTE_SRC:-/home/sprite/src}"
RSH="${BACKUP_RSH:-$HERE/sprite-rsh.sh}"
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
if [[ $# -gt 0 && "$1" != -* ]]; then SPRITE=$1; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG=$2; shift 2 ;;
    --to) TO=$2; shift 2 ;;
    --link) LINK=$2; shift 2 ;;
    --why) WHY=$2; shift 2 ;;
    --no-checkpoint) CHECKPOINT=0; shift ;;
    --no-workshop) WORKSHOP=0; shift ;;
    --workshop-link) WLINK=$2; shift 2 ;;
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
  -e "$RSH" "$SPRITE:$REMOTE_DRIVE/" "$PARTIAL/"
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

[[ $WORKSHOP == 1 ]] || exit 0
W="$TO/workshop"
mkdir -p "$W"
WOLD="$(ls -1 "$W" | grep -E "$SNAP" | sort | tail -1 || true)"
WPARTIAL="$W/.partial-$NAME"
WLINKDEST=()
[[ -n "$WOLD" ]] && WLINKDEST=(--link-dest="$W/$WOLD/")
set +e
rsync -a --delete --exclude=node_modules/ ${WLINKDEST[@]+"${WLINKDEST[@]}"} -e "$RSH" "$SPRITE:$REMOTE_SRC/" "$WPARTIAL/" 2>"$W/.rsync-err"
code=$?
set -e
if [[ $code != 0 && $code != 24 ]]; then
  if grep -q -i "no such file" "$W/.rsync-err"; then say "no workshop on $SPRITE"; else say "workshop FAILED: rsync exit $code ($(tail -1 "$W/.rsync-err")); the copy from ${WOLD:-nothing} stays"; fi
  rm -rf "$WPARTIAL" "$W/.rsync-err"
  exit 0
fi
rm -f "$W/.rsync-err"
# What is nowhere else: per checkout, files changed and not committed, and
# commits on no remote. Read from the copy, which has each .git.
report="" held=""
# A worktree's .git names its repository by where it is on the sprite; here
# that is the same place in this copy. Unpushed is per checkout: commits on its
# HEAD that no remote has (worktrees share branches). A checkout git cannot
# read here is a "?", never a failed backup.
for dir in "$WPARTIAL"/*/; do
  dir="${dir%/}"
  [[ -e "$dir/.git" ]] || continue
  name="$(basename "$dir")"
  g=(git -C "$dir")
  if [[ -f "$dir/.git" ]]; then
    gitdir="$(sed -n 's/^gitdir: //p' "$dir/.git")"
    [[ "$gitdir" == "$REMOTE_SRC/"* ]] && g=(git --git-dir="$WPARTIAL/${gitdir#"$REMOTE_SRC/"}" --work-tree="$dir")
  fi
  if changed="$("${g[@]}" status --porcelain 2>/dev/null)" && unpushed="$("${g[@]}" log HEAD --not --remotes --oneline 2>/dev/null)"; then
    changed="$(printf '%s' "$changed" | grep -c . || true)"
    unpushed="$(printf '%s' "$unpushed" | grep -c . || true)"
    (( changed + unpushed > 0 )) && held="$held${held:+, }$name ($changed changed, $unpushed unpushed)"
  else
    changed='"?"' unpushed='"?"'
    held="$held${held:+, }$name (unreadable here)"
  fi
  branch="$("${g[@]}" branch --show-current 2>/dev/null || true)"
  report="$report${report:+,}{\"checkout\":$(json "$name"),\"branch\":$(json "$branch"),\"changed\":$changed,\"unpushed\":$unpushed}"
done
wfiles="$(find "$WPARTIAL" -type f | wc -l | tr -d ' ')"
printf '{"from":%s,"name":%s,"syncedAt":%s,"drive":%s,"files":%s,"checkouts":[%s]}\n' \
  "$(json "$SPRITE")" "$(json "$NAME")" "$(json "$(stamp)")" "$(json "$NAME")" "$wfiles" "$report" >"$WPARTIAL/workshop.json"
mv "$WPARTIAL" "$W/$NAME"
ln -sfn "$W/$NAME" "$WLINK"
for snap in $(ls -1 "$W" | grep -E "$SNAP"); do
  [[ "$snap" == "$NAME" ]] || rm -rf "${W:?}/$snap"
done
find "$W" -maxdepth 1 -name ".partial-*" -exec rm -rf {} +
say "workshop: $wfiles files${held:+; only here: $held}"
