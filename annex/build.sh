#!/usr/bin/env bash
# Builds one Annex release artifact with the release configuration. Used locally (macOS) and in CI.
#
#   annex/build.sh version            print a fresh release version
#   annex/build.sh mac    <version>   signed macOS arm64 zip + nightly-mac.yml   -> release/
#                                     (no DMG: it would hold the unsigned app; first install is the zip)
#   annex/build.sh win    <version>   Windows x64 installer + nightly.yml       -> release/
#   annex/build.sh cli    <version>   t3 CLI archive for this Linux/x64 host    -> release-cli/
#
# Versions follow upstream's nightly shape, <next patch>-nightly.<UTC date>.<n>, so Annex stays on
# the Nightly track. n = 1000000 + seconds since UTC midnight: monotonic within a day and above
# upstream's same-day run numbers, so servers on upstream builds never look newer.
#
# Package versions are rewritten for the build; run from a throwaway checkout (annex/release.sh
# uses a worktree, CI uses its fresh clone).
set -euo pipefail
cd "$(dirname "$0")/.."

next_version() {
  local base major minor patch
  base=$(node -p 'require("./apps/server/package.json").version')
  IFS=. read -r major minor patch <<<"${base%%-*}"
  echo "$major.$minor.$((patch + 1))-nightly.$(date -u +%Y%m%d).$((1000000 + $(date -u +%s) % 86400))"
}

cmd=${1:?usage: annex/build.sh version|mac|win|cli [version]}
if [ "$cmd" = version ]; then next_version; exit 0; fi
version=${2:?missing version}

set -a
# shellcheck disable=SC1091
source annex/release.env
set +a

node scripts/update-release-package-versions.ts "$version"

case "$cmd" in
  mac)
    node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version "$version"
    ./annex/sign-mac.sh "release/Annex-$version-arm64.zip" "$version"
    ;;
  win)
    node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64 --build-version "$version"
    ;;
  cli)
    cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml
    monitor="$(mktemp -d)/linux-x64"
    mkdir -p "$monitor"
    cp native/resource-monitor/target/release/t3-resource-monitor "$monitor/"
    # The archive ships the built server and web client; brand the client like desktop builds do.
    vp run --filter t3 build
    node scripts/apply-web-brand-assets.ts nightly apps/server/dist/client
    node apps/server/scripts/cli.ts build-exe
    node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$version" \
      --resource-monitor-dir "$(dirname "$monitor")" --output-dir release-cli
    ;;
  *) echo "unknown command: $cmd" >&2; exit 64 ;;
esac
