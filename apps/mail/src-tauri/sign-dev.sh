#!/bin/bash
# Sign the development binary, then run it.
#
# macOS records permission to read a keychain item against the code signature
# of the app that asked. cargo signs a debug build ad-hoc, and that signature
# changes with every rebuild — so each build is a different app to the
# keychain, the token was stored by a build that no longer exists, and
# "Always Allow" has nothing stable to attach itself to. The result is a
# password prompt on every rebuild, and on every webview reload after it.
#
# Signing with the same Developer ID the release uses gives every build one
# designated requirement. Granting access once then holds, for this build and
# every later one.
#
# Cargo runs this for `cargo run`, which is how `tauri dev` starts the app. It
# also runs it for `cargo test`, where signing is pointless but harmless.
#
# Nothing here is required. Without the certificate — on someone else's
# machine, or in CI — the binary runs unsigned, exactly as it did before.
set -euo pipefail

BINARY="$1"
shift

IDENTITY="Developer ID Application: Reduce Digital Distraction Ltd (JD647S9RT6)"

# Read the list, then match it. Piping into `grep -q` looks tidier and is
# wrong here: grep exits at the first match, security dies on the closed pipe,
# and `pipefail` reports the whole pipeline as failed — so the identity is
# there and this says it is not.
INSTALLED="$(security find-identity -v -p codesigning 2>/dev/null || true)"

if [[ "$INSTALLED" == *"$IDENTITY"* ]]; then
  # The identifier is the release app's on purpose: one keychain grant then
  # covers the app whether it was built for development or for shipping.
  codesign --force --sign "$IDENTITY" \
    --identifier org.digitalhabits.mail \
    "$BINARY" >/dev/null 2>&1 || true
fi

exec "$BINARY" "$@"
