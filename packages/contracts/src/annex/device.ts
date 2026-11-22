import * as Schema from "effect/Schema";

/** A device open Annex refused, with the reason to show: another thread has the device open. */
export class DeviceRefusedError extends Schema.TaggedError<DeviceRefusedError>()(
  "DeviceRefusedError",
  {
    reason: Schema.String,
  },
) {
  override get message(): string {
    return this.reason;
  }
}

/** A device another thread holds, as `device_list` reports it to the calling thread. */
export const DeviceToolClaim = Schema.Struct({
  hostId: Schema.String,
  deviceId: Schema.String,
  heldBy: Schema.optional(Schema.Struct({ threadId: Schema.String, title: Schema.String })),
  available: Schema.Boolean,
});
export type DeviceToolClaim = typeof DeviceToolClaim.Type;

/** Fields Annex adds to the `device_list` result. */
export const DeviceToolListAnnexFields = {
  claims: Schema.optional(
    Schema.Array(DeviceToolClaim).annotate({
      description:
        "Devices other threads hold. `device_open` refuses the ones with `available: false`.",
    }),
  ),
};
