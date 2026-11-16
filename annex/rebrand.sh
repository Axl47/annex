#!/usr/bin/env bash
# Applies Annex's identity (app name, bundle ids, link scheme, profile folder, icons, README) on top of upstream.
# Idempotent: the nightly rebase drops the old "rebrand" commit, re-runs this, and commits the result,
# so branding never needs manual conflict resolution. Internal identifiers (@t3tools/*, T3CODE_*, ~/.t3) stay.
set -euo pipefail
cd "$(dirname "$0")/.."

sub() { perl -0pi -e "$1" "${@:2}"; }

# Desktop: product name, app ids, artifact names.
sub 's/"productName": "T3 Code \(Beta\)"/"productName": "Annex"/' apps/desktop/package.json
sub 's/const DESKTOP_APP_ID = "com\.t3tools\.t3code";/const DESKTOP_APP_ID = "dev.axl47.annex";/;
     s/\? "T3 Code \(Nightly\)"/? "Annex (Nightly)"/;
     s/"T3-Code-\$\{version\}-\$\{arch\}\.\$\{ext\}"/"Annex-\${version}-\${arch}.\${ext}"/' scripts/build-desktop-artifact.ts
sub 's/const APP_BASE_NAME = "T3 Code";/const APP_BASE_NAME = "Annex";/;
     s/"com\.t3tools\.t3code\.dev" : "com\.t3tools\.t3code"/"dev.axl47.annex.dev" : "dev.axl47.annex"/' apps/desktop/src/app/DesktopEnvironment.ts
# Desktop: Electron profile folder. The t3code:// scheme stays so T3 Connect sign-in callbacks still
# reach the app, and legacy profile names stay upstream's so Windows keeps migrating credential keys.
sub 's/current: "t3code-dev",/current: "annex-dev",/; s/current: "t3code-v2",/current: "annex",/' apps/desktop/src/app/DesktopUserData.ts

# Mobile: production variant identity; upstream OTA updates target the official app, so they stay off.
sub 's/appName: "T3 Code",\n(\s*)scheme: "t3code",\n(\s*)iosBundleIdentifier: "com\.t3tools\.t3code",\n(\s*)androidPackage: "com\.t3tools\.t3code",/appName: "Annex",\n$1scheme: "annex",\n$2iosBundleIdentifier: "dev.axl47.annex",\n$3androidPackage: "dev.axl47.annex",/;
     s/enabled: repoEnv\.T3CODE_MOBILE_UPDATES_ENABLED !== "0",/enabled: false,/' apps/mobile/app.config.ts
# app.t3.codes only lists T3's own app ids for thread links, so production rows can't pass for Annex.
sub 's/\n  \[(undefined|"production"), "com\.t3tools\.t3code"\],//g' apps/mobile/app.config.test.ts

# Web + mobile wordmark: the "T3" glyph becomes a bold "A", and the muted "Code" beside it becomes "nnex",
# so the brand reads "Annex" with the A as the mark (also used alone as the timeline icon).
A_PATH='M0 57L21 0H39L60 57H45.5L41.6 45H18.4L14.5 57H0ZM22.2 33.5H37.8L30 9.5L22.2 33.5Z'
for f in apps/web/src/components/T3Wordmark.tsx apps/mobile/src/components/T3Wordmark.tsx; do
  A_PATH="$A_PATH" perl -0pi -e 's/viewBox="15\.5309 37 94\.3941 56\.96"/viewBox="0 0 60 57"/; s/d="M33\.4509[^"]*"/d="$ENV{A_PATH}"/; s/94\.3941 \/ 56\.96/60 \/ 57/; s/accessibilityLabel="T3"/accessibilityLabel="Annex"/' "$f"
done
sub 's/<T3Wordmark aria-label="T3"/<T3Wordmark aria-label="Annex"/; s/items-baseline gap-1 text-sm/items-baseline gap-px text-sm/; s/>\n(\s*)Code\n(\s*)<\/span>/>\n$1nnex\n$2<\/span>/' \
  apps/web/src/components/sidebar/SidebarChrome.tsx
sub 's/"T3 Code, Threads"/"Annex, Threads"/; s/className="flex-row items-center gap-1\.5"/className="flex-row items-center gap-px"/; s/\{ gap: 5\.25 \* scale \}/{ gap: 1 * scale }/; s/>\n(\s*)Code\n(\s*)<\/Text>/>\n$1nnex\n$2<\/Text>/' \
  apps/mobile/src/components/CompactBrandTitle.tsx

# Servers update from Annex's releases: `t3 update`, remote updates, and the install scripts.
sub 's/const CLI_RELEASE_REPOSITORY = "pingdotgg\/t3code";/const CLI_RELEASE_REPOSITORY = "Axl47\/annex";/' packages/shared/src/cliRelease.ts
sub 's/"\/repos\/pingdotgg\/t3code\/releases"/"\/repos\/Axl47\/annex\/releases"/' apps/server/src/cli/update.test.ts
sub 's/pingdotgg\/t3code\/releases/Axl47\/annex\/releases/g' apps/mobile/src/features/settings/environment-maintenance.test.ts
sub 's/^repo="pingdotgg\/t3code"/repo="Axl47\/annex"/m' scripts/install.sh
sub 's/^\$repo = "pingdotgg\/t3code"/\$repo = "Axl47\/annex"/m' scripts/install.ps1

# Upstream's workflows target pingdotgg's runners and secrets; the fork runs only its own annex-* ones.
find .github/workflows -type f ! -name 'annex-*' -delete

# App icons, rendered by annex/icons/generate.mjs, replace T3's on both desktop channels, the web
# client, and Android. Copies fail if upstream renames a target, rather than adding stray files.
icon() { [ -f "$2" ] || { echo "rebrand: icon target $2 is gone; update annex/rebrand.sh" >&2; exit 1; }; cp "annex/icons/out/$1" "$2"; }
for f in ios-1024.png macos-1024.png universal-1024.png; do
  icon "$f" "assets/nightly/nightly-$f"
  icon "$f" "assets/prod/black-$f"
done
for f in windows.ico web-favicon.ico web-favicon-16x16.png web-favicon-32x32.png web-apple-touch-180.png web-icon-192x192.png web-icon-512x512.png; do
  icon "$f" "assets/nightly/nightly-$f"
  icon "$f" "assets/prod/t3-black-$f"
done
icon web-favicon.ico apps/web/public/favicon.ico
icon web-favicon-16x16.png apps/web/public/favicon-16x16.png
icon web-favicon-32x32.png apps/web/public/favicon-32x32.png
icon web-apple-touch-180.png apps/web/public/apple-touch-icon.png
icon web-icon-192x192.png apps/web/public/icon-192x192.png
icon web-icon-512x512.png apps/web/public/icon-512x512.png
for f in android-icon-foreground.png android-icon-mark.png android-notification-icon.png; do icon "$f" "apps/mobile/assets/$f"; done
icon android-splash-icon.png apps/mobile/assets/android-splash-icon-prod.png
# Android adaptive icon and splash background for the production variant: the icon's navy.
sub 's/(const RELEASE_ASSETS = \{.*?androidAdaptiveBackgroundColor: )"#000000"/$1"#0b1222"/s' apps/mobile/app.config.ts

# Docs: the fork's own README, and its Fork section appended to upstream's agent instructions.
cp annex/README.md README.md
sub 's/\n## Fork\n.*//s' AGENTS.md
printf '\n' >> AGENTS.md && cat annex/AGENTS.md >> AGENTS.md

# Desktop tests that assert the names above.
sub 's/T3 Code \$\{stage\}/Annex \${stage}/g; s/T3 Code \(\$\{stage\}\)/Annex (\${stage})/g; s/t3code-v2/annex/g; s/(Support|app-data)\/t3code-dev"/$1\/annex-dev"/g' \
  apps/desktop/src/app/DesktopAppIdentity.test.ts apps/desktop/src/app/DesktopUserData.test.ts \
  apps/desktop/src/app/DesktopClerk.test.ts
sub 's/Name=T3 Code \((Beta|Nightly|Dev)\)/Name=Annex ($1)/g' apps/desktop/src/app/DesktopPreReadyPlatform.test.ts
# Fail loudly if upstream moved a line a substitution targets, instead of silently shipping T3 branding.
expect() { grep -qF -- "$2" "$1" || { echo "rebrand: '$2' missing from $1; update annex/rebrand.sh" >&2; exit 1; }; }
expect apps/desktop/package.json '"productName": "Annex"'
expect scripts/build-desktop-artifact.ts 'const DESKTOP_APP_ID = "dev.axl47.annex";'
expect apps/desktop/src/app/DesktopEnvironment.ts 'const APP_BASE_NAME = "Annex";'
expect apps/desktop/src/app/DesktopEnvironment.ts '"dev.axl47.annex.dev" : "dev.axl47.annex"'
expect apps/desktop/src/app/DesktopUserData.ts 'current: "annex",'
expect apps/mobile/app.config.ts 'androidPackage: "dev.axl47.annex",'
expect apps/mobile/app.config.ts 'enabled: false,'
expect apps/mobile/app.config.ts 'androidAdaptiveBackgroundColor: "#0b1222",'
expect apps/web/src/components/T3Wordmark.tsx 'viewBox="0 0 60 57"'
expect apps/mobile/src/components/T3Wordmark.tsx 'viewBox="0 0 60 57"'
expect apps/web/src/components/sidebar/SidebarChrome.tsx 'nnex'
expect apps/mobile/src/components/CompactBrandTitle.tsx 'nnex'
expect packages/shared/src/cliRelease.ts 'const CLI_RELEASE_REPOSITORY = "Axl47/annex";'
expect apps/mobile/src/features/settings/environment-maintenance.test.ts '"https://github.com/Axl47/annex/releases.atom"'
expect scripts/install.sh 'repo="Axl47/annex"'
echo "rebranded"
