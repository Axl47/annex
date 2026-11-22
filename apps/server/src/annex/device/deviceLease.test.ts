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
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as DeviceService from "../../device/DeviceService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { deviceListExtras, openLeasedDevice, routeDeviceOpen } from "./deviceLease.ts";
import { makeWardDevices, type WardDeviceList, type WardDevices } from "./wardDevice.ts";

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
  readonly worktree?: string;
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
          worktreePath: thread.worktree ?? null,
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
const noWard = makeWardDevices(null);
const open = (
  devices: ReturnType<typeof fakeDevices>,
  threadId: ThreadId,
  device: DeviceSummary = agent1,
  ward: { readonly devices: WardDevices; readonly root?: string } = { devices: noWard },
) =>
  Effect.gen(function* () {
    const opening = yield* openLeasedDevice(
      devices,
      { threadId, deviceId: device.id, platform: device.platform },
      { workspaceRoot: ward.root },
      ward.devices,
    ).pipe(Effect.result, Effect.forkChild);
    yield* TestClock.adjust("1 second");
    return yield* Fiber.join(opening);
  });
const refusal = (result: {
  readonly _tag: string;
  readonly failure?: { readonly message: string };
}) => result._tag === "Failure" && result.failure?.message;

/** The state `DeviceService.list` returns once a ward's emulator has booted. */
const listed = { devices: [], sessions: [] } as unknown as DeviceServiceState;
const services = (shells: Record<string, FakeThread>) =>
  Layer.mergeAll(
    threads(shells),
    Layer.mock(DeviceService.DeviceService)({ list: Effect.succeed(listed) }),
    Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeedNone }),
  );

describe("device leases", () => {
  it.effect("refuses a device another live thread holds until that thread closes it", () =>
    Effect.gen(function* () {
      const devices = fakeDevices();
      expect((yield* open(devices, a))._tag).toBe("Success");
      const refused = yield* open(devices, b);
      expect(refusal(refused)).toBe(
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
        [a, b].map((threadId) =>
          openLeasedDevice(devices, { threadId, ...input }, undefined, noWard),
        ),
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
      expect(yield* deviceListExtras(yield* devices.state, b, undefined, noWard)).toEqual({
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
        (yield* deviceListExtras(yield* devices.state, b, undefined, noWard)).claims?.[0],
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
      expect(yield* deviceListExtras(yield* devices.state, child, undefined, noWard)).toEqual({});
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
      const pick = (threadId: ThreadId, input: { deviceId?: string }) =>
        Effect.flatMap(devices.state, (state) =>
          routeDeviceOpen(state, input, threadId, noWard),
        ).pipe(Effect.map((routed) => routed.state.devices));
      expect(yield* pick(b, {})).toEqual([agent2]);
      // A named device is the agent's choice; the lease decides at open.
      expect(yield* pick(b, { deviceId: agent1.id })).toEqual([phone, agent1, agent2]);
      expect((yield* open(devices, b, agent2))._tag).toBe("Success");
      // With every emulator held, the list is left alone and the open explains.
      expect(yield* pick(ThreadId.make("thread-c"), {})).toEqual([phone, agent1, agent2]);
    }).pipe(
      Effect.provide(
        services({ [a]: { running: true }, [b]: { running: true }, "thread-c": { running: true } }),
      ),
    ),
  );
});

describe("ward emulators", () => {
  const own = emulator("emulator-5580", "ward app.t3-1");
  const theirs = emulator("emulator-5582", "ward app.t3-2");
  const list: WardDeviceList = {
    devices: [
      {
        serial: own.id,
        ward: "app.t3-1",
        worktree: "/w/app/t3-1",
        startedAt: "1970-01-01T00:00:10.000Z",
      },
      {
        serial: theirs.id,
        ward: "app.t3-2",
        worktree: "/w/app/t3-2",
        startedAt: "1970-01-01T00:00:00.000Z",
      },
      {
        serial: "emulator-5584",
        ward: null,
        worktree: null,
        startedAt: "1970-01-01T00:00:00.000Z",
      },
    ],
  };
  const ward = (boot: WardDevices["boot"] = () => Effect.succeedNone): WardDevices => ({
    list: Effect.succeed(list),
    current: Effect.succeed(list),
    boot,
  });
  const inWard = { devices: ward(), root: "/w/app/t3-1" };
  const shells = {
    [a]: { running: true, worktree: "/w/app/t3-1" },
    [b]: { running: true, worktree: "/w/app/t3-1" },
    "thread-c": { running: true },
  };
  const c = ThreadId.make("thread-c");

  it.effect("belong to the threads in their ward's worktree, and to nobody else", () =>
    Effect.gen(function* () {
      const devices = fakeDevices([agent1, own, theirs]);
      // A session from before this emulator started was on an earlier one with the same serial.
      yield* devices
        .open({ threadId: c, deviceId: own.id, platform: "android" })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      yield* TestClock.adjust("10 seconds");
      expect((yield* open(devices, a, own, inWard))._tag).toBe("Success");
      // Two threads on one worktree share its ward, so they share its emulator.
      expect((yield* open(devices, b, own, inWard))._tag).toBe("Success");
      expect(devices.holders(own)).toEqual([a, b]);
      expect(refusal(yield* open(devices, a, theirs, inWard))).toBe(
        "emulator-5582 (ward app.t3-2) is ward app.t3-2's own emulator, for threads in that worktree only. Free: emulator-5554 (agent-1), emulator-5580 (ward app.t3-1).",
      );
      expect(refusal(yield* open(devices, c, own, { devices: ward() }))).toBe(
        "emulator-5580 (ward app.t3-1) is ward app.t3-1's own emulator, for threads in that worktree only. Free: emulator-5554 (agent-1).",
      );
      expect(
        refusal(yield* open(devices, a, emulator("emulator-5584", "ward-base"), inWard)),
      ).toContain("is Ward's base image being rebuilt");
      expect(yield* deviceListExtras(yield* devices.state, a, undefined, ward())).toEqual({
        claims: [{ hostId: "local", deviceId: theirs.id, ward: "app.t3-2", available: false }],
        hint: expect.stringContaining("without `deviceId`"),
      });
    }).pipe(Effect.provide(threads(shells))),
  );

  it.effect("are what device_open opens when the agent names no device", () =>
    Effect.gen(function* () {
      const devices = fakeDevices([agent1, own, theirs]);
      const state = yield* devices.state;
      const booted: Array<string> = [];
      const boots = ward((worktree) =>
        Effect.sync(() => {
          booted.push(worktree);
          return Option.some({ serial: own.id, startedAt: "1970-01-01T00:00:10.000Z" });
        }),
      );
      const routed = yield* routeDeviceOpen(state, { platform: "android" as const }, a, boots);
      expect(booted).toEqual(["/w/app/t3-1"]);
      expect(routed.input).toEqual({ platform: "android", hostId: "local", deviceId: own.id });
      expect(routed.state).toBe(listed);
      // A thread with no ward picks a shared emulator, never a ward's.
      expect((yield* routeDeviceOpen(state, {}, c, ward())).state.devices).toEqual([agent1]);
      const failed = yield* routeDeviceOpen(
        state,
        {},
        a,
        makeWardDevices((args) =>
          Effect.succeed(
            args[0] === "devices"
              ? { code: 0, stdout: JSON.stringify(list), stderr: "" }
              : { code: 1, stdout: "", stderr: "ward: 8 devices are running, the limit\n" },
          ),
        ),
      ).pipe(Effect.flip);
      expect(failed.message).toBe(
        "This thread's ward could not start its emulator: ward: 8 devices are running, the limit",
      );
    }).pipe(Effect.provide(services(shells))),
  );
});
