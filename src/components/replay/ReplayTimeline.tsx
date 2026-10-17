"use client";

import { useSyncExternalStore } from "react";
import type { TimelineEvent } from "@/lib/cases/case-view";
import { formatUtcClock, formatZonedDateTime } from "@/lib/replay/format-utc";
import type { ReplayClock } from "@/lib/replay/replay-clock";
import { progressToTimeMs, timeMsToProgress, type ReplaySceneInput } from "@/lib/replay/replay-scene";

// The scrubber moves in whole minutes; arrow keys step one minute.
const MS_PER_MINUTE = 60_000;
// A cut label closer than this share of the width to an end is aligned to that end instead of centred on its marker.
const LABEL_EDGE_SHARE = 0.1;

type ReplayTimelineProps = {
  input: ReplaySceneInput;
  events: readonly TimelineEvent[];
  clock: ReplayClock;
  localTime: { place: string; timeZone: string };
};

function toPercent(share: number): string {
  return `${(Math.min(1, Math.max(0, share)) * 100).toFixed(3)}%`;
}

function describeAnchor(input: ReplaySceneInput, atMs: number): { isDragging: boolean; text: string } {
  const dragWindow = input.dragWindow;
  if (!dragWindow) return { isDragging: false, text: "No anchor drag in this case" };
  if (atMs < dragWindow.startMs) return { isDragging: false, text: `Drag starts at ${formatUtcClock(dragWindow.startMs)}` };
  if (atMs <= dragWindow.endMs) return { isDragging: true, text: "Anchor dragging on the seabed" };
  return { isDragging: false, text: `Drag ended at ${formatUtcClock(dragWindow.endMs)}` };
}

/**
 * Play, the clock and the scrubber. The scrubber is a native range input laid over the drawn track, so it
 * keeps keyboard and screen reader support; the drawn head shows its focus ring.
 */
export function ReplayTimeline({ input, events, clock, localTime }: ReplayTimelineProps) {
  const snapshot = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const atMs = progressToTimeMs(input, snapshot.progress);
  const totalMinutes = Math.round((input.windowEndMs - input.windowStartMs) / MS_PER_MINUTE);
  const anchor = describeAnchor(input, atMs);
  const dragStartShare = input.dragWindow ? timeMsToProgress(input, input.dragWindow.startMs) : 0;
  const dragEndShare = input.dragWindow ? timeMsToProgress(input, input.dragWindow.endMs) : 0;
  const dragPlayedShare = Math.max(0, Math.min(snapshot.progress, dragEndShare) - dragStartShare);

  return (
    <div className="flex flex-col gap-4.5 px-5 pt-5 pb-1">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={clock.toggle}
          aria-label={snapshot.isPlaying ? "Pause replay" : "Play replay"}
          className="grid size-11 flex-none place-items-center rounded-full bg-ink transition-colors duration-140 ease-standard hover:bg-ink-hover active:scale-[0.97]"
          data-testid="replay-play"
        >
          {snapshot.isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M6 4 V14 M12 4 V14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="text-card" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M5.5 3.5 L14.5 9 L5.5 14.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className="text-card" />
            </svg>
          )}
        </button>
        <div className="flex min-w-44 flex-col gap-0.5">
          <p className="text-heading tabular-nums" data-testid="replay-clock">
            {formatUtcClock(atMs)} <span className="text-label text-muted">UTC</span>
          </p>
          <p className="text-caption text-muted tabular-nums">
            {formatZonedDateTime(atMs, localTime.timeZone)} in {localTime.place}
          </p>
        </div>
        <p className="flex flex-[1_1_200px] items-center justify-end gap-2 text-small font-medium" data-testid="replay-anchor-status">
          {anchor.isDragging && <span className="size-2.5 rounded-full bg-alarm" aria-hidden="true" />}
          <span className={anchor.isDragging ? "text-ink" : "text-muted"}>{anchor.text}</span>
        </p>
      </div>

      <div className="relative h-16">
        <input
          type="range"
          min={0}
          max={totalMinutes}
          step={1}
          value={Math.round(snapshot.progress * totalMinutes)}
          onChange={(event) => clock.seek(Number(event.target.value) / totalMinutes)}
          aria-label="Replay time"
          aria-valuetext={`${formatUtcClock(atMs)} UTC`}
          className="peer absolute inset-x-0 top-2 z-10 m-0 h-[30px] w-full cursor-pointer opacity-0"
          data-testid="replay-scrubber"
        />
        {events.map((event) => (
          <span
            key={`${event.atMs}-${event.title}`}
            className={`absolute top-0 -ml-px h-2.5 w-0.5 rounded-full ${event.kind === "cable-fault" ? "bg-alarm" : "bg-ink/35"}`}
            style={{ left: toPercent(timeMsToProgress(input, event.atMs)) }}
            aria-hidden="true"
          />
        ))}
        <span className="absolute inset-x-0 top-5 h-1.5 rounded-full bg-soft" aria-hidden="true" />
        {input.dragWindow && (
          <span
            className="absolute top-5 h-1.5 rounded-full bg-alarm/22"
            style={{ left: toPercent(dragStartShare), width: toPercent(dragEndShare - dragStartShare) }}
            aria-hidden="true"
          />
        )}
        <span className="absolute top-5 left-0 h-1.5 rounded-full bg-ink" style={{ width: toPercent(snapshot.progress) }} aria-hidden="true" />
        {input.dragWindow && dragPlayedShare > 0 && (
          <span
            className="absolute top-5 h-1.5 rounded-full bg-alarm"
            style={{ left: toPercent(dragStartShare), width: toPercent(dragPlayedShare) }}
            aria-hidden="true"
          />
        )}
        {input.cuts.map((cut) => {
          const share = timeMsToProgress(input, cut.atMs);
          const alignment = share < LABEL_EDGE_SHARE ? "-translate-x-2.5" : share > 1 - LABEL_EDGE_SHARE ? "-translate-x-[calc(100%-10px)]" : "-translate-x-1/2";
          return (
            <span key={`${cut.cableName}-${cut.atMs}`} aria-hidden="true">
              <span
                className="absolute top-[13px] -ml-2.5 grid size-5 place-items-center rounded-full border-2 border-alarm bg-card"
                style={{ left: toPercent(share) }}
              >
                <span className="size-1.5 rounded-full bg-alarm" />
              </span>
              <span className={`absolute top-10 text-micro whitespace-nowrap text-alarm tabular-nums ${alignment}`} style={{ left: toPercent(share) }}>
                {cut.label}, {formatUtcClock(cut.atMs)}
              </span>
            </span>
          );
        })}
        <span
          className="absolute top-[13px] -ml-2.5 size-5 rounded-full border-2 border-ink bg-card shadow-selected peer-focus-visible:shadow-[0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-ink)]"
          style={{ left: toPercent(snapshot.progress) }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
