import {
  DEFAULT_GEAS_DELIVERY_ACTIONS,
  GEAS_KEY_PREFIX_PATTERN,
  type EnvironmentId,
  type GeasCheckDeclaration,
  type GeasDeliveryAction,
  type GrimoireProjectSettings,
  type ProjectId,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

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
import { useProjects } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { grimoireAtoms } from "./state";

interface Draft {
  readonly keyPrefix: string;
  readonly checks: ReadonlyArray<GeasCheckDeclaration>;
  readonly deliveryActions: ReadonlyArray<GeasDeliveryAction>;
  readonly rules: string;
}

const draftFrom = (settings: GrimoireProjectSettings | undefined): Draft => ({
  keyPrefix: settings?.keyPrefix ?? "",
  checks: settings?.checks ?? [],
  deliveryActions: settings?.deliveryActions ?? DEFAULT_GEAS_DELIVERY_ACTIONS,
  rules: settings?.rules ?? "",
});

function Section({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

/** Label-and-text rows, used for both checks and delivery actions. */
function PairList<
  T extends Record<K | V, string>,
  K extends keyof T & string,
  V extends keyof T & string,
>({
  rows,
  labelKey,
  valueKey,
  valuePlaceholder,
  make,
  onChange,
}: {
  readonly rows: ReadonlyArray<T>;
  readonly labelKey: K;
  readonly valueKey: V;
  readonly valuePlaceholder: string;
  readonly make: () => T;
  readonly onChange: (rows: ReadonlyArray<T>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- rows have no identity besides position
        <div key={index} className="flex items-center gap-2">
          <Input
            className="w-32 shrink-0"
            aria-label="Label"
            placeholder="Label"
            value={row[labelKey]}
            onChange={(event) =>
              onChange(
                rows.map((r, i) => (i === index ? { ...r, [labelKey]: event.target.value } : r)),
              )
            }
          />
          <Input
            className="min-w-0 flex-1"
            aria-label={valuePlaceholder}
            placeholder={valuePlaceholder}
            value={row[valueKey]}
            onChange={(event) =>
              onChange(
                rows.map((r, i) => (i === index ? { ...r, [valueKey]: event.target.value } : r)),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost-muted"
        size="sm"
        className="self-start"
        onClick={() => onChange([...rows, make()])}
      >
        <PlusIcon />
        Add
      </Button>
    </div>
  );
}

export function GrimoireSettingsDialog({
  environmentId,
  settings,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly settings: ReadonlyArray<GrimoireProjectSettings>;
  readonly onClose: () => void;
}) {
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId &&
      project.archivedAt == null &&
      project.isScratch !== true,
  );
  const settingsFor = (projectId: string) =>
    settings.find((entry) => entry.projectId === projectId);
  const [projectId, setProjectId] = useState<string>(
    settings[0]?.projectId ?? projects[0]?.id ?? "",
  );
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settingsFor(projectId)));
  const [saving, setSaving] = useState(false);
  const save = useAtomCommand(grimoireAtoms.updateProjectSettings, {
    label: "save grimoire settings",
  });
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const prefix = draft.keyPrefix.trim().toUpperCase();
  const prefixValid = prefix === "" || GEAS_KEY_PREFIX_PATTERN.test(prefix);

  const submit = async () => {
    if (project === null || !prefixValid || saving) return;
    setSaving(true);
    const result = await save({
      environmentId,
      input: {
        projectId: project.id as ProjectId,
        ...(prefix === "" ? {} : { keyPrefix: prefix }),
        checks: draft.checks
          .map((check) => ({ label: check.label.trim(), command: check.command.trim() }))
          .filter((check) => check.label !== "" && check.command !== ""),
        deliveryActions: draft.deliveryActions
          .map((action) => ({ label: action.label.trim(), prompt: action.prompt.trim() }))
          .filter((action) => action.label !== "" && action.prompt !== ""),
        rules: draft.rules.trim(),
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
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Grimoire settings</DialogTitle>
            <DialogDescription>How geasa work in each project.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="grimoire-project">Project</Label>
                  <Select
                    value={projectId}
                    onValueChange={(value) => {
                      setProjectId(value as string);
                      setDraft(draftFrom(settingsFor(value as string)));
                    }}
                  >
                    <SelectTrigger size="sm" id="grimoire-project">
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
                  <Label htmlFor="grimoire-prefix">Key prefix</Label>
                  <Input
                    id="grimoire-prefix"
                    placeholder="Derived from the project name"
                    value={draft.keyPrefix}
                    aria-invalid={!prefixValid}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, keyPrefix: event.target.value }))
                    }
                  />
                  {!prefixValid ? (
                    <p className="text-xs text-destructive">
                      Up to 8 letters and digits, starting with a letter.
                    </p>
                  ) : null}
                </div>
              </div>
              <Section
                label="Checks"
                hint="Commands this project vouches for. A report check passes only when its command starts with one of these and exited 0."
              >
                <PairList
                  rows={draft.checks}
                  labelKey="label"
                  valueKey="command"
                  valuePlaceholder="Command, e.g. vp run check:changed"
                  make={() => ({ label: "", command: "" })}
                  onChange={(checks) => setDraft((current) => ({ ...current, checks }))}
                />
              </Section>
              <Section
                label="Delivery actions"
                hint="Buttons on a geas in review. Each sends its prompt to the agent."
              >
                <PairList
                  rows={draft.deliveryActions}
                  labelKey="label"
                  valueKey="prompt"
                  valuePlaceholder="Prompt, e.g. Land this."
                  make={() => ({ label: "", prompt: "" })}
                  onChange={(deliveryActions) =>
                    setDraft((current) => ({ ...current, deliveryActions }))
                  }
                />
              </Section>
              <Section label="Rules" hint="Added to every run's geas rules in this project.">
                <Textarea
                  aria-label="Rules"
                  className="max-h-48 min-h-20 overflow-y-auto"
                  value={draft.rules}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, rules: event.target.value }))
                  }
                />
              </Section>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={project === null || !prefixValid || saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
