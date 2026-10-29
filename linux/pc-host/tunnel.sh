#!/usr/bin/env bash
# marble-host's Cloudflare tunnel on this PC (docs/HOSTING.md, "marble-host
# and the sandbox"): `marble-pc-host`, from pc-host.marbledrive.app to
# marble-host's router on 127.0.0.1:4460, and to nothing else. The front door
# Worker sends every request for a drive on the PC down it, with the drive's
# name and the key only the Worker and the PC hold; the router answers 401 to
# anything without the key. The owner's own drive keeps its own tunnel
# (linux/systemd/tunnel.sh).
#
#   linux/pc-host/tunnel.sh setup [<hostname>]   once: create the tunnel, write its config, route its DNS
#   linux/pc-host/tunnel.sh install|start        render the user service and start it
#   linux/pc-host/tunnel.sh stop|status|logs|uninstall
#
# Direct mode (HOST_DIRECT=1 in host.env; docs/HOSTING.md, "Direct mode"):
# no Worker in front. The one rule is then *.marbledrive.app, so each drive's
# own name reaches the router once `pc-host.mjs invite` points its DNS here;
# only names pointed here ever arrive, and the router still answers 401 to
# /_host/* without the key and "resting" to any name it doesn't host.
#
# setup needs `cloudflared tunnel login` done first, and makes a DNS record on
# the marbledrive.app zone. install and start refuse unless the tunnel's
# config sends its one hostname to the router alone, and what answers there
# turns away a request without the key: this tunnel must never put a drive
# on the internet without the door in front of it.

set -u

verb="${1:-status}"
tunnel=marble-pc-host
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
unit=marble-host-tunnel.service
unit_file="$HOME/.config/systemd/user/$unit"
template="$repo/linux/pc-host/marble-host-tunnel.service.in"
cf_dir="$HOME/.cloudflared"
config="$cf_dir/$tunnel.yml"
settings="$HOME/.config/marble-drive/host.env"
state="$HOME/.local/state/marble-drive"
log="$state/host-tunnel.log"
port="$(sed -n 's/^HOST_ROUTER_PORT=//p' "$settings" 2>/dev/null | tail -n 1)"
port="${port:-4460}"
direct="$(sed -n 's/^HOST_DIRECT=//p' "$settings" 2>/dev/null | tail -n 1)"
[[ $direct =~ ^(1|true|yes|on)$ ]] && direct=1 || direct=

sc() { systemctl --user "$@"; }
need_cloudflared() {
  command -v cloudflared >/dev/null || { echo "tunnel: cloudflared is not installed (tools/pc-setup.sh installs it)" >&2; return 1; }
}

# The config must send one hostname to http://127.0.0.1:<router port> and
# everything else to a 404: the router, and nothing beside it.
config_ok() {
  [[ -f $config ]] || { echo "tunnel: no $config yet: run linux/pc-host/tunnel.sh setup" >&2; return 1; }
  local services hosts
  services="$(awk '/^[[:space:]]*-?[[:space:]]*service:/ { sub(/^[^:]*:[[:space:]]*/, ""); print $1 }' "$config")"
  hosts="$(awk '/^[[:space:]]*-[[:space:]]*hostname:/ { print $NF }' "$config")"
  if [[ "$(grep -c . <<<"$hosts")" != 1 || "$services" != "http://127.0.0.1:$port"$'\n'"http_status:404" ]]; then
    echo "tunnel: refusing: $config must send one hostname to http://127.0.0.1:$port and the rest to http_status:404; it sends: $(tr '\n' ' ' <<<"$services")" >&2
    return 1
  fi
}

# And what answers there must be the router, turning away a request without
# the key.
router_keyed() {
  local code
  code="$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$port/_host/health")"
  [[ $code == 401 ]] && return 0
  if [[ $code == 000 ]]; then
    echo "tunnel: refusing: nothing answers on 127.0.0.1:$port. Start marble-host first (linux/pc-host/host.sh install)." >&2
  else
    echo "tunnel: refusing: 127.0.0.1:$port answered $code without the key, where marble-host's router says 401." >&2
  fi
  return 1
}

hostname_of() { awk '/^[[:space:]]*-[[:space:]]*hostname:/{gsub(/"/, "", $NF); print $NF; exit}' "$config" 2>/dev/null; }
tunnel_id() {
  cloudflared tunnel list --output json --name "$tunnel" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s);if(t[0])console.log(t[0].id)}catch{}})'
}

setup() {
  local host="${1:-pc-host.marbledrive.app}"
  [[ $host =~ ^[a-z0-9-]+\.marbledrive\.app$ ]] || { echo "tunnel: the tunnel's name must be one label under marbledrive.app (pc-host.marbledrive.app)" >&2; return 2; }
  # A name the front door Worker routes must keep its DNS: pointing it here
  # would skip the Worker, and the door with it.
  local routed
  routed="$(sed -n 's#.*pattern *= *"\([^"/*]*\)/\*".*#\1#p' "$repo/worker/wrangler.toml" 2>/dev/null)"
  [[ -n $routed ]] || { echo "tunnel: cannot read the Worker's routes in $repo/worker/wrangler.toml" >&2; return 1; }
  if grep -qxF -- "$host" <<<"$routed"; then
    echo "tunnel: refusing: $host is routed through the front door Worker (worker/wrangler.toml)" >&2
    return 2
  fi
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
# Written by linux/pc-host/tunnel.sh setup $host${direct:+ (direct mode: every drive's own name)}: marble-host's router, and nothing else
tunnel: $id
credentials-file: $creds
ingress:
  - hostname: $( [[ -n $direct ]] && echo '"*.marbledrive.app"' || echo "$host" )
    service: http://127.0.0.1:$port
  - service: http_status:404
YML
  cloudflared tunnel --config "$config" ingress validate >/dev/null || { echo "tunnel: cloudflared does not accept $config" >&2; return 1; }
  cloudflared tunnel route dns "$tunnel" "$host" || { echo "tunnel: could not point $host at $tunnel" >&2; return 1; }
  echo "$tunnel ($id): $host -> http://127.0.0.1:$port; config $config"
  echo "next: linux/pc-host/tunnel.sh install"
}

render() {
  mkdir -p "$(dirname "$unit_file")" "$state"
  sed -e "s#@HOME@#$HOME#g" -e "s#@STATE@#$state#g" -e "s#@CONFIG@#$config#g" \
      -e "s#@CLOUDFLARED@#$(command -v cloudflared)#g" "$template" > "$unit_file"
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
  setup) setup "${2:-}" ;;
  install|start) config_ok && router_keyed && need_cloudflared && render && sc enable --quiet "$unit" && sc restart "$unit" && wait_running ;;
  stop) sc stop "$unit" && echo "$tunnel stopped (start it: linux/pc-host/tunnel.sh start)" ;;
  status) echo "$unit $(sc is-active "$unit" 2>/dev/null) host $(hostname_of || true) -> 127.0.0.1:$port" ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall) sc disable --now "$unit" 2>/dev/null; rm -f "$unit_file"; sc daemon-reload; echo "$tunnel uninstalled; the tunnel and its DNS record stay at Cloudflare (cloudflared tunnel delete $tunnel removes it)" ;;
  *) echo "usage: tunnel.sh <setup|install|start|stop|status|logs|uninstall> [<hostname>]" >&2; exit 2 ;;
esac
