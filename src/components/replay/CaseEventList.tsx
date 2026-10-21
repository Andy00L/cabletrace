"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import type { ConsoleEvent } from "@/lib/cases/case-console";
import { formatUtcDay, isSameUtcDay } from "@/lib/replay/format-utc";
import { progressToTimeMs } from "@/lib/replay/replay-scene";

/** Index of the last event at or before the replay moment, or -1 before the first one. */
function findCurrentIndex(events: readonly ConsoleEvent[], atMs: number): number {
  let currentIndex = -1;
  events.forEach((event, index) => {
    if (event.atMs <= atMs) currentIndex = index;
  });
  return currentIndex;
}

/**
 * The window's events in order, in a card that scrolls inside itself and never gets shorter than about three rows
 * (the rail around it scrolls instead, ConsoleRail). The row for the latest event so far is
 * marked and kept in view, later rows are muted, a row click moves the replay there, and each source number opens
 * its card. It re-renders only when the current row changes, not on every frame. When the window spans more than
 * one UTC day, the first row of each day carries its date under the time.
 */
export function CaseEventList() {
  const { input, consoleCase, clock, seekTo } = useConsole();
  const events = consoleCase.events;
  const readCurrentIndex = () => findCurrentIndex(events, progressToTimeMs(input, clock.getSnapshot().progress));
  const currentIndex = useSyncExternalStore(clock.subscribe, readCurrentIndex, readCurrentIndex);
  const listRef = useRef<HTMLOListElement>(null);

  // Keeps the current row in view as the clock passes it. Scrolls only the list element (scrollIntoView would also
  // scroll the page around it), which React does not own.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !row) return;
    const rowTop = row.offsetTop - list.offsetTop;
    const isVisible = rowTop >= list.scrollTop && rowTop + row.offsetHeight <= list.scrollTop + list.clientHeight;
    if (isVisible) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    list.scrollTo({ top: Math.max(0, rowTop - list.clientHeight / 3), behavior });
  }, [currentIndex]);

  return (
    <section className="flex min-h-[260px] flex-1 flex-col gap-3 rounded-row bg-card px-3 pt-5 pb-3 shadow-card" data-testid="event-list">
      <div className="flex flex-col gap-0.5 px-2">
        <h2 className="text-card-title">{consoleCase.windowDaysLabel}, minute by minute</h2>
        <p className="text-caption font-normal text-muted">Times in UTC. Pick a row to move the replay there.</p>
      </div>
      <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-2 [mask-image:linear-gradient(to_bottom,transparent,#000_16px,#000_calc(100%-24px),transparent)]">
        {events.map((event, index) => {
          const isCurrent = index === currentIndex;
          const isLater = index > currentIndex;
          const previousEvent = events[index - 1];
          const startsDay = consoleCase.isMultiDay && (!previousEvent || !isSameUtcDay(previousEvent.atMs, event.atMs));
          return (
            <li
              key={`${event.atMs}-${event.title}`}
              aria-current={isCurrent ? "step" : undefined}
              className={`grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 rounded-field px-2 py-2.5 transition-colors duration-140 ease-standard ${isCurrent ? "bg-page" : ""} ${isLater ? "text-muted" : "text-ink"}`}
            >
              <button type="button" onClick={() => seekTo(event.atMs)} className="col-span-2 grid grid-cols-subgrid text-left" aria-label={`${event.timeLabel} UTC, ${event.title}`}>
                <span className="flex flex-col">
                  <span className="text-small font-medium tabular-nums">{event.timeLabel}</span>
                  {startsDay && <span className="text-micro text-muted tabular-nums">{formatUtcDay(event.atMs)}</span>}
                  {event.isTimeApproximate && <span className="text-micro text-muted">about</span>}
                </span>
                <span className="text-small">{event.title}</span>
              </button>
              <CitationButtons citations={event.citations} className="col-start-2 mt-0.5" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
