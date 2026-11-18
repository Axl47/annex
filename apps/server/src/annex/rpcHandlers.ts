import * as Effect from "effect/Effect";

import { makeGeasRpcHandlers } from "./geas/rpcHandlers.ts";

/** Spread into ws.ts's handler map: every Annex feature's RPCs, so ws.ts keeps one seam. */
export const makeAnnexRpcHandlers = Effect.map(makeGeasRpcHandlers, (geas) => ({ ...geas }));
