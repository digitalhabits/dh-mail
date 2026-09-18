#!/bin/bash
# Build the standalone Mail app: signed, and notarized when the credentials are
# there.
#
# Two flavors come out of this script, and they must never be mistaken for one
# another:
#
#   ./scripts/build-standalone.sh                  -> Digital Habits Mail
#   MAIL_FLAVOR=internal ./scripts/build-standalone.sh
#                                                  -> Digital Habits Mail (Internal)
#
# The public app is the one that goes to anybody. The internal app carries the
# team layer — the CRM, the org AI keys — and reads the planner. It is named
# "(Internal)" in the Dock, in About, and in the name of its own disk image, so
# the file itself says what it is before anyone opens it, and so a hand reaching
# for one image cannot pick up the other. Its identifier differs too, which both
# lets the two sit side by side and keeps the team's mail out of the public
# app's store.
#
# Default target is universal-apple-darwin (arm64 + x86_64), same as Blocker,
# so one DMG works on Apple silicon and Intel Macs. Override with:
#   BUILD_MAC_TARGET=aarch64-apple-darwin ./scripts/build-standalone.sh
#
# The Apple credentials live in .env.local, which git ignores. Vite reads that
# file for its own VITE_ variables, but `tauri build` reads the process
# environment, so they have to be put there. Only the three Apple names are
# taken: everything else in that file belongs to the Next build, and a value
# with a space in it would break the shell.
#
# Without them the build still signs. macOS then refuses to open the app on any
# machine except the one that built it, so a build meant for anyone else must
# have them.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a
  eval "$(grep -E '^APPLE_(ID|TEAM_ID|PASSWORD)=' .env.local || true)"
  set +a
fi

if [ -z "${APPLE_PASSWORD:-}" ]; then
  echo "No APPLE_PASSWORD in apps/mail/.env.local — this build will not be" >&2
  echo "notarized, and will not open on another Mac. See the README." >&2
fi

# Nothing that goes out should disagree with itself about what it is.
./scripts/check-version.sh

# The flavor decides the name, so it decides which image this build writes and
# which one it reads back to notarize. Anything but "internal" is the public
# app, so a typo builds the app that is safe to hand out.
FLAVOR="${MAIL_FLAVOR:-public}"
if [ "$FLAVOR" = "internal" ]; then
  PRODUCT="Digital Habits Mail (Internal)"
  # Word-split on purpose: empty adds no argument, and the path has no spaces.
  CONFIG_ARG="--config src-tauri/tauri.internal.conf.json"
else
  PRODUCT="Digital Habits Mail"
  CONFIG_ARG=""
fi

# With a provisioning profile beside the config, the build carries the
# keychain-access-groups entitlement and its tokens go to the data-protection
# keychain, which never asks the user. Without one it must not claim the
# entitlement: macOS kills an app that claims it with no profile to back it.
# The profile is per identifier, so the flavor picks the overlay.
if [ -f src-tauri/embedded.provisionprofile ]; then
  if [ "$FLAVOR" = "internal" ]; then
    CONFIG_ARG="$CONFIG_ARG --config src-tauri/tauri.keychain.internal.conf.json"
  else
    CONFIG_ARG="$CONFIG_ARG --config src-tauri/tauri.keychain.conf.json"
  fi
  echo "Provisioning profile found: building with the keychain entitlement."
else
  echo "No src-tauri/embedded.provisionprofile: tokens stay in the login keychain." >&2
fi

BUILD_TARGET="${BUILD_MAC_TARGET:-universal-apple-darwin}"

# Universal needs both Rust targets installed.
if [ "$BUILD_TARGET" = "universal-apple-darwin" ]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
fi

echo "Building ${PRODUCT} (${BUILD_TARGET})..."

pnpm ui:build
pnpm tauri build --target "$BUILD_TARGET" $CONFIG_ARG

# Notarize the disk image as well.
#
# Tauri notarizes the .app and then builds the .dmg around it, so the image
# itself carries no ticket. Gatekeeper judges what the user opens, and what
# they open is the image: "spctl -a -t install" rejects it, and macOS refuses
# to mount it on any machine that did not build it. The app inside being
# notarized does not help, because nobody gets that far.
#
# Universal builds land under target/<triple>/release/bundle/; single-arch
# host builds under target/release/bundle/.
# Copy the finished image out of target/, the way the Windows build does.
#
# Tauri empties the bundle's dmg directory before it writes, so the last build
# is the only one left there: building the team app destroyed the public image
# that had just been notarized, stapled and checksummed. Naming the two apart
# does not save them, because nothing of the other is left to confuse. Both
# images live here instead, side by side, each keeping the ticket stapled into
# it.
keep_for_distribution() {
  mkdir -p for-distribution
  cp -p "$1" "$1.sha256" for-distribution/
  echo "Kept: for-distribution/$(basename "$1")"
}

# This version, by name. `ls -t` on `${PRODUCT}_*.dmg` picks the leftover
# from the last release when Cargo writes the new image somewhere else —
# which is how 0.8.0 notarized 0.7.21. The crate target dir is first: the
# Cursor sandbox (and some CI) set CARGO_TARGET_DIR away from src-tauri.
PKG=$(node -p "require('./package.json').version")
DMG=""
for dir in \
  "${CARGO_TARGET_DIR:-}/${BUILD_TARGET}/release/bundle/dmg" \
  "src-tauri/target/${BUILD_TARGET}/release/bundle/dmg" \
  "src-tauri/target/release/bundle/dmg"
do
  [ -d "$dir" ] || continue
  found=$(ls "$dir/${PRODUCT}_${PKG}_"*.dmg 2>/dev/null | head -1 || true)
  if [ -n "$found" ]; then
    DMG=$found
    break
  fi
done
if [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${DMG:-}" ]; then
  echo "Notarizing $(basename "$DMG")"
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
    --wait
  # Stapling puts the ticket in the file, so it opens with no network.
  xcrun stapler staple "$DMG"
  spctl -a -vvv -t install "$DMG"
  # The checksum goes out with the image. Notarization says Apple has seen
  # the build; this says the file somebody downloaded is that build.
  shasum -a 256 "$DMG" | tee "$DMG.sha256"
  keep_for_distribution "$DMG"
elif [ -n "${DMG:-}" ]; then
  echo "Built (unsigned notarization skipped): $DMG"
else
  echo "Build finished, but no .dmg was found for ${PRODUCT}." >&2
  exit 1
fi
