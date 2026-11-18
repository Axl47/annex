import type { EnvironmentId } from "@t3tools/contracts";
import { GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { BranchPicker, BranchPickerRefItem } from "../components/BranchPicker";
import { resolveBranchTriggerLabel, sanitizeNewRefName } from "../components/BranchToolbar.logic";
import { ComposerControl } from "../components/chat/ComposerControl";
import { ComposerContextLabel } from "../components/ComposerContextLabel";
import { ComboboxTrigger } from "../components/ui/combobox";
import { MiddleTruncate } from "../components/ui/middle-truncate";
import { usePaginatedBranches } from "../state/queries";

/** The base branch for a new worktree, with the composer's branch trigger. */
export function EnactBranchPicker({
  environmentId,
  cwd,
  value,
  onValueChange,
  startFromOrigin,
  onStartFromOriginChange,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly value: string;
  readonly onValueChange: (branch: string) => void;
  readonly startFromOrigin: boolean;
  readonly onStartFromOriginChange: (checked: boolean) => void;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const branches = usePaginatedBranches({
    environmentId,
    cwd,
    query: sanitizeNewRefName(query.trim()),
  });
  const selectedRef = branches.refs.find((branch) => branch.name === value);
  const label = resolveBranchTriggerLabel({
    activeWorktreePath: null,
    effectiveEnvMode: "worktree",
    resolvedActiveBranch: value || null,
    resolvedActiveBranchIsRemote: selectedRef ? selectedRef.isRemote === true : null,
    startFromOrigin,
  });
  const branchByName = new Map(branches.refs.map((branch) => [branch.name, branch]));
  const items = [...branchByName.keys()];
  const hasNextPage = branches.data?.nextCursor != null;
  const statusText =
    branches.error ??
    (branches.isPending && branches.data === null
      ? "Loading refs..."
      : branches.isFetchingNextPage
        ? "Loading more refs..."
        : hasNextPage
          ? `Showing ${branches.refs.length} of ${branches.data?.totalCount} refs`
          : null);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const select = (name: string) => {
    onValueChange(name);
    handleOpenChange(false);
  };
  return (
    <BranchPicker
      items={items}
      filteredItems={items}
      value={value || null}
      query={query}
      onQueryChange={setQuery}
      open={open && !disabled}
      onOpenChange={handleOpenChange}
      onSelectItem={select}
      hasNextPage={hasNextPage}
      isFetchingNextPage={branches.isFetchingNextPage}
      onLoadNext={branches.loadNext}
      statusText={statusText}
      originControl={{ checked: startFromOrigin, onCheckedChange: onStartFromOriginChange }}
      popupProps={{ align: "end", side: "bottom", className: "flex w-80 flex-col" }}
      renderItem={(name, index) => {
        const branch = branchByName.get(name);
        return branch ? (
          <BranchPickerRefItem
            branch={branch}
            projectCwd={cwd}
            index={index}
            onClick={() => select(branch.name)}
          />
        ) : null;
      }}
    >
      <ComboboxTrigger
        render={<ComposerControl size="xs" />}
        className="min-w-0 max-w-full active:scale-100"
        disabled={disabled || !cwd}
        aria-label={`Base branch: ${label}`}
      >
        <GitBranchIcon className="size-3 shrink-0" />
        <ComposerContextLabel>
          <MiddleTruncate value={label} variant="cap-aligned" />
        </ComposerContextLabel>
      </ComboboxTrigger>
    </BranchPicker>
  );
}
