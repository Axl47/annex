import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  GeasActInput,
  GeasArchiveInput,
  GeasCommentInput,
  GeasDetail,
  GeasEnactInput,
  GeasEnactResult,
  GeasError,
  GeasMutationResult,
  GeasRunAgainInput,
  GeasSubscribeInput,
  GeasUpdateInput,
  GrimoireProjectSettings,
  GrimoireSnapshot,
  GrimoireSubscribeInput,
  GrimoireUpdateProjectSettingsInput,
} from "./geas.ts";

export const ANNEX_WS_METHODS = {
  grimoireSubscribe: "annex.grimoire.subscribe",
  grimoireUpdateProjectSettings: "annex.grimoire.updateProjectSettings",
  geasSubscribe: "annex.geas.subscribe",
  geasEnact: "annex.geas.enact",
  geasUpdate: "annex.geas.update",
  geasComment: "annex.geas.comment",
  geasAct: "annex.geas.act",
  geasRunAgain: "annex.geas.runAgain",
  geasArchive: "annex.geas.archive",
} as const;

const error = Schema.Union([GeasError, EnvironmentAuthorizationError]);

const mutation = <const Tag extends string, P extends Schema.Top, S extends Schema.Top>(
  tag: Tag,
  payload: P,
  success: S,
) => Rpc.make(tag, { payload, success, error });

/** Spread into upstream's `WsRpcGroup`, so its scope middleware covers these too. */
export const ANNEX_RPCS = [
  Rpc.make(ANNEX_WS_METHODS.grimoireSubscribe, {
    payload: GrimoireSubscribeInput,
    success: GrimoireSnapshot,
    error,
    stream: true,
  }),
  Rpc.make(ANNEX_WS_METHODS.geasSubscribe, {
    payload: GeasSubscribeInput,
    success: GeasDetail,
    error,
    stream: true,
  }),
  mutation(ANNEX_WS_METHODS.geasEnact, GeasEnactInput, GeasEnactResult),
  mutation(ANNEX_WS_METHODS.geasUpdate, GeasUpdateInput, GeasMutationResult),
  mutation(ANNEX_WS_METHODS.geasComment, GeasCommentInput, GeasMutationResult),
  mutation(ANNEX_WS_METHODS.geasAct, GeasActInput, GeasMutationResult),
  mutation(ANNEX_WS_METHODS.geasRunAgain, GeasRunAgainInput, GeasMutationResult),
  mutation(ANNEX_WS_METHODS.geasArchive, GeasArchiveInput, GeasMutationResult),
  mutation(
    ANNEX_WS_METHODS.grimoireUpdateProjectSettings,
    GrimoireUpdateProjectSettingsInput,
    GrimoireProjectSettings,
  ),
] as const;

export type AnnexSubscriptionRpcTag =
  | typeof ANNEX_WS_METHODS.grimoireSubscribe
  | typeof ANNEX_WS_METHODS.geasSubscribe;

/** Spread into the server's RPC metrics labels. */
export const ANNEX_RPC_AGGREGATES = Object.fromEntries(
  Object.values(ANNEX_WS_METHODS).map((method) => [method, "annex"]),
) as { readonly [M in (typeof ANNEX_WS_METHODS)[keyof typeof ANNEX_WS_METHODS]]: "annex" };

/** Spread into `CLIENT_GUARDED_RPC_SCOPES`; the server's scope table starts from it. */
export const ANNEX_RPC_SCOPES = {
  [ANNEX_WS_METHODS.grimoireSubscribe]: AuthOrchestrationReadScope,
  [ANNEX_WS_METHODS.geasSubscribe]: AuthOrchestrationReadScope,
  [ANNEX_WS_METHODS.geasEnact]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.geasUpdate]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.geasComment]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.geasAct]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.geasRunAgain]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.geasArchive]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.grimoireUpdateProjectSettings]: AuthOrchestrationOperateScope,
} as const;
