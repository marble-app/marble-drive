#!/usr/bin/env bash
# Put the workshop's checkouts back on a sprite from this Mac's copy
# (tools/drive-backup.sh makes it; docs/HOSTING.md, "Back a drive up here").
#
#   tools/workshop-restore.sh <sprite> [<checkout> ...] [--from <dir>] [--org <org>] [--yes]
#
# Every checkout in the copy, or the ones named, goes to /home/sprite/src on
# <sprite>, each with its .git and its uncommitted work. A checkout already
# there by that name is set aside as <name>.before-restore-<utc>, never
# overwritten. Without --yes it says what it would do. node_modules is not in
# the copy: run `npm install` in each afterwards. Sign-ins (GitHub, npm, Claude,
# Sprites) are not in it either; the owner signs in again on a new sprite.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ORG=marble-drive FROM="$HOME/Marble Workshop" YES=0 SPRITE="" NAMES=()
REMOTE_SRC="${BACKUP_REMOTE_SRC:-/home/sprite/src}"
RSH="${BACKUP_RSH:-$HERE/sprite-rsh.sh}"
SPRITE_BIN="${SPRITE_BIN:-sprite}"
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM=$2; shift 2 ;;
    --org) ORG=$2; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help|-*) usage ;;
    *) if [[ -z "$SPRITE" ]]; then SPRITE=$1; else NAMES+=("$1"); fi; shift ;;
  esac
done
[[ -n "$SPRITE" ]] || usage
[[ "$SPRITE" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || { echo "workshop-restore: not a sprite name: $SPRITE"; exit 2; }
[[ -d "$FROM" ]] || { echo "workshop-restore: no copy at $FROM"; exit 1; }
on() { "$SPRITE_BIN" exec -o "$ORG" -s "$SPRITE" --no-stdin -- sh -c "$1"; }

if [[ ${#NAMES[@]} -eq 0 ]]; then
  for dir in "$FROM"/*/; do [[ -e "$dir/.git" ]] && NAMES+=("$(basename "$dir")"); done
fi
[[ ${#NAMES[@]} -gt 0 ]] || { echo "workshop-restore: no checkouts in $FROM"; exit 1; }
for name in "${NAMES[@]}"; do
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ && "$name" != . && "$name" != .. ]] || { echo "workshop-restore: not a checkout name: $name"; exit 2; }
  [[ -d "$FROM/$name/.git" || -f "$FROM/$name/.git" ]] || { echo "workshop-restore: $name is not a checkout in $FROM"; exit 1; }
done

synced="$(sed -n 's/.*"syncedAt":"\([^"]*\)".*/\1/p' "$FROM/workshop.json" 2>/dev/null || true)"
echo "from $FROM${synced:+ (copied $synced)} to $SPRITE:$REMOTE_SRC"
for name in "${NAMES[@]}"; do echo "  $name"; done
if [[ $YES != 1 ]]; then
  echo "(nothing done: add --yes)"
  exit 0
fi

utc="$(date -u +%Y%m%dT%H%M%SZ)"
on "mkdir -p '$REMOTE_SRC'"
for name in "${NAMES[@]}"; do
  on "if [ -e '$REMOTE_SRC/$name' ]; then mv '$REMOTE_SRC/$name' '$REMOTE_SRC/$name.before-restore-$utc' && echo '  set aside: $name.before-restore-$utc'; fi"
  rsync -a -e "$RSH" "$FROM/$name/" "$SPRITE:$REMOTE_SRC/$name/"
  echo "  restored $name"
done
echo "done. Next, in each: npm install. Sign in again where this is a new sprite (gh auth login, npm login, claude, sprite login)."
