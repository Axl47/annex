# Changelog

What Annex adds to or changes from [T3 Code](https://github.com/pingdotgg/t3code). Upstream changes are not listed here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Annex releases reuse upstream's version numbers with a later nightly build number, so a release includes every upstream change up to the version it is based on.

## [Unreleased]

### Added

- The app is called Annex, with an "A" wordmark in the sidebar on desktop, web, and phone.
- A new app icon, an "A" with a blue crossbar, on macOS, Windows, the web client, and Android.
- The desktop app updates itself from Annex's releases.
- macOS keeps granted permissions, such as screen recording, across Annex updates.
- `t3 update` and remote server updates install Annex's server builds.
- The Android app installs alongside the official T3 Code app and updates from Annex's signed APKs.

### Changed

- The Android app no longer downloads over-the-air updates meant for the official app.
- Thread links from app.t3.codes open in the official T3 Code app, not in Annex on Android.
