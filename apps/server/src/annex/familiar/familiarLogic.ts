import type {
  FamiliarAutonomy,
  FamiliarHeldWake,
  FamiliarWakeEvent,
  ThreadId,
} from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";

export interface FamiliarChannel {
  readonly familiarId: string;
  readonly name: string;
  readonly rolePrompt: string;
  readonly autonomy: FamiliarAutonomy;
  readonly tome: string;
  readonly tomeRevision: number;
}

/** The provider-thread fields that tell a new native session from a resumed one. */
export interface ProviderThreadSession {
  readonly id: string;
  readonly nativeThreadRef: { readonly nativeId: string | null } | null;
}

const AUTONOMY_RULES: Record<FamiliarAutonomy, string> = {
  backlog:
    "Autonomy: Backlog only. Lay geasa in the backlog with geas_enact; never start their runs. The user starts them.",
  start: "Autonomy: Enact and start. You may lay geasa and start their runs with geas_enact.",
};

function familiarPreamble(channel: FamiliarChannel): string {
  const tome = channel.tome.trim() === "" ? "(empty)" : channel.tome.trim();
  return [
    `<familiar name="${channel.name}">`,
    `You are ✦ ${channel.name}, a Familiar: a standing agent the user talks to in this one channel, which lasts across sessions.`,
    "",
    "## Role",
    channel.rolePrompt.trim() === "" ? "(none given)" : channel.rolePrompt.trim(),
    "",
    `## Tome (revision ${channel.tomeRevision})`,
    tome,
    "",
    "## How you work",
    "- Talking here is planning. Do real work through geasa: lay one with geas_enact, then follow it with grimoire_list, grimoire_read and grimoire_comment.",
    `- ${AUTONOMY_RULES[channel.autonomy]}`,
    "- Delivery is the user's: never land, merge or press a geas's delivery buttons, and never answer a geas's question for the user.",
    "- Keep durable facts the user states, decisions and standing preferences in the Tome with familiar_tome. After a routine, append one line on what changed. Never store secrets there.",
    "- After a compaction, or when told the Tome changed, re-read it with familiar_tome.",
    '- Messages that start with "Wake:" come from Annex about geasa you laid.',
    "</familiar>",
  ].join("\n");
}

/**
 * What a channel's turn adds to its inline context: the whole preamble on a new provider session
 * (no native thread before the turn, or a different one after loading), one line when the Tome
 * changed during a live session, otherwise nothing. `delivered` remembers revisions per session.
 */
export function familiarTurnContext(input: {
  readonly channel: FamiliarChannel | undefined;
  readonly skip: boolean;
  readonly before: ProviderThreadSession;
  readonly after: ProviderThreadSession;
  readonly delivered: Map<string, number>;
}): string {
  const { channel, before, after, delivered } = input;
  if (channel === undefined || input.skip) return "";
  const previous = before.nativeThreadRef?.nativeId ?? null;
  const newSession = previous === null || after.nativeThreadRef?.nativeId !== previous;
  const session = after.nativeThreadRef?.nativeId ?? after.id;
  const seen = delivered.get(session);
  delivered.set(session, channel.tomeRevision);
  if (newSession) return familiarPreamble(channel);
  // A session resumed after a server restart already holds the preamble it started with.
  if (seen === undefined || seen >= channel.tomeRevision) return "";
  return `The Tome is now revision ${channel.tomeRevision}; re-read it with familiar_tome.`;
}

const localDay = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The server-local calendar day the budget counts in, as YYYY-MM-DD. */
export function budgetDay(epochMillis: number): string {
  return localDay.format(epochMillis);
}

const WAKE_PHRASES: Record<FamiliarWakeEvent, string> = {
  asked: "asks for input",
  in_review: "moved to In review",
  run_failed: "a run failed",
  loop_guard: "the loop guard stopped it",
  done: "was landed",
  canceled: "was canceled",
  archived: "was archived",
};

/** Merges events in arrival order, keeping each once. */
export function mergeWakeEvents(
  current: ReadonlyArray<FamiliarWakeEvent>,
  added: ReadonlyArray<FamiliarWakeEvent>,
): ReadonlyArray<FamiliarWakeEvent> {
  return [...new Set([...current, ...added])];
}

function wakeLine(wake: Pick<FamiliarHeldWake, "key" | "title" | "threadId" | "events">) {
  const what = wake.events.map((event) => WAKE_PHRASES[event]).join("; ");
  const link =
    wake.threadId === null
      ? ""
      : ` ${formatThreadLink({ environmentId: null, threadId: wake.threadId as ThreadId }, wake.key)}`;
  return `${wake.key} "${wake.title}": ${what}.${link}`;
}

export function wakeMessage(wakes: ReadonlyArray<FamiliarHeldWake>): string {
  if (wakes.length === 1) return `Wake: ${wakeLine(wakes[0]!)}`;
  return ["Wake:", ...wakes.map((wake) => `- ${wakeLine(wake)}`)].join("\n");
}

/** Keeps one held wake per geas, merging the events of repeats. */
export function holdWake(
  held: ReadonlyArray<FamiliarHeldWake>,
  wake: FamiliarHeldWake,
): ReadonlyArray<FamiliarHeldWake> {
  const existing = held.find((entry) => entry.geasId === wake.geasId);
  if (existing === undefined) return [...held, wake];
  return held.map((entry) =>
    entry.geasId === wake.geasId
      ? { ...wake, events: mergeWakeEvents(entry.events, wake.events) }
      : entry,
  );
}

export function tomeByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
