import {
  ThreadId,
  type DeviceCloseInput,
  type DeviceOpenInput,
  type DeviceServiceState,
  type DeviceSession,
  type DeviceSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { deviceListExtras, openLeasedDevice, routeDeviceOpen } from "./deviceLease.ts";

const emulator = (id: string, name: string, extra: Partial<DeviceSummary> = {}): DeviceSummary => ({
  hostId: "local",
  id,
  platform: "android",
  name,
  version: "Android",
  booted: true,
  physical: false,
  ...extra,
});
const agent1 = emulator("emulator-5554", "agent-1");
const agent2 = emulator("emulator-5556", "agent-2");
const phone = emulator("adb-phone", "samsung", { physical: true });

/** An in-memory DeviceService whose open takes a second, as a boot or attach does. */
const fakeDevices = (devices: ReadonlyArray<DeviceSummary> = [agent1, agent2, phone]) => {
  let sessions: ReadonlyArray<DeviceSession> = [];
  const same = (session: DeviceSession, input: DeviceCloseInput) =>
    session.threadId === input.threadId && session.deviceId === input.deviceId;
  return {
    state: Effect.sync(() => ({ devices, sessions }) as unknown as DeviceServiceState),
    open: (input: DeviceOpenInput) =>
      Effect.gen(function* () {
        yield* Effect.sleep("1 second");
        const session: DeviceSession = {
          threadId: input.threadId,
          hostId: "local",
          deviceId: input.deviceId,
          platform: input.platform,
          openedAt: DateTime.formatIso(yield* DateTime.now),
        };
        sessions = [...sessions.filter((existing) => !same(existing, input)), session];
        return session;
      }),
    close: (input: DeviceCloseInput) =>
      Effect.sync(() => {
        sessions = sessions.filter((session) => !same(session, input));
      }),
    holders: (device: DeviceSummary) =>
      sessions.filter((session) => session.deviceId === device.id).map(({ threadId }) => threadId),
  };
};

interface FakeThread {
  readonly title?: string;
  readonly root?: string;
  readonly running?: boolean;
  readonly settled?: boolean;
  readonly archived?: boolean;
}

const threads = (shells: Record<string, FakeThread>) =>
  Layer.mock(ThreadManagementService.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.sync(() => {
        const thread = shells[id];
        if (!thread) return null;
        return {
          title: thread.title ?? id,
          lineage: { rootThreadId: thread.root ?? id },
          activeRunId: thread.running ? "run-1" : null,
          activityRunStatus: null,
          status: "idle",
          pendingRuntimeRequest: null,
          pendingBackgroundTasks: [],
          latestRunCompletedAt: null,
          settledOverride: thread.settled ? "settled" : null,
          archivedAt: thread.archived ? DateTime.makeUnsafe(0) : null,
          deletedAt: null,
        } as never;
      }),
  });

const a = ThreadId.make("thread-a");
const b = ThreadId.make("thread-b");
const open = (
  devices: ReturnType<typeof fakeDevices>,
  threadId: ThreadId,
  device: DeviceSummary = agent1,
) =>
  Effect.gen(function* () {
    const opening = yield* openLeasedDevice(devices, {
      threadId,
      deviceId: device.id,
      platform: device.platform,
    }).pipe(Effect.result, Effect.forkChild);
    yield* TestClock.adjust("1 second");
    return yield* Fiber.join(opening);
  });

describe("device leases", () => {
  it.effect("refuses a device another live thread holds until that thread closes it", () =>
    Effect.gen(function* () {
      const devices = fakeDevices();
      expect((yield* open(devices, a))._tag).toBe("Success");
      const refused = yield* open(devices, b);
      expect(refused._tag === "Failure" && refused.failure.message).toBe(
        'emulator-5554 (agent-1) is open in thread "Fix login". Free: emulator-5556 (agent-2).',
      );
      // Reopening its own device is not a conflict.
      expect((yield* open(devices, a))._tag).toBe("Success");
      yield* devices.close({ threadId: a, deviceId: agent1.id });
      expect((yield* open(devices, b))._tag).toBe("Success");
      expect(devices.holders(agent1)).toEqual([b]);
    }).pipe(
      Effect.provide(
        threads({ [a]: { title: "Fix login", running: true }, [b]: { running: true } }),
      ),
    ),
  );

  it.effect("gives the device to one of two threads that open it at once", () =>
    Effect.gen(function* () {
      const devices = fakeDevices([agent1]);
      const input = { deviceId: agent1.id, platform: agent1.platform };
      const racing = yield* Effect.all(
        [a, b].map((threadId) => openLeasedDevice(devices, { threadId, ...input })),
        { concurrency: "unbounded", mode: "result" },
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("2 seconds");
      const results = yield* Fiber.join(racing);
      expect(results.map((result) => result._tag).sort()).toEqual(["Failure", "Success"]);
      expect(devices.holders(agent1)).toHaveLength(1);
    }).pipe(Effect.provide(threads({ [a]: { running: true }, [b]: { running: true } }))),
  );

  it.effect.each<{ readonly why: string; readonly holder?: FakeThread }>([
    { why: "settled", holder: { settled: true, running: true } },
    { why: "archived", holder: { archived: true } },
    { why: "deleted" },
  ])("takes the device over from a $why thread", ({ holder }) =>
    Effect.gen(function* () {
      const devices = fakeDevices();
      yield* devices
        .open({ threadId: a, deviceId: agent1.id, platform: "android" })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      expect((yield* open(devices, b))._tag).toBe("Success");
      expect(devices.holders(agent1)).toEqual([b]);
    }).pipe(
      Effect.provide(threads({ ...(holder ? { [a]: holder } : {}), [b]: { running: true } })),
    ),
  );

  it.effect("holds a device for an idle thread for half an hour", () =>
    Effect.gen(function* () {
      const devices = fakeDevices();
      expect((yield* open(devices, a))._tag).toBe("Success");
      yield* TestClock.adjust("29 minutes");
      expect((yield* open(devices, b))._tag).toBe("Failure");
      expect(yield* deviceListExtras(yield* devices.state, b, undefined)).toEqual({
        claims: [
          {
            hostId: "local",
            deviceId: agent1.id,
            heldBy: { threadId: a, title: a },
            available: false,
          },
        ],
      });
      yield* TestClock.adjust("2 minutes");
      expect(
        (yield* deviceListExtras(yield* devices.state, b, undefined)).claims?.[0],
      ).toMatchObject({ available: true });
      expect((yield* open(devices, b))._tag).toBe("Success");
      expect(devices.holders(agent1)).toEqual([b]);
    }).pipe(Effect.provide(threads({ [a]: {}, [b]: {} }))),
  );

  it.effect("shares a lease between a thread and its subagents", () =>
    Effect.gen(function* () {
      const devices = fakeDevices();
      const child = ThreadId.make("thread-a-child");
      expect((yield* open(devices, a))._tag).toBe("Success");
      expect((yield* open(devices, child))._tag).toBe("Success");
      expect(yield* deviceListExtras(yield* devices.state, child, undefined)).toEqual({});
      expect((yield* open(devices, b))._tag).toBe("Failure");
    }).pipe(
      Effect.provide(
        threads({
          [a]: { running: true },
          "thread-a-child": { root: a, running: true },
          [b]: { running: true },
        }),
      ),
    ),
  );

  it.effect("defaults to a free emulator, and never to a phone while one is free", () =>
    Effect.gen(function* () {
      const devices = fakeDevices([phone, agent1, agent2]);
      expect((yield* open(devices, a))._tag).toBe("Success");
      const pick = (input: { deviceId?: string }) =>
        Effect.flatMap(devices.state, (state) => routeDeviceOpen(state, input, b)).pipe(
          Effect.map((routed) => routed.state.devices),
        );
      expect(yield* pick({})).toEqual([agent2]);
      // A named device is the agent's choice; the lease decides at open.
      expect(yield* pick({ deviceId: agent1.id })).toEqual([phone, agent1, agent2]);
      expect((yield* open(devices, b, agent2))._tag).toBe("Success");
      // With every emulator held, the list is left alone and the open explains.
      const c = ThreadId.make("thread-c");
      expect((yield* routeDeviceOpen(yield* devices.state, {}, c)).state.devices).toEqual([
        phone,
        agent1,
        agent2,
      ]);
    }).pipe(
      Effect.provide(
        threads({ [a]: { running: true }, [b]: { running: true }, "thread-c": { running: true } }),
      ),
    ),
  );
});
