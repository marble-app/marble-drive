#!/usr/bin/env bash
# The owner's drive on this PC (Linux under WSL2), under systemd --user
# (docs/HOSTING.md, "A drive at home on the Mac or the PC"). The PC's
# counterpart of macos/launchd/home.sh; names match server/hub/home-paths.js.
#
#   linux/systemd/home.sh install [<name>]   render and start (name: bryan, or t-bryan for a trial)
#   linux/systemd/home.sh start|stop|restart [<name>]
#   linux/systemd/home.sh status|logs|uninstall [<name>]
#
# It runs whatever tools/home-release.sh made current. Whether it serves the
# drive or stands by is the lease's call (tools/home-mode.mjs), not this
# script's. The service runs with no one signed in only with lingering on
# (sudo loginctl enable-linger "$USER"), and only while WSL itself runs
# (windows/wsl-home.ps1 keeps it up).

set -u

name="${2:-bryan}"
[[ $name =~ ^[a-z0-9-]+$ ]] || { echo "home: a drive name is lowercase letters, digits and dashes" >&2; exit 2; }
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app="$HOME/.local/share/marble-drive/app"
state="$HOME/.local/state/marble-drive"
unit="marble-drive-home-$name.service"
unit_file="$HOME/.config/systemd/user/$unit"
template="$repo/linux/systemd/marble-drive-home.service.in"
if [[ $name == bryan ]]; then root="$HOME/Marble Drive"; port=4401; else root="$HOME/Marble Drive ($name)"; port=4402; fi
hub_env="$HOME/.config/marble-drive/hub-$name.env"
log="$state/home-$name.log"

health() { curl -fsS --max-time 3 "http://127.0.0.1:$port/health" 2>/dev/null; }
sc() { systemctl --user "$@"; }
need_systemd() {
  sc show-environment >/dev/null 2>&1 && return 0
  echo "home: systemd is not running for this user. In WSL: put these lines in /etc/wsl.conf, then run 'wsl --shutdown' in Windows and open Ubuntu again:" >&2
  printf '  [boot]\n  systemd=true\n' >&2
  return 1
}
warn_linger() {
  [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == yes ]] && return 0
  echo "home: note: lingering is off, so the drive stops when the last Ubuntu window closes. Turn it on: sudo loginctl enable-linger $USER" >&2
}

render() {
  [[ -L "$app/current" ]] || { echo "home: no release yet: run tools/home-release.sh" >&2; return 1; }
  local node_dir
  command -v node >/dev/null || { echo "home: node is not on PATH" >&2; return 1; }
  node_dir="$(dirname "$(command -v node)")"
  mkdir -p "$(dirname "$unit_file")" "$state" "$root"
  sed -e "s#@NAME@#$name#g" -e "s#@APP@#$app#g" -e "s#@HOME@#$HOME#g" -e "s#@STATE@#$state#g" \
      -e "s#@ROOT@#$root#g" -e "s#@PORT@#$port#g" -e "s#@HUB_ENV@#$hub_env#g" \
      -e "s#@NODE_DIR@#$node_dir#g" -e "s#@SRC@#$(dirname "$repo")#g" "$template" > "$unit_file"
  sc daemon-reload
}
wait_health() {
  local i
  for i in $(seq 1 60); do
    [[ -n "$(health)" ]] && { echo "$name on http://127.0.0.1:$port: $(health)"; return 0; }
    sleep 0.5
  done
  echo "home: started, but /health did not answer; see $log" >&2; return 1
}

case "${1:-status}" in
  install|start) need_systemd && render && sc enable --quiet "$unit" && sc restart "$unit" && wait_health && warn_linger ;;
  # A restart waits for the old host to stop (TERM, up to 25 s), then starts
  # the new: a new release is picked up through the current link.
  restart)
    need_systemd || exit 1
    if [[ -f $unit_file ]]; then sc restart "$unit" && wait_health; else render && sc enable --quiet "$unit" && sc restart "$unit" && wait_health; fi ;;
  stop) need_systemd && sc stop "$unit" && echo "$name stopped (start: linux/systemd/home.sh start $name)" ;;
  status) echo "$unit $(sc is-active "$unit" 2>/dev/null) pid $(sc show -p MainPID --value "$unit" 2>/dev/null) port $port root $root"; echo "health $(health || echo 'no answer')" ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall) need_systemd && { sc disable --now "$unit" 2>/dev/null; rm -f "$unit_file"; sc daemon-reload; echo "$name uninstalled; the drive at $root is untouched"; } ;;
  *) echo "usage: home.sh <install|start|stop|restart|status|logs|uninstall> [<name>]" >&2; exit 2 ;;
esac
