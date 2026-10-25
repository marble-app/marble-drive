#!/usr/bin/env bash
# The sandbox other people's drives run in on this PC, installed with sudo
# (docs/HOSTING.md, "marble-host and the sandbox"):
#
#   sudo bash linux/pc-host/install.sh [<owner>]               install, or bring up to date
#   sudo bash linux/pc-host/install.sh --uninstall [<owner>]   take it away again
#
# The owner is the user marble-host runs as: $SUDO_USER unless named. This
# installs the guest unit template (marble-guest@.service) and the slices
# they share (marble-guests.slice, inside marble.slice) into
# /etc/systemd/system, the polkit rule that lets the owner's user
# (and so marble-host) start, stop and restart those units and nothing else,
# and run-guest into /opt/marble/bin. It makes /opt/marble with bin, releases
# and ms-playwright in it (the owner's, 755) and /etc/marble-guests (the
# owner's, 700, hidden from every guest), reloads systemd, and last runs every
# install.d/*.sh in name order, as root, for the pieces other parts of the
# build add (install.d/README). It copies no release: putting releases in
# /opt/marble/releases is the updater's job.
#
# Safe to run again. --uninstall stops every guest, runs install.d's pieces
# with --uninstall in the reverse order, and takes away everything above,
# /opt/marble and /etc/marble-guests included. It never deletes the drives'
# own folders (/var/lib/private/marble-guests).
#
# MARBLE_INSTALL_ROOT, MARBLE_SYSTEMCTL and MARBLE_INSTALL_D are for
# test/host-scripts.test.js alone: a folder standing in for /, a stand-in for
# systemctl, and the folder of pieces to run.
set -euo pipefail
umask 022

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "$HERE/../.." && pwd)"
ROOT="${MARBLE_INSTALL_ROOT:-}"
SYSTEMCTL="${MARBLE_SYSTEMCTL:-systemctl}"
PIECES="${MARBLE_INSTALL_D:-$HERE/install.d}"
UNITS="$ROOT/etc/systemd/system"
RULES="$ROOT/etc/polkit-1/rules.d"
OPT="$ROOT/opt/marble"
ETC="$ROOT/etc/marble-guests"
UNIT_FILES=(marble-guest@.service marble.slice marble-guests.slice)
RULE=50-marble-host.rules

say() { printf 'install: %s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

uninstall=0
owner=""
for arg in "$@"; do
  case "$arg" in
    --uninstall) uninstall=1 ;;
    -*) die "unknown option $arg (there is --uninstall)" ;;
    *) [[ -z $owner ]] || die "one owner, not \"$owner\" and \"$arg\""; owner="$arg" ;;
  esac
done
owner="${owner:-${SUDO_USER:-}}"

[[ $EUID -eq 0 || -n $ROOT ]] || die "run it with sudo: sudo bash $HERE/install.sh"
[[ -n $owner ]] || die "who is the owner? sudo sets SUDO_USER; or name them: sudo bash $HERE/install.sh <user>"
[[ $owner != root ]] || die "the owner is the user marble-host runs as, not root"
entry="$(getent passwd "$owner")" || die "there is no user \"$owner\""
OWNER="$owner"
OWNER_HOME="$(cut -d: -f6 <<<"$entry")"
group="$(id -gn "$owner")"
# Files owned by root as root installs them; as the owner where they are his.
# A test run (not root) owns everything itself.
AS_ROOT=()
AS_OWNER=()
if [[ $EUID -eq 0 ]]; then
  AS_ROOT=(-o root -g root)
  AS_OWNER=(-o "$owner" -g "$group")
fi

pieces() {
  local list=()
  if [[ -d $PIECES ]]; then
    while IFS= read -r piece; do list+=("$piece"); done < <(LC_ALL=C find "$PIECES" -maxdepth 1 -type f -name '*.sh' | LC_ALL=C sort)
  fi
  printf '%s\n' ${list[@]+"${list[@]}"}
}
run_pieces() {
  local order="$1" flag="${2:-}" piece
  local list=()
  while IFS= read -r piece; do [[ -n $piece ]] && list+=("$piece"); done < <(if [[ $order == reverse ]]; then pieces | LC_ALL=C sort -r; else pieces; fi)
  for piece in ${list[@]+"${list[@]}"}; do
    say "running install.d/$(basename "$piece")${flag:+ $flag}"
    OWNER="$OWNER" OWNER_HOME="$OWNER_HOME" OPT="$OPT" ETC="$ETC" RELEASE_DIR="$RELEASE_DIR" \
      bash "$piece" ${flag:+"$flag"} || die "install.d/$(basename "$piece") failed"
  done
}

if ((uninstall)); then
  # The drives first, while their units are still there to stop.
  "$SYSTEMCTL" stop 'marble-guest@*.service' >/dev/null 2>&1 || true
  run_pieces reverse --uninstall
  rm -f "$RULES/$RULE"
  for unit in "${UNIT_FILES[@]}"; do rm -f "$UNITS/$unit"; done
  "$SYSTEMCTL" daemon-reload || true
  rm -rf "$OPT" "$ETC"
  say "removed the guest units, the slices, the polkit rule, $OPT and $ETC"
  say "kept the drives' own folders in $ROOT/var/lib/private/marble-guests"
  exit 0
fi

# PrivatePIDs= came in systemd 257.
version="$("$SYSTEMCTL" --version 2>/dev/null | awk 'NR==1 { print $2 }')"
[[ $version =~ ^[0-9]+ ]] || die "could not tell which systemd this is"
((${BASH_REMATCH[0]} >= 257)) || die "the guests' sandbox needs systemd 257 or later (this is $version)"

for unit in "${UNIT_FILES[@]}"; do
  [[ -f $HERE/$unit ]] || die "$HERE/$unit is missing"
done
[[ -f $HERE/run-guest && -f $HERE/$RULE ]] || die "run-guest or $RULE is missing from $HERE"
[[ $owner =~ ^[a-z_][a-z0-9_-]*$ ]] || die "\"$owner\" is not a user name the polkit rule can hold"

# Folders the system already has are left as they are (their owners and
# modes are the system's), and only made where missing, as in a test.
[[ -d $UNITS ]] || install -d -m 755 "$UNITS"
for unit in "${UNIT_FILES[@]}"; do
  install ${AS_ROOT[@]+"${AS_ROOT[@]}"} -m 644 "$HERE/$unit" "$UNITS/$unit"
done
# polkit reads rules as its own user and watches the folder, so a new rule
# counts at once.
[[ -d $RULES ]] || install -d -m 755 "$RULES"
sed "s/@OWNER@/$owner/g" "$HERE/$RULE" >"$RULES/$RULE.new"
chmod 644 "$RULES/$RULE.new"
if [[ $EUID -eq 0 ]]; then chown root:root "$RULES/$RULE.new"; fi
mv -f "$RULES/$RULE.new" "$RULES/$RULE"

install -d ${AS_OWNER[@]+"${AS_OWNER[@]}"} -m 755 "$OPT" "$OPT/bin" "$OPT/releases" "$OPT/ms-playwright"
install ${AS_OWNER[@]+"${AS_OWNER[@]}"} -m 755 "$HERE/run-guest" "$OPT/bin/run-guest"
install -d ${AS_OWNER[@]+"${AS_OWNER[@]}"} -m 700 "$ETC"
# An earlier run may have made them another way: these are what they must be.
chmod 755 "$OPT" "$OPT/bin" "$OPT/releases" "$OPT/ms-playwright"
chmod 700 "$ETC"

"$SYSTEMCTL" daemon-reload
run_pieces forward

say "installed marble-guest@.service, marble.slice and marble-guests.slice, the polkit rule for $owner, and $OPT/bin/run-guest"
say "$OPT and $ETC are $owner's"
say "next, as $owner and without sudo:"
say "  the escape check, yours to write: a throwaway drive that tries every wall from inside (docs/HOSTING.md)"
say "  bash $HERE/host.sh install"
