import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { MessageSquareQuoteIcon, ScrollTextIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../components/ui/button";
import { captureAssistantTextSelection } from "../lib/assistantTextSelection";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "../lib/selectionActions";

/** Where a report citation points: the geas's thread, with the report standing in for a message. */
export interface ReportCitationSource {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: string;
}

/**
 * Cites text selected in a report the way Cite does in chat, so the agent gets the same
 * `<assistant_citations>` block. `source` carries `data-assistant-citation-source`.
 */
export function GeasSelectionMenu({
  source,
  citationSource,
  canComment,
  canEnact,
  onComment,
  onEnact,
}: {
  readonly source: HTMLElement | null;
  readonly citationSource: ReportCitationSource;
  readonly canComment: boolean;
  readonly canEnact: boolean;
  readonly onComment: (citation: AssistantCitation) => void;
  readonly onEnact: (citation: AssistantCitation) => void;
}) {
  const [selection, setSelection] = useState<{
    readonly citation: AssistantCitation;
    readonly position: SelectionActionPoint;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const { environmentId, threadId, messageId } = citationSource;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the menu and clamps it inside the window before paint
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !selection) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows document text selection inside the report
  useEffect(() => {
    if (!source) return;
    const clear = () => setSelection(null);
    const actions = observeSelectionActions({
      element: source,
      getActionElement: () => menuRef.current,
      onSelection: () => {
        const captured = captureAssistantTextSelection(source, window.getSelection());
        if (!captured) return clear();
        const rects = captured.range.getClientRects();
        setSelection({
          citation: {
            version: 1,
            environmentId,
            threadId,
            messageId: MessageId.make(messageId),
            ...captured.selector,
          },
          position: resolveSelectionActionPosition({
            bounds: source.getBoundingClientRect(),
            selectionRect: rects.item(rects.length - 1) ?? captured.range.getBoundingClientRect(),
            pointer: null,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          }),
        });
      },
      onDismiss: clear,
    });
    actionsRef.current = actions;
    // The page scrolls outside the report, where the helper does not listen.
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) clear();
    };
    document.addEventListener("selectionchange", actions.selectionChanged);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("selectionchange", actions.selectionChanged);
      document.removeEventListener("scroll", onScroll, true);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [environmentId, messageId, source, threadId]);

  if (!selection) return null;
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const run = (action: (citation: AssistantCitation) => void) => {
    action(selection.citation);
    actionsRef.current?.cancel();
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };
  return createPortal(
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Selection actions"
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] gap-1"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          actionsRef.current?.cancel();
          setSelection(null);
        }
      }}
    >
      {tooLong ? (
        <Button type="button" size="xs" variant="glass" disabled>
          Shorten selection
        </Button>
      ) : (
        <>
          <Button
            type="button"
            size="xs"
            variant="glass"
            disabled={!canComment}
            onClick={() => run(onComment)}
          >
            <MessageSquareQuoteIcon aria-hidden="true" />
            Comment inline
          </Button>
          <Button
            type="button"
            size="xs"
            variant="glass"
            disabled={!canEnact}
            onClick={() => run(onEnact)}
          >
            <ScrollTextIcon aria-hidden="true" />
            Enact new geas
          </Button>
        </>
      )}
    </div>,
    document.body,
  );
}
