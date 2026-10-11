#!/usr/bin/env bash
# Make this PC (Ubuntu under WSL2) a home for the owner's drive
# (docs/HOSTING.md, "A drive at home on the Mac or the PC"). Run it from this
# checkout, inside Ubuntu, as yourself (it asks for sudo when it needs it).
# Safe to run again: every step checks first.
#
#   tools/pc-setup.sh [<name>]      (default bryan)
#
# It installs what the home needs (node 22, the pinned rclone, cloudflared,
# the sprite CLI, Chromium's libraries), turns on lingering so the service runs
# with no window open, builds a release (tools/home-release.sh) and installs
# the home service (linux/systemd/home.sh). It never moves the drive: the
# lease says Fly or the Mac, so the service comes up on standby. The steps it
# cannot do for you (sign-ins, the settings file) are listed at the end.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
SRC="$(dirname "$REPO")"
NAME="${1:-bryan}"
[[ $NAME =~ ^[a-z0-9-]+$ ]] || { echo "pc-setup: a drive name is lowercase letters, digits and dashes" >&2; exit 2; }
say() { printf '==> %s\n' "$*"; }
die() { printf 'pc-setup: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[[ "$(uname -s)" == Linux ]] || die "this is for the PC's Ubuntu (WSL2); on the Mac use macos/launchd/home.sh"
grep -qi microsoft /proc/version 2>/dev/null || say "note: this does not look like WSL; going on as plain Linux"
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "no builds for $(uname -m)" ;;
esac

# systemd runs the home service. WSL starts it only when /etc/wsl.conf says so.
if [[ "$(ps -p 1 -o comm= 2>/dev/null)" != systemd ]]; then
  if ! grep -qs '^[[:space:]]*systemd[[:space:]]*=[[:space:]]*true' /etc/wsl.conf; then
    say "turning on systemd in /etc/wsl.conf"
    printf '\n[boot]\nsystemd=true\n' | sudo tee -a /etc/wsl.conf >/dev/null
  fi
  echo
  echo "systemd is on from the next start of Ubuntu. In Windows (PowerShell): wsl --shutdown"
  echo "Then open Ubuntu again and run tools/pc-setup.sh $NAME once more."
  exit 0
fi

say "system packages"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl unzip python3 ca-certificates build-essential >/dev/null

# node 22.9 or later: the host and the tunnel read settings with --env-file-if-exists.
node_ok() { have node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=9)?0:1)'; }
if ! node_ok; then
  say "node 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
  node_ok || die "node $(node --version 2>/dev/null) is too old; the host needs 22.9 or later"
fi
say "node $(node --version)"

# The hub's rclone, pinned as on a sprite (tools/sprite/rclone-version, -sha256).
RCLONE="$(tr -d '[:space:]' < "$REPO/tools/sprite/rclone-version")"
mkdir -p "$HOME/.local/bin"
if [[ "$("$HOME/.local/bin/rclone" version 2>/dev/null | head -1)" != "rclone v$RCLONE" ]]; then
  say "rclone $RCLONE"
  sum="$(awk -v arch="linux-$ARCH" '$2 == arch { print $1 }' "$REPO/tools/sprite/rclone-sha256")"
  [[ -n $sum ]] || die "no pinned sha256 for rclone linux-$ARCH"
  tmp="$(mktemp -d)"
  curl -fsSL "https://downloads.rclone.org/v$RCLONE/rclone-v$RCLONE-linux-$ARCH.zip" -o "$tmp/rclone.zip"
  [[ "$(sha256sum "$tmp/rclone.zip" | awk '{ print $1 }')" == "$sum" ]] || { rm -rf "$tmp"; die "the rclone download does not match its pinned sha256"; }
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$tmp/rclone.zip" "$tmp"
  install -m 755 "$tmp/rclone-v$RCLONE-linux-$ARCH/rclone" "$HOME/.local/bin/rclone"
  rm -rf "$tmp"
fi

if ! have cloudflared; then
  say "cloudflared"
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb" -o "$tmp/cloudflared.deb"
  sudo dpkg -i "$tmp/cloudflared.deb" >/dev/null
  rm -rf "$tmp"
fi

# drive-home reaches Fly through the sprite CLI.
if ! have sprite && [[ ! -x "$HOME/.local/bin/sprite" ]]; then
  say "sprite CLI"
  curl -fsSL https://sprites.dev/install.sh | sh
fi
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *)
  grep -qs 'HOME/.local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
  export PATH="$HOME/.local/bin:$PATH" ;;
esac

# The release takes @bdhmin/marble's version from the sibling checkout.
if [[ ! -f "$SRC/marble/package.json" ]]; then
  say "cloning marble beside this checkout"
  git clone -q https://github.com/bdhmin/marble.git "$SRC/marble" || die "could not clone marble into $SRC/marble (gh auth login, then run this again)"
fi

if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
  say "lingering on, so the drive runs with no Ubuntu window open"
  sudo loginctl enable-linger "$USER"
fi

say "building a release"
"$REPO/tools/home-release.sh"
APP="$HOME/.local/share/marble-drive/app"
say "Chromium's libraries (for page previews)"
# root has no node of its own when node came from nvm: lend it this PATH.
sudo env "PATH=$PATH" "$APP/current/marble-drive/node_modules/.bin/playwright" install-deps chromium >/dev/null

say "home service for $NAME"
"$REPO/linux/systemd/home.sh" install "$NAME" || true

# What only you can do. Each line says whether it is done.
CONF="$HOME/.config/marble-drive"
mark() { if eval "$1"; then printf '  [x] %s\n' "$2"; else printf '  [ ] %s\n      %s\n' "$2" "$3"; fi; }
echo
echo "Still to do on this PC:"
mark "grep -qs '^HUB_MACHINE=pc$' '$CONF/hub-$NAME.env' && [[ -f '$CONF/pc-$NAME.env' ]]" \
  "the drive's settings ($CONF/hub-$NAME.env and pc-$NAME.env)" \
  "on the Mac: tools/home-secrets.sh pack $NAME, bring the file here, then: tools/home-secrets.sh unpack <file> $NAME"
mark "[[ -s '$HOME/.claude/.credentials.json' ]]" \
  "Claude signed in, for the drive's agents" \
  "$APP/current/marble-drive/node_modules/.bin/claude, then /login"
mark "sprite list >/dev/null 2>&1" \
  "the sprite CLI signed in, so drive-home can reach Fly" \
  "sprite org auth"
mark "[[ -f '$HOME/.cloudflared/cert.pem' ]]" \
  "cloudflared signed in to the marbledrive.app zone" \
  "cloudflared tunnel login"
echo
echo "Then (docs/HOSTING.md, \"A drive at home on the Mac or the PC\"):"
echo "  linux/systemd/home.sh restart $NAME"
echo "  linux/systemd/tunnel.sh setup $NAME pc-$NAME.marbledrive.app && linux/systemd/tunnel.sh install $NAME"
DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"
echo "  In Windows PowerShell: powershell -ExecutionPolicy Bypass -File \"\\\\wsl.localhost\\$DISTRO${REPO//\//\\}\\windows\\wsl-home.ps1\" -Distro $DISTRO -NoSleep"
echo "  Move the drive here once it is on Fly: node tools/drive-home.mjs to pc"
