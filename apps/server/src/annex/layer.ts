import * as GeasService from "./geas/GeasService.ts";

/** Every Annex service, merged into the server's runtime layer through one seam. */
export const AnnexLayer = GeasService.layer;
