import { ANNEX_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Familiar state and mutations for any client; each surface builds it once on its own runtime. */
export function createFamiliarAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    familiars: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "annex:familiars:live",
      tag: ANNEX_WS_METHODS.familiarsSubscribe,
    }),
    summon: createEnvironmentRpcCommand(runtime, {
      label: "annex:familiar:summon",
      tag: ANNEX_WS_METHODS.familiarSummon,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "annex:familiar:update",
      tag: ANNEX_WS_METHODS.familiarUpdate,
    }),
    writeTome: createEnvironmentRpcCommand(runtime, {
      label: "annex:familiar:write-tome",
      tag: ANNEX_WS_METHODS.familiarWriteTome,
    }),
    setPaused: createEnvironmentRpcCommand(runtime, {
      label: "annex:familiar:set-paused",
      tag: ANNEX_WS_METHODS.familiarSetPaused,
    }),
    setDismissed: createEnvironmentRpcCommand(runtime, {
      label: "annex:familiar:set-dismissed",
      tag: ANNEX_WS_METHODS.familiarSetDismissed,
    }),
    configureInstance: createEnvironmentRpcCommand(runtime, {
      label: "annex:familiar:configure-instance",
      tag: ANNEX_WS_METHODS.familiarConfigureInstance,
    }),
  };
}
