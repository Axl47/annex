import {
  FAMILIAR_TOME_MAX_BYTES,
  GEAS_COMMENT_MAX_LENGTH,
  GeasDetail,
  GeasStatus,
  GrimoireRow,
  OrchestratorMcpFailure,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { familiarChannels } from "../familiarThreads.ts";

/** Listed only in a Familiar's channel, so ordinary threads never pay for these tools. */
const listedInFamiliarChannels = (): boolean => {
  const fiber = Fiber.getCurrent();
  const scope =
    fiber && Context.getOrUndefined(fiber.context, McpInvocationContext.McpInvocationContext);
  return scope?.thread !== undefined && familiarChannels.has(scope.thread.threadId);
};

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const familiarTool = <T extends Tool.Any>(tool: T) =>
  tool
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Destructive, false)
    .annotate(McpSchema.EnabledWhen, listedInFamiliarChannels) as T;

const FamiliarTomeTool = familiarTool(
  Tool.make("familiar_tome", {
    ...shared,
    description: `Read or write your Tome, the notes that survive compaction and new sessions. Pass nothing to read it. Pass append to add one line. Pass content with the expectedRevision you read to replace it; a stale revision fails with the current Tome. At most ${FAMILIAR_TOME_MAX_BYTES / 1024} KB; never store secrets.`,
    parameters: Schema.Struct({
      append: Schema.optionalKey(
        TrimmedNonEmptyString.check(Schema.isMaxLength(2000)).annotate({
          description: "One line to add at the end.",
        }),
      ),
      content: Schema.optionalKey(
        Schema.String.annotate({ description: "The whole new Tome, in markdown." }),
      ),
      expectedRevision: Schema.optionalKey(
        Schema.Int.annotate({ description: "The revision you read; required with content." }),
      ),
    }),
    success: Schema.Struct({
      tome: Schema.optionalKey(Schema.String),
      revision: Schema.Int,
      bytes: Schema.optionalKey(Schema.Int),
    }),
  }),
);

const GrimoireListTool = familiarTool(
  Tool.make("grimoire_list", {
    ...shared,
    description:
      "List geasa on this environment, newest activity first. By default only the ones you laid; pass all to see every geas.",
    parameters: Schema.Struct({
      all: Schema.optionalKey(
        Schema.Boolean.annotate({ description: "Include geasa you didn't lay." }),
      ),
      status: Schema.optionalKey(GeasStatus),
      projectId: Schema.optionalKey(ProjectId),
    }),
    success: Schema.Struct({ geasa: Schema.Array(GrimoireRow) }),
  }).annotate(Tool.Readonly, true),
);

const GrimoireReadTool = familiarTool(
  Tool.make("grimoire_read", {
    ...shared,
    description:
      "Read one geas by key, such as SYNC-12: its request, status, report and recent activity.",
    parameters: Schema.Struct({ key: TrimmedNonEmptyString }),
    success: GeasDetail,
  }).annotate(Tool.Readonly, true),
);

const GrimoireCommentTool = familiarTool(
  Tool.make("grimoire_comment", {
    ...shared,
    description: `Comment on a geas by key, at most ${GEAS_COMMENT_MAX_LENGTH} characters. A running agent gets it now, or with queue at its next run; an idle geas starts a run if your autonomy allows. It never approves delivery, and it is refused once the geas's loop guard has stopped agents.`,
    parameters: Schema.Struct({
      key: TrimmedNonEmptyString,
      body: TrimmedNonEmptyString.check(Schema.isMaxLength(GEAS_COMMENT_MAX_LENGTH)),
      queue: Schema.optionalKey(
        Schema.Boolean.annotate({ description: "Hold it for the next run instead." }),
      ),
    }),
    success: Schema.Struct({ geasId: Schema.String }),
  }),
);

export const FamiliarToolkit = Toolkit.make(
  FamiliarTomeTool,
  GrimoireListTool,
  GrimoireReadTool,
  GrimoireCommentTool,
);
