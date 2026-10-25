# linux/pc-host/backup-lib.sh: sourced, never run. What backup-guest,
# backup-guests, restore-guest, remove-guest and backup-check.sh share: where
# things are, the backup settings, rclone's remote for one drive, one lock per
# drive and the status file (docs/HOSTING.md, "Backups of PC drives").
#
# Every path can be moved through the environment, so test/host-backup.test.js
# runs all of it without root or R2. The defaults are the PC's. The caller sets
# HERE to its own folder first.
# shellcheck disable=SC2034  # the settings here are read by the scripts that source this

# Times and names compare byte by byte, whatever the locale.
export LC_ALL=C
NAME_RE='^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
GUESTS="${MARBLE_GUESTS_DIR:-/var/lib/private/marble-guests}"
GUEST_LINKS="${MARBLE_GUESTS_LINKS:-/var/lib/marble-guests}"
GUEST_ETC="${MARBLE_GUESTS_ETC:-/etc/marble-guests}"
BACKUP_STATE="${MARBLE_BACKUP_DIR:-/var/lib/marble-backup}"
SYSTEMCTL="${MARBLE_SYSTEMCTL:-systemctl}"
PYTHON="${MARBLE_PYTHON:-python3}"
# The root-owned copy of the owner's pinned rclone, beside these scripts once
# installed (install.d/20-backup.sh).
RCLONE="${MARBLE_RCLONE:-$HERE/rclone}"
TREE="$HERE/backup-tree"
# Where install.d/20-backup.sh puts these scripts, for the commands they print.
TOOLS=/usr/local/lib/marble-guests
# What a backup leaves out, for rclone's full sync. Keep in step with
# left_out() in backup-tree.
EXCLUDES=(--exclude /.marble/agents/host.lock --exclude '/.marble/usage/**'
  --exclude '/.marble/console/backups/**' --exclude '/.marble/thumbs/.work-*/**')

say() { printf '%s\n' "$*"; }
die() { printf '%s: %s\n' "${0##*/}" "$*" >&2; exit 1; }
tree() { "$PYTHON" -I "$TREE" "$@"; }
# One key=value of a line backup-tree printed.
field() { if [[ " $2 " =~ \ $1=([^ ]*)\  ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi; }
stamp_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# 2026-10-25T17:00:03Z (or 20261025T170003Z) as 20261025T170003Z: the hub's
# trash stamps (server/hub/sync.js, stampOf), which sort as time does.
utc_of() { local t=${1//[-:]/}; t=${t%%.*}; printf '%s' "${t%Z}Z"; }
size_of() { awk -v b="$1" 'BEGIN { if (b >= 1073741824) printf "%.1f GB", b / 1073741824; else printf "%.1f MB", b / 1048576 }'; }

# The PC's own paths are root's. Moved ones (the tests) are not.
need_root() {
  if [[ $EUID -ne 0 && -z ${MARBLE_GUESTS_DIR:-} ]]; then die "run it as root, with sudo"; fi
}

# The settings: /etc/marble-backup/backup.env, or the copy systemd hands a
# unit through LoadCredential=, or MARBLE_BACKUP_ENV.
settings_file() {
  if [[ -n ${MARBLE_BACKUP_ENV:-} ]]; then
    printf '%s' "$MARBLE_BACKUP_ENV"
  elif [[ -n ${CREDENTIALS_DIRECTORY:-} && -r $CREDENTIALS_DIRECTORY/backup.env ]]; then
    printf '%s' "$CREDENTIALS_DIRECTORY/backup.env"
  else
    printf '%s' /etc/marble-backup/backup.env
  fi
}

# KEY=value lines, read by server/hub/settings.js's rules, into CFG_<KEY>:
# shell variables, never the environment, so nothing this starts sees a key
# unless it is handed one. rclone gets its own at call time (rc).
# GUEST_BACKUP_BACKEND=local with GUEST_BACKUP_LOCAL_DIR stands in for R2, the
# way HUB_BACKEND does for the hub; the environment may set both.
load_settings() {
  local file line key value missing=() k v
  local dq='^"(.*)"$' sq="^'(.*)'\$"
  file="$(settings_file)"
  if [[ ! -r $file ]]; then SETTINGS_WHY="the backup settings ($file) cannot be read"; return 1; fi
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*# ]] && continue
    [[ $line =~ ^[[:space:]]*([A-Z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    key=${BASH_REMATCH[1]} value=${BASH_REMATCH[2]}
    value="${value%"${value##*[![:space:]]}"}"
    if [[ $value =~ $dq || $value =~ $sq ]]; then value=${BASH_REMATCH[1]}; fi
    case $key in
      R2_ACCOUNT_ID | R2_ACCESS_KEY_ID | R2_SECRET_ACCESS_KEY | R2_BUCKET | GUEST_BACKUP_PASSPHRASE | GUEST_BACKUP_SALT | \
        GUEST_BACKUP_BACKEND | GUEST_BACKUP_LOCAL_DIR | GUEST_BACKUP_MAX_BYTES)
        printf -v "CFG_$key" '%s' "$value" ;;
    esac
  done <"$file"
  CFG_GUEST_BACKUP_BACKEND="${GUEST_BACKUP_BACKEND:-${CFG_GUEST_BACKUP_BACKEND:-r2}}"
  CFG_GUEST_BACKUP_LOCAL_DIR="${GUEST_BACKUP_LOCAL_DIR:-${CFG_GUEST_BACKUP_LOCAL_DIR:-}}"
  # Ten gigabytes: a drive is megabytes, and an agent's runaway file should
  # not be copied out and sent each hour.
  CFG_GUEST_BACKUP_MAX_BYTES="${CFG_GUEST_BACKUP_MAX_BYTES:-10737418240}"
  local need=(GUEST_BACKUP_PASSPHRASE GUEST_BACKUP_SALT)
  if [[ $CFG_GUEST_BACKUP_BACKEND == local ]]; then
    need+=(GUEST_BACKUP_LOCAL_DIR)
  else
    need+=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET)
  fi
  for k in "${need[@]}"; do
    v="CFG_$k"
    [[ -n ${!v:-} ]] || missing+=("$k")
  done
  if ((${#missing[@]})); then SETTINGS_WHY="the backup settings ($file) lack ${missing[*]}"; return 1; fi
  [[ $CFG_GUEST_BACKUP_MAX_BYTES =~ ^[0-9]+$ ]] || { SETTINGS_WHY="GUEST_BACKUP_MAX_BYTES is not a number"; return 1; }
}

rclone_bare() { RCLONE_CONFIG=/dev/null "$RCLONE" "$@"; }

# The drive's remote, guest:, an rclone crypt over guests/<name>/ in the hub's
# bucket, with this backup's own passphrase and salt, never the hub's. Each is
# obscured by rclone itself and handed to it on stdin, as server/hub/sync.js
# does: argv shows in ps.
remote_for() {
  if [[ $CFG_GUEST_BACKUP_BACKEND == local ]]; then
    RAW_PREFIX="guestraw:$CFG_GUEST_BACKUP_LOCAL_DIR/guests/$1"
  else
    RAW_PREFIX="guestraw:$CFG_R2_BUCKET/guests/$1"
  fi
  OBSCURED_PASSPHRASE="$(printf '%s' "$CFG_GUEST_BACKUP_PASSPHRASE" | rclone_bare obscure -)" || return 1
  OBSCURED_SALT="$(printf '%s' "$CFG_GUEST_BACKUP_SALT" | rclone_bare obscure -)" || return 1
  [[ -n $OBSCURED_PASSPHRASE && -n $OBSCURED_SALT ]]
}

# rclone with the remote set in its environment only. R2 sometimes leaves a
# request unanswered for 5-90 s from the owner's home network, so each call
# gives up on a stalled request after 10 s (5 s to connect) and retries, up to
# 20 times: PATIENCE in server/hub/sync.js.
rc() {
  (
    export RCLONE_CONFIG=/dev/null HOME="${WORK:-/tmp}"
    export RCLONE_TIMEOUT=10s RCLONE_CONTIMEOUT=5s RCLONE_LOW_LEVEL_RETRIES=20
    export RCLONE_CONFIG_GUEST_TYPE=crypt RCLONE_CONFIG_GUEST_REMOTE="$RAW_PREFIX"
    export RCLONE_CONFIG_GUEST_PASSWORD="$OBSCURED_PASSPHRASE" RCLONE_CONFIG_GUEST_PASSWORD2="$OBSCURED_SALT"
    if [[ $CFG_GUEST_BACKUP_BACKEND == local ]]; then
      export RCLONE_CONFIG_GUESTRAW_TYPE=local
    else
      export RCLONE_CONFIG_GUESTRAW_TYPE=s3 RCLONE_CONFIG_GUESTRAW_PROVIDER=Cloudflare
      export RCLONE_CONFIG_GUESTRAW_ACCESS_KEY_ID="$CFG_R2_ACCESS_KEY_ID"
      export RCLONE_CONFIG_GUESTRAW_SECRET_ACCESS_KEY="$CFG_R2_SECRET_ACCESS_KEY"
      export RCLONE_CONFIG_GUESTRAW_ENDPOINT="https://$CFG_R2_ACCOUNT_ID.r2.cloudflarestorage.com"
      export RCLONE_CONFIG_GUESTRAW_NO_CHECK_BUCKET=true
    fi
    exec "$RCLONE" "$@"
  )
}

# One object of guest: into a file. Answers 0 with the file, 1 when there is
# no such object (R2 says so with exit 0 and nothing; the local backend with 3
# or 4), 2 when R2 could not be asked.
rc_fetch() {
  local code=0
  rc cat "$1" >"$2" 2>"$2.err" || code=$?
  if ((code == 0)); then [[ -s $2 ]] && return 0 || return 1; fi
  if ((code == 3 || code == 4)); then return 1; fi
  tail -3 "$2.err" >&2
  return 2
}

# One backup, restore or removal of a drive at a time: a backup reading a drive
# while a restore swaps it, or a removal deletes it, would send half of each.
# Held until the script exits.
lock_drive() {
  local fd
  mkdir -p "$BACKUP_STATE/locks"
  chmod 700 "$BACKUP_STATE/locks"
  exec {fd}>>"$BACKUP_STATE/locks/$1.lock"
  flock -w "$2" "$fd"
}

# The status file: name ok|fail why files bytes changed lastGood at.
write_status() {
  mkdir -p "$BACKUP_STATE/status"
  chmod 755 "$BACKUP_STATE" "$BACKUP_STATE/status"
  tree status "$BACKUP_STATE/status/$1.json" "$@"
}

# The last time a backup of this drive ended well, from its status file.
last_good_of() {
  local file="$BACKUP_STATE/status/$1.json" text
  [[ -f $file ]] || return 0
  text="$(<"$file")"
  [[ $text =~ \"lastGood\":\"([0-9TZ:-]+)\" ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}
