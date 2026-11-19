import { ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "@effect/vitest";
import {
  decodeWardList,
  overlayWardServers,
  wardAgentEnv,
  wardCommandsFrom,
  wardTerminalLaunch,
} from "./Ward.ts";

const ward = wardCommandsFrom({ T3CODE_WARD_COMMAND: "/opt/ward/bin/ward" });

describe("Ward hooks", () => {
  it("is off without T3CODE_WARD_COMMAND", () => {
    expect(wardCommandsFrom({})).toBeNull();
    expect(wardAgentEnv("claude", {}, null)).toEqual({});
    const launch = { command: "/bin/bash", args: ["-l"] };
    expect(wardTerminalLaunch(launch, "/w", null)).toBe(launch);
  });

  it("points each agent at its hook without overriding the user's own", () => {
    expect(wardAgentEnv("claude", {}, ward)).toEqual({
      CLAUDE_CODE_SHELL_PREFIX: "/opt/ward/bin/ward-prefix",
    });
    expect(wardAgentEnv("codex", {}, ward)).toEqual({ BASH_ENV: "/opt/ward/bin/ward-bash-env" });
    expect(wardAgentEnv("claude", { CLAUDE_CODE_SHELL_PREFIX: "/mine" }, ward)).toEqual({});
    expect(wardAgentEnv("codex", { BASH_ENV: "/mine" }, ward)).toEqual({});
  });

  it("opens terminals through ward exec in their cwd", () => {
    expect(
      wardTerminalLaunch({ command: "/bin/bash", args: ["-l"] }, "/w/repo/t3-1", ward),
    ).toEqual({
      command: "/opt/ward/bin/ward",
      args: ["exec", "--worktree", "/w/repo/t3-1", "--", "/bin/bash", "-l"],
    });
  });
});

describe("overlayWardServers", () => {
  const server = (
    port: number,
    extra: Partial<DiscoveredLocalServer> = {},
  ): DiscoveredLocalServer => ({
    host: "127.0.0.1",
    port,
    url: `http://127.0.0.1:${port}/`,
    processName: "node",
    pid: 4242,
    terminal: null,
    ...extra,
  });
  const wards = [
    {
      id: "app.t3-1",
      worktree: "/w/app/t3-1",
      threadIds: ["thread-1"],
      running: true,
      ports: [
        { ward: 5173, host: 20100, listening: true },
        { ward: 5432, host: 20101, listening: false },
      ],
    },
  ];

  it("replaces the daemon's sockets with attributed ward servers and drops idle mappings", () => {
    const result = overlayWardServers([server(3000), server(20100), server(20101)], wards);
    expect(result).toEqual([
      server(3000),
      {
        host: "127.0.0.1",
        port: 20100,
        url: "http://127.0.0.1:20100/",
        processName: "ward :5173",
        pid: null,
        terminal: null,
        agent: { threadId: ThreadId.make("thread-1") },
      },
    ]);
  });

  it("leaves the list alone without wards", () => {
    const servers = [server(3000)];
    expect(overlayWardServers(servers, [])).toBe(servers);
  });
});

describe("decodeWardList", () => {
  it.effect("reads `ward ls --json` and rejects malformed output", () =>
    Effect.gen(function* () {
      const json = JSON.stringify([
        {
          id: "a.b",
          repo: "a",
          worktree: "/w/a/b",
          threadIds: [],
          slot: 1,
          running: true,
          ports: [],
        },
      ]);
      const decoded = yield* decodeWardList(json);
      expect(decoded.map((w) => w.id)).toEqual(["a.b"]);
      const bad = yield* Effect.flip(decodeWardList("not json"));
      expect(bad).toBeDefined();
    }),
  );
});
