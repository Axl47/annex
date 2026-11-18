import { useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, CatIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Annex's entries in the sidebar's utility row, rendered by upstream's own item component. */
export function AnnexSidebarItems({
  Item,
  onNavigate,
}: {
  readonly Item: (props: { icon: ReactNode; label: string; onClick: () => void }) => ReactNode;
  readonly onNavigate: () => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      <Item
        icon={<BookOpenIcon />}
        label="Grimoire"
        onClick={() => {
          onNavigate();
          void navigate({ to: "/grimoire" });
        }}
      />
      <Item
        icon={<CatIcon />}
        label="Familiars"
        onClick={() => {
          onNavigate();
          void navigate({ to: "/familiars" });
        }}
      />
    </>
  );
}
