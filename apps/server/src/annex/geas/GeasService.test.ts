import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as GeasService from "./GeasService.ts";

const projectId = ProjectId.make("project-annex");
const modelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "claude-haiku-5-5" };

function makeHarness() {
  const launches: Array<ThreadLaunchService.ThreadLaunchInput> = [];
  const sends: Array<ThreadManagementService.ThreadManagementSendInput> = [];
  const dispatched: Array<string> = [];
  let sent = 0;
  const layer = GeasService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: (input) =>
            Effect.sync(() => {
              launches.push(input);
              const threadId = input.threadId!;
              return {
                threadId,
                resumed: false,
                projection: {
                  runs: [{ id: "run-1", userMessageId: input.initialMessage!.messageId }],
                } as unknown as OrchestrationV2ThreadProjection,
              };
            }),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          sendToThread: (input) =>
            Effect.sync(() => {
              sends.push(input);
              sent += 1;
              return { run: { id: `run-sent-${sent}` } } as never;
            }),
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command.type);
              return { sequence: 0 } as never;
            }),
          settleThread: () => Effect.sync(() => dispatched.push("settle") as never),
          getThreadShell: () => Effect.succeed(null),
          streamDomainEvents: Stream.never,
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({ title: "Annex", workspaceRoot: "/tmp/annex" } as never),
        }),
        Layer.fresh(SqlitePersistence.layerMemory),
        ServerConfig.layerTest(process.cwd(), { prefix: "annex-geas-test-" }),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
  return { layer, launches, sends, dispatched };
}

const runEnded = (threadId: ThreadId, runId: string, status = "completed") =>
  ({
    type: "run.updated",
    threadId,
    payload: { id: runId, status },
  }) as unknown as OrchestrationV2DomainEvent;

const enact = (geas: GeasService.GeasService["Service"]) =>
  geas.enact(
    {
      projectId,
      request: "Make the sidebar faster.",
      workspace: { type: "worktree", baseRef: "main" },
      modelSelection,
    },
    { actor: "user", creationSource: "web" },
  );

const detailOf = (geas: GeasService.GeasService["Service"], geasId: string) =>
  geas.subscribeGeas(geasId as never).pipe(Stream.runHead, Effect.map(Option.getOrThrow));

describe("GeasService", () => {
  it.effect("enacts a geas into its own thread that never auto-settles", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const geas = yield* GeasService.GeasService;
      const { geasId, key } = yield* enact(geas);
      assert.strictEqual(key, "ANX-1");
      const [launch] = harness.launches;
      assert.strictEqual(launch?.title, "ANX-1 · Make the sidebar faster.");
      assert.include(launch?.initialMessage?.text, "## What was asked\nMake the sidebar faster.");
      assert.deepStrictEqual(harness.dispatched, ["thread.auto-settle.set"]);
      const detail = yield* detailOf(geas, geasId);
      assert.strictEqual(detail.status, "in_progress");
      assert.strictEqual(detail.runState, "running");
      assert.strictEqual((yield* enact(geas)).key, "ANX-2");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("flags a run that ends without a handoff, and your answer starts a fresh run", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const geas = yield* GeasService.GeasService;
      const { geasId } = yield* enact(geas);
      const threadId = harness.launches[0]!.threadId!;
      yield* geas.handleEvent(runEnded(threadId, "run-1"));
      const ended = yield* detailOf(geas, geasId);
      assert.strictEqual(ended.needsYou, true);
      assert.strictEqual(ended.runs[0]?.outcome, "no_handoff");

      yield* geas.comment({ geasId: ended.id, body: "Try virtualizing the list." });
      const [send] = harness.sends;
      assert.strictEqual(send?.mode, "queue");
      assert.strictEqual(send?.freshContext, true);
      assert.include(send?.text, "## New since your last run\n- User: Try virtualizing the list.");
      assert.strictEqual((yield* detailOf(geas, geasId)).needsYou, false);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("steers a running agent with your comment instead of starting a run", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const geas = yield* GeasService.GeasService;
      const { geasId } = yield* enact(geas);
      yield* geas.comment({ geasId, body: "Stop after the sidebar." });
      assert.strictEqual(harness.sends.length, 1);
      assert.strictEqual(harness.sends[0]?.mode, "auto");
      assert.strictEqual(harness.sends[0]?.text, "New on ANX-1: Stop after the sidebar.");
      assert.strictEqual((yield* detailOf(geas, geasId)).runs.length, 1);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("refuses stale report writes and gates review on proof", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const geas = yield* GeasService.GeasService;
      const { geasId } = yield* enact(geas);
      const threadId = ThreadId.make(harness.launches[0]!.threadId!);
      const report = { result: "", risks: [], proof: [], checks: [], details: "" };

      const gated = yield* geas
        .setStatusAsAgent({ threadId, status: "in_review" })
        .pipe(Effect.flip);
      assert.strictEqual(gated._tag, "GeasReviewGateError");

      const written = yield* geas.writeReport({
        threadId,
        expectedRevision: 0,
        report: {
          ...report,
          result: "The sidebar renders in 4 ms.",
          proof: [{ type: "markdown", markdown: "Before 40 ms, after 4 ms." }],
        },
      });
      assert.strictEqual(written.revision, 1);
      const stale = yield* geas
        .writeReport({ threadId, expectedRevision: 0, report })
        .pipe(Effect.flip);
      assert.strictEqual(stale._tag, "GeasStaleReportError");

      yield* geas.setStatusAsAgent({ threadId, status: "in_review" });
      assert.strictEqual((yield* detailOf(geas, geasId)).status, "in_review");
    }).pipe(Effect.provide(harness.layer));
  });
});
