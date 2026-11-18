#!/usr/bin/env bash
# Prints the highlights of every upstream T3 Code release that landed between two commits, as
# Markdown for Annex release notes and sync reports. Each commit may be an Annex or an upstream
# commit; both are reduced to the upstream commit they sit on. Prints nothing when none landed.
#
# Usage: annex/upstream-highlights.sh <from> [<to>=HEAD]
set -euo pipefail
cd "$(dirname "$0")/.."

UPSTREAM_REPO=pingdotgg/t3code
[ $# -ge 1 ] || { echo "usage: $0 <from> [<to>]" >&2; exit 64; }
git fetch -q upstream main
from=$(git merge-base "$1" upstream/main)
to=$(git merge-base "${2:-HEAD}" upstream/main)
since=$(git log -1 --format=%ct "$from")

# A release is published after the commit it tags, so older ones can't be in range.
tags=()
while read -r tag; do
  sha=$(gh api "repos/$UPSTREAM_REPO/commits/$tag" -q .sha </dev/null 2>/dev/null) || continue
  git merge-base --is-ancestor "$sha" "$to" 2>/dev/null || continue
  ! git merge-base --is-ancestor "$sha" "$from" 2>/dev/null || continue
  tags+=("$tag")
done < <(gh release list --repo "$UPSTREAM_REPO" --exclude-drafts -L 100 --json tagName,publishedAt \
  -q ".[] | select((.publishedAt | fromdateiso8601) >= $since) | .tagName")
[ ${#tags[@]} -gt 0 ] || exit 0

highlights="" index=""
for tag in "${tags[@]}"; do
  body=$(gh release view "$tag" --repo "$UPSTREAM_REPO" --json body -q .body | tr -d '\r')
  # Upstream's generated notes open with "**<tag>** · <stats>", then highlight bullets, then
  # "### Plus N more ..." and the full changelog folded under <details>.
  stats=$(printf '%s\n' "$body" | sed -n '1s/^\*\*[^*]*\*\* · //p')
  highlights+=$(printf '%s\n' "$body" | awk '/^(### |<details>)/ { exit } /^- / { print }')$'\n'
  index+="- [$tag](https://github.com/$UPSTREAM_REPO/releases/tag/$tag)${stats:+ · $stats}"$'\n'
done

# Stable releases repeat the highlights of the nightlies they roll up.
printf '%s' "$highlights" | awk 'NF && !seen[$0]++'
printf '\n<details>\n<summary>Full changelog</summary>\n\nUpstream T3 Code releases in this update:\n\n%s</details>\n' "$index"
