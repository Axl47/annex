/**
 * Device leases (Annex): a device is open in one live thread at a time; a thread and its
 * subagents share a lease. Sessions live in memory, so a server restart releases every lease.
 * A ward's own emulator is not leased: it belongs to the threads in that ward's worktree only.
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
import * as DeviceService from "../../device/DeviceService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { threadWorkspaceRoot } from "../../project/threadWorkspaceRoot.ts";
import { wardDevices, wardOwners, type WardDevices } from "./wardDevice.ts";

/** How long an idle thread keeps a device after its last run ended or after it opened the device. */
const IDLE_HOLD_MS = 30 * 60_000;

const OWN_DEVICE_HINT =
  "`device_open` without `deviceId` opens this thread's own ward emulator, or a free shared one.";

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

/** Whether the thread that opened a session still counts as using its device. */
export const sessionIsLive = Effect.fn("deviceLease.sessionIsLive")(function* (
  session: DeviceSession,
) {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const shell = yield* Effect.option(threads.getThreadShell(session.threadId));
  return Option.isNone(shell) || holdsDevice(shell.value, session, yield* Clock.currentTimeMillis);
});

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

/** What decides whether a thread may open a device: other threads' holds, and Ward's emulators. */
interface Claims {
  readonly holds: ReadonlyArray<DeviceHold>;
  readonly owners: ReturnType<typeof wardOwners>;
  /** The thread's workspace root, which is its ward's worktree when it has one. */
  readonly root: string | undefined;
}

const wardOwner = (
  claims: Pick<Claims, "owners">,
  device: { readonly hostId: DeviceHostId } & (
    | { readonly id: string }
    | { readonly deviceId: string }
  ),
) =>
  device.hostId === LOCAL_DEVICE_HOST_ID
    ? claims.owners.get("id" in device ? device.id : device.deviceId)
    : undefined;

/** Simulators and emulators the thread could open now; a phone is never offered. */
const freeDevices = (
  devices: ReadonlyArray<DeviceSummary>,
  claims: Claims,
  hostId: DeviceHostId,
  platform: DevicePlatform,
) =>
  devices.filter((device) => {
    if (device.hostId !== hostId || device.platform !== platform || device.physical) return false;
    const owner = wardOwner(claims, device);
    if (owner !== undefined) return owner.worktree === claims.root;
    return !claims.holds.some((hold) => hold.live && on(device.hostId, device.id)(hold));
  });

const hostLocks = new Map<DeviceHostId, Semaphore.Semaphore>();
const hostLock = (hostId: DeviceHostId) => {
  const lock = hostLocks.get(hostId) ?? Semaphore.makeUnsafe(1);
  hostLocks.set(hostId, lock);
  return lock;
};

/**
 * `DeviceService.open`, refused while another live thread has the device open, or when the device
 * is another ward's own emulator. A holder that no longer counts loses its session to the caller.
 */
export const openLeasedDevice = Effect.fn("deviceLease.open")(function* (
  devices: Pick<DeviceService.DeviceService["Service"], "state" | "open" | "close">,
  input: DeviceOpenInput,
  context?: DeviceHost.DeviceOpenContext,
  ward: WardDevices = wardDevices,
) {
  const hostId = input.hostId ?? LOCAL_DEVICE_HOST_ID;
  // The check and the open share one lock per host, so two threads racing for a device cannot both get it.
  return yield* hostLock(hostId).withPermit(
    Effect.gen(function* () {
      const state = yield* devices.state;
      const claims: Claims = {
        holds: yield* otherHolds(state.sessions, input.threadId),
        owners: wardOwners(yield* ward.current),
        root: context?.workspaceRoot,
      };
      const device = state.devices.find(
        (candidate) => candidate.hostId === hostId && candidate.id === input.deviceId,
      );
      const refuse = (why: string) => {
        const free = freeDevices(state.devices, claims, hostId, input.platform);
        return new DeviceRefusedError({
          reason: [
            `${device ? label(device) : input.deviceId} ${why}.`,
            free.length > 0
              ? `Free: ${free.map(label).join(", ")}.`
              : `No other ${input.platform} device on this host is free.`,
          ].join(" "),
        });
      };
      const onDevice = claims.holds.filter(on(hostId, input.deviceId));
      const close = (holds: ReadonlyArray<DeviceHold>) =>
        Effect.forEach(
          holds,
          (hold) =>
            devices.close({ threadId: hold.session.threadId, hostId, deviceId: input.deviceId }),
          { discard: true },
        );
      const owner = wardOwner(claims, { hostId, id: input.deviceId });
      if (owner !== undefined) {
        if (owner.worktree === null) return yield* refuse("is Ward's base image being rebuilt");
        if (owner.worktree !== claims.root)
          return yield* refuse(
            `is ward ${owner.ward}'s own emulator, for threads in that worktree only`,
          );
        // A session from before this emulator started was on an earlier one with the same serial.
        const started = Date.parse(owner.startedAt);
        yield* close(onDevice.filter((hold) => Date.parse(hold.session.openedAt) < started));
        return yield* devices.open(input, context);
      }
      const holder = onDevice.find((hold) => hold.live);
      if (holder) return yield* refuse(`is open in thread "${holder.title}"`);
      yield* close(onDevice);
      return yield* devices.open(input, context);
    }),
  );
});

/**
 * The thread's workspace root, for `device_list`. That tool declares no ProjectService, so a
 * thread that works in its project's folder resolves only where the service is in context.
 */
const listingRoot = Effect.fnUntraced(function* (threadId: ThreadId) {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const shell = Option.getOrNull(yield* Effect.option(threads.getThreadShell(threadId)));
  if (!shell) return undefined;
  if (shell.worktreePath) return shell.worktreePath;
  const projects = yield* Effect.serviceOption(ProjectService.ProjectService);
  if (Option.isNone(projects)) return undefined;
  const project = yield* Effect.option(projects.value.getById(shell.projectId));
  return Option.getOrUndefined(Option.flatten(project))?.workspaceRoot;
});

/**
 * What `device_list` adds for the calling thread: the devices it cannot open or that another
 * thread holds, and where Ward has emulators, how to get its own.
 */
export const deviceListExtras = Effect.fn("deviceLease.listExtras")(function* (
  state: Pick<DeviceServiceState, "sessions">,
  threadId: ThreadId,
  hostId: DeviceHostId | undefined,
  ward: WardDevices = wardDevices,
) {
  const listed = (id: DeviceHostId) => hostId === undefined || id === hostId;
  const list = yield* ward.list;
  const owners = wardOwners(listed(LOCAL_DEVICE_HOST_ID) ? list : null);
  const claims: Array<DeviceToolClaim> = [];
  for (const hold of yield* otherHolds(state.sessions, threadId)) {
    // A ward's emulator is not leased; its ward decides who may open it.
    if (!listed(hold.session.hostId) || wardOwner({ owners }, hold.session)) continue;
    claims.push({
      hostId: hold.session.hostId,
      deviceId: hold.session.deviceId,
      heldBy: { threadId: hold.session.threadId, title: hold.title },
      available: !hold.live,
    });
  }
  if (owners.size > 0) {
    const root = yield* listingRoot(threadId);
    for (const owner of owners.values()) {
      if (owner.ward === null || owner.worktree === root) continue;
      claims.push({
        hostId: LOCAL_DEVICE_HOST_ID,
        deviceId: owner.serial,
        ward: owner.ward,
        available: false,
      });
    }
  }
  return {
    ...(claims.length > 0 ? { claims } : {}),
    ...(list !== null ? { hint: OWN_DEVICE_HINT } : {}),
  };
});

/**
 * What `device_open` opens when the agent names no device: its ward's own emulator, booted
 * through Ward, where the thread has a ward. Otherwise it picks among the simulators and
 * emulators that are free, where a host has any, so never a held device or a phone.
 */
export const routeDeviceOpen = Effect.fn("deviceLease.route")(function* <
  Input extends {
    readonly deviceId?: DeviceId | undefined;
    readonly hostId?: DeviceHostId | undefined;
    readonly platform?: DevicePlatform | undefined;
  },
>(state: DeviceServiceState, input: Input, threadId: ThreadId, ward: WardDevices = wardDevices) {
  if (input.deviceId !== undefined) return { state, input };
  const root = yield* threadWorkspaceRoot(threadId);
  const local = (input.hostId ?? LOCAL_DEVICE_HOST_ID) === LOCAL_DEVICE_HOST_ID;
  if (root !== undefined && local && input.platform !== "ios") {
    const own = yield* ward.boot(root);
    if (Option.isSome(own)) {
      const devices = yield* DeviceService.DeviceService;
      return {
        state: yield* devices.list,
        input: { ...input, hostId: LOCAL_DEVICE_HOST_ID, deviceId: own.value.serial as DeviceId },
      };
    }
  }
  const claims: Claims = {
    holds: yield* otherHolds(state.sessions, threadId),
    owners: wardOwners(yield* ward.list),
    root,
  };
  return {
    state: {
      ...state,
      devices: state.devices.filter((device) => {
        const free = freeDevices(state.devices, claims, device.hostId, device.platform);
        return free.length === 0 || free.includes(device);
      }),
    },
    input,
  };
});
