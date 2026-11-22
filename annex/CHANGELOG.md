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
- On Windows, Annex installs in its own folder, next to T3 Code.
- A Linux x64 desktop app: an AppImage with the Annex name and icon that updates itself from Annex's releases, and an install script that adds it to the app launcher.
- Geasa: hand an agent a piece of work from the Grimoire (sidebar, or "Open Grimoire" in the command palette) and review the report it hands back instead of the conversation. A report holds the result, risks, proof such as before-and-after screenshots or clips, and checks the server verifies from the commands the agent actually ran. Comments steer a running agent; selecting text in a report quotes it in a comment, enacts a new geas from it, or queues that request to the geas's own agent. Geasa are titled from their request, the enact composer remembers your last project, workspace, branch and model, and each project sets its own key prefix, checks, delivery buttons, and rules, which agents can also change when asked. Web and desktop for now.
- Each Annex release's notes, on GitHub and in the desktop app's update prompt, list the highlights of every T3 Code release it brings in since the previous Annex release.
- Familiars: standing agents with a role, a pinned channel, and a Tome of notes they keep across sessions (sidebar, or "Summon a Familiar" in the command palette). A Familiar lays geasa for real work, follows them with Grimoire tools, and gets one Wake message when a geas it laid needs it. Scheduled routines on its channel pause with it and stop for the day once its daily run budget is spent. A "Claude · Familiars" instance compacts long channels at a size you choose. Web and desktop for now.
- Summoning a Familiar opens its channel and can send it a first message. The Sync and Scout templates offer a daily routine, and a Familiar's page adds routines with "Add routine", so you no longer have to ask the Familiar to schedule one.
- With Ward installed and `T3CODE_WARD_COMMAND` set on the server, each worktree's agent commands (Claude, and Codex in full access) and terminals run in that worktree's own network namespace, so parallel threads can use the same ports, databases and Docker setups without colliding. The preview list shows each ward's servers under their thread at the host port Ward maps them to. Linux only.
- A simulator, emulator or phone is open in one thread at a time. Opening one that another thread has open is refused, from an agent's `device_open` and from the Device panel, with that thread's title and the devices that are free. A thread keeps its devices while it works and for 30 minutes after, and gives them up at once when it is settled, archived or deleted. A thread and its subagents share their devices.
- `device_list` shows agents which devices other threads hold, and `device_open` with no device named picks a free emulator or simulator, not a held one or a phone.

### Changed

- The Android app no longer downloads over-the-air updates meant for the official app.
- Thread links from app.t3.codes open in the official T3 Code app, not in Annex on Android.
