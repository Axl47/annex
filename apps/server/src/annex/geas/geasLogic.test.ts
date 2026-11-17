import {
  DEFAULT_GEAS_DELIVERY_ACTIONS,
  EMPTY_GEAS_REPORT,
  ProjectId,
  type GeasActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { deriveKeyPrefix, needsYou, renderRunMessage, verifyChecks } from "./geasLogic.ts";

let nextActivity = 0;
const activity = (overrides: Partial<GeasActivity>): GeasActivity => ({
  id: `activity-${nextActivity++}`,
  kind: "event",
  eventType: null,
  author: "server",
  body: "",
  notify: false,
  actions: [],
  runId: null,
  createdAt: "2026-11-17T10:00:00.000Z",
  ...overrides,
});

describe("deriveKeyPrefix", () => {
  it("derives a short uppercase prefix from the project name", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["Annex", "ANX"],
      ["Theoria Codex", "TC"],
      ["my-app", "MA"],
      ["camelCaseThing", "CCT"],
      ["Io", "IO"],
      ["123", "GEAS"],
    ];
    for (const [name, prefix] of cases) expect(deriveKeyPrefix(name), name).toBe(prefix);
  });
});

describe("verifyChecks", () => {
  const declared = [{ label: "Tests", command: "vp test run src/a.test.ts" }];

  it("takes the newest matching command's exit code", () => {
    const [check] = verifyChecks(
      declared,
      [
        { command: "cd apps/server && vp test run src/a.test.ts", exitCode: 0, completedAt: "t2" },
        { command: "vp test run src/a.test.ts", exitCode: 1, completedAt: "t1" },
      ],
      [],
    );
    expect(check).toMatchObject({ status: "passed", exitCode: 0, verifiedAt: "t2" });
  });

  it("fails on a non-zero exit and stays unverified when never run or still running", () => {
    expect(
      verifyChecks(
        declared,
        [{ command: declared[0]!.command, exitCode: 2, completedAt: "t" }],
        [],
      )[0]?.status,
    ).toBe("failed");
    expect(verifyChecks(declared, [], [])[0]?.status).toBe("unverified");
    expect(
      verifyChecks(
        declared,
        [{ command: declared[0]!.command, exitCode: null, completedAt: "t" }],
        [],
      )[0]?.status,
    ).toBe("unverified");
  });

  it("vouches only for the project's listed checks when it lists any", () => {
    const ran = [
      { command: "vp test run src/a.test.ts", exitCode: 0, completedAt: "t" },
      { command: "true", exitCode: 0, completedAt: "t" },
    ];
    const listed = [{ label: "Tests", command: "vp test run" }];
    const checks = verifyChecks([...declared, { label: "Trust me", command: "true" }], ran, listed);
    expect(checks.map((check) => check.status)).toEqual(["passed", "unverified"]);
  });

  it("only counts a run whose exit code is the declared command's own", () => {
    const check = { label: "Check", command: "scripts/check.sh" };
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["scripts/check.sh", "scripts/check.sh --record", "passed"],
      ["scripts/check.sh", "/bin/zsh -lc 'scripts/check.sh'", "passed"],
      ["scripts/check.sh", "scripts/check.sh 2>&1 && echo ok", "passed"],
      ["scripts/check.sh", "scripts/check.sh || true", "unverified"],
      ["scripts/check.sh", "scripts/check.sh 2>&1 | tail -20", "unverified"],
      ["scripts/check.sh", "scripts/check.sh; echo done", "unverified"],
      ["scripts/check.sh", "echo scripts/check.sh", "unverified"],
      ["scripts/check.sh", 'grep -c "scripts/check.sh" README.md', "unverified"],
      ["scripts/check.sh || true", "scripts/check.sh || true", "unverified"],
    ];
    for (const [declaredCommand, executed, status] of cases) {
      const [result] = verifyChecks(
        [{ ...check, command: declaredCommand }],
        [{ command: executed, exitCode: 0, completedAt: "t" }],
        [check],
      );
      expect(result?.status, `${declaredCommand} / ${executed}`).toBe(status);
    }
  });
});

describe("needsYou", () => {
  const base = { status: "in_progress" as const, runState: "idle" as const };

  it("asks for you after an agent notification until you answer or a run starts", () => {
    const asked = activity({ kind: "comment", author: "agent", notify: true });
    expect(needsYou({ ...base, activity: [asked] })).toBe(true);
    expect(
      needsYou({ ...base, activity: [asked, activity({ kind: "comment", author: "user" })] }),
    ).toBe(false);
    expect(needsYou({ ...base, activity: [asked, activity({ eventType: "run_started" })] })).toBe(
      false,
    );
  });

  it("asks for you after a failed run, no handoff, or the loop guard", () => {
    for (const eventType of ["run_failed", "no_handoff", "loop_guard"] as const) {
      expect(needsYou({ ...base, activity: [activity({ eventType })] })).toBe(true);
    }
    expect(needsYou({ ...base, activity: [activity({ kind: "comment", author: "agent" })] })).toBe(
      false,
    );
  });

  it("always asks while a run waits on you, and never once done", () => {
    expect(needsYou({ status: "done", runState: "waiting", activity: [] })).toBe(true);
    expect(
      needsYou({
        status: "done",
        runState: "idle",
        activity: [activity({ eventType: "run_failed" })],
      }),
    ).toBe(false);
  });
});

describe("renderRunMessage", () => {
  it("shows a later run what changed since the previous one, after the conversation so far", () => {
    const message = renderRunMessage({
      key: "ANX-1",
      title: "Fix it",
      status: "in_progress",
      request: "Fix the thing.",
      report: EMPTY_GEAS_REPORT,
      reportRevision: 3,
      settings: {
        projectId: ProjectId.make("project"),
        keyPrefix: "ANX",
        deliveryActions: DEFAULT_GEAS_DELIVERY_ACTIONS,
        checks: [],
        rules: "Use pnpm.",
      },
      activity: [
        activity({ kind: "comment", author: "user", body: "old note" }),
        activity({ eventType: "run_started" }),
        activity({ kind: "comment", author: "user", body: "new note" }),
        activity({ kind: "comment", author: "agent", body: "agent note" }),
        activity({ eventType: "status_changed", body: "Annex moved it to Done." }),
      ],
      previousFinalResponse: "Did half.",
    });
    expect(message).toContain(
      "## Conversation so far\n- User (2026-11-17T10:00:00.000Z): old note\n- Agent (2026-11-17T10:00:00.000Z): agent note",
    );
    expect(message).toContain(
      "## New since your last run\n- User: new note\n- Annex moved it to Done.",
    );
    expect(message).toContain("## Your last response\nDid half.");
    expect(message).toContain("expectedRevision 3");
    expect(message).toContain("This project adds:\nUse pnpm.");
  });
});
