#!/usr/bin/env bash
# Back a sprite's drive up to this machine, as dated snapshots, so a drive
# survives its sprite (docs/HOSTING.md, "Back a drive up here").
#
#   tools/drive-backup.sh [<sprite>] [--org <org>] [--to <dir>] [--if-changed [--every <min>]] [--why <text>]
#   tools/drive-backup.sh --list [<sprite>] [--to <dir>]
#
# <sprite> defaults to admin-p1, --to to ~/Marble Backups. Each run is
# <to>/<sprite>/<utc>/, a whole drive: files that did not change are hard links
# to the snapshot before, so a run moves and stores only what changed.
# <to>/<sprite>/latest points at the newest. Nothing here ever writes to the
# sprite, and nothing reads a snapshot back except tools/drive-restore.sh.
#
# --if-changed is the scheduled run (tools/backup-agent.mjs): it asks the
# Sprites API, which wakes nobody, and backs up only when the drive may have
# changed since the last snapshot: the sprite is running and the last snapshot
# is --every minutes old (15); or it was running at the last snapshot and has
# gone to sleep since (one wake, for the last word); or it woke and slept again
# between two runs.
#
# Each snapshot adds a line to <to>/<sprite>/.snapshots.jsonl: its name,
# documents, files, the bytes it added (files not linked to the one before),
# seconds taken and why, which is what the Console's Backups view reads.
#
# Kept: every snapshot from the last day, the newest of each day for 60 days,
# the newest of each month after that.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SPRITE=admin-p1 ORG=marble-drive TO="$HOME/Marble Backups" IF_CHANGED=0 LIST=0 EVERY=15 WHY=""
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
[[ "${1:-}" == --list ]] && { LIST=1; shift; }
if [[ $# -gt 0 && "$1" != -* ]]; then SPRITE=$1; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG=$2; shift 2 ;;
    --to) TO=$2; shift 2 ;;
    --if-changed) IF_CHANGED=1; shift ;;
    --every) EVERY=$2; shift 2 ;;
    --why) WHY=$2; shift 2 ;;
    -h|--help) usage ;;
    *) echo "drive-backup: unknown option $1"; usage ;;
  esac
done
DEST="$TO/$SPRITE"
STATE="$DEST/.state"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { printf '%s %s\n' "$(stamp)" "$*"; }

if [[ $LIST == 1 ]]; then
  [[ -d "$DEST" ]] || { echo "no backups of $SPRITE in $TO"; exit 0; }
  ls -1 "$DEST" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$' || true
  [[ -L "$DEST/latest" ]] && echo "latest -> $(readlink "$DEST/latest")"
  exit 0
fi

mkdir -p "$DEST"
# One run at a time: a stuck sprite holds `sprite exec` for minutes, longer
# than the schedule's interval.
LOCK="$DEST/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then say "skip: another backup is running (pid $pid)"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

last_end="" tail_due=0
[[ -f "$STATE" ]] && source "$STATE"

if [[ $IF_CHANGED == 1 ]]; then
  info="$(sprite api -o "$ORG" "/v1/sprites/$SPRITE" 2>/dev/null)" || { say "skip: the Sprites API did not answer"; exit 0; }
  field() { plutil -extract "$1" raw -o - - <<<"$info" 2>/dev/null || true; }
  status="$(field status)" ran="$(field last_running_at)"
  if [[ "$status" == running ]]; then
    # Awake: every --every minutes, not every time it is asked.
    if [[ -n "$last_end" ]]; then
      ended="$(date -u -j -f %Y-%m-%dT%H:%M:%SZ "$last_end" +%s 2>/dev/null || echo 0)"
      (( $(date -u +%s) - ended >= EVERY * 60 )) || exit 0
    fi
    why="running"; was_running=1
  elif [[ $tail_due == 1 ]]; then why="asleep since the last snapshot, which it was awake for"; was_running=0
  elif [[ -n "$ran" && -n "$last_end" && "$ran" > "$last_end" ]]; then why="woke at $ran and slept again"; was_running=0
  elif [[ -z "$last_end" ]]; then why="first backup"; was_running=0
  else exit 0; fi
else
  why="${WHY:-asked}"; was_running=0
fi

NAME="$(date -u +%Y-%m-%dT%H%M%SZ)"
began="$(date -u +%s)"
PARTIAL="$DEST/.partial-$NAME"
LINK=()
[[ -d "$DEST/latest/" ]] && LINK=(--link-dest="$DEST/latest/")
say "backing up $SPRITE ($why) -> $DEST/$NAME"
set +e
rsync -a --delete --exclude=/.marble/agents/host.lock ${LINK[@]+"${LINK[@]}"} \
  -e "$HERE/sprite-rsh.sh" "$SPRITE:/drive/" "$PARTIAL/"
code=$?
set -e
# 24: files vanished while being read, which a live drive does. The next
# snapshot has them as they ended up.
if [[ $code != 0 && $code != 24 ]]; then
  say "FAILED: rsync exit $code; the partial copy is at $PARTIAL"
  exit 1
fi
mv "$PARTIAL" "$DEST/$NAME"
ln -sfn "$NAME" "$DEST/latest"
docs="$(cd "$DEST/$NAME" && find . -name '*.mrbl' ! -path './.marble/*' | wc -l | tr -d ' ')"
files="$(find "$DEST/$NAME" -type f | wc -l | tr -d ' ')"
# A file with one link is in no snapshot before this one: what this run added.
added="$(find "$DEST/$NAME" -type f -links 1 -print0 | xargs -0 stat -f %z 2>/dev/null | awk '{ s += $1 } END { print s + 0 }')"
printf '{"name":"%s","documents":%s,"files":%s,"added":%s,"took":%s,"why":"%s"}\n' \
  "$NAME" "$docs" "$files" "$added" "$(( $(date -u +%s) - began ))" "${why//\"/\'}" >>"$DEST/.snapshots.jsonl"
printf 'last_end=%s\ntail_due=%s\n' "$(stamp)" "$was_running" >"$STATE"
say "done: $NAME, $docs documents"

# Keep every snapshot from the last day, the newest of each day for 60 days,
# the newest of each month after that. Names sort by time, so newest first
# is a reverse sort.
now="$(date -u +%s)" seen=""
for snap in $(ls -1 "$DEST" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$' | sort -r); do
  t="$(date -u -j -f %Y-%m-%dT%H%M%SZ "$snap" +%s)"
  age=$(( (now - t) / 86400 ))
  if (( age < 1 )); then continue; fi
  if (( age < 60 )); then key="d${snap:0:10}"; else key="m${snap:0:7}"; fi
  case " $seen " in
    *" $key "*) rm -rf "${DEST:?}/$snap"; say "pruned $snap" ;;
    *) seen="$seen $key" ;;
  esac
done
find "$DEST" -maxdepth 1 -name ".partial-*" -exec rm -rf {} +
