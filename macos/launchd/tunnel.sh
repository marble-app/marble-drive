#!/bin/zsh
# A drive's Cloudflare tunnel on this Mac, under launchd (docs/HOSTING.md,
# "The front door (marbledrive.app)"). The front door Worker reaches a drive at
# home on the Mac through it; the tunnel's own name (mac-<name>.marbledrive.app)
# is not routed through the Worker.
#
#   macos/launchd/tunnel.sh setup <name> <hostname>   once: create the tunnel, write its config, route DNS
#   macos/launchd/tunnel.sh install|start|restart <name>
#   macos/launchd/tunnel.sh stop|status|logs|uninstall <name>
#
# setup needs `cloudflared tunnel login` done first. install, start and restart
# refuse unless the drive's settings file sets a passphrase: a tunnel must
# never put an ungated drive on the internet.

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

loaded() { launchctl print "$domain/$label" >/dev/null 2>&1 }
pid_of() { launchctl print "$domain/$label" 2>/dev/null | awk -F'= ' '/^[[:space:]]*pid = /{print $2; exit}' }
need_cloudflared() {
  command -v cloudflared >/dev/null || { print -u2 "tunnel: cloudflared is not installed (brew install cloudflared)"; return 1 }
}

# The drive's gate is on only when its settings file sets a passphrase (the
# home service reads that file; macos/launchd/home.sh). Never print the value.
gated() {
  local line value
  [[ -r $settings ]] && while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ '^[[:space:]]*(export[[:space:]]+)?MARBLE_DRIVE_SECRET=(.*)$' ]] || continue
    value="${match[2]}"
    value="${value%%[[:space:]]#}"
    [[ $value == \"*\" || $value == \'*\' ]] && value="${value[2,-2]}"
    [[ -n $value ]] && return 0
  done < "$settings"
  print -u2 "tunnel: refusing: $settings has no non-empty MARBLE_DRIVE_SECRET= line."
  print -u2 "tunnel: without a passphrase the drive is ungated, and this tunnel would put it on the internet for anyone."
  print -u2 "tunnel: set the passphrase there (the same one the drive uses on Fly), restart the home service, then try again."
  return 1
}

hostname_of() { awk '/^[[:space:]]*-[[:space:]]*hostname:/{print $NF; exit}' "$config" 2>/dev/null }

setup() {
  local host="${1:-}"
  [[ -n $host ]] || { print -u2 "usage: tunnel.sh setup <name> <hostname>   (e.g. setup bryan mac-bryan.marbledrive.app)"; return 2 }
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
  need_cloudflared
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
  install|start) ready && boot_out && render && boot_in ;;
  restart) ready && restart ;;
  stop) boot_out && print -r -- "$tunnel stopped (start: macos/launchd/tunnel.sh start $name)" ;;
  status) print -r -- "$label pid ${$(pid_of):-—} host ${$(hostname_of):-(no config)} -> 127.0.0.1:$port" ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall) boot_out && rm -f "$plist" && print -r -- "$tunnel uninstalled; the tunnel and its DNS record stay at Cloudflare (cloudflared tunnel delete $tunnel removes it)" ;;
  *) print -u2 "usage: tunnel.sh <setup|install|start|stop|restart|status|logs|uninstall> <name> [<hostname>]"; exit 2 ;;
esac
