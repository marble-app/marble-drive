#!/bin/zsh
# Run the owner's sprite's browser tests on this Mac (tools/test-runner.mjs;
# the sprite's half is tools/browser-tests.mjs).
#
#   macos/launchd/test-runner.sh install [<sprite>]   keep it running, from login on (default admin-p2)
#   macos/launchd/test-runner.sh status               installed? the log's tail
#   macos/launchd/test-runner.sh uninstall            stop; the sprite runs its tests itself again
#   macos/launchd/test-runner.sh logs                 follow the log
#
# The copies it runs from are in ~/Library/Caches/marble-runner/<sprite>/.

set -u
emulate -L zsh

label="com.marble.drive.test-runner"
repo="${0:A:h:h:h}"
plist="$HOME/Library/LaunchAgents/$label.plist"
template="$repo/macos/launchd/$label.plist.in"
logdir="$HOME/Library/Logs/marble-drive"
log="$logdir/test-runner.log"
domain="gui/$(id -u)"

case "${1:-status}" in

install)
  sprite="${2:-admin-p2}"
  node="$(command -v node)" || { print -u2 "test-runner: no node on PATH"; exit 1; }
  mkdir -p "${plist:h}" "$logdir"
  sed -e "s#@LABEL@#$label#g" -e "s#@REPO@#$repo#g" -e "s#@HOME@#$HOME#g" -e "s#@SPRITE@#$sprite#g" \
    -e "s#@NODE@#$node#g" -e "s#@NODEDIR@#${node:h}#g" "$template" > "$plist"
  plutil -lint "$plist" >/dev/null || { print -u2 "test-runner: rendered plist is not valid"; exit 1 }
  launchctl bootout "$domain/$label" 2>/dev/null
  launchctl enable "$domain/$label" 2>/dev/null
  launchctl bootstrap "$domain" "$plist" || { print -u2 "test-runner: launchctl bootstrap failed"; exit 1 }
  print -r -- "running $sprite's browser tests on this Mac while it is on (log: $log)"
  ;;

status)
  if [[ ! -f $plist ]]; then print -r -- "not installed — run: macos/launchd/test-runner.sh install"; exit 1; fi
  print -r -- "label    $label ($(launchctl print "$domain/$label" >/dev/null 2>&1 && print loaded || print 'not loaded'))"
  print -r -- "sprite   $(plutil -extract ProgramArguments.2 raw -o - "$plist" 2>/dev/null)"
  print -r -- "log      $log"
  tail -5 "$log" 2>/dev/null | sed 's/^/  /'
  ;;

uninstall)
  launchctl bootout "$domain/$label" 2>/dev/null
  rm -f "$plist"
  print -r -- "uninstalled; the sprite runs its browser tests itself"
  ;;

logs)
  tail -f -n 40 "$log"
  ;;

*)
  print -u2 "usage: test-runner.sh [install [<sprite>]|status|uninstall|logs]"
  exit 2
  ;;
esac
