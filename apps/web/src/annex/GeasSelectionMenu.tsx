import { MessageSquareQuoteIcon, ScrollTextIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../components/ui/button";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "../lib/selectionActions";

const QUOTE_MAX_LENGTH = 2000;
const PASSAGE_MAX_LENGTH = 1200;
const PASSAGE_BLOCKS = "p, li, td, th, figcaption, pre, blockquote, h3";

/** Selected report text, with where it sits so an agent can find it. */
export interface ReportSelection {
  readonly text: string;
  readonly section: string | null;
  /** The whole block the selection sits in, when it is more than the selection. */
  readonly passage: string | null;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

export function quoteReportSelection(selection: ReportSelection): string {
  const where = selection.section === null ? "the report" : `the report's ${selection.section}`;
  const lines = [`From ${where}, I'm quoting:`, quote(clip(selection.text, QUOTE_MAX_LENGTH))];
  if (selection.passage !== null) {
    lines.push("In this passage:", quote(clip(selection.passage, PASSAGE_MAX_LENGTH)));
  }
  return lines.join("\n");
}

function readSelection(range: Range, text: string): ReportSelection {
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const block = start?.closest(PASSAGE_BLOCKS) ?? null;
  const passage =
    block !== null && block.contains(range.endContainer)
      ? (block.textContent ?? "").replace(/\s+/g, " ").trim()
      : "";
  return {
    text,
    section: start?.closest<HTMLElement>("[data-report-section]")?.dataset.reportSection ?? null,
    passage: passage.length > text.replace(/\s+/g, " ").length ? passage : null,
  };
}

/** Comment on, or enact a new geas from, text selected in a report. */
export function GeasSelectionMenu({
  source,
  canComment,
  canEnact,
  onComment,
  onEnact,
}: {
  readonly source: HTMLElement | null;
  readonly canComment: boolean;
  readonly canEnact: boolean;
  readonly onComment: (selection: ReportSelection) => void;
  readonly onEnact: (selection: ReportSelection) => void;
}) {
  const [selection, setSelection] = useState<{
    readonly report: ReportSelection;
    readonly position: SelectionActionPoint;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

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
        const native = window.getSelection();
        if (!native || native.isCollapsed || native.rangeCount === 0) return clear();
        const range = native.getRangeAt(0);
        const text = native.toString().trim();
        if (text === "" || !source.contains(range.commonAncestorContainer)) return clear();
        const rects = range.getClientRects();
        setSelection({
          report: readSelection(range, text),
          position: resolveSelectionActionPosition({
            bounds: source.getBoundingClientRect(),
            selectionRect: rects.item(rects.length - 1) ?? range.getBoundingClientRect(),
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
  }, [source]);

  if (!selection) return null;
  const run = (action: (selection: ReportSelection) => void) => {
    action(selection.report);
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
    </div>,
    document.body,
  );
}
