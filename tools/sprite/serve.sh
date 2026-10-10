#!/usr/bin/env bash
# The host, kept up: what the Sprites service `marble-drive` runs (release.sh
# service_up), from the release's own folder.
#
# A Sprites service is not restarted when its process dies, and the proxy only
# starts one that is stopped, so a host that crashed stayed down until someone
# noticed (admin-p1, 2026-09-28: V8 ran out of heap and the drive was gone for
# hours). This runs the host, and runs it again when it exits on its own: at
# once the first time, then waiting longer while it keeps failing. A stop
# (TERM, which is how the service is stopped and recreated on every switch)
# passes to the host and ends the loop.
#
# Each exit is a line in ~/app/crash/crashes.log, and a fatal error inside Node
# (out of heap among them) leaves Node's own report beside it.
#
# Memory: Sprites already makes a service the kernel's near-last choice when
# the machine runs out (oom_score_adj -900), and the host inherits that; each
# agent turn raises its own so it goes first (server/agent/first-to-go.js).
#
# With MARBLE_HUB_ENV set it asks tools/home-mode.mjs before every start, so a
# host whose lease moved (it exits 75) comes back as standby. With
# MARBLE_SERVE_COMMAND=provisioner (the door sprite's sprite.env) it keeps the
# provisioner up instead of a drive.
set -uo pipefail

NODE="${MARBLE_SERVE_NODE:-$(command -v node)}"
CRASH_DIR="${MARBLE_SERVE_CRASH_DIR:-$HOME/app/crash}"
CRASH_LOG="$CRASH_DIR/crashes.log"
# Waits between restarts: 1 s, doubling while the host keeps dying young, to
# at most MAX_WAIT. A host that stayed up HEALTHY_AFTER seconds starts over.
FIRST_WAIT="${MARBLE_SERVE_FIRST_WAIT:-1}"
MAX_WAIT="${MARBLE_SERVE_MAX_WAIT:-60}"
HEALTHY_AFTER="${MARBLE_SERVE_HEALTHY_AFTER:-300}"

mkdir -p "$CRASH_DIR"
note() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$CRASH_LOG" >&2; }

pid=""
stopping=0
stop() {
  stopping=1
  [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null
}
trap stop TERM INT HUP

wait_for=$FIRST_WAIT
while :; do
  started=$SECONDS
  # Two homes (the owner's Mac and Fly): the lease says whether this machine
  # serves the drive or stands by (tools/home-mode.mjs). Every other drive has
  # no MARBLE_HUB_ENV and always serves.
  mode=serve
  # The door sprite runs the provisioner instead of a drive (server/provisioner.js).
  [[ "${MARBLE_SERVE_COMMAND:-}" == provisioner ]] && mode=provisioner
  if [[ $mode == serve && -n "${MARBLE_HUB_ENV:-}" ]]; then
    mode="$("$NODE" tools/home-mode.mjs 2>>"$CRASH_LOG" || echo standby)"
    [[ "$mode" == serve || "$mode" == standby ]] || mode=standby
  fi
  # MARBLE_SERVE_ENV_FILE: extra settings for this host (the Mac's home service,
  # macos/launchd/home.sh), read by node itself so secrets stay out of the plist.
  # node's --env-file never overrides what is already in the environment.
  env_file=()
  [[ -n "${MARBLE_SERVE_ENV_FILE:-}" ]] && env_file=(--env-file-if-exists="$MARBLE_SERVE_ENV_FILE")
  "$NODE" ${env_file[@]+"${env_file[@]}"} --report-on-fatalerror --report-directory="$CRASH_DIR" bin/marble-drive.js "$mode" &
  pid=$!
  # `wait` returns early when a signal lands; wait again until the host is gone.
  status=0
  while kill -0 "$pid" 2>/dev/null; do
    wait "$pid"
    status=$?
  done
  pid=""
  [[ $stopping == 1 ]] && exit 0
  lived=$((SECONDS - started))
  (( lived >= HEALTHY_AFTER )) && wait_for=$FIRST_WAIT
  note "host exited (status $status) after ${lived}s; starting it again in ${wait_for}s"
  sleep "$wait_for" &
  wait $! 2>/dev/null
  [[ $stopping == 1 ]] && exit 0
  wait_for=$((wait_for * 2))
  (( wait_for > MAX_WAIT )) && wait_for=$MAX_WAIT
done
