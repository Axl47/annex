import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { ProviderInstanceId } from "../providerInstance.ts";
import { ProviderInteractionMode, RuntimeMode } from "../providerPolicy.ts";
import { GeasId } from "./geas.ts";

// A Familiar is a named, standing agent with one long-lived thread, its channel. It plans there
// and does its work through geasa. The Tome is its durable notes; a Coven (later) is a group chat.

export const FAMILIAR_TOME_MAX_BYTES = 16 * 1024;
export const FAMILIAR_DEFAULT_DAILY_RUN_BUDGET = 20;
/** The shared Claude instance Familiars use for a higher auto-compact threshold. */
export const FAMILIAR_CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeFamiliars");

export const FamiliarId = TrimmedNonEmptyString.pipe(Schema.brand("FamiliarId"));
export type FamiliarId = typeof FamiliarId.Type;

/** Backlog only lays geasa without starting them; start may start their runs. Neither lands work. */
export const FamiliarAutonomy = Schema.Literals(["backlog", "start"]);
export type FamiliarAutonomy = typeof FamiliarAutonomy.Type;

export const FamiliarWakeEvent = Schema.Literals([
  "asked",
  "in_review",
  "run_failed",
  "loop_guard",
  "done",
  "canceled",
  "archived",
]);
export type FamiliarWakeEvent = typeof FamiliarWakeEvent.Type;

/** A wake held while the Familiar is paused or over its budget, delivered on the way back. */
export const FamiliarHeldWake = Schema.Struct({
  geasId: GeasId,
  key: TrimmedNonEmptyString,
  title: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  events: Schema.Array(FamiliarWakeEvent),
  at: IsoDateTime,
});
export type FamiliarHeldWake = typeof FamiliarHeldWake.Type;

const Name = TrimmedNonEmptyString.check(Schema.isMaxLength(40));
const RolePrompt = Schema.String.check(Schema.isMaxLength(8000));
const Budget = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }));

export const Familiar = Schema.Struct({
  id: FamiliarId,
  name: Schema.String,
  rolePrompt: Schema.String,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  autonomy: FamiliarAutonomy,
  tome: Schema.String,
  tomeRevision: Schema.Int,
  dailyRunBudget: Schema.Int,
  runsToday: Schema.Int,
  runsDay: Schema.String,
  pausedAt: Schema.NullOr(IsoDateTime),
  archivedAt: Schema.NullOr(IsoDateTime),
  heldTaskIds: Schema.Array(ScheduledTaskId),
  heldWakes: Schema.Array(FamiliarHeldWake),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Familiar = typeof Familiar.Type;

export const FamiliarClaudeInstance = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** Empty when the instance uses Claude's default threshold. */
  autoCompactWindow: Schema.String,
});
export type FamiliarClaudeInstance = typeof FamiliarClaudeInstance.Type;

export const FamiliarsSnapshot = Schema.Struct({
  familiars: Schema.Array(Familiar),
  claudeInstance: Schema.NullOr(FamiliarClaudeInstance),
});
export type FamiliarsSnapshot = typeof FamiliarsSnapshot.Type;

export class FamiliarError extends Schema.TaggedError<FamiliarError>()("FamiliarError", {
  message: Schema.String,
  familiarId: Schema.optional(FamiliarId),
}) {}

export const FamiliarsSubscribeInput = Schema.Struct({
  includeArchived: Schema.optional(Schema.Boolean),
});
export type FamiliarsSubscribeInput = typeof FamiliarsSubscribeInput.Type;

export const FamiliarSummonInput = Schema.Struct({
  name: Name,
  rolePrompt: RolePrompt,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  autonomy: Schema.optional(FamiliarAutonomy),
  dailyRunBudget: Schema.optional(Budget),
});
export type FamiliarSummonInput = typeof FamiliarSummonInput.Type;

export const FamiliarUpdateInput = Schema.Struct({
  familiarId: FamiliarId,
  name: Schema.optional(Name),
  rolePrompt: Schema.optional(RolePrompt),
  autonomy: Schema.optional(FamiliarAutonomy),
  dailyRunBudget: Schema.optional(Budget),
});
export type FamiliarUpdateInput = typeof FamiliarUpdateInput.Type;

export const FamiliarWriteTomeInput = Schema.Struct({
  familiarId: FamiliarId,
  content: Schema.String,
  expectedRevision: Schema.Int,
});
export type FamiliarWriteTomeInput = typeof FamiliarWriteTomeInput.Type;

export const FamiliarSetPausedInput = Schema.Struct({
  familiarId: FamiliarId,
  paused: Schema.Boolean,
});
export type FamiliarSetPausedInput = typeof FamiliarSetPausedInput.Type;

export const FamiliarSetDismissedInput = Schema.Struct({
  familiarId: FamiliarId,
  dismissed: Schema.Boolean,
});
export type FamiliarSetDismissedInput = typeof FamiliarSetDismissedInput.Type;

export const FamiliarMutationResult = Schema.Struct({
  familiarId: FamiliarId,
  /** Routines the way back could not re-enable, such as one deleted meanwhile. */
  skippedRoutines: Schema.optional(Schema.Array(Schema.String)),
});
export type FamiliarMutationResult = typeof FamiliarMutationResult.Type;

export const FamiliarConfigureInstanceInput = Schema.Struct({
  /** Tokens before Claude compacts, 100,000 to 1,000,000. */
  compactAfter: Schema.Int.check(Schema.isBetween({ minimum: 100_000, maximum: 1_000_000 })),
});
export type FamiliarConfigureInstanceInput = typeof FamiliarConfigureInstanceInput.Type;
