import type { ThreadId } from "@t3tools/contracts";

import {
  familiarTurnContext,
  type FamiliarChannel,
  type ProviderThreadSession,
} from "./familiarLogic.ts";

// MCP visibility and the turn-start seam read Familiar channels synchronously, so FamiliarService
// keeps them here instead of adding a service dependency to upstream layers.
export const familiarChannels = new Map<ThreadId, FamiliarChannel>();

const deliveredTomeRevisions = new Map<string, number>();

/** The seam in ProviderTurnStartService's inline-context join; "" for every other thread. */
export function familiarInlineContext(input: {
  readonly threadId: ThreadId;
  readonly skip: boolean;
  readonly before: ProviderThreadSession;
  readonly after: ProviderThreadSession;
}): string {
  return familiarTurnContext({
    ...input,
    channel: familiarChannels.get(input.threadId),
    delivered: deliveredTomeRevisions,
  });
}
