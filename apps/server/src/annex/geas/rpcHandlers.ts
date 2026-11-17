import {
  ANNEX_WS_METHODS,
  GeasError,
  type GeasActInput,
  type GeasArchiveInput,
  type GeasCommentInput,
  type GeasEnactInput,
  type GeasRunAgainInput,
  type GeasSubscribeInput,
  type GeasUpdateInput,
  type GrimoireSubscribeInput,
  type GrimoireUpdateProjectSettingsInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { GeasService } from "./GeasService.ts";

const unavailable = new GeasError({ message: "Geasa are not available on this server." });

/**
 * Spread into ws.ts's handler map; each handler calls one service method. The service is
 * optional so upstream's ws tests, which build the socket without it, need no Annex changes.
 */
export const makeAnnexRpcHandlers = Effect.gen(function* () {
  const geas = Option.getOrUndefined(yield* Effect.serviceOption(GeasService));
  const call = <A>(run: (service: GeasService["Service"]) => Effect.Effect<A, GeasError>) =>
    geas === undefined ? Effect.fail(unavailable) : run(geas);
  return {
    [ANNEX_WS_METHODS.grimoireSubscribe]: (input: GrimoireSubscribeInput) =>
      geas === undefined ? Stream.fail(unavailable) : geas.subscribeGrimoire(input),
    [ANNEX_WS_METHODS.geasSubscribe]: (input: GeasSubscribeInput) =>
      geas === undefined ? Stream.fail(unavailable) : geas.subscribeGeas(input.geasId),
    [ANNEX_WS_METHODS.geasEnact]: (input: GeasEnactInput) =>
      call((service) => service.enact(input, { actor: "user", creationSource: "web" })),
    [ANNEX_WS_METHODS.geasUpdate]: (input: GeasUpdateInput) =>
      call((service) => service.update(input)),
    [ANNEX_WS_METHODS.geasComment]: (input: GeasCommentInput) =>
      call((service) => service.comment(input)),
    [ANNEX_WS_METHODS.geasAct]: (input: GeasActInput) => call((service) => service.act(input)),
    [ANNEX_WS_METHODS.geasRunAgain]: (input: GeasRunAgainInput) =>
      call((service) => service.runAgain(input)),
    [ANNEX_WS_METHODS.geasArchive]: (input: GeasArchiveInput) =>
      call((service) => service.archive(input)),
    [ANNEX_WS_METHODS.grimoireUpdateProjectSettings]: (input: GrimoireUpdateProjectSettingsInput) =>
      call((service) => service.updateProjectSettings(input)),
  } as const;
});
