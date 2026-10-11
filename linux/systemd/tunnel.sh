#!/usr/bin/env bash
# A drive's Cloudflare tunnel on this PC (Linux under WSL2), under systemd
# --user (docs/HOSTING.md, "The front door (marbledrive.app)"). The PC's
# counterpart of macos/launchd/tunnel.sh: the front door Worker reaches a drive
# at home on the PC through it; the tunnel's own name (pc-<name>.marbledrive.app)
# is not routed through the Worker.
#
#   linux/systemd/tunnel.sh setup <name> <hostname>   once: create the tunnel, write its config, route DNS
#   linux/systemd/tunnel.sh check <name>        would install/start/restart be allowed (below)?
#   linux/systemd/tunnel.sh install|start|restart <name>
#   linux/systemd/tunnel.sh stop|status|logs|uninstall <name>
#
# setup needs `cloudflared tunnel login` done first. install, start and restart
# refuse unless the drive's settings file sets a passphrase and the drive
# answering on its port asks for it: a tunnel must never put an ungated drive
# on the internet. Written for bash 3.2 as well, so its tests run on the Mac.

set -u

verb="${1:-status}"
name="${2:-bryan}"
[[ $name =~ ^[a-z0-9-]+$ ]] || { echo "tunnel: a drive name is lowercase letters, digits and dashes" >&2; exit 2; }
tunnel="marble-$name-pc"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
unit="marble-drive-tunnel-$name.service"
unit_file="$HOME/.config/systemd/user/$unit"
template="$repo/linux/systemd/marble-drive-tunnel.service.in"
cf_dir="$HOME/.cloudflared"
config="$cf_dir/marble-$name.yml"
settings="$HOME/.config/marble-drive/pc-$name.env"
state="$HOME/.local/state/marble-drive"
log="$state/tunnel-$name.log"
if [[ $name == bryan ]]; then port=4401; else port=4402; fi # as home.sh
port="${MARBLE_TUNNEL_PORT:-$port}" # only for a test, or a host moved off its port

sc() { systemctl --user "$@"; }
need_cloudflared() {
  command -v cloudflared >/dev/null || { echo "tunnel: cloudflared is not installed (tools/pc-setup.sh installs it)" >&2; return 1; }
}

# The drive's gate is on only when its settings file sets a passphrase (the
# home service reads that file with node's --env-file; linux/systemd/home.sh).
# So node reads it here too, and the two can never disagree. Never print it.
gated() {
  command -v node >/dev/null || { echo "tunnel: node is not on PATH; cannot read $settings" >&2; return 1; }
  local rc
  env -u MARBLE_DRIVE_SECRET node --env-file-if-exists="$settings" -e 'process.exit(process.env.MARBLE_DRIVE_SECRET?.trim() ? 0 : 1)' >/dev/null 2>&1
  rc=$?
  (( rc == 0 )) && return 0
  if (( rc != 1 )); then
    # Not an answer: node itself failed. Its output is not shown (it read the file).
    if ! node --env-file-if-exists=/dev/null -e 0 >/dev/null 2>&1; then
      echo "tunnel: refusing: node ($(command -v node)) is too old to read the settings file (needs --env-file-if-exists, node 22.9 or later)." >&2
    else
      echo "tunnel: refusing: node could not read $settings (exit $rc)." >&2
    fi
    return 1
  fi
  echo "tunnel: refusing: $settings sets no non-empty MARBLE_DRIVE_SECRET (as node reads it)." >&2
  echo "tunnel: without a passphrase the drive is ungated, and this tunnel would put it on the internet for anyone." >&2
  echo "tunnel: set the passphrase there (the same one the drive uses on Fly), restart the home service, then try again." >&2
  return 1
}

# The port the tunnel really forwards to: the first `service:` in its config,
# which must be http on loopback. (The computed $port is only what setup writes.)
config_port() {
  local svc
  svc=$(awk '/^[[:space:]]*-?[[:space:]]*service:/ { sub(/^[^:]*:[[:space:]]*/, ""); if ($0 !~ /^http_status:/) { print $1; exit } }' "$config" 2>/dev/null)
  if [[ $svc =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)/?$ ]]; then
    echo "${BASH_REMATCH[2]}"
    return 0
  fi
  echo "tunnel: refusing: $config forwards to ${svc:-nothing}, not to http on 127.0.0.1:<port>, so the drive behind it cannot be checked." >&2
  return 1
}

# And the host running now must be the gated one: a passphrase added to the
# file does nothing until the home service restarts. A page asked for without
# a cookie must be sent to /gate (or refused, 401). A standby host (a 503, and
# /health says standby) holds no drive to show; it reads the file when it
# starts serving.
served_gated() {
  local port
  port=$(config_port) || return 1
  local url="http://127.0.0.1:$port" answer code where
  answer=$(curl -s -o /dev/null --max-time 5 -H 'Accept: text/html' -w '%{http_code} %{redirect_url}' "$url/")
  code="${answer%% *}"; where="${answer#* }"
  [[ $code == 401 ]] && return 0
  [[ $code == 302 && $where == "$url/gate"* ]] && return 0
  [[ $code == 503 ]] && curl -s --max-time 5 "$url/health" | grep -q '"standby":true' && return 0
  if [[ $code == 000 ]]; then
    echo "tunnel: refusing: nothing answers on :$port. Start the drive first (linux/systemd/home.sh install $name)." >&2
  else
    echo "tunnel: refusing: the drive on :$port answers without its passphrase ($code for /). Restart it (linux/systemd/home.sh restart $name) after setting MARBLE_DRIVE_SECRET." >&2
  fi
  return 1
}

hostname_of() { awk '/^[[:space:]]*-[[:space:]]*hostname:/{print $NF; exit}' "$config" 2>/dev/null; }
tunnel_id() {
  cloudflared tunnel list --output json --name "$tunnel" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s);if(t[0])console.log(t[0].id)}catch{}})'
}

setup() {
  local host="${1:-}"
  [[ -n $host ]] || { echo "usage: tunnel.sh setup <name> <hostname>   (e.g. setup bryan pc-bryan.marbledrive.app)" >&2; return 2; }
  # A name the front door Worker routes must keep its DNS: pointing it at this
  # tunnel would skip the Worker (and every drive behind that name).
  local routed
  routed="$(sed -n 's#.*pattern *= *"\([^"/]*\)/\*".*#\1#p' "$repo/worker/wrangler.toml" 2>/dev/null)"
  [[ -n $routed ]] || { echo "tunnel: cannot read the Worker's routes in $repo/worker/wrangler.toml" >&2; return 1; }
  if grep -qxF -- "$host" <<<"$routed"; then
    echo "tunnel: refusing: $host is routed through the front door Worker (worker/wrangler.toml); use pc-$name.marbledrive.app" >&2
    return 2
  fi
  [[ $host =~ ^[a-z0-9-]+\.marbledrive\.app$ ]] || { echo "tunnel: the tunnel's name must be one label under marbledrive.app (e.g. pc-$name.marbledrive.app)" >&2; return 2; }
  need_cloudflared || return 1
  [[ -f $cf_dir/cert.pem ]] || {
    echo "tunnel: cloudflared is not signed in to the Cloudflare account. Run this, pick the marbledrive.app zone, then run setup again:" >&2
    echo "  cloudflared tunnel login" >&2
    return 1
  }
  local id
  id=$(tunnel_id)
  if [[ -z $id ]]; then
    cloudflared tunnel create "$tunnel" || { echo "tunnel: could not create $tunnel" >&2; return 1; }
    id=$(tunnel_id)
    [[ -n $id ]] || { echo "tunnel: created $tunnel but cannot find its id" >&2; return 1; }
  fi
  local creds="$cf_dir/$id.json"
  [[ -f $creds ]] || {
    echo "tunnel: $tunnel exists but its credentials are not on this PC ($creds). Fetch them with:" >&2
    echo "  cloudflared tunnel token --cred-file '$creds' $tunnel" >&2
    return 1
  }
  mkdir -p "$cf_dir"
  cat > "$config" <<YML
# Written by linux/systemd/tunnel.sh setup $name $host
tunnel: $id
credentials-file: $creds
ingress:
  - hostname: $host
    service: http://127.0.0.1:$port
  - service: http_status:404
YML
  cloudflared tunnel --config "$config" ingress validate >/dev/null || { echo "tunnel: cloudflared does not accept $config" >&2; return 1; }
  cloudflared tunnel route dns "$tunnel" "$host" || { echo "tunnel: could not point $host at $tunnel" >&2; return 1; }
  echo "$tunnel ($id): $host -> http://127.0.0.1:$port; config $config"
  echo "next: linux/systemd/tunnel.sh install $name"
}

ready() {
  gated || return 1
  [[ -f $config ]] || { echo "tunnel: no $config yet: run linux/systemd/tunnel.sh setup $name <hostname>" >&2; return 1; }
  served_gated
}
render() {
  mkdir -p "$(dirname "$unit_file")" "$state"
  sed -e "s#@NAME@#$name#g" -e "s#@HOME@#$HOME#g" -e "s#@STATE@#$state#g" \
      -e "s#@CONFIG@#$config#g" -e "s#@CLOUDFLARED@#$(command -v cloudflared)#g" "$template" > "$unit_file"
  sc daemon-reload
}
wait_running() {
  local i
  for i in $(seq 1 40); do
    [[ "$(sc is-active "$unit" 2>/dev/null)" == active ]] && { echo "$tunnel running (pid $(sc show -p MainPID --value "$unit")) for $(hostname_of); log $log"; return 0; }
    sleep 0.25
  done
  echo "tunnel: started, but cloudflared is not running; see $log" >&2; return 1
}

case "$verb" in
  setup) setup "${3:-}" ;;
  check) ready && echo "$tunnel may run: $settings sets a passphrase and the drive behind the tunnel asks for it" ;;
  install|start) ready && need_cloudflared && render && sc enable --quiet "$unit" && sc restart "$unit" && wait_running ;;
  restart) ready && need_cloudflared && { [[ -f $unit_file ]] || render; } && sc restart "$unit" && wait_running ;;
  stop) sc stop "$unit" && echo "$tunnel stopped (start: linux/systemd/tunnel.sh start $name)" ;;
  status) echo "$unit $(sc is-active "$unit" 2>/dev/null) host $(hostname_of || true) -> 127.0.0.1:$port" ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall) sc disable --now "$unit" 2>/dev/null; rm -f "$unit_file"; sc daemon-reload; echo "$tunnel uninstalled; the tunnel and its DNS record stay at Cloudflare (cloudflared tunnel delete $tunnel removes it)" ;;
  *) echo "usage: tunnel.sh <setup|check|install|start|stop|restart|status|logs|uninstall> <name> [<hostname>]" >&2; exit 2 ;;
esac
