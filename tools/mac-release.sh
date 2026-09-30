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
# Without MARBLE_HUB_ENV: a throwaway drive must never take part in the hub.
env -u MARBLE_HUB_ENV MARBLE_DRIVE_ROOT="$scratch" PORT=4498 HOST=127.0.0.1 MARBLE_DRIVE_AGENTS=0 node bin/marble-drive.js serve >"$scratch.log" 2>&1 &
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
# Every drive gets its turn: one that does not come back is reported at the
# end rather than leaving the rest on the old release.
failed=()
for plist in "$HOME"/Library/LaunchAgents/com.marble.drive.home.*.plist; do
  [[ -e "$plist" ]] || continue
  name="${plist##*/com.marble.drive.home.}"; name="${name%.plist}"
  # A restart ends any agent turn the host is running, so wait until none is
  # (up to MARBLE_RELEASE_IDLE_WAIT seconds, default 600), as a sprite's
  # hand-off does. A host still busy then keeps the release it has.
  port=$([[ $name == bryan ]] && echo 4401 || echo 4402)
  waited=0
  while :; do
    working="$(curl -fsS --max-time 5 "http://127.0.0.1:$port/health" 2>/dev/null | sed -n 's/.*"working":\([0-9]*\).*/\1/p')"
    [[ -z "$working" || "$working" == 0 ]] && break
    (( waited >= ${MARBLE_RELEASE_IDLE_WAIT:-600} )) && break
    (( waited == 0 )) && say "$name: waiting for $working running agent turn(s) to finish before restarting"
    sleep 10; waited=$((waited + 10))
  done
  if [[ -n "$working" && "$working" != 0 ]]; then
    say "$name: an agent was still working after ${waited}s; not restarted (it runs the old release until: macos/launchd/home.sh restart $name)"
    failed+=("$name")
    continue
  fi
  /bin/zsh "$REPO/macos/launchd/home.sh" restart "$name" || failed+=("$name")
done
if (( ${#failed[@]} > 0 )); then
  die "current is $NAME, but these did not restart: ${failed[*]} (macos/launchd/home.sh status <name>)"
fi
