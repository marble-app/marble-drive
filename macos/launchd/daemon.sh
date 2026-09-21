#!/bin/zsh
# Install, inspect and stop the drive as a launchd service.
#
#   macos/launchd/daemon.sh install     put it under launchd and start it
#   macos/launchd/daemon.sh status      is it up, since when, on what port
#   macos/launchd/daemon.sh restart     stop and start, picking up new server/ code
#   macos/launchd/daemon.sh stop        stop it and leave it stopped
#   macos/launchd/daemon.sh uninstall   stop it and forget it
#   macos/launchd/daemon.sh logs        follow the log
#
# Why launchd and not nohup, tmux or a login item: a service under launchd has
# no controlling terminal to be hung up on, is restarted whenever it stops, and
# starts again at login without anyone being there to type. The failure this
# fixes is a host that lived in a terminal window.

set -u
emulate -L zsh

label="com.marble.drive.serve"
repo="${0:A:h:h:h}"
plist="$HOME/Library/LaunchAgents/$label.plist"
template="$repo/macos/launchd/com.marble.drive.serve.plist.in"
logdir="$HOME/Library/Logs/marble-drive"
log="$logdir/serve.log"
domain="gui/$(id -u)"

# The port the host will bind, read the way the host reads it: node's
# --env-file does not override a variable that is already in the environment,
# so a PORT set here wins over the files, exactly as it does for the host.
port() {
  local value
  [[ -n ${PORT:-} ]] && { print -r -- "$PORT"; return }
  for file in "$repo/.env.local" "$repo/.env"; do
    [[ -f $file ]] || continue
    value=$(grep -E '^PORT=' "$file" | tail -1 | cut -d= -f2 | tr -d ' "')
    [[ -n ${value:-} ]] && { print -r -- "$value"; return }
  done
  print -r -- "4400"
}

health() {
  curl -fsS --max-time 3 "http://127.0.0.1:$(port)/health" 2>/dev/null
}

# The pid launchd is watching, or nothing.
pid_of() {
  launchctl print "$domain/$label" 2>/dev/null | awk -F'= ' '/^[[:space:]]*pid = /{print $2; exit}'
}

wait_for_health() {
  local tries=${1:-40}
  repeat $tries do
    [[ -n $(health) ]] && return 0
    sleep 0.5
  done
  return 1
}

render() {
  mkdir -p "${plist:h}" "$logdir"
  sed -e "s#@LABEL@#$label#g" -e "s#@REPO@#$repo#g" -e "s#@HOME@#$HOME#g" "$template" > "$plist"
  plutil -lint "$plist" >/dev/null || { print -u2 "daemon: rendered plist is not valid"; return 1 }
}

boot_out() {
  launchctl bootout "$domain/$label" 2>/dev/null
  # bootout returns before the process is gone; wait for it rather than racing
  # the next bootstrap for the port.
  repeat 40 do
    [[ -z $(pid_of) ]] && break
    sleep 0.25
  done
}

case "${1:-status}" in

install)
  # A host already holding the port, started some other way, would make the
  # service fail to bind every ten seconds forever. Say so instead.
  holder=$(lsof -ti "tcp:$(port)" -sTCP:LISTEN 2>/dev/null | head -1)
  if [[ -n ${holder:-} && $holder != $(pid_of) ]]; then
    print -u2 "daemon: something already listens on port $(port) (pid $holder):"
    ps -o pid,tty,etime,command -p "$holder" | tail -1 | sed 's/^/  /' >&2
    print -u2 "\nStop that first — it is the same host, started by hand — then run install again."
    exit 1
  fi
  render || exit 1
  boot_out
  launchctl enable "$domain/$label" 2>/dev/null
  if ! launchctl bootstrap "$domain" "$plist"; then
    print -u2 "daemon: launchctl bootstrap failed — see $logdir/launchd.log"
    exit 1
  fi
  if wait_for_health; then
    print -r -- "marble-drive is under launchd and answering on http://127.0.0.1:$(port) (pid $(pid_of))"
    print -r -- "It will start again on its own if it ever stops, and at every login."
  else
    print -u2 "daemon: started, but /health did not answer. Last of the log:"
    tail -20 "$log" 2>/dev/null | sed 's/^/  /' >&2
    exit 1
  fi
  ;;

status)
  if [[ ! -f $plist ]]; then
    print -r -- "not installed — run: macos/launchd/daemon.sh install"
    exit 1
  fi
  state=$(launchctl print "$domain/$label" 2>/dev/null | awk -F'= ' '/^[[:space:]]*state = /{print $2; exit}')
  pid=$(pid_of)
  print -r -- "label   $label"
  print -r -- "state   ${state:-not loaded}"
  print -r -- "pid     ${pid:-—}"
  [[ -n ${pid:-} ]] && print -r -- "uptime  $(ps -o etime= -p "$pid" | tr -d ' ')"
  print -r -- "port    $(port)"
  print -r -- "health  $(health || print -r -- 'no answer')"
  print -r -- "log     $log"
  ;;

restart)
  boot_out
  render || exit 1
  launchctl bootstrap "$domain" "$plist" || exit 1
  wait_for_health && print -r -- "restarted — pid $(pid_of), http://127.0.0.1:$(port)"
  ;;

stop)
  boot_out
  print -r -- "stopped. It stays stopped until: macos/launchd/daemon.sh install"
  ;;

uninstall)
  boot_out
  rm -f "$plist"
  print -r -- "uninstalled. The log is still at $log"
  ;;

logs)
  tail -f -n 80 "$log"
  ;;

*)
  print -u2 "usage: daemon.sh [install|status|restart|stop|uninstall|logs]"
  exit 2
  ;;
esac
