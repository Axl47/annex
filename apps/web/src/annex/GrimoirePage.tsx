import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, GrimoireRow } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useState } from "react";

import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
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
import { useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { EnactDialog } from "./EnactDialog";
import { GeasRunDot, GeasStatusIcon } from "./geasPresentation";
import { GrimoireSettingsDialog } from "./GrimoireSettingsDialog";
import { grimoireAtoms, groupGrimoire, useGrimoireEnvironmentId } from "./state";

export interface GrimoireSearch {
  readonly environmentId?: EnvironmentId;
}

export function GrimoirePage({ search }: { readonly search: GrimoireSearch }) {
  const environmentId = useGrimoireEnvironmentId(search.environmentId);
  if (environmentId === null) {
    return (
      <SidebarInset className="h-dvh min-h-0">
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenIcon />
            </EmptyMedia>
            <EmptyTitle>No environment connected</EmptyTitle>
            <EmptyDescription>Connect to a T3 Code server to see its Grimoire.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }
  return <Grimoire environmentId={environmentId} />;
}

function Grimoire({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const [enacting, setEnacting] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const query = useEnvironmentQuery(grimoireAtoms.grimoire({ environmentId, input: {} }));
  const canEnact = useAtomValue(grimoireAtoms.enact.permissionAtom(environmentId));
  const projects = useProjects();
  const projectTitles = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id as string, project.title]),
  );
  const groups = groupGrimoire(query.data?.geasa ?? []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Grimoire breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Grimoire</h1>
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
                    to: "/grimoire",
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
              variant="ghost"
              size="icon-sm"
              aria-label="Grimoire settings"
              onClick={() => setConfiguring(true)}
            >
              <Settings2Icon />
            </Button>
            <Button size="sm" disabled={!canEnact} onClick={() => setEnacting(true)}>
              <PlusIcon />
              Enact
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
            {query.data !== null && groups.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BookOpenIcon />
                  </EmptyMedia>
                  <EmptyTitle>No geasa yet</EmptyTitle>
                  <EmptyDescription>
                    Enact a geas to hand an agent a piece of work. You review its report, not the
                    conversation.
                  </EmptyDescription>
                </EmptyHeader>
                <Button disabled={!canEnact} onClick={() => setEnacting(true)}>
                  <PlusIcon />
                  Enact a geas
                </Button>
              </Empty>
            ) : null}
            {groups.map((group) => (
              <section key={group.id} className="flex flex-col gap-1">
                <h2 className="px-2 text-xs font-medium text-muted-foreground">
                  {group.label}
                  <span className="ml-1.5 text-muted-foreground/70">{group.rows.length}</span>
                </h2>
                <ul className="flex flex-col">
                  {group.rows.map((row) => (
                    <GrimoireRowItem
                      key={row.id}
                      environmentId={environmentId}
                      row={row}
                      projectTitle={projectTitles.get(row.projectId) ?? null}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </WorkspacePageContainer>
        </div>
      </div>
      {enacting ? (
        <EnactDialog
          environmentId={environmentId}
          onClose={(geasId) => {
            setEnacting(false);
            if (geasId !== undefined) {
              void navigate({
                to: "/grimoire/$environmentId/$geasId",
                params: { environmentId, geasId },
              });
            }
          }}
        />
      ) : null}
      {configuring ? (
        <GrimoireSettingsDialog
          environmentId={environmentId}
          settings={query.data?.projects ?? []}
          onClose={() => setConfiguring(false)}
        />
      ) : null}
    </SidebarInset>
  );
}

function GrimoireRowItem({
  environmentId,
  row,
  projectTitle,
}: {
  readonly environmentId: EnvironmentId;
  readonly row: GrimoireRow;
  readonly projectTitle: string | null;
}) {
  const nowMinute = useNowMinute();
  return (
    <li>
      <Link
        to="/grimoire/$environmentId/$geasId"
        params={{ environmentId, geasId: row.id }}
        className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <GeasStatusIcon status={row.status} />
        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{row.key}</span>
        <span className="min-w-0 flex-1 truncate">{row.title}</span>
        <GeasRunDot runState={row.runState} needsYou={row.needsYou} />
        {projectTitle !== null ? (
          <span className="hidden max-w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">
            {projectTitle}
          </span>
        ) : null}
        <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {formatRelativeTimeLabel(row.lastActivityAt, Date.parse(`${nowMinute}:00.000Z`))}
        </span>
      </Link>
    </li>
  );
}
