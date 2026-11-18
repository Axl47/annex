import type { AssistantCitation } from "@t3tools/contracts";
import {
  assistantCitationLabel,
  collectAssistantCitations,
} from "@t3tools/shared/assistantCitations";
import { QuoteIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

/** A cited report passage. Upstream's chip links to a chat message, which a report is not. */
export function GeasCitationChip({
  citation,
  onRemove,
}: {
  readonly citation: AssistantCitation;
  readonly onRemove?: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger
          render={<span className="inline-flex min-w-0 items-center gap-1" tabIndex={0} />}
        >
          <QuoteIcon aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{assistantCitationLabel(citation)}</span>
        </TooltipTrigger>
        <TooltipPopup className="max-w-sm whitespace-pre-wrap">{citation.text}</TooltipPopup>
      </Tooltip>
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove citation"
          className="-mr-0.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={onRemove}
        >
          <XIcon aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/** Text with its citation links drawn as chips, as a sent chat message shows them. */
export function GeasCitedText({ text }: { readonly text: string }) {
  const parts: Array<ReactNode> = [];
  let cursor = 0;
  for (const match of collectAssistantCitations(text)) {
    parts.push(text.slice(cursor, match.start));
    parts.push(<GeasCitationChip key={match.start} citation={match.citation} />);
    cursor = match.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
