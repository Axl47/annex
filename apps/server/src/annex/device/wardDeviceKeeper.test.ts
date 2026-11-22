import { ThreadId, type DeviceCloseInput, type DeviceServiceState } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import type { WardDeviceList } from "./wardDevice.ts";
import { keepWardDevices, makeWardKeeperMemory } from "./wardDeviceKeeper.ts";

const threadId = ThreadId.make("thread-a");
const session = (deviceId: string) => ({
  threadId,
  hostId: "local",
  deviceId,
  platform: "android" as const,
  openedAt: "1970-01-01T00:00:10.000Z",
});
const wardDevice = (startedAt: string) => ({
  serial: "emulator-5580",
  ward: "app.t3-1",
  worktree: "/w/app/t3-1",
  startedAt,
});

/** A thread that stays idle: it counts as using its device for 30 minutes after opening it. */
const idleThread = Layer.mock(ThreadManagementService.ThreadManagementService)({
  getThreadShell: () =>
    Effect.succeed({
      activeRunId: null,
      activityRunStatus: null,
      status: "idle",
      pendingRuntimeRequest: null,
      pendingBackgroundTasks: [],
      latestRunCompletedAt: null,
      settledOverride: null,
      archivedAt: null,
      deletedAt: null,
    } as never),
});

const harness = () => {
  let sessions = [session("emulator-5580"), session("emulator-5554")];
  let closeFails = false;
  let list: WardDeviceList | null = { devices: [wardDevice("1970-01-01T00:00:05.000Z")] };
  const kept: Array<string> = [];
  const memory = makeWardKeeperMemory();
  const pass = keepWardDevices(
    {
      state: Effect.sync(() => ({ sessions }) as unknown as DeviceServiceState),
      close: (input: DeviceCloseInput) =>
        Effect.suspend(() => {
          if (closeFails) return Effect.die("the device host is away");
          sessions = sessions.filter((open) => open.deviceId !== input.deviceId);
          return Effect.void;
        }),
    },
    memory,
    {
      list: Effect.sync(() => list),
      current: Effect.sync(() => list),
      boot: (worktree) => Effect.sync(() => (kept.push(worktree), Option.none())),
    },
  ).pipe(Effect.provide(idleThread));
  return {
    pass,
    kept,
    open: () => sessions.map((open) => open.deviceId),
    wardHas: (next: WardDeviceList | null) => void (list = next),
    closeFails: (fails: boolean) => void (closeFails = fails),
  };
};

describe("ward device keeper", () => {
  it.effect("keeps an open ward emulator alive every five minutes", () =>
    Effect.gen(function* () {
      const keeper = harness();
      yield* keeper.pass;
      yield* TestClock.adjust("4 minutes");
      yield* keeper.pass;
      expect(keeper.kept).toEqual(["/w/app/t3-1"]);
      yield* TestClock.adjust("1 minute");
      yield* keeper.pass;
      expect(keeper.kept).toEqual(["/w/app/t3-1", "/w/app/t3-1"]);
      // A thread idle for 30 minutes no longer counts, so Ward may stop its emulator.
      yield* TestClock.adjust("30 minutes");
      yield* keeper.pass;
      expect(keeper.kept).toHaveLength(2);
      expect(keeper.open()).toEqual(["emulator-5580", "emulator-5554"]);
    }),
  );

  it.effect.each([
    { case: "stopped", list: { devices: [] } },
    {
      case: "was replaced on the same serial",
      list: { devices: [wardDevice("1970-01-01T00:00:20.000Z")] },
    },
  ])("closes the session when its ward emulator $case", ({ list }) =>
    Effect.gen(function* () {
      const keeper = harness();
      yield* keeper.pass;
      // Ward not answering says nothing about the emulator.
      keeper.wardHas(null);
      yield* keeper.pass;
      expect(keeper.open()).toEqual(["emulator-5580", "emulator-5554"]);
      keeper.wardHas(list);
      keeper.closeFails(true);
      yield* keeper.pass;
      expect(keeper.open()).toEqual(["emulator-5580", "emulator-5554"]);
      // A close that failed is tried again.
      keeper.closeFails(false);
      yield* keeper.pass;
      expect(keeper.open()).toEqual(["emulator-5554"]);
      expect(keeper.kept).toEqual(["/w/app/t3-1"]);
    }),
  );
});
