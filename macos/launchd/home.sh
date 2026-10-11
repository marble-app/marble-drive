#!/bin/zsh
# The owner's drive on this Mac, under launchd (docs/HOSTING.md, "The owner's
# drive on the Mac"). Names match server/hub/home-paths.js.
#
#   macos/launchd/home.sh install [<name>]   render and start (name: bryan, or t-bryan for the trial)
#   macos/launchd/home.sh start|stop|restart [<name>]
#   macos/launchd/home.sh status|logs|uninstall [<name>]
#
# It runs whatever tools/mac-release.sh made current. Whether it serves the
# drive or stands by is the lease's call (tools/home-mode.mjs), not this
# script's.

set -u
emulate -L zsh

name="${2:-bryan}"
repo="${0:A:h:h:h}"
app="$HOME/Library/Application Support/Marble Drive/app"
label="com.marble.drive.home.$name"
plist="$HOME/Library/LaunchAgents/$label.plist"
template="$repo/macos/launchd/com.marble.drive.home.plist.in"
domain="gui/$(id -u)"
if [[ $name == bryan ]]; then root="$HOME/Marble Drive"; port=4401; else root="$HOME/Marble Drive ($name)"; port=4402; fi
hub_env="$HOME/.config/marble-drive/hub-$name.env"
log="$HOME/Library/Logs/marble-drive/home-$name.log"

health() { curl -fsS --max-time 3 "http://127.0.0.1:$port/health" 2>/dev/null }
loaded() { launchctl print "$domain/$label" >/dev/null 2>&1 }
pid_of() { launchctl print "$domain/$label" 2>/dev/null | awk -F'= ' '/^[[:space:]]*pid = /{print $2; exit}' }

render() {
  [[ -L "$app/current" ]] || { print -u2 "home: no release yet: run tools/mac-release.sh"; return 1 }
  mkdir -p "${plist:h}" "${log:h}" "$root"
  sed -e "s#@LABEL@#$label#g" -e "s#@APP@#$app#g" -e "s#@HOME@#$HOME#g" -e "s#@NAME@#$name#g" \
      -e "s#@ROOT@#$root#g" -e "s#@PORT@#$port#g" -e "s#@HUB_ENV@#$hub_env#g" \
      -e "s#@NODE_DIR@#${$(command -v node):h}#g" -e "s#@SRC@#${repo:h}#g" "$template" > "$plist"
  plutil -lint "$plist" >/dev/null || { print -u2 "home: rendered plist is not valid"; return 1 }
}
# Gone means launchd no longer knows the job (and so no process of it runs).
# The host takes a few seconds to let go of the drive; launchd kills it after 20.
boot_out() {
  loaded || return 0
  launchctl bootout "$domain/$label" 2>/dev/null
  repeat 100 do loaded || return 0; sleep 0.25; done
  print -u2 "home: $label is still running 25 s after it was told to stop"; return 1
}
wait_health() {
  repeat 60 do [[ -n $(health) ]] && { print -r -- "$name on http://127.0.0.1:$port: $(health)"; return 0 }; sleep 0.5; done
  print -u2 "home: started, but /health did not answer; see $log"; return 1
}
boot_in() {
  launchctl enable "$domain/$label" 2>/dev/null
  launchctl bootstrap "$domain" "$plist" || return 1
  wait_health
}
# A loaded job is restarted in place, never unloaded, so KeepAlive holds
# throughout (the plist is not re-read; a new release is picked up through the
# current link all the same). It is asked to stop first (serve.sh stops the
# host cleanly on TERM), then started at once: a plain kickstart, which does
# nothing if KeepAlive already started it again, or kickstart -k if the old one
# is still running 25 s later. A job that is not loaded is rendered and loaded.
restart() {
  loaded || { render && boot_in; return }
  local old=$(pid_of) new
  if [[ -n $old ]]; then
    launchctl kill SIGTERM "$domain/$label" 2>/dev/null
    repeat 100 do [[ $(pid_of) == $old ]] || break; sleep 0.25; done
  fi
  if [[ -n $old && $(pid_of) == $old ]]; then
    launchctl kickstart -k "$domain/$label"
  else
    launchctl kickstart "$domain/$label"
  fi || { print -u2 "home: launchd would not restart $label"; return 1 }
  repeat 100 do new=$(pid_of); [[ -n $new && $new != $old ]] && break; sleep 0.25; done
  [[ -n $new && $new != $old ]] || { print -u2 "home: $label did not start again within 25 s"; return 1 }
  wait_health
}

case "${1:-status}" in
  install|start) boot_out && render && boot_in ;;
  restart) restart ;;
  stop) boot_out && print -r -- "$name stopped (start: macos/launchd/home.sh start $name)" ;;
  status) print -r -- "$label pid ${$(pid_of):-—} port $port root $root"; print -r -- "health ${$(health):-no answer}" ;;
  logs) tail -f -n 80 "$log" ;;
  uninstall) boot_out && rm -f "$plist" && print -r -- "$name uninstalled; the drive at $root is untouched" ;;
  *) print -u2 "usage: home.sh <install|start|stop|restart|status|logs|uninstall> [<name>]"; exit 2 ;;
esac
