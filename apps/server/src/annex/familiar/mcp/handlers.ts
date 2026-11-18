import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../../mcp/McpToolAccess.ts";
import { GeasService } from "../../geas/GeasService.ts";
import { FamiliarService } from "../FamiliarService.ts";
import type { FamiliarToolkit } from "./tools.ts";

const invalid = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

/** Optional so upstream's MCP tests, which build the server without Annex, need no changes. */
export const buildFamiliarMcpHandlers = Effect.gen(function* () {
  const familiars = Option.getOrUndefined(yield* Effect.serviceOption(FamiliarService));
  const geas = Option.getOrUndefined(yield* Effect.serviceOption(GeasService));

  const asChannel = Effect.fn("FamiliarMcp.asChannel")(function* <A, R>(
    run: (
      services: {
        readonly familiars: FamiliarService["Service"];
        readonly geas: GeasService["Service"];
      },
      threadId: ThreadId,
    ) => Effect.Effect<A, { readonly message: string }, R>,
  ) {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const thread = yield* McpInvocationContext.requireThreadScope(scope, "Familiar tools");
    if (familiars === undefined || geas === undefined) {
      return yield* new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: "Familiars are not available on this server.",
      });
    }
    return yield* run({ familiars, geas }, thread.thread.threadId).pipe(Effect.mapError(invalid));
  });

  return {
    familiar_tome: McpToolAccess.writesWithCapability((input) =>
      asChannel<
        { readonly tome?: string; readonly revision: number; readonly bytes?: number },
        never
      >(({ familiars }, threadId) =>
        input.append === undefined && input.content === undefined
          ? familiars.readTome(threadId)
          : familiars.writeTomeAsAgent({ threadId, ...input }),
      ),
    ),
    grimoire_list: McpToolAccess.reads(({ all, status, projectId }) =>
      asChannel(({ geas }, threadId) =>
        Effect.map(geas.listRows, (rows) => ({
          geasa: rows.filter(
            (row) =>
              (all === true || row.enactedByThreadId === threadId) &&
              (status === undefined || row.status === status) &&
              (projectId === undefined || row.projectId === projectId),
          ),
        })),
      ),
    ),
    grimoire_read: McpToolAccess.reads(({ key }) => asChannel(({ geas }) => geas.getByKey(key))),
    grimoire_comment: McpToolAccess.writesWithCapability(({ key, body, queue }) =>
      asChannel(({ familiars, geas }, threadId) =>
        Effect.flatMap(familiars.getForChannel(threadId), (familiar) =>
          geas.commentAsFamiliar({
            key,
            body,
            familiarName: familiar.name,
            queue: queue === true,
            mayStartRun: familiar.autonomy === "start",
          }),
        ),
      ),
    ),
  } satisfies McpToolAccess.Handlers<typeof FamiliarToolkit.tools>;
});
