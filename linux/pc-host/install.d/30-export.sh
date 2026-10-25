#!/usr/bin/env bash
# The probe study's export of a PC drive's logs (docs/HOSTING.md, "The study
# on each drive"). Run as root by linux/pc-host/install.sh, which sets OWNER,
# OWNER_HOME, OPT, ETC and RELEASE_DIR, and by its --uninstall, in reverse
# order. Safe to run again.
#
#   30-export.sh [--uninstall]
#
# Installs a root-owned copy (755) of export-guest into
# /usr/local/lib/marble-guests, with the backup-tree (755) and backup-lib.sh
# (644) it uses, the same files 20-backup.sh puts there, so the export works
# whether or not the backups were installed. Not into /opt/marble/bin, which
# the owner's user could change under root. Then
# marble-guest-export@.service into /etc/systemd/system, with the owner's user
# name and his Research folder, $OWNER_HOME/Marble Drive/Research/Probe study,
# written in. It makes that folder, as the owner, if it is missing. The unit is
# never enabled: marble-host starts it, through the polkit rule install.sh
# installs, for each export.
#
# --uninstall stops any export still running and removes the unit and
# export-guest. It keeps the exports, which are the owner's, and leaves
# backup-tree and backup-lib.sh to 20-backup.sh, whose --uninstall runs next.
set -euo pipefail
umask 022

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(dirname "$HERE")"
# Only test/host-export.test.js moves these.
ROOT="${MARBLE_INSTALL_ROOT:-}"
SYSTEMCTL="${MARBLE_SYSTEMCTL:-systemctl}"
TOOLS="$ROOT/usr/local/lib/marble-guests"
UNITS="$ROOT/etc/systemd/system"
UNIT=marble-guest-export@.service
say() { printf 'study export: %s\n' "$*"; }
die() { printf 'study export (install.d/30-export.sh): %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 || -n $ROOT ]] || die "install.sh runs this as root: sudo bash linux/pc-host/install.sh"
OWN=()
if [[ $EUID -eq 0 ]]; then OWN=(-o root -g root); fi

if [[ ${1:-} == --uninstall ]]; then
  "$SYSTEMCTL" stop 'marble-guest-export@*.service' >/dev/null 2>&1 || true
  rm -f "$UNITS/$UNIT" "$TOOLS/export-guest"
  "$SYSTEMCTL" daemon-reload || true
  say "removed $UNIT and export-guest; the exports in the owner's Research folder are his, and stay"
  exit 0
fi
[[ -z ${1:-} ]] || die "unknown option $1"
[[ -n ${OWNER:-} && -n ${OWNER_HOME:-} ]] || die "OWNER and OWNER_HOME are not set; install.sh sets them"
[[ $OWNER =~ ^[a-z_][a-z0-9_-]*$ && $OWNER != root ]] || die "\"$OWNER\" is not a user the export can run as"
# The folder goes into the unit file, where % and quotes mean something else.
[[ $OWNER_HOME =~ ^/[A-Za-z0-9._/-]+$ ]] || die "the owner's home ($OWNER_HOME) has characters a unit file would read as something else"
EXPORTS="$OWNER_HOME/Marble Drive/Research/Probe study"
# Under a stand-in root the owner's home is stood in for too, so a test never
# makes a folder in a real one.
OWNER_FILES="$OWNER_HOME"
if [[ -n $ROOT && $OWNER_HOME != "$ROOT"/* ]]; then OWNER_FILES="$ROOT$OWNER_HOME"; fi
for file in export-guest backup-tree backup-lib.sh "$UNIT"; do
  [[ -f $SRC/$file ]] || die "$SRC/$file is missing"
done

install -d -m 755 "${OWN[@]}" "$TOOLS"
for file in export-guest backup-tree; do install -m 755 "${OWN[@]}" "$SRC/$file" "$TOOLS/$file"; done
install -m 644 "${OWN[@]}" "$SRC/backup-lib.sh" "$TOOLS/backup-lib.sh"

install -d -m 755 "$UNITS"
sed -e "s|@OWNER@|$OWNER|g" -e "s|@EXPORTS@|$EXPORTS|g" "$SRC/$UNIT" >"$UNITS/$UNIT.new"
chmod 644 "$UNITS/$UNIT.new"
if [[ $EUID -eq 0 ]]; then chown root:root "$UNITS/$UNIT.new"; fi
mv -f "$UNITS/$UNIT.new" "$UNITS/$UNIT"

# Made by the owner, not by root: root making folders in his home would
# follow any link he left in the way.
research="$OWNER_FILES/Marble Drive/Research/Probe study"
made=0
if [[ ! -d $research ]]; then
  if [[ $EUID -eq 0 ]]; then
    setpriv --reuid="$OWNER" --regid="$(id -g "$OWNER")" --init-groups -- mkdir -p -- "$research" ||
      die "could not make $research as $OWNER"
  else
    mkdir -p -- "$research"
  fi
  made=1
fi

"$SYSTEMCTL" daemon-reload
note=""
if ((made)); then note=" (made just now)"; fi
say "installed $UNIT and $TOOLS/export-guest; exports go to $EXPORTS$note"
say "an export copies a study drive's logs only with consent on file: systemctl start marble-guest-export@<name>.service"
