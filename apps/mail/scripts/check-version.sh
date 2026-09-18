#!/bin/bash
# Check that everything agrees about which version this is.
#
# The number lives in package.json. Both Tauri configs read it from there
# ("version": "../package.json"), so the app and the DMG cannot drift from it.
# The crate version cannot be read from a file, so it is kept in step here
# instead — it does not reach the app, but a stale one in the repo misleads
# the next person to look.
#
# A release is tagged mail-v<version>. When HEAD carries such a tag it must
# name this version. An untagged build is an ordinary development build and
# only says so.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "check-version: $1" >&2
  exit 1
}

PKG=$(node -p "require('./package.json').version")
[ -n "$PKG" ] || fail "package.json has no version"

CARGO=$(grep -m1 '^version = ' src-tauri/Cargo.toml | sed 's/.*"\(.*\)".*/\1/')
if [ "$CARGO" != "$PKG" ]; then
  fail "package.json says $PKG, src-tauri/Cargo.toml says $CARGO"
fi

# The config must take the number from package.json rather than hold one.
for conf in src-tauri/tauri.conf.json; do
  IN_CONF=$(node -p "require('./$conf').version ?? ''")
  if [ "$IN_CONF" != "../package.json" ]; then
    fail "$conf should read \"../package.json\", not \"$IN_CONF\""
  fi
done

TAG=$(git tag --points-at HEAD 2>/dev/null | grep '^mail-v' | head -1 || true)
if [ -n "$TAG" ]; then
  if [ "$TAG" != "mail-v$PKG" ]; then
    fail "this commit is tagged $TAG, but the version is $PKG"
  fi
  echo "check-version: $PKG, tagged $TAG"
else
  echo "check-version: $PKG (no release tag on this commit)"
fi
