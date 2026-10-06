#!/usr/bin/env bash
# Carry a drive's settings from the Mac to the PC (docs/HOSTING.md, "A drive
# at home on the Mac or the PC"): the hub settings (R2 keys, lease token, the
# hub's passphrase and salt) and the home's own settings (the drive's
# passphrase, the daily run, the TypeSafe key). Run it in your own terminal,
# never through an agent: it asks for a passphrase, and the files hold keys.
#
#   tools/home-secrets.sh pack [<name>]               on the Mac: writes ~/Desktop/marble-<name>-settings.enc
#   tools/home-secrets.sh unpack <file> [<name>]      on the PC: writes hub-<name>.env and pc-<name>.env
#
# The file is encrypted (AES-256, a key stretched from your passphrase by
# PBKDF2), so it can travel any way: a USB stick, email to yourself, a cloud
# folder. Delete it once unpacked.
#
# Unpacking makes the PC's copies: HUB_MACHINE=pc, and paths that named the
# Mac's home or its checkouts name the PC's. It never overwrites: a file
# already there is kept as <file>.before-<utc>.
set -euo pipefail

verb="${1:-}"
CONF="$HOME/.config/marble-drive"
die() { printf 'home-secrets: %s\n' "$*" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"

ask_pass() {
  local a b
  read -rs -p "Passphrase for the file: " a; echo
  if [[ ${1:-} == twice ]]; then
    read -rs -p "Again: " b; echo
    [[ $a == "$b" ]] || die "the two did not match; nothing written"
    (( ${#a} >= 12 )) || die "use at least 12 characters; nothing written"
  fi
  PASS="$a"
}
crypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt "$@" -pass fd:3 3<<<"$PASS"; }

case "$verb" in
  pack)
    name="${2:-bryan}"
    [[ $name =~ ^[a-z0-9-]+$ ]] || die "a drive name is lowercase letters, digits and dashes"
    for f in "hub-$name.env" "mac-$name.env"; do [[ -f "$CONF/$f" ]] || die "no $CONF/$f"; done
    out="$HOME/Desktop/marble-$name-settings.enc"
    ask_pass twice
    tar -C "$CONF" -cf - "hub-$name.env" "mac-$name.env" | crypt -out "$out"
    chmod 600 "$out"
    echo "wrote $out: bring it to the PC, then there: tools/home-secrets.sh unpack <file> $name"
    ;;
  unpack)
    file="${2:-}"; name="${3:-bryan}"
    [[ -f $file ]] || die "usage: tools/home-secrets.sh unpack <file> [<name>]"
    [[ $name =~ ^[a-z0-9-]+$ ]] || die "a drive name is lowercase letters, digits and dashes"
    [[ "$(uname -s)" == Linux ]] || die "unpack on the PC (its Ubuntu)"
    ask_pass
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    crypt -d -in "$file" | tar -C "$tmp" -xf - 2>/dev/null || die "could not open $file (a wrong passphrase?)"
    [[ -f "$tmp/hub-$name.env" && -f "$tmp/mac-$name.env" ]] || die "$file holds no settings for $name"
    mkdir -p "$CONF"; chmod 700 "$CONF"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    # The Mac's home and checkouts become the PC's; the sprite CLI is the PC's own.
    mac_home="$(sed -n 's#^MARBLE_DRIVE_CONSOLE_SRC=\(/Users/[^/]*\)/.*#\1#p' "$tmp/mac-$name.env" | head -1)"
    mac_home="${mac_home:-/Users/bryanmin}"
    node - "$tmp/hub-$name.env" "$tmp/mac-$name.env" "$tmp/hub.out" "$tmp/pc.out" "$mac_home" "$HOME" "$(dirname "$REPO")" <<'JS'
const fs = require('fs');
const [hubIn, macIn, hubOut, pcOut, macHome, home, src] = process.argv.slice(2);
const macSrc = `${macHome}/Development/3rd-year-projects`;
const hub = fs.readFileSync(hubIn, 'utf8')
  .replace(/^HUB_MACHINE=.*$/m, 'HUB_MACHINE=pc')
  .replace(/mac side/g, 'pc side');
if (!/^HUB_MACHINE=pc$/m.test(hub)) throw new Error('the hub settings have no HUB_MACHINE line');
const pc = fs.readFileSync(macIn, 'utf8')
  .split('\n')
  .map((line) => {
    if (/^MARBLE_DRIVE_CONSOLE_SPRITE=/.test(line)) return `MARBLE_DRIVE_CONSOLE_SPRITE=${home}/.local/bin/sprite`;
    if (line.startsWith('#')) return line.replace(/this Mac/g, 'this PC');
    return line.split(macSrc).join(src).split(macHome).join(home);
  })
  .join('\n');
fs.writeFileSync(hubOut, hub);
fs.writeFileSync(pcOut, pc);
JS
    for pair in "hub.out:hub-$name.env" "pc.out:pc-$name.env"; do
      from="$tmp/${pair%%:*}"; to="$CONF/${pair#*:}"
      [[ -e $to ]] && mv "$to" "$to.before-$stamp" && echo "kept the old $to as $to.before-$stamp"
      install -m 600 "$from" "$to"
      echo "wrote $to"
    done
    echo "delete $file now that it is unpacked; then: linux/systemd/home.sh restart $name"
    ;;
  *) echo "usage: tools/home-secrets.sh pack [<name>] | unpack <file> [<name>]" >&2; exit 2 ;;
esac
