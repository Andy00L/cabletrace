"use client";

import * as Popover from "@radix-ui/react-popover";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons/Icon";
import { LiveDock } from "@/components/live/LiveDock";
import { LiveGlobeStage, type WorldLinesState } from "@/components/live/LiveGlobeStage";
import { DetectionsCard, MomentCard, ShipCard, type DetailsState, type DetectionsState } from "@/components/live/LiveRail";
import { addFrameToCoverage, createCoverage, renderCoverageMask } from "@/lib/globe/coverage";
import { pairShipFrames } from "@/lib/globe/frame-pairing";
import type { FrameSource } from "@/lib/globe/frame-source";
import type { GlobeViewer } from "@/lib/globe/globe-viewer";
import { fetchShipDetails } from "@/lib/globe/live-api";
import { daySpan, locateMoment } from "@/lib/globe/live-day";
import type { WatchedLine } from "@/lib/globe/watched-line";
import type { GlobeLine } from "@/lib/globe/world-lines";
import type { FrameIndexEntry } from "@/lib/live/frame-layout";
import { readShipRecord, type ShipFrameColumns } from "@/lib/live/snapshot-codec";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { formatUtcClock } from "@/lib/replay/format-utc";
import { createReplayClock } from "@/lib/replay/replay-clock";

// A day plays in 72 seconds: an hour every 3 seconds, slow enough to follow a ship across a sea.
const DAY_PLAYBACK_SECONDS = 72;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// The rail floats over the stage's right edge from this width, as in the replay console.
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";
const RAIL_WIDTH_PX = 360;
const RAIL_INSET_PX = 16;
// Bit 7 of a ship's class byte marks a Digitraffic report (src/lib/live/snapshot-codec.ts).
const DIGITRAFFIC_FLAG = 0x80;
const CREDITS = [
  "Ships: aisstream.io (terrestrial AIS, kept two days) and Fintraffic / digitraffic.fi (CC BY 4.0).",
  "Land: Natural Earth 1:50m, public domain.",
  "Cables and pipelines of the world: OpenStreetMap contributors, Open Database License (ODbL). OpenStreetMap maps only part of the routes on the sea floor.",
  "The lines the replays watch: OpenStreetMap contributors (ODbL), pipelines from EMODnet Human Activities, one cable traced off a published map.",
] as const;

type MomentState = { frame: ShipFrameColumns; digitrafficCount: number } | null;

function matchesMedia(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

function countDigitraffic(frame: ShipFrameColumns): number {
  let count = 0;
  for (let index = 0; index < frame.shipCount; index += 1) if (((frame.classAndSource[index] ?? 0) & DIGITRAFFIC_FLAG) !== 0) count += 1;
  return count;
}

/** Index of an MMSI in a decoded frame (sorted by MMSI), or -1. */
function findInFrame(frame: ShipFrameColumns, mmsi: number): number {
  let low = 0;
  let high = frame.shipCount - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = frame.mmsi[middle] ?? 0;
    if (value === mmsi) return middle;
    if (value < mmsi) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

type LiveDayProps = {
  entries: FrameIndexEntry[];
  frameSource: FrameSource;
  watchedLines: readonly WatchedLine[];
  detectionsState: DetectionsState;
};

/**
 * One recorded day on the globe (the console shell of the replay: stage, floating rail, dock). Owns the day's clock;
 * as it moves, the frames on either side of the moment are loaded, paired ship by ship and blended on the GPU.
 */
export function LiveDay({ entries, frameSource, watchedLines, detectionsState }: LiveDayProps) {
  const { startMs, endMs } = daySpan(entries);
  const spanMs = endMs - startMs;
  const [clock] = useState(() => {
    const created = createReplayClock({
      durationSeconds: Math.max(1, (DAY_PLAYBACK_SECONDS * spanMs) / MS_PER_DAY),
      scheduler: { request: (callback) => window.requestAnimationFrame(callback), cancel: (handle) => window.cancelAnimationFrame(handle) },
    });
    // The day opens on its newest frame.
    created.seek(1);
    return created;
  });
  const [isWide, setIsWide] = useState(() => matchesMedia(WIDE_LAYOUT_QUERY));
  const [moment, setMoment] = useState<MomentState>(null);
  const [frameProblem, setFrameProblem] = useState<string | null>(null);
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [detailsState, setDetailsState] = useState<DetailsState>({ kind: "idle" });
  const viewerRef = useRef<GlobeViewer | null>(null);
  const pairRef = useRef<ReturnType<typeof pairShipFrames> | null>(null);
  const selectedRef = useRef<number | null>(null);
  // Where the feeds heard ships, grown from every frame this page decodes.
  const [coverage] = useState(createCoverage);
  const coverageMaskRef = useRef<Uint8Array | null>(null);
  const [coverageFrameCount, setCoverageFrameCount] = useState(0);
  const [globeLines, setGlobeLines] = useState<{ lines: GlobeLine[]; worldState: WorldLinesState }>({ lines: [], worldState: "loading" });
  const handleLinesChange = useCallback((lines: GlobeLine[], worldState: WorldLinesState) => setGlobeLines({ lines, worldState }), []);

  const readMinute = () => formatUtcClock(startMs + clock.getSnapshot().progress * spanMs);
  const minuteLabel = useSyncExternalStore(clock.subscribe, readMinute, readMinute);

  // Follows the layout breakpoint, a browser state React does not own.
  useEffect(() => {
    const media = window.matchMedia(WIDE_LAYOUT_QUERY);
    const update = () => setIsWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Stops the clock's frame loop when the page goes.
  useEffect(() => () => clock.dispose(), [clock]);

  // Syncs the globe with the clock, an external store: on every tick the blend moves; when the moment crosses into
  // another pair of frames, those are loaded (from the cache when possible), paired and handed to the viewer.
  useEffect(() => {
    let isDisposed = false;
    let appliedKey: string | null = null;
    let requestedKey: string | null = null;
    const currentMoment = () => locateMoment(entries, startMs + clock.getSnapshot().progress * spanMs);

    /** Counts a decoded frame into the coverage and redraws the hatching when it heard somewhere new. */
    function noteFrame(frame: ShipFrameColumns) {
      if (isDisposed || !addFrameToCoverage(coverage, frame)) return;
      const mask = renderCoverageMask(coverage);
      coverageMaskRef.current = mask;
      viewerRef.current?.setCoverage(mask);
      setCoverageFrameCount(coverage.frameTimes.size);
    }

    async function applyPair(earlierIndex: number, laterIndex: number | null, key: string) {
      const earlierEntry = entries[earlierIndex];
      const laterEntry = laterIndex === null ? undefined : entries[laterIndex];
      if (!earlierEntry) return;
      const [earlier, later] = await Promise.all([frameSource.loadFrame(earlierEntry), laterEntry ? frameSource.loadFrame(laterEntry) : Promise.resolve(null)]);
      if (isDisposed || requestedKey !== key) return;
      if (!earlier.ok) {
        console.error(`[LiveDay] ${earlier.reason}`);
        setFrameProblem("A frame of this moment could not be loaded. Move the timeline to try another.");
        requestedKey = null;
        return;
      }
      if (later && !later.ok) console.error(`[LiveDay] ${later.reason}`);
      noteFrame(earlier.value);
      if (later?.ok) noteFrame(later.value);
      const pair = pairShipFrames(earlier.value, later?.ok ? later.value : null);
      pairRef.current = pair;
      appliedKey = key;
      viewerRef.current?.setFramePair(pair);
      viewerRef.current?.setBlend(currentMoment().blend);
      setFrameProblem(null);
      setMoment({ frame: earlier.value, digitrafficCount: countDigitraffic(earlier.value) });
    }

    function update() {
      const located = currentMoment();
      const key = `${located.earlierIndex}:${located.laterIndex ?? "end"}`;
      if (key === appliedKey) viewerRef.current?.setBlend(located.blend);
      else if (key !== requestedKey) {
        requestedKey = key;
        void applyPair(located.earlierIndex, located.laterIndex, key);
      }
      // While the day plays, the frame after next downloads ahead of the moment that needs it.
      const nextEntry = located.laterIndex === null ? undefined : entries[located.laterIndex + 1];
      if (clock.getSnapshot().isPlaying && nextEntry) {
        void frameSource.loadFrame(nextEntry).then((outcome) => {
          if (outcome.ok) noteFrame(outcome.value);
        });
      }
    }

    const unsubscribe = clock.subscribe(update);
    update();
    return () => {
      isDisposed = true;
      unsubscribe();
    };
  }, [clock, coverage, entries, frameSource, startMs, spanMs]);

  // Looks up the selected ship's name and size, an outside service; a newer selection cancels an older answer.
  useEffect(() => {
    if (selectedMmsi === null) return;
    let isCurrent = true;
    void fetchShipDetails(selectedMmsi).then((outcome) => {
      if (!isCurrent) return;
      if (!outcome.ok) console.error(`[LiveDay] ${outcome.reason}`);
      setDetailsState(outcome.ok ? { kind: "loaded", details: outcome.value } : { kind: "failed" });
    });
    return () => {
      isCurrent = false;
    };
  }, [selectedMmsi]);

  const selectShip = useCallback((mmsi: number | null) => {
    selectedRef.current = mmsi;
    setSelectedMmsi(mmsi);
    setDetailsState(mmsi === null ? { kind: "idle" } : { kind: "loading" });
    viewerRef.current?.setSelectedShip(mmsi);
  }, []);

  const handleViewerChange = useCallback(
    (viewer: GlobeViewer | null) => {
      viewerRef.current = viewer;
      if (!viewer) return;
      viewer.setFramePair(pairRef.current);
      viewer.setBlend(locateMoment(entries, startMs + clock.getSnapshot().progress * spanMs).blend);
      viewer.setSelectedShip(selectedRef.current);
      viewer.setCoverage(coverageMaskRef.current);
    },
    [clock, entries, startMs, spanMs],
  );

  const focusDetection = useCallback(
    (mmsi: number) => {
      selectShip(mmsi);
      viewerRef.current?.focusShip(mmsi);
    },
    [selectShip],
  );

  const shipIndex = moment && selectedMmsi !== null ? findInFrame(moment.frame, selectedMmsi) : -1;
  const selectedRecord = moment && shipIndex !== -1 ? readShipRecord(moment.frame, shipIndex) : null;
  const rightInsetPx = isWide ? RAIL_WIDTH_PX + RAIL_INSET_PX : 0;

  const railCards = (
    <>
      <MomentCard minuteLabel={minuteLabel} shipCount={moment?.frame.shipCount ?? null} digitrafficCount={moment?.digitrafficCount ?? 0} />
      {selectedMmsi !== null && (
        <ShipCard
          mmsi={selectedMmsi}
          record={selectedRecord}
          frameTimeMs={moment?.frame.frameTimeMs ?? null}
          detailsState={detailsState}
          onFocus={() => viewerRef.current?.focusShip(selectedMmsi)}
          onClose={() => selectShip(null)}
        />
      )}
      <DetectionsCard state={detectionsState} onSelect={focusDetection} />
    </>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 sm:px-6 ${isWide ? "" : "overflow-y-auto"}`}>
      <section
        aria-label="Globe of the recorded day"
        className={`relative overflow-hidden rounded-card bg-soft shadow-card ${isWide ? "min-h-0 flex-1" : "h-[56svh] min-h-[320px] flex-none"}`}
        data-testid="live-globe"
        data-frame-count={entries.length}
        data-ship-count={moment?.frame.shipCount ?? 0}
      >
        <LiveGlobeStage watchedLines={watchedLines} rightInsetPx={rightInsetPx} onViewerChange={handleViewerChange} onShipPick={selectShip} onLinesChange={handleLinesChange} />
        <div className="pointer-events-none absolute top-4 left-4 z-(--layer-stage-controls) flex max-w-[calc(100%-32px)] flex-col items-start gap-2">
          <p className="rounded-full bg-card px-4 py-2 text-label shadow-row">A recorded day of ships, not real time</p>
          {frameProblem && (
            <p className="rounded-row bg-card px-4 py-2 text-small shadow-row" role="status">
              {frameProblem}
            </p>
          )}
        </div>
        <div className="absolute bottom-4 left-4 z-(--layer-stage-controls) flex items-center gap-2">
          <div className="hidden items-center gap-x-4 rounded-field bg-card px-3.5 py-2.5 text-micro shadow-row md:flex">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-ship" aria-hidden="true" />
              Ship
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
                <path d="M1 4 H21" stroke="var(--color-cable)" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              Cable
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
                <path d="M1 4 H21" stroke="var(--color-pipeline)" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Pipeline
            </span>
            <span className="inline-flex items-center gap-1.5" data-testid="live-coverage-legend">
              <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" className="rounded-[3px]">
                <rect width="18" height="12" fill={WEBGL_COLORS.depth40} />
                <path d="M-3 9 L6 0 M4 13 L17 0 M11 13 L21 3" stroke={WEBGL_COLORS.depthDeep} strokeWidth="1.2" />
              </svg>
              No feed hears this sea
            </span>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="text-muted underline decoration-faint underline-offset-4 hover:text-ink">
              Lines &copy; OpenStreetMap
            </a>
          </div>
          <Popover.Root>
            <Popover.Trigger
              aria-label="How the globe is drawn and data credits"
              className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised data-[state=open]:shadow-selected"
              data-testid="live-credits"
            >
              <Icon name="info" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="top"
                align="start"
                sideOffset={10}
                collisionPadding={16}
                className="z-(--layer-popover) flex w-[400px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-row bg-card p-5 shadow-popover outline-none data-[state=closed]:animate-layer-exit data-[state=open]:animate-layer-enter"
              >
                <p className="text-label">How the globe is drawn</p>
                <p className="text-small">
                  A frame every 10 minutes holds every ship the feeds heard in it. Between two frames each ship moves in a straight line from one
                  report to the next, and a ship that leaves a frame fades out. A move faster than 50 knots is drawn as a jump: a bad position or a
                  reused identity, not a voyage.
                </p>
                <p className="text-small">
                  Hatched sea: no ship heard within about 55 km in the <span className="tabular-nums">{coverageFrameCount}</span>{" "}
                  {coverageFrameCount === 1 ? "frame" : "frames"} loaded so far. The feeds are coastal receivers, so a ship out there goes unseen; the sea
                  is not empty.
                </p>
                {globeLines.worldState === "failed" && (
                  <p className="text-small" role="status">
                    The world&apos;s cables did not load; only the lines the replays watch are drawn.
                  </p>
                )}
                <ul className="flex flex-col gap-1.5 text-caption font-normal text-muted">
                  {CREDITS.map((credit) => (
                    <li key={credit}>{credit}</li>
                  ))}
                </ul>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <div className="absolute bottom-4 z-(--layer-stage-controls) flex gap-0.5 rounded-full bg-card p-1 shadow-row" style={{ right: isWide ? RAIL_WIDTH_PX + RAIL_INSET_PX * 2 : 16 }}>
          <button
            type="button"
            onClick={() => viewerRef.current?.resetView()}
            aria-label="Reset the view"
            className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]"
          >
            <Icon name="reset" />
          </button>
        </div>
        {isWide && (
          // The rail scrolls as a whole when the ship card and the detections outgrow the stage's height.
          <div
            className="absolute top-4 right-4 bottom-4 z-(--layer-panel) flex flex-col gap-3 overflow-y-auto rounded-row [scrollbar-width:thin]"
            style={{ width: RAIL_WIDTH_PX }}
            data-overlays-stage="true"
          >
            <div className="flex flex-none flex-col gap-3">{railCards}</div>
          </div>
        )}
      </section>
      <LiveDock clock={clock} startMs={startMs} endMs={endMs} entries={entries} />
      {!isWide && <div className="flex flex-col gap-3">{railCards}</div>}
    </div>
  );
}
