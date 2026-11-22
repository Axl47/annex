import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import { makeWardDevices, withWardDevices, type WardRun } from "./wardDevice.ts";

const devices = {
  devices: [
    {
      serial: "emulator-5580",
      ward: "app.t3-1",
      worktree: "/w/app/t3-1",
      state: "ready",
      startedAt: "2026-11-22T15:04:05.123Z",
    },
    {
      serial: "emulator-5584",
      ward: null,
      worktree: null,
      state: "building",
      startedAt: "2026-11-22T15:00:00.000Z",
    },
  ],
};
const ok = (value: unknown): WardRun => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

/** A `ward` that answers each subcommand from a table and records its calls. */
const fakeWard = (answers: Record<string, WardRun>) => {
  const calls: Array<string> = [];
  const ward = makeWardDevices((args) =>
    Effect.sync(() => {
      calls.push(args.join(" "));
      return answers[args[0]!] ?? { code: 2, stdout: "", stderr: "usage: ward <command>" };
    }),
  );
  return { ward, calls };
};

describe("ward devices", () => {
  it.effect("lists Ward's emulators, and nothing when Ward is off or has no devices command", () =>
    Effect.gen(function* () {
      const { ward, calls } = fakeWard({ devices: ok({ avds: ["ward-base-1"], ...devices }) });
      expect((yield* ward.list)?.devices.map((device) => device.serial)).toEqual([
        "emulator-5580",
        "emulator-5584",
      ]);
      yield* ward.list;
      expect(calls).toEqual(["devices --json"]);
      yield* TestClock.adjust("2 seconds");
      yield* ward.list;
      expect(calls).toHaveLength(2);
      // A device open asks Ward again rather than trusting the cached listing.
      yield* ward.current;
      expect(calls).toHaveLength(3);

      const old = fakeWard({});
      expect(yield* old.ward.list).toBeNull();
      // Its usage error must not read as a failed boot: the thread falls back to shared devices.
      expect(yield* old.ward.boot("/w/app/t3-1")).toEqual(Option.none());
      expect(old.calls).toEqual(["devices --json"]);
      expect(yield* makeWardDevices(null).list).toBeNull();
    }),
  );

  it.effect("boots a worktree's emulator, and tells no ward apart from a failed boot", () =>
    Effect.gen(function* () {
      const device = {
        serial: "emulator-5580",
        state: "ready",
        startedAt: "2026-11-22T15:04:05.123Z",
      };
      const booting = fakeWard({ devices: ok(devices), device: ok(device) });
      expect(yield* booting.ward.boot("/w/app/t3-1")).toEqual(
        Option.some({ serial: device.serial, startedAt: device.startedAt }),
      );
      expect(booting.calls.at(-1)).toBe("device --worktree /w/app/t3-1 --json");

      const unwarded = fakeWard({
        devices: ok(devices),
        device: { code: 3, stdout: "", stderr: "" },
      });
      expect(yield* unwarded.ward.boot("/w/other")).toEqual(Option.none());

      const full = fakeWard({
        devices: ok(devices),
        device: { code: 1, stdout: "", stderr: "starting…\nward: at capacity (8 devices)\n" },
      });
      expect((yield* Effect.flip(full.ward.boot("/w/app/t3-1"))).message).toBe(
        "This thread's ward could not start its emulator: ward: at capacity (8 devices)",
      );
    }),
  );

  it.effect("names each emulator after its ward and hides the one Ward is rebuilding", () =>
    Effect.gen(function* () {
      const { ward } = fakeWard({ devices: ok(devices) });
      const listing = {
        detail: "kept",
        devices: [
          { id: "emulator-5554", name: "agent-1" },
          { id: "emulator-5580", name: "ward-base-1" },
          { id: "emulator-5584", name: "ward-base-1" },
        ],
      };
      expect(yield* withWardDevices(Effect.succeed(listing), ward)).toEqual({
        detail: "kept",
        devices: [
          { id: "emulator-5554", name: "agent-1" },
          { id: "emulator-5580", name: "ward app.t3-1" },
        ],
      });
      expect(yield* withWardDevices(Effect.succeed(listing), makeWardDevices(null))).toBe(listing);
    }),
  );
});
