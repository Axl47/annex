/**
 * Android serial per thread (Annex): on the host, `adb` and Gradle act on every connected device
 * unless ANDROID_SERIAL names one. Annex keeps each thread's open Android device in a file, and
 * chains a hook in front of Ward's agent hooks that exports it for the thread's commands.
 */
import { LOCAL_DEVICE_HOST_ID, type DeviceSession } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as DeviceService from "../../device/DeviceService.ts";
import { setWardAgentHooks, wardCommands } from "../../ward/Ward.ts";

/** A thread's file name; the hooks derive the same name from T3CODE_THREAD_ID with `tr`. */
const fileName = (threadId: string) => threadId.replace(/[^A-Za-z0-9._-]/g, "_");

/** File name to adb serial, for each thread with an Android device open on this machine. */
export const threadSerials = (sessions: ReadonlyArray<DeviceSession>) =>
  new Map(
    sessions
      .filter(
        (session) => session.hostId === LOCAL_DEVICE_HOST_ID && session.platform === "android",
      )
      .map((session) => [fileName(session.threadId), session.deviceId]),
  );

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Shell that exports the thread's serial; a serial the user set themselves stays. */
const exportSerial = (
  dir: string,
) => `if [ -z "\${ANDROID_SERIAL:-}" ] && [ -n "\${T3CODE_THREAD_ID:-}" ]; then
  __annex_serial=${quote(dir)}/$(printf %s "$T3CODE_THREAD_ID" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_')
  if [ -r "$__annex_serial" ]; then ANDROID_SERIAL=$(cat "$__annex_serial"); export ANDROID_SERIAL; fi
  unset __annex_serial
fi
`;

/** The two hooks, each ending in Ward's own: a CLAUDE_CODE_SHELL_PREFIX command and a BASH_ENV file. */
export const hookScripts = (
  dir: string,
  ward: { readonly prefix: string; readonly bashEnv: string },
) => ({
  prefix: `#!/bin/sh\n${exportSerial(dir)}exec ${quote(ward.prefix)} "$@"\n`,
  bashEnv: `${exportSerial(dir)}. ${quote(ward.bashEnv)}\n`,
});

/** Writes the hooks, then keeps the serial files in step with the open device sessions. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (wardCommands === null) return;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const devices = yield* DeviceService.DeviceService;
    const root = path.join(config.stateDir, "annex-device-serial");
    const dir = path.join(root, "threads");
    // Sessions live in memory, so files from an earlier run name devices nobody holds.
    yield* fs.remove(root, { recursive: true, force: true });
    yield* fs.makeDirectory(dir, { recursive: true });
    const scripts = hookScripts(dir, wardCommands);
    const hooks = { prefix: path.join(root, "prefix"), bashEnv: path.join(root, "bash-env") };
    yield* fs.writeFileString(hooks.prefix, scripts.prefix, { mode: 0o755 });
    yield* fs.writeFileString(hooks.bashEnv, scripts.bashEnv);
    setWardAgentHooks(hooks);

    let written = new Map<string, string>();
    const sync = Effect.fnUntraced(function* (sessions: ReadonlyArray<DeviceSession>) {
      const next = threadSerials(sessions);
      for (const name of written.keys())
        if (!next.has(name)) yield* fs.remove(path.join(dir, name), { force: true });
      for (const [name, serial] of next)
        if (written.get(name) !== serial) yield* fs.writeFileString(path.join(dir, name), serial);
      written = next;
    });
    const subscription = yield* devices.subscribe;
    yield* sync((yield* devices.state).sessions);
    yield* Stream.fromSubscription(subscription).pipe(
      Stream.runForEach((state) => sync(state.sessions)),
      Effect.ignoreCause({ log: true }),
      Effect.forkScoped,
    );
  }).pipe(Effect.ignoreCause({ log: true })),
);
