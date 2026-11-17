<p align="center">
  <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="Annex logo" />
</p>

<h1 align="center">Annex</h1>

Annex is a personal, experimental fork of [T3 Code](https://github.com/pingdotgg/t3code), the open-source control plane for coding agents. It stays close to upstream, rebased nightly, with a few features of my own on top. There are no plans to send them upstream, and it isn't looking for contributors.

All credit for T3 Code goes to [its maintainers](https://github.com/pingdotgg/t3code/graphs/contributors). Annex only adds a thin layer on top of their work.

What Annex changes is in the [changelog](./annex/CHANGELOG.md).

## Install

Builds are on [Releases](https://github.com/Axl47/annex/releases).

- **macOS (Apple silicon):** unzip `Annex-<version>-arm64.zip` into Applications. The app is self-signed, not notarized, so the first launch needs `xattr -dr com.apple.quarantine /Applications/Annex.app`. It updates itself after that.
- **Windows:** run `Annex-<version>-x64.exe`.
- **Android:** install `Annex-<version>.apk`. It installs alongside the official app.
- **Server (`t3` command):** `curl -fsSL https://raw.githubusercontent.com/Axl47/annex/main/scripts/install.sh | sh`

Annex reads the same data folder as T3 Code (`~/.t3`), so it opens your existing threads. Don't run both apps against that folder at once.

For everything else, the [T3 Code docs](./docs/README.md) apply.

## License

[MIT](./LICENSE), like upstream.
