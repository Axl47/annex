import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { OrchestrationV2ThreadLaunchWorkspaceStrategy } from "../orchestrationV2.ts";
import { ProviderInteractionMode, RuntimeMode } from "../providerPolicy.ts";
import { GitStackedAction } from "../git.ts";

// A geas is Annex's issue mode: one piece of work whose deliverable is a typed report.
// Upstream uses "issue" for external trackers and "task" for delegated work, hence the name.

export const GEAS_COMMENT_MAX_LENGTH = 400;
/** Runs agents may start on one geas between two of the user's comments. */
export const GEAS_AGENT_RUN_LIMIT = 10;
export const GEAS_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const GEAS_KEY_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,7}$/;

export const GeasId = TrimmedNonEmptyString.pipe(Schema.brand("GeasId"));
export type GeasId = typeof GeasId.Type;

export const GeasStatus = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);
export type GeasStatus = typeof GeasStatus.Type;

export const GeasPriority = Schema.Literals(["none", "low", "medium", "high", "urgent"]);
export type GeasPriority = typeof GeasPriority.Type;

/** Where a geas's latest run stands, apart from its status. `waiting` is an approval or question. */
export const GeasRunState = Schema.Literals(["idle", "running", "waiting"]);
export type GeasRunState = typeof GeasRunState.Type;

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const Caption = Schema.optional(Schema.String.check(Schema.isMaxLength(500)));

export const GeasMediaRef = Schema.Struct({
  attachmentId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  kind: Schema.Literals(["image", "video"]),
  alt: Schema.String.check(Schema.isMaxLength(500)),
});
export type GeasMediaRef = typeof GeasMediaRef.Type;

export const GeasProofBlock = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("compare"),
    before: GeasMediaRef,
    after: GeasMediaRef,
    caption: Caption,
  }),
  Schema.Struct({
    type: Schema.Literal("media"),
    items: Schema.Array(GeasMediaRef).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
    caption: Caption,
  }),
  Schema.Struct({
    type: Schema.Literal("table"),
    columns: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
    rows: Schema.Array(Schema.Array(Schema.String)).check(Schema.isMaxLength(200)),
    caption: Caption,
  }),
  Schema.Struct({
    type: Schema.Literal("markdown"),
    markdown: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)),
    caption: Caption,
  }),
]);
export type GeasProofBlock = typeof GeasProofBlock.Type;

export const GeasCheckDeclaration = Schema.Struct({
  label: ShortText,
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(1000)),
});
export type GeasCheckDeclaration = typeof GeasCheckDeclaration.Type;

export const GeasCheckStatus = Schema.Literals(["passed", "failed", "unverified"]);
export type GeasCheckStatus = typeof GeasCheckStatus.Type;

/** A declared check with the result the server read from the thread; agents cannot set it. */
export const GeasCheck = Schema.Struct({
  ...GeasCheckDeclaration.fields,
  status: GeasCheckStatus,
  exitCode: Schema.NullOr(Schema.Int),
  verifiedAt: Schema.NullOr(IsoDateTime),
});
export type GeasCheck = typeof GeasCheck.Type;

const ReportFields = {
  result: Schema.String.check(Schema.isMaxLength(4000)),
  risks: Schema.Array(Schema.String.check(Schema.isMaxLength(1000))).check(Schema.isMaxLength(20)),
  proof: Schema.Array(GeasProofBlock).check(Schema.isMaxLength(20)),
  details: Schema.String.check(Schema.isMaxLength(40_000)),
};

export const GeasReport = Schema.Struct({
  ...ReportFields,
  checks: Schema.Array(GeasCheck),
});
export type GeasReport = typeof GeasReport.Type;

export const GeasReportInput = Schema.Struct({
  ...ReportFields,
  checks: Schema.Array(GeasCheckDeclaration).check(Schema.isMaxLength(20)),
});
export type GeasReportInput = typeof GeasReportInput.Type;

export const EMPTY_GEAS_REPORT: GeasReport = {
  result: "",
  risks: [],
  proof: [],
  checks: [],
  details: "",
};

/** What a move to In review still lacks; empty when the report passes the gate. */
export function geasReviewGateMissing(report: GeasReport): ReadonlyArray<string> {
  const missing: Array<string> = [];
  if (report.result.trim() === "") missing.push("a result");
  if (report.proof.length === 0 && !report.checks.some((check) => check.status === "passed")) {
    missing.push("at least one proof block or a passed check");
  }
  return missing;
}

const ActionPrimary = { primary: Schema.optional(Schema.Boolean) };

export const GeasSuggestedAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("prompt"),
    label: ShortText,
    prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
    ...ActionPrimary,
  }),
  Schema.Struct({
    type: Schema.Literal("options"),
    label: ShortText,
    options: Schema.Array(ShortText).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
    ...ActionPrimary,
  }),
  Schema.Struct({
    type: Schema.Literal("status"),
    label: ShortText,
    status: GeasStatus,
    ...ActionPrimary,
  }),
  Schema.Struct({
    type: Schema.Literal("git"),
    label: ShortText,
    action: GitStackedAction,
    ...ActionPrimary,
  }),
]);
export type GeasSuggestedAction = typeof GeasSuggestedAction.Type;

export const GeasActivityAuthor = Schema.Literals(["user", "agent", "server"]);
export type GeasActivityAuthor = typeof GeasActivityAuthor.Type;

export const GeasEventType = Schema.Literals([
  "enacted",
  "run_started",
  "run_ended",
  "run_failed",
  "no_handoff",
  "status_changed",
  "report_updated",
  "loop_guard",
  "comment_queued",
  "thread_deleted",
]);
export type GeasEventType = typeof GeasEventType.Type;

export const GeasActivity = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals(["comment", "event"]),
  eventType: Schema.NullOr(GeasEventType),
  author: GeasActivityAuthor,
  body: Schema.String,
  notify: Schema.Boolean,
  actions: Schema.Array(GeasSuggestedAction),
  runId: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type GeasActivity = typeof GeasActivity.Type;

export const GeasRunOutcome = Schema.Literals([
  "handed_off",
  "no_handoff",
  "failed",
  "interrupted",
]);
export type GeasRunOutcome = typeof GeasRunOutcome.Type;

export const GeasRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadRunId: Schema.NullOr(TrimmedNonEmptyString),
  startedBy: Schema.Literals(["user", "agent"]),
  modelSelection: ModelSelection,
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
  outcome: Schema.NullOr(GeasRunOutcome),
});
export type GeasRun = typeof GeasRun.Type;

export const GeasDeliveryAction = Schema.Struct({
  label: ShortText,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
});
export type GeasDeliveryAction = typeof GeasDeliveryAction.Type;

export const DEFAULT_GEAS_DELIVERY_ACTIONS: ReadonlyArray<GeasDeliveryAction> = [
  { label: "Land it", prompt: "Land this." },
  { label: "Full Stop", prompt: "Use Full Stop." },
];

export const GrimoireProjectSettings = Schema.Struct({
  projectId: ProjectId,
  keyPrefix: TrimmedNonEmptyString,
  deliveryActions: Schema.Array(GeasDeliveryAction).check(Schema.isMaxLength(8)),
  /** The commands the server vouches for. With none listed, any declared command is matched. */
  checks: Schema.Array(GeasCheckDeclaration).check(Schema.isMaxLength(20)),
  /** Added to the default geas rules for this project's runs. */
  rules: Schema.String.check(Schema.isMaxLength(4000)),
});
export type GrimoireProjectSettings = typeof GrimoireProjectSettings.Type;

export const GrimoireRow = Schema.Struct({
  id: GeasId,
  projectId: ProjectId,
  key: TrimmedNonEmptyString,
  title: Schema.String,
  status: GeasStatus,
  priority: GeasPriority,
  labels: Schema.Array(Schema.String),
  threadId: Schema.NullOr(ThreadId),
  runState: GeasRunState,
  needsYou: Schema.Boolean,
  modelSelection: ModelSelection,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastActivityAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
});
export type GrimoireRow = typeof GrimoireRow.Type;

export const GrimoireSnapshot = Schema.Struct({
  geasa: Schema.Array(GrimoireRow),
  projects: Schema.Array(GrimoireProjectSettings),
});
export type GrimoireSnapshot = typeof GrimoireSnapshot.Type;

export const GeasDetail = Schema.Struct({
  ...GrimoireRow.fields,
  request: Schema.String,
  workspace: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  report: GeasReport,
  reportRevision: Schema.Int,
  activity: Schema.Array(GeasActivity),
  runs: Schema.Array(GeasRun),
  settings: GrimoireProjectSettings,
});
export type GeasDetail = typeof GeasDetail.Type;

export class GeasError extends Schema.TaggedError<GeasError>()("GeasError", {
  message: Schema.String,
  geasId: Schema.optional(GeasId),
}) {}

export const GrimoireSubscribeInput = Schema.Struct({
  includeArchived: Schema.optional(Schema.Boolean),
});
export type GrimoireSubscribeInput = typeof GrimoireSubscribeInput.Type;

export const GeasSubscribeInput = Schema.Struct({ geasId: GeasId });
export type GeasSubscribeInput = typeof GeasSubscribeInput.Type;

export const GeasEnactInput = Schema.Struct({
  projectId: ProjectId,
  request: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  workspace: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  modelSelection: ModelSelection,
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  priority: Schema.optional(GeasPriority),
  labels: Schema.optional(Schema.Array(ShortText).check(Schema.isMaxLength(10))),
  /** Save without starting a run. */
  backlog: Schema.optional(Schema.Boolean),
});
export type GeasEnactInput = typeof GeasEnactInput.Type;

export const GeasEnactResult = Schema.Struct({ geasId: GeasId, key: TrimmedNonEmptyString });
export type GeasEnactResult = typeof GeasEnactResult.Type;

export const GeasUpdateInput = Schema.Struct({
  geasId: GeasId,
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  status: Schema.optional(GeasStatus),
  priority: Schema.optional(GeasPriority),
  labels: Schema.optional(Schema.Array(ShortText).check(Schema.isMaxLength(10))),
});
export type GeasUpdateInput = typeof GeasUpdateInput.Type;

export const GeasCommentInput = Schema.Struct({
  geasId: GeasId,
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  /** Hold it for the next fresh run instead of steering a run that is going. */
  queue: Schema.optional(Schema.Boolean),
});
export type GeasCommentInput = typeof GeasCommentInput.Type;

/** Git actions run on the client through the existing git RPC, so they never reach `act`. */
export const GeasActInput = Schema.Struct({
  geasId: GeasId,
  action: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("prompt"),
      prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
    }),
    Schema.Struct({
      type: Schema.Literal("options"),
      question: Schema.String.check(Schema.isMaxLength(200)),
      selected: Schema.Array(ShortText).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
    }),
    Schema.Struct({ type: Schema.Literal("status"), status: GeasStatus }),
  ]),
});
export type GeasActInput = typeof GeasActInput.Type;

export const GeasRunAgainInput = Schema.Struct({
  geasId: GeasId,
  modelSelection: Schema.optional(ModelSelection),
});
export type GeasRunAgainInput = typeof GeasRunAgainInput.Type;

export const GeasArchiveInput = Schema.Struct({ geasId: GeasId, archived: Schema.Boolean });
export type GeasArchiveInput = typeof GeasArchiveInput.Type;

export const GrimoireUpdateProjectSettingsInput = Schema.Struct({
  projectId: ProjectId,
  keyPrefix: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isPattern(GEAS_KEY_PREFIX_PATTERN)),
  ),
  deliveryActions: Schema.optional(GrimoireProjectSettings.fields.deliveryActions),
  checks: Schema.optional(GrimoireProjectSettings.fields.checks),
  rules: Schema.optional(GrimoireProjectSettings.fields.rules),
});
export type GrimoireUpdateProjectSettingsInput = typeof GrimoireUpdateProjectSettingsInput.Type;

export const GeasMutationResult = Schema.Struct({ geasId: GeasId });
export type GeasMutationResult = typeof GeasMutationResult.Type;
