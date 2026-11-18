import {
  CommandId,
  DEFAULT_GEAS_DELIVERY_ACTIONS,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EMPTY_GEAS_REPORT,
  GEAS_AGENT_RUN_LIMIT,
  GEAS_MEDIA_MAX_BYTES,
  GeasActivity,
  GeasCheckDeclaration,
  GeasDeliveryAction,
  GeasError,
  GeasId,
  GeasReport,
  GeasSuggestedAction,
  MessageId,
  ModelSelection,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ProjectId,
  ThreadId,
  geasReviewGateMissing,
  type GeasActInput,
  type GeasArchiveInput,
  type GeasCommentInput,
  type GeasDetail,
  type GeasEnactInput,
  type GeasEnactResult,
  type GeasEventType,
  type GeasMutationResult,
  type GeasPriority,
  type GeasReportInput,
  type GeasRun,
  type GeasRunAgainInput,
  type GeasRunOutcome,
  type GeasRunState,
  type GeasStatus,
  type GeasUpdateInput,
  type FamiliarWakeEvent,
  type GrimoireProjectSettings,
  type GrimoireRow,
  type GrimoireSnapshot,
  type GrimoireSubscribeInput,
  type GrimoireUpdateProjectSettingsInput,
  type OrchestrationV2CreationSource,
  type OrchestrationV2DomainEvent,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { createAttachmentId } from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import { SAFE_IMAGE_FILE_EXTENSIONS } from "../../imageMime.ts";
import { isTerminalRunStatus } from "../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { userFacingDispatchErrorMessage } from "../../orchestration-v2/UserFacingErrors.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import { runAnnexMigrations } from "../migrations.ts";
import { geasThreads } from "./geasThreads.ts";
import {
  deriveKeyPrefix,
  geasStatusLabel,
  needsYou,
  renderRunMessage,
  verifyChecks,
  type ExecutedCommand,
} from "./geasLogic.ts";

const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([".mp4", ".webm", ".mov"]);

const json = <A, I>(schema: Schema.Codec<A, I>) => {
  const codec = Schema.fromJsonString(schema);
  return { decode: Schema.decodeUnknownSync(codec), encode: Schema.encodeSync(codec) };
};

const ReportJson = json(GeasReport);
const ModelSelectionJson = json(ModelSelection);
const WorkspaceJson = json(OrchestrationV2ThreadLaunchWorkspaceStrategy);
const LabelsJson = json(Schema.Array(Schema.String));
const ActionsJson = json(Schema.Array(GeasSuggestedAction));
const DeliveryActionsJson = json(Schema.Array(GeasDeliveryAction));
const ChecksJson = json(Schema.Array(GeasCheckDeclaration));

interface GeasRow {
  readonly geas_id: string;
  readonly project_id: string;
  readonly geas_key: string;
  readonly title: string;
  readonly request: string;
  readonly status: GeasStatus;
  readonly priority: GeasPriority;
  readonly labels_json: string;
  readonly thread_id: string | null;
  readonly run_state: GeasRunState;
  readonly needs_you: number;
  readonly last_activity_at: string;
  readonly workspace_json: string;
  readonly model_selection_json: string;
  readonly runtime_mode: RuntimeMode;
  readonly interaction_mode: ProviderInteractionMode;
  readonly report_json: string;
  readonly report_revision: number;
  readonly agent_runs_since_user: number;
  readonly enacted_by_thread_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

interface ActivityRow {
  readonly activity_id: string;
  readonly kind: "comment" | "event";
  readonly event_type: GeasEventType | null;
  readonly author: GeasActivity["author"];
  readonly body: string;
  readonly notify: number;
  readonly actions_json: string;
  readonly run_id: string | null;
  readonly created_at: string;
}

interface RunRow {
  readonly run_id: string;
  readonly geas_id: string;
  readonly thread_run_id: string | null;
  readonly started_by: "user" | "agent";
  readonly model_selection_json: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly outcome: GeasRunOutcome | null;
  readonly final_response: string | null;
}

interface SettingsRow {
  readonly project_id: string;
  readonly key_prefix: string;
  readonly next_number: number;
  readonly delivery_actions_json: string | null;
  readonly checks_json: string;
  readonly rules: string;
}

const toActivity = (row: ActivityRow): GeasActivity => ({
  id: row.activity_id,
  kind: row.kind,
  eventType: row.event_type,
  author: row.author,
  body: row.body,
  notify: row.notify === 1,
  actions: ActionsJson.decode(row.actions_json),
  runId: row.run_id,
  createdAt: row.created_at,
});

const toRun = (row: RunRow): GeasRun => ({
  id: row.run_id,
  threadRunId: row.thread_run_id,
  startedBy: row.started_by,
  modelSelection: ModelSelectionJson.decode(row.model_selection_json),
  startedAt: row.started_at,
  endedAt: row.ended_at,
  outcome: row.outcome,
});

const toSettings = (row: SettingsRow): GrimoireProjectSettings => ({
  projectId: ProjectId.make(row.project_id),
  keyPrefix: row.key_prefix,
  deliveryActions:
    row.delivery_actions_json === null
      ? DEFAULT_GEAS_DELIVERY_ACTIONS
      : DeliveryActionsJson.decode(row.delivery_actions_json),
  checks: ChecksJson.decode(row.checks_json),
  rules: row.rules,
});

const LIST_COLUMNS = [
  "geas_id",
  "project_id",
  "geas_key",
  "title",
  "status",
  "priority",
  "labels_json",
  "thread_id",
  "enacted_by_thread_id",
  "run_state",
  "needs_you",
  "model_selection_json",
  "created_at",
  "updated_at",
  "last_activity_at",
  "archived_at",
] as const;
type ListColumns = Pick<GeasRow, (typeof LIST_COLUMNS)[number]>;

const toListRow = (row: ListColumns): GrimoireRow => ({
  id: GeasId.make(row.geas_id),
  projectId: ProjectId.make(row.project_id),
  key: row.geas_key,
  title: row.title,
  status: row.status,
  priority: row.priority,
  labels: LabelsJson.decode(row.labels_json),
  threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
  enactedByThreadId:
    row.enacted_by_thread_id === null ? null : ThreadId.make(row.enacted_by_thread_id),
  runState: row.run_state,
  needsYou: row.needs_you === 1,
  modelSelection: ModelSelectionJson.decode(row.model_selection_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastActivityAt: row.last_activity_at,
  archivedAt: row.archived_at,
});

const messageOf = (cause: unknown) =>
  userFacingDispatchErrorMessage(cause) ??
  (cause instanceof Error ? cause.message : "Something went wrong.");

const isGeasError = Schema.is(GeasError);

const failWith =
  (message: string, geasId?: GeasId) =>
  (cause: unknown): GeasError =>
    isGeasError(cause)
      ? cause
      : new GeasError({
          message: `${message} ${messageOf(cause)}`,
          ...(geasId === undefined ? {} : { geasId }),
        });

const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
};

export interface GeasCaller {
  readonly actor: "user" | "agent";
  readonly creationSource: OrchestrationV2CreationSource;
  /** The agent thread that laid it, recorded so its geasa can wake it. */
  readonly threadId?: ThreadId;
}

/** Something a geas did that may wake the thread that laid it; `idle` once no run is going. */
export interface GeasWake {
  readonly geasId: GeasId;
  readonly key: string;
  readonly title: string;
  readonly threadId: ThreadId | null;
  readonly enactedByThreadId: ThreadId;
  readonly event: FamiliarWakeEvent | null;
  readonly idle: boolean;
}

export class GeasStaleReportError extends Schema.TaggedError<GeasStaleReportError>()(
  "GeasStaleReportError",
  { currentRevision: Schema.Int, report: GeasReport },
) {
  override get message(): string {
    return `The report changed since you read it; it is at revision ${this.currentRevision}. Merge your changes into the current report and write again with expectedRevision ${this.currentRevision}.`;
  }
}

export class GeasReviewGateError extends Schema.TaggedError<GeasReviewGateError>()(
  "GeasReviewGateError",
  { missing: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `In review needs ${this.missing.join(" and ")} in the report. Update the report with geas_report_write, then set the status again.`;
  }
}

export class GeasService extends Context.Service<
  GeasService,
  {
    readonly subscribeGrimoire: (
      input: GrimoireSubscribeInput,
    ) => Stream.Stream<GrimoireSnapshot, GeasError>;
    readonly subscribeGeas: (geasId: GeasId) => Stream.Stream<GeasDetail, GeasError>;
    readonly enact: (
      input: GeasEnactInput,
      caller: GeasCaller,
    ) => Effect.Effect<GeasEnactResult, GeasError>;
    readonly update: (input: GeasUpdateInput) => Effect.Effect<GeasMutationResult, GeasError>;
    readonly comment: (input: GeasCommentInput) => Effect.Effect<GeasMutationResult, GeasError>;
    readonly act: (input: GeasActInput) => Effect.Effect<GeasMutationResult, GeasError>;
    readonly runAgain: (input: GeasRunAgainInput) => Effect.Effect<GeasMutationResult, GeasError>;
    readonly archive: (input: GeasArchiveInput) => Effect.Effect<GeasMutationResult, GeasError>;
    readonly updateProjectSettings: (
      input: GrimoireUpdateProjectSettingsInput,
    ) => Effect.Effect<GrimoireProjectSettings, GeasError>;
    /** The geas a thread works on, for its agent's tools. */
    readonly getForThread: (threadId: ThreadId) => Effect.Effect<GeasDetail, GeasError>;
    readonly writeReport: (input: {
      readonly threadId: ThreadId;
      readonly expectedRevision: number;
      readonly report: GeasReportInput;
    }) => Effect.Effect<
      { readonly revision: number; readonly report: GeasReport },
      GeasError | GeasStaleReportError
    >;
    readonly setStatusAsAgent: (input: {
      readonly threadId: ThreadId;
      readonly status: GeasStatus;
    }) => Effect.Effect<{ readonly status: GeasStatus }, GeasError | GeasReviewGateError>;
    readonly commentAsAgent: (input: {
      readonly threadId: ThreadId;
      readonly body: string;
      readonly notify: boolean;
      readonly actions: ReadonlyArray<GeasSuggestedAction>;
    }) => Effect.Effect<{ readonly activityId: string }, GeasError>;
    /** Copies a screenshot or clip from the geas's checkout into the attachment store. */
    /** A Familiar's comment: it never counts as the user's, so it never resets the loop guard. */
    readonly commentAsFamiliar: (input: {
      readonly key: string;
      readonly familiarName: string;
      readonly body: string;
      readonly queue: boolean;
      /** False under Backlog only: the comment is recorded and no run starts. */
      readonly mayStartRun: boolean;
    }) => Effect.Effect<GeasMutationResult, GeasError>;
    readonly getByKey: (key: string) => Effect.Effect<GeasDetail, GeasError>;
    readonly listRows: Effect.Effect<ReadonlyArray<GrimoireRow>>;
    /** A worktree on the project's default branch, honoring its start-from-origin setting. */
    readonly defaultWorktree: (
      projectId: ProjectId,
    ) => Effect.Effect<OrchestrationV2ThreadLaunchWorkspaceStrategy, GeasError>;
    readonly streamWakes: Stream.Stream<GeasWake>;
    readonly attachMedia: (input: {
      readonly threadId: ThreadId;
      readonly path: string;
    }) => Effect.Effect<
      { readonly attachmentId: string; readonly kind: "image" | "video" },
      GeasError
    >;
    /** Feeds orchestration events in; exposed so tests can drive it without a live engine. */
    readonly handleEvent: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/annex/geas/GeasService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitDriver = yield* GitVcsDriver.GitVcsDriver;
  const serviceScope = yield* Effect.scope;

  yield* runAnnexMigrations.pipe(Effect.orDie);

  // `null` means every geas changed, e.g. after a project settings save.
  const changes = yield* PubSub.sliding<GeasId | null>(256);
  const publish = (geasId: GeasId | null) => PubSub.publish(changes, geasId).pipe(Effect.asVoid);
  const wakes = yield* PubSub.unbounded<GeasWake>();
  /** Only geasa an agent thread laid can wake anything. */
  const publishWake = (row: GeasRow, event: FamiliarWakeEvent | null, idle: boolean) =>
    row.enacted_by_thread_id === null
      ? Effect.void
      : PubSub.publish(wakes, {
          geasId: GeasId.make(row.geas_id),
          key: row.geas_key,
          title: row.title,
          threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
          enactedByThreadId: ThreadId.make(row.enacted_by_thread_id),
          event,
          idle,
        }).pipe(Effect.asVoid);
  // One writer per geas, so status, report and run bookkeeping never interleave.
  const locks = new Map<string, Semaphore.Semaphore>();
  const withLock =
    (geasId: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) => {
      let lock = locks.get(geasId);
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        locks.set(geasId, lock);
      }
      return lock.withPermits(1)(effect);
    };
  /** Latest assistant text per thread run, kept until the run ends. */
  const finalResponses = new Map<string, string>();

  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const newId = (prefix: string) => Effect.map(randomUuidV4, (uuid) => `${prefix}-${uuid}`);

  const orDie = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.orDie(effect);

  const selectGeas = (geasId: string) =>
    orDie(sql<GeasRow>`SELECT * FROM annex_geas WHERE geas_id = ${geasId}`).pipe(
      Effect.map((rows) => rows[0]),
    );

  const requireGeas = Effect.fn("GeasService.requireGeas")(function* (geasId: GeasId) {
    const row = yield* selectGeas(geasId);
    if (row === undefined) return yield* new GeasError({ message: "Geas not found.", geasId });
    return row;
  });

  const requireThreadGeas = Effect.fn("GeasService.requireThreadGeas")(function* (
    threadId: ThreadId,
  ) {
    const rows = yield* orDie(
      sql<GeasRow>`SELECT * FROM annex_geas WHERE thread_id = ${threadId} LIMIT 1`,
    );
    const row = rows[0];
    if (row === undefined) {
      return yield* new GeasError({ message: "This thread does not work on a geas." });
    }
    return row;
  });

  const selectActivity = (geasId: string) =>
    orDie(
      sql<ActivityRow>`
        SELECT * FROM (
          SELECT * FROM annex_geas_activity WHERE geas_id = ${geasId} ORDER BY seq DESC LIMIT 500
        ) ORDER BY seq ASC
      `,
    ).pipe(Effect.map((rows) => rows.map(toActivity)));

  const selectRuns = (geasId: string) =>
    orDie(
      sql<RunRow>`SELECT * FROM annex_geas_runs WHERE geas_id = ${geasId} ORDER BY started_at ASC`,
    );

  const ensureSettings = Effect.fn("GeasService.ensureSettings")(function* (projectId: ProjectId) {
    const existing = yield* orDie(
      sql<SettingsRow>`SELECT * FROM annex_project_settings WHERE project_id = ${projectId}`,
    );
    if (existing[0] !== undefined) return existing[0];
    const project = yield* projects.getById(projectId).pipe(Effect.orElseSucceed(Option.none));
    const base = deriveKeyPrefix(
      Option.match(project, { onNone: () => "", onSome: (p) => p.title }),
    );
    // Two projects can derive the same prefix, or reuse one another dropped; keys stay unique.
    const taken = new Set(
      (yield* orDie(
        sql<{ key_prefix: string }>`
          SELECT key_prefix FROM annex_project_settings
          UNION
          SELECT substr(geas_key, 1, instr(geas_key, '-') - 1) FROM annex_geas
          WHERE project_id != ${projectId}
        `,
      )).map((row) => row.key_prefix),
    );
    let prefix = base;
    for (let suffix = 2; taken.has(prefix); suffix++) prefix = `${base.slice(0, 6)}${suffix}`;
    yield* orDie(sql`
      INSERT OR IGNORE INTO annex_project_settings (project_id, key_prefix) VALUES (${projectId}, ${prefix})
    `);
    const rows = yield* orDie(
      sql<SettingsRow>`SELECT * FROM annex_project_settings WHERE project_id = ${projectId}`,
    );
    return rows[0]!;
  });

  const insertActivity = Effect.fn("GeasService.insertActivity")(function* (input: {
    readonly geasId: string;
    readonly kind: "comment" | "event";
    readonly eventType?: GeasEventType;
    readonly author: GeasActivity["author"];
    readonly body: string;
    readonly notify?: boolean;
    readonly actions?: ReadonlyArray<GeasSuggestedAction>;
    readonly runId?: string | null;
  }) {
    const activityId = yield* newId("geas-activity");
    const createdAt = yield* now;
    yield* orDie(sql`
      INSERT INTO annex_geas_activity
        (activity_id, geas_id, kind, event_type, author, body, notify, actions_json, run_id, created_at)
      VALUES (
        ${activityId}, ${input.geasId}, ${input.kind}, ${input.eventType ?? null}, ${input.author},
        ${input.body}, ${input.notify === true ? 1 : 0}, ${ActionsJson.encode(input.actions ?? [])},
        ${input.runId ?? null}, ${createdAt}
      )
    `);
    return activityId;
  });

  /** Recomputes what the list shows from the stored state, then tells subscribers. */
  const refresh = Effect.fn("GeasService.refresh")(function* (geasId: string) {
    const row = yield* selectGeas(geasId);
    if (row === undefined) return;
    const activity = yield* selectActivity(geasId);
    const flagged = needsYou({ status: row.status, runState: row.run_state, activity });
    const lastActivityAt = activity.at(-1)?.createdAt ?? row.created_at;
    yield* orDie(sql`
      UPDATE annex_geas SET needs_you = ${flagged ? 1 : 0}, last_activity_at = ${lastActivityAt}
      WHERE geas_id = ${geasId}
    `);
    yield* publish(GeasId.make(geasId));
  });

  const openRun = (geasId: string) =>
    orDie(
      sql<RunRow>`
        SELECT * FROM annex_geas_runs WHERE geas_id = ${geasId} AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1
      `,
    ).pipe(Effect.map((rows) => rows[0]));

  const settingsFor = (projectId: string) =>
    ensureSettings(ProjectId.make(projectId)).pipe(Effect.map(toSettings));

  const readDetail = Effect.fn("GeasService.readDetail")(function* (geasId: GeasId) {
    const row = yield* requireGeas(geasId);
    const [activity, runs, settings] = yield* Effect.all([
      selectActivity(geasId),
      selectRuns(geasId),
      settingsFor(row.project_id),
    ]);
    return {
      ...toListRow(row),
      request: row.request,
      workspace: WorkspaceJson.decode(row.workspace_json),
      runtimeMode: row.runtime_mode,
      interactionMode: row.interaction_mode,
      report: ReportJson.decode(row.report_json),
      reportRevision: row.report_revision,
      activity,
      runs: runs.map(toRun),
      settings,
    } satisfies GeasDetail;
  });

  const isRunActive = (row: GeasRow) => row.run_state !== "idle";

  /** True once the guard has stopped agents since the user's last comment. */
  const loopGuardTripped = (geasId: string) =>
    orDie(sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM annex_geas_activity
      WHERE geas_id = ${geasId} AND event_type = 'loop_guard' AND seq > COALESCE(
        (SELECT MAX(seq) FROM annex_geas_activity
         WHERE geas_id = ${geasId} AND author = 'user' AND kind = 'comment'), 0)
    `).pipe(Effect.map((rows) => rows[0]!.n > 0));

  const settleGeasThread = (geasId: string, threadId: ThreadId) =>
    Effect.flatMap(now, (at) =>
      threads.settleThread({
        threadId,
        commandId: CommandId.make(`annex-geas-settle:${geasId}:${at}`),
        byOwnAgent: false,
      }),
    ).pipe(Effect.catchCause((cause) => Effect.logWarning("geas thread settle failed", { cause })));

  const setStatus = Effect.fn("GeasService.setStatus")(function* (
    row: GeasRow,
    status: GeasStatus,
    author: GeasActivity["author"],
  ) {
    if (row.status === status) return;
    const updatedAt = yield* now;
    yield* orDie(sql`
      UPDATE annex_geas SET status = ${status}, updated_at = ${updatedAt} WHERE geas_id = ${row.geas_id}
    `);
    const who = author === "user" ? "You" : author === "agent" ? "The agent" : "Annex";
    yield* insertActivity({
      geasId: row.geas_id,
      kind: "event",
      eventType: "status_changed",
      author,
      body: `${who} moved it from ${geasStatusLabel(row.status)} to ${geasStatusLabel(status)}.`,
    });
    if (status === "in_review" || status === "done" || status === "canceled") {
      yield* publishWake(row, status, !isRunActive(row));
    }
    if (row.thread_id === null) return;
    const threadId = ThreadId.make(row.thread_id);
    // Done threads settle like any finished thread; reopening brings them back.
    // A running thread can't settle, so endRun settles it when the run ends.
    if (status === "done" || status === "canceled") {
      if (!isRunActive(row)) yield* settleGeasThread(row.geas_id, threadId);
    } else if (row.status === "done" || row.status === "canceled") {
      yield* threads
        .dispatch({
          type: "thread.unsettle",
          commandId: CommandId.make(`annex-geas-unsettle:${row.geas_id}:${updatedAt}`),
          threadId,
          reason: "user",
        })
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("geas thread unsettle failed", { cause })),
        );
    }
  });

  const renameThread = Effect.fn("GeasService.renameThread")(function* (
    row: GeasRow,
    title: string,
  ) {
    if (row.thread_id === null) return;
    yield* threads
      .dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make(yield* newId("annex-geas-rename")),
        threadId: ThreadId.make(row.thread_id),
        title: `${row.geas_key} · ${title}`,
      })
      .pipe(
        Effect.catchCause((cause) => Effect.logWarning("geas thread rename failed", { cause })),
      );
  });

  /** Titles a geas enacted without one, the way threads are titled; the first line stands in until then. */
  const generateTitle = Effect.fn("GeasService.generateTitle")(function* (
    geasId: GeasId,
    projectId: ProjectId,
    request: string,
    placeholder: string,
  ) {
    const project = yield* projects.getById(projectId).pipe(Effect.orElseSucceed(Option.none));
    if (Option.isNone(project)) return;
    const settings = resolveProjectSettings(yield* serverSettings.getSettings, projectId).settings;
    const result = yield* textGeneration.generateThreadTitle({
      cwd: project.value.workspaceRoot,
      message: assistantCitationsToPlainText(request),
      projectTitle: project.value.title,
      instructions: settings.threadTitleInstructions,
      modelSelection: settings.textGenerationModelSelection,
      projectId,
    });
    const title = result.title.trim().slice(0, 200);
    if (title === "" || title === "New thread") return;
    yield* withLock(geasId)(
      Effect.gen(function* () {
        const row = yield* selectGeas(geasId);
        // A rename while the title was generating wins.
        if (row === undefined || row.title !== placeholder) return;
        yield* orDie(sql`UPDATE annex_geas SET title = ${title} WHERE geas_id = ${geasId}`);
        yield* renameThread(row, title);
        yield* refresh(geasId);
      }),
    );
  });

  const runMessage = Effect.fn("GeasService.runMessage")(function* (geasId: GeasId) {
    const detail = yield* readDetail(geasId);
    const runs = yield* selectRuns(geasId);
    const previous = runs.at(-1);
    return renderRunMessage({
      key: detail.key,
      title: detail.title,
      status: detail.status,
      request: detail.request,
      report: detail.report,
      reportRevision: detail.reportRevision,
      settings: detail.settings,
      activity: detail.activity,
      previousFinalResponse: previous?.final_response ?? null,
    });
  });

  /** Starts a fresh run: the first launches the geas's thread, later ones send to it. */
  const startRun = Effect.fn("GeasService.startRun")(
    function* (input: {
      readonly geasId: GeasId;
      readonly startedBy: "user" | "agent";
      readonly creationSource: OrchestrationV2CreationSource;
      readonly modelSelection?: ModelSelection;
    }) {
      const row = yield* requireGeas(input.geasId);
      if (input.startedBy === "agent" && row.agent_runs_since_user >= GEAS_AGENT_RUN_LIMIT) {
        if (!(yield* loopGuardTripped(row.geas_id))) yield* publishWake(row, "loop_guard", true);
        yield* insertActivity({
          geasId: row.geas_id,
          kind: "event",
          eventType: "loop_guard",
          author: "server",
          body: `Agents started ${GEAS_AGENT_RUN_LIMIT} runs since your last comment, so Annex is waiting for you.`,
        });
        return yield* new GeasError({
          message: "Agents started too many runs on this geas; it waits for the user now.",
          geasId: input.geasId,
        });
      }
      const text = yield* runMessage(input.geasId);
      const runId = yield* newId("geas-run");
      const modelSelection =
        input.modelSelection ?? ModelSelectionJson.decode(row.model_selection_json);
      const messageId = MessageId.make(`annex-geas-message:${runId}`);
      const commandId = CommandId.make(`annex-geas-run:${runId}`);
      let threadId = row.thread_id === null ? null : ThreadId.make(row.thread_id);
      let threadRunId: string | null;
      if (threadId === null) {
        // Claimed before launch, so the reactor already follows a first run that ends quickly.
        const claimed = ThreadId.make(yield* randomUuidV4);
        geasThreads.add(claimed);
        yield* orDie(
          sql`UPDATE annex_geas SET thread_id = ${claimed} WHERE geas_id = ${row.geas_id}`,
        );
        const launched = yield* threadLaunch
          .launch({
            commandId,
            threadId: claimed,
            projectId: ProjectId.make(row.project_id),
            title: `${row.geas_key} · ${row.title}`,
            generateTitle: false,
            modelSelection,
            runtimeMode: row.runtime_mode,
            interactionMode: row.interaction_mode,
            workspaceStrategy: WorkspaceJson.decode(row.workspace_json),
            initialMessage: { messageId, text, attachments: [] },
            createdBy: input.startedBy,
            creationSource: input.creationSource,
          })
          .pipe(
            Effect.onError(() =>
              Effect.andThen(
                Effect.sync(() => geasThreads.delete(claimed)),
                orDie(sql`UPDATE annex_geas SET thread_id = NULL WHERE geas_id = ${row.geas_id}`),
              ),
            ),
            Effect.mapError(failWith("Could not start the geas's thread.", input.geasId)),
          );
        threadId = launched.threadId;
        threadRunId =
          launched.projection.runs.find((run) => run.userMessageId === messageId)?.id ?? null;
        // A geas can sit in review for days; only Done settles its thread.
        yield* threads
          .dispatch({
            type: "thread.auto-settle.set",
            commandId: CommandId.make(`annex-geas-auto-settle:${row.geas_id}`),
            threadId,
            enabled: false,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("geas auto-settle opt-out failed", { cause }),
            ),
          );
      } else {
        const sent = yield* threads
          .sendToThread({
            projectId: ProjectId.make(row.project_id),
            commandId,
            threadId,
            messageId,
            text,
            attachments: [],
            ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
            mode: "queue",
            freshContext: true,
            createdBy: input.startedBy,
            creationSource: input.creationSource,
          })
          .pipe(Effect.mapError(failWith("Could not start a run.", input.geasId)));
        threadRunId = sent.run.id;
      }
      const startedAt = yield* now;
      yield* orDie(sql`
      INSERT INTO annex_geas_runs (run_id, geas_id, thread_run_id, started_by, model_selection_json, started_at)
      VALUES (${runId}, ${row.geas_id}, ${threadRunId}, ${input.startedBy},
              ${ModelSelectionJson.encode(modelSelection)}, ${startedAt})
    `);
      yield* orDie(sql`
      UPDATE annex_geas SET
        run_state = CASE WHEN run_state = 'waiting' THEN 'waiting' ELSE 'running' END,
        model_selection_json = ${ModelSelectionJson.encode(modelSelection)},
        agent_runs_since_user = agent_runs_since_user + ${input.startedBy === "agent" ? 1 : 0},
        updated_at = ${startedAt}
      WHERE geas_id = ${row.geas_id}
    `);
      // Before run_started, so the next run's "new since" skips this run's own start.
      const current = yield* requireGeas(input.geasId);
      if (current.status !== "in_progress") yield* setStatus(current, "in_progress", "server");
      yield* insertActivity({
        geasId: row.geas_id,
        kind: "event",
        eventType: "run_started",
        author: "server",
        body: `Run started on ${modelSelection.model}.`,
        runId,
      });
      yield* refresh(row.geas_id);
    },
    // A client leaving mid-launch must not strand the geas on a half-claimed thread.
    Effect.uninterruptible,
  );

  /** Your comment steers an active run, or starts the next one. */
  const postUserComment = Effect.fn("GeasService.postUserComment")(function* (
    geasId: GeasId,
    body: string,
    queue = false,
  ) {
    const row = yield* requireGeas(geasId);
    const run = yield* openRun(geasId);
    yield* insertActivity({
      geasId,
      kind: "comment",
      author: "user",
      body,
      runId: run?.run_id ?? null,
    });
    yield* orDie(sql`UPDATE annex_geas SET agent_runs_since_user = 0 WHERE geas_id = ${geasId}`);
    if (queue && isRunActive(row)) {
      yield* insertActivity({
        geasId,
        kind: "event",
        eventType: "comment_queued",
        author: "server",
        body: "Queued: the next run starts with your comment.",
        runId: run?.run_id ?? null,
      });
      yield* refresh(geasId);
      return;
    }
    if (row.thread_id !== null && isRunActive(row)) {
      const id = yield* newId("geas-steer");
      yield* threads
        .sendToThread({
          projectId: ProjectId.make(row.project_id),
          commandId: CommandId.make(`annex-geas-steer:${id}`),
          threadId: ThreadId.make(row.thread_id),
          messageId: MessageId.make(`annex-geas-steer-message:${id}`),
          text: `New on ${row.geas_key}: ${body}`,
          attachments: [],
          mode: "steer",
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(
          // Nothing to steer (e.g. waiting on an approval): the next fresh run carries it.
          Effect.catchTags({
            ThreadManagementNoSteerableRunError: () =>
              insertActivity({
                geasId,
                kind: "event",
                eventType: "comment_queued",
                author: "server",
                body: "The agent can't take your comment mid-run, so the next run starts with it.",
                runId: run?.run_id ?? null,
              }),
          }),
          Effect.mapError(failWith("Could not pass the comment to the running agent.", geasId)),
        );
      yield* refresh(geasId);
      return;
    }
    yield* refresh(geasId);
    if (row.status === "done" || row.status === "canceled") return;
    yield* startRun({ geasId, startedBy: "user", creationSource: "web" });
  });

  const enact: GeasService["Service"]["enact"] = Effect.fn("GeasService.enact")(
    function* (input, caller) {
      const geasId = GeasId.make(yield* newId("geas"));
      const createdAt = yield* now;
      const title = input.title ?? firstLine(input.request);
      const key = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const settings = yield* ensureSettings(input.projectId);
            yield* sql`
              UPDATE annex_project_settings SET next_number = next_number + 1
              WHERE project_id = ${input.projectId}
            `;
            const key = `${settings.key_prefix}-${settings.next_number}`;
            yield* sql`
              INSERT INTO annex_geas (
                geas_id, project_id, geas_key, title, request, status, priority, labels_json,
                last_activity_at, workspace_json, model_selection_json, runtime_mode,
                interaction_mode, report_json, enacted_by_thread_id, created_at, updated_at
              ) VALUES (
                ${geasId}, ${input.projectId}, ${key}, ${title},
                ${input.request}, ${input.backlog === true ? "backlog" : "todo"},
                ${input.priority ?? "none"}, ${LabelsJson.encode(input.labels ?? [])}, ${createdAt},
                ${WorkspaceJson.encode(input.workspace)},
                ${ModelSelectionJson.encode(input.modelSelection)},
                ${input.runtimeMode ?? DEFAULT_RUNTIME_MODE},
                ${input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE},
                ${ReportJson.encode(EMPTY_GEAS_REPORT)}, ${caller.threadId ?? null},
                ${createdAt}, ${createdAt}
              )
            `;
            return key;
          }),
        )
        .pipe(Effect.mapError(failWith("Could not save the geas.")));
      yield* insertActivity({
        geasId,
        kind: "comment",
        author: caller.actor,
        body: input.request,
      });
      yield* refresh(geasId);
      if (input.title === undefined) {
        yield* generateTitle(geasId, input.projectId, input.request, title).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("geas title generation failed", { cause }),
          ),
          Effect.forkIn(serviceScope),
        );
      }
      if (input.backlog !== true) {
        yield* withLock(geasId)(
          startRun({
            geasId,
            startedBy: caller.actor,
            creationSource: caller.creationSource,
          }),
        ).pipe(
          // The geas exists either way; a failed first run shows on it instead of losing it.
          Effect.catch((error) =>
            insertActivity({
              geasId,
              kind: "event",
              eventType: "run_failed",
              author: "server",
              body: error.message,
            }).pipe(Effect.andThen(refresh(geasId))),
          ),
        );
      }
      return { geasId, key };
    },
  );

  const update: GeasService["Service"]["update"] = Effect.fn("GeasService.update")(
    function* (input) {
      yield* withLock(input.geasId)(
        Effect.gen(function* () {
          const row = yield* requireGeas(input.geasId);
          const updatedAt = yield* now;
          yield* orDie(sql`
            UPDATE annex_geas SET
              title = ${input.title ?? row.title},
              priority = ${input.priority ?? row.priority},
              labels_json = ${input.labels === undefined ? row.labels_json : LabelsJson.encode(input.labels)},
              updated_at = ${updatedAt}
            WHERE geas_id = ${row.geas_id}
          `);
          if (input.title !== undefined && input.title !== row.title) {
            yield* renameThread(row, input.title);
          }
          if (input.status !== undefined) yield* setStatus(row, input.status, "user");
          yield* refresh(row.geas_id);
        }),
      );
      return { geasId: input.geasId };
    },
  );

  const comment: GeasService["Service"]["comment"] = Effect.fn("GeasService.comment")(
    function* (input) {
      yield* withLock(input.geasId)(
        postUserComment(input.geasId, input.body, input.queue === true),
      );
      return { geasId: input.geasId };
    },
  );

  const act: GeasService["Service"]["act"] = Effect.fn("GeasService.act")(function* (input) {
    const action = input.action;
    yield* withLock(input.geasId)(
      Effect.gen(function* () {
        switch (action.type) {
          case "prompt":
            return yield* postUserComment(input.geasId, action.prompt);
          case "options":
            return yield* postUserComment(
              input.geasId,
              action.question.trim() === ""
                ? action.selected.join(", ")
                : `${action.question.trim()} ${action.selected.join(", ")}`,
            );
          case "status": {
            const row = yield* requireGeas(input.geasId);
            yield* setStatus(row, action.status, "user");
            return yield* refresh(row.geas_id);
          }
        }
      }),
    );
    return { geasId: input.geasId };
  });

  const runAgain: GeasService["Service"]["runAgain"] = Effect.fn("GeasService.runAgain")(
    function* (input) {
      yield* withLock(input.geasId)(
        Effect.gen(function* () {
          const row = yield* requireGeas(input.geasId);
          if (isRunActive(row)) {
            return yield* new GeasError({
              message: "A run is already going; stop it first.",
              geasId: input.geasId,
            });
          }
          yield* orDie(
            sql`UPDATE annex_geas SET agent_runs_since_user = 0 WHERE geas_id = ${row.geas_id}`,
          );
          yield* startRun({
            geasId: input.geasId,
            startedBy: "user",
            creationSource: "web",
            ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
          });
        }),
      );
      return { geasId: input.geasId };
    },
  );

  const archive: GeasService["Service"]["archive"] = Effect.fn("GeasService.archive")(
    function* (input) {
      const archivedAt = input.archived ? yield* now : null;
      const row = yield* requireGeas(input.geasId);
      yield* orDie(
        sql`UPDATE annex_geas SET archived_at = ${archivedAt} WHERE geas_id = ${input.geasId}`,
      );
      if (input.archived) yield* publishWake(row, "archived", !isRunActive(row));
      yield* publish(input.geasId);
      return { geasId: input.geasId };
    },
  );

  const updateProjectSettings: GeasService["Service"]["updateProjectSettings"] = Effect.fn(
    "GeasService.updateProjectSettings",
  )(function* (input) {
    const stored = yield* ensureSettings(input.projectId);
    const current = toSettings(stored);
    if (
      input.keyPrefix === undefined &&
      input.deliveryActions === undefined &&
      input.checks === undefined &&
      input.rules === undefined
    ) {
      return current;
    }
    if (input.keyPrefix !== undefined && input.keyPrefix !== current.keyPrefix) {
      const clash = yield* orDie(
        sql<{ project_id: string }>`
          SELECT project_id FROM annex_project_settings
          WHERE key_prefix = ${input.keyPrefix} AND project_id != ${input.projectId}
          UNION
          SELECT project_id FROM annex_geas
          WHERE geas_key LIKE ${`${input.keyPrefix}-%`} AND project_id != ${input.projectId}
        `,
      );
      if (clash.length > 0) {
        return yield* new GeasError({
          message: `Another project already uses ${input.keyPrefix}.`,
        });
      }
    }
    // New geasa take the new prefix; existing keys stay as they were issued.
    yield* orDie(sql`
      UPDATE annex_project_settings SET
        key_prefix = ${input.keyPrefix ?? current.keyPrefix},
        delivery_actions_json = ${input.deliveryActions === undefined ? stored.delivery_actions_json : DeliveryActionsJson.encode(input.deliveryActions)},
        checks_json = ${ChecksJson.encode(input.checks ?? current.checks)},
        rules = ${input.rules ?? current.rules}
      WHERE project_id = ${input.projectId}
    `);
    yield* publish(null);
    return toSettings(yield* ensureSettings(input.projectId));
  });

  const listSnapshot = Effect.fn("GeasService.listSnapshot")(function* (
    input: GrimoireSubscribeInput,
  ) {
    const columns = sql.literal(LIST_COLUMNS.join(", "));
    const rows = yield* orDie(
      input.includeArchived === true
        ? sql<ListColumns>`SELECT ${columns} FROM annex_geas ORDER BY last_activity_at DESC`
        : sql<ListColumns>`
            SELECT ${columns} FROM annex_geas WHERE archived_at IS NULL
            ORDER BY last_activity_at DESC
          `,
    );
    const settings = yield* orDie(sql<SettingsRow>`SELECT * FROM annex_project_settings`);
    return { geasa: rows.map(toListRow), projects: settings.map(toSettings) };
  });

  const subscribeGrimoire: GeasService["Service"]["subscribeGrimoire"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(listSnapshot(input)),
          Stream.fromSubscription(subscription).pipe(
            // Changes landing during a read collapse into one more snapshot.
            Stream.buffer({ capacity: 1, strategy: "sliding" }),
            Stream.mapEffect(() => listSnapshot(input)),
          ),
        );
      }),
    );

  const subscribeGeas: GeasService["Service"]["subscribeGeas"] = (geasId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(readDetail(geasId)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === geasId || changed === null),
            Stream.buffer({ capacity: 1, strategy: "sliding" }),
            Stream.mapEffect(() => readDetail(geasId)),
          ),
        );
      }),
    );

  const executedCommands = (geasId: string) =>
    orDie(
      sql<{ command: string; exit_code: number | null; completed_at: string }>`
        SELECT command, exit_code, completed_at FROM annex_geas_commands
        WHERE geas_id = ${geasId} ORDER BY completed_at DESC LIMIT 500
      `,
    ).pipe(
      Effect.map((rows) =>
        rows.map((row): ExecutedCommand => ({
          command: row.command,
          exitCode: row.exit_code,
          completedAt: row.completed_at,
        })),
      ),
    );

  /** Re-reads every declared check from the thread's commands; true when a status moved. */
  const reverifyChecks = Effect.fn("GeasService.reverifyChecks")(function* (row: GeasRow) {
    const report = ReportJson.decode(row.report_json);
    if (report.checks.length === 0) return false;
    const settings = yield* settingsFor(row.project_id);
    const checks = verifyChecks(
      report.checks,
      yield* executedCommands(row.geas_id),
      settings.checks,
    );
    const moved = checks.some(
      (check, index) =>
        check.status !== report.checks[index]?.status ||
        check.exitCode !== report.checks[index]?.exitCode,
    );
    if (!moved) return false;
    yield* orDie(sql`
      UPDATE annex_geas SET report_json = ${ReportJson.encode({ ...report, checks })}
      WHERE geas_id = ${row.geas_id}
    `);
    return true;
  });

  const getForThread: GeasService["Service"]["getForThread"] = Effect.fn(
    "GeasService.getForThread",
  )(function* (threadId) {
    const row = yield* requireThreadGeas(threadId);
    return yield* readDetail(GeasId.make(row.geas_id));
  });

  const writeReport: GeasService["Service"]["writeReport"] = Effect.fn("GeasService.writeReport")(
    function* (input) {
      const row = yield* requireThreadGeas(input.threadId);
      return yield* withLock(row.geas_id)(
        Effect.gen(function* () {
          const current = yield* requireGeas(GeasId.make(row.geas_id));
          if (current.report_revision !== input.expectedRevision) {
            return yield* new GeasStaleReportError({
              currentRevision: current.report_revision,
              report: ReportJson.decode(current.report_json),
            });
          }
          const settings = yield* settingsFor(current.project_id);
          const report: GeasReport = {
            ...input.report,
            checks: verifyChecks(
              input.report.checks,
              yield* executedCommands(current.geas_id),
              settings.checks,
            ),
          };
          const revision = current.report_revision + 1;
          const updatedAt = yield* now;
          yield* orDie(sql`
            UPDATE annex_geas SET report_json = ${ReportJson.encode(report)},
              report_revision = ${revision}, updated_at = ${updatedAt}
            WHERE geas_id = ${current.geas_id}
          `);
          const run = yield* openRun(current.geas_id);
          yield* insertActivity({
            geasId: current.geas_id,
            kind: "event",
            eventType: "report_updated",
            author: "agent",
            body: "The agent updated the report.",
            runId: run?.run_id ?? null,
          });
          yield* refresh(current.geas_id);
          return { revision, report };
        }),
      );
    },
  );

  const setStatusAsAgent: GeasService["Service"]["setStatusAsAgent"] = Effect.fn(
    "GeasService.setStatusAsAgent",
  )(function* (input) {
    const row = yield* requireThreadGeas(input.threadId);
    yield* withLock(row.geas_id)(
      Effect.gen(function* () {
        const current = yield* requireGeas(GeasId.make(row.geas_id));
        if (input.status === "in_review") {
          yield* reverifyChecks(current);
          const fresh = yield* requireGeas(GeasId.make(row.geas_id));
          const missing = geasReviewGateMissing(ReportJson.decode(fresh.report_json));
          if (missing.length > 0) return yield* new GeasReviewGateError({ missing });
        }
        yield* setStatus(current, input.status, "agent");
        yield* refresh(current.geas_id);
      }),
    );
    return { status: input.status };
  });

  const commentAsAgent: GeasService["Service"]["commentAsAgent"] = Effect.fn(
    "GeasService.commentAsAgent",
  )(function* (input) {
    const row = yield* requireThreadGeas(input.threadId);
    return yield* withLock(row.geas_id)(
      Effect.gen(function* () {
        const run = yield* openRun(row.geas_id);
        const activityId = yield* insertActivity({
          geasId: row.geas_id,
          kind: "comment",
          author: "agent",
          body: input.body,
          notify: input.notify,
          actions: input.actions,
          runId: run?.run_id ?? null,
        });
        if (input.notify || input.actions.length > 0) {
          yield* publishWake(row, "asked", run === undefined);
        }
        yield* refresh(row.geas_id);
        return { activityId };
      }),
    );
  });

  const requireByKey = Effect.fn("GeasService.requireByKey")(function* (key: string) {
    const rows = yield* orDie(
      sql<GeasRow>`SELECT * FROM annex_geas WHERE geas_key = ${key.trim().toUpperCase()}`,
    );
    const row = rows[0];
    if (row === undefined) return yield* new GeasError({ message: `No geas ${key}.` });
    return row;
  });

  const getByKey: GeasService["Service"]["getByKey"] = Effect.fn("GeasService.getByKey")(
    function* (key) {
      const row = yield* requireByKey(key);
      return yield* readDetail(GeasId.make(row.geas_id));
    },
  );

  const commentAsFamiliar: GeasService["Service"]["commentAsFamiliar"] = Effect.fn(
    "GeasService.commentAsFamiliar",
  )(function* (input) {
    const found = yield* requireByKey(input.key);
    const geasId = GeasId.make(found.geas_id);
    yield* withLock(geasId)(
      Effect.gen(function* () {
        const row = yield* requireGeas(geasId);
        // Past the guard a comment would let two agents keep each other running.
        if (
          row.agent_runs_since_user >= GEAS_AGENT_RUN_LIMIT ||
          (yield* loopGuardTripped(geasId))
        ) {
          return yield* new GeasError({
            message: `${row.geas_key} is waiting for the user after the loop guard stopped agents; it takes no agent comments until they reply.`,
            geasId,
          });
        }
        const run = yield* openRun(geasId);
        const body = `✦ ${input.familiarName}: ${input.body}`;
        yield* insertActivity({
          geasId,
          kind: "comment",
          author: "agent",
          body,
          runId: run?.run_id ?? null,
        });
        if (isRunActive(row) && row.thread_id !== null) {
          if (input.queue) {
            yield* insertActivity({
              geasId,
              kind: "event",
              eventType: "comment_queued",
              author: "server",
              body: `Queued: the next run starts with ${input.familiarName}'s comment.`,
              runId: run?.run_id ?? null,
            });
            return yield* refresh(geasId);
          }
          const id = yield* newId("geas-familiar-steer");
          yield* threads
            .sendToThread({
              projectId: ProjectId.make(row.project_id),
              commandId: CommandId.make(`annex-geas-steer:${id}`),
              threadId: ThreadId.make(row.thread_id),
              messageId: MessageId.make(`annex-geas-steer-message:${id}`),
              text: `New on ${row.geas_key} from ✦ ${input.familiarName}: ${input.body}`,
              attachments: [],
              mode: "steer",
              createdBy: "agent",
              creationSource: "mcp",
            })
            .pipe(
              Effect.catchTags({
                ThreadManagementNoSteerableRunError: () =>
                  insertActivity({
                    geasId,
                    kind: "event",
                    eventType: "comment_queued",
                    author: "server",
                    body: "The agent can't take the comment mid-run, so the next run starts with it.",
                    runId: run?.run_id ?? null,
                  }),
              }),
              Effect.mapError(failWith("Could not pass the comment to the running agent.", geasId)),
            );
          return yield* refresh(geasId);
        }
        yield* refresh(geasId);
        const startable =
          !input.queue &&
          input.mayStartRun &&
          row.status !== "backlog" &&
          row.status !== "done" &&
          row.status !== "canceled";
        if (startable) yield* startRun({ geasId, startedBy: "agent", creationSource: "mcp" });
      }),
    );
    return { geasId };
  });

  const listRows: GeasService["Service"]["listRows"] = Effect.map(
    Effect.suspend(() => listSnapshot({})),
    (snapshot) => snapshot.geasa,
  );

  const defaultWorktree: GeasService["Service"]["defaultWorktree"] = Effect.fn(
    "GeasService.defaultWorktree",
  )(function* (projectId) {
    const project = yield* projects.getById(projectId).pipe(Effect.orElseSucceed(Option.none));
    if (Option.isNone(project)) {
      return yield* new GeasError({ message: "That project is not on this environment." });
    }
    const cwd = project.value.workspaceRoot;
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings.pipe(Effect.mapError(failWith("Could not read settings."))),
      projectId,
    ).settings;
    const remote = yield* gitDriver
      .resolvePrimaryRemoteName(cwd)
      .pipe(Effect.orElseSucceed(() => null));
    const branch =
      remote === null
        ? null
        : yield* gitDriver
            .resolveDefaultBranchName(cwd, remote)
            .pipe(Effect.orElseSucceed(() => null));
    return {
      type: "worktree" as const,
      baseRef: branch ?? "HEAD",
      ...(branch !== null && settings.newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
    };
  });

  const streamWakes: GeasService["Service"]["streamWakes"] = Stream.fromPubSub(wakes);

  const attachMedia: GeasService["Service"]["attachMedia"] = Effect.fn("GeasService.attachMedia")(
    function* (input) {
      const row = yield* requireThreadGeas(input.threadId);
      const shell = yield* threads
        .getThreadShell(input.threadId)
        .pipe(Effect.orElseSucceed(() => null));
      const project = yield* projects
        .getById(ProjectId.make(row.project_id))
        .pipe(Effect.orElseSucceed(Option.none));
      const cwd =
        shell?.worktreePath ??
        Option.match(project, { onNone: () => undefined, onSome: (p) => p.workspaceRoot });
      if (cwd === undefined && !path.isAbsolute(input.path)) {
        return yield* new GeasError({
          message: "Pass an absolute path; this geas has no checkout.",
        });
      }
      const given = cwd === undefined ? input.path : path.resolve(cwd, input.path);
      // The real file decides, so a media-named symlink can't copy out something else.
      const source = yield* fileSystem
        .realPath(given)
        .pipe(Effect.mapError(() => new GeasError({ message: `No file at ${given}.` })));
      const extension = path.extname(source).toLowerCase();
      const kind = SAFE_IMAGE_FILE_EXTENSIONS.has(extension)
        ? ("image" as const)
        : VIDEO_EXTENSIONS.has(extension)
          ? ("video" as const)
          : undefined;
      if (kind === undefined) {
        return yield* new GeasError({
          message: `Attach a screenshot (${[...SAFE_IMAGE_FILE_EXTENSIONS].join(", ")}) or a clip (${[...VIDEO_EXTENSIONS].join(", ")}).`,
        });
      }
      const info = yield* fileSystem
        .stat(source)
        .pipe(Effect.mapError(() => new GeasError({ message: `No file at ${source}.` })));
      if (info.type !== "File")
        return yield* new GeasError({ message: `${source} is not a file.` });
      if (Number(info.size) > GEAS_MEDIA_MAX_BYTES) {
        return yield* new GeasError({
          message: `${source} is over ${GEAS_MEDIA_MAX_BYTES / 1024 / 1024} MB; record a shorter or smaller clip.`,
        });
      }
      // Images resolve by probing image extensions, as chat images do; clips keep their type in
      // the id so the asset route can serve them inline.
      const attachmentId = createAttachmentId(
        input.threadId,
        kind === "video" ? extension.slice(1) : undefined,
      );
      if (attachmentId === null) {
        return yield* new GeasError({ message: "This thread cannot hold attachments." });
      }
      const fileName = `${attachmentId}${extension}`;
      yield* fileSystem
        .makeDirectory(config.attachmentsDir, { recursive: true })
        .pipe(Effect.ignore);
      yield* fileSystem
        .copyFile(source, path.join(config.attachmentsDir, fileName))
        .pipe(Effect.mapError(failWith("Could not store the file.")));
      return { attachmentId, kind };
    },
  );

  const geasForThread = (threadId: string) =>
    orDie(sql<GeasRow>`SELECT * FROM annex_geas WHERE thread_id = ${threadId} LIMIT 1`).pipe(
      Effect.map((rows) => rows[0]),
    );

  const endRun = Effect.fn("GeasService.endRun")(function* (
    row: GeasRow,
    threadRunId: string,
    status: "completed" | "failed" | "cancelled" | "interrupted" | "rolled_back",
  ) {
    const runs = yield* orDie(sql<RunRow>`
      SELECT * FROM annex_geas_runs
      WHERE geas_id = ${row.geas_id} AND ended_at IS NULL
        AND (thread_run_id = ${threadRunId} OR thread_run_id IS NULL)
      ORDER BY started_at DESC LIMIT 1
    `);
    yield* orDie(sql`UPDATE annex_geas SET run_state = 'idle' WHERE geas_id = ${row.geas_id}`);
    const run = runs[0];
    const finalResponse = finalResponses.get(threadRunId) ?? null;
    finalResponses.delete(threadRunId);
    yield* reverifyChecks(row);
    if (run === undefined) return yield* refresh(row.geas_id);
    const endedAt = yield* now;
    const current = (yield* selectGeas(row.geas_id)) ?? row;
    const handedOff =
      (yield* orDie(sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM annex_geas_activity
        WHERE geas_id = ${row.geas_id} AND run_id = ${run.run_id} AND author = 'agent' AND kind = 'comment'
      `))[0]!.n > 0 || current.status !== "in_progress";
    const outcome: GeasRunOutcome =
      status === "failed"
        ? "failed"
        : status === "completed"
          ? handedOff
            ? "handed_off"
            : "no_handoff"
          : "interrupted";
    yield* orDie(sql`
      UPDATE annex_geas_runs SET ended_at = ${endedAt}, outcome = ${outcome},
        final_response = ${finalResponse}, thread_run_id = ${threadRunId}
      WHERE run_id = ${run.run_id}
    `);
    if (outcome === "failed") {
      const shell = yield* threads
        .getThreadShell(ThreadId.make(row.thread_id!))
        .pipe(Effect.orElseSucceed(() => null));
      yield* insertActivity({
        geasId: row.geas_id,
        kind: "event",
        eventType: "run_failed",
        author: "server",
        body: `The run failed${shell?.lastError ? `: ${shell.lastError}` : "."}`,
        runId: run.run_id,
      });
    } else if (outcome === "no_handoff") {
      yield* insertActivity({
        geasId: row.geas_id,
        kind: "event",
        eventType: "no_handoff",
        author: "server",
        body: "Run ended without a handoff.",
        runId: run.run_id,
      });
    } else {
      yield* insertActivity({
        geasId: row.geas_id,
        kind: "event",
        eventType: "run_ended",
        author: "server",
        body: outcome === "interrupted" ? "Run stopped." : "Run ended.",
        runId: run.run_id,
      });
    }
    yield* publishWake(current, outcome === "failed" ? "run_failed" : null, true);
    if (current.status === "done" || current.status === "canceled") {
      yield* settleGeasThread(row.geas_id, ThreadId.make(row.thread_id!));
      return yield* refresh(row.geas_id);
    }
    yield* refresh(row.geas_id);
    const queued = yield* orDie(sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM annex_geas_activity
      WHERE geas_id = ${row.geas_id} AND run_id = ${run.run_id} AND event_type = 'comment_queued'
    `);
    if (queued[0]!.n > 0) {
      yield* startRun({
        geasId: GeasId.make(row.geas_id),
        startedBy: "user",
        creationSource: "web",
      }).pipe(
        Effect.catch((error) => Effect.logWarning("geas queued-comment run failed", { error })),
      );
    }
  });

  const onPullRequestChange = Effect.fn("GeasService.onPullRequestChange")(function* (
    row: GeasRow,
  ) {
    if (row.status !== "in_review" && row.status !== "in_progress") return;
    if (row.thread_id === null) return;
    const shell = yield* threads
      .getThreadShell(ThreadId.make(row.thread_id))
      .pipe(Effect.orElseSucceed(() => null));
    // Only a merge since the latest run counts, so a reopened geas ignores its old PR.
    const since = (yield* selectRuns(row.geas_id)).at(-1)?.started_at ?? row.created_at;
    const merged = (shell?.pullRequests ?? []).some((link) => {
      const snapshot = link.snapshot;
      if (snapshot?.state !== "merged") return false;
      const mergedAt = snapshot.mergedAt ?? null;
      return mergedAt === null
        ? row.status === "in_review"
        : Date.parse(mergedAt) >= Date.parse(since);
    });
    if (!merged) return;
    yield* setStatus(row, "done", "server");
    yield* refresh(row.geas_id);
  });

  /** The thread is gone: the geas forgets it, and its next run launches a new one. */
  const onThreadDeleted = Effect.fn("GeasService.onThreadDeleted")(function* (row: GeasRow) {
    geasThreads.delete(ThreadId.make(row.thread_id!));
    const endedAt = yield* now;
    yield* orDie(sql`
      UPDATE annex_geas_runs SET ended_at = ${endedAt}, outcome = 'interrupted'
      WHERE geas_id = ${row.geas_id} AND ended_at IS NULL
    `);
    yield* orDie(sql`
      UPDATE annex_geas SET thread_id = NULL, run_state = 'idle' WHERE geas_id = ${row.geas_id}
    `);
    yield* insertActivity({
      geasId: row.geas_id,
      kind: "event",
      eventType: "thread_deleted",
      author: "server",
      body: "Its thread was deleted, so the next run starts a new one.",
    });
    yield* refresh(row.geas_id);
  });

  const handleEvent: GeasService["Service"]["handleEvent"] = Effect.fn("GeasService.handleEvent")(
    function* (event) {
      if (!geasThreads.has(event.threadId)) return;
      switch (event.type) {
        case "message.updated": {
          const message = event.payload;
          if (message.role === "assistant" && message.runId !== null) {
            finalResponses.set(message.runId, message.text);
          }
          return;
        }
        case "turn-item.updated":
          if (event.payload.type !== "command_execution" || event.payload.exitCode === undefined) {
            return;
          }
          break;
        case "run.updated":
        case "thread.deleted":
        case "thread.pull-request-link-updated":
        case "thread.pull-request-synced":
          break;
        default:
          return;
      }
      const row = yield* geasForThread(event.threadId);
      if (row === undefined) return;
      const locked = withLock(row.geas_id);
      // Re-read under the lock, so a run start or end in flight is never overwritten.
      const withFresh = <A, E, R>(f: (fresh: GeasRow) => Effect.Effect<A, E, R>) =>
        locked(
          Effect.flatMap(selectGeas(row.geas_id), (fresh) =>
            fresh === undefined || fresh.thread_id !== event.threadId ? Effect.void : f(fresh),
          ),
        );
      switch (event.type) {
        case "run.updated": {
          const run = event.payload;
          if (isTerminalRunStatus(run.status)) {
            return yield* withFresh((fresh) =>
              endRun(fresh, run.id, run.status as Parameters<typeof endRun>[2]),
            );
          }
          const runState: GeasRunState = run.status === "waiting" ? "waiting" : "running";
          return yield* withFresh((fresh) =>
            fresh.run_state === runState
              ? Effect.void
              : Effect.andThen(
                  orDie(
                    sql`UPDATE annex_geas SET run_state = ${runState} WHERE geas_id = ${fresh.geas_id}`,
                  ),
                  refresh(fresh.geas_id),
                ),
          );
        }
        case "turn-item.updated": {
          const item = event.payload;
          if (item.type !== "command_execution" || item.exitCode === undefined) return;
          const completedAt = DateTime.formatIso(item.completedAt ?? item.updatedAt);
          yield* orDie(sql`
            INSERT INTO annex_geas_commands (item_id, geas_id, command, exit_code, completed_at)
            VALUES (${item.id}, ${row.geas_id}, ${item.input}, ${item.exitCode}, ${completedAt})
            ON CONFLICT (item_id) DO UPDATE SET exit_code = excluded.exit_code,
              completed_at = excluded.completed_at
          `);
          return yield* withFresh((fresh) =>
            Effect.flatMap(reverifyChecks(fresh), (changed) =>
              changed ? publish(GeasId.make(fresh.geas_id)) : Effect.void,
            ),
          );
        }
        case "thread.deleted":
          return yield* withFresh(onThreadDeleted);
        case "thread.pull-request-link-updated":
        case "thread.pull-request-synced":
          return yield* withFresh(onPullRequestChange);
      }
    },
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logWarning("geas reaction failed", { cause }),
    ),
  );

  // Geas thread ids back the MCP tools' visibility, which is checked synchronously.
  const known = yield* orDie(
    sql<{ thread_id: string }>`SELECT thread_id FROM annex_geas WHERE thread_id IS NOT NULL`,
  );
  for (const row of known) geasThreads.add(ThreadId.make(row.thread_id));

  yield* threads.streamDomainEvents.pipe(
    Stream.runForEach(handleEvent),
    Effect.catchCause((cause) => Effect.logWarning("geas event stream ended", { cause })),
    Effect.forkScoped,
  );

  return GeasService.of({
    subscribeGrimoire,
    subscribeGeas,
    enact,
    update,
    comment,
    act,
    runAgain,
    archive,
    updateProjectSettings,
    getForThread,
    writeReport,
    setStatusAsAgent,
    commentAsAgent,
    commentAsFamiliar,
    getByKey,
    listRows,
    defaultWorktree,
    streamWakes,
    attachMedia,
    handleEvent,
  });
});

export const layer = Layer.effect(GeasService, make);
