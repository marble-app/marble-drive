#!/usr/bin/env bash
# Deploy Marble Drive to a Fly Sprite (docs/DEPLOY.md, "On a Fly Sprite").
#
#   tools/sprite-deploy.sh <sprite> [--org <org>] [--ref <commit>] [--marble <version>] [--claude <version>]
#   tools/sprite-deploy.sh <sprite> [--org <org>] --local
#   tools/sprite-deploy.sh <sprite> [--org <org>] --rollback
#   tools/sprite-deploy.sh --all [--org <org>] [--list] [--ref ...]   every user's sprite
#
# By default a sprite runs public sources: marble-drive at <ref> (default
# origin/main) from GitHub, and @bdhmin/marble@<version> (default: the local
# ../marble's version) from npm, with Claude Code pinned at --claude (default:
# the version on this Mac). Nothing secret is copied to the sprite.
# --local deploys this Mac's working copies instead (marble-drive's tracked and
# untracked-but-not-ignored files, and `npm pack` of ../marble), for trying
# unreleased changes on a test sprite.
#
# Every deploy checkpoints the sprite first and prints how to restore it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MARBLE_DIR="${MARBLE_DIR:-$(cd "$REPO/.." && pwd)/marble}"
[[ -d "$MARBLE_DIR" ]] || MARBLE_DIR="$(cd "$(git -C "$REPO" rev-parse --git-common-dir)/../.." && pwd)/marble"

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }

# --all: every sprite that is someone's drive — labelled marble-owner (the
# owner's own) or marble-tester (a tester's, from sprite-provision.sh) — one
# after another, going on past a failure and ending with one line per sprite.
# A sprite with neither label (admin-p1, the owner's test bed) is never
# included. --list only says which sprites that is.
USER_LABELS='marble-owner|marble-tester'
if [[ "${1:-}" == --all ]]; then
  shift
  ALL_ORG=marble-drive
  LIST_ONLY=0
  PASS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --org) ALL_ORG=$2; shift 2 ;;
      --list) LIST_ONLY=1; shift ;;
      *) PASS+=("$1"); shift ;;
    esac
  done
  SPRITES=""
  for one in $(sprite list -o "$ALL_ORG" 2>/dev/null); do
    sprite info -o "$ALL_ORG" -s "$one" 2>/dev/null | grep -E '^Labels:' | grep -qwE "$USER_LABELS" && SPRITES="$SPRITES $one"
  done
  [[ -n "$SPRITES" ]] || { echo "sprite-deploy: no user sprites (labelled marble-owner or marble-tester) in $ALL_ORG"; exit 0; }
  if [[ $LIST_ONLY == 1 ]]; then printf '%s\n' $SPRITES; exit 0; fi
  RESULTS=()
  for one in $SPRITES; do
    printf '\n==> ==== %s ====\n' "$one"
    if "$0" "$one" --org "$ALL_ORG" ${PASS[@]+"${PASS[@]}"}; then RESULTS+=("  deployed  $one")
    else RESULTS+=("  FAILED    $one"); fi
  done
  printf '\n==> summary\n'
  printf '%s\n' "${RESULTS[@]}"
  printf '%s\n' "${RESULTS[@]}" | grep -q FAILED && exit 1
  exit 0
fi

[[ $# -ge 1 && "$1" != -* ]] || usage
SPRITE=$1; shift
ORG=marble-drive REF=origin/main MARBLE_VERSION="" CLAUDE_VERSION="" LOCAL=0 ROLLBACK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG=$2; shift 2 ;;
    --ref) REF=$2; shift 2 ;;
    --marble) MARBLE_VERSION=$2; shift 2 ;;
    --claude) CLAUDE_VERSION=$2; shift 2 ;;
    --local) LOCAL=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    *) usage ;;
  esac
done

on() { sprite exec -o "$ORG" -s "$SPRITE" --no-stdin "$@"; }
REMOTE=/home/sprite/app
say() { printf '==> %s\n' "$*"; }

say "sending the release script to $SPRITE ($ORG)"
on -- mkdir -p "$REMOTE/incoming"
on --file "$HERE/sprite/release.sh:$REMOTE/release.sh" -- chmod +x "$REMOTE/release.sh"

if [[ $ROLLBACK == 1 ]]; then
  on -- "$REMOTE/release.sh" rollback
  exit 0
fi

[[ -n "$CLAUDE_VERSION" ]] || CLAUDE_VERSION="$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[[ -n "$CLAUDE_VERSION" ]] || { echo "sprite-deploy: no claude on this Mac to take a version from — pass --claude <version>" >&2; exit 1; }
npm view "@anthropic-ai/claude-code@$CLAUDE_VERSION" version >/dev/null 2>&1 \
  || { echo "sprite-deploy: @anthropic-ai/claude-code@$CLAUDE_VERSION is not on npm" >&2; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILES=()
if [[ $LOCAL == 1 ]]; then
  SHA="$(git -C "$REPO" rev-parse --short HEAD)"
  NAME="$STAMP-local-$SHA"
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  say "packing this Mac's marble-drive (working copy at $SHA)"
  # No macOS metadata in the pack: Linux tar would warn about every file.
  (cd "$REPO" && git ls-files -co --exclude-standard -z | COPYFILE_DISABLE=1 tar --no-mac-metadata --null -T - -czf "$WORK/marble-drive.tgz")
  say "packing $MARBLE_DIR"
  MARBLE_TGZ="$(cd "$MARBLE_DIR" && npm pack --silent --pack-destination "$WORK" | tail -1)"
  FILES+=(--file "$WORK/marble-drive.tgz:$REMOTE/incoming/$NAME.tgz" --file "$WORK/$MARBLE_TGZ:$REMOTE/incoming/$NAME-marble.tgz")
  SOURCE="tar:$REMOTE/incoming/$NAME.tgz"
  MARBLE="$REMOTE/incoming/$NAME-marble.tgz"
else
  git -C "$REPO" fetch --quiet origin
  SHA="$(git -C "$REPO" rev-parse --verify "$REF^{commit}")"
  git -C "$REPO" branch -r --contains "$SHA" | grep -q . || { echo "sprite-deploy: $SHA is not on the remote — push it first, or deploy --local" >&2; exit 1; }
  [[ -n "$MARBLE_VERSION" ]] || MARBLE_VERSION="$(node -p "require('$MARBLE_DIR/package.json').version")"
  npm view "@bdhmin/marble@$MARBLE_VERSION" version >/dev/null 2>&1 \
    || { echo "sprite-deploy: @bdhmin/marble@$MARBLE_VERSION is not on npm — publish marble first, or deploy --local" >&2; exit 1; }
  NAME="$STAMP-${SHA:0:7}"
  SOURCE="git:$SHA"
  MARBLE="@bdhmin/marble@$MARBLE_VERSION"
fi

say "checkpointing $SPRITE"
sprite checkpoint create -o "$ORG" -s "$SPRITE" --comment "before deploy $NAME"
echo "   to undo everything since: sprite checkpoint list -o $ORG -s $SPRITE, then sprite restore <id> -o $ORG -s $SPRITE"

say "staging $NAME"
on ${FILES[@]+"${FILES[@]}"} -- "$REMOTE/release.sh" stage "$NAME" "$SOURCE" "$MARBLE" "$CLAUDE_VERSION"
say "switching"
on -- "$REMOTE/release.sh" switch "$NAME"
on -- sh -c "rm -f $REMOTE/incoming/$NAME*"
say "done: $NAME is live on $SPRITE"
