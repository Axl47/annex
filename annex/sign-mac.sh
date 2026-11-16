#!/usr/bin/env bash
# Re-signs the unsigned macOS build (release/Annex-*-arm64.zip) with the local "Annex Self-Signed"
# certificate and rewrites the zip in place.
#
# Why: macOS ties privacy permissions (Screen Recording, Accessibility, ...) and the updater's
# same-identity check to the code signature. Ad-hoc signatures change every build; a fixed
# certificate gives every build the same identity, so permissions survive updates.
#
# Setup (once per Mac): the certificate lives in ~/Library/Keychains/annex-signing.keychain-db,
# whose password is in the login keychain as the generic password "annex-signing-keychain".
# Losing that keychain means a new certificate, and macOS asks for permissions once more.
set -euo pipefail
cd "$(dirname "$0")/.."

KEYCHAIN="$HOME/Library/Keychains/annex-signing.keychain-db"
IDENTITY="Annex Self-Signed"

zip=$(ls -t release/Annex-*-arm64.zip | head -1)
password=$(security find-generic-password -a "$USER" -s annex-signing-keychain -w)
security unlock-keychain -p "$password" "$KEYCHAIN"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ditto -x -k "$zip" "$work"
app="$work/Annex.app"

codesign --force --deep --sign "$IDENTITY" --keychain "$KEYCHAIN" "$app"
codesign --verify --deep "$app"

rm -f "$zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
echo "signed $zip"
codesign -dr - "$app" 2>&1 | grep designated
