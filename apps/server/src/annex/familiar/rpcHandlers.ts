import {
  ANNEX_WS_METHODS,
  FamiliarError,
  type FamiliarConfigureInstanceInput,
  type FamiliarSetDismissedInput,
  type FamiliarSetPausedInput,
  type FamiliarsSubscribeInput,
  type FamiliarSummonInput,
  type FamiliarUpdateInput,
  type FamiliarWriteTomeInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { FamiliarService } from "./FamiliarService.ts";

const unavailable = new FamiliarError({ message: "Familiars are not available on this server." });

/** Each handler calls one service method; the service is optional, as for geasa. */
export const makeFamiliarRpcHandlers = Effect.gen(function* () {
  const familiars = Option.getOrUndefined(yield* Effect.serviceOption(FamiliarService));
  const call = <A, E>(run: (service: FamiliarService["Service"]) => Effect.Effect<A, E>) =>
    familiars === undefined ? Effect.fail(unavailable) : run(familiars);
  return {
    [ANNEX_WS_METHODS.familiarsSubscribe]: (input: FamiliarsSubscribeInput) =>
      familiars === undefined ? Stream.fail(unavailable) : familiars.subscribe(input),
    [ANNEX_WS_METHODS.familiarSummon]: (input: FamiliarSummonInput) =>
      call((service) => service.summon(input)),
    [ANNEX_WS_METHODS.familiarUpdate]: (input: FamiliarUpdateInput) =>
      call((service) => service.update(input)),
    [ANNEX_WS_METHODS.familiarWriteTome]: (input: FamiliarWriteTomeInput) =>
      call((service) =>
        service.writeTome(input).pipe(
          Effect.catchTags({
            FamiliarStaleTomeError: (stale) =>
              Effect.fail(
                new FamiliarError({ message: stale.message, familiarId: input.familiarId }),
              ),
          }),
        ),
      ),
    [ANNEX_WS_METHODS.familiarSetPaused]: (input: FamiliarSetPausedInput) =>
      call((service) => service.setPaused(input)),
    [ANNEX_WS_METHODS.familiarSetDismissed]: (input: FamiliarSetDismissedInput) =>
      call((service) => service.setDismissed(input)),
    [ANNEX_WS_METHODS.familiarConfigureInstance]: (input: FamiliarConfigureInstanceInput) =>
      call((service) => service.configureInstance(input)),
  } as const;
});
