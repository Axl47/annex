import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  FAMILIAR_CLAUDE_INSTANCE_ID,
  FAMILIAR_DEFAULT_DAILY_RUN_BUDGET,
  FAMILIAR_TOME_MAX_BYTES,
  FamiliarError,
  FamiliarHeldWake,
  FamiliarId,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderDriverKind,
  ScheduledTaskId,
  ThreadId,
  defaultInstanceIdForDriver,
  type Familiar,
  type FamiliarAutonomy,
  type FamiliarClaudeInstance,
  type FamiliarConfigureInstanceInput,
  type FamiliarMutationResult,
  type FamiliarSetDismissedInput,
  type FamiliarSetPausedInput,
  type FamiliarsSnapshot,
  type FamiliarsSubscribeInput,
  type FamiliarSummonInput,
  type FamiliarUpdateInput,
  type FamiliarWakeEvent,
  type FamiliarWriteTomeInput,
  type OrchestrationV2DomainEvent,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScheduledTask,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { userFacingDispatchErrorMessage } from "../../orchestration-v2/UserFacingErrors.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { GeasService, type GeasWake } from "../geas/GeasService.ts";
import {
  budgetDay,
  holdWake,
  mergeWakeEvents,
  tomeByteLength,
  wakeMessage,
  type FamiliarChannel,
} from "./familiarLogic.ts";
import { familiarChannels } from "./familiarThreads.ts";

const json = <A, I>(schema: Schema.Codec<A, I>) => {
  const codec = Schema.fromJsonString(schema);
  return { decode: Schema.decodeUnknownSync(codec), encode: Schema.encodeSync(codec) };
};

const ModelSelectionJson = json(ModelSelection);
const TaskIdsJson = json(Schema.Array(ScheduledTaskId));
const WakesJson = json(Schema.Array(FamiliarHeldWake));

/** Wake messages carry this prefix, so the channel watcher can tell them from yours. */
const WAKE_MESSAGE_PREFIX = "annex-familiar-wake:";
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");

interface FamiliarRow {
  readonly familiar_id: string;
  readonly name: string;
  readonly role_prompt: string;
  readonly project_id: string;
  readonly thread_id: string | null;
  readonly model_selection_json: string;
  readonly runtime_mode: RuntimeMode;
  readonly interaction_mode: ProviderInteractionMode;
  readonly autonomy: FamiliarAutonomy;
  readonly tome: string;
  readonly tome_revision: number;
  readonly daily_run_budget: number;
  readonly runs_today: number;
  readonly runs_day: string;
  readonly paused_at: string | null;
  readonly archived_at: string | null;
  readonly held_task_ids_json: string;
  readonly held_wakes_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const toFamiliar = (row: FamiliarRow): Familiar => ({
  id: FamiliarId.make(row.familiar_id),
  name: row.name,
  rolePrompt: row.role_prompt,
  projectId: ProjectId.make(row.project_id),
  threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
  modelSelection: ModelSelectionJson.decode(row.model_selection_json),
  runtimeMode: row.runtime_mode,
  interactionMode: row.interaction_mode,
  autonomy: row.autonomy,
  tome: row.tome,
  tomeRevision: row.tome_revision,
  dailyRunBudget: row.daily_run_budget,
  runsToday: row.runs_today,
  runsDay: row.runs_day,
  pausedAt: row.paused_at,
  archivedAt: row.archived_at,
  heldTaskIds: TaskIdsJson.decode(row.held_task_ids_json),
  heldWakes: WakesJson.decode(row.held_wakes_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toChannel = (row: FamiliarRow): FamiliarChannel => ({
  familiarId: row.familiar_id,
  name: row.name,
  rolePrompt: row.role_prompt,
  autonomy: row.autonomy,
  tome: row.tome,
  tomeRevision: row.tome_revision,
});

const messageOf = (cause: unknown) =>
  userFacingDispatchErrorMessage(cause) ??
  (cause instanceof Error ? cause.message : "Something went wrong.");

const isFamiliarError = Schema.is(FamiliarError);

const failWith =
  (message: string, familiarId?: string) =>
  (cause: unknown): FamiliarError =>
    isFamiliarError(cause)
      ? cause
      : new FamiliarError({
          message: `${message} ${messageOf(cause)}`,
          ...(familiarId === undefined ? {} : { familiarId: FamiliarId.make(familiarId) }),
        });

export class FamiliarStaleTomeError extends Schema.TaggedError<FamiliarStaleTomeError>()(
  "FamiliarStaleTomeError",
  { currentRevision: Schema.Int, tome: Schema.String },
) {
  override get message(): string {
    return `The Tome changed since you read it; it is at revision ${this.currentRevision}. Merge your change into the current Tome and write again with expectedRevision ${this.currentRevision}.`;
  }
}

export class FamiliarService extends Context.Service<
  FamiliarService,
  {
    readonly subscribe: (
      input: FamiliarsSubscribeInput,
    ) => Stream.Stream<FamiliarsSnapshot, FamiliarError>;
    readonly summon: (
      input: FamiliarSummonInput,
    ) => Effect.Effect<FamiliarMutationResult, FamiliarError>;
    readonly update: (
      input: FamiliarUpdateInput,
    ) => Effect.Effect<FamiliarMutationResult, FamiliarError>;
    readonly writeTome: (
      input: FamiliarWriteTomeInput,
    ) => Effect.Effect<FamiliarMutationResult, FamiliarError | FamiliarStaleTomeError>;
    readonly setPaused: (
      input: FamiliarSetPausedInput,
    ) => Effect.Effect<FamiliarMutationResult, FamiliarError>;
    readonly setDismissed: (
      input: FamiliarSetDismissedInput,
    ) => Effect.Effect<FamiliarMutationResult, FamiliarError>;
    readonly configureInstance: (
      input: FamiliarConfigureInstanceInput,
    ) => Effect.Effect<FamiliarClaudeInstance, FamiliarError>;
    /** The Familiar whose channel this is, for its agent's tools. */
    readonly getForChannel: (threadId: ThreadId) => Effect.Effect<Familiar, FamiliarError>;
    readonly readTome: (
      threadId: ThreadId,
    ) => Effect.Effect<{ readonly tome: string; readonly revision: number }, FamiliarError>;
    readonly writeTomeAsAgent: (input: {
      readonly threadId: ThreadId;
      readonly content?: string;
      readonly append?: string;
      readonly expectedRevision?: number;
    }) => Effect.Effect<
      { readonly revision: number; readonly bytes: number },
      FamiliarError | FamiliarStaleTomeError
    >;
  }
>()("t3/annex/familiar/FamiliarService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const geas = yield* GeasService;

  const changes = yield* PubSub.sliding<null>(64);
  const publish = PubSub.publish(changes, null).pipe(Effect.asVoid);
  const locks = new Map<string, Semaphore.Semaphore>();
  const withLock =
    (familiarId: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) => {
      let lock = locks.get(familiarId);
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        locks.set(familiarId, lock);
      }
      return lock.withPermits(1)(effect);
    };

  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const today = Effect.map(Clock.currentTimeMillis, budgetDay);
  const newId = (prefix: string) => Effect.map(randomUuidV4, (uuid) => `${prefix}-${uuid}`);
  const orDie = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.orDie(effect);

  const selectRow = (familiarId: string) =>
    orDie(sql<FamiliarRow>`SELECT * FROM annex_familiars WHERE familiar_id = ${familiarId}`).pipe(
      Effect.map((rows) => rows[0]),
    );

  const requireRow = Effect.fn("FamiliarService.requireRow")(function* (familiarId: string) {
    const row = yield* selectRow(familiarId);
    if (row === undefined) {
      return yield* new FamiliarError({
        message: "Familiar not found.",
        familiarId: FamiliarId.make(familiarId),
      });
    }
    return row;
  });

  const rowForChannel = (threadId: string) =>
    orDie(
      sql<FamiliarRow>`SELECT * FROM annex_familiars WHERE thread_id = ${threadId} LIMIT 1`,
    ).pipe(Effect.map((rows) => rows[0]));

  const requireChannelRow = Effect.fn("FamiliarService.requireChannelRow")(function* (
    threadId: ThreadId,
  ) {
    const row = yield* rowForChannel(threadId);
    if (row === undefined || row.archived_at !== null) {
      return yield* new FamiliarError({ message: "This thread is not a Familiar's channel." });
    }
    return row;
  });

  /** Keeps the synchronous registry in step with the stored row. */
  const register = (row: FamiliarRow) =>
    Effect.sync(() => {
      if (row.thread_id === null) return;
      const threadId = ThreadId.make(row.thread_id);
      if (row.archived_at === null) familiarChannels.set(threadId, toChannel(row));
      else familiarChannels.delete(threadId);
    });

  const saved = Effect.fn("FamiliarService.saved")(function* (familiarId: string) {
    const row = yield* selectRow(familiarId);
    if (row !== undefined) yield* register(row);
    yield* publish;
    return row;
  });

  const overBudget = (row: FamiliarRow, day: string) =>
    row.runs_day === day && row.runs_today >= row.daily_run_budget;

  /** Routines run only while the Familiar is active, not paused, and under budget. */
  const blocked = (row: FamiliarRow, day: string) =>
    row.paused_at !== null || row.archived_at !== null || overBudget(row, day);

  const channelTasks = (row: FamiliarRow) =>
    row.thread_id === null
      ? Effect.succeed<ReadonlyArray<ScheduledTask>>([])
      : scheduledTasks.list().pipe(
          Effect.map((result) => result.tasks.filter((task) => task.threadId === row.thread_id)),
          Effect.orElseSucceed((): ReadonlyArray<ScheduledTask> => []),
        );

  /** Disables the channel's enabled routines and remembers them for the way back. */
  const holdRoutines = Effect.fn("FamiliarService.holdRoutines")(function* (row: FamiliarRow) {
    const held = new Set(TaskIdsJson.decode(row.held_task_ids_json));
    for (const task of yield* channelTasks(row)) {
      if (!task.enabled) continue;
      yield* scheduledTasks
        .setEnabled({ id: task.id, enabled: false })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("familiar routine disable failed", { cause }),
          ),
        );
      held.add(task.id);
    }
    yield* orDie(sql`
      UPDATE annex_familiars SET held_task_ids_json = ${TaskIdsJson.encode([...held])}
      WHERE familiar_id = ${row.familiar_id}
    `);
  });

  const sendToChannel = Effect.fn("FamiliarService.sendToChannel")(function* (
    row: FamiliarRow,
    text: string,
  ) {
    if (row.thread_id === null) return;
    const id = yield* newId("familiar-wake");
    yield* threads
      .sendToThread({
        projectId: ProjectId.make(row.project_id),
        commandId: CommandId.make(`annex-familiar-wake:${id}`),
        threadId: ThreadId.make(row.thread_id),
        messageId: MessageId.make(`${WAKE_MESSAGE_PREFIX}${id}`),
        text,
        attachments: [],
        mode: "queue",
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(
        Effect.catchCause((cause) => Effect.logWarning("familiar wake delivery failed", { cause })),
      );
  });

  /** Counts one turn you didn't type; spending the budget holds the channel's routines. */
  const countRun = Effect.fn("FamiliarService.countRun")(function* (row: FamiliarRow) {
    const day = yield* today;
    const runs = row.runs_day === day ? row.runs_today + 1 : 1;
    yield* orDie(sql`
      UPDATE annex_familiars SET runs_today = ${runs}, runs_day = ${day}
      WHERE familiar_id = ${row.familiar_id}
    `);
    const fresh = yield* requireRow(row.familiar_id);
    if (overBudget(fresh, day)) yield* holdRoutines(fresh);
  });

  /**
   * Re-enables held routines and delivers held wakes once nothing blocks the Familiar. Returns
   * the routines it could not bring back, such as one deleted meanwhile or a past one-off.
   */
  const release = Effect.fn("FamiliarService.release")(function* (familiarId: string) {
    const row = yield* requireRow(familiarId);
    const day = yield* today;
    // A new day clears the count before anything else is decided.
    if (row.runs_day !== day && row.runs_today > 0) {
      yield* orDie(sql`
        UPDATE annex_familiars SET runs_today = 0, runs_day = ${day} WHERE familiar_id = ${familiarId}
      `);
    }
    const current = yield* requireRow(familiarId);
    if (blocked(current, day)) return [];
    const skipped: Array<string> = [];
    const heldIds = TaskIdsJson.decode(current.held_task_ids_json);
    if (heldIds.length > 0) {
      const tasks = new Map((yield* channelTasks(current)).map((task) => [task.id, task]));
      const at = yield* Clock.currentTimeMillis;
      for (const id of heldIds) {
        const task = tasks.get(id);
        if (task === undefined) {
          skipped.push(`a deleted routine (${id})`);
          continue;
        }
        if (task.schedule.type === "once" && Date.parse(task.schedule.runAt) <= at) {
          skipped.push(task.title);
          continue;
        }
        yield* scheduledTasks
          .setEnabled({ id, enabled: true })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("familiar routine enable failed", { cause }),
            ),
          );
      }
    }
    const wakes = WakesJson.decode(current.held_wakes_json);
    yield* orDie(sql`
      UPDATE annex_familiars SET held_task_ids_json = '[]', held_wakes_json = '[]'
      WHERE familiar_id = ${familiarId}
    `);
    if (wakes.length > 0) {
      yield* sendToChannel(current, wakeMessage(wakes));
      yield* countRun(current);
    }
    return skipped;
  });

  const loadChannels = Effect.gen(function* () {
    const rows = yield* orDie(
      sql<FamiliarRow>`SELECT * FROM annex_familiars WHERE archived_at IS NULL`,
    );
    for (const row of rows) yield* register(row);
  });

  const claudeInstance = Effect.map(
    serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null)),
    (settings): FamiliarClaudeInstance | null => {
      const instance = settings?.providerInstances[FAMILIAR_CLAUDE_INSTANCE_ID];
      if (instance === undefined) return null;
      const config = (instance.config ?? {}) as { readonly autoCompactWindow?: unknown };
      return {
        instanceId: FAMILIAR_CLAUDE_INSTANCE_ID,
        autoCompactWindow:
          typeof config.autoCompactWindow === "string" ? config.autoCompactWindow : "",
      };
    },
  );

  const snapshot = Effect.fn("FamiliarService.snapshot")(function* (
    input: FamiliarsSubscribeInput,
  ) {
    const rows = yield* orDie(
      input.includeArchived === true
        ? sql<FamiliarRow>`SELECT * FROM annex_familiars ORDER BY created_at ASC`
        : sql<FamiliarRow>`
            SELECT * FROM annex_familiars WHERE archived_at IS NULL ORDER BY created_at ASC
          `,
    );
    return { familiars: rows.map(toFamiliar), claudeInstance: yield* claudeInstance };
  });

  const subscribe: FamiliarService["Service"]["subscribe"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(snapshot(input)),
          Stream.fromSubscription(subscription).pipe(
            Stream.buffer({ capacity: 1, strategy: "sliding" }),
            Stream.mapEffect(() => snapshot(input)),
          ),
        );
      }),
    );

  const summon: FamiliarService["Service"]["summon"] = Effect.fn("FamiliarService.summon")(
    function* (input) {
      const taken = yield* orDie(
        sql<{ n: number }>`SELECT COUNT(*) AS n FROM annex_familiars WHERE name = ${input.name}`,
      );
      if (taken[0]!.n > 0) {
        return yield* new FamiliarError({ message: `A Familiar named ${input.name} exists.` });
      }
      const familiarId = yield* newId("familiar");
      const createdAt = yield* now;
      const runtimeMode = input.runtimeMode ?? DEFAULT_RUNTIME_MODE;
      const interactionMode = input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
      yield* orDie(sql`
        INSERT INTO annex_familiars (
          familiar_id, name, role_prompt, project_id, model_selection_json, runtime_mode,
          interaction_mode, autonomy, daily_run_budget, runs_day, created_at, updated_at
        ) VALUES (
          ${familiarId}, ${input.name}, ${input.rolePrompt}, ${input.projectId},
          ${ModelSelectionJson.encode(input.modelSelection)}, ${runtimeMode}, ${interactionMode},
          ${input.autonomy ?? "start"}, ${input.dailyRunBudget ?? FAMILIAR_DEFAULT_DAILY_RUN_BUDGET},
          ${yield* today}, ${createdAt}, ${createdAt}
        )
      `);
      // Registered before launch, so the channel's very first turn already gets its preamble.
      const claimed = ThreadId.make(yield* randomUuidV4);
      yield* orDie(
        sql`UPDATE annex_familiars SET thread_id = ${claimed} WHERE familiar_id = ${familiarId}`,
      );
      yield* register(yield* requireRow(familiarId));
      yield* threadLaunch
        .launch({
          commandId: CommandId.make(`annex-familiar-summon:${familiarId}`),
          threadId: claimed,
          projectId: input.projectId,
          title: `✦ ${input.name}`,
          generateTitle: false,
          modelSelection: input.modelSelection,
          runtimeMode,
          interactionMode,
          workspaceStrategy: { type: "root" },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(
          Effect.mapError(failWith("Could not create the channel.", familiarId)),
          Effect.onError(() =>
            Effect.andThen(
              Effect.sync(() => familiarChannels.delete(claimed)),
              orDie(sql`DELETE FROM annex_familiars WHERE familiar_id = ${familiarId}`),
            ),
          ),
        );
      const stamp = yield* now;
      for (const command of [
        { type: "thread.pin" as const, commandId: CommandId.make(`annex-familiar-pin:${stamp}`) },
        {
          type: "thread.auto-settle.set" as const,
          commandId: CommandId.make(`annex-familiar-auto-settle:${familiarId}`),
          enabled: false,
        },
      ]) {
        yield* threads
          .dispatch({ ...command, threadId: claimed })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("familiar channel setup failed", { cause }),
            ),
          );
      }
      yield* publish;
      return { familiarId: FamiliarId.make(familiarId) };
    },
  );

  const update: FamiliarService["Service"]["update"] = Effect.fn("FamiliarService.update")(
    function* (input) {
      return yield* withLock(input.familiarId)(
        Effect.gen(function* () {
          const row = yield* requireRow(input.familiarId);
          if (input.name !== undefined && input.name !== row.name) {
            const taken = yield* orDie(sql<{ n: number }>`
              SELECT COUNT(*) AS n FROM annex_familiars
              WHERE name = ${input.name} AND familiar_id != ${row.familiar_id}
            `);
            if (taken[0]!.n > 0) {
              return yield* new FamiliarError({
                message: `A Familiar named ${input.name} exists.`,
              });
            }
          }
          const updatedAt = yield* now;
          yield* orDie(sql`
            UPDATE annex_familiars SET
              name = ${input.name ?? row.name},
              role_prompt = ${input.rolePrompt ?? row.role_prompt},
              autonomy = ${input.autonomy ?? row.autonomy},
              daily_run_budget = ${input.dailyRunBudget ?? row.daily_run_budget},
              updated_at = ${updatedAt}
            WHERE familiar_id = ${row.familiar_id}
          `);
          if (input.name !== undefined && input.name !== row.name && row.thread_id !== null) {
            yield* threads
              .dispatch({
                type: "thread.metadata.update",
                commandId: CommandId.make(yield* newId("annex-familiar-rename")),
                threadId: ThreadId.make(row.thread_id),
                title: `✦ ${input.name}`,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("familiar channel rename failed", { cause }),
                ),
              );
          }
          // A raised budget can free held routines and wakes.
          const skipped = yield* release(row.familiar_id);
          yield* saved(row.familiar_id);
          return {
            familiarId: input.familiarId,
            ...(skipped.length === 0 ? {} : { skippedRoutines: skipped }),
          };
        }),
      );
    },
  );

  const storeTome = Effect.fn("FamiliarService.storeTome")(function* (
    row: FamiliarRow,
    content: string,
    expectedRevision: number,
  ) {
    if (row.tome_revision !== expectedRevision) {
      return yield* new FamiliarStaleTomeError({
        currentRevision: row.tome_revision,
        tome: row.tome,
      });
    }
    const bytes = tomeByteLength(content);
    if (bytes > FAMILIAR_TOME_MAX_BYTES) {
      return yield* new FamiliarError({
        message: `The Tome would be ${bytes} bytes, over the ${FAMILIAR_TOME_MAX_BYTES}-byte limit. Condense it: keep decisions and standing facts, drop what no longer matters.`,
        familiarId: FamiliarId.make(row.familiar_id),
      });
    }
    const revision = row.tome_revision + 1;
    yield* orDie(sql`
      UPDATE annex_familiars SET tome = ${content}, tome_revision = ${revision},
        updated_at = ${yield* now}
      WHERE familiar_id = ${row.familiar_id}
    `);
    yield* saved(row.familiar_id);
    return { revision, bytes };
  });

  const writeTome: FamiliarService["Service"]["writeTome"] = Effect.fn("FamiliarService.writeTome")(
    function* (input) {
      yield* withLock(input.familiarId)(
        Effect.flatMap(requireRow(input.familiarId), (row) =>
          storeTome(row, input.content, input.expectedRevision),
        ),
      );
      return { familiarId: input.familiarId };
    },
  );

  const setPaused: FamiliarService["Service"]["setPaused"] = Effect.fn("FamiliarService.setPaused")(
    function* (input) {
      return yield* withLock(input.familiarId)(
        Effect.gen(function* () {
          const row = yield* requireRow(input.familiarId);
          const at = yield* now;
          if (input.paused) {
            if (row.paused_at === null) {
              yield* orDie(sql`
              UPDATE annex_familiars SET paused_at = ${at}, updated_at = ${at}
              WHERE familiar_id = ${row.familiar_id}
            `);
              yield* holdRoutines(yield* requireRow(row.familiar_id));
            }
            yield* saved(row.familiar_id);
            return { familiarId: input.familiarId };
          }
          yield* orDie(sql`
          UPDATE annex_familiars SET paused_at = NULL, updated_at = ${at}
          WHERE familiar_id = ${row.familiar_id}
        `);
          const skipped = yield* release(row.familiar_id);
          yield* saved(row.familiar_id);
          return {
            familiarId: input.familiarId,
            ...(skipped.length === 0 ? {} : { skippedRoutines: skipped }),
          };
        }),
      );
    },
  );

  const setDismissed: FamiliarService["Service"]["setDismissed"] = Effect.fn(
    "FamiliarService.setDismissed",
  )(function* (input) {
    return yield* withLock(input.familiarId)(
      Effect.gen(function* () {
        const row = yield* requireRow(input.familiarId);
        const at = yield* now;
        const channel = row.thread_id === null ? null : ThreadId.make(row.thread_id);
        if (channel !== null) {
          const shell = yield* threads
            .getThreadShell(channel)
            .pipe(Effect.orElseSucceed(() => null));
          if (!input.dismissed && (shell === null || shell.deletedAt !== null)) {
            return yield* new FamiliarError({
              message: "Its channel was deleted, so this Familiar can't come back.",
              familiarId: input.familiarId,
            });
          }
          yield* threads
            .dispatch(
              input.dismissed
                ? {
                    type: "thread.unpin",
                    commandId: CommandId.make(`annex-familiar-unpin:${at}`),
                    threadId: channel,
                  }
                : {
                    type: "thread.pin",
                    commandId: CommandId.make(`annex-familiar-pin:${at}`),
                    threadId: channel,
                  },
            )
            .pipe(
              Effect.catchCause((cause) => Effect.logWarning("familiar pin failed", { cause })),
            );
        }
        if (input.dismissed) {
          yield* orDie(sql`
            UPDATE annex_familiars SET archived_at = ${at}, updated_at = ${at}
            WHERE familiar_id = ${row.familiar_id}
          `);
          yield* holdRoutines(yield* requireRow(row.familiar_id));
          yield* saved(row.familiar_id);
          return { familiarId: input.familiarId };
        }
        yield* orDie(sql`
          UPDATE annex_familiars SET archived_at = NULL, updated_at = ${at}
          WHERE familiar_id = ${row.familiar_id}
        `);
        const skipped = yield* release(row.familiar_id);
        yield* saved(row.familiar_id);
        return {
          familiarId: input.familiarId,
          ...(skipped.length === 0 ? {} : { skippedRoutines: skipped }),
        };
      }),
    );
  });

  const configureInstance: FamiliarService["Service"]["configureInstance"] = Effect.fn(
    "FamiliarService.configureInstance",
  )(function* (input) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(failWith("Could not read the provider settings.")),
    );
    const base =
      settings.providerInstances[defaultInstanceIdForDriver(CLAUDE_DRIVER)]?.config ?? {};
    const current = settings.providerInstances[FAMILIAR_CLAUDE_INSTANCE_ID];
    const inherited = base as { readonly binaryPath?: unknown; readonly homePath?: unknown };
    // A thread switches only between Claude instances that share a config directory.
    const config = {
      ...(current?.config as Record<string, unknown> | undefined),
      ...(typeof inherited.binaryPath === "string" ? { binaryPath: inherited.binaryPath } : {}),
      ...(typeof inherited.homePath === "string" ? { homePath: inherited.homePath } : {}),
      autoCompactWindow: String(input.compactAfter),
      idleCompaction: "off",
    };
    yield* serverSettings
      .updateProviderInstance({
        operation: "upsert",
        instanceId: FAMILIAR_CLAUDE_INSTANCE_ID,
        instance: {
          driver: CLAUDE_DRIVER,
          displayName: "Claude · Familiars",
          ...(current?.accentColor === undefined ? {} : { accentColor: current.accentColor }),
          enabled: true,
          config,
        },
      })
      .pipe(Effect.mapError(failWith("Could not save the Claude · Familiars instance.")));
    yield* publish;
    return {
      instanceId: FAMILIAR_CLAUDE_INSTANCE_ID,
      autoCompactWindow: String(input.compactAfter),
    };
  });

  const getForChannel: FamiliarService["Service"]["getForChannel"] = Effect.fn(
    "FamiliarService.getForChannel",
  )(function* (threadId) {
    return toFamiliar(yield* requireChannelRow(threadId));
  });

  const readTome: FamiliarService["Service"]["readTome"] = Effect.fn("FamiliarService.readTome")(
    function* (threadId) {
      const row = yield* requireChannelRow(threadId);
      return { tome: row.tome, revision: row.tome_revision };
    },
  );

  const writeTomeAsAgent: FamiliarService["Service"]["writeTomeAsAgent"] = Effect.fn(
    "FamiliarService.writeTomeAsAgent",
  )(function* (input) {
    const found = yield* requireChannelRow(input.threadId);
    return yield* withLock(found.familiar_id)(
      Effect.gen(function* () {
        const row = yield* requireRow(found.familiar_id);
        if (input.append !== undefined) {
          const line = input.append.trim();
          const content = row.tome.trim() === "" ? line : `${row.tome.trimEnd()}\n${line}`;
          return yield* storeTome(row, content, row.tome_revision);
        }
        if (input.content === undefined || input.expectedRevision === undefined) {
          return yield* new FamiliarError({
            message:
              "Pass content with expectedRevision to replace the Tome, or append to add a line.",
          });
        }
        return yield* storeTome(row, input.content, input.expectedRevision);
      }),
    );
  });

  // Wakes merge per geas until its run ends, then go to the channel as one message.
  const pendingWakes = new Map<string, ReadonlyArray<FamiliarWakeEvent>>();

  const deliverWake = Effect.fn("FamiliarService.deliverWake")(function* (
    familiarId: string,
    wake: FamiliarHeldWake,
  ) {
    yield* withLock(familiarId)(
      Effect.gen(function* () {
        const row = yield* requireRow(familiarId);
        if (row.archived_at !== null) return;
        const day = yield* today;
        if (blocked(row, day)) {
          const held = holdWake(WakesJson.decode(row.held_wakes_json), wake);
          yield* orDie(sql`
            UPDATE annex_familiars SET held_wakes_json = ${WakesJson.encode(held)}
            WHERE familiar_id = ${familiarId}
          `);
          return yield* saved(familiarId);
        }
        yield* sendToChannel(row, wakeMessage([wake]));
        yield* countRun(row);
        yield* saved(familiarId);
      }),
    );
  });

  const onWake = Effect.fn("FamiliarService.onWake")(function* (wake: GeasWake) {
    const channel = familiarChannels.get(wake.enactedByThreadId);
    if (channel === undefined) return;
    const events = mergeWakeEvents(
      pendingWakes.get(wake.geasId) ?? [],
      wake.event === null ? [] : [wake.event],
    );
    if (!wake.idle) {
      pendingWakes.set(wake.geasId, events);
      return;
    }
    pendingWakes.delete(wake.geasId);
    if (events.length === 0) return;
    yield* deliverWake(channel.familiarId, {
      geasId: wake.geasId,
      key: wake.key,
      title: wake.title,
      threadId: wake.threadId,
      events,
      at: yield* now,
    });
  });

  const seenRoutineMessages = new Set<string>();

  const onChannelEvent = Effect.fn("FamiliarService.onChannelEvent")(function* (
    event: OrchestrationV2DomainEvent,
  ) {
    const channel = familiarChannels.get(event.threadId);
    if (channel === undefined) return;
    if (event.type === "thread.deleted") {
      // The channel is the Familiar's identity; without it the Familiar is archived for good.
      return yield* withLock(channel.familiarId)(
        Effect.gen(function* () {
          const at = yield* now;
          yield* orDie(sql`
            UPDATE annex_familiars SET archived_at = COALESCE(archived_at, ${at}), updated_at = ${at}
            WHERE familiar_id = ${channel.familiarId}
          `);
          const row = yield* requireRow(channel.familiarId);
          yield* holdRoutines(row);
          yield* saved(channel.familiarId);
        }),
      );
    }
    if (event.type !== "message.updated") return;
    const message = event.payload;
    if (message.role !== "user" || seenRoutineMessages.has(message.id)) return;
    seenRoutineMessages.add(message.id);
    if (message.id.startsWith(WAKE_MESSAGE_PREFIX)) return;
    if (message.scheduledTaskId !== undefined) {
      return yield* withLock(channel.familiarId)(
        Effect.flatMap(requireRow(channel.familiarId), (row) =>
          Effect.andThen(countRun(row), saved(channel.familiarId)),
        ),
      );
    }
    if (message.createdBy === "user") {
      // Your message is the moment to hand over what waited, unless you paused it.
      yield* withLock(channel.familiarId)(
        Effect.gen(function* () {
          const row = yield* requireRow(channel.familiarId);
          const wakes = WakesJson.decode(row.held_wakes_json);
          if (row.paused_at !== null || wakes.length === 0) return;
          yield* orDie(sql`
            UPDATE annex_familiars SET held_wakes_json = '[]' WHERE familiar_id = ${row.familiar_id}
          `);
          yield* sendToChannel(row, wakeMessage(wakes));
          yield* saved(row.familiar_id);
        }),
      );
    }
  });

  /** Holds any routine enabled on a blocked Familiar's channel, such as one made while paused. */
  const onTaskList = Effect.fn("FamiliarService.onTaskList")(function* (
    tasks: ReadonlyArray<ScheduledTask>,
  ) {
    const day = yield* today;
    for (const task of tasks) {
      if (!task.enabled || task.threadId === null) continue;
      const channel = familiarChannels.get(task.threadId);
      if (channel === undefined) continue;
      const row = yield* selectRow(channel.familiarId);
      if (row === undefined || !blocked(row, day)) continue;
      yield* withLock(row.familiar_id)(holdRoutines(row));
      yield* saved(row.familiar_id);
    }
  });

  const tick = Effect.gen(function* () {
    const rows = yield* orDie(
      sql<FamiliarRow>`SELECT * FROM annex_familiars WHERE archived_at IS NULL`,
    );
    for (const row of rows) {
      yield* withLock(row.familiar_id)(release(row.familiar_id));
      const after = yield* selectRow(row.familiar_id);
      const changed =
        after === undefined ||
        after.runs_today !== row.runs_today ||
        after.held_task_ids_json !== row.held_task_ids_json ||
        after.held_wakes_json !== row.held_wakes_json;
      if (changed) yield* saved(row.familiar_id);
    }
  }).pipe(Effect.catchCause((cause) => Effect.logWarning("familiar tick failed", { cause })));

  const logged =
    (what: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning(`familiar ${what} failed`, { cause }),
        ),
      );

  yield* loadChannels;
  yield* geas.streamWakes.pipe(
    Stream.runForEach((wake) => logged("wake")(onWake(wake))),
    Effect.forkScoped,
  );
  yield* threads.streamDomainEvents.pipe(
    Stream.runForEach((event) => logged("channel event")(onChannelEvent(event))),
    Effect.catchCause((cause) => Effect.logWarning("familiar event stream ended", { cause })),
    Effect.forkScoped,
  );
  yield* scheduledTasks.subscribeList().pipe(
    Stream.runForEach((result) => logged("routine check")(onTaskList(result.tasks))),
    Effect.catchCause((cause) => Effect.logWarning("familiar routine stream ended", { cause })),
    Effect.forkScoped,
  );
  // The budget day rolls over on the server's clock; held routines and wakes return then.
  yield* tick.pipe(Effect.repeat(Schedule.spaced("5 minutes")), Effect.forkScoped);

  return FamiliarService.of({
    subscribe,
    summon,
    update,
    writeTome,
    setPaused,
    setDismissed,
    configureInstance,
    getForChannel,
    readTome,
    writeTomeAsAgent,
  });
});

export const layer = Layer.effect(FamiliarService, make);
