import * as Effect from "effect/Effect";

import { makeFamiliarRpcHandlers } from "./familiar/rpcHandlers.ts";
import { makeGeasRpcHandlers } from "./geas/rpcHandlers.ts";

/** Spread into ws.ts's handler map: every Annex feature's RPCs, so ws.ts keeps one seam. */
export const makeAnnexRpcHandlers = Effect.map(
  Effect.all([makeGeasRpcHandlers, makeFamiliarRpcHandlers]),
  ([geas, familiar]) => ({ ...geas, ...familiar }),
);
