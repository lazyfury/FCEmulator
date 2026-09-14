#!/usr/bin/env bash
#
# ---------------------------------------------------------------------------
# Build the native gamepad helper.
#
#   pnpm run build:native
#
# Swift Package Manager builds into .build/release, which is a fine place for
# a build directory and a bad place to point a spawn() at: the path depends on
# the Swift version and the configuration, and a packaged application will not
# have a .build at all. So the binary is copied to a fixed path,
# native/bin/fc-gamepad, and that is what the main process looks for.
#
# Nothing here is needed to run the tests or the emulator. If the binary is
# absent, the gamepad source simply does not start -- and says so, because a
# gamepad that silently does nothing is the failure this file exists to
# prevent.
# ---------------------------------------------------------------------------

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v swift >/dev/null 2>&1; then
    echo "swift not found: install the Xcode command line tools (xcode-select --install)" >&2
    exit 1
fi

echo "[native] building fc-gamepad"
swift build \
    --package-path "$here/gamepad" \
    -c release

mkdir -p "$here/bin"
cp "$here/gamepad/.build/release/fc-gamepad" "$here/bin/fc-gamepad"
echo "[native] wrote $here/bin/fc-gamepad"
