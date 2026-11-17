import { EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { GrimoirePage, type GrimoireSearch } from "../annex/GrimoirePage";

export const Route = createFileRoute("/_chat/grimoire/")({
  validateSearch: (raw: Record<string, unknown>): GrimoireSearch =>
    typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {},
  component: function GrimoireRoute() {
    return <GrimoirePage search={Route.useSearch()} />;
  },
});
