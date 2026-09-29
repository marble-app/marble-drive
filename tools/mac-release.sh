#!/usr/bin/env bash
# Build a release of marble-drive on this Mac and switch the owner's drive to
# it: the Mac's counterpart of tools/sprite/release.sh (docs/HOSTING.md, "The
# owner's drive on the Mac"). The same sources a sprite runs: marble-drive at
# --ref (default origin/main), @bdhmin/marble at ../marble's version from npm,
# Claude Code at tools/sprite/claude-version.
#
#   tools/mac-release.sh [--ref <commit>]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MARBLE_DIR="${MARBLE_DIR:-$REPO/../marble}"
APP="$HOME/Library/Application Support/Marble Drive/app"
REF=origin/main
[[ "${1:-}" == --ref ]] && REF=$2
say() { printf '==> %s\n' "$*"; }
die() { printf 'mac-release: %s\n' "$*" >&2; exit 1; }

git -C "$REPO" fetch -q origin
SHA="$(git -C "$REPO" rev-parse "$REF")"
MARBLE_VERSION="$(node -p "require('$MARBLE_DIR/package.json').version")"
CLAUDE_VERSION="$(tr -d '[:space:]' <"$HERE/sprite/claude-version")"
NAME="$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:7}"
DIR="$APP/releases/$NAME/marble-drive"
mkdir -p "$DIR"
trap 'rm -rf "$APP/releases/$NAME"' EXIT

say "marble-drive $SHA, marble $MARBLE_VERSION, claude $CLAUDE_VERSION"
git -C "$REPO" archive "$SHA" | tar -x -C "$DIR"
cd "$DIR"
npm pkg delete dependencies.@bdhmin/marble
npm install --omit=dev --no-audit --no-fund --loglevel=error "@bdhmin/marble@$MARBLE_VERSION" "@anthropic-ai/claude-code@$CLAUDE_VERSION"
# npm may block install scripts; Claude Code's own installer swaps in the binary.
node node_modules/@anthropic-ai/claude-code/install.cjs >/dev/null
[[ "$(node_modules/.bin/claude --version 2>/dev/null)" == "$CLAUDE_VERSION"* ]] || die "claude $CLAUDE_VERSION did not install"
npx --no-install playwright install chromium >/dev/null

say "smoke test on :4498 with a throwaway drive"
scratch="$(mktemp -d)"
MARBLE_DRIVE_ROOT="$scratch" PORT=4498 HOST=127.0.0.1 MARBLE_DRIVE_AGENTS=0 node bin/marble-drive.js serve >"$scratch.log" 2>&1 &
pid=$!
ok=0
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:4498/health >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
[[ $ok == 1 ]] || { tail -30 "$scratch.log" >&2; rm -rf "$scratch" "$scratch.log"; die "release $NAME did not answer /health"; }
rm -rf "$scratch" "$scratch.log"
trap - EXIT

ln -sfn "$APP/releases/$NAME" "$APP/current"
echo "$NAME" >>"$APP/history"
keep="$( (tail -3 "$APP/history"; echo "$NAME") | sort -u)"
for old in $(ls -1 "$APP/releases"); do grep -qx "$old" <<<"$keep" || rm -rf "${APP:?}/releases/$old"; done
say "current: $NAME"
for plist in "$HOME"/Library/LaunchAgents/com.marble.drive.home.*.plist; do
  [[ -e "$plist" ]] || continue
  name="${plist##*/com.marble.drive.home.}"; name="${name%.plist}"
  /bin/zsh "$REPO/macos/launchd/home.sh" restart "$name"
done
