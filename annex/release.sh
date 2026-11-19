#!/usr/bin/env bash
# Publishes an Annex release for origin/main. Run by the nightly task after a successful sync.
#
# Builds and signs the macOS app here (the signing certificate never leaves this Mac), drafts the
# GitHub release with it, then starts the annex-release workflow, which adds the Windows installer,
# the Linux AppImage and t3 CLI archive, and the Android APK, and publishes the release.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=Axl47/annex
git fetch -q origin main
sha=$(git rev-parse origin/main)

# Builds rewrite package versions, so they run in a throwaway worktree, never the main checkout.
wt="$(git rev-parse --git-common-dir)/annex-release"
git worktree remove --force "$wt" 2>/dev/null || true
git worktree add -q --detach "$wt" "$sha"
trap 'git worktree remove --force "$wt"' EXIT
cd "$wt"

# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" >/dev/null
nvm use "$(node -p 'require("./package.json").engines.node')" >/dev/null
pnpm install --frozen-lockfile --silent
export PATH="$PWD/node_modules/.bin:$PATH"

version=$(./annex/build.sh version)
./annex/build.sh mac "$version"

upstream=$(git log -1 --format='%h %s' "$(git merge-base HEAD "$(git rev-parse --verify -q upstream/main || echo HEAD)")")
notes="$(git rev-parse --git-common-dir)/annex-release-notes.md"
echo "Annex on top of upstream \`$upstream\`." > "$notes"
previous=$(gh release list --repo "$REPO" --exclude-drafts -L 1 --json tagName -q '.[0].tagName')
if [ -n "$previous" ] && git fetch -q origin tag "$previous" &&
  highlights=$(./annex/upstream-highlights.sh "$previous" HEAD); then
  [ -z "$highlights" ] || printf '\n%s\n' "$highlights" >> "$notes"
else
  echo "warning: no upstream highlights since ${previous:-the first release}" >&2
fi
gh release create "v$version" --repo "$REPO" --draft --prerelease --target "$sha" \
  --title "Annex $version" \
  --notes-file "$notes" \
  "release/Annex-$version-arm64.zip" release/nightly-mac.yml
gh workflow run annex-release.yml --repo "$REPO" --ref main -f version="$version" -f ref="$sha"
echo "drafted v$version; annex-release adds Windows, Linux and Android, then publishes it"
