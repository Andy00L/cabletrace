"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { Icon } from "@/components/icons/Icon";
import { formatCountdown, readMinutesToNextEvent } from "@/lib/console/event-countdown";
import { describeAnchorStatus } from "@/lib/replay/anchor-status";
import { progressToTimeMs } from "@/lib/replay/replay-scene";

/**
 * The anchor status at the top of the stage: a white pill saying what the anchor is doing and, while the replay plays,
 * how much replay time is left until the next event; pressed, it grows into
 * the latest event with its quote, then what the sources say about the drag itself, so that evidence is one press
 * away (after bencho.dev's dynamic-island, MIT: one shape grows, the content fades in). Re-renders only when the
 * status or the latest event changes, not on every frame.
 */
export function StatusIsland({ isCloseUp }: { isCloseUp: boolean }) {
  const { input, consoleCase, clock } = useConsole();
  const [isOpen, setIsOpen] = useState(false);
  const eventTimesMs = useMemo(() => consoleCase.events.map((event) => event.atMs), [consoleCase.events]);
  const readKey = () => {
    const snapshot = clock.getSnapshot();
    const atMs = progressToTimeMs(input, snapshot.progress);
    let latestIndex = -1;
    consoleCase.events.forEach((event, index) => {
      if (event.atMs <= atMs) latestIndex = index;
    });
    // Counts down only while playing: paused, the latest event and the status say enough.
    const minutesToNext = snapshot.isPlaying ? readMinutesToNextEvent(eventTimesMs, atMs) : null;
    return `${describeAnchorStatus(input, atMs).kind}|${latestIndex}|${minutesToNext ?? ""}`;
  };
  const key = useSyncExternalStore(clock.subscribe, readKey, readKey);
  const [statusKind, latestIndexText, minutesToNextText] = key.split("|");
  const atMs = progressToTimeMs(input, clock.getSnapshot().progress);
  const status = describeAnchorStatus(input, atMs);
  const latestEvent = consoleCase.events[Number(latestIndexText)] ?? null;
  const isDragging = statusKind === "dragging";
  const minutesToNext = minutesToNextText ? Number(minutesToNextText) : null;

  return (
    <div className={`pointer-events-none absolute left-4 z-(--layer-stage-controls) flex justify-center xl:top-4 xl:left-1/2 xl:-translate-x-1/2 ${isCloseUp ? "top-28" : "top-16"}`}>
      {/* One shape grows from pill to card: width and height transition between their auto sizes where the
          browser can (interpolate-size), and snap where it cannot; the corner radius follows. */}
      <div
        className={`pointer-events-auto flex w-max max-w-[min(380px,calc(100vw-48px))] flex-col overflow-hidden bg-card shadow-row transition-[width,height,border-radius] duration-220 ease-enter [interpolate-size:allow-keywords] ${isOpen ? "rounded-row" : "rounded-full"}`}
      >
        <button
          type="button"
          onClick={() => setIsOpen((wasOpen) => !wasOpen)}
          aria-expanded={isOpen}
          className="flex h-10 items-center gap-2.5 self-center pr-3.5 pl-4 text-small font-medium whitespace-nowrap text-ink"
          data-testid="replay-anchor-status"
          data-state={statusKind}
        >
          {isDragging && <span className="size-2 flex-none rounded-full bg-alarm" aria-hidden="true" />}
          <span aria-live="polite">{status.text}</span>
          {/* Read by eye, not announced: a live region ticking every replay minute would drown the status. Under
              640 px the pill has no room for both, and the status wins; the timeline sits right under the stage. */}
          {minutesToNext !== null && (
            <span className="hidden text-muted tabular-nums sm:inline" data-testid="event-countdown" data-minutes={minutesToNext}>
              next event {formatCountdown(minutesToNext)}
            </span>
          )}
          <Icon name="chevronDown" size={16} className={`flex-none text-muted transition-transform duration-220 ease-standard ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen && (
          <div className="flex max-h-[min(55svh,480px)] w-[340px] max-w-full animate-layer-enter flex-col gap-2.5 overflow-y-auto px-4 pt-1 pb-4">
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
            {consoleCase.dragCitations.length > 0 && (
              <div className="flex flex-col gap-2 pt-2" data-testid="anchor-drag-evidence">
                <p className="text-caption font-normal text-muted">How the drag is known</p>
                {consoleCase.dragCitations.map((citation, index) => (
                  <div key={`${citation.sourceId}-${index}`} className="flex flex-col gap-1 rounded-field bg-page px-3.5 py-3">
                    <p className="text-small">{citation.translation ?? citation.quote}</p>
                    {citation.translation && <p className="text-caption font-normal text-muted">{citation.quote}</p>}
                  </div>
                ))}
                <CitationButtons citations={consoleCase.dragCitations} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
