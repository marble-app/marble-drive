#!/bin/zsh
# Back a sprite's drive up to this Mac on a schedule, and answer its Console
# (tools/backup-agent.mjs, which runs tools/drive-backup.sh).
#
#   macos/launchd/backup.sh install [<sprite>]   every minute and at login (default admin-p2)
#   macos/launchd/backup.sh status               installed? the last snapshots, the log's tail
#   macos/launchd/backup.sh run                  one scheduled run now
#   macos/launchd/backup.sh uninstall            stop scheduling; the backups stay
#   macos/launchd/backup.sh logs                 follow the log
#
# The copy is ~/Marble Backups/<utc>/, linked from ~/Marble Drive. The Console's Backups view
# on the sprite turns the schedule on or off, backs up and restores; so does
# tools/drive-restore.sh from here.

set -u
emulate -L zsh

label="com.marble.drive.backup"
repo="${0:A:h:h:h}"
plist="$HOME/Library/LaunchAgents/$label.plist"
template="$repo/macos/launchd/com.marble.drive.backup.plist.in"
logdir="$HOME/Library/Logs/marble-drive"
log="$logdir/backup.log"
domain="gui/$(id -u)"

sprite_of() { plutil -extract ProgramArguments.2 raw -o - "$plist" 2>/dev/null || print -r -- admin-p2 }

case "${1:-status}" in

install)
  sprite="${2:-admin-p2}"
  # launchd inherits no PATH worth the name, and node lives under nvm here.
  node="$(command -v node)" || { print -u2 "backup: no node on PATH"; exit 1; }
  mkdir -p "${plist:h}" "$logdir"
  sed -e "s#@LABEL@#$label#g" -e "s#@REPO@#$repo#g" -e "s#@HOME@#$HOME#g" -e "s#@SPRITE@#$sprite#g" -e "s#@NODE@#$node#g" "$template" > "$plist"
  plutil -lint "$plist" >/dev/null || { print -u2 "backup: rendered plist is not valid"; exit 1 }
  launchctl bootout "$domain/$label" 2>/dev/null
  launchctl enable "$domain/$label" 2>/dev/null
  launchctl bootstrap "$domain" "$plist" || { print -u2 "backup: launchctl bootstrap failed"; exit 1 }
  print -r -- "backing up $sprite into ~/Marble Drive after changes, and checking in with its Console every minute (log: $log)"
  ;;

status)
  if [[ ! -f $plist ]]; then print -r -- "not installed — run: macos/launchd/backup.sh install"; exit 1; fi
  print -r -- "label    $label ($(launchctl print "$domain/$label" >/dev/null 2>&1 && print loaded || print 'not loaded'))"
  print -r -- "sprite   $(sprite_of)"
  if [[ -L "$HOME/Marble Drive" ]]; then
    print -r -- "copy     ~/Marble Drive -> $(readlink "$HOME/Marble Drive" | sed "s#^$HOME#~#")"
    print -r -- "         $(cat "$HOME/Marble Drive/.marble/sync.json" 2>/dev/null)"
  else
    print -r -- "copy     none yet"
  fi
  [[ -f "$HOME/Marble Backups/.schedule-off" ]] && print -r -- "schedule off (turn it on from the Console's Backups view)"
  print -r -- "log      $log"
  tail -5 "$log" 2>/dev/null | sed 's/^/  /'
  ;;

run)
  launchctl kickstart "$domain/$label" && print -r -- "started; see: macos/launchd/backup.sh logs"
  ;;

uninstall)
  launchctl bootout "$domain/$label" 2>/dev/null
  rm -f "$plist"
  print -r -- "uninstalled. The copy stays in ~/Marble Backups"
  ;;

logs)
  tail -f -n 40 "$log"
  ;;

*)
  print -u2 "usage: backup.sh [install [<sprite>]|status|run|uninstall|logs]"
  exit 2
  ;;
esac
