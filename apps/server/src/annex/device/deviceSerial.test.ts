// @effect-diagnostics nodeBuiltinImport:off - the hooks are shell scripts, so the test runs them in a real shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId, type DeviceSession } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { hookScripts, threadSerials } from "./deviceSerial.ts";

const session = (threadId: string, deviceId: string, extra: Partial<DeviceSession> = {}) =>
  ({
    threadId: ThreadId.make(threadId),
    hostId: "local",
    deviceId,
    platform: "android",
    openedAt: "1970-01-01T00:00:00.000Z",
    ...extra,
  }) as DeviceSession;

describe("device serial hooks", () => {
  it("export a thread's open Android device to its commands, through Ward's hooks", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "annex-serial-"));
    try {
      const dir = NodePath.join(root, "it's threads");
      NodeFS.mkdirSync(dir);
      const ward = {
        prefix: NodePath.join(root, "ward-prefix"),
        bashEnv: NodePath.join(root, "ward-bash-env"),
      };
      NodeFS.writeFileSync(ward.prefix, '#!/bin/sh\nexec bash -c "$1"\n');
      NodeFS.chmodSync(ward.prefix, 0o755);
      NodeFS.writeFileSync(ward.bashEnv, "WARD_HOOK_RAN=yes\n");
      const serials = threadSerials([
        session("mcp:launch:a%3Ab", "emulator-5554"),
        session("thread-ios", "ABCD", { platform: "ios" }),
        session("thread-remote", "emulator-5556", { hostId: "ssh:mac" as never }),
      ]);
      expect([...serials]).toEqual([["mcp_launch_a_3Ab", "emulator-5554"]]);
      for (const [name, serial] of serials) NodeFS.writeFileSync(NodePath.join(dir, name), serial);
      const scripts = hookScripts(dir, ward);
      const prefix = NodePath.join(root, "prefix");
      const bashEnv = NodePath.join(root, "bash-env");
      NodeFS.writeFileSync(prefix, scripts.prefix);
      NodeFS.chmodSync(prefix, 0o755);
      NodeFS.writeFileSync(bashEnv, scripts.bashEnv);

      const print = 'printf %s "${ANDROID_SERIAL:-none}:${WARD_HOOK_RAN:-}"';
      const run = (command: string, args: ReadonlyArray<string>, env: Record<string, string>) =>
        NodeChildProcess.execFileSync(command, args, {
          env: { PATH: process.env.PATH, ...env },
          encoding: "utf8",
          // With a socket for stdin, bash takes itself for an ssh command and skips BASH_ENV.
          stdio: ["ignore", "pipe", "inherit"],
        });
      const claude = (env: Record<string, string>) => run(prefix, [print], env);
      const codex = (env: Record<string, string>) =>
        run("bash", ["-c", print], { BASH_ENV: bashEnv, ...env });

      expect(claude({ T3CODE_THREAD_ID: "mcp:launch:a%3Ab" })).toBe("emulator-5554:");
      expect(codex({ T3CODE_THREAD_ID: "mcp:launch:a%3Ab" })).toBe("emulator-5554:yes");
      // A thread with no device open, and a serial the user set, are left alone.
      expect(claude({ T3CODE_THREAD_ID: "thread-other" })).toBe("none:");
      expect(codex({})).toBe("none:yes");
      expect(claude({ T3CODE_THREAD_ID: "mcp:launch:a%3Ab", ANDROID_SERIAL: "mine" })).toBe(
        "mine:",
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
