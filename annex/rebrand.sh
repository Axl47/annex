#!/usr/bin/env bash
# Applies Annex's identity (app name, bundle ids, link scheme, profile folder) on top of upstream.
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

# Desktop tests that assert the names above.
sub 's/T3 Code \$\{stage\}/Annex \${stage}/g; s/T3 Code \(\$\{stage\}\)/Annex (\${stage})/g; s/t3code-v2/annex/g; s/(Support|app-data)\/t3code-dev"/$1\/annex-dev"/g' \
  apps/desktop/src/app/DesktopAppIdentity.test.ts apps/desktop/src/app/DesktopUserData.test.ts \
  apps/desktop/src/app/DesktopClerk.test.ts
sub 's/Name=T3 Code \((Beta|Nightly|Dev)\)/Name=Annex ($1)/g' apps/desktop/src/app/DesktopPreReadyPlatform.test.ts
echo "rebranded"
