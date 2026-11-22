/**
 * Device leases (Annex): a device is open in one live thread at a time, so one thread's agent
 * cannot change the emulator another thread is testing on. A thread and its subagents share a
 * lease. Sessions live in memory, so a server restart releases every lease.
 */
import {
  DeviceRefusedError,
  isLiveSubagentShell,
  LOCAL_DEVICE_HOST_ID,
  type DeviceHostId,
  type DeviceId,
  type DeviceOpenInput,
  type DevicePlatform,
  type DeviceServiceState,
  type DeviceSession,
  type DeviceSummary,
  type DeviceToolClaim,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import type * as DeviceHost from "../../device/DeviceHost.ts";
import type * as DeviceService from "../../device/DeviceService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";

/** How long an idle thread keeps a device after its last run ended or after it opened the device. */
const IDLE_HOLD_MS = 30 * 60_000;

type HolderShell = Pick<
  OrchestrationV2ThreadShell,
  | "activeRunId"
  | "activityRunStatus"
  | "archivedAt"
  | "deletedAt"
  | "latestRunCompletedAt"
  | "pendingBackgroundTasks"
  | "pendingRuntimeRequest"
  | "settledOverride"
  | "status"
>;

/**
 * Whether a thread still holds a device it opened. It does while it works, and for
 * `IDLE_HOLD_MS` after; a settled, archived or deleted thread gives the device up at once.
 */
const holdsDevice = (
  shell: HolderShell | null,
  session: Pick<DeviceSession, "openedAt">,
  nowMs: number,
): boolean => {
  if (shell === null || shell.archivedAt !== null || shell.deletedAt !== null) return false;
  if (shell.settledOverride === "settled") return false;
  if (shell.activeRunId !== null || isLiveSubagentShell(shell)) return true;
  const lastActive = Math.max(
    Date.parse(session.openedAt),
    shell.latestRunCompletedAt ? DateTime.toEpochMillis(shell.latestRunCompletedAt) : 0,
  );
  return nowMs - lastActive < IDLE_HOLD_MS;
};

interface DeviceHold {
  readonly session: DeviceSession;
  readonly title: string;
  /** False once the holder no longer counts; the next thread to open the device takes it over. */
  readonly live: boolean;
}

/** Sessions of threads outside `threadId`'s family. A lookup that fails keeps the hold. */
const otherHolds = Effect.fn("deviceLease.otherHolds")(function* (
  sessions: ReadonlyArray<DeviceSession>,
  threadId: ThreadId,
) {
  if (sessions.every((session) => session.threadId === threadId)) return [];
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const now = yield* Clock.currentTimeMillis;
  const shells = new Map<ThreadId, Option.Option<OrchestrationV2ThreadShell | null>>();
  const shellOf = Effect.fnUntraced(function* (id: ThreadId) {
    const known = shells.get(id);
    if (known) return known;
    const shell = yield* Effect.option(threads.getThreadShell(id));
    shells.set(id, shell);
    return shell;
  });
  const own = Option.getOrNull(yield* shellOf(threadId));
  const family = own?.lineage.rootThreadId ?? threadId;
  const holds: Array<DeviceHold> = [];
  for (const session of sessions) {
    if (session.threadId === threadId) continue;
    const shell = yield* shellOf(session.threadId);
    const holder = Option.getOrNull(shell);
    if (holder?.lineage.rootThreadId === family) continue;
    holds.push({
      session,
      title: holder?.title.trim() || session.threadId,
      live: Option.isNone(shell) || holdsDevice(holder, session, now),
    });
  }
  return holds;
});

const on = (hostId: DeviceHostId, deviceId: DeviceId) => (hold: DeviceHold) =>
  hold.session.hostId === hostId && hold.session.deviceId === deviceId;

const label = (device: Pick<DeviceSummary, "id" | "name">) => `${device.id} (${device.name})`;

/** Simulators and emulators on a host that no other live thread holds; a phone is never offered. */
const freeDevices = (
  devices: ReadonlyArray<DeviceSummary>,
  holds: ReadonlyArray<DeviceHold>,
  hostId: DeviceHostId,
  platform: DevicePlatform,
) =>
  devices.filter(
    (device) =>
      device.hostId === hostId &&
      device.platform === platform &&
      !device.physical &&
      !holds.some((hold) => hold.live && on(device.hostId, device.id)(hold)),
  );

const hostLocks = new Map<DeviceHostId, Semaphore.Semaphore>();
const hostLock = (hostId: DeviceHostId) => {
  const lock = hostLocks.get(hostId) ?? Semaphore.makeUnsafe(1);
  hostLocks.set(hostId, lock);
  return lock;
};

/**
 * `DeviceService.open`, refused while another live thread has the device open. A holder that no
 * longer counts loses its session to the caller.
 */
export const openLeasedDevice = Effect.fn("deviceLease.open")(function* (
  devices: Pick<DeviceService.DeviceService["Service"], "state" | "open" | "close">,
  input: DeviceOpenInput,
  context?: DeviceHost.DeviceOpenContext,
) {
  const hostId = input.hostId ?? LOCAL_DEVICE_HOST_ID;
  // The check and the open share one lock per host, so two threads racing for a device cannot both get it.
  return yield* hostLock(hostId).withPermit(
    Effect.gen(function* () {
      const state = yield* devices.state;
      const holds = yield* otherHolds(state.sessions, input.threadId);
      const onDevice = holds.filter(on(hostId, input.deviceId));
      const holder = onDevice.find((hold) => hold.live);
      if (holder) {
        const device = state.devices.find(
          (candidate) => candidate.hostId === hostId && candidate.id === input.deviceId,
        );
        const free = freeDevices(state.devices, holds, hostId, input.platform);
        return yield* new DeviceRefusedError({
          reason: [
            `${device ? label(device) : input.deviceId} is open in thread "${holder.title}".`,
            free.length > 0
              ? `Free: ${free.map(label).join(", ")}.`
              : `No other ${input.platform} device on this host is free.`,
          ].join(" "),
        });
      }
      yield* Effect.forEach(
        onDevice,
        (hold) =>
          devices.close({ threadId: hold.session.threadId, hostId, deviceId: input.deviceId }),
        { discard: true },
      );
      return yield* devices.open(input, context);
    }),
  );
});

/** What `device_list` adds for the calling thread: the devices other threads hold. */
export const deviceListExtras = Effect.fn("deviceLease.listExtras")(function* (
  state: Pick<DeviceServiceState, "sessions">,
  threadId: ThreadId,
  hostId: DeviceHostId | undefined,
) {
  const holds = yield* otherHolds(state.sessions, threadId);
  const claims = holds
    .filter((hold) => hostId === undefined || hold.session.hostId === hostId)
    .map((hold): DeviceToolClaim => ({
      hostId: hold.session.hostId,
      deviceId: hold.session.deviceId,
      heldBy: { threadId: hold.session.threadId, title: hold.title },
      available: !hold.live,
    }));
  return claims.length > 0 ? { claims } : {};
});

/**
 * The devices `device_open` picks a default from when the agent names none: where a host has a
 * free simulator or emulator, held devices and phones are left out.
 */
export const routeDeviceOpen = Effect.fn("deviceLease.route")(function* <
  State extends Pick<DeviceServiceState, "devices" | "sessions">,
  Input extends { readonly deviceId?: DeviceId | undefined },
>(state: State, input: Input, threadId: ThreadId) {
  if (input.deviceId !== undefined) return { state, input };
  const holds = yield* otherHolds(state.sessions, threadId);
  const free = (device: DeviceSummary) =>
    freeDevices(state.devices, holds, device.hostId, device.platform);
  return {
    state: {
      ...state,
      devices: state.devices.filter((device) => {
        const candidates = free(device);
        return candidates.length === 0 || candidates.includes(device);
      }),
    },
    input,
  };
});
