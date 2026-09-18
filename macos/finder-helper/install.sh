#!/bin/bash
# Build and install ~/Applications/Marble.app — Finder's owner of .mrbl files.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="$(xcrun --show-sdk-path)"
TARGET="arm64-apple-macosx14.0"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/marble-app.XXXXXX")"
APP="$STAGE/Marble.app"
DEST="${MARBLE_APP_DEST:-$HOME/Applications/Marble.app}"
CONFIG_DIR="$HOME/Library/Application Support/Marble"
DRIVE_ROOT="${MARBLE_DRIVE_ROOT:-/Users/bryanmin/Development/3rd-year-projects/marble-drive/drive}"
HOST="${MARBLE_DRIVE_HOST:-https://bryans-macbook-pro.tail3668e0.ts.net}"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> mapping tests"
swiftc -sdk "$SDK" -target "$TARGET" -parse-as-library \
  "$HERE/Mapping.swift" "$HERE/MappingTests.swift" \
  -o "$STAGE/marble-map-tests"
"$STAGE/marble-map-tests"

echo "==> compiling Marble"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/PlugIns/MarblePreview.appex/Contents/MacOS"
swiftc -sdk "$SDK" -target "$TARGET" -parse-as-library \
  -framework AppKit -framework CoreServices -framework UniformTypeIdentifiers \
  "$HERE/Mapping.swift" "$HERE/AppMain.swift" \
  -o "$APP/Contents/MacOS/Marble"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> compiling Quick Look preview"
swiftc -sdk "$SDK" -target "$TARGET" \
  -emit-executable -parse-as-library \
  -module-name MarblePreview \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -framework Foundation -framework Cocoa -framework Quartz \
  -framework UniformTypeIdentifiers -framework QuickLook \
  "$HERE/PreviewProvider.swift" \
  -o "$APP/Contents/PlugIns/MarblePreview.appex/Contents/MacOS/MarblePreview"
cp "$HERE/Preview-Info.plist" "$APP/Contents/PlugIns/MarblePreview.appex/Contents/Info.plist"
printf 'XPC!????' > "$APP/Contents/PlugIns/MarblePreview.appex/Contents/PkgInfo"

echo "==> signing"
codesign --force --sign - --entitlements "$HERE/Preview.entitlements" \
  "$APP/Contents/PlugIns/MarblePreview.appex"
codesign --force --sign - "$APP"

echo "==> installing $DEST"
mkdir -p "$(dirname "$DEST")" "$CONFIG_DIR"
rm -rf "$DEST"
cp -R "$APP" "$DEST"

if [[ ! -f "$CONFIG_DIR/finder.json" ]]; then
  python3 - <<PY
import json, os
path = os.path.expanduser("$CONFIG_DIR/finder.json")
with open(path, "w") as f:
    json.dump({"driveRoot": """$DRIVE_ROOT""", "host": """$HOST"""}, f, indent=2)
    f.write("\n")
print("wrote", path)
PY
else
  echo "keeping existing $CONFIG_DIR/finder.json"
fi

echo "==> registering .mrbl"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f -R "$DEST"
"$DEST/Contents/MacOS/Marble" --register >/dev/null 2>&1 || true
pluginkit -e use -i com.bdhmin.marble.finder.preview >/dev/null 2>&1 || true
qlmanage -r >/dev/null
qlmanage -r cache >/dev/null

echo "==> reindexing .mrbl so Spotlight picks up the new type"
find "$DRIVE_ROOT" -name '*.mrbl' -print0 2>/dev/null | xargs -0 -n 20 mdimport 2>/dev/null || true
find "$HOME/Desktop" -maxdepth 1 -name '*.mrbl' -print0 2>/dev/null | xargs -0 mdimport 2>/dev/null || true

echo
echo "Installed $DEST"
echo "Drive root: $DRIVE_ROOT"
echo "Host:       $HOST"
echo
echo "Double-click a .mrbl in Finder. Spacebar to preview."
echo "Config: $CONFIG_DIR/finder.json"
