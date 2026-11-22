import * as Schema from "effect/Schema";

/** A device open Annex refused, with the reason to show: another thread or ward holds the device, or its ward could not start it. */
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

/** A device another thread or a ward holds, as `device_list` reports it to the calling thread. */
export const DeviceToolClaim = Schema.Struct({
  hostId: Schema.String,
  deviceId: Schema.String,
  heldBy: Schema.optional(Schema.Struct({ threadId: Schema.String, title: Schema.String })),
  /** The ward whose own emulator this is. */
  ward: Schema.optional(Schema.String),
  available: Schema.Boolean,
});
export type DeviceToolClaim = typeof DeviceToolClaim.Type;

/** Fields Annex adds to the `device_list` result. */
export const DeviceToolListAnnexFields = {
  claims: Schema.optional(
    Schema.Array(DeviceToolClaim).annotate({
      description:
        "Devices other threads or wards hold. `device_open` refuses the ones with `available: false`.",
    }),
  ),
  hint: Schema.optional(Schema.String),
};
