import { createFamiliarAtoms } from "@t3tools/client-runtime/annex/familiars";
import { createGrimoireAtoms } from "@t3tools/client-runtime/annex/grimoire";
import type {
  EnvironmentId,
  Familiar,
  FamiliarWakeEvent,
  GeasStatus,
  GrimoireRow,
} from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";

export const grimoireAtoms = createGrimoireAtoms(connectionAtomRuntime);
export const familiarAtoms = createFamiliarAtoms(connectionAtomRuntime);

/** The environment the Grimoire shows: the chosen one, else this machine's, else the first connected. */
export function useGrimoireEnvironmentId(chosen: EnvironmentId | undefined): EnvironmentId | null {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  if (
    chosen !== undefined &&
    environments.some((environment) => environment.environmentId === chosen)
  ) {
    return chosen;
  }
  if (primary !== null && connected.some((environment) => environment.environmentId === primary)) {
    return primary;
  }
  return connected[0]?.environmentId ?? primary;
}

export const GEAS_STATUS_LABELS: Record<GeasStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

export type GrimoireGroupId = "needs_you" | GeasStatus | "archived";

const GROUP_ORDER: ReadonlyArray<GrimoireGroupId> = [
  "needs_you",
  "in_review",
  "in_progress",
  "todo",
  "backlog",
  "done",
  "canceled",
  "archived",
];

const GROUP_LABELS: Record<GrimoireGroupId, string> = {
  needs_you: "Needs you",
  ...GEAS_STATUS_LABELS,
  archived: "Archived",
};

/** Needs-you pulls a geas out of its status group, so each geas shows once. */
export function groupGrimoire(rows: ReadonlyArray<GrimoireRow>) {
  const groups = new Map<GrimoireGroupId, Array<GrimoireRow>>();
  for (const row of rows) {
    const id: GrimoireGroupId =
      row.archivedAt !== null
        ? "archived"
        : row.needsYou && row.status !== "done" && row.status !== "canceled"
          ? "needs_you"
          : row.status;
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  return GROUP_ORDER.flatMap((id) => {
    const group = groups.get(id);
    return group === undefined ? [] : [{ id, label: GROUP_LABELS[id], rows: group }];
  });
}

export const FAMILIAR_WAKE_LABELS: Record<FamiliarWakeEvent, string> = {
  asked: "asks for input",
  in_review: "moved to In review",
  run_failed: "a run failed",
  loop_guard: "loop guard stopped it",
  done: "landed",
  canceled: "canceled",
  archived: "archived",
};

/** Matches the server's local budget day closely enough for a label. */
function localDay(epochMillis: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(epochMillis);
}

export type FamiliarState = "dismissed" | "paused" | "spent" | "active";

export function familiarState(familiar: Familiar, nowMillis: number): FamiliarState {
  if (familiar.archivedAt !== null) return "dismissed";
  if (familiar.pausedAt !== null) return "paused";
  return familiarRunsToday(familiar, nowMillis) >= familiar.dailyRunBudget ? "spent" : "active";
}

/** The count resets on a new day even before the server's next sweep stores it. */
export function familiarRunsToday(familiar: Familiar, nowMillis: number): number {
  return familiar.runsDay === localDay(nowMillis) ? familiar.runsToday : 0;
}

export const FAMILIAR_STATE_LABELS: Record<FamiliarState, string> = {
  dismissed: "Dismissed",
  paused: "Paused",
  spent: "Budget spent for today",
  active: "Active",
};
