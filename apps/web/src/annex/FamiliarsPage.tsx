import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, Familiar, FamiliarsSnapshot } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArchiveIcon, PlusIcon, Settings2Icon, CatIcon } from "lucide-react";
import { useState } from "react";

import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
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
import { isElectron } from "../env";
import { useNowMinute } from "../hooks/useNowMinute";
import { cn } from "../lib/utils";
import { useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import {
  FAMILIAR_STATE_LABELS,
  familiarAtoms,
  familiarRunsToday,
  familiarState,
  useGrimoireEnvironmentId,
} from "./state";
import { SummonDialog } from "./SummonDialog";

export interface FamiliarsSearch {
  readonly environmentId?: EnvironmentId;
  /** Opens the summon dialog, for the command palette. */
  readonly summon?: true;
}

export function FamiliarsPage({ search }: { readonly search: FamiliarsSearch }) {
  const environmentId = useGrimoireEnvironmentId(search.environmentId);
  if (environmentId === null) {
    return (
      <SidebarInset className="h-dvh min-h-0">
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CatIcon />
            </EmptyMedia>
            <EmptyTitle>No environment connected</EmptyTitle>
            <EmptyDescription>Connect to a T3 Code server to see its Familiars.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }
  return <Familiars environmentId={environmentId} search={search} />;
}

function Familiars({
  environmentId,
  search,
}: {
  readonly environmentId: EnvironmentId;
  readonly search: FamiliarsSearch;
}) {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const [summonClicked, setSummonClicked] = useState(false);
  const summoning = summonClicked || search.summon === true;
  const setSummoning = (open: boolean) => {
    setSummonClicked(open);
    if (!open && search.summon === true) {
      void navigate({
        to: "/familiars",
        search: search.environmentId === undefined ? {} : { environmentId: search.environmentId },
        replace: true,
      });
    }
  };
  const [configuring, setConfiguring] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const query = useEnvironmentQuery(
    familiarAtoms.familiars({
      environmentId,
      input: showDismissed ? { includeArchived: true } : {},
    }),
  );
  const canSummon = useAtomValue(familiarAtoms.summon.permissionAtom(environmentId));
  const projects = useProjects();
  const projectTitles = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id as string, project.title]),
  );
  const familiars = query.data?.familiars ?? [];

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Familiars breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Familiars</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          <div
            className="flex items-center gap-1 [-webkit-app-region:no-drag]"
            data-workspace-titlebar-controls
          >
            {environments.length > 1 ? (
              <Select
                value={environmentId}
                onValueChange={(value) =>
                  void navigate({
                    to: "/familiars",
                    search: { environmentId: value as EnvironmentId },
                  })
                }
              >
                <SelectTrigger size="sm" aria-label="Environment">
                  <SelectValue>
                    {environments.find((environment) => environment.environmentId === environmentId)
                      ?.label ?? environmentId}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((environment) => (
                    <SelectItem key={environment.environmentId} value={environment.environmentId}>
                      {environment.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
            <Button
              variant={showDismissed ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={showDismissed ? "Hide dismissed" : "Show dismissed"}
              aria-pressed={showDismissed}
              onClick={() => setShowDismissed((current) => !current)}
            >
              <ArchiveIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Familiar settings"
              disabled={query.data === null}
              onClick={() => setConfiguring(true)}
            >
              <Settings2Icon />
            </Button>
            <Button
              size="sm"
              disabled={!canSummon || query.data === null}
              onClick={() => setSummoning(true)}
            >
              <PlusIcon />
              Summon
            </Button>
          </div>
        </WorkspacePageHeader>

        <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide" className="min-h-full gap-6">
            {query.error !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {query.error}
              </p>
            ) : null}
            {query.data !== null && familiars.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CatIcon />
                  </EmptyMedia>
                  <EmptyTitle>No Familiars yet</EmptyTitle>
                  <EmptyDescription>
                    A Familiar is a standing agent with its own channel and a Tome it keeps across
                    sessions. It lays geasa for real work and hears back when they need it.
                  </EmptyDescription>
                </EmptyHeader>
                <Button disabled={!canSummon} onClick={() => setSummoning(true)}>
                  <PlusIcon />
                  Summon a Familiar
                </Button>
              </Empty>
            ) : null}
            {familiars.length > 0 ? (
              <ul className="flex flex-col">
                {familiars.map((familiar) => (
                  <FamiliarRowItem
                    key={familiar.id}
                    environmentId={environmentId}
                    familiar={familiar}
                    projectTitle={projectTitles.get(familiar.projectId) ?? null}
                  />
                ))}
              </ul>
            ) : null}
          </WorkspacePageContainer>
        </div>
      </div>
      {summoning && query.data !== null ? (
        <SummonDialog
          environmentId={environmentId}
          claudeInstance={query.data.claudeInstance}
          onClose={(summoned) => {
            if (summoned === undefined) {
              setSummoning(false);
              return;
            }
            setSummonClicked(false);
            // The channel is where you talk to it, so that's where a new Familiar opens.
            void (summoned.threadId === undefined
              ? navigate({
                  to: "/familiars/$environmentId/$familiarId",
                  params: { environmentId, familiarId: summoned.familiarId },
                })
              : navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(scopeThreadRef(environmentId, summoned.threadId)),
                }));
          }}
        />
      ) : null}
      {configuring && query.data !== null ? (
        <FamiliarInstanceDialog
          environmentId={environmentId}
          claudeInstance={query.data.claudeInstance}
          onClose={() => setConfiguring(false)}
        />
      ) : null}
    </SidebarInset>
  );
}

function FamiliarRowItem({
  environmentId,
  familiar,
  projectTitle,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
  readonly projectTitle: string | null;
}) {
  const nowMillis = Date.parse(`${useNowMinute()}:00.000Z`);
  const state = familiarState(familiar, nowMillis);
  return (
    <li>
      <Link
        to="/familiars/$environmentId/$familiarId"
        params={{ environmentId, familiarId: familiar.id }}
        className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <CatIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            state === "active" ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="w-32 shrink-0 truncate font-medium">{familiar.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {familiar.rolePrompt.split("\n")[0]}
        </span>
        {familiar.heldWakes.length > 0 ? (
          <span className="shrink-0 text-xs text-warning">{familiar.heldWakes.length} waiting</span>
        ) : null}
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {state === "active"
            ? `${familiarRunsToday(familiar, nowMillis)}/${familiar.dailyRunBudget} today`
            : FAMILIAR_STATE_LABELS[state]}
        </span>
        {projectTitle !== null ? (
          <span className="hidden max-w-40 shrink-0 truncate text-xs text-muted-foreground md:block">
            {projectTitle}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

const DEFAULT_COMPACT_AFTER = 400_000;

function FamiliarInstanceDialog({
  environmentId,
  claudeInstance,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly claudeInstance: FamiliarsSnapshot["claudeInstance"];
  readonly onClose: () => void;
}) {
  const canConfigure = useAtomValue(familiarAtoms.configureInstance.permissionAtom(environmentId));
  const configure = useAtomCommand(familiarAtoms.configureInstance, {
    label: "configure Claude · Familiars",
  });
  const current = Number(claudeInstance?.autoCompactWindow);
  const [value, setValue] = useState(
    String(Number.isFinite(current) && current > 0 ? current : DEFAULT_COMPACT_AFTER),
  );
  const [saving, setSaving] = useState(false);
  const compactAfter = Number(value);
  const valid =
    Number.isInteger(compactAfter) && compactAfter >= 100_000 && compactAfter <= 1_000_000;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const result = await configure({ environmentId, input: { compactAfter } });
    setSaving(false);
    if (result._tag === "Success") onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Claude · Familiars</DialogTitle>
            <DialogDescription>
              A Claude instance for long-lived channels. It compacts once a session reaches this
              many tokens and never compacts while idle, using your default Claude sign-in. Pick it
              in the model picker when you summon.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-1.5">
              <Label htmlFor="familiar-compact-after">Compact after (tokens)</Label>
              <Input
                id="familiar-compact-after"
                inputMode="numeric"
                value={value}
                aria-invalid={!valid}
                disabled={!canConfigure}
                onChange={(event) => setValue(event.target.value.replaceAll(/[^\d]/g, ""))}
              />
              {!valid ? (
                <p className="text-xs text-destructive">Between 100,000 and 1,000,000.</p>
              ) : null}
              {!canConfigure ? (
                <p className="text-xs text-muted-foreground">
                  Changing provider instances needs provider management access on this environment.
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canConfigure || !valid || saving}>
              {claudeInstance === null ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
