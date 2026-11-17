import {
  GEAS_COMMENT_MAX_LENGTH,
  GeasDetail,
  GeasPriority,
  GeasReport,
  GeasReportInput,
  GeasStatus,
  GeasSuggestedAction,
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { geasThreads } from "../geasThreads.ts";

/** Listed only to the thread a geas runs in, so ordinary threads never pay for these tools. */
const listedInGeasThreads = (): boolean => {
  const fiber = Fiber.getCurrent();
  const scope =
    fiber && Context.getOrUndefined(fiber.context, McpInvocationContext.McpInvocationContext);
  return scope?.thread !== undefined && geasThreads.has(scope.thread.threadId);
};

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const geasTool = <T extends Tool.Any>(tool: T) =>
  tool.annotate(Tool.OpenWorld, false).annotate(McpSchema.EnabledWhen, listedInGeasThreads) as T;

const GeasGetTool = geasTool(
  Tool.make("geas_get", {
    ...shared,
    description:
      "Read the geas this thread works on: the request, status, report with its revision, and the activity feed. Read it before writing the report.",
    // No `parameters`: an empty Struct advertises an input schema MCP clients reject.
    success: GeasDetail,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);

const GeasReportWriteTool = geasTool(
  Tool.make("geas_report_write", {
    ...shared,
    description:
      "Replace this geas's report, the deliverable the user reviews. Pass the whole report and the revision you last read; a stale revision fails with the current report so you can merge. Declare checks as the exact commands you ran: the server sets each status from that command's real exit code.",
    parameters: Schema.Struct({
      expectedRevision: Schema.Int.annotate({
        description: "The report revision you read, from geas_get or your run message.",
      }),
      report: GeasReportInput,
    }),
    success: Schema.Struct({ revision: Schema.Int, report: GeasReport }),
  }).annotate(Tool.Destructive, false),
);

const GeasSetStatusTool = geasTool(
  Tool.make("geas_set_status", {
    ...shared,
    description:
      "Move this geas. in_review needs a result and proof or a passed check in the report. todo when waiting on someone, done after delivering what the user approved, canceled when it should not happen.",
    parameters: Schema.Struct({ status: GeasStatus }),
    success: Schema.Struct({ status: GeasStatus }),
  }).annotate(Tool.Destructive, false),
);

const GeasCommentTool = geasTool(
  Tool.make("geas_comment", {
    ...shared,
    description: `Post a chat-sized comment on this geas: the outcome in one line, then the question or action, at most ${GEAS_COMMENT_MAX_LENGTH} characters. notify or actions mark the geas as needing the user.`,
    parameters: Schema.Struct({
      body: TrimmedNonEmptyString.check(Schema.isMaxLength(GEAS_COMMENT_MAX_LENGTH)),
      notify: Schema.optionalKey(
        Schema.Boolean.annotate({ description: "Ask for the user's attention." }),
      ),
      actions: Schema.optionalKey(
        Schema.Array(GeasSuggestedAction).check(Schema.isMaxLength(4)).annotate({
          description: "Buttons the user can press to answer. Mark one primary.",
        }),
      ),
    }),
    success: Schema.Struct({ activityId: Schema.String }),
  }).annotate(Tool.Destructive, false),
);

const GeasAttachMediaTool = geasTool(
  Tool.make("geas_attach_media", {
    ...shared,
    description:
      "Store a screenshot or a short clip (up to 50 MB) for the report; a relative path resolves in this checkout. Returns the attachmentId to use in a compare or media proof block.",
    parameters: Schema.Struct({
      path: TrimmedNonEmptyString.annotate({
        description: "The file, absolute or relative to this thread's checkout.",
      }),
    }),
    success: Schema.Struct({
      attachmentId: Schema.String,
      kind: Schema.Literals(["image", "video"]),
    }),
  }).annotate(Tool.Destructive, false),
);

const GeasEnactTool = Tool.make("geas_enact", {
  ...shared,
  description:
    "File a new geas in this thread's project, only when the user asks for one. It lands in the backlog unless `start` is true, and runs with this thread's model and modes.",
  parameters: Schema.Struct({
    request: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)).annotate({
      description: "What to do, written so a fresh agent can act on it alone.",
    }),
    title: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
    priority: Schema.optionalKey(GeasPriority),
    start: Schema.optionalKey(
      Schema.Boolean.annotate({ description: "Start a run now instead of filing it." }),
    ),
  }),
  success: Schema.Struct({ geasId: Schema.String, key: Schema.String }),
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const GeasToolkit = Toolkit.make(
  GeasGetTool,
  GeasReportWriteTool,
  GeasSetStatusTool,
  GeasCommentTool,
  GeasAttachMediaTool,
  GeasEnactTool,
);
