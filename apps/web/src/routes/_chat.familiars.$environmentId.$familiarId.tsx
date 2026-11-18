import { EnvironmentId, FamiliarId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { FamiliarPage } from "../annex/FamiliarPage";

export const Route = createFileRoute("/_chat/familiars/$environmentId/$familiarId")({
  component: function FamiliarRoute() {
    const { environmentId, familiarId } = Route.useParams();
    return (
      <FamiliarPage
        key={`${environmentId}:${familiarId}`}
        environmentId={EnvironmentId.make(environmentId)}
        familiarId={FamiliarId.make(familiarId)}
      />
    );
  },
});
