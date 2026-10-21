"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";

// How long the pointer may be off the tab and the open rail before a peek closes (ms): long enough to cross the gap
// between them or slip past an edge.
const PEEK_CLOSE_DELAY_MS = 320;

// Closed; open while the pointer is on it (a peek); or open until the reader closes it (pinned, after a press).
type TabState = "closed" | "peek" | "pinned";

type RailHoverTabProps = {
  /** The tab's top edge, from the top of the column the rail floats in (CSS px). */
  tabTopPx: number;
  widthPx: number;
  /** What the rail holds now, under "Show panel" (the vessel and the mode's main card). */
  summary: string;
  /** The rail, given the way to fold it back to the tab (its cards' Hide button). */
  renderRail: (foldRail: () => void) => ReactNode;
};

/**
 * The floating rail folded to a tab under the anchor cam, for a stage too short to show both (a laptop window, the
 * anchor cam grown). The rail opens over the stage's right column while the pointer rests on the tab, and stays open
 * after a press (touch, keyboard, a click) until Escape, a press outside it, or a second press on the tab.
 */
export function RailHoverTab({ tabTopPx, widthPx, summary, renderRail }: RailHoverTabProps) {
  const [tabState, setTabState] = useState<TabState>("closed");
  const panelId = useId();
  const tabId = useId();
  const columnRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isOpen = tabState !== "closed";

  const cancelClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setTabState((current) => (current === "peek" ? "closed" : current));
    }, PEEK_CLOSE_DELAY_MS);
  };

  // A pinned rail closes on a press anywhere outside it: listens to the document, which React does not own.
  useEffect(() => {
    if (tabState !== "pinned") return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && columnRef.current?.contains(event.target)) return;
      setTabState("closed");
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [tabState]);

  // The close timer dies with the tab.
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );
  // Folded from inside (Escape, its Hide button, whose control then leaves the page), the focus goes back to the tab.
  const foldRail = () => {
    setTabState("closed");
    document.getElementById(tabId)?.focus();
  };

  return (
    <div
      ref={columnRef}
      className="pointer-events-none absolute top-4 right-4 bottom-4 z-(--layer-popover)"
      style={{ width: widthPx }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        cancelClose();
        setTabState((current) => (current === "closed" ? "peek" : current));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") scheduleClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.stopPropagation();
        foldRail();
      }}
      data-label-blocker="true"
      data-overlays-stage="true"
    >
      <button
        id={tabId}
        type="button"
        onClick={() => setTabState((current) => (current === "pinned" ? "closed" : "pinned"))}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="pointer-events-auto absolute right-0 left-0 flex h-12 items-center gap-3 rounded-row bg-card px-4 text-left shadow-card transition-shadow duration-140 ease-standard hover:shadow-raised active:scale-[0.98]"
        style={{ top: tabTopPx }}
        data-testid="rail-tab"
        data-state={tabState}
      >
        <Icon name="panel" className="flex-none text-muted" />
        <span className="flex min-w-0 flex-col">
          <span className="text-label">Show panel</span>
          <span className="truncate text-caption font-normal text-muted">{summary}</span>
        </span>
        <Icon name="chevronDown" className="ml-auto flex-none text-muted" />
      </button>
      {isOpen && (
        // On the page's tone, as the phone's sheet holds the same cards: the anchor cam under it never shows between them.
        <div id={panelId} className="pointer-events-auto absolute -inset-2 flex animate-layer-enter flex-col gap-3 rounded-card bg-page p-2 shadow-popover" data-testid="rail-tab-panel">
          {renderRail(foldRail)}
        </div>
      )}
    </div>
  );
}
