import { ANNEX_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Geas state and mutations for any client; each surface builds it once on its own runtime. */
export function createGrimoireAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    grimoire: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "annex:grimoire:live",
      tag: ANNEX_WS_METHODS.grimoireSubscribe,
    }),
    geas: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "annex:geas:live",
      tag: ANNEX_WS_METHODS.geasSubscribe,
    }),
    enact: createEnvironmentRpcCommand(runtime, {
      label: "annex:geas:enact",
      tag: ANNEX_WS_METHODS.geasEnact,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "annex:geas:update",
      tag: ANNEX_WS_METHODS.geasUpdate,
    }),
    comment: createEnvironmentRpcCommand(runtime, {
      label: "annex:geas:comment",
      tag: ANNEX_WS_METHODS.geasComment,
    }),
    act: createEnvironmentRpcCommand(runtime, {
      label: "annex:geas:act",
      tag: ANNEX_WS_METHODS.geasAct,
    }),
    runAgain: createEnvironmentRpcCommand(runtime, {
      label: "annex:geas:run-again",
      tag: ANNEX_WS_METHODS.geasRunAgain,
    }),
    archive: createEnvironmentRpcCommand(runtime, {
      label: "annex:geas:archive",
      tag: ANNEX_WS_METHODS.geasArchive,
    }),
    updateProjectSettings: createEnvironmentRpcCommand(runtime, {
      label: "annex:grimoire:update-project-settings",
      tag: ANNEX_WS_METHODS.grimoireUpdateProjectSettings,
    }),
  };
}
