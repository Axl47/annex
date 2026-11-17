import { createGrimoireAtoms } from "@t3tools/client-runtime/annex/grimoire";
import type { EnvironmentId, GeasStatus, GrimoireRow } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";

export const grimoireAtoms = createGrimoireAtoms(connectionAtomRuntime);

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

export type GrimoireGroupId = "needs_you" | GeasStatus;

const GROUP_ORDER: ReadonlyArray<GrimoireGroupId> = [
  "needs_you",
  "in_review",
  "in_progress",
  "todo",
  "backlog",
  "done",
  "canceled",
];

const GROUP_LABELS: Record<GrimoireGroupId, string> = {
  needs_you: "Needs you",
  ...GEAS_STATUS_LABELS,
};

/** Needs-you pulls a geas out of its status group, so each geas shows once. */
export function groupGrimoire(rows: ReadonlyArray<GrimoireRow>) {
  const groups = new Map<GrimoireGroupId, Array<GrimoireRow>>();
  for (const row of rows) {
    const id: GrimoireGroupId =
      row.needsYou && row.status !== "done" && row.status !== "canceled" ? "needs_you" : row.status;
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  return GROUP_ORDER.flatMap((id) => {
    const group = groups.get(id);
    return group === undefined ? [] : [{ id, label: GROUP_LABELS[id], rows: group }];
  });
}
