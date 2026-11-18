import type { useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, ScrollTextIcon, CatIcon, WandIcon } from "lucide-react";

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
    {
      kind: "action",
      value: "action:familiars",
      searchTerms: ["familiar", "familiars", "agent", "standing agent", "tome", "routine", "annex"],
      title: "Open Familiars",
      icon: <CatIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/familiars" });
      },
    },
    {
      kind: "action",
      value: "action:summon-familiar",
      searchTerms: ["summon", "familiar", "new familiar", "agent", "annex"],
      title: "Summon a Familiar",
      icon: <WandIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/familiars", search: { summon: true } });
      },
    },
  ];
}
