import type { GeasRunState, GeasStatus } from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  CircleIcon,
  CircleXIcon,
  EyeIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../lib/utils";
import { GEAS_STATUS_LABELS } from "./state";

const STATUS_ICONS: Record<GeasStatus, LucideIcon> = {
  backlog: CircleDashedIcon,
  todo: CircleIcon,
  in_progress: CircleDotDashedIcon,
  in_review: EyeIcon,
  done: CircleCheckIcon,
  canceled: CircleXIcon,
};

const STATUS_COLORS: Record<GeasStatus, string> = {
  backlog: "text-muted-foreground",
  todo: "text-muted-foreground",
  in_progress: "text-warning",
  in_review: "text-info",
  done: "text-success",
  canceled: "text-muted-foreground/70",
};

export function GeasStatusIcon({
  status,
  className,
}: {
  readonly status: GeasStatus;
  readonly className?: string;
}) {
  const Icon = STATUS_ICONS[status];
  return (
    <Icon
      aria-label={GEAS_STATUS_LABELS[status]}
      className={cn("size-4 shrink-0", STATUS_COLORS[status], className)}
    />
  );
}

/** A static dot: running geasa can sit for hours, so nothing here animates. */
export function GeasRunDot({
  runState,
  needsYou,
}: {
  readonly runState: GeasRunState;
  readonly needsYou: boolean;
}) {
  if (needsYou) {
    return <span aria-label="Needs you" className="size-2 shrink-0 rounded-full bg-warning" />;
  }
  if (runState === "idle") return null;
  return (
    <span
      aria-label={runState === "waiting" ? "Waiting on you" : "Running"}
      className={cn(
        "size-2 shrink-0 rounded-full",
        runState === "waiting" ? "bg-warning" : "bg-info",
      )}
    />
  );
}
