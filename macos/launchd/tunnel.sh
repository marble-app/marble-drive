#!/bin/zsh
# A drive's Cloudflare tunnel on this Mac, under launchd (docs/HOSTING.md,
# "The front door (marbledrive.app)"). The front door Worker reaches a drive at
# home on the Mac through it; the tunnel's own name (mac-<name>.marbledrive.app)
# is not routed through the Worker.
#
#   macos/launchd/tunnel.sh setup <name> <hostname>   once: create the tunnel, write its config, route DNS
#   macos/launchd/tunnel.sh check <name>        would install/start/restart be allowed (below)?
#   macos/launchd/tunnel.sh install|start|restart <name>
#   macos/launchd/tunnel.sh stop|status|logs|uninstall <name>
#
# setup needs `cloudflared tunnel login` done first. install, start and restart
# refuse unless the drive's settings file sets a passphrase and the drive
# answering on its port asks for it: a tunnel must never put an ungated drive
# on the internet.

set -u
emulate -L zsh
setopt extended_glob

verb="${1:-status}"
name="${2:-bryan}"
[[ $name == [a-z0-9-]## ]] || { print -u2 "tunnel: a drive name is lowercase letters, digits and dashes"; exit 2 }
tunnel="marble-$name-mac"
repo="${0:A:h:h:h}"
label="com.marble.drive.tunnel.$name"
plist="$HOME/Library/LaunchAgents/$label.plist"
template="$repo/macos/launchd/com.marble.drive.tunnel.plist.in"
domain="gui/$(id -u)"
cf_dir="$HOME/.cloudflared"
config="$cf_dir/marble-$name.yml"
settings="$HOME/.config/marble-drive/mac-$name.env"
log="$HOME/Library/Logs/marble-drive/tunnel-$name.log"
if [[ $name == bryan ]]; then port=4401; else port=4402; fi # as home.sh
port="${MARBLE_TUNNEL_PORT:-$port}" # only for a test, or a host moved off its port

loaded() { launchctl print "$domain/$label" >/dev/null 2>&1 }
pid_of() { launchctl print "$domain/$label" 2>/dev/null | awk -F'= ' '/^[[:space:]]*pid = /{print $2; exit}' }
need_cloudflared() {
  command -v cloudflared >/dev/null || { print -u2 "tunnel: cloudflared is not installed (brew install cloudflared)"; return 1 }
}

# The drive's gate is on only when its settings file sets a passphrase (the
# home service reads that file with node's --env-file; macos/launchd/home.sh).
# So node reads it here too, and the two can never disagree. Never print it.
gated() {
  command -v node >/dev/null || { print -u2 "tunnel: node is not on PATH; cannot read $settings"; return 1 }
  local rc
  env -u MARBLE_DRIVE_SECRET node --env-file-if-exists="$settings" -e 'process.exit(process.env.MARBLE_DRIVE_SECRET?.trim() ? 0 : 1)' >/dev/null 2>&1
  rc=$?
  (( rc == 0 )) && return 0
  if (( rc != 1 )); then
    # Not an answer: node itself failed. Its output is not shown (it read the file).
    if ! node --env-file-if-exists=/dev/null -e 0 >/dev/null 2>&1; then
      print -u2 "tunnel: refusing: node ($(command -v node)) is too old to read the settings file (needs --env-file-if-exists, node 22.9 or later)."
    else
      print -u2 "tunnel: refusing: node could not read $settings (exit $rc)."
    fi
    return 1
  fi
  print -u2 "tunnel: refusing: $settings sets no non-empty MARBLE_DRIVE_SECRET (as node reads it)."
  print -u2 "tunnel: without a passphrase the drive is ungated, and this tunnel would put it on the internet for anyone."
  print -u2 "tunnel: set the passphrase there (the same one the drive uses on Fly), restart the home service, then try again."
  return 1
}

# The port the tunnel really forwards to: the first `service:` in its config,
# which must be http on loopback. (The computed $port is only what setup writes.)
config_port() {
  local svc
  svc=$(awk '/^[[:space:]]*-?[[:space:]]*service:/ { sub(/^[^:]*:[[:space:]]*/, ""); if ($0 !~ /^http_status:/) { print $1; exit } }' "$config" 2>/dev/null)
  [[ $svc =~ '^http://(127\.0\.0\.1|localhost):([0-9]+)/?$' ]] && { print -r -- "${match[2]}"; return 0 }
  print -u2 "tunnel: refusing: $config forwards to ${svc:-nothing}, not to http on 127.0.0.1:<port>, so the drive behind it cannot be checked."
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
    print -u2 "tunnel: refusing: nothing answers on :$port. Start the drive first (macos/launchd/home.sh install $name)."
  else
    print -u2 "tunnel: refusing: the drive on :$port answers without its passphrase ($code for /). Restart it (macos/launchd/home.sh restart $name) after setting MARBLE_DRIVE_SECRET."
  fi
  return 1
}

hostname_of() { awk '/^[[:space:]]*-[[:space:]]*hostname:/{print $NF; exit}' "$config" 2>/dev/null }

setup() {
  local host="${1:-}"
  [[ -n $host ]] || { print -u2 "usage: tunnel.sh setup <name> <hostname>   (e.g. setup bryan mac-bryan.marbledrive.app)"; return 2 }
  # A name the front door Worker routes must keep its DNS: pointing it at this
  # tunnel would skip the Worker (and every drive behind that name).
  local routed
  routed=(${(f)"$(sed -n 's#.*pattern *= *"\([^"/]*\)/\*".*#\1#p' "$repo/worker/wrangler.toml" 2>/dev/null)"})
  (( ${#routed} )) || { print -u2 "tunnel: cannot read the Worker's routes in $repo/worker/wrangler.toml"; return 1 }
  (( ${routed[(Ie)$host]} )) && { print -u2 "tunnel: refusing: $host is routed through the front door Worker (worker/wrangler.toml); use mac-$name.marbledrive.app"; return 2 }
  [[ $host == [a-z0-9-]##.marbledrive.app ]] || { print -u2 "tunnel: the tunnel's name must be one label under marbledrive.app (e.g. mac-$name.marbledrive.app)"; return 2 }
  need_cloudflared || return 1
  [[ -f $cf_dir/cert.pem ]] || {
    print -u2 "tunnel: cloudflared is not signed in to the Cloudflare account. Run this, pick the marbledrive.app zone, then run setup again:"
    print -u2 "  cloudflared tunnel login"
    return 1
  }
  local id
  id=$(cloudflared tunnel list --output json --name "$tunnel" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s);if(t[0])console.log(t[0].id)}catch{}})')
  if [[ -z $id ]]; then
    cloudflared tunnel create "$tunnel" || { print -u2 "tunnel: could not create $tunnel"; return 1 }
    id=$(cloudflared tunnel list --output json --name "$tunnel" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s);if(t[0])console.log(t[0].id)}catch{}})')
    [[ -n $id ]] || { print -u2 "tunnel: created $tunnel but cannot find its id"; return 1 }
  fi
  local creds="$cf_dir/$id.json"
  [[ -f $creds ]] || {
    print -u2 "tunnel: $tunnel exists but its credentials are not on this Mac ($creds). Fetch them with:"
    print -u2 "  cloudflared tunnel token --cred-file '$creds' $tunnel"
    return 1
  }
  mkdir -p "$cf_dir"
  cat > "$config" <<EOF
# Written by macos/launchd/tunnel.sh setup $name $host
tunnel: $id
credentials-file: $creds
ingress:
  - hostname: $host
    service: http://127.0.0.1:$port
  - service: http_status:404
EOF
  cloudflared tunnel --config "$config" ingress validate >/dev/null || { print -u2 "tunnel: cloudflared does not accept $config"; return 1 }
  cloudflared tunnel route dns "$tunnel" "$host" || { print -u2 "tunnel: could not point $host at $tunnel"; return 1 }
  print -r -- "$tunnel ($id): $host -> http://127.0.0.1:$port; config $config"
  print -r -- "next: macos/launchd/tunnel.sh install $name"
}

ready() {
  gated || return 1
  [[ -f $config ]] || { print -u2 "tunnel: no $config yet: run macos/launchd/tunnel.sh setup $name <hostname>"; return 1 }
  served_gated
}
render() {
  mkdir -p "${plist:h}" "${log:h}"
  sed -e "s#@LABEL@#$label#g" -e "s#@HOME@#$HOME#g" -e "s#@NAME@#$name#g" \
      -e "s#@CONFIG@#$config#g" -e "s#@CLOUDFLARED@#$(command -v cloudflared)#g" "$template" > "$plist"
  plutil -lint "$plist" >/dev/null || { print -u2 "tunnel: rendered plist is not valid"; return 1 }
}
boot_out() {
  loaded || return 0
  launchctl bootout "$domain/$label" 2>/dev/null
  repeat 40 do loaded || return 0; sleep 0.25; done
  print -u2 "tunnel: $label is still running 10 s after it was told to stop"; return 1
}
wait_running() {
  repeat 40 do [[ -n $(pid_of) ]] && { print -r -- "$tunnel running (pid $(pid_of)) for $(hostname_of); log $log"; return 0 }; sleep 0.25; done
  print -u2 "tunnel: loaded, but cloudflared is not running; see $log"; return 1
}
boot_in() {
  launchctl enable "$domain/$label" 2>/dev/null
  launchctl bootstrap "$domain" "$plist" || return 1
  wait_running
}
restart() {
  loaded || { render && boot_in; return }
  launchctl kickstart -k "$domain/$label" || { print -u2 "tunnel: launchd would not restart $label"; return 1 }
  wait_running
}

case "$verb" in
  setup) setup "${3:-}" ;;
  check) ready && print -r -- "$tunnel may run: $settings sets a passphrase and the drive behind the tunnel asks for it" ;;
  install|start) ready && need_cloudflared && boot_out && render && boot_in ;;
  restart) ready && need_cloudflared && restart ;;
  stop) boot_out && print -r -- "$tunnel stopped (start: macos/launchd/tunnel.sh start $name)" ;;
  status) print -r -- "$label pid ${$(pid_of):-—} host ${$(hostname_of):-(no config)} -> 127.0.0.1:$port" ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall) boot_out && rm -f "$plist" && print -r -- "$tunnel uninstalled; the tunnel and its DNS record stay at Cloudflare (cloudflared tunnel delete $tunnel removes it)" ;;
  *) print -u2 "usage: tunnel.sh <setup|check|install|start|stop|restart|status|logs|uninstall> <name> [<hostname>]"; exit 2 ;;
esac
