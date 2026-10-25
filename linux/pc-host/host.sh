#!/usr/bin/env bash
# marble-host on this PC, as the owner's own service under systemd --user
# (docs/HOSTING.md, "marble-host and the sandbox"): the router the tunnel
# reaches, the admin API the Console and tools/pc-host.mjs use, the maker and
# the watcher, and the only thing that starts and stops other people's drives.
#
#   linux/pc-host/host.sh install        render and start it (after node tools/pc-host.mjs init)
#   linux/pc-host/host.sh start|stop|restart
#   linux/pc-host/host.sh status|logs|uninstall
#
# It runs whatever tools/home-release.sh made current, as the owner's drive
# does (linux/systemd/home.sh), and keeps running with no one signed in only
# with lingering on (sudo loginctl enable-linger "$USER"). Stopping it leaves
# the drives running; starting it starts every drive the registry says is
# running. In system mode (HOST_MODE in host.env) the guests' sandbox must be
# installed first: sudo bash linux/pc-host/install.sh.

set -u

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app="$HOME/.local/share/marble-drive/app"
state="$HOME/.local/state/marble-drive"
unit=marble-host.service
unit_file="$HOME/.config/systemd/user/$unit"
template="$repo/linux/pc-host/marble-host.service.in"
settings="$HOME/.config/marble-drive/host.env"
log="$state/host.log"

# A setting that is not a secret, as host.env says it.
setting() { sed -n "s/^$1=//p" "$settings" 2>/dev/null | tail -n 1; }
port="$(setting HOST_ROUTER_PORT)"; port="${port:-4460}"
mode="$(setting HOST_MODE)"; mode="${mode:-system}"

sc() { systemctl --user "$@"; }
need_settings() {
  [[ -f $settings ]] || { echo "host: there is no $settings yet: node tools/pc-host.mjs init" >&2; return 1; }
  [[ "$(stat -c %a "$settings")" == 600 ]] || { echo "host: $settings can be read by others; chmod 600 it first" >&2; return 1; }
  [[ $port =~ ^[0-9]+$ ]] || { echo "host: HOST_ROUTER_PORT in $settings is not a port" >&2; return 1; }
}
need_sandbox() {
  [[ $mode == user ]] && return 0
  [[ -f /etc/systemd/system/marble-guest@.service && -x /opt/marble/bin/run-guest ]] && return 0
  echo "host: the guests' sandbox is not installed: sudo bash $repo/linux/pc-host/install.sh (or HOST_MODE=user in host.env for a trial)" >&2
  return 1
}
need_systemd() {
  sc show-environment >/dev/null 2>&1 && return 0
  echo "host: systemd is not running for this user (see linux/systemd/home.sh)" >&2
  return 1
}
warn_linger() {
  [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == yes ]] && return 0
  echo "host: note: lingering is off, so marble-host stops when the last Ubuntu window closes. Turn it on: sudo loginctl enable-linger $USER" >&2
}
# The router turns away anything without the Worker's key, so a 401 is how
# it says it is up.
answer() { curl -s -o /dev/null --max-time 3 -w '%{http_code}' "http://127.0.0.1:$port/_host/health" 2>/dev/null; }

render() {
  [[ -L "$app/current" ]] || { echo "host: no release yet: run tools/home-release.sh" >&2; return 1; }
  local node node_dir
  node="$(command -v node)" || { echo "host: node is not on PATH" >&2; return 1; }
  node_dir="$(dirname "$node")"
  mkdir -p "$(dirname "$unit_file")" "$state"
  sed -e "s#@APP@#$app#g" -e "s#@HOME@#$HOME#g" -e "s#@STATE@#$state#g" \
      -e "s#@NODE@#$node#g" -e "s#@NODE_DIR@#$node_dir#g" "$template" > "$unit_file"
  sc daemon-reload
}
wait_up() {
  local i
  for i in $(seq 1 60); do
    [[ "$(answer)" == 401 ]] && { echo "marble-host is up: router on 127.0.0.1:$port ($mode mode); node tools/pc-host.mjs status says more"; return 0; }
    sleep 0.5
  done
  echo "host: started, but the router does not answer on :$port; see $log" >&2; return 1
}

case "${1:-status}" in
  install|start) need_settings && need_sandbox && need_systemd && render && sc enable --quiet "$unit" && sc restart "$unit" && wait_up && warn_linger ;;
  restart)
    need_settings && need_sandbox && need_systemd || exit 1
    if [[ -f $unit_file ]]; then sc restart "$unit" && wait_up; else render && sc enable --quiet "$unit" && sc restart "$unit" && wait_up; fi ;;
  stop) need_systemd && sc stop "$unit" && echo "marble-host stopped; the drives it started keep running (start it: linux/pc-host/host.sh start)" ;;
  status)
    echo "$unit $(sc is-active "$unit" 2>/dev/null) pid $(sc show -p MainPID --value "$unit" 2>/dev/null) router 127.0.0.1:$port ($mode mode)"
    code="$(answer)"
    case "$code" in
      401) echo "router up: it turns away a request without the key" ;;
      000|"") echo "router: no answer" ;;
      *) echo "router: answered $code without the key; it should say 401" ;;
    esac ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall)
    need_systemd || exit 1
    sc disable --now "$unit" 2>/dev/null; rm -f "$unit_file"; sc daemon-reload
    echo "marble-host uninstalled. The drives it started keep running until stopped; the registry in ~/.local/state/marble-host is untouched" ;;
  *) echo "usage: host.sh <install|start|stop|restart|status|logs|uninstall>" >&2; exit 2 ;;
esac
