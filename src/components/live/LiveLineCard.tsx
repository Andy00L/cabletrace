"use client";

import { useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { useScrollSelectedIntoView } from "@/components/live/scroll-selected-into-view";
import { PASSAGE_DISTANCE_KM, type LinePassage } from "@/lib/globe/line-passages";
import { describeGlobeLine, describeGlobeLineKind, type GlobeLine } from "@/lib/globe/world-lines";
import { formatUtcClock } from "@/lib/replay/format-utc";

const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";
// Rows shown before the rest fold into a count, so a busy strait does not push the rail into a long scroll.
const MAX_ROWS = 40;
const BYTES_PER_MEGABYTE = 1_000_000;

export type LineScanState = {
  passages: LinePassage[];
  /** Frames of the day already checked, and how many the day holds. */
  framesChecked: number;
  frameCount: number;
  /** Compressed size of the frames not checked yet. */
  uncheckedBytes: number;
  /** While the rest of the day downloads: how many of the missing frames arrived. */
  progress: { done: number; total: number } | null;
};

type LiveLineCardProps = {
  line: GlobeLine;
  scan: LineScanState;
  shipNames: ReadonlyMap<number, string>;
  selectedMmsi: number | null;
  onCheckDay: () => void;
  onSelectPassage: (passage: LinePassage) => void;
  onClose: () => void;
};

function describePassage(passage: LinePassage): string {
  if (passage.crossedAtMs !== null) return `Crossed at ${formatUtcClock(passage.crossedAtMs)} UTC`;
  return `${passage.closestKm.toFixed(1)} km off at ${formatUtcClock(passage.closestAtMs)} UTC`;
}

/** A clicked cable or pipeline: who crossed it, or came within the recorder's distance, in the frames checked so far. */
export function LiveLineCard({ line, scan, shipNames, selectedMmsi, onCheckDay, onSelectPassage, onClose }: LiveLineCardProps) {
  const listRef = useRef<HTMLOListElement>(null);
  useScrollSelectedIntoView(listRef, selectedMmsi);
  const crossedCount = scan.passages.filter((passage) => passage.crossedAtMs !== null).length;
  const nearCount = scan.passages.length - crossedCount;
  const details = [describeGlobeLineKind(line), line.operator].filter((detail): detail is string => detail !== null).join(", ");
  return (
    <section className={CARD_CLASS} aria-label="Selected line" data-testid="live-line-card" data-line-id={line.id} data-passage-count={scan.passages.length}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-card-title">{describeGlobeLine(line)}</h2>
          <p className="text-caption font-normal text-muted">
            {details}
            {line.isWatched ? ". Watched by the replays" : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the line card" className="ml-auto grid size-9 flex-none place-items-center rounded-full text-muted transition-colors duration-140 ease-standard hover:bg-page hover:text-ink">
          <Icon name="close" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-display tabular-nums">{crossedCount}</p>
          <p className="text-small text-muted">{crossedCount === 1 ? "ship crossed it" : "ships crossed it"}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-display tabular-nums">{nearCount}</p>
          <p className="text-small text-muted">more within {PASSAGE_DISTANCE_KM} km</p>
        </div>
      </div>
      <p className="text-caption font-normal text-muted">
        Checked <span className="tabular-nums">{scan.framesChecked}</span> of the day&apos;s <span className="tabular-nums">{scan.frameCount}</span> frames. Between two frames a ship
        sails straight, as the globe draws it.
      </p>
      {scan.framesChecked < scan.frameCount && (
        <button
          type="button"
          onClick={onCheckDay}
          disabled={scan.progress !== null}
          className="flex h-10 items-center justify-center gap-1.5 self-start rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page disabled:text-faint"
          data-testid="live-line-check-day"
        >
          {scan.progress === null ? (
            <>
              Check the whole day, about <span className="tabular-nums">{Math.max(0.1, scan.uncheckedBytes / BYTES_PER_MEGABYTE).toFixed(1)}</span> MB
            </>
          ) : (
            <span className="tabular-nums" aria-live="polite">
              Checking {scan.progress.done} of {scan.progress.total} frames
            </span>
          )}
        </button>
      )}
      {scan.passages.length === 0 ? (
        <p className="text-small text-muted">No ship crossed it or came within {PASSAGE_DISTANCE_KM} km in the frames checked.</p>
      ) : (
        <ol ref={listRef} className="-mx-2 flex flex-col gap-0.5" data-testid="live-line-passages">
          {scan.passages.slice(0, MAX_ROWS).map((passage) => {
            const isSelected = passage.mmsi === selectedMmsi;
            return (
              <li key={passage.mmsi}>
                <button
                  type="button"
                  onClick={() => onSelectPassage(passage)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`flex w-full items-center gap-2 rounded-field px-2 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-page ${isSelected ? "bg-page" : ""}`}
                  data-testid={`live-line-passage-${passage.mmsi}`}
                >
                  <span className={`size-2 flex-none rounded-full ${passage.crossedAtMs !== null ? "bg-ink" : "bg-ship"}`} aria-hidden="true" />
                  <span className="min-w-0 truncate text-label">{shipNames.get(passage.mmsi) ?? `MMSI ${passage.mmsi}`}</span>
                  <span className="ml-auto flex-none text-caption font-normal text-muted tabular-nums">{describePassage(passage)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {scan.passages.length > MAX_ROWS && (
        <p className="text-caption font-normal text-muted">
          And <span className="tabular-nums">{scan.passages.length - MAX_ROWS}</span> more within {PASSAGE_DISTANCE_KM} km.
        </p>
      )}
    </section>
  );
}
