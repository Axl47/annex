import * as Layer from "effect/Layer";

import * as FamiliarService from "./familiar/FamiliarService.ts";
import * as GeasService from "./geas/GeasService.ts";

/** Every Annex service, merged into the server's runtime layer through one seam. */
export const AnnexLayer = FamiliarService.layer.pipe(Layer.provideMerge(GeasService.layer));
