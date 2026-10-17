"use client";

import { useSyncExternalStore } from "react";
import type { TimelineEvent } from "@/lib/cases/case-view";
import { formatUtcDay, formatUtcDaySpan, isSameUtcDay } from "@/lib/replay/format-utc";
import type { ReplayClock } from "@/lib/replay/replay-clock";
import { progressToTimeMs, timeMsToProgress, type ReplaySceneInput } from "@/lib/replay/replay-scene";

type CaseEventListProps = {
  input: ReplaySceneInput;
  /** Sorted by time. */
  events: readonly TimelineEvent[];
  clock: ReplayClock;
};

/** Index of the last event at or before the replay moment, or -1 before the first one. */
function findCurrentIndex(events: readonly TimelineEvent[], atMs: number): number {
  let currentIndex = -1;
  events.forEach((event, index) => {
    if (event.atMs <= atMs) currentIndex = index;
  });
  return currentIndex;
}

/**
 * The window's events in order. The row for the latest event so far is marked, later rows are muted, and a
 * row click moves the replay there. It re-renders only when the current row changes, not on every frame.
 * When the window spans more than one UTC day, the first row of each day carries its date under the time.
 */
export function CaseEventList({ input, events, clock }: CaseEventListProps) {
  const currentIndex = useSyncExternalStore(
    clock.subscribe,
    () => findCurrentIndex(events, progressToTimeMs(input, clock.getSnapshot().progress)),
    () => findCurrentIndex(events, progressToTimeMs(input, clock.getSnapshot().progress)),
  );

  const isMultiDay = !isSameUtcDay(input.windowStartMs, input.windowEndMs);

  return (
    <section className="flex flex-col gap-3.5 rounded-card bg-card px-5 pt-7 pb-5 shadow-card" data-testid="event-list">
      <div className="flex flex-col gap-0.5 px-2">
        <h2 className="text-card-title">{formatUtcDaySpan(input.windowStartMs, input.windowEndMs)}, minute by minute</h2>
        <p className="text-caption text-muted">Times in UTC. Pick a row to move the replay there.</p>
      </div>
      <ol className="flex flex-col gap-0.5">
        {events.map((event, index) => {
          const isCurrent = index === currentIndex;
          const isLater = index > currentIndex;
          const previousEvent = events[index - 1];
          const startsDay = isMultiDay && (!previousEvent || !isSameUtcDay(previousEvent.atMs, event.atMs));
          return (
            <li key={`${event.atMs}-${event.title}`}>
              <button
                type="button"
                onClick={() => clock.seek(timeMsToProgress(input, event.atMs))}
                aria-current={isCurrent ? "step" : undefined}
                className={`grid w-full grid-cols-[52px_minmax(0,1fr)] gap-x-3 rounded-field px-2 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-page ${
                  isCurrent ? "bg-page" : ""
                } ${isLater ? "text-muted" : "text-ink"}`}
              >
                <span className="flex flex-col">
                  <span className="text-small font-medium tabular-nums">{event.timeLabel}</span>
                  {startsDay && <span className="text-micro text-muted tabular-nums">{formatUtcDay(event.atMs)}</span>}
                  {event.isTimeApproximate && <span className="text-micro text-muted">about</span>}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-small">{event.title}</span>
                  <span className="text-micro text-muted">{event.sourceNote}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
