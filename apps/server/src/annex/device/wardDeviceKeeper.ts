/**
 * Ward stops a ward's emulator after 15 idle minutes, and it cannot see T3's device sessions.
 * So while a live thread has a ward emulator open, this re-runs Ward's boot call for it every
 * five minutes, which restarts Ward's idle timer. It also closes sessions whose emulator is gone.
 */
import { LOCAL_DEVICE_HOST_ID } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as DeviceService from "../../device/DeviceService.ts";
import { wardCommand } from "../../ward/Ward.ts";
import { sessionIsLive } from "./deviceLease.ts";
import { wardDevices, wardOwners, type WardDevices } from "./wardDevice.ts";

const KEEP_ALIVE_MS = 5 * 60_000;

/** What one pass remembers for the next. */
export interface WardKeeperMemory {
  /** Sessions last seen on a ward emulator, as `thread\0serial`. */
  onWard: ReadonlySet<string>;
  /** When each worktree's emulator was last kept alive. */
  readonly keptAlive: Map<string, number>;
}

export const makeWardKeeperMemory = (): WardKeeperMemory => ({
  onWard: new Set(),
  keptAlive: new Map(),
});

/**
 * One pass: close sessions on emulators that stopped or were replaced, and keep alive the ones a
 * live thread has open. A thread that went idle stops counting, so Ward can stop its emulator.
 */
export const keepWardDevices = Effect.fn("wardDevice.keep")(function* (
  devices: Pick<DeviceService.DeviceService["Service"], "state" | "close">,
  memory: WardKeeperMemory,
  ward: WardDevices = wardDevices,
) {
  const sessions = (yield* devices.state).sessions.filter(
    (session) => session.hostId === LOCAL_DEVICE_HOST_ID,
  );
  // Nothing open means nothing to keep alive, and no reason to ask Ward.
  const list = sessions.length === 0 ? null : yield* ward.list;
  const owners = wardOwners(list);
  const now = yield* Clock.currentTimeMillis;
  const onWard = new Set<string>();
  const inUse = new Set<string>();
  for (const session of sessions) {
    const key = `${session.threadId}\0${session.deviceId}`;
    const owner = owners.get(session.deviceId);
    // A reused serial with a later start is a new, empty emulator, possibly another ward's.
    const gone =
      owner === undefined
        ? list !== null && memory.onWard.has(key)
        : Date.parse(session.openedAt) < Date.parse(owner.startedAt);
    if (gone) {
      const closed = yield* Effect.exit(
        devices.close({
          threadId: session.threadId,
          hostId: session.hostId,
          deviceId: session.deviceId,
        }),
      );
      if (Exit.isFailure(closed)) {
        yield* Effect.logWarning("Could not close a session on a stopped ward emulator", {
          cause: closed.cause,
        });
        onWard.add(key); // Retry on the next pass.
      }
    } else if (owner?.worktree != null) {
      onWard.add(key);
      if (yield* sessionIsLive(session)) inUse.add(owner.worktree);
    } else if (list === null && memory.onWard.has(key)) {
      onWard.add(key); // Ward did not answer; decide on the next pass.
    }
  }
  memory.onWard = onWard;
  for (const worktree of memory.keptAlive.keys())
    if (!inUse.has(worktree)) memory.keptAlive.delete(worktree);
  for (const worktree of inUse) {
    if (now - (memory.keptAlive.get(worktree) ?? -Infinity) < KEEP_ALIVE_MS) continue;
    memory.keptAlive.set(worktree, now);
    yield* ward.boot(worktree).pipe(Effect.ignore);
  }
});

/** Runs the keeper every minute; nothing runs when Ward is off. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (wardCommand === null) return;
    const devices = yield* DeviceService.DeviceService;
    const memory = makeWardKeeperMemory();
    yield* keepWardDevices(devices, memory).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped,
    );
  }),
);
