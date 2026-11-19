#!/usr/bin/env bash
# Installs the Annex desktop app on Linux x64 from the newest release's AppImage, with a launcher
# entry and icons, the way Omarchy installs T3 Code. Re-running it reinstalls the newest release;
# after that the app updates itself.
#
#   curl -fsSL https://raw.githubusercontent.com/Axl47/annex/main/annex/install-linux.sh | bash
set -euo pipefail

REPO=Axl47/annex
APP_DIR="$HOME/.local/share/annex"
# The updater replaces this file in place, and keeps its name only because the name has no version.
# It is moved in last, so a failed install never leaves a launcher pointing at nothing.
APPIMAGE="$APP_DIR/Annex.AppImage"
DESKTOP_FILE="$HOME/.local/share/applications/annex.desktop"
ICON_DIR="$HOME/.local/share/icons/hicolor"

[ "$(uname -m)" = x86_64 ] || { echo "Annex's Linux app is built for x86_64 only." >&2; exit 1; }
# The AppImage mounts itself through fusermount3 at every launch.
command -v fusermount3 >/dev/null || { echo "Install fuse3 first (Arch: sudo pacman -S fuse3)." >&2; exit 1; }
for tool in curl jq openssl; do
  command -v "$tool" >/dev/null || { echo "Annex's installer needs $tool." >&2; exit 1; }
done

work=$(mktemp -d)
download="$APP_DIR/.Annex.AppImage.download"
trap 'rm -rf "$work" "$download"' EXIT

# Every Annex release is a nightly prerelease, so GitHub's "latest" release never names one.
tag=$(curl -fsSL --retry 3 "https://api.github.com/repos/$REPO/releases?per_page=30" |
  jq -r '[.[] | select((.draft | not) and any(.assets[]; .name == "nightly-linux.yml")) | .tag_name][0] // empty')
[ -n "$tag" ] || { echo "No Annex release has a Linux build yet." >&2; exit 1; }

# The feed is what the app's own updater reads, so the install starts where updates continue.
curl -fsSL --retry 3 "https://github.com/$REPO/releases/download/$tag/nightly-linux.yml" -o "$work/feed.yml"
version=$(sed -n 's/^version: *//p' "$work/feed.yml")
file=$(sed -n 's/^path: *//p' "$work/feed.yml")
sha512=$(sed -n 's/^sha512: *//p' "$work/feed.yml")
if [[ -z $version || -z $sha512 || ! $file =~ ^Annex-[A-Za-z0-9._-]+\.AppImage$ ]]; then
  echo "The release feed for $tag is not in the expected format." >&2
  exit 1
fi

echo "Downloading Annex $version..."
mkdir -p "$APP_DIR"
curl -fL --retry 3 --progress-bar "https://github.com/$REPO/releases/download/$tag/$file" -o "$download"
if [ "$(openssl dgst -sha512 -binary "$download" | base64 -w0)" != "$sha512" ]; then
  echo "The download does not match its release checksum." >&2
  exit 1
fi
chmod 755 "$download"

# The packaged entry carries the t3code:// handler that sign-in callbacks come back through.
(
  cd "$work"
  "$download" --appimage-extract t3code.desktop >/dev/null
  "$download" --appimage-extract 'usr/share/icons/hicolor/*/apps/t3code.png' >/dev/null
)
for icon in "$work"/squashfs-root/usr/share/icons/hicolor/*/apps/t3code.png; do
  size=${icon#"$work/squashfs-root/usr/share/icons/hicolor/"}
  install -Dm644 "$icon" "$ICON_DIR/${size%%/*}/apps/annex.png"
done
gtk-update-icon-cache "$ICON_DIR" &>/dev/null || true

# Exec expands %-field codes, so a literal % in the path is written as %%. The packaged Comment
# describes T3 Code, so it is dropped.
exec_path=${APPIMAGE//%/%%}
sed -e "s|^Exec=.*|Exec=\"$exec_path\" %U\nTryExec=$APPIMAGE|" -e 's|^Icon=.*|Icon=annex|' \
  -e '/^X-AppImage-Version=/d' -e '/^Comment=/d' "$work/squashfs-root/t3code.desktop" >"$work/annex.desktop"
install -Dm644 "$work/annex.desktop" "$DESKTOP_FILE"
update-desktop-database "$(dirname "$DESKTOP_FILE")" &>/dev/null || true

mv -f "$download" "$APPIMAGE"
echo "Installed Annex $version. Open it from your app launcher."
