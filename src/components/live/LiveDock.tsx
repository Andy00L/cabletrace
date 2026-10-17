"use client";

import { useSyncExternalStore } from "react";
import type { FrameIndexEntry } from "@/lib/live/frame-layout";
import { formatUtcClock, formatUtcDate } from "@/lib/replay/format-utc";
import type { ReplayClock } from "@/lib/replay/replay-clock";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
// Hour labels every this many hours, so a day reads at a glance without crowding the track.
const LABEL_EVERY_HOURS = 3;

type LiveDockProps = {
  clock: ReplayClock;
  startMs: number;
  endMs: number;
  entries: readonly FrameIndexEntry[];
};

function toPercent(share: number): string {
  return `${(Math.min(1, Math.max(0, share)) * 100).toFixed(3)}%`;
}

/** Play and the clock, then the day as a scrubber: hour marks and one tick for each stored frame. */
export function LiveDock({ clock, startMs, endMs, entries }: LiveDockProps) {
  const snapshot = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const spanMs = Math.max(1, endMs - startMs);
  const atMs = startMs + snapshot.progress * spanMs;
  const totalMinutes = Math.max(1, Math.round(spanMs / MS_PER_MINUTE));
  const shareOf = (timeMs: number) => (timeMs - startMs) / spanMs;
  const firstHourMs = Math.ceil(startMs / MS_PER_HOUR) * MS_PER_HOUR;
  const hourMarks: number[] = [];
  for (let hourMs = firstHourMs; hourMs <= endMs; hourMs += MS_PER_HOUR) hourMarks.push(hourMs);
  return (
    <section aria-label="Timeline" className="flex flex-none flex-col gap-3 rounded-card bg-card px-5 py-4 shadow-card lg:flex-row lg:items-center lg:gap-6" data-testid="live-dock">
      <div className="flex flex-none items-center gap-3.5 lg:w-[250px]">
        <button
          type="button"
          onClick={clock.toggle}
          aria-label={snapshot.isPlaying ? "Pause the day" : "Play the day"}
          className="grid size-11 flex-none place-items-center rounded-full bg-ink transition-colors duration-140 ease-standard hover:bg-ink-hover active:scale-[0.97]"
          data-testid="live-play"
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
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-heading tabular-nums" data-testid="live-clock">
            {formatUtcClock(atMs)} <span className="text-label text-muted">UTC</span>
          </p>
          <p className="truncate text-caption font-normal text-muted tabular-nums">{formatUtcDate(atMs)}</p>
        </div>
      </div>
      <div className="relative h-12 w-full min-w-0 lg:flex-1">
        <input
          type="range"
          min={0}
          max={totalMinutes}
          step={1}
          value={Math.round(snapshot.progress * totalMinutes)}
          onChange={(event) => clock.seek(Number(event.target.value) / totalMinutes)}
          aria-label="Time of day"
          aria-valuetext={`${formatUtcClock(atMs)} UTC`}
          className="peer absolute inset-x-0 top-1 z-10 m-0 h-[30px] w-full cursor-pointer opacity-0"
          data-testid="live-scrubber"
        />
        <span className="absolute inset-x-0 top-[14px] h-1.5 rounded-full bg-soft" aria-hidden="true" />
        {entries.map((entry) => (
          <span key={entry.slotStartMs} className="absolute top-[14px] -ml-px h-1.5 w-0.5 bg-ship" style={{ left: toPercent(shareOf(entry.slotStartMs)) }} aria-hidden="true" />
        ))}
        <span className="absolute top-[14px] left-0 h-1.5 rounded-full bg-ink" style={{ width: toPercent(snapshot.progress) }} aria-hidden="true" />
        {hourMarks.map((hourMs) => {
          const hour = new Date(hourMs).getUTCHours();
          if (hour % LABEL_EVERY_HOURS !== 0) return null;
          return (
            <span key={hourMs} className="absolute top-7 -translate-x-1/2 text-micro font-normal text-faint tabular-nums" style={{ left: toPercent(shareOf(hourMs)) }} aria-hidden="true">
              {formatUtcClock(hourMs)}
            </span>
          );
        })}
        <span
          className="absolute top-[7px] -ml-2.5 size-5 rounded-full border-2 border-ink bg-card shadow-selected peer-focus-visible:shadow-[0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-ink)]"
          style={{ left: toPercent(snapshot.progress) }}
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
