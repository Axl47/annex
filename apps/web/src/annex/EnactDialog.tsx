import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  GeasId,
  ModelSelection,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { scheduledTaskDefaultModel } from "../components/settings/scheduledTasksSettings.logic";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../components/settings/settingsLayout";
import { WorktreeBaseBranchPicker } from "../components/WorktreeBaseBranchPicker";
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
import { grimoireAtoms } from "./state";

type WorkspaceMode = "worktree" | "root";

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function EnactDialog({
  environmentId,
  initialProjectId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly initialProjectId?: ProjectId;
  readonly onClose: (geasId?: GeasId) => void;
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
  const enact = useAtomCommand(grimoireAtoms.enact, { label: "enact geas" });

  const [projectId, setProjectId] = useState<string>(initialProjectId ?? projects[0]?.id ?? "");
  const [request, setRequest] = useState("");
  const [title, setTitle] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("worktree");
  const [baseRef, setBaseRef] = useState("");
  const [startFromOrigin, setStartFromOrigin] = useState(false);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const [saving, setSaving] = useState(false);

  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0] ?? null;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, project?.id ?? null);
  const modelSelection =
    chosenModel !== null &&
    instanceEntries.some((entry) => entry.instanceId === chosenModel.instanceId && entry.enabled)
      ? chosenModel
      : scheduledTaskDefaultModel(settings, project, instanceEntries);
  const activeInstanceId =
    modelSelection?.instanceId ?? instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = modelSelection?.model ?? "";

  const submit = async (backlog: boolean) => {
    if (project === null || modelSelection === null || request.trim() === "" || saving) return;
    const workspace: OrchestrationV2ThreadLaunchWorkspaceStrategy =
      workspaceMode === "root"
        ? { type: "root" }
        : { type: "worktree", baseRef: baseRef.trim() || "HEAD", startFromOrigin };
    setSaving(true);
    const result = await enact({
      environmentId,
      input: {
        projectId: project.id,
        request: request.trim(),
        ...(title.trim() === "" ? {} : { title: title.trim() }),
        workspace,
        modelSelection,
        backlog,
      },
    });
    setSaving(false);
    if (result._tag === "Success") onClose(result.value.geasId);
  };

  const ready = project !== null && modelSelection !== null && request.trim() !== "" && !saving;

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
            void submit(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Enact a geas</DialogTitle>
            <DialogDescription>
              An agent works on it in its own thread and hands back a report for you to review.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <Field label="What should be done?" htmlFor="geas-request">
                <Textarea
                  id="geas-request"
                  autoFocus
                  className="max-h-72 min-h-28 overflow-y-auto"
                  placeholder="Describe the work, what done looks like, and anything the agent should know."
                  value={request}
                  onChange={(event) => setRequest(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void submit(false);
                    }
                  }}
                />
              </Field>
              <Field label="Title" htmlFor="geas-title">
                <Input
                  id="geas-title"
                  placeholder="Defaults to the first line"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project" htmlFor="geas-project">
                  <Select
                    value={project?.id ?? ""}
                    onValueChange={(value) => setProjectId(value as string)}
                  >
                    <SelectTrigger size="sm" id="geas-project">
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
                </Field>
                <Field label="Workspace" htmlFor="geas-workspace">
                  <Select
                    value={workspaceMode}
                    onValueChange={(value) => setWorkspaceMode(value as WorkspaceMode)}
                  >
                    <SelectTrigger size="sm" id="geas-workspace">
                      <SelectValue>
                        {workspaceMode === "worktree"
                          ? "Create a new worktree"
                          : "Use the project checkout"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="worktree">Create a new worktree</SelectItem>
                      <SelectItem value="root">Use the project checkout</SelectItem>
                    </SelectPopup>
                  </Select>
                </Field>
              </div>
              {workspaceMode === "worktree" ? (
                <Field label="Base branch" htmlFor="geas-base-ref">
                  <WorktreeBaseBranchPicker
                    key={`${environmentId}:${project?.id ?? ""}`}
                    id="geas-base-ref"
                    environmentId={environmentId}
                    cwd={project?.workspaceRoot ?? null}
                    value={baseRef}
                    onValueChange={setBaseRef}
                    startFromOrigin={startFromOrigin}
                    onStartFromOriginChange={setStartFromOrigin}
                    disabled={saving}
                  />
                </Field>
              ) : null}
              <Field label="Model">
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
                    isComposerOwned={false}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onInstanceModelChange={(instanceId, model) =>
                      setChosenModel({ instanceId, model })
                    }
                  />
                </div>
              </Field>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!ready}
              onClick={() => void submit(true)}
            >
              Add to backlog
            </Button>
            <Button type="submit" disabled={!ready}>
              Enact
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
