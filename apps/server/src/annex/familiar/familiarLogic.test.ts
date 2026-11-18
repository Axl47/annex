import { GeasId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  familiarTurnContext,
  holdWake,
  wakeMessage,
  type FamiliarChannel,
  type ProviderThreadSession,
} from "./familiarLogic.ts";

const channel: FamiliarChannel = {
  familiarId: "familiar-1",
  name: "Sync",
  rolePrompt: "Keep Annex on upstream.",
  autonomy: "start",
  tome: "Pushes go to origin only.",
  tomeRevision: 3,
};

const thread = (id: string, nativeId: string | null): ProviderThreadSession => ({
  id,
  nativeThreadRef: nativeId === null ? null : { nativeId },
});

describe("familiarTurnContext", () => {
  it.each([
    { case: "first turn", before: thread("p1", null), after: thread("p1", "n1") },
    { case: "fresh_session run", before: thread("p2", null), after: thread("p2", "n2") },
    { case: "resume fell back", before: thread("p1", "n1"), after: thread("p1", "n9") },
  ])("sends the whole preamble on a new session: $case", ({ before, after }) => {
    const text = familiarTurnContext({ channel, skip: false, before, after, delivered: new Map() });
    expect(text).toContain("✦ Sync");
    expect(text).toContain("Pushes go to origin only.");
    expect(text).toContain("Tome (revision 3)");
  });

  it("sends nothing on a resumed session, then one line once the Tome changes", () => {
    const delivered = new Map<string, number>();
    const resumed = { before: thread("p1", "n1"), after: thread("p1", "n1") };
    familiarTurnContext({ channel, skip: false, ...resumed, delivered });
    expect(familiarTurnContext({ channel, skip: false, ...resumed, delivered })).toBe("");
    const edited = { ...channel, tomeRevision: 4 };
    expect(familiarTurnContext({ channel: edited, skip: false, ...resumed, delivered })).toBe(
      "The Tome is now revision 4; re-read it with familiar_tome.",
    );
    expect(familiarTurnContext({ channel: edited, skip: false, ...resumed, delivered })).toBe("");
  });

  it("sends nothing on goal and compact turns, or outside a channel", () => {
    const fresh = { before: thread("p1", null), after: thread("p1", "n1"), delivered: new Map() };
    expect(familiarTurnContext({ channel, skip: true, ...fresh })).toBe("");
    expect(familiarTurnContext({ channel: undefined, skip: false, ...fresh })).toBe("");
  });
});

describe("wakes", () => {
  const wake = {
    geasId: GeasId.make("geas-1"),
    key: "SYNC-1",
    title: "Resolve the sidebar conflict",
    threadId: ThreadId.make("thread-1"),
    at: "2026-11-18T03:00:00.000Z",
  };

  it("keeps one held wake per geas, merging its events", () => {
    const held = holdWake(holdWake([], { ...wake, events: ["asked"] }), {
      ...wake,
      events: ["asked", "in_review"],
    });
    expect(held).toHaveLength(1);
    expect(held[0]!.events).toEqual(["asked", "in_review"]);
  });

  it("names the key, what happened, and links the geas thread", () => {
    expect(wakeMessage([{ ...wake, events: ["in_review", "run_failed"] }])).toBe(
      'Wake: SYNC-1 "Resolve the sidebar conflict": moved to In review; a run failed. [SYNC-1](t3-thread://v1/thread-1)',
    );
  });
});
