#!/bin/bash
# ---------------------------------------------------------------------------
# Build the macOS front end.
#
# There is no Xcode project and no Swift package. The core is a C++ static
# library built by CMake; the front end is four Swift files compiled by
# swiftc; and the two are joined by a C header. That is the whole build.
#
# It is deliberately this small. A front end that needs a project file to
# build is a front end nobody will build, and the C interface means the core
# never has to know which language is calling it.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
OUT="$ROOT/frontend/build"
APP="$OUT/FCEmulator.app"

echo "==> building the core"
cmake -S "$ROOT" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release > /dev/null
cmake --build "$BUILD" --target fc_core fc_ffi > /dev/null
echo "    $BUILD/libfc_core.a"
echo "    $BUILD/libfc_ffi.a"

echo "==> compiling the front end"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

SDK="$(xcrun --show-sdk-path)"

swiftc \
    -O \
    -swift-version 6 \
    -sdk "$SDK" \
    -F "$SDK/System/Library/Frameworks" \
    -import-objc-header "$ROOT/src/ffi/emulator_api.h" \
    -I "$ROOT/src" \
    -framework AppKit \
    -framework Metal \
    -framework MetalKit \
    -framework AVFoundation \
    -framework CoreAudio \
    -framework GameController \
    -o "$APP/Contents/MacOS/FCEmulator" \
    "$ROOT/frontend/Sources"/*.swift \
    "$BUILD/libfc_ffi.a" \
    "$BUILD/libfc_core.a" \
    -lc++

echo "==> writing the bundle"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>             <string>FCEmulator</string>
    <key>CFBundleDisplayName</key>      <string>FC Emulator</string>
    <key>CFBundleIdentifier</key>       <string>dev.fcemulator.app</string>
    <key>CFBundleExecutable</key>       <string>FCEmulator</string>
    <key>CFBundlePackageType</key>      <string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1</string>
    <key>CFBundleVersion</key>          <string>1</string>
    <key>LSMinimumSystemVersion</key>   <string>13.0</string>
    <key>NSHighResolutionCapable</key>  <true/>
    <key>NSPrincipalClass</key>         <string>NSApplication</string>
</dict>
</plist>
PLIST

# An unsigned bundle will not launch on Apple silicon unless the linker
# signature is at least present, so sign it ad hoc.
codesign --force --sign - "$APP" 2>/dev/null || true

echo "==> done"
echo "    $APP"
echo
echo "run it:"
echo "    open $APP --args /path/to/game.nes"
echo "or headless:"
echo "    $APP/Contents/MacOS/FCEmulator /path/to/game.nes --headless 400 --dump frame.ppm"
