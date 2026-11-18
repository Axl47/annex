import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import type {
  AssistantCitation,
  EnvironmentId,
  GeasActInput,
  GeasActivity,
  GeasDetail,
  GeasId,
  GeasStatus,
  GeasSuggestedAction,
  GitStackedAction,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import BaseGitActionsControl from "../components/GitActionsControl";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { Textarea } from "../components/ui/textarea";
import { isElectron } from "../env";
import { useNowMinute } from "../hooks/useNowMinute";
import { cn } from "../lib/utils";
import { useProject, useThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { EnactDialog, type EnactSeed } from "./EnactDialog";
import { GeasRunDot, GeasStatusIcon } from "./geasPresentation";
import { GeasReport } from "./GeasReport";
import { GeasCitationChip, GeasCitedText } from "./geasCitations";
import { GeasSelectionMenu } from "./GeasSelectionMenu";
import { GEAS_STATUS_LABELS, grimoireAtoms } from "./state";

const STATUSES = Object.keys(GEAS_STATUS_LABELS) as ReadonlyArray<GeasStatus>;

// The agent owns git in its checkout; a suggested git step asks it to take that step.
const GIT_ACTION_PROMPTS: Record<GitStackedAction, string> = {
  commit: "Commit the changes.",
  push: "Push the branch.",
  create_pr: "Open a pull request.",
  commit_push: "Commit and push the changes.",
  commit_push_pr: "Commit, push, and open a pull request.",
};

export function GeasPage({
  environmentId,
  geasId,
}: {
  readonly environmentId: EnvironmentId;
  readonly geasId: GeasId;
}) {
  const query = useEnvironmentQuery(grimoireAtoms.geas({ environmentId, input: { geasId } }));
  const geas = query.data;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Geas breadcrumb">
            <WorkspaceBreadcrumbItem>
              <Link to="/grimoire" search={{ environmentId }} className="hover:text-foreground">
                Grimoire
              </Link>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">{geas?.key ?? "Geas"}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {geas ? <GeasHeaderControls environmentId={environmentId} geas={geas} /> : null}
        </WorkspacePageHeader>
        <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="expanded" className="min-h-full">
            {query.error !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {query.error}
              </p>
            ) : null}
            {geas ? <GeasBody environmentId={environmentId} geas={geas} /> : null}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function GeasHeaderControls({
  environmentId,
  geas,
}: {
  readonly environmentId: EnvironmentId;
  readonly geas: GeasDetail;
}) {
  const canOperate = useAtomValue(grimoireAtoms.update.permissionAtom(environmentId));
  const update = useAtomCommand(grimoireAtoms.update, { label: "geas status" });
  const runAgain = useAtomCommand(grimoireAtoms.runAgain, { label: "geas run again" });
  const archive = useAtomCommand(grimoireAtoms.archive, { label: "geas archive" });
  const interrupt = useOrchestrationCommand(threadEnvironment.interruptTurn, "stop geas run");
  return (
    <div
      className="flex items-center gap-1 [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      {geas.threadId !== null ? (
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(environmentId, geas.threadId))}
            />
          }
        >
          <MessageSquareIcon />
          Open thread
        </Button>
      ) : null}
      {geas.runState !== "idle" && geas.threadId !== null ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Stop the run"
          disabled={!canOperate}
          onClick={() => void interrupt({ environmentId, input: { threadId: geas.threadId! } })}
        >
          <SquareIcon />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Run again"
          disabled={!canOperate}
          onClick={() => void runAgain({ environmentId, input: { geasId: geas.id } })}
        >
          <RotateCcwIcon />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={geas.archivedAt === null ? "Archive" : "Unarchive"}
        disabled={!canOperate}
        onClick={() =>
          void archive({
            environmentId,
            input: { geasId: geas.id, archived: geas.archivedAt === null },
          })
        }
      >
        {geas.archivedAt === null ? <ArchiveIcon /> : <ArchiveRestoreIcon />}
      </Button>
      <Select
        value={geas.status}
        disabled={!canOperate}
        onValueChange={(value) =>
          void update({ environmentId, input: { geasId: geas.id, status: value as GeasStatus } })
        }
      >
        <SelectTrigger size="sm" aria-label="Status">
          <SelectValue>
            <span className="flex items-center gap-1.5">
              <GeasStatusIcon status={geas.status} />
              {GEAS_STATUS_LABELS[geas.status]}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              <span className="flex items-center gap-1.5">
                <GeasStatusIcon status={status} />
                {GEAS_STATUS_LABELS[status]}
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

function GeasBody({
  environmentId,
  geas,
}: {
  readonly environmentId: EnvironmentId;
  readonly geas: GeasDetail;
}) {
  const act = useAtomCommand(grimoireAtoms.act, { label: "geas action" });
  const canOperate = useAtomValue(grimoireAtoms.act.permissionAtom(environmentId));
  const canEnact = useAtomValue(grimoireAtoms.enact.permissionAtom(environmentId));
  const navigate = useNavigate();
  const send = (action: GeasActInput["action"]) =>
    act({ environmentId, input: { geasId: geas.id, action } });
  const [reportElement, setReportElement] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [citations, setCitations] = useState<ReadonlyArray<AssistantCitation>>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [enactSeed, setEnactSeed] = useState<EnactSeed | null>(null);
  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{geas.key}</span>
            <GeasRunDot runState={geas.runState} needsYou={geas.needsYou} />
            {geas.needsYou ? (
              <span>Needs you</span>
            ) : geas.runState === "running" ? (
              <span>Running</span>
            ) : geas.runState === "waiting" ? (
              <span>Waiting on you in the thread</span>
            ) : null}
          </div>
          <GeasTitle environmentId={environmentId} geas={geas} />
        </div>
        <div ref={setReportElement} data-assistant-citation-source={`geas-report:${geas.id}`}>
          <GeasReport
            environmentId={environmentId}
            report={geas.report}
            running={geas.runState !== "idle"}
          />
        </div>
        {geas.threadId !== null ? (
          <GeasSelectionMenu
            source={reportElement}
            citationSource={{
              environmentId,
              threadId: geas.threadId,
              messageId: `geas-report:${geas.id}`,
            }}
            canComment={canOperate}
            canEnact={canEnact}
            onComment={(citation) => {
              setCitations((current) =>
                current.some(
                  (cited) => cited.start === citation.start && cited.end === citation.end,
                )
                  ? current
                  : [...current, citation],
              );
              composerRef.current?.focus();
            }}
            onEnact={(citation) =>
              setEnactSeed({
                projectId: geas.projectId,
                citation,
                parent: {
                  geasId: geas.id,
                  key: geas.key,
                  title: geas.title,
                  queueable: geas.status !== "done" && geas.status !== "canceled",
                },
              })
            }
          />
        ) : null}
        {geas.status === "in_review" ? (
          <DeliveryBar
            environmentId={environmentId}
            geas={geas}
            disabled={!canOperate}
            onPrompt={(prompt) => void send({ type: "prompt", prompt })}
          />
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            What was asked
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
            <GeasCitedText text={geas.request} />
          </p>
        </details>
      </div>
      <ActivityColumn
        environmentId={environmentId}
        geas={geas}
        canOperate={canOperate}
        onAction={(action) => void send(action)}
        draft={draft}
        onDraftChange={setDraft}
        citations={citations}
        onCitationsChange={setCitations}
        composerRef={composerRef}
      />
      {enactSeed !== null ? (
        <EnactDialog
          environmentId={environmentId}
          seed={enactSeed}
          onClose={(geasId) => {
            setEnactSeed(null);
            if (geasId !== undefined) {
              void navigate({
                to: "/grimoire/$environmentId/$geasId",
                params: { environmentId, geasId },
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** The title, renamed in place; a new title also renames the geas's thread. */
function GeasTitle({
  environmentId,
  geas,
}: {
  readonly environmentId: EnvironmentId;
  readonly geas: GeasDetail;
}) {
  const canOperate = useAtomValue(grimoireAtoms.update.permissionAtom(environmentId));
  const update = useAtomCommand(grimoireAtoms.update, { label: "rename geas" });
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <h2 className="text-xl font-semibold text-balance">
        <button
          type="button"
          className="rounded-sm text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none"
          aria-label={`Rename ${geas.title}`}
          disabled={!canOperate}
          onClick={() => setEditing(true)}
        >
          {geas.title}
        </button>
      </h2>
    );
  }
  const save = (value: string) => {
    setEditing(false);
    const title = value.trim().slice(0, 200);
    if (title === "" || title === geas.title) return;
    void update({ environmentId, input: { geasId: geas.id, title } });
  };
  return (
    <Input
      aria-label="Title"
      defaultValue={geas.title}
      maxLength={200}
      autoFocus
      onBlur={(event) => save(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") save(event.currentTarget.value);
        if (event.key === "Escape") setEditing(false);
      }}
    />
  );
}

function DeliveryBar({
  environmentId,
  geas,
  disabled,
  onPrompt,
}: {
  readonly environmentId: EnvironmentId;
  readonly geas: GeasDetail;
  readonly disabled: boolean;
  readonly onPrompt: (prompt: string) => void;
}) {
  const threadRef = geas.threadId === null ? null : scopeThreadRef(environmentId, geas.threadId);
  const shell = useThreadShell(threadRef);
  const project = useProject(scopeProjectRef(environmentId, geas.projectId));
  const gitCwd = project
    ? projectScriptCwd({
        project: { cwd: project.workspaceRoot },
        worktreePath: shell?.worktreePath ?? null,
      })
    : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      {geas.settings.deliveryActions.map((action, index) => (
        <Button
          key={action.label}
          size="sm"
          variant={index === 0 ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onPrompt(action.prompt)}
        >
          {action.label}
        </Button>
      ))}
      <div className="min-w-0 flex-1" />
      {gitCwd !== null ? (
        <BaseGitActionsControl gitCwd={gitCwd} activeThreadRef={threadRef} compact />
      ) : null}
    </div>
  );
}

/** Suggested actions stay live only on the latest agent ask you haven't answered. */
function openAskId(activity: ReadonlyArray<GeasActivity>): string | null {
  for (let index = activity.length - 1; index >= 0; index--) {
    const entry = activity[index]!;
    if (entry.kind === "comment" && entry.author === "user") return null;
    if (entry.eventType === "run_started") return null;
    if (entry.kind === "comment" && entry.author === "agent" && entry.actions.length > 0) {
      return entry.id;
    }
  }
  return null;
}

function ActivityColumn({
  environmentId,
  geas,
  canOperate,
  onAction,
  draft,
  onDraftChange,
  citations,
  onCitationsChange,
  composerRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly geas: GeasDetail;
  readonly canOperate: boolean;
  readonly onAction: (action: GeasActInput["action"]) => void;
  readonly draft: string;
  readonly onDraftChange: (draft: string) => void;
  readonly citations: ReadonlyArray<AssistantCitation>;
  readonly onCitationsChange: (citations: ReadonlyArray<AssistantCitation>) => void;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const liveAsk = openAskId(geas.activity);
  return (
    <aside className="flex min-w-0 flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">Activity</h3>
      <ol className="flex flex-col gap-2">
        {geas.activity.map((entry) =>
          entry.kind === "event" ? (
            <li key={entry.id} className="flex gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">{entry.body}</span>
              <span className="shrink-0 tabular-nums">
                {formatRelativeTimeLabel(entry.createdAt, nowMs)}
              </span>
            </li>
          ) : (
            <li
              key={entry.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg px-3 py-2 text-sm",
                entry.author === "user" ? "bg-muted/60" : "border bg-background",
                entry.author === "agent" && entry.notify && "border-warning/40",
              )}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">{entry.author === "user" ? "You" : "Agent"}</span>
                <span className="ml-auto tabular-nums">
                  {formatRelativeTimeLabel(entry.createdAt, nowMs)}
                </span>
              </div>
              <p className="whitespace-pre-wrap">
                <GeasCitedText text={entry.body} />
              </p>
              {entry.actions.length > 0 ? (
                <SuggestedActions
                  actions={entry.actions}
                  disabled={!canOperate || entry.id !== liveAsk}
                  question={entry.body}
                  onAction={onAction}
                />
              ) : null}
            </li>
          ),
        )}
      </ol>
      <GeasComposer
        environmentId={environmentId}
        geasId={geas.id}
        disabled={!canOperate}
        body={draft}
        onBodyChange={onDraftChange}
        citations={citations}
        onCitationsChange={onCitationsChange}
        textareaRef={composerRef}
      />
    </aside>
  );
}

function SuggestedActions({
  actions,
  disabled,
  question,
  onAction,
}: {
  readonly actions: ReadonlyArray<GeasSuggestedAction>;
  readonly disabled: boolean;
  readonly question: string;
  readonly onAction: (action: GeasActInput["action"]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.flatMap((action) => {
        const variant = action.primary === true ? "default" : "outline";
        switch (action.type) {
          case "prompt":
            return [
              <Button
                key={action.label}
                size="xs"
                variant={variant}
                disabled={disabled}
                onClick={() => onAction({ type: "prompt", prompt: action.prompt })}
              >
                {action.label}
              </Button>,
            ];
          case "status":
            return [
              <Button
                key={action.label}
                size="xs"
                variant={variant}
                disabled={disabled}
                onClick={() => onAction({ type: "status", status: action.status })}
              >
                {action.label}
              </Button>,
            ];
          case "git":
            return [
              <Button
                key={action.label}
                size="xs"
                variant={variant}
                disabled={disabled}
                onClick={() =>
                  onAction({ type: "prompt", prompt: GIT_ACTION_PROMPTS[action.action] })
                }
              >
                {action.label}
              </Button>,
            ];
          case "options":
            return [
              <OptionsAction
                key={action.label}
                options={action.options}
                disabled={disabled}
                onSend={(selected) =>
                  onAction({
                    type: "options",
                    question: action.label === "" ? question.slice(0, 200) : action.label,
                    selected,
                  })
                }
              />,
            ];
        }
      })}
    </div>
  );
}

/** Tick any of the options; Send answers with all of them in one comment. */
function OptionsAction({
  options,
  disabled,
  onSend,
}: {
  readonly options: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly onSend: (selected: ReadonlyArray<string>) => void;
}) {
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => {
        const ticked = selected.includes(option);
        return (
          <Button
            key={option}
            size="xs"
            variant={ticked ? "secondary" : "outline"}
            aria-pressed={ticked}
            disabled={disabled}
            onClick={() =>
              setSelected((current) =>
                ticked ? current.filter((entry) => entry !== option) : [...current, option],
              )
            }
          >
            {option}
          </Button>
        );
      })}
      <Button
        size="xs"
        disabled={disabled || selected.length === 0}
        onClick={() => onSend(options.filter((option) => selected.includes(option)))}
      >
        Send
      </Button>
    </div>
  );
}

function GeasComposer({
  environmentId,
  geasId,
  disabled,
  body,
  onBodyChange: setBody,
  citations,
  onCitationsChange,
  textareaRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly geasId: GeasId;
  readonly disabled: boolean;
  readonly body: string;
  readonly onBodyChange: (body: string) => void;
  readonly citations: ReadonlyArray<AssistantCitation>;
  readonly onCitationsChange: (citations: ReadonlyArray<AssistantCitation>) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const comment = useAtomCommand(grimoireAtoms.comment, { label: "geas comment" });
  const [sending, setSending] = useState(false);
  const submit = async () => {
    const text = [...citations.map(serializeAssistantCitation), body.trim()]
      .filter((part) => part !== "")
      .join("\n\n");
    if (text === "" || sending || disabled) return;
    setSending(true);
    const result = await comment({ environmentId, input: { geasId, body: text } });
    setSending(false);
    if (result._tag === "Success") {
      setBody("");
      onCitationsChange([]);
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {citations.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {citations.map((citation, index) => (
            <GeasCitationChip
              key={serializeAssistantCitation(citation)}
              citation={citation}
              onRemove={() => onCitationsChange(citations.filter((_, at) => at !== index))}
            />
          ))}
        </div>
      ) : null}
      <Textarea
        ref={textareaRef}
        aria-label="Comment"
        placeholder="Reply, redirect, or say stop. A running agent reads it right away."
        className="max-h-48 min-h-16 overflow-y-auto"
        value={body}
        disabled={disabled}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <Button
        type="submit"
        size="sm"
        className="self-end"
        disabled={disabled || sending || (body.trim() === "" && citations.length === 0)}
      >
        Send
      </Button>
    </form>
  );
}
