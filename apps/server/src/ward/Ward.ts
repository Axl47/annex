/**
 * Ward integration (Annex): runs each worktree's commands in its own network namespace.
 * Enabled by `T3CODE_WARD_COMMAND` (the `ward` executable, with `ward-prefix` and
 * `ward-bash-env` beside it); a no-op when unset or for folders Ward does not manage.
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import * as ProcessRunner from "../processRunner.ts";

export interface WardCommands {
  readonly ward: string;
  /** Value for Claude Code's CLAUDE_CODE_SHELL_PREFIX. */
  readonly prefix: string;
  /** BASH_ENV hook for agents that run commands as `bash -c` (Codex). */
  readonly bashEnv: string;
}

export const wardCommandsFrom = (env: NodeJS.ProcessEnv): WardCommands | null => {
  const ward = env.T3CODE_WARD_COMMAND?.trim();
  return ward ? { ward, prefix: `${ward}-prefix`, bashEnv: `${ward}-bash-env` } : null;
};

const commands = wardCommandsFrom(process.env);

/** Env an agent process needs so its commands run in their worktree's ward. */
export const wardAgentEnv = (
  provider: "claude" | "codex",
  env: NodeJS.ProcessEnv,
  ward: WardCommands | null = commands,
): Record<string, string> => {
  if (ward === null) return {};
  const [key, value] =
    provider === "claude" ? ["CLAUDE_CODE_SHELL_PREFIX", ward.prefix] : ["BASH_ENV", ward.bashEnv];
  return env[key] === undefined ? { [key]: value } : {};
};

/** A terminal shell launch, wrapped so it opens inside the cwd's ward. */
export const wardTerminalLaunch = (
  launch: { readonly command: string; readonly args: ReadonlyArray<string> },
  cwd: string,
  ward: WardCommands | null = commands,
): { readonly command: string; readonly args: ReadonlyArray<string> } =>
  ward === null
    ? launch
    : {
        command: ward.ward,
        args: ["exec", "--worktree", cwd, "--", launch.command, ...launch.args],
      };

/** One ward, as `ward ls --json` reports it. */
const WardInfo = Schema.Struct({
  id: Schema.String,
  worktree: Schema.String,
  threadIds: Schema.Array(Schema.String),
  running: Schema.Boolean,
  ports: Schema.Array(
    Schema.Struct({ ward: Schema.Number, host: Schema.Number, listening: Schema.Boolean }),
  ),
});
export type WardInfo = typeof WardInfo.Type;

export const decodeWardList = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(WardInfo)),
);

const LIST_TTL_MS = 2_000;
let cachedList: { readonly at: number; readonly wards: ReadonlyArray<WardInfo> } | undefined;

/** Running wards, cached for two seconds; empty when Ward is off or unreachable. */
export const listWards: Effect.Effect<
  ReadonlyArray<WardInfo>,
  never,
  ProcessRunner.ProcessRunner
> = Effect.gen(function* () {
  if (commands === null) return [];
  const now = yield* Clock.currentTimeMillis;
  if (cachedList !== undefined && now - cachedList.at < LIST_TTL_MS) return cachedList.wards;
  const runner = yield* ProcessRunner.ProcessRunner;
  const wards = yield* runner
    .run({ command: commands.ward, args: ["ls", "--json"], timeout: Duration.seconds(5) })
    .pipe(
      Effect.flatMap((output) => decodeWardList(output.stdout)),
      Effect.map((all) => all.filter((ward) => ward.running)),
      Effect.orElseSucceed((): ReadonlyArray<WardInfo> => []),
    );
  cachedList = { at: now, wards };
  return wards;
});

/**
 * Discovered servers with wards applied. A ward's servers are only reachable
 * through host ports that the Ward daemon listens on, so the daemon's raw sockets
 * are replaced by one entry per port a ward is serving, attributed to its thread.
 */
export const overlayWardServers = (
  servers: ReadonlyArray<DiscoveredLocalServer>,
  wards: ReadonlyArray<WardInfo>,
): ReadonlyArray<DiscoveredLocalServer> => {
  if (wards.length === 0) return servers;
  const wardHostPorts = new Set(wards.flatMap((ward) => ward.ports.map((port) => port.host)));
  const wardServers = wards.flatMap((ward) =>
    ward.ports
      .filter((port) => port.listening)
      .map((port): DiscoveredLocalServer => {
        const threadId = ward.threadIds[0];
        return {
          host: "127.0.0.1",
          port: port.host,
          url: `http://127.0.0.1:${port.host}/`,
          processName: `ward :${port.ward}`,
          // The Ward daemon owns the socket; stopping it would stop every ward's ports.
          pid: null,
          terminal: null,
          agent: threadId === undefined ? null : { threadId: ThreadId.make(threadId) },
        };
      }),
  );
  return [...servers.filter((server) => !wardHostPorts.has(server.port)), ...wardServers];
};
