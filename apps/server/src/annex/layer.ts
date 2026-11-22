import * as Layer from "effect/Layer";

import * as DeviceSerial from "./device/deviceSerial.ts";
import * as WardDeviceKeeper from "./device/wardDeviceKeeper.ts";
import * as FamiliarService from "./familiar/FamiliarService.ts";
import * as GeasService from "./geas/GeasService.ts";

/** Every Annex service, merged into the server's runtime layer through one seam. */
export const AnnexLayer = Layer.mergeAll(
  FamiliarService.layer.pipe(Layer.provideMerge(GeasService.layer)),
  WardDeviceKeeper.layer,
  DeviceSerial.layer,
);
