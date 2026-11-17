import type { useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, ScrollTextIcon } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../components/CommandPalette.logic";

/** Annex's command palette actions, spread into upstream's action list. */
export function annexPaletteActions(
  navigate: ReturnType<typeof useNavigate>,
): ReadonlyArray<CommandPaletteActionItem> {
  return [
    {
      kind: "action",
      value: "action:grimoire",
      searchTerms: ["grimoire", "geas", "geasa", "issue", "task", "report", "enact", "annex"],
      title: "Open Grimoire",
      icon: <BookOpenIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/grimoire" });
      },
    },
    {
      kind: "action",
      value: "action:enact-geas",
      searchTerms: ["enact", "geas", "new geas", "issue", "task", "annex"],
      title: "Enact a geas",
      icon: <ScrollTextIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/grimoire", search: { enact: true } });
      },
    },
  ];
}
