/**
 * Ward devices (Annex): Ward gives each ward its own Android emulator. This reads which emulator
 * belongs to which worktree and boots a worktree's own, through `ward devices --json` and
 * `ward device --worktree DIR --json` on the host. Everything is empty when Ward is off.
 */
// @effect-diagnostics nodeBuiltinImport:off - device listings and device tools call this without a ProcessRunner in context.
import * as NodeChildProcess from "node:child_process";
import { DeviceRefusedError, LOCAL_DEVICE_HOST_ID } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { wardCommand } from "../../ward/Ward.ts";

const WardDevice = Schema.Struct({
  serial: Schema.String,
  /** Changes with every emulator instance, so a reused serial with a new value is a new, empty device. */
  startedAt: Schema.String,
});
export type WardDevice = typeof WardDevice.Type;

const WardDeviceList = Schema.Struct({
  devices: Schema.Array(
    Schema.Struct({
      ...WardDevice.fields,
      /** Null while Ward rebuilds its base image on this emulator; nobody may open it then. */
      ward: Schema.NullOr(Schema.String),
      worktree: Schema.NullOr(Schema.String),
    }),
  ),
});
export type WardDeviceList = typeof WardDeviceList.Type;

const decodeList = Schema.decodeUnknownOption(Schema.fromJsonString(WardDeviceList));
const decodeDevice = Schema.decodeUnknownOption(Schema.fromJsonString(WardDevice));

export interface WardRun {
  /** Null when the command could not start or was stopped at its timeout. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
export type WardRunner = (args: ReadonlyArray<string>, timeoutMs: number) => Effect.Effect<WardRun>;

const LIST_TTL_MS = 2_000;
const LIST_TIMEOUT_MS = 5_000;
// Booting takes seconds, but minutes when Ward must first rebuild its base image.
const BOOT_TIMEOUT_MS = 4 * 60_000;
/** `ward device` exit code for a worktree that has no ward. */
const NOT_WARDED = 3;

export interface WardDevices {
  /** Ward's emulators, cached for two seconds. Null when Ward is off, unreachable, or has no devices command. */
  readonly list: Effect.Effect<WardDeviceList | null>;
  /** `list`, read from Ward now: a device open must not decide on a listing from before a boot. */
  readonly current: Effect.Effect<WardDeviceList | null>;
  /**
   * Boots the worktree's own emulator if needed and waits until Android is up. Each call also
   * restarts Ward's idle timer for it. None when the worktree has no ward.
   */
  readonly boot: (worktree: string) => Effect.Effect<Option.Option<WardDevice>, DeviceRefusedError>;
}

export const makeWardDevices = (run: WardRunner | null): WardDevices => {
  let cached: { readonly at: number; readonly list: WardDeviceList | null } | undefined;
  const current = Effect.gen(function* () {
    if (run === null) return null;
    const result = yield* run(["devices", "--json"], LIST_TIMEOUT_MS);
    const listed = result.code === 0 ? Option.getOrNull(decodeList(result.stdout)) : null;
    cached = { at: yield* Clock.currentTimeMillis, list: listed };
    return listed;
  });
  const list = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return cached !== undefined && now - cached.at < LIST_TTL_MS ? cached.list : yield* current;
  });
  return {
    list,
    current,
    boot: Effect.fn("wardDevice.boot")(function* (worktree) {
      // An older Ward has no `device` command; its usage error must not read as a failed boot.
      if (run === null || (yield* list) === null) return Option.none();
      const result = yield* run(["device", "--worktree", worktree, "--json"], BOOT_TIMEOUT_MS);
      cached = undefined;
      if (result.code === NOT_WARDED) return Option.none();
      const device = result.code === 0 ? decodeDevice(result.stdout) : Option.none();
      if (Option.isSome(device)) return device;
      const detail =
        result.code === null
          ? "ward device did not finish"
          : result.stderr.trim().split("\n").at(-1) || `ward device exited with ${result.code}`;
      return yield* new DeviceRefusedError({
        reason: `This thread's ward could not start its emulator: ${detail}`,
      });
    }),
  };
};

const runOnHost =
  (ward: string): WardRunner =>
  (args, timeoutMs) =>
    Effect.callback<WardRun>((resume) => {
      const child = NodeChildProcess.execFile(
        ward,
        args,
        { timeout: timeoutMs, encoding: "utf8" },
        (error, stdout, stderr) =>
          resume(
            Effect.succeed({
              code: error === null ? 0 : typeof error.code === "number" ? error.code : null,
              stdout,
              stderr,
            }),
          ),
      );
      return Effect.sync(() => void child.kill());
    });

export const wardDevices = makeWardDevices(wardCommand === null ? null : runOnHost(wardCommand));

/** Ward emulators by adb serial. */
export const wardOwners = (list: WardDeviceList | null) =>
  new Map((list?.devices ?? []).map((device) => [device.serial, device]));

/**
 * A device host's listing with Ward's emulators named after their ward, since they all report one
 * AVD name. The emulator Ward rebuilds its base image on is left out: nobody may open it.
 */
export const withWardDevices = Effect.fn("wardDevice.withWardDevices")(function* <
  Listing extends {
    readonly devices: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  },
  E,
  R,
>(listing: Effect.Effect<Listing, E, R>, ward: WardDevices = wardDevices) {
  const listed = yield* listing;
  const owners = wardOwners(yield* ward.list);
  if (owners.size === 0) return listed;
  return {
    ...listed,
    devices: listed.devices.flatMap((device) => {
      const owner = owners.get(device.id);
      if (owner === undefined) return [device];
      return owner.ward === null ? [] : [{ ...device, name: `ward ${owner.ward}` }];
    }),
  };
});

/** DeviceService's seam: a host's raw listing, with Ward's emulators applied on this machine. */
export const annexDeviceListing = <
  Listing extends {
    readonly devices: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  },
  E,
  R,
>(
  hostId: string,
  listing: Effect.Effect<Listing, E, R>,
): Effect.Effect<Listing, E, R> =>
  hostId === LOCAL_DEVICE_HOST_ID ? withWardDevices(listing) : listing;
