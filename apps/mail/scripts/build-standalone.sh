#!/bin/bash
# Build the standalone Mail app: signed, and notarized when the credentials are
# there.
#
#   ./scripts/build-standalone.sh                  -> Digital Habits Mail
#   MAIL_DEMO=1 ./scripts/build-standalone.sh      -> Digital Habits Mail (Demo)
#
# The demo is the public app with the invented mailbox (VITE_MAIL_DEMO): it
# signs in to nothing and stores nothing. It has its own name and identifier,
# so it never stands in for the real app.
#
# Another flavor of the app is built from a file of its own beside its code,
# src/<flavor>/build-flavor.sh, chosen with MAIL_FLAVOR=<flavor>. That file
# sets the name, the config and the updater. A source without such a file
# builds the public app, which is the one that goes to anybody.
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
# which one it reads back to notarize. A flavor with no file of its own is the
# public app, so a typo builds the app that is safe to hand out.
FLAVOR="${MAIL_FLAVOR:-public}"
FLAVOR_FILE=""
case "$FLAVOR" in
  *[!a-z]* | public) ;;
  *) [ -f "src/$FLAVOR/build-flavor.sh" ] && FLAVOR_FILE="src/$FLAVOR/build-flavor.sh" ;;
esac
PRODUCT="Digital Habits Mail"
# Word-split on purpose: empty adds no argument, and the path has no spaces.
CONFIG_ARG=""
FLAVOR_KEYCHAIN_CONFIG=""
if [ -n "$FLAVOR_FILE" ]; then
  # shellcheck source=/dev/null
  . "$FLAVOR_FILE"
fi
DEMO="${MAIL_DEMO:-}"
if [ "$DEMO" = "1" ]; then
  [ -n "$FLAVOR_FILE" ] && { echo "The demo is built from the public flavor only." >&2; exit 1; }
  PRODUCT="Digital Habits Mail (Demo)"
  CONFIG_ARG="--config src-tauri/tauri.demo.conf.json"
  export VITE_MAIL_DEMO=1
fi

# With a provisioning profile beside the config, the build carries the
# keychain-access-groups entitlement and its tokens go to the data-protection
# keychain, which never asks the user. Without one it must not claim the
# entitlement: macOS kills an app that claims it with no profile to back it.
# The profile is per identifier, so the flavor picks the overlay.
# The demo stores no tokens, and has no profile for its identifier.
if [ "$DEMO" = "1" ]; then
  echo "Demo: no keychain entitlement."
elif [ -f src-tauri/embedded.provisionprofile ]; then
  if [ -n "$FLAVOR_KEYCHAIN_CONFIG" ]; then
    CONFIG_ARG="$CONFIG_ARG --config $FLAVOR_KEYCHAIN_CONFIG"
  else
    CONFIG_ARG="$CONFIG_ARG --config src-tauri/tauri.keychain.conf.json"
  fi
  echo "Provisioning profile found: building with the keychain entitlement."
else
  echo "No src-tauri/embedded.provisionprofile: tokens stay in the login keychain." >&2
fi

# The app updates itself. The public app's disk image asks the public GitHub
# release, and its update file is signed with the public Mail updater key:
# TAURI_SIGNING_PRIVATE_KEY in the Build workflow, or
# ~/.tauri/dh-mail-updater.key (and its .password) on a Mac. Another flavor's
# file says how it updates. The demo has no updater. A store package is not
# built here, and must never have one.
FEATURE_ARG=""
if [ -z "$FLAVOR_FILE" ] && [ "$DEMO" != "1" ]; then
  # The key the app checks updates against. Empty means nobody has made the
  # key yet, and an app built so would refuse every update it found.
  PUBKEY=$(node -p "require('./src-tauri/tauri.public-updater.conf.json').plugins.updater.pubkey")
  if [ -z "$PUBKEY" ]; then
    echo "src-tauri/tauri.public-updater.conf.json has no public key. Make the" >&2
    echo "public Mail updater key first (see the README, \"Updates\")." >&2
    exit 1
  fi
  FEATURE_ARG="--features public-updater"
  CONFIG_ARG="$CONFIG_ARG --config src-tauri/tauri.public-updater.conf.json"
  PUBLIC_KEY_FILE="${DH_MAIL_UPDATER_KEY:-$HOME/.tauri/dh-mail-updater.key}"
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$PUBLIC_KEY_FILE" ]; then
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$PUBLIC_KEY_FILE")"
    export TAURI_SIGNING_PRIVATE_KEY
    if [ -f "$PUBLIC_KEY_FILE.password" ]; then
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$PUBLIC_KEY_FILE.password")"
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    fi
  fi
  if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    CONFIG_ARG="$CONFIG_ARG --config src-tauri/tauri.updater.conf.json"
  elif [ -n "${CI:-}" ]; then
    # A release with no update file reaches nobody who already has the app.
    echo "No TAURI_SIGNING_PRIVATE_KEY: a release build must make an update file." >&2
    exit 1
  else
    echo "No public Mail updater key at $PUBLIC_KEY_FILE: this build makes no update file." >&2
  fi
fi
if [ -n "$FLAVOR_FILE" ] && [ "$DEMO" != "1" ]; then
  flavor_updater
fi

BUILD_TARGET="${BUILD_MAC_TARGET:-universal-apple-darwin}"

# Universal needs both Rust targets installed.
if [ "$BUILD_TARGET" = "universal-apple-darwin" ]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
fi

echo "Building ${PRODUCT} (${BUILD_TARGET})..."

pnpm ui:build
pnpm tauri build --target "$BUILD_TARGET" $CONFIG_ARG $FEATURE_ARG

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
# is the only one left there: building another flavor destroyed the public
# image that had just been notarized, stapled and checksummed. Naming the two apart
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

# The update file, out of target/ and named by version. It sits beside the
# .app, which sits beside the dmg directory. The public one goes into the
# GitHub release, so its name has no spaces: GitHub would change them.
# Another flavor's file names its own.
if [ -n "$FEATURE_ARG" ]; then
  APP_DIR="$(dirname "$(dirname "$DMG")")/macos"
  UPDATE_FILE="$APP_DIR/${PRODUCT}.app.tar.gz"
  if [ -f "$UPDATE_FILE" ] && [ -f "$UPDATE_FILE.sig" ]; then
    if [ -n "$FLAVOR_FILE" ]; then
      UPDATE_OUT="$(flavor_update_out)"
    else
      UPDATE_OUT="for-distribution/Digital-Habits-Mail_${PKG}_${BUILD_TARGET%%-*}.app.tar.gz"
    fi
    mkdir -p for-distribution
    cp -p "$UPDATE_FILE" "$UPDATE_OUT"
    cp -p "$UPDATE_FILE.sig" "$UPDATE_OUT.sig"
    echo "Update file: apps/mail/$UPDATE_OUT"
    if [ -n "$FLAVOR_FILE" ]; then
      flavor_update_done
    fi
  else
    echo "No update file was made (no updater key?)." >&2
    # In the Build workflow that is a release nobody gets as an update.
    if [ -n "${CI:-}" ]; then exit 1; fi
  fi
fi
