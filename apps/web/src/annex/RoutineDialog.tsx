import { useAtomValue } from "@effect/atom-react";
import { scheduleTimeZoneLabel } from "@t3tools/client-runtime/scheduled-task-time-zone";
import type {
  EnvironmentId,
  Familiar,
  ScheduledTaskUpsertInput,
  ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

export interface RoutineDraft {
  readonly title: string;
  readonly prompt: string;
  /** HH:MM in the server's zone. */
  readonly timeOfDay: string;
}

/** A daily scheduled task that continues the Familiar's channel conversation. */
export function routineUpsertInput(
  familiar: Pick<Familiar, "projectId" | "modelSelection" | "runtimeMode" | "interactionMode">,
  threadId: ThreadId,
  routine: RoutineDraft,
): ScheduledTaskUpsertInput {
  return {
    title: routine.title.trim(),
    prompt: routine.prompt.trim(),
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: routine.timeOfDay },
    projectId: familiar.projectId,
    threadId,
    threadMode: "continue",
    workspaceStrategy: { type: "root" },
    modelSelection: familiar.modelSelection,
    runtimeMode: familiar.runtimeMode,
    interactionMode: familiar.interactionMode,
  };
}

/** The server's zone label for fixed-time routines, such as "UTC". */
export function useServerTimeZoneLabel(environmentId: EnvironmentId): string | undefined {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  return scheduleTimeZoneLabel(query.data?.timeZone);
}

export function RoutineDialog({
  environmentId,
  familiar,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly familiar: Familiar;
  readonly onClose: () => void;
}) {
  const canSave = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, { label: "add routine" });
  const zone = useServerTimeZoneLabel(environmentId);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const ready =
    canSave &&
    familiar.threadId !== null &&
    title.trim() !== "" &&
    prompt.trim() !== "" &&
    /^\d{2}:\d{2}$/.test(timeOfDay) &&
    !saving;

  const submit = async () => {
    if (!ready || familiar.threadId === null) return;
    setSaving(true);
    const result = await upsert({
      environmentId,
      input: routineUpsertInput(familiar, familiar.threadId, { title, prompt, timeOfDay }),
    });
    setSaving(false);
    if (result._tag === "Success") onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a routine</DialogTitle>
            <DialogDescription>
              Every day, this prompt is posted to {familiar.name}'s channel. Routines count against
              its runs a day.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="routine-title">Title</Label>
                  <Input
                    id="routine-title"
                    autoFocus
                    placeholder="Morning check"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="routine-time">Every day at{zone ? ` (${zone})` : ""}</Label>
                  <div>
                    <Input
                      type="time"
                      id="routine-time"
                      nativeInput
                      className="w-32"
                      value={timeOfDay}
                      onChange={(event) => setTimeOfDay(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="routine-prompt">Prompt</Label>
                <Textarea
                  id="routine-prompt"
                  className="max-h-48 min-h-24 overflow-y-auto"
                  placeholder="What it should do each time."
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Change the schedule, pick weekdays, or delete it in Settings, Scheduled tasks.
              </p>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              Add routine
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
