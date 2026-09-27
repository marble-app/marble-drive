#!/usr/bin/env bash
# Put a backed-up drive (tools/drive-backup.sh) back on a sprite: the one it
# came from, after a crash, or a new one made to replace it.
#
#   tools/drive-restore.sh <snapshot> <sprite> [--org <org>] [--yes]
#
# <snapshot> is a snapshot folder, e.g. "~/Marble Backups/admin-p1/latest".
# Without --yes it only says what it would do. With it: the host stops; the
# sprite's /drive is set aside as /drive.before-restore-<utc> (never deleted);
# the snapshot is copied into a fresh /drive, copying unchanged files from the
# set-aside one on the sprite rather than over the network; the host starts
# again and must answer /health. The sprite needs a release already (a deploy,
# or sprite-provision.sh for a new one); settings and keys outside /drive are
# not in a backup and stay as they are.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ORG=marble-drive YES=0 ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG=$2; shift 2 ;;
    --yes) YES=1; shift ;;
    -*) echo "drive-restore: unknown option $1"; exit 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
[[ ${#ARGS[@]} == 2 ]] || { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }
SNAP="$(cd "${ARGS[0]}" && pwd -P)" SPRITE=${ARGS[1]}
[[ -d "$SNAP/.marble" ]] || { echo "drive-restore: $SNAP is not a drive (no .marble/)"; exit 1; }
[[ -f "$SNAP/.marble/mirror.json" ]] && { echo "drive-restore: $SNAP is a working mirror (drive-pull.sh), which may have been written to; restore a backup snapshot"; exit 1; }

SERVICE=marble-drive
NOW="$(date -u +%Y%m%dT%H%M%SZ)"
ASIDE="/drive.before-restore-$NOW"
DOCS="$(cd "$SNAP" && find . -name '*.mrbl' ! -path './.marble/*' | wc -l | tr -d ' ')"
FILES="$(cd "$SNAP" && find . -type f | wc -l | tr -d ' ')"
say() { printf '==> %s\n' "$*"; }
on_sprite() { sprite exec -o "$ORG" -s "$SPRITE" --no-stdin -- "$@"; }

say "restore $SNAP ($FILES files, $DOCS documents)"
say "onto $SPRITE (org $ORG): stop $SERVICE, /drive -> $ASIDE, copy in, start $SERVICE"
[[ $YES == 1 ]] || { echo "Nothing done. Add --yes to do it."; exit 0; }

say "stopping $SERVICE"
on_sprite sprite-env services stop "$SERVICE" >/dev/null 2>&1 || say "(it was not running)"
say "setting /drive aside as $ASIDE"
on_sprite sh -c "set -e; [ ! -e /drive ] || sudo mv /drive '$ASIDE'; sudo install -d -o sprite -g sprite /drive"

say "copying in"
COPY_DEST=()
on_sprite test -d "$ASIDE" && COPY_DEST=(--copy-dest="$ASIDE/")
set +e
rsync -a ${COPY_DEST[@]+"${COPY_DEST[@]}"} -e "$HERE/sprite-rsh.sh" "$SNAP/" "$SPRITE:/drive/"
code=$?
set -e
if [[ $code != 0 ]]; then
  echo "drive-restore: rsync exit $code. $SERVICE is stopped; the drive before this is at $ASIDE on $SPRITE."
  exit 1
fi
read -r R_FILES R_DOCS <<<"$(on_sprite sh -c "cd /drive && find . -type f | wc -l; find . -name '*.mrbl' ! -path './.marble/*' | wc -l" | tr -s ' \n' ' ')"
say "on $SPRITE: $R_FILES files, $R_DOCS documents"
[[ "$R_FILES" == "$FILES" && "$R_DOCS" == "$DOCS" ]] || { echo "drive-restore: counts differ from the snapshot; $SERVICE left stopped"; exit 1; }

say "starting $SERVICE"
on_sprite sprite-env services start "$SERVICE" >/dev/null
for _ in $(seq 1 30); do
  if on_sprite curl -fsS --max-time 3 http://127.0.0.1:4400/health >/dev/null 2>&1; then
    say "done: $SPRITE serves the restored drive; the one before is at $ASIDE"
    exit 0
  fi
done
echo "drive-restore: $SERVICE did not answer /health; see /.sprite/logs/services/$SERVICE.log on $SPRITE"
exit 1
