import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  FamiliarClaudeInstance,
  FamiliarConfigureInstanceInput,
  FamiliarError,
  FamiliarMutationResult,
  FamiliarSetDismissedInput,
  FamiliarSetPausedInput,
  FamiliarsSnapshot,
  FamiliarsSubscribeInput,
  FamiliarSummonInput,
  FamiliarUpdateInput,
  FamiliarWriteTomeInput,
} from "./familiar.ts";
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
  familiarsSubscribe: "annex.familiars.subscribe",
  familiarSummon: "annex.familiar.summon",
  familiarUpdate: "annex.familiar.update",
  familiarWriteTome: "annex.familiar.writeTome",
  familiarSetPaused: "annex.familiar.setPaused",
  familiarSetDismissed: "annex.familiar.setDismissed",
  familiarConfigureInstance: "annex.familiar.configureInstance",
} as const;

const error = Schema.Union([GeasError, EnvironmentAuthorizationError]);

const mutation = <const Tag extends string, P extends Schema.Top, S extends Schema.Top>(
  tag: Tag,
  payload: P,
  success: S,
) => Rpc.make(tag, { payload, success, error });

const familiarError = Schema.Union([FamiliarError, EnvironmentAuthorizationError]);

const familiarMutation = <const Tag extends string, P extends Schema.Top, S extends Schema.Top>(
  tag: Tag,
  payload: P,
  success: S,
) => Rpc.make(tag, { payload, success, error: familiarError });

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
  Rpc.make(ANNEX_WS_METHODS.familiarsSubscribe, {
    payload: FamiliarsSubscribeInput,
    success: FamiliarsSnapshot,
    error: familiarError,
    stream: true,
  }),
  familiarMutation(ANNEX_WS_METHODS.familiarSummon, FamiliarSummonInput, FamiliarMutationResult),
  familiarMutation(ANNEX_WS_METHODS.familiarUpdate, FamiliarUpdateInput, FamiliarMutationResult),
  familiarMutation(
    ANNEX_WS_METHODS.familiarWriteTome,
    FamiliarWriteTomeInput,
    FamiliarMutationResult,
  ),
  familiarMutation(
    ANNEX_WS_METHODS.familiarSetPaused,
    FamiliarSetPausedInput,
    FamiliarMutationResult,
  ),
  familiarMutation(
    ANNEX_WS_METHODS.familiarSetDismissed,
    FamiliarSetDismissedInput,
    FamiliarMutationResult,
  ),
  familiarMutation(
    ANNEX_WS_METHODS.familiarConfigureInstance,
    FamiliarConfigureInstanceInput,
    FamiliarClaudeInstance,
  ),
] as const;

export type AnnexSubscriptionRpcTag =
  | typeof ANNEX_WS_METHODS.grimoireSubscribe
  | typeof ANNEX_WS_METHODS.geasSubscribe
  | typeof ANNEX_WS_METHODS.familiarsSubscribe;

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
  [ANNEX_WS_METHODS.familiarsSubscribe]: AuthOrchestrationReadScope,
  [ANNEX_WS_METHODS.familiarSummon]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.familiarUpdate]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.familiarWriteTome]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.familiarSetPaused]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.familiarSetDismissed]: AuthOrchestrationOperateScope,
  [ANNEX_WS_METHODS.familiarConfigureInstance]: AuthProvidersManageScope,
} as const;
