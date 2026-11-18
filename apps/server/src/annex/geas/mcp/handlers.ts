import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { GeasService } from "../GeasService.ts";
import { GeasToolkit } from "./tools.ts";

const invalid = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

/** Optional so upstream's MCP tests, which build the server without geasa, need no changes. */
const build = Effect.gen(function* () {
  const service = Option.getOrUndefined(yield* Effect.serviceOption(GeasService));

  const asGeasThread = Effect.fn("GeasMcp.asGeasThread")(function* <A, R>(
    run: (
      geas: GeasService["Service"],
      threadId: ThreadId,
    ) => Effect.Effect<A, { readonly message: string }, R>,
  ) {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const thread = yield* McpInvocationContext.requireThreadScope(scope, "Geas tools");
    if (service === undefined) {
      return yield* new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: "Geasa are not available on this server.",
      });
    }
    return yield* run(service, thread.thread.threadId).pipe(Effect.mapError(invalid));
  });

  const callerShell = Effect.fn("GeasMcp.callerShell")(function* (threadId: ThreadId) {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const caller = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
    if (caller === null) return yield* invalid({ message: "The calling thread was not found." });
    return caller;
  });

  return {
    geas_get: McpToolAccess.reads(() =>
      asGeasThread((geas, threadId) => geas.getForThread(threadId)),
    ),
    geas_report_write: McpToolAccess.writesWithCapability(({ expectedRevision, report }) =>
      asGeasThread((geas, threadId) => geas.writeReport({ threadId, expectedRevision, report })),
    ),
    geas_set_status: McpToolAccess.writesWithCapability(({ status }) =>
      asGeasThread((geas, threadId) => geas.setStatusAsAgent({ threadId, status })),
    ),
    geas_comment: McpToolAccess.writesWithCapability(({ body, notify, actions }) =>
      asGeasThread((geas, threadId) =>
        geas.commentAsAgent({ threadId, body, notify: notify ?? false, actions: actions ?? [] }),
      ),
    ),
    geas_attach_media: McpToolAccess.writesWithCapability(({ path }) =>
      asGeasThread((geas, threadId) => geas.attachMedia({ threadId, path })),
    ),
    geas_enact: McpToolAccess.writesWithCapability(({ request, title, priority, start }) =>
      asGeasThread((geas, threadId) =>
        Effect.gen(function* () {
          const caller = yield* callerShell(threadId);
          return yield* geas.enact(
            {
              projectId: caller.projectId,
              request,
              ...(title === undefined ? {} : { title }),
              ...(priority === undefined ? {} : { priority }),
              workspace: { type: "worktree", baseRef: caller.branch ?? "HEAD" },
              modelSelection: caller.modelSelection,
              runtimeMode: caller.runtimeMode,
              interactionMode: caller.interactionMode,
              backlog: start !== true,
            },
            { actor: "agent", creationSource: "mcp" },
          );
        }),
      ),
    ),
    geas_project_settings: McpToolAccess.writesWithCapability((changes) =>
      asGeasThread((geas, threadId) =>
        Effect.gen(function* () {
          const caller = yield* callerShell(threadId);
          return yield* geas.updateProjectSettings({ projectId: caller.projectId, ...changes });
        }),
      ),
    ),
  } satisfies McpToolAccess.Handlers<typeof GeasToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(GeasToolkit, build);
