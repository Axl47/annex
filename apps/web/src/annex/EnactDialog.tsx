import { useAtomValue } from "@effect/atom-react";
import {
  ModelSelection,
  type EnvironmentId,
  type GeasId,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type ProjectId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { FolderIcon, QuoteIcon, XIcon } from "lucide-react";
import { useState } from "react";

import type { EnvMode } from "../components/BranchToolbar.logic";
import { BranchToolbarEnvModeSelector } from "../components/BranchToolbarEnvModeSelector";
import { ComposerSelectControl } from "../components/chat/ComposerControl";
import { ComposerSurface } from "../components/chat/ComposerSurface";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { ComposerContextLabel } from "../components/ComposerContextLabel";
import { scheduledTaskDefaultModel } from "../components/settings/scheduledTasksSettings.logic";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Select, SelectItem, SelectPopup, SelectValue } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { readLocalStorageValue, writeLocalStorageValue } from "../hooks/useLocalStorage";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import { providerInstanceEntriesFor } from "../providerInstances";
import { useProjects } from "../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { EnactBranchPicker } from "./EnactBranchPicker";
import { grimoireAtoms } from "./state";

/** What the last enact used, so the next one starts from it. */
const LastEnact = Schema.Struct({
  projectId: Schema.optional(Schema.String),
  envMode: Schema.optional(Schema.Literals(["local", "worktree"])),
  /** Branch names only mean something in their own project. */
  baseRefs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  startFromOrigin: Schema.optional(Schema.Boolean),
  modelSelection: Schema.optional(ModelSelection),
});
type LastEnact = typeof LastEnact.Type;

const lastEnactKey = (environmentId: EnvironmentId) => `annex:geas-last-enact:${environmentId}`;

export interface EnactSeed {
  readonly projectId: ProjectId;
  /** A quoted passage of the parent's report that the new geas is about. */
  readonly quote: string;
  readonly parent: {
    readonly geasId: GeasId;
    readonly key: string;
    readonly title: string;
    /** A done or canceled geas starts no run, so its agent would never read the request. */
    readonly queueable: boolean;
  };
}

const QUEUE_INSTRUCTIONS =
  "File a new geas with geas_enact and start it. Write its request so a fresh agent can act on it alone, with what you know from this geas. It does not change your own task.";

export function EnactDialog({
  environmentId,
  seed,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly seed?: EnactSeed;
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
  const comment = useAtomCommand(grimoireAtoms.comment, { label: "queue geas request" });
  const canQueue = useAtomValue(grimoireAtoms.comment.permissionAtom(environmentId));

  const [last] = useState<LastEnact>(() =>
    readLocalStorageValue(lastEnactKey(environmentId), {}, LastEnact),
  );
  const [projectId, setProjectId] = useState<string>(
    seed?.projectId ?? last.projectId ?? projects[0]?.id ?? "",
  );
  const [request, setRequest] = useState("");
  const [quote, setQuote] = useState(seed?.quote ?? "");
  const [envMode, setEnvMode] = useState<EnvMode>(last.envMode ?? "worktree");
  const [baseRefs, setBaseRefs] = useState<Readonly<Record<string, string>>>(last.baseRefs ?? {});
  const [startFromOrigin, setStartFromOrigin] = useState(last.startFromOrigin ?? false);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(
    last.modelSelection ?? null,
  );
  const [saving, setSaving] = useState(false);

  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0] ?? null;
  const baseRef = project === null ? "" : (baseRefs[project.id] ?? "");
  const instanceEntries = providerInstanceEntriesFor(providers, settings, project?.id ?? null);
  const modelSelection =
    chosenModel !== null &&
    instanceEntries.some((entry) => entry.instanceId === chosenModel.instanceId && entry.enabled)
      ? chosenModel
      : scheduledTaskDefaultModel(settings, project, instanceEntries);
  const activeInstanceId =
    modelSelection?.instanceId ?? instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = modelSelection?.model ?? "";
  const ready = project !== null && modelSelection !== null && request.trim() !== "" && !saving;

  const submit = async (backlog: boolean) => {
    if (!ready || project === null || modelSelection === null) return;
    const workspace: OrchestrationV2ThreadLaunchWorkspaceStrategy =
      envMode === "local"
        ? { type: "root" }
        : { type: "worktree", baseRef: baseRef.trim() || "HEAD", startFromOrigin };
    setSaving(true);
    const result = await enact({
      environmentId,
      input: {
        projectId: project.id,
        request:
          seed === undefined || quote === ""
            ? request.trim()
            : `${request.trim()}\n\nThis comes from geas ${seed.parent.key} (${seed.parent.title}).\n${quote}`,
        workspace,
        modelSelection,
        backlog,
      },
    });
    setSaving(false);
    if (result._tag !== "Success") return;
    writeLocalStorageValue(
      lastEnactKey(environmentId),
      { projectId: project.id, envMode, baseRefs, startFromOrigin, modelSelection },
      {},
      LastEnact,
    );
    onClose(result.value.geasId);
  };

  /** Hands the request to the parent's agent, which knows the context, after its current run. */
  const queue = async () => {
    if (seed === undefined || request.trim() === "" || saving) return;
    setSaving(true);
    const result = await comment({
      environmentId,
      input: {
        geasId: seed.parent.geasId,
        body: [QUEUE_INSTRUCTIONS, `What I want:\n${request.trim()}`, quote]
          .filter((part) => part !== "")
          .join("\n\n"),
        queue: true,
      },
    });
    setSaving(false);
    if (result._tag === "Success") onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enact a geas</DialogTitle>
          <DialogDescription>
            An agent works on it in its own thread and hands back a report for you to review. The
            geas is titled from what you write.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
          >
            <ComposerSurface.Shell contextRow>
              <ComposerSurface.Host>
                <ComposerSurface.Main>
                  {seed !== undefined && quote !== "" ? (
                    <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                      <QuoteIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <p className="line-clamp-4 min-w-0 flex-1 whitespace-pre-wrap">
                        {seed.parent.key}: {quote}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remove context"
                        onClick={() => setQuote("")}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  ) : null}
                  <textarea
                    aria-label="What should be done?"
                    autoFocus
                    className="block max-h-72 min-h-28 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-base outline-none placeholder:text-muted-foreground/70 sm:text-sm"
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
                  <div className="flex items-center gap-1 px-2.5 pb-2.5">
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
                    <div className="min-w-0 flex-1" />
                    {seed?.parent.queueable === true ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canQueue || request.trim() === "" || saving}
                        onClick={() => void queue()}
                      >
                        Queue to {seed.parent.key}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!ready}
                      onClick={() => void submit(true)}
                    >
                      Add to backlog
                    </Button>
                    <Button type="submit" size="sm" disabled={!ready}>
                      Enact
                    </Button>
                  </div>
                </ComposerSurface.Main>
              </ComposerSurface.Host>
              <ComposerSurface.ContextStrip className="gap-1 text-xs font-normal text-foreground/70 dark:text-muted-foreground">
                <Select
                  modal={false}
                  value={project?.id ?? ""}
                  onValueChange={(value) => setProjectId(value as string)}
                >
                  <ComposerSelectControl size="xs" className="min-w-0 shrink" aria-label="Project">
                    <FolderIcon className="size-3" />
                    <ComposerContextLabel>
                      <SelectValue>{project?.title ?? "Choose a project"}</SelectValue>
                    </ComposerContextLabel>
                  </ComposerSelectControl>
                  <SelectPopup alignItemWithTrigger={false}>
                    {projects.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Separator orientation="vertical" className="mx-0.5 h-3.5!" />
                <BranchToolbarEnvModeSelector
                  envLocked={saving}
                  effectiveEnvMode={envMode}
                  activeWorktreePath={null}
                  onEnvModeChange={setEnvMode}
                />
                {envMode === "worktree" ? (
                  <div className="ml-auto flex min-w-0">
                    <EnactBranchPicker
                      key={`${environmentId}:${project?.id ?? ""}`}
                      environmentId={environmentId}
                      cwd={project?.workspaceRoot ?? null}
                      value={baseRef}
                      onValueChange={(branch) => {
                        if (project === null) return;
                        setBaseRefs((current) => ({ ...current, [project.id]: branch }));
                      }}
                      startFromOrigin={startFromOrigin}
                      onStartFromOriginChange={setStartFromOrigin}
                      disabled={saving}
                    />
                  </div>
                ) : null}
              </ComposerSurface.ContextStrip>
            </ComposerSurface.Shell>
          </form>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
