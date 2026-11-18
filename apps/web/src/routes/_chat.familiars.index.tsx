import { EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { FamiliarsPage, type FamiliarsSearch } from "../annex/FamiliarsPage";

export const Route = createFileRoute("/_chat/familiars/")({
  validateSearch: (raw: Record<string, unknown>): FamiliarsSearch => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(raw.summon === true || raw.summon === "true" ? { summon: true as const } : {}),
  }),
  component: function FamiliarsRoute() {
    return <FamiliarsPage search={Route.useSearch()} />;
  },
});
