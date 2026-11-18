import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  FAMILIAR_TOME_MAX_BYTES,
  type EnvironmentId,
  type Familiar,
  type FamiliarAutonomy,
  type FamiliarId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MessageSquareIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SidebarInset } from "../components/ui/sidebar";
import { Textarea } from "../components/ui/textarea";
import { isElectron } from "../env";
import { useNowMinute } from "../hooks/useNowMinute";
import { useProjects } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { GrimoireRowItem } from "./GrimoirePage";
import { RoutineDialog } from "./RoutineDialog";
import {
  FAMILIAR_STATE_LABELS,
  FAMILIAR_WAKE_LABELS,
  familiarAtoms,
  familiarRunsToday,
  familiarState,
  grimoireAtoms,
} from "./state";

const textBytes = (text: string) => new TextEncoder().encode(text).length;

export function FamiliarPage({
  environmentId,
  familiarId,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiarId: FamiliarId;
}) {
  const query = useEnvironmentQuery(
    familiarAtoms.familiars({ environmentId, input: { includeArchived: true } }),
  );
  const familiar = query.data?.familiars.find((candidate) => candidate.id === familiarId) ?? null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Familiar breadcrumb">
            <WorkspaceBreadcrumbItem>
              <Link to="/familiars" search={{ environmentId }} className="hover:text-foreground">
                Familiars
              </Link>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">{familiar === null ? "Familiar" : `✦ ${familiar.name}`}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {familiar !== null ? (
            <FamiliarHeaderControls environmentId={environmentId} familiar={familiar} />
          ) : null}
        </WorkspacePageHeader>
        <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="expanded" className="min-h-full gap-8">
            {query.error !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {query.error}
              </p>
            ) : null}
            {query.data !== null && familiar === null ? (
              <p className="text-sm text-muted-foreground">This Familiar no longer exists.</p>
            ) : null}
            {familiar !== null ? (
              <FamiliarBody key={familiar.id} environmentId={environmentId} familiar={familiar} />
            ) : null}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function FamiliarHeaderControls({
  environmentId,
  familiar,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
}) {
  const canOperate = useAtomValue(familiarAtoms.setPaused.permissionAtom(environmentId));
  const setPaused = useAtomCommand(familiarAtoms.setPaused, { label: "pause Familiar" });
  const setDismissed = useAtomCommand(familiarAtoms.setDismissed, { label: "dismiss Familiar" });
  const dismissed = familiar.archivedAt !== null;
  return (
    <div
      className="flex items-center gap-1 [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      {familiar.threadId !== null && !dismissed ? (
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(environmentId, familiar.threadId))}
            />
          }
        >
          <MessageSquareIcon />
          Open channel
        </Button>
      ) : null}
      {!dismissed ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={!canOperate}
          onClick={() =>
            void setPaused({
              environmentId,
              input: { familiarId: familiar.id, paused: familiar.pausedAt === null },
            })
          }
        >
          {familiar.pausedAt === null ? <PauseIcon /> : <PlayIcon />}
          {familiar.pausedAt === null ? "Pause" : "Resume"}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={dismissed ? "Restore" : "Dismiss"}
        disabled={!canOperate}
        onClick={() =>
          void setDismissed({
            environmentId,
            input: { familiarId: familiar.id, dismissed: !dismissed },
          })
        }
      >
        {dismissed ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
      </Button>
    </div>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {hint !== undefined ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FamiliarBody({
  environmentId,
  familiar,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
}) {
  const nowMillis = Date.parse(`${useNowMinute()}:00.000Z`);
  const state = familiarState(familiar, nowMillis);
  const runsToday = familiarRunsToday(familiar, nowMillis);
  const project = useProjects().find(
    (candidate) => candidate.environmentId === environmentId && candidate.id === familiar.projectId,
  );
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <span className={state === "active" ? "text-foreground" : "text-warning"}>
          {FAMILIAR_STATE_LABELS[state]}
        </span>
        {" · "}
        {runsToday} of {familiar.dailyRunBudget} runs today
        {project !== undefined ? ` · ${project.title}` : ""}
      </p>
      {familiar.heldWakes.length > 0 ? (
        <Section
          title="Waiting wakes"
          hint={
            familiar.pausedAt !== null
              ? "They go to the channel as one message when you resume."
              : "They go to the channel with your next message there, or tomorrow."
          }
        >
          <ul className="flex flex-col gap-1 text-sm">
            {familiar.heldWakes.map((wake) => (
              <li key={wake.geasId} className="flex min-w-0 items-center gap-3 px-2 py-1">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {wake.key}
                </span>
                <span className="min-w-0 flex-1 truncate">{wake.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {wake.events.map((event) => FAMILIAR_WAKE_LABELS[event]).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <TomeEditor environmentId={environmentId} familiar={familiar} />
      <FamiliarGeasa environmentId={environmentId} familiar={familiar} />
      <FamiliarRoutines environmentId={environmentId} familiar={familiar} />
      <FamiliarSettings environmentId={environmentId} familiar={familiar} />
    </>
  );
}

function TomeEditor({
  environmentId,
  familiar,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
}) {
  const canOperate = useAtomValue(familiarAtoms.writeTome.permissionAtom(environmentId));
  const writeTome = useAtomCommand(familiarAtoms.writeTome, { label: "save Tome" });
  // Your edit keeps the revision it started from, so a Familiar's write meanwhile is never lost.
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const text = draft?.text ?? familiar.tome;
  const bytes = textBytes(text);
  const stale = draft !== null && draft.revision !== familiar.tomeRevision;

  const save = async () => {
    if (draft === null || saving || bytes > FAMILIAR_TOME_MAX_BYTES) return;
    setSaving(true);
    const result = await writeTome({
      environmentId,
      input: { familiarId: familiar.id, content: draft.text, expectedRevision: draft.revision },
    });
    setSaving(false);
    if (result._tag === "Success") setDraft(null);
  };

  return (
    <Section
      title="Tome"
      hint={`Notes ${familiar.name} keeps across sessions. Revision ${familiar.tomeRevision} · ${bytes.toLocaleString()} of ${FAMILIAR_TOME_MAX_BYTES.toLocaleString()} bytes.`}
      action={
        draft !== null ? (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Discard
            </Button>
            <Button
              size="sm"
              disabled={!canOperate || saving || stale || bytes > FAMILIAR_TOME_MAX_BYTES}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        ) : null
      }
    >
      {stale ? (
        <p className="text-xs text-warning" role="status">
          {familiar.name} changed the Tome since you started editing. Discard your edit to see the
          new version, then make it again.
        </p>
      ) : null}
      <Textarea
        aria-label="Tome"
        className="max-h-[60vh] min-h-40 overflow-y-auto"
        placeholder="Empty. The Familiar adds facts, decisions and preferences here as you work."
        value={text}
        disabled={!canOperate}
        onChange={(event) =>
          setDraft({
            text: event.target.value,
            revision: draft?.revision ?? familiar.tomeRevision,
          })
        }
      />
    </Section>
  );
}

function FamiliarGeasa({
  environmentId,
  familiar,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
}) {
  const query = useEnvironmentQuery(grimoireAtoms.grimoire({ environmentId, input: {} }));
  const projects = useProjects();
  const rows = (query.data?.geasa ?? []).filter(
    (row) => familiar.threadId !== null && row.enactedByThreadId === familiar.threadId,
  );
  return (
    <Section title="Geasa it laid" hint="Newest activity first.">
      {rows.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <GrimoireRowItem
              key={row.id}
              environmentId={environmentId}
              row={row}
              projectTitle={
                projects.find(
                  (project) =>
                    project.environmentId === environmentId && project.id === row.projectId,
                )?.title ?? null
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function FamiliarRoutines({
  environmentId,
  familiar,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const tasks = (query.data?.tasks ?? []).filter(
    (task) => familiar.threadId !== null && task.threadId === familiar.threadId,
  );
  const held = new Set<string>(familiar.heldTaskIds);
  const canAdd = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title="Routines"
      hint={`Scheduled tasks that post to this channel. Add one here, or ask ${familiar.name} to schedule one.`}
      action={
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" render={<Link to="/settings/scheduled-tasks" />}>
            Scheduled tasks
          </Button>
          {familiar.threadId !== null && familiar.archivedAt === null ? (
            <Button variant="outline" size="sm" disabled={!canAdd} onClick={() => setAdding(true)}>
              <PlusIcon />
              Add routine
            </Button>
          ) : null}
        </div>
      }
    >
      {adding ? (
        <RoutineDialog
          environmentId={environmentId}
          familiar={familiar}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {tasks.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {tasks.map((task) => (
            <li key={task.id} className="flex min-w-0 items-center gap-3 px-2 py-1">
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {held.has(task.id) ? "Held" : task.enabled ? "On" : "Off"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const AUTONOMY_LABELS: Record<FamiliarAutonomy, string> = {
  start: "Enact and start",
  backlog: "Backlog only",
};

function FamiliarSettings({
  environmentId,
  familiar,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
}) {
  const canOperate = useAtomValue(familiarAtoms.update.permissionAtom(environmentId));
  const update = useAtomCommand(familiarAtoms.update, { label: "update Familiar" });
  const [name, setName] = useState(familiar.name);
  const [role, setRole] = useState(familiar.rolePrompt);
  const [autonomy, setAutonomy] = useState<FamiliarAutonomy>(familiar.autonomy);
  const [budget, setBudget] = useState(String(familiar.dailyRunBudget));
  const [saving, setSaving] = useState(false);
  const dailyRunBudget = Number(budget);
  const valid =
    name.trim() !== "" &&
    name.trim().length <= 40 &&
    Number.isInteger(dailyRunBudget) &&
    dailyRunBudget >= 1 &&
    dailyRunBudget <= 500;
  const dirty =
    name.trim() !== familiar.name ||
    role.trim() !== familiar.rolePrompt ||
    autonomy !== familiar.autonomy ||
    dailyRunBudget !== familiar.dailyRunBudget;

  const save = async () => {
    if (!valid || !dirty || saving) return;
    setSaving(true);
    await update({
      environmentId,
      input: {
        familiarId: familiar.id,
        name: name.trim(),
        rolePrompt: role.trim(),
        autonomy,
        dailyRunBudget,
      },
    });
    setSaving(false);
  };

  return (
    <Section
      title="Settings"
      hint="A new role reaches the channel at its next new session."
      action={
        dirty ? (
          <Button size="sm" disabled={!canOperate || !valid || saving} onClick={() => void save()}>
            Save
          </Button>
        ) : null
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="familiar-settings-name">Name</Label>
          <Input
            id="familiar-settings-name"
            maxLength={40}
            value={name}
            disabled={!canOperate}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="familiar-settings-autonomy">Autonomy</Label>
          <Select
            value={autonomy}
            disabled={!canOperate}
            onValueChange={(value) => setAutonomy(value as FamiliarAutonomy)}
          >
            <SelectTrigger size="sm" id="familiar-settings-autonomy">
              <SelectValue>{AUTONOMY_LABELS[autonomy]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="start">{AUTONOMY_LABELS.start}</SelectItem>
              <SelectItem value="backlog">{AUTONOMY_LABELS.backlog}</SelectItem>
            </SelectPopup>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="familiar-settings-budget">Runs a day</Label>
          <Input
            id="familiar-settings-budget"
            inputMode="numeric"
            value={budget}
            disabled={!canOperate}
            onChange={(event) => setBudget(event.target.value.replaceAll(/[^\d]/g, ""))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="familiar-settings-role">Role</Label>
        <Textarea
          id="familiar-settings-role"
          className="max-h-48 min-h-24 overflow-y-auto"
          value={role}
          disabled={!canOperate}
          onChange={(event) => setRole(event.target.value)}
        />
      </div>
    </Section>
  );
}
