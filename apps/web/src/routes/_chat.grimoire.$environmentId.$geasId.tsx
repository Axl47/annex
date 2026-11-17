import { EnvironmentId, GeasId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { GeasPage } from "../annex/GeasPage";

export const Route = createFileRoute("/_chat/grimoire/$environmentId/$geasId")({
  component: function GeasRoute() {
    const { environmentId, geasId } = Route.useParams();
    return (
      <GeasPage
        key={`${environmentId}:${geasId}`}
        environmentId={EnvironmentId.make(environmentId)}
        geasId={GeasId.make(geasId)}
      />
    );
  },
});
