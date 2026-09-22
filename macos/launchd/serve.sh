#!/bin/zsh
# The drive as a service rather than as a terminal window.
#
# launchd starts this, and starts it again every time it stops, so it has to
# stand on its own: no shell profile, no login environment, no terminal to
# inherit and nothing to be hung up on when an ssh session ends. Everything the
# host needs at runtime is named here.
#
# `claude` is the one that matters. A full agent turn spawns that CLI, and a
# launchd job's PATH is /usr/bin:/bin:/usr/sbin:/sbin — which does not have it,
# so agents would fail in a way that looks nothing like a PATH problem.

set -u
emulate -L zsh

# This file is macos/launchd/serve.sh; the drive is two directories up.
repo="${0:A:h:h:h}"
cd "$repo" || exit 1

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# One log, and this script owns it: launchd opens StandardOutPath once and
# appends for the life of the service, which is the wrong end to rotate from.
# So the rotation happens here, before the redirect, and launchd's own file is
# left for the failures that happen before this script runs at all.
log="$HOME/Library/Logs/marble-drive/serve.log"
mkdir -p "${log:h}"
if [[ -f $log && $(stat -f%z "$log") -gt 20971520 ]]; then
  mv -f "$log" "$log.1"
fi
exec >>"$log" 2>&1

# nvm's node, by whichever version nvm itself calls default, so a `nvm install`
# does not leave the service on a version that is no longer there. --no-use
# keeps the slow part out: nvm sets up, then one explicit use.
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  source "$HOME/.nvm/nvm.sh" --no-use
  nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1
fi

if ! command -v node >/dev/null; then
  print -r -- "[launchd] $(date '+%Y-%m-%d %H:%M:%S') no node on PATH — not starting"
  exit 127
fi

print -r -- ""
print -r -- "[launchd] $(date '+%Y-%m-%d %H:%M:%S') starting — node $(node -v) — $repo"

# exec, so the host is this process: launchd watches it directly, and its
# SIGTERM on stop reaches the handler that closes the drive cleanly.
mkdir -p scratchpad/heapsnapshots
exec node --diagnostic-dir=scratchpad/heapsnapshots --heapsnapshot-near-heap-limit=1 --env-file-if-exists=.env --env-file-if-exists=.env.local bin/marble-drive.js serve
