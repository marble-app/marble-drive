#!/usr/bin/env bash
# The sprite's half of a deploy (tools/sprite-deploy.sh is the Mac's half).
#
#   release.sh stage <name> <source> <marble> <claude>   build a release beside the others
#   release.sh switch <name>                    make it current and (re)start the service
#   release.sh rollback                         go back to the release before current
#
# <source> is git:<sha> (fetched from the public marble-drive repo) or
# tar:<path> (a pack of the owner's working copy, for --local).
# <marble> is what npm installs for @bdhmin/marble: a published spec such as
# @bdhmin/marble@0.2.1, or the path of an `npm pack` tarball.
# <claude> is the Claude Code version the release carries: the host passes
# flags a given CLI must know, so the CLI is pinned with the release rather than
# left to whatever the sprite's image ships.
#
# A release that fails to install or to answer /health is removed and never
# becomes current; a switch whose service does not come up goes back to the
# release before it.
set -euo pipefail

APP="$HOME/app"
RELEASES="$APP/releases"
CURRENT="$APP/current"
HISTORY="$APP/history"
SERVICE=marble-drive
PORT=4400
HOST="${MARBLE_SPRITE_HOST:-127.0.0.1}"
DRIVE="${MARBLE_SPRITE_DRIVE:-/drive}"
# This sprite's own settings and saved keys: outside every release, so a
# deploy keeps them (a tester's passphrase, which agent pays, their API key).
CONFIG="$HOME/.config/marble-drive"
SPRITE_ENV="$CONFIG/sprite.env"
REPO_TARBALL=https://codeload.github.com/marble-app/marble-drive/tar.gz
NODE="$(command -v node)"
# The release's own node_modules/.bin first, so its pinned `claude` is the one
# the host finds; through the `current` link, so a switch needs no new service.
SERVICE_PATH="$CURRENT/marble-drive/node_modules/.bin:$HOME/.local/bin:$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin"

say() { printf '==> %s\n' "$*"; }
die() { printf 'release: %s\n' "$*" >&2; exit 1; }

health() { # health <port> <seconds>
  local port=$1 wait=$2
  for _ in $(seq 1 "$wait"); do
    curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

stage() {
  local name=$1 source=$2 marble=$3 claude=$4
  local dir="$RELEASES/$name"
  [[ -e "$dir" ]] && die "release $name already exists"
  mkdir -p "$dir/marble-drive"
  # Any way out of a failed stage — a failed command or a `die` — takes the
  # half-built release with it, so a folder under releases/ always worked.
  trap 'rm -rf "$dir"' EXIT

  say "fetching marble-drive ($source)"
  case "$source" in
    git:*) curl -fsSL "$REPO_TARBALL/${source#git:}" | tar xz --strip-components 1 -C "$dir/marble-drive" ;;
    tar:*) tar xzf "${source#tar:}" -C "$dir/marble-drive" ;;
    *) die "unknown source $source" ;;
  esac

  say "installing (marble: $marble, claude: $claude)"
  cd "$dir/marble-drive"
  npm pkg delete dependencies.@bdhmin/marble
  npm install --omit=dev --no-audit --no-fund --loglevel=error "$marble" "@anthropic-ai/claude-code@$claude"
  # npm on the sprite blocks install scripts it has not been told to allow, and
  # Claude Code's is the one that puts its native binary in place. Run that one
  # script, for that one package, and nothing else.
  node node_modules/@anthropic-ai/claude-code/install.cjs >/dev/null
  [[ "$(node_modules/.bin/claude --version 2>/dev/null)" == "$claude"* ]] || die "claude $claude did not install"

  # The agents' browser. Shared across releases, installed once.
  if [[ ! -e "$APP/.chromium-ready" ]]; then
    say "installing Chromium for the agents' browser (once)"
    sudo -E env "PATH=$PATH" npx --yes playwright install-deps chromium >/dev/null
    npx --yes playwright install chromium >/dev/null
    touch "$APP/.chromium-ready"
  fi

  say "smoke test on :4499 with a throwaway drive"
  local scratch
  scratch="$(mktemp -d)"
  MARBLE_DRIVE_ROOT="$scratch" PORT=4499 HOST=127.0.0.1 MARBLE_DRIVE_AGENTS=0 \
    "$NODE" bin/marble-drive.js serve >"$scratch.log" 2>&1 &
  local pid=$!
  if ! health 4499 30; then
    kill "$pid" 2>/dev/null || true
    tail -30 "$scratch.log" >&2
    rm -rf "$scratch" "$scratch.log"
    die "release $name did not answer /health"
  fi
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -rf "$scratch" "$scratch.log"
  trap - EXIT
  say "staged $name"
}

# The service's environment: the defaults, then this sprite's sprite.env
# (KEY=value lines, # comments). `sprite-env --env` is a comma-separated list,
# so a value with a comma in it would be split silently; it is refused.
service_env() {
  local env="MARBLE_DRIVE_ROOT=$DRIVE,PORT=$PORT,HOST=$HOST,MARBLE_DRIVE_AGENTS=1,NODE_ENV=production,PATH=$SERVICE_PATH"
  env="$env,MARBLE_DRIVE_AGENT_KEYS=$CONFIG/agent-keys"
  if [[ -f "$SPRITE_ENV" ]]; then
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "${line// }" || "$line" == \#* ]] && continue
      [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] || die "sprite.env: not KEY=value: $line"
      [[ "$line" == *,* ]] && die "sprite.env: ${line%%=*} has a comma in its value, which the service's settings cannot hold"
      env="$env,$line"
    done <"$SPRITE_ENV"
  fi
  printf '%s' "$env"
}

service_up() {
  local env=$1
  # Recreated rather than restarted, so the service's settings are always
  # this script's: a restart keeps the env it was created with.
  sprite-env services delete "$SERVICE" >/dev/null 2>&1 || true
  sprite-env services create "$SERVICE" --cmd "$NODE" --args bin/marble-drive.js,serve \
    --dir "$CURRENT/marble-drive" --env "$env" --http-port "$PORT" --no-stream >/dev/null
}

point() { # point <name>: make <name> current
  ln -sfn "$RELEASES/$1" "$CURRENT"
}

switch() {
  local name=$1
  [[ -d "$RELEASES/$name" ]] || die "no release $name"
  mkdir -p "$CONFIG" && chmod 700 "$CONFIG"
  # Read before anything moves: a bad sprite.env stops the switch cold.
  local env
  env="$(service_env)" || exit 1
  if [[ ! -d "$DRIVE" ]]; then
    say "creating $DRIVE"
    sudo mkdir -p "$DRIVE"
    sudo chown "$(id -un):$(id -gn)" "$DRIVE"
  fi
  local previous=""
  [[ -L "$CURRENT" ]] && previous="$(basename "$(readlink "$CURRENT")")"
  say "switching to $name${previous:+ (from $previous)}"
  point "$name"
  service_up "$env"
  if ! health "$PORT" 45; then
    tail -40 "/.sprite/logs/services/$SERVICE.log" >&2 || true
    if [[ -n "$previous" ]]; then
      say "service did not come up; going back to $previous"
      point "$previous"
      service_up "$env"
      health "$PORT" 45 || true
    fi
    die "release $name did not come up"
  fi
  [[ "$(tail -1 "$HISTORY" 2>/dev/null)" == "$name" ]] || echo "$name" >>"$HISTORY"
  # Keep the last three releases that went live (the history), and whatever
  # is current; anything else under releases/ is removed.
  local keep
  keep="$( (tail -3 "$HISTORY"; basename "$(readlink "$CURRENT")") | sort -u)"
  for old in $(ls -1 "$RELEASES"); do
    grep -qx "$old" <<<"$keep" && continue
    rm -rf "${RELEASES:?}/$old"
  done
  say "live: $name"
}

rollback() {
  [[ -L "$CURRENT" ]] || die "nothing is current"
  local now previous
  now="$(basename "$(readlink "$CURRENT")")"
  previous="$(grep -vx "$now" "$HISTORY" 2>/dev/null | tail -1 || true)"
  [[ -n "$previous" && -d "$RELEASES/$previous" ]] || die "no earlier release to go back to"
  # Rolling back drops the release being left from the history.
  grep -vx "$now" "$HISTORY" >"$HISTORY.next" || true
  mv "$HISTORY.next" "$HISTORY"
  switch "$previous"
}

mkdir -p "$RELEASES"
case "${1:-}" in
  stage) stage "$2" "$3" "$4" "$5" ;;
  switch) switch "$2" ;;
  rollback) rollback ;;
  *) die "usage: release.sh stage <name> <source> <marble> <claude> | switch <name> | rollback" ;;
esac
