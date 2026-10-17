"use client";

import { m } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { Icon } from "@/components/icons/Icon";
import { describeAnchorStatus } from "@/lib/replay/anchor-status";
import { progressToTimeMs } from "@/lib/replay/replay-scene";

// The island grows on one layout transition (docs/UI_DESIGN_SYSTEM.md, Motion: duration-standard, ease-enter).
const ISLAND_TRANSITION = { duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * The anchor status at the top of the stage: a white pill saying what the anchor is doing; pressed, it grows into
 * the latest event with its quote (after bencho.dev's dynamic-island, MIT: one shape, the contents cross-fade).
 * Re-renders only when the status or the latest event changes, not on every frame.
 */
export function StatusIsland({ isCloseUp }: { isCloseUp: boolean }) {
  const { input, consoleCase, clock } = useConsole();
  const [isOpen, setIsOpen] = useState(false);
  const readKey = () => {
    const atMs = progressToTimeMs(input, clock.getSnapshot().progress);
    let latestIndex = -1;
    consoleCase.events.forEach((event, index) => {
      if (event.atMs <= atMs) latestIndex = index;
    });
    return `${describeAnchorStatus(input, atMs).kind}|${latestIndex}`;
  };
  const key = useSyncExternalStore(clock.subscribe, readKey, readKey);
  const [statusKind, latestIndexText] = key.split("|");
  const atMs = progressToTimeMs(input, clock.getSnapshot().progress);
  const status = describeAnchorStatus(input, atMs);
  const latestEvent = consoleCase.events[Number(latestIndexText)] ?? null;
  const isDragging = statusKind === "dragging";

  return (
    <div className={`pointer-events-none absolute left-4 z-(--layer-stage-controls) flex justify-center xl:top-4 xl:left-1/2 xl:-translate-x-1/2 ${isCloseUp ? "top-28" : "top-16"}`}>
      <m.div layout transition={ISLAND_TRANSITION} style={{ borderRadius: isOpen ? 20 : 999 }} className="pointer-events-auto flex w-max max-w-[min(380px,calc(100vw-48px))] flex-col overflow-hidden bg-card shadow-row">
        <m.button
          layout="position"
          type="button"
          onClick={() => setIsOpen((wasOpen) => !wasOpen)}
          aria-expanded={isOpen}
          className="flex h-10 items-center gap-2.5 self-center pr-3.5 pl-4 text-small font-medium whitespace-nowrap text-ink"
          data-testid="replay-anchor-status"
          data-state={statusKind}
        >
          {isDragging && <span className="size-2 flex-none rounded-full bg-alarm" aria-hidden="true" />}
          <span aria-live="polite">{status.text}</span>
          <Icon name="chevronDown" size={16} className={`flex-none text-muted transition-transform duration-220 ease-standard ${isOpen ? "rotate-180" : ""}`} />
        </m.button>
        {isOpen && (
          <div className="flex w-[340px] max-w-full animate-layer-enter flex-col gap-2.5 px-4 pt-1 pb-4">
            {latestEvent ? (
              <>
                <p className="flex items-baseline gap-2">
                  <span className="text-label tabular-nums">{latestEvent.timeLabel}</span>
                  <span className="text-caption font-normal text-muted">{latestEvent.isTimeApproximate ? "about, UTC" : "UTC"}</span>
                </p>
                <p className="text-small">{latestEvent.title}</p>
                {latestEvent.citations[0] && (
                  <p className="rounded-field bg-page px-3.5 py-3 text-small">{latestEvent.citations[0].translation ?? latestEvent.citations[0].quote}</p>
                )}
                <CitationButtons citations={latestEvent.citations} />
              </>
            ) : (
              <p className="text-small text-muted">Nothing has happened yet at this moment of the replay. Press Play or pick an event.</p>
            )}
          </div>
        )}
      </m.div>
    </div>
  );
}
