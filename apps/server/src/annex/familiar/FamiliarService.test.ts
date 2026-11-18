import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ClaudeSettings,
  GeasId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type Familiar,
  type OrchestrationV2DomainEvent,
  type ScheduledTask,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../../config.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { GeasService, type GeasWake } from "../geas/GeasService.ts";
import { runAnnexMigrations } from "../migrations.ts";
import * as FamiliarService from "./FamiliarService.ts";
import { familiarChannels } from "./familiarThreads.ts";

const projectId = ProjectId.make("project-annex");
const decodeClaudeConfig = Schema.decodeUnknownEffect(ClaudeSettings);
const modelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "claude-haiku-5-5" };

const withHarness = <A, E>(
  body: (
    harness: Harness,
  ) => Effect.Effect<A, E, FamiliarService.FamiliarService | ServerSettings.ServerSettingsService>,
) =>
  Effect.gen(function* () {
    // Queues, not PubSubs: the service subscribes from a forked fiber, possibly after a test offers.
    const harness = makeHarness(
      yield* Queue.unbounded<GeasWake>(),
      yield* Queue.unbounded<OrchestrationV2DomainEvent>(),
    );
    return yield* body(harness).pipe(Effect.provide(harness.layer));
  });

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(
  wakes: Queue.Queue<GeasWake>,
  events: Queue.Queue<OrchestrationV2DomainEvent>,
) {
  const sends: Array<ThreadManagementService.ThreadManagementSendInput> = [];
  const dispatched: Array<{ readonly type: string; readonly enabled?: boolean }> = [];
  const tasks = new Map<string, ScheduledTask>();
  const sql = Layer.effectDiscard(Effect.orDie(runAnnexMigrations)).pipe(
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  );
  const layer = FamiliarService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: (input) =>
            Effect.succeed({
              threadId: input.threadId!,
              resumed: false,
              projection: null as never,
            }),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          sendToThread: (input) =>
            Effect.sync(() => {
              sends.push(input);
              return {} as never;
            }),
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command as never);
              return { sequence: 0 } as never;
            }),
          getThreadShell: () => Effect.succeed({ deletedAt: null } as never),
          streamDomainEvents: Stream.fromQueue(events),
        }),
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({
          list: () => Effect.sync(() => ({ tasks: [...tasks.values()] }) as never),
          setEnabled: (input) =>
            Effect.sync(() => {
              const task = tasks.get(input.id);
              if (task !== undefined) tasks.set(input.id, { ...task, enabled: input.enabled });
              return {} as never;
            }),
          subscribeList: () => Stream.never,
        }),
        Layer.mock(GeasService)({ streamWakes: Stream.fromQueue(wakes) }),
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest({})),
    Layer.provideMerge(sql),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "annex-familiar-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  return { layer, sends, dispatched, tasks, wakes, events };
}

const summonSync = Effect.gen(function* () {
  const service = yield* FamiliarService.FamiliarService;
  const { familiarId } = yield* service.summon({
    name: "Sync",
    rolePrompt: "Keep Annex on upstream.",
    projectId,
    modelSelection,
    dailyRunBudget: 2,
  });
  return familiarId;
});

/** The first snapshot of the Familiar that satisfies `ready`, so tests await state, not time. */
const familiarWhen = (familiarId: string, ready: (familiar: Familiar) => boolean) =>
  Effect.flatMap(FamiliarService.FamiliarService, (service) =>
    service.subscribe({ includeArchived: true }).pipe(
      Stream.map((snapshot) => snapshot.familiars.find((familiar) => familiar.id === familiarId)),
      Stream.filter((familiar): familiar is Familiar => familiar !== undefined && ready(familiar)),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    ),
  );

const routine = (
  id: string,
  threadId: ThreadId,
  enabled: boolean,
  schedule: ScheduledTask["schedule"] = { type: "interval", everyMinutes: 60 } as never,
) =>
  [
    id,
    { id: ScheduledTaskId.make(id), threadId, title: id, enabled, schedule } as ScheduledTask,
  ] as const;

const routineMessage = (threadId: ThreadId, id: string) =>
  ({
    type: "message.updated",
    threadId,
    payload: {
      id: MessageId.make(id),
      role: "user",
      createdBy: "system",
      scheduledTaskId: ScheduledTaskId.make("routine-1"),
      text: "Check upstream.",
    },
  }) as unknown as OrchestrationV2DomainEvent;

describe("FamiliarService", () => {
  it.effect("summons a pinned channel that never auto-settles", () => {
    return withHarness((harness) =>
      Effect.gen(function* () {
        const familiarId = yield* summonSync;
        const familiar = yield* familiarWhen(familiarId, () => true);
        assert.isTrue(familiarChannels.has(familiar.threadId!));
        assert.deepStrictEqual(
          harness.dispatched.map(({ type, enabled }) => ({ type, enabled })),
          [
            { type: "thread.pin", enabled: undefined },
            { type: "thread.auto-settle.set", enabled: false },
          ],
        );
      }),
    );
  });

  it.effect("sets up a Claude · Familiars instance the Claude driver accepts", () => {
    return withHarness(() =>
      Effect.gen(function* () {
        const service = yield* FamiliarService.FamiliarService;
        const { instanceId } = yield* service.configureInstance({ compactAfter: 400_000 });
        const settings = yield* ServerSettings.ServerSettingsService;
        const instance = (yield* settings.getSettings).providerInstances[instanceId];
        const config = yield* decodeClaudeConfig(instance?.config);
        assert.deepInclude(config, { autoCompactWindow: "400000", idleCompaction: "off" });
      }),
    );
  });

  it.effect("pause holds exactly the enabled routines; resume brings back the ones it can", () => {
    return withHarness((harness) =>
      Effect.gen(function* () {
        const service = yield* FamiliarService.FamiliarService;
        const familiarId = yield* summonSync;
        const threadId = (yield* familiarWhen(familiarId, () => true)).threadId!;
        const soon = { type: "once", runAt: "1970-01-01T00:01:00.000Z" } as never;
        for (const entry of [
          routine("daily", threadId, true),
          routine("deleted", threadId, true),
          routine("off", threadId, false),
          routine("one-off", threadId, true, soon),
        ]) {
          harness.tasks.set(...entry);
        }

        yield* service.setPaused({ familiarId, paused: true });
        const paused = yield* familiarWhen(familiarId, (familiar) => familiar.pausedAt !== null);
        assert.deepStrictEqual([...paused.heldTaskIds].toSorted(), ["daily", "deleted", "one-off"]);
        assert.isFalse([...harness.tasks.values()].some((task) => task.enabled));

        harness.tasks.delete("deleted");
        yield* TestClock.adjust("2 minutes");
        const resumed = yield* service.setPaused({ familiarId, paused: false });
        assert.deepStrictEqual(resumed.skippedRoutines, ["a deleted routine (deleted)", "one-off"]);
        assert.isTrue(harness.tasks.get("daily")!.enabled);
        assert.isFalse(harness.tasks.get("off")!.enabled);
        assert.isFalse(harness.tasks.get("one-off")!.enabled);
        const after = yield* familiarWhen(familiarId, (familiar) => familiar.pausedAt === null);
        assert.deepStrictEqual(after.heldTaskIds, []);
      }),
    );
  });

  it.effect("holds routines once the day's budget is spent and releases them the next day", () => {
    return withHarness((harness) =>
      Effect.gen(function* () {
        const familiarId = yield* summonSync;
        const threadId = (yield* familiarWhen(familiarId, () => true)).threadId!;
        harness.tasks.set(...routine("routine-1", threadId, true));

        yield* Queue.offer(harness.events, routineMessage(threadId, "message-1"));
        yield* Queue.offer(harness.events, routineMessage(threadId, "message-1"));
        yield* Queue.offer(harness.events, routineMessage(threadId, "message-2"));
        const spent = yield* familiarWhen(familiarId, (familiar) => familiar.runsToday === 2);
        assert.deepStrictEqual(spent.heldTaskIds, [ScheduledTaskId.make("routine-1")]);
        assert.isFalse(harness.tasks.get("routine-1")!.enabled);

        yield* TestClock.adjust("1 day");
        const nextDay = yield* familiarWhen(familiarId, (familiar) => familiar.runsToday === 0);
        assert.deepStrictEqual(nextDay.heldTaskIds, []);
        assert.isTrue(harness.tasks.get("routine-1")!.enabled);
      }),
    );
  });

  it.effect("holds wakes while paused and delivers them as one message on resume", () => {
    return withHarness((harness) =>
      Effect.gen(function* () {
        const service = yield* FamiliarService.FamiliarService;
        const familiarId = yield* summonSync;
        const threadId = (yield* familiarWhen(familiarId, () => true)).threadId!;
        yield* service.setPaused({ familiarId, paused: true });
        const wake = {
          key: "SYNC-1",
          title: "Resolve the sidebar conflict",
          threadId: ThreadId.make("geas-thread-1"),
          enactedByThreadId: threadId,
        };
        yield* Queue.offer(harness.wakes, {
          ...wake,
          geasId: GeasId.make("geas-1"),
          event: "asked",
          idle: false,
        });
        yield* Queue.offer(harness.wakes, {
          ...wake,
          geasId: GeasId.make("geas-1"),
          event: "in_review",
          idle: true,
        });
        const held = yield* familiarWhen(familiarId, (familiar) => familiar.heldWakes.length > 0);
        assert.deepStrictEqual(held.heldWakes[0]!.events, ["asked", "in_review"]);
        assert.deepStrictEqual(harness.sends, []);

        yield* service.setPaused({ familiarId, paused: false });
        assert.deepStrictEqual(
          harness.sends.map(({ text, mode, createdBy }) => ({ text, mode, createdBy })),
          [
            {
              text: 'Wake: SYNC-1 "Resolve the sidebar conflict": asks for input; moved to In review. [SYNC-1](t3-thread://v1/geas-thread-1)',
              mode: "queue",
              createdBy: "system",
            },
          ],
        );
        const after = yield* familiarWhen(
          familiarId,
          (familiar) => familiar.heldWakes.length === 0,
        );
        assert.strictEqual(after.runsToday, 1);
      }),
    );
  });

  it.effect("archives the Familiar for good when its channel is deleted", () => {
    return withHarness((harness) =>
      Effect.gen(function* () {
        const familiarId = yield* summonSync;
        const threadId = (yield* familiarWhen(familiarId, () => true)).threadId!;
        harness.tasks.set(...routine("routine-1", threadId, true));
        yield* Queue.offer(harness.events, {
          type: "thread.deleted",
          threadId,
        } as unknown as OrchestrationV2DomainEvent);
        const archived = yield* familiarWhen(
          familiarId,
          (familiar) => familiar.archivedAt !== null,
        );
        assert.deepStrictEqual(archived.heldTaskIds, [ScheduledTaskId.make("routine-1")]);
        assert.isFalse(familiarChannels.has(threadId));
      }),
    );
  });
});
