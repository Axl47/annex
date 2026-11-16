#!/usr/bin/env bash
# Re-signs an unsigned macOS build zip with the local "Annex Self-Signed" certificate, rewrites the
# zip in place, and writes release/nightly-mac.yml (the updater manifest) for the signed bytes.
#
#   annex/sign-mac.sh <zip> <version>
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

zip=${1:?usage: annex/sign-mac.sh <zip> <version>}
version=${2:?missing version}
KEYCHAIN="$HOME/Library/Keychains/annex-signing.keychain-db"
IDENTITY="Annex Self-Signed"

password=$(security find-generic-password -a "$USER" -s annex-signing-keychain -w)
security unlock-keychain -p "$password" "$KEYCHAIN"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ditto -x -k "$zip" "$work"
app=$(ls -d "$work"/*.app)

codesign --force --deep --sign "$IDENTITY" --keychain "$KEYCHAIN" "$app"
codesign --verify --deep "$app"

rm -f "$zip" "$zip.blockmap"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"

# The builder's manifest hashes the unsigned zip; the updater would reject the signed one.
name=$(basename "$zip")
sha512=$(openssl dgst -sha512 -binary "$zip" | base64)
size=$(stat -f %z "$zip")
cat > "$(dirname "$zip")/nightly-mac.yml" <<YML
version: $version
files:
  - url: $name
    sha512: $sha512
    size: $size
path: $name
sha512: $sha512
releaseDate: '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'
YML
rm -f "$(dirname "$zip")"/latest-mac.yml
echo "signed $zip"
