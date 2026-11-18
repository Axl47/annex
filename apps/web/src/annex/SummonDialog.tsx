import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  FAMILIAR_DEFAULT_DAILY_RUN_BUDGET,
  type EnvironmentId,
  type FamiliarAutonomy,
  type FamiliarId,
  type FamiliarsSnapshot,
  type ModelSelection,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";

import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { scheduledTaskDefaultModel } from "../components/settings/scheduledTasksSettings.logic";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import { providerInstanceEntriesFor } from "../providerInstances";
import { useProjects } from "../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { routineUpsertInput, useServerTimeZoneLabel, type RoutineDraft } from "./RoutineDialog";
import { familiarAtoms } from "./state";

const ROLE_TEMPLATES = [
  {
    id: "sync",
    name: "Sync",
    role: "Keep this fork in step with its upstream. When a routine or the user asks, check upstream for new commits, lay a geas to bring them in, and explain any conflict in plain words. Never push to the upstream remote.",
    routine: {
      title: "Nightly sync",
      timeOfDay: "08:00",
      prompt:
        "Check upstream for new commits. If there are any, lay a geas to bring them in and report what changed once it's done; if not, say so in one line.",
    },
  },
  {
    id: "scout",
    name: "Scout",
    role: "Watch the upstream project for changes worth knowing about: releases, fixes, and features that touch what this project changed. Summarize what matters, and lay a geas for follow-up only when the user agrees.",
    routine: {
      title: "Daily upstream digest",
      timeOfDay: "09:00",
      prompt:
        "Check the upstream project for releases and notable changes since your last digest. Summarize what matters for this project in a few bullets, and note the newest one you covered in the Tome.",
    },
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "Review geasa when they reach In review. Read the report and the diff, comment on real problems with grimoire_comment, and tell the user which ones look ready.",
  },
  {
    id: "lead",
    name: "Lead",
    role: "Turn the user's goals into geasa. Break work into pieces a fresh agent can do alone, lay them, follow their progress, and keep the user posted on what needs them.",
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly routine?: RoutineDraft;
}>;

type TemplateId = (typeof ROLE_TEMPLATES)[number]["id"] | "blank";

const AUTONOMY_LABELS: Record<FamiliarAutonomy, string> = {
  start: "Enact and start",
  backlog: "Backlog only",
};

export function SummonDialog({
  environmentId,
  claudeInstance,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly claudeInstance: FamiliarsSnapshot["claudeInstance"];
  /** With the new Familiar and its channel after a summon, empty on cancel. */
  readonly onClose: (summoned?: { familiarId: FamiliarId; threadId?: ThreadId }) => void;
}) {
  const projects = useProjects()
    .filter(
      (project) =>
        project.environmentId === environmentId &&
        project.archivedAt == null &&
        project.isScratch !== true,
    )
    .sort((left, right) => Number(right.pinnedAt != null) - Number(left.pinnedAt != null));
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const summon = useAtomCommand(familiarAtoms.summon, { label: "summon Familiar" });
  const upsertRoutine = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "add routine",
  });
  const zone = useServerTimeZoneLabel(environmentId);

  const [template, setTemplate] = useState<TemplateId>("blank");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "");
  const [autonomy, setAutonomy] = useState<FamiliarAutonomy>("start");
  const [budget, setBudget] = useState(String(FAMILIAR_DEFAULT_DAILY_RUN_BUDGET));
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const [firstMessage, setFirstMessage] = useState("");
  const [addRoutine, setAddRoutine] = useState(true);
  const [routineTime, setRoutineTime] = useState("");
  const [saving, setSaving] = useState(false);
  const suggested = ROLE_TEMPLATES.find((candidate) => candidate.id === template);
  const suggestedRoutine =
    suggested !== undefined && "routine" in suggested ? suggested.routine : null;

  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0] ?? null;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, project?.id ?? null);
  const enabled = (instanceId: ProviderInstanceId) =>
    instanceEntries.some((entry) => entry.instanceId === instanceId && entry.enabled);
  const familiarsDefault =
    claudeInstance !== null && enabled(claudeInstance.instanceId)
      ? scheduledTaskDefaultModel(
          settings,
          project,
          instanceEntries.filter((entry) => entry.instanceId === claudeInstance.instanceId),
        )
      : null;
  const modelSelection =
    chosenModel !== null && enabled(chosenModel.instanceId)
      ? chosenModel
      : (familiarsDefault ?? scheduledTaskDefaultModel(settings, project, instanceEntries));
  const activeInstanceId =
    modelSelection?.instanceId ?? instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = modelSelection?.model ?? "";
  const dailyRunBudget = Number(budget);
  const budgetValid =
    Number.isInteger(dailyRunBudget) && dailyRunBudget >= 1 && dailyRunBudget <= 500;
  const ready =
    project !== null &&
    modelSelection !== null &&
    name.trim() !== "" &&
    name.trim().length <= 40 &&
    budgetValid &&
    !saving;

  const pickTemplate = (id: TemplateId) => {
    setTemplate(id);
    const chosen = ROLE_TEMPLATES.find((candidate) => candidate.id === id);
    if (chosen === undefined) return;
    setRole(chosen.role);
    setRoutineTime("");
    if (name.trim() === "" || ROLE_TEMPLATES.some((candidate) => candidate.name === name.trim())) {
      setName(chosen.name);
    }
  };

  const submit = async () => {
    if (!ready || project === null || modelSelection === null) return;
    setSaving(true);
    const result = await summon({
      environmentId,
      input: {
        name: name.trim(),
        rolePrompt: role.trim(),
        projectId: project.id,
        modelSelection,
        autonomy,
        dailyRunBudget,
        ...(firstMessage.trim() === "" ? {} : { firstMessage: firstMessage.trim() }),
      },
    });
    if (result._tag !== "Success") {
      setSaving(false);
      return;
    }
    const { familiarId, threadId } = result.value;
    if (suggestedRoutine !== null && addRoutine && threadId !== undefined) {
      await upsertRoutine({
        environmentId,
        input: routineUpsertInput(
          {
            projectId: project.id,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          },
          threadId,
          { ...suggestedRoutine, timeOfDay: routineTime || suggestedRoutine.timeOfDay },
        ),
      });
    }
    setSaving(false);
    onClose({ familiarId, ...(threadId === undefined ? {} : { threadId }) });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Summon a Familiar</DialogTitle>
            <DialogDescription>
              It gets a pinned channel you talk to, and a Tome it keeps across sessions. Real work
              goes through geasa it lays.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="familiar-template">Start from</Label>
                  <Select
                    value={template}
                    onValueChange={(value) => pickTemplate(value as TemplateId)}
                  >
                    <SelectTrigger size="sm" id="familiar-template">
                      <SelectValue>
                        {ROLE_TEMPLATES.find((candidate) => candidate.id === template)?.name ??
                          "Blank"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="blank">Blank</SelectItem>
                      {ROLE_TEMPLATES.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="familiar-name">Name</Label>
                  <Input
                    id="familiar-name"
                    autoFocus
                    maxLength={40}
                    placeholder="Sync"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="familiar-role">Role</Label>
                <Textarea
                  id="familiar-role"
                  className="max-h-48 min-h-24 overflow-y-auto"
                  placeholder="What it is for, and how it should work."
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="familiar-first-message">First message</Label>
                <Textarea
                  id="familiar-first-message"
                  className="max-h-36 min-h-16 overflow-y-auto"
                  placeholder="Optional. Sent to its channel right away, such as what to look at first."
                  value={firstMessage}
                  onChange={(event) => setFirstMessage(event.target.value)}
                />
              </div>
              {suggestedRoutine !== null ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Label>
                      <Checkbox
                        checked={addRoutine}
                        onCheckedChange={(checked) => setAddRoutine(checked === true)}
                      />
                      Add the routine "{suggestedRoutine.title}" every day at
                    </Label>
                    <Input
                      type="time"
                      aria-label="Routine time"
                      nativeInput
                      className="w-32"
                      disabled={!addRoutine}
                      value={routineTime || suggestedRoutine.timeOfDay}
                      onChange={(event) => setRoutineTime(event.target.value)}
                    />
                    {zone !== undefined ? (
                      <span className="text-muted-foreground">{zone}</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{suggestedRoutine.prompt}</p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="familiar-project">Project</Label>
                  <Select
                    value={project?.id ?? ""}
                    onValueChange={(value) => setProjectId(value as string)}
                  >
                    <SelectTrigger size="sm" id="familiar-project">
                      <SelectValue>{project?.title ?? "Choose a project"}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {projects.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Model</Label>
                  <div>
                    <ProviderModelPicker
                      environmentId={environmentId}
                      disabled={saving}
                      activeInstanceId={activeInstanceId}
                      model={activeModel}
                      lockedProvider={null}
                      instanceEntries={instanceEntries}
                      modelOptionsByInstance={getCustomModelOptionsByInstance(
                        settings,
                        providers,
                        activeInstanceId,
                        activeModel,
                      )}
                      isComposerOwned
                      onInstanceModelChange={(instanceId, model) =>
                        setChosenModel({ instanceId, model })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="familiar-autonomy">Autonomy</Label>
                  <Select
                    value={autonomy}
                    onValueChange={(value) => setAutonomy(value as FamiliarAutonomy)}
                  >
                    <SelectTrigger size="sm" id="familiar-autonomy">
                      <SelectValue>{AUTONOMY_LABELS[autonomy]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="start">{AUTONOMY_LABELS.start}</SelectItem>
                      <SelectItem value="backlog">{AUTONOMY_LABELS.backlog}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="familiar-budget">Runs a day</Label>
                  <Input
                    id="familiar-budget"
                    inputMode="numeric"
                    value={budget}
                    aria-invalid={!budgetValid}
                    onChange={(event) => setBudget(event.target.value.replaceAll(/[^\d]/g, ""))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs count turns you didn't type: routines and wakes. Once a day's runs are spent,
                its routines pause until tomorrow.
                {claudeInstance === null
                  ? " For long-lived channels, set up Claude · Familiars from the settings button first."
                  : ""}
              </p>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              Summon
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
