import {
  GEAS_COMMENT_MAX_LENGTH,
  type GeasActivity,
  type GeasCheck,
  type GeasCheckDeclaration,
  type GeasReport,
  type GeasRunState,
  type GeasStatus,
  type GrimoireProjectSettings,
} from "@t3tools/contracts";

/** "Annex" → "ANX", "Theoria Codex" → "TC", "my-app" → "MA". */
export function deriveKeyPrefix(projectName: string): string {
  const words = projectName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => /^[A-Za-z]/.test(word));
  if (words.length === 0) return "GEAS";
  if (words.length > 1) {
    return words
      .slice(0, 4)
      .map((word) => word[0]!.toUpperCase())
      .join("");
  }
  const word = words[0]!.toUpperCase();
  let prefix = word[0]!;
  for (const char of word.slice(1)) {
    if (prefix.length === 3) break;
    if (!/[AEIOU]/.test(char) && char !== prefix.at(-1)) prefix += char;
  }
  return prefix.length >= 2 ? prefix : word.slice(0, 3);
}

export interface ExecutedCommand {
  readonly command: string;
  readonly exitCode: number | null;
  readonly completedAt: string;
}

const REDIRECTS = /\d*>&\d+/g;
// `&&` keeps a failing exit code; a pipe, `||`, `;` or `&` can replace it with another's.
const masksExitCode = (command: string) =>
  /[|;&]/.test(command.replace(REDIRECTS, "").replaceAll("&&", ""));
// A command starts at the beginning, after `&&`, `;` or `(`, or inside a `sh -c '…'` wrapper.
const COMMAND_START = /(?:^|&&|;|\(|\s-l?c\s+['"]?)\s*$/;

/** The executed command ran the declared one as a command whose exit code is its own. */
function ranAsCommand(executed: string, declared: string): boolean {
  for (let at = executed.indexOf(declared); at !== -1; at = executed.indexOf(declared, at + 1)) {
    const after = executed.slice(at + declared.length);
    if (COMMAND_START.test(executed.slice(0, at)) && /^(?:\s|['"]|$)/.test(after)) {
      if (!masksExitCode(after)) return true;
    }
  }
  return false;
}

const startsWithCommand = (declared: string, listed: string) =>
  declared
    .replace(REDIRECTS, "")
    .split("&&")
    .map((segment) => segment.trim())
    .some((segment) => segment === listed || segment.startsWith(`${listed} `));

/**
 * The newest command that ran the declared one decides its status. When the project lists its
 * check commands, only declared commands built on one of them are vouched for.
 */
export function verifyChecks(
  declared: ReadonlyArray<GeasCheckDeclaration>,
  newestFirst: ReadonlyArray<ExecutedCommand>,
  projectChecks: ReadonlyArray<GeasCheckDeclaration>,
): ReadonlyArray<GeasCheck> {
  return declared.map((check) => {
    const command = check.command.trim();
    const vouchable =
      command !== "" &&
      !masksExitCode(command) &&
      (projectChecks.length === 0 ||
        projectChecks.some((listed) => startsWithCommand(command, listed.command.trim())));
    const executed = vouchable
      ? newestFirst.find((candidate) => ranAsCommand(candidate.command, command))
      : undefined;
    if (executed === undefined || executed.exitCode === null) {
      return { ...check, status: "unverified", exitCode: null, verifiedAt: null };
    }
    return {
      ...check,
      status: executed.exitCode === 0 ? "passed" : "failed",
      exitCode: executed.exitCode,
      verifiedAt: executed.completedAt,
    };
  });
}

const isAttention = (activity: GeasActivity) =>
  (activity.kind === "comment" &&
    activity.author === "agent" &&
    (activity.notify || activity.actions.length > 0)) ||
  activity.eventType === "no_handoff" ||
  activity.eventType === "run_failed" ||
  activity.eventType === "loop_guard";

const clearsAttention = (activity: GeasActivity) =>
  (activity.kind === "comment" && activity.author === "user") ||
  activity.eventType === "run_started";

/** Oldest-first activity. A geas needs you until you answer what last asked for you. */
export function needsYou(input: {
  readonly status: GeasStatus;
  readonly runState: GeasRunState;
  readonly activity: ReadonlyArray<GeasActivity>;
}): boolean {
  if (input.runState === "waiting") return true;
  if (input.status === "done" || input.status === "canceled") return false;
  for (let index = input.activity.length - 1; index >= 0; index--) {
    const activity = input.activity[index]!;
    if (clearsAttention(activity)) return false;
    if (isAttention(activity)) return true;
  }
  return false;
}

const GEAS_RULES = [
  "The report is the deliverable. Anything needed to judge the work goes in the report, never only in a comment.",
  "Lead with the result in one line, then the proof. A visible change shows before and after at the same size, as a compare block of screenshots stored with geas_attach_media; anything else shows the output or number that proves it.",
  "Declare each check with the exact command you ran. The server records its status from that command's real exit code, so run it without pipes, `;` or `|| true` after it.",
  "Risks and gaps go in risks, never only in details. Never report unfinished work as done.",
  `Comments are chat: at most ${GEAS_COMMENT_MAX_LENGTH} characters, the outcome in one line, then the question or action. Never point at the report.`,
  "To finish: complete the report, post one comment with notify or suggested actions, then set the status to in_review. Waiting on someone: set todo. After delivering what the user approved, set done.",
  'Suggested actions say exactly what happens ("Run checks, open PR and merge", never "OK"). Mark one primary.',
  'A new message can change the task. "Stop" means start nothing new, comment where you left off, set the status, end.',
  "Before in_review, read the report alone as the reviewer would. If it needs the comments to make sense, rewrite it.",
] as const;

const STATUS_LABELS: Record<GeasStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

export const geasStatusLabel = (status: GeasStatus) => STATUS_LABELS[status];

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function renderReportSummary(report: GeasReport): string {
  const lines: Array<string> = [];
  if (report.result.trim() !== "") lines.push(`Result: ${report.result.trim()}`);
  if (report.risks.length > 0) {
    lines.push("Risks:", ...report.risks.map((risk) => `- ${risk}`));
  }
  if (report.proof.length > 0) {
    lines.push("Proof:");
    for (const block of report.proof) {
      switch (block.type) {
        case "compare":
          lines.push(`- compare: ${block.before.alt} → ${block.after.alt}`);
          break;
        case "media":
          lines.push(`- media: ${block.items.map((item) => item.alt).join(", ")}`);
          break;
        case "table":
          lines.push(`- table: ${block.columns.join(" | ")} (${block.rows.length} rows)`);
          break;
        case "markdown":
          lines.push(`- markdown: ${truncate(block.markdown.replace(/\s+/g, " "), 200)}`);
          break;
      }
    }
  }
  if (report.checks.length > 0) {
    lines.push(
      "Checks:",
      ...report.checks.map((check) => `- ${check.label} \`${check.command}\`: ${check.status}`),
    );
  }
  if (report.details.trim() !== "") lines.push(`Details: ${truncate(report.details.trim(), 1500)}`);
  return lines.length === 0 ? "Empty." : lines.join("\n");
}

const EARLIER_COMMENT_LIMIT = 20;

export interface RunMessageInput {
  readonly key: string;
  readonly title: string;
  readonly status: GeasStatus;
  readonly request: string;
  readonly report: GeasReport;
  readonly reportRevision: number;
  readonly settings: GrimoireProjectSettings;
  /** Oldest first. */
  readonly activity: ReadonlyArray<GeasActivity>;
  readonly previousFinalResponse: string | null;
}

/** The whole contract a run gets, rendered fresh from the geas so any provider can take it. */
export function renderRunMessage(input: RunMessageInput): string {
  const sections: Array<string> = [
    `# Geas ${input.key}: ${input.title}`,
    `You are working on a geas: one piece of work whose deliverable is a report the user reviews instead of reading this conversation. Status: ${geasStatusLabel(input.status)}.`,
    `## What was asked\n${input.request}`,
  ];
  // Order, not timestamps: two writes can share a millisecond.
  const previousRunStart = input.activity.findLastIndex(
    (activity) => activity.eventType === "run_started",
  );
  if (previousRunStart !== -1) {
    const fresh = input.activity
      .slice(previousRunStart + 1)
      .filter((activity) =>
        activity.kind === "comment"
          ? activity.author === "user"
          : activity.author !== "agent" && activity.eventType === "status_changed",
      );
    // Each run starts a fresh session, so earlier answers and questions only reach it here.
    const earlier = input.activity
      .filter((activity) => activity.kind === "comment" && !fresh.includes(activity))
      .slice(-EARLIER_COMMENT_LIMIT);
    if (earlier.length > 0) {
      sections.push(
        `## Conversation so far\n${earlier
          .map(
            (activity) =>
              `- ${activity.author === "user" ? "User" : "Agent"} (${activity.createdAt}): ${truncate(activity.body, 600)}`,
          )
          .join("\n")}`,
      );
    }
    if (fresh.length > 0) {
      sections.push(
        `## New since your last run\n${fresh
          .map((activity) =>
            activity.kind === "comment" ? `- User: ${activity.body}` : `- ${activity.body}`,
          )
          .join("\n")}`,
      );
    }
    if (input.previousFinalResponse !== null && input.previousFinalResponse.trim() !== "") {
      sections.push(`## Your last response\n${truncate(input.previousFinalResponse.trim(), 4000)}`);
    }
  }
  sections.push(
    `## The report now (revision ${input.reportRevision})\n${renderReportSummary(input.report)}`,
  );
  if (input.settings.checks.length > 0) {
    sections.push(
      `## Checks this project vouches for\n${input.settings.checks
        .map((check) => `- ${check.label}: \`${check.command}\``)
        .join("\n")}`,
    );
  }
  const rules = GEAS_RULES.map((rule, index) => `${index + 1}. ${rule}`).join("\n");
  const projectRules = input.settings.rules.trim();
  sections.push(
    `## Geas rules\n${rules}${projectRules === "" ? "" : `\n\nThis project adds:\n${projectRules}`}`,
  );
  sections.push(
    `## Geas tools\ngeas_get, geas_report_write (pass expectedRevision ${input.reportRevision}), geas_set_status, geas_comment and geas_attach_media act on this geas. They are tools of the T3 Code MCP server; load them first if your client defers MCP tools.`,
  );
  return sections.join("\n\n");
}
