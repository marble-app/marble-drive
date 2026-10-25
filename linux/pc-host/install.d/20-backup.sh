#!/usr/bin/env bash
# The PC drives' encrypted backups and their removal helper (docs/HOSTING.md,
# "Backups of PC drives"). Run as root by linux/pc-host/install.sh, which sets
# OWNER, OWNER_HOME, OPT, ETC and RELEASE_DIR, and by its --uninstall, in
# reverse order. Safe to run again.
#
#   20-backup.sh [--uninstall]
#
# Installs root-owned copies (755) of backup-guest, backup-guests,
# restore-guest, remove-guest, backup-check.sh and backup-tree (and
# backup-lib.sh, 644), with a root-owned copy of the owner's pinned rclone
# ($OWNER_HOME/.local/bin/rclone, checked against tools/sprite/rclone-version),
# into /usr/local/lib/marble-guests. Not into /opt/marble/bin: /opt/marble is
# the owner's, so his user, and marble-host with it, could rename a file there
# and put another in its place for root to run. Then the units
# marble-guest-backup@.service, marble-guests-backup.service and .timer, and
# marble-guest-remove@.service; /var/lib/marble-backup; and /etc/marble-backup
# (root, 700) with, only when it is missing, backup.env (600): R2_ACCOUNT_ID,
# R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET from the owner's hub
# settings ($OWNER_HOME/.config/marble-drive/hub-bryan.env), and a new
# GUEST_BACKUP_PASSPHRASE and GUEST_BACKUP_SALT, the backups' own. Nothing it
# prints holds a secret. Last, the hourly timer is enabled and started.
#
# --uninstall stops and removes the units and the tools. It keeps
# /etc/marble-backup, since without its passphrase and salt the backups in R2
# can never be read, and /var/lib/marble-backup.
set -euo pipefail
umask 022

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(dirname "$HERE")"
REPO="$(cd "$SRC/../.." && pwd)"
# Only test/host-backup.test.js moves these.
ROOT="${MARBLE_INSTALL_ROOT:-}"
SYSTEMCTL="${MARBLE_SYSTEMCTL:-systemctl}"
TOOLS="$ROOT/usr/local/lib/marble-guests"
UNITS="$ROOT/etc/systemd/system"
CONF="$ROOT/etc/marble-backup"
STATE="$ROOT/var/lib/marble-backup"
UNIT_FILES=(marble-guest-backup@.service marble-guests-backup.service marble-guests-backup.timer marble-guest-remove@.service)
SCRIPTS=(backup-guest backup-guests restore-guest remove-guest backup-check.sh backup-tree)
say() { printf 'backups: %s\n' "$*"; }
die() { printf 'backups (install.d/20-backup.sh): %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 || -n $ROOT ]] || die "install.sh runs this as root: sudo bash linux/pc-host/install.sh"
OWN=()
if [[ $EUID -eq 0 ]]; then OWN=(-o root -g root); fi

if [[ ${1:-} == --uninstall ]]; then
  "$SYSTEMCTL" disable --now marble-guests-backup.timer >/dev/null 2>&1 || true
  "$SYSTEMCTL" stop marble-guests-backup.service 'marble-guest-backup@*.service' 'marble-guest-remove@*.service' >/dev/null 2>&1 || true
  for unit in "${UNIT_FILES[@]}"; do rm -f "$UNITS/$unit"; done
  "$SYSTEMCTL" daemon-reload || true
  rm -rf "$TOOLS"
  say "removed the units and $TOOLS; kept $CONF (its passphrase and salt are the only way to read the backups in R2) and $STATE"
  exit 0
fi
[[ -z ${1:-} ]] || die "unknown option $1"
[[ -n ${OWNER_HOME:-} ]] || die "OWNER_HOME is not set; install.sh sets it"

# rclone: the owner's pinned one, copied first and checked as the copy, so the
# file root runs is the file that was checked.
want="$(tr -d '[:space:]' <"$REPO/tools/sprite/rclone-version")"
from="$OWNER_HOME/.local/bin/rclone"
[[ -f $from && -x $from ]] || die "no rclone at $from; tools/pc-setup.sh installs rclone $want there"
install -d -m 755 "${OWN[@]}" "$TOOLS"
install -m 755 "${OWN[@]}" "$from" "$TOOLS/.rclone.new"
got="$("$TOOLS/.rclone.new" version 2>/dev/null | head -1)" || true
if [[ $got != "rclone v$want" ]]; then
  rm -f "$TOOLS/.rclone.new"
  die "$from is ${got:-not an rclone that runs}, not rclone v$want; tools/pc-setup.sh installs the pinned one"
fi
mv -f "$TOOLS/.rclone.new" "$TOOLS/rclone"
for file in "${SCRIPTS[@]}"; do install -m 755 "${OWN[@]}" "$SRC/$file" "$TOOLS/$file"; done
install -m 644 "${OWN[@]}" "$SRC/backup-lib.sh" "$TOOLS/backup-lib.sh"

install -d -m 755 "$UNITS"
for unit in "${UNIT_FILES[@]}"; do install -m 644 "${OWN[@]}" "$SRC/$unit" "$UNITS/$unit"; done
install -d -m 755 "${OWN[@]}" "$STATE" "$STATE/status"
install -d -m 700 "${OWN[@]}" "$STATE/manifests" "$STATE/locks" "$STATE/restoring"
install -d -m 700 "${OWN[@]}" "$CONF"

env_file="$CONF/backup.env"
made=0
if [[ ! -e $env_file ]]; then
  hub="${MARBLE_HUB_ENV_FILE:-$OWNER_HOME/.config/marble-drive/hub-bryan.env}"
  [[ -r $hub ]] || die "the R2 settings come from $hub, which cannot be read; backups stay off until it can, then run install.sh again"
  # KEY=value, by server/hub/settings.js's rules, and only the four R2 keys.
  declare -A r2=()
  dq='^"(.*)"$' sq="^'(.*)'\$"
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_BUCKET)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    key=${BASH_REMATCH[1]} value=${BASH_REMATCH[2]}
    value="${value%"${value##*[![:space:]]}"}"
    if [[ $value =~ $dq || $value =~ $sq ]]; then value=${BASH_REMATCH[1]}; fi
    r2[$key]=$value
  done <"$hub"
  missing=()
  for key in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
    if [[ -z ${r2[$key]:-} ]]; then
      missing+=("$key")
    elif [[ ! ${r2[$key]} =~ ^[A-Za-z0-9._-]+$ ]]; then
      die "$key in $hub holds characters a settings file here cannot carry; nothing was written"
    fi
  done
  ((${#missing[@]} == 0)) || die "$hub lacks ${missing[*]}; backups stay off until it has them, then run install.sh again"
  # 32 random bytes each, as hex: nothing a shell or rclone reads specially.
  passphrase="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
  salt="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
  [[ ${#passphrase} == 64 && ${#salt} == 64 ]] || die "could not draw a random passphrase"
  (
    umask 077
    {
      printf '# The PC drives'\'' backups (docs/HOSTING.md, "Backups of PC drives"), made by\n'
      printf '# linux/pc-host/install.d/20-backup.sh. Without GUEST_BACKUP_PASSPHRASE and\n'
      printf '# GUEST_BACKUP_SALT the backups in R2 can never be read: keep both in a\n'
      printf '# password manager. The R2 keys are the hub'\''s.\n'
      printf 'R2_ACCOUNT_ID=%s\n' "${r2[R2_ACCOUNT_ID]}"
      printf 'R2_ACCESS_KEY_ID=%s\n' "${r2[R2_ACCESS_KEY_ID]}"
      printf 'R2_SECRET_ACCESS_KEY=%s\n' "${r2[R2_SECRET_ACCESS_KEY]}"
      printf 'R2_BUCKET=%s\n' "${r2[R2_BUCKET]}"
      printf 'GUEST_BACKUP_PASSPHRASE=%s\n' "$passphrase"
      printf 'GUEST_BACKUP_SALT=%s\n' "$salt"
    } >"$env_file.new"
  )
  if [[ $EUID -eq 0 ]]; then chown root:root "$env_file.new"; fi
  chmod 600 "$env_file.new"
  mv -f "$env_file.new" "$env_file"
  unset passphrase salt r2
  made=1
fi

"$SYSTEMCTL" daemon-reload
"$SYSTEMCTL" enable --now marble-guests-backup.timer
say "installed the units and $TOOLS; each drive is backed up hourly"
if ((made)); then
  say "made $env_file: save GUEST_BACKUP_PASSPHRASE and GUEST_BACKUP_SALT in your password manager now (sudo cat $env_file), since without them the backups can never be read"
else
  say "kept $env_file as it was"
fi
say "try a backup and a restore once: sudo $TOOLS/backup-check.sh"
