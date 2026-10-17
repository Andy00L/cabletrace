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
// Two cuts closer than this share of the width would have overlapping labels (Fitburg's two cables, 6 minutes
// apart): the earlier label then ends at its marker and the later one starts at its own.
const LABEL_CLUSTER_SHARE = 0.14;
const ALIGN_START = "-translate-x-2.5";
const ALIGN_END = "-translate-x-[calc(100%-10px)]";
const ALIGN_CENTER = "-translate-x-1/2";
// Labels of a close pair stand clear of the pair's 20 px markers, 4 px off each outer edge.
const ALIGN_AFTER_PAIR = "translate-x-3.5";
const ALIGN_BEFORE_PAIR = "-translate-x-[calc(100%+14px)]";
// Letting go of the scrubber this close to an event or a cut (share of the track) lands exactly on it, after
// bencho.dev's time-scrubber (MIT), which settles on the nearest step.
const SNAP_SHARE = 0.008;

type ReplayTimelineProps = {
  input: ReplaySceneInput;
  events: readonly TimelineEvent[];
  clock: ReplayClock;
  localTime: { place: string; timeZone: string };
  /** Opens a cut's card from its label under the track. */
  onCutSelect: (cutIndex: number, opener: HTMLElement) => void;
};

/** Where a cut's label sits relative to its marker, given every cut's position on the track. */
function alignCutLabel(shares: readonly number[], index: number): string {
  const share = shares[index] ?? 0;
  const isNear = (otherIndex: number) => otherIndex !== index && Math.abs((shares[otherIndex] ?? 0) - share) < LABEL_CLUSTER_SHARE;
  const isAfterCloseCut = shares.some((otherShare, otherIndex) => isNear(otherIndex) && (otherShare < share || (otherShare === share && otherIndex < index)));
  const isBeforeCloseCut = shares.some((otherShare, otherIndex) => isNear(otherIndex) && (otherShare > share || (otherShare === share && otherIndex > index)));
  if (isAfterCloseCut) return ALIGN_AFTER_PAIR;
  if (isBeforeCloseCut && share >= LABEL_EDGE_SHARE) return ALIGN_BEFORE_PAIR;
  if (share < LABEL_EDGE_SHARE) return ALIGN_START;
  return share > 1 - LABEL_EDGE_SHARE ? ALIGN_END : ALIGN_CENTER;
}

function toPercent(share: number): string {
  return `${(Math.min(1, Math.max(0, share)) * 100).toFixed(3)}%`;
}

/** Play, the clock in UTC with the local time under it, the track with the drag window, events and cuts. */
export function ReplayTransport({ input, clock, localTime }: Pick<ReplayTimelineProps, "input" | "clock" | "localTime">) {
  const snapshot = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const atMs = progressToTimeMs(input, snapshot.progress);
  return (
    <div className="flex flex-none items-center gap-3.5 lg:w-[270px]">
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-heading tabular-nums" data-testid="replay-clock">
          {formatUtcClock(atMs)} <span className="text-label text-muted">UTC</span>
        </p>
        <p className="truncate text-caption font-normal text-muted tabular-nums">
          {formatZonedDateTime(atMs, localTime.timeZone)} in {localTime.place}
        </p>
      </div>
    </div>
  );
}

/**
 * The scrubber. It is a native range input laid over the drawn track, so it keeps keyboard and screen reader
 * support; the drawn head shows its focus ring. Releasing it next to an event or a cut lands on that moment, and
 * each cut's label under the track opens the cut's card.
 */
export function ReplayTimeline({ input, events, clock, onCutSelect }: Omit<ReplayTimelineProps, "localTime">) {
  const snapshot = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const totalMinutes = Math.round((input.windowEndMs - input.windowStartMs) / MS_PER_MINUTE);
  const dragStartShare = input.dragWindow ? timeMsToProgress(input, input.dragWindow.startMs) : 0;
  const dragEndShare = input.dragWindow ? timeMsToProgress(input, input.dragWindow.endMs) : 0;
  const dragPlayedShare = Math.max(0, Math.min(snapshot.progress, dragEndShare) - dragStartShare);
  const cutShares = input.cuts.map((cut) => timeMsToProgress(input, cut.atMs));
  const snapShares = [...events.map((event) => timeMsToProgress(input, event.atMs)), ...cutShares];

  function snapToNearestMoment() {
    const progress = clock.getSnapshot().progress;
    const nearest = snapShares.reduce((best, share) => (Math.abs(share - progress) < Math.abs(best - progress) ? share : best), Number.POSITIVE_INFINITY);
    if (Math.abs(nearest - progress) <= SNAP_SHARE) clock.seek(nearest);
  }

  return (
    <div className="relative h-15 w-full min-w-0 flex-none lg:w-auto lg:flex-1">
      <input
        type="range"
        min={0}
        max={totalMinutes}
        step={1}
        value={Math.round(snapshot.progress * totalMinutes)}
        onChange={(event) => clock.seek(Number(event.target.value) / totalMinutes)}
        onPointerUp={snapToNearestMoment}
        aria-label="Replay time"
        aria-valuetext={`${formatUtcClock(progressToTimeMs(input, snapshot.progress))} UTC`}
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
        <span className="absolute top-5 h-1.5 rounded-full bg-alarm/22" style={{ left: toPercent(dragStartShare), width: toPercent(dragEndShare - dragStartShare) }} aria-hidden="true" />
      )}
      <span className="absolute top-5 left-0 h-1.5 rounded-full bg-ink" style={{ width: toPercent(snapshot.progress) }} aria-hidden="true" />
      {input.dragWindow && dragPlayedShare > 0 && (
        <span className="absolute top-5 h-1.5 rounded-full bg-alarm" style={{ left: toPercent(dragStartShare), width: toPercent(dragPlayedShare) }} aria-hidden="true" />
      )}
      {input.cuts.map((cut, index) => {
        const share = cutShares[index] ?? 0;
        const alignment = alignCutLabel(cutShares, index);
        return (
          <span key={`${cut.cableName}-${cut.atMs}`}>
            <span className="absolute top-[13px] -ml-2.5 grid size-5 place-items-center rounded-full border-2 border-alarm bg-card" style={{ left: toPercent(share) }} aria-hidden="true">
              <span className="size-1.5 rounded-full bg-alarm" />
            </span>
            <button
              type="button"
              onClick={(event) => onCutSelect(index, event.currentTarget)}
              className={`absolute top-9.5 rounded-chip px-1 py-0.5 text-micro whitespace-nowrap text-alarm tabular-nums transition-colors duration-140 ease-standard hover:bg-page ${alignment}`}
              style={{ left: toPercent(share) }}
              data-testid={`timeline-cut-${index}`}
            >
              {cut.label}, {formatUtcClock(cut.atMs)}
            </button>
          </span>
        );
      })}
      <span
        className="absolute top-[13px] -ml-2.5 size-5 rounded-full border-2 border-ink bg-card shadow-selected peer-focus-visible:shadow-[0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-ink)]"
        style={{ left: toPercent(snapshot.progress) }}
        aria-hidden="true"
      />
    </div>
  );
}
