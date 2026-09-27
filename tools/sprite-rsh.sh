#!/usr/bin/env bash
# rsync's remote shell for a sprite: `rsync -e tools/sprite-rsh.sh <sprite>:/drive/ …`.
# rsync runs `<this> <sprite> rsync --server …`; `sprite exec` wants a `--`
# between its flags and the command. The org is SPRITE_ORG (default marble-drive).
set -euo pipefail
SPRITE=$1; shift
exec sprite exec -o "${SPRITE_ORG:-marble-drive}" -s "$SPRITE" -- "$@"
