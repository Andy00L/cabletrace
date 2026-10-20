"use client";

import * as Popover from "@radix-ui/react-popover";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { LiveDock } from "@/components/live/LiveDock";
import { LiveGlobeStage, type WorldLinesState } from "@/components/live/LiveGlobeStage";
import { DraftCasesCard, type DraftCasesState } from "@/components/live/LiveDraftCases";
import { IncidentCard, IncidentsCard } from "@/components/live/LiveIncidents";
import { LiveLineCard, type LineScanState } from "@/components/live/LiveLineCard";
import { DetectionsCard, MomentCard, ShipCard, type DetailsState, type DetectionsState } from "@/components/live/LiveRail";
import { BusiestSeasCard, SeaCard, TierBreadcrumb, TierLadder, type Crumb } from "@/components/live/LiveTiers";
import { addFrameToCoverage, createCoverage, renderCoverageMask } from "@/lib/globe/coverage";
import { findFaultRipples, type FaultRipple } from "@/lib/globe/fault-ripples";
import { pairShipFrames } from "@/lib/globe/frame-pairing";
import type { FrameSource } from "@/lib/globe/frame-source";
import { isGlobeTier, TIER_CAMERA_DISTANCE, type DistanceTier, type GlobeTier, type WatchedRegionOutline } from "@/lib/globe/globe-tier";
import type { GlobePick, GlobeSeaLabel, GlobeView, GlobeViewer } from "@/lib/globe/globe-viewer";
import type { GlobeIncident } from "@/lib/globe/incidents";
import { addFrameToPassageScan, createPassageScan, summarizePassages, type LinePassage, type PassageScan } from "@/lib/globe/line-passages";
import { fetchShipDetails, fetchShipDetailsBatch, type DetectionSummary } from "@/lib/globe/live-api";
import { daySpan, locateMoment } from "@/lib/globe/live-day";
import { countShipsBySea, countShipsInBoxes, findSeaIndex, measureSeaShare, parseSeaAreas, rankSeasByShips, type SeaArea, type SeaAreas, type SeaCount } from "@/lib/globe/sea-areas";
import { binShipDensity, type ShipDensity } from "@/lib/globe/ship-density";
import { fetchStaticJson } from "@/lib/globe/static-file";
import { warmCaseArea } from "@/lib/seabed/warm-area";
import type { WatchedLine } from "@/lib/globe/watched-line";
import type { GlobeLine } from "@/lib/globe/world-lines";
import type { FrameIndexEntry } from "@/lib/live/frame-layout";
import { readShipRecord, type ShipFrameColumns } from "@/lib/live/snapshot-codec";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { formatUtcClock } from "@/lib/replay/format-utc";
import { createReplayClock } from "@/lib/replay/replay-clock";
import { isInsideBox } from "@/lib/regions/region";

// A day plays in 72 seconds: an hour every 3 seconds, slow enough to follow a ship across a sea.
const DAY_PLAYBACK_SECONDS = 72;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60_000;
// The rail floats over the stage's right edge from this width, as in the replay console.
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";
const RAIL_WIDTH_PX = 360;
const RAIL_INSET_PX = 16;
// Bit 7 of a ship's class byte marks a Digitraffic report (src/lib/live/snapshot-codec.ts).
const DIGITRAFFIC_FLAG = 0x80;
// The rest of the day downloads this many frames at a time when a line's whole day is checked.
const DAY_CHECK_CONCURRENCY = 4;
// A line's passages are summed up at most this often while frames arrive (ms).
const PASSAGE_PUBLISH_INTERVAL_MS = 250;
// The crossfade from the globe into the case console (docs/UI_DESIGN_SYSTEM.md, Motion; sourceRef src/app/globals.css):
// the console enters over duration-hero with ease-enter and an 8 px rise, the globe leaves 20% faster with ease-exit
// while it keeps pushing in a little, as if the camera went on down.
const DIVE_ENTER_MS = 480;
const DIVE_EXIT_MS = 384;
const EASE_ENTER = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_EXIT = "cubic-bezier(0.4, 0, 1, 1)";
const DIVE_RISE_PX = 8;
const DIVE_PUSH_SCALE = 1.04;
// The globe's snapshot takes this name for the crossfade, so it can leave on its own while the page around it,
// the same section bar on both pages, crossfades in place.
const DIVE_SNAPSHOT_NAME = "live-globe";
// The page holds its last frame while the case console renders; past this the crossfade starts on whatever is there
// (Chromium gives up on a view transition whose update takes much longer).
const DIVE_RENDER_WAIT_MS = 2500;
const DIVE_POLL_MS = 40;

/** Resolves once the case console at `path` is in the document and visible, or after DIVE_RENDER_WAIT_MS. */
function waitForCaseConsole(path: string): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      // Pages left behind stay mounted but hidden (cacheComponents), so only a visible console counts.
      const isShown = [...document.querySelectorAll('[data-testid="replay-console"]')].some((element) => element.checkVisibility());
      if ((window.location.pathname === path && isShown) || performance.now() - startedAt > DIVE_RENDER_WAIT_MS) resolve();
      else window.setTimeout(check, DIVE_POLL_MS);
    };
    check();
  });
}

/**
 * Opens a case behind a same-document view transition: the globe's last frame pushes in and fades while the case
 * console rises in under it, so there is no hard cut. Without the View Transitions API the case simply opens.
 * Resolves when the crossfade is over.
 */
function crossfadeIntoCase(navigate: () => void, path: string, globeElement: HTMLElement | null): Promise<void> {
  if (typeof document.startViewTransition !== "function") {
    navigate();
    return Promise.resolve();
  }
  const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (globeElement) globeElement.style.viewTransitionName = DIVE_SNAPSHOT_NAME;
  const transition = document.startViewTransition(async () => {
    if (globeElement) globeElement.style.viewTransitionName = "";
    navigate();
    await waitForCaseConsole(path);
  });
  transition.ready
    .then(() => {
      document.documentElement.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: isReduced ? "scale(1)" : `scale(${DIVE_PUSH_SCALE})` },
        ],
        { duration: DIVE_EXIT_MS, easing: EASE_EXIT, fill: "forwards", pseudoElement: `::view-transition-old(${DIVE_SNAPSHOT_NAME})` },
      );
      document.documentElement.animate(
        [
          { opacity: 0, transform: isReduced ? "none" : `translateY(${DIVE_RISE_PX}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: DIVE_ENTER_MS, easing: EASE_ENTER, fill: "both", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch((error: unknown) => console.error(`[crossfadeIntoCase] ${error instanceof Error ? error.message : String(error)}`));
  // A skipped transition rejects `ready` (logged above); the navigation itself still happened.
  return transition.finished.catch(() => undefined);
}

// A row of the incident list flies the camera this far from the centre: about 1,900 km up, the sea around the cut in view.
const INCIDENT_FOCUS_DISTANCE = 1.3;
// The named seas of the Planet and Sea tiers, built by scripts/globe/build-seas.ts.
const SEAS_URL = "/globe/seas.json";
// The globe names at most this many seas at the Planet tier, busiest first; the label placer drops the ones that collide.
const SEA_LABEL_COUNT = 30;
// The Ship tier flies this close to the picked ship, about 250 km up.
const SHIP_TIER_DISTANCE = 1.04;
// A hop between tiers takes as long as a flight to a ship (FOCUS_MOVE_MS, src/lib/globe/globe-viewer.ts).
const TIER_MOVE_MS = 900;
// A watched region is listed under every sea holding at least a fifth of its box (the Danish straits under the Baltic
// and the North Sea alike).
const REGION_SEA_SHARE = 0.2;
// The address keeps the tier and the centre, so a shared link reopens the same view ("?tier=sea&at=20.63,59.63").
const TIER_PARAM = "tier";
const AT_PARAM = "at";

/** Where the camera is: its tier, the named sea under the stage's centre (-1 inland) and the watched region there. */
type GlobePlace = { tier: DistanceTier; seaIndex: number; regionId: string | null };

function readPlace(view: GlobeView, areas: SeaAreas | null, regions: readonly WatchedRegionOutline[]): GlobePlace {
  return {
    tier: view.tier,
    seaIndex: areas ? findSeaIndex(areas, view.longitude, view.latitude) : -1,
    regionId: regions.find((region) => isInsideBox(region.box, view.longitude, view.latitude))?.id ?? null,
  };
}

/** "20.63,59.63" from the address, or null when absent or malformed. */
function parseCentreParam(value: string | null): { longitude: number; latitude: number } | null {
  const [longitude, latitude] = (value ?? "").split(",").map(Number);
  if (longitude === undefined || latitude === undefined || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return { longitude, latitude };
}

/** The sea whose label point lies nearest a point (great-circle), for a Sea hop from over land. */
function findNearestSea(areas: SeaAreas, point: { longitude: number; latitude: number }): SeaArea | undefined {
  const radiansPerDegree = Math.PI / 180;
  const pointLatitude = point.latitude * radiansPerDegree;
  let nearest: { sea: SeaArea; cosine: number } | undefined;
  for (const sea of areas.seas) {
    const seaLatitude = sea.latitude * radiansPerDegree;
    const cosine = Math.sin(pointLatitude) * Math.sin(seaLatitude) + Math.cos(pointLatitude) * Math.cos(seaLatitude) * Math.cos((sea.longitude - point.longitude) * radiansPerDegree);
    if (!nearest || cosine > nearest.cosine) nearest = { sea, cosine };
  }
  return nearest?.sea;
}

function boxCentre(region: WatchedRegionOutline): { longitude: number; latitude: number } {
  return { longitude: (region.box.west + region.box.east) / 2, latitude: (region.box.south + region.box.north) / 2 };
}
const CREDITS = [
  "Ships: aisstream.io (terrestrial AIS, kept two days) and Fintraffic / digitraffic.fi (CC BY 4.0).",
  "Land and the named seas: Natural Earth 1:50m land and marine areas, public domain.",
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
  /** Outlined from the Sea tier down; the Strait tier is named after the one under the camera. */
  watchedRegions: readonly WatchedRegionOutline[];
  incidents: readonly GlobeIncident[];
  detectionsState: DetectionsState;
  draftCasesState: DraftCasesState;
  /** Whether the two feeds agree where both cover a region, shown in the moment card. */
  feedCheck: ReactNode;
};

/**
 * One recorded day on the globe (the console shell of the replay: stage, floating rail, dock). Owns the day's clock;
 * as it moves, the frames on either side of the moment are loaded, paired ship by ship and blended on the GPU.
 */
export function LiveDay({ entries, frameSource, watchedLines, watchedRegions, incidents, detectionsState, draftCasesState, feedCheck }: LiveDayProps) {
  const router = useRouter();
  const [divingSlug, setDivingSlug] = useState<string | null>(null);
  // The globe's box, which takes a view-transition name for the dive's crossfade.
  const globeHostRef = useRef<HTMLDivElement>(null);
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
  const [selectedIncidentSlug, setSelectedIncidentSlug] = useState<string | null>(null);
  const selectedIncidentRef = useRef<string | null>(null);
  // The clicked cable or pipeline and who passed it in the frames checked so far.
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [lineScan, setLineScan] = useState<LineScanState | null>(null);
  const lineScanRef = useRef<PassageScan | null>(null);
  const lineProgressRef = useRef<LineScanState["progress"]>(null);
  const publishTimerRef = useRef<number | null>(null);
  const [shipNames, setShipNames] = useState<ReadonlyMap<number, string>>(() => new Map());
  const requestedNamesRef = useRef(new Set<number>());
  // A ship to fly to once the frames of the moment it was picked at are on the globe.
  const pendingFocusRef = useRef<number | null>(null);
  const pairKeysRef = useRef<{ applied: string | null; requested: string | null }>({ applied: null, requested: null });
  // The tiers: the named seas once their file lands, where the camera is, and whether the Ship tier was asked for.
  const [seaAreas, setSeaAreas] = useState<SeaAreas | null>(null);
  const seaAreasRef = useRef<SeaAreas | null>(null);
  const [place, setPlace] = useState<GlobePlace>({ tier: "planet", seaIndex: -1, regionId: null });
  const lastViewRef = useRef<GlobeView | null>(null);
  const [isOnShip, setIsOnShip] = useState(false);
  // What the globe last got, handed again to a rebuilt viewer.
  const densityRef = useRef<ShipDensity | null>(null);
  const seaLabelsRef = useRef<readonly GlobeSeaLabel[]>([]);
  const ripplesRef = useRef<readonly FaultRipple[]>([]);

  // Line ids are positions in the list, so a new list (the world's lines arriving) closes any open line card.
  const handleLinesChange = useCallback((lines: GlobeLine[], worldState: WorldLinesState) => {
    setGlobeLines({ lines, worldState });
    lineScanRef.current = null;
    lineProgressRef.current = null;
    setSelectedLineId(null);
    setLineScan(null);
    viewerRef.current?.setSelectedLine(null);
  }, []);

  /** Flies to the pending ship when the pair on the globe is the one for the current moment and holds it. */
  const focusPendingShip = useCallback(() => {
    const mmsi = pendingFocusRef.current;
    if (mmsi === null || pairKeysRef.current.applied !== pairKeysRef.current.requested) return;
    if (viewerRef.current?.focusShip(mmsi)) pendingFocusRef.current = null;
  }, []);

  /** Sums up the selected line's passages now, then asks a feed for the names it does not know yet. */
  const publishLineScan = useCallback(() => {
    publishTimerRef.current = null;
    const scan = lineScanRef.current;
    if (!scan) return;
    const passages = summarizePassages(scan);
    const uncheckedBytes = entries.reduce((sum, entry) => sum + (frameSource.peekFrame(entry) === null ? entry.bytes : 0), 0);
    setLineScan({ passages, framesChecked: scan.frameTimes.size, frameCount: entries.length, uncheckedBytes, progress: lineProgressRef.current });
    const unnamed = passages.map((passage) => passage.mmsi).filter((mmsi) => !requestedNamesRef.current.has(mmsi));
    if (unnamed.length === 0) return;
    unnamed.forEach((mmsi) => requestedNamesRef.current.add(mmsi));
    void fetchShipDetailsBatch(unnamed).then((outcome) => {
      if (!outcome.ok) {
        console.error(`[LiveDay] ${outcome.reason}`);
        return;
      }
      setShipNames((known) => {
        const next = new Map(known);
        outcome.value.forEach((details, mmsi) => {
          if (details.name !== null) next.set(mmsi, details.name);
        });
        return next;
      });
    });
  }, [entries, frameSource]);

  const schedulePublish = useCallback(() => {
    if (publishTimerRef.current === null) publishTimerRef.current = window.setTimeout(publishLineScan, PASSAGE_PUBLISH_INTERVAL_MS);
  }, [publishLineScan]);

  /** Counts a decoded frame into the coverage and into the selected line's scan. */
  const noteFrame = useCallback(
    (frame: ShipFrameColumns) => {
      if (lineScanRef.current && addFrameToPassageScan(lineScanRef.current, frame)) schedulePublish();
      if (!addFrameToCoverage(coverage, frame)) return;
      const mask = renderCoverageMask(coverage);
      coverageMaskRef.current = mask;
      viewerRef.current?.setCoverage(mask);
      setCoverageFrameCount(coverage.frameTimes.size);
    },
    [coverage, schedulePublish],
  );

  // Cancels a pending passage summary when the page goes.
  useEffect(
    () => () => {
      if (publishTimerRef.current !== null) window.clearTimeout(publishTimerRef.current);
    },
    [],
  );

  const readMinute = () => formatUtcClock(startMs + clock.getSnapshot().progress * spanMs);
  const minuteLabel = useSyncExternalStore(clock.subscribe, readMinute, readMinute);
  // The moment to the minute, so the ship card's report age updates once a minute of the day, not every frame.
  const readMomentMinuteMs = () => Math.floor((startMs + clock.getSnapshot().progress * spanMs) / MS_PER_MINUTE) * MS_PER_MINUTE;
  const momentMinuteMs = useSyncExternalStore(clock.subscribe, readMomentMinuteMs, readMomentMinuteMs);

  // Follows the layout breakpoint, a browser state React does not own.
  useEffect(() => {
    const media = window.matchMedia(WIDE_LAYOUT_QUERY);
    const update = () => setIsWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Stops the clock's frame loop when the page goes.
  useEffect(() => () => clock.dispose(), [clock]);

  // Downloads the named seas, a static file; without it the tiers still work, the seas just go unnamed and uncounted.
  useEffect(() => {
    let isCurrent = true;
    void fetchStaticJson(SEAS_URL).then((downloaded) => {
      const parsed = downloaded.ok ? parseSeaAreas(downloaded.value) : downloaded;
      if (!isCurrent) return;
      if (!parsed.ok) {
        console.error(`[LiveDay] ${parsed.reason}`);
        return;
      }
      seaAreasRef.current = parsed.value;
      setSeaAreas(parsed.value);
      const lastView = lastViewRef.current;
      if (lastView) setPlace(readPlace(lastView, parsed.value, watchedRegions));
    });
    return () => {
      isCurrent = false;
    };
  }, [watchedRegions]);

  // Syncs the globe with the clock, an external store: on every tick the blend moves; when the moment crosses into
  // another pair of frames, those are loaded (from the cache when possible), paired and handed to the viewer.
  useEffect(() => {
    let isDisposed = false;
    const keys = pairKeysRef.current;
    keys.applied = null;
    keys.requested = null;
    const currentMoment = () => locateMoment(entries, startMs + clock.getSnapshot().progress * spanMs);

    async function applyPair(earlierIndex: number, laterIndex: number | null, key: string) {
      const earlierEntry = entries[earlierIndex];
      const laterEntry = laterIndex === null ? undefined : entries[laterIndex];
      if (!earlierEntry) return;
      const [earlier, later] = await Promise.all([frameSource.loadFrame(earlierEntry), laterEntry ? frameSource.loadFrame(laterEntry) : Promise.resolve(null)]);
      if (isDisposed || keys.requested !== key) return;
      if (!earlier.ok) {
        console.error(`[LiveDay] ${earlier.reason}`);
        setFrameProblem("A frame of this moment could not be loaded. Move the timeline to try another.");
        keys.requested = null;
        return;
      }
      if (later && !later.ok) console.error(`[LiveDay] ${later.reason}`);
      noteFrame(earlier.value);
      if (later?.ok) noteFrame(later.value);
      const pair = pairShipFrames(earlier.value, later?.ok ? later.value : null);
      pairRef.current = pair;
      keys.applied = key;
      viewerRef.current?.setFramePair(pair);
      viewerRef.current?.setBlend(currentMoment().blend);
      focusPendingShip();
      setFrameProblem(null);
      setMoment({ frame: earlier.value, digitrafficCount: countDigitraffic(earlier.value) });
    }

    function update() {
      const located = currentMoment();
      const key = `${located.earlierIndex}:${located.laterIndex ?? "end"}`;
      if (key === keys.applied) viewerRef.current?.setBlend(located.blend);
      else if (key !== keys.requested) {
        keys.requested = key;
        void applyPair(located.earlierIndex, located.laterIndex, key);
      }
      // While the day plays, the frame after next downloads ahead of the moment that needs it.
      const nextEntry = located.laterIndex === null ? undefined : entries[located.laterIndex + 1];
      if (clock.getSnapshot().isPlaying && nextEntry) {
        void frameSource.loadFrame(nextEntry).then((outcome) => {
          if (outcome.ok && !isDisposed) noteFrame(outcome.value);
        });
      }
    }

    const unsubscribe = clock.subscribe(update);
    update();
    return () => {
      isDisposed = true;
      unsubscribe();
    };
  }, [clock, entries, focusPendingShip, frameSource, noteFrame, startMs, spanMs]);

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
      viewer.setSelectedLine(lineScanRef.current?.lineId ?? null);
      viewer.setIncidents(incidents);
      viewer.setSelectedIncident(selectedIncidentRef.current);
      viewer.setDensity(densityRef.current);
      viewer.setSeaLabels(seaLabelsRef.current);
      viewer.setRegionOutlines(watchedRegions.map((region) => region.box));
      viewer.setRipples(ripplesRef.current);
      // A link with a tier reopens that view without a flight.
      const params = new URLSearchParams(window.location.search);
      const tierParam = params.get(TIER_PARAM);
      const centre = parseCentreParam(params.get(AT_PARAM));
      if (centre && isGlobeTier(tierParam) && tierParam !== "ship") void viewer.flyTo({ ...centre, distance: TIER_CAMERA_DISTANCE[tierParam], isJump: true });
    },
    [clock, entries, incidents, startMs, spanMs, watchedRegions],
  );

  /** Called after every frame the camera moved in: sets state only when the tier, the sea or the region changes. */
  const handleViewChange = useCallback(
    (view: GlobeView) => {
      lastViewRef.current = view;
      const nextPlace = readPlace(view, seaAreasRef.current, watchedRegions);
      setPlace((previous) => (previous.tier === nextPlace.tier && previous.seaIndex === nextPlace.seaIndex && previous.regionId === nextPlace.regionId ? previous : nextPlace));
    },
    [watchedRegions],
  );

  // Keeps the tier and the centre in the address, the browser history React does not own, so a link reopens the view.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const url = new URL(window.location.href);
    if (place.tier === "planet") {
      url.searchParams.delete(TIER_PARAM);
      url.searchParams.delete(AT_PARAM);
    } else {
      const centre = viewer.readCentre();
      url.searchParams.set(TIER_PARAM, place.tier);
      url.searchParams.set(AT_PARAM, `${centre.longitude.toFixed(2)},${centre.latitude.toFixed(2)}`);
    }
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [place]);

  /** Opens a line's card and checks every frame already decoded for ships that crossed or neared it. */
  const selectLine = useCallback(
    (lineId: number | null) => {
      setSelectedLineId(lineId);
      viewerRef.current?.setSelectedLine(lineId);
      lineProgressRef.current = null;
      const line = lineId === null ? undefined : globeLines.lines.find((candidate) => candidate.id === lineId);
      if (!line) {
        lineScanRef.current = null;
        setLineScan(null);
        return;
      }
      const scan = createPassageScan(line);
      lineScanRef.current = scan;
      entries.forEach((entry) => {
        const frame = frameSource.peekFrame(entry);
        if (frame) addFrameToPassageScan(scan, frame);
      });
      publishLineScan();
    },
    [entries, frameSource, globeLines.lines, publishLineScan],
  );

  /** Downloads every frame of the day not decoded yet, a few at a time, so the line's scan covers the whole day. */
  const checkLineDay = useCallback(async () => {
    const scan = lineScanRef.current;
    if (!scan || lineProgressRef.current !== null) return;
    const missing = entries.filter((entry) => frameSource.peekFrame(entry) === null);
    const progress = { done: 0, total: missing.length };
    lineProgressRef.current = progress;
    publishLineScan();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < missing.length && lineScanRef.current === scan) {
        const entry = missing[nextIndex];
        nextIndex += 1;
        if (!entry) continue;
        const outcome = await frameSource.loadFrame(entry);
        if (outcome.ok) noteFrame(outcome.value);
        else console.error(`[LiveDay] ${outcome.reason}`);
        progress.done += 1;
        schedulePublish();
      }
    };
    await Promise.all(Array.from({ length: DAY_CHECK_CONCURRENCY }, worker));
    if (lineScanRef.current === scan) {
      lineProgressRef.current = null;
      publishLineScan();
    }
  }, [entries, frameSource, noteFrame, publishLineScan, schedulePublish]);

  /** Moves the day to the moment a ship passed the line, selects it, and flies to it once that moment is drawn. */
  const selectPassage = useCallback(
    (passage: LinePassage) => {
      selectShip(passage.mmsi);
      pendingFocusRef.current = passage.mmsi;
      const atMs = Math.min(endMs, Math.max(startMs, passage.closestAtMs));
      clock.pause();
      clock.seek(spanMs > 0 ? (atMs - startMs) / spanMs : 1);
      focusPendingShip();
    },
    [clock, endMs, focusPendingShip, selectShip, spanMs, startMs],
  );

  /** Marks an incident as selected on the globe and in the list, and opens its card. */
  const selectIncident = useCallback((slug: string | null) => {
    selectedIncidentRef.current = slug;
    setSelectedIncidentSlug(slug);
    viewerRef.current?.setSelectedIncident(slug);
  }, []);

  /** A row of the incident list: selects it and flies over it, high enough to see the sea around the cut. */
  const focusIncident = useCallback(
    (slug: string) => {
      selectIncident(slug);
      const incident = incidents.find((candidate) => candidate.slug === slug);
      if (incident) void viewerRef.current?.flyTo({ longitude: incident.longitude, latitude: incident.latitude, distance: INCIDENT_FOCUS_DISTANCE });
    },
    [incidents, selectIncident],
  );

  /**
   * From orbit to the seabed: flies the camera down onto the incident's cut, then opens its case on the cut's minute;
   * the navigation crossfades the globe's last frame into the case console (crossfadeIntoCase).
   */
  const diveIntoIncident = useCallback(
    async (incident: GlobeIncident) => {
      setDivingSlug(incident.slug);
      clock.pause();
      // The seabed loads while the camera flies down (1.6 s), so the case's first 3D frame does not wait for it.
      warmCaseArea(incident.seabedArea);
      // The case page downloads while the camera flies, so the crossfade starts as soon as it lands.
      router.prefetch(incident.caseHref);
      await viewerRef.current?.flyTo({ longitude: incident.longitude, latitude: incident.latitude });
      await crossfadeIntoCase(() => router.push(incident.caseHref), new URL(incident.caseHref, window.location.href).pathname, globeHostRef.current);
      // Back from the case restores this page as it was left, with the button ready again.
      setDivingSlug(null);
    },
    [clock, router],
  );

  /** A ship row of a draft case: selects it and flies to it when the recorded day holds it at the moment shown. */
  const focusDraftShip = useCallback(
    (mmsi: number) => {
      selectShip(mmsi);
      pendingFocusRef.current = mmsi;
      focusPendingShip();
    },
    [focusPendingShip, selectShip],
  );

  const handlePick = useCallback(
    (pick: GlobePick) => {
      switch (pick.kind) {
        case "ship":
          selectShip(pick.mmsi);
          return;
        case "line":
          selectLine(pick.lineId);
          return;
        case "incident":
          selectIncident(pick.slug);
          return;
        case "none":
          selectShip(null);
          selectLine(null);
          selectIncident(null);
          return;
        default: {
          const unhandled: never = pick;
          return unhandled;
        }
      }
    },
    [selectIncident, selectLine, selectShip],
  );

  /** A detection row: moves the day into its window when the window falls inside the day, then flies to the ship. */
  const focusDetection = useCallback(
    (detection: DetectionSummary) => {
      selectShip(detection.mmsi);
      pendingFocusRef.current = detection.mmsi;
      if (detection.endMs >= startMs && detection.startMs <= endMs) {
        const atMs = Math.min(endMs, Math.max(startMs, detection.startMs));
        clock.pause();
        clock.seek(spanMs > 0 ? (atMs - startMs) / spanMs : 1);
      }
      focusPendingShip();
    },
    [clock, endMs, focusPendingShip, selectShip, spanMs, startMs],
  );

  // The Planet tier's density and the seas' counts, for the moment on screen.
  const density = useMemo(() => (moment ? binShipDensity(moment.frame) : null), [moment]);
  const seaCounts = useMemo(() => (seaAreas && moment ? countShipsBySea(seaAreas, moment.frame) : null), [seaAreas, moment]);
  const seaRanking = useMemo(() => (seaAreas && seaCounts ? rankSeasByShips(seaAreas, seaCounts) : []), [seaAreas, seaCounts]);
  const seaLabels = useMemo<GlobeSeaLabel[]>(
    () =>
      seaRanking.slice(0, SEA_LABEL_COUNT).map((entry) => ({
        name: entry.sea.name,
        note: `${entry.shipCount.toLocaleString("en-US")} ${entry.shipCount === 1 ? "ship" : "ships"}`,
        longitude: entry.sea.longitude,
        latitude: entry.sea.latitude,
      })),
    [seaRanking],
  );
  const regionCounts = useMemo(() => (moment ? countShipsInBoxes(moment.frame, watchedRegions) : null), [moment, watchedRegions]);

  // A ripple on each watched cable a fault signal of this day names (src/lib/globe/fault-ripples.ts).
  const ripples = useMemo(
    () => (draftCasesState.kind === "loaded" ? findFaultRipples({ drafts: draftCasesState.drafts, watchedLines, dayStartMs: startMs, dayEndMs: endMs }) : []),
    [draftCasesState, watchedLines, startMs, endMs],
  );

  // Hands the moment's density, the sea names and the ripples to the globe, a three.js scene React does not own.
  useEffect(() => {
    ripplesRef.current = ripples;
    viewerRef.current?.setRipples(ripples);
  }, [ripples]);
  useEffect(() => {
    densityRef.current = density;
    viewerRef.current?.setDensity(density);
  }, [density]);
  useEffect(() => {
    seaLabelsRef.current = seaLabels;
    viewerRef.current?.setSeaLabels(seaLabels);
  }, [seaLabels]);

  /** The ladder and the breadcrumb: flies to a tier over what the stage centres on. */
  const flyToTier = useCallback(
    (tier: GlobeTier) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      if (tier === "ship") {
        if (selectedRef.current !== null && viewer.focusShip(selectedRef.current, SHIP_TIER_DISTANCE)) setIsOnShip(true);
        return;
      }
      setIsOnShip(false);
      const centre = viewer.readCentre();
      const areas = seaAreasRef.current;
      const sea = tier === "sea" && areas ? (areas.seas[findSeaIndex(areas, centre.longitude, centre.latitude)] ?? findNearestSea(areas, centre)) : undefined;
      const region = tier === "strait" ? watchedRegions.find((candidate) => isInsideBox(candidate.box, centre.longitude, centre.latitude)) : undefined;
      const target = sea ? { longitude: sea.longitude, latitude: sea.latitude } : region ? boxCentre(region) : centre;
      void viewer.flyTo({ ...target, distance: TIER_CAMERA_DISTANCE[tier], durationMs: TIER_MOVE_MS });
    },
    [watchedRegions],
  );

  const flyToSea = useCallback((entry: SeaCount) => {
    setIsOnShip(false);
    void viewerRef.current?.flyTo({ longitude: entry.sea.longitude, latitude: entry.sea.latitude, distance: TIER_CAMERA_DISTANCE.sea, durationMs: TIER_MOVE_MS });
  }, []);

  const flyToRegion = useCallback(
    (regionId: string) => {
      const region = watchedRegions.find((candidate) => candidate.id === regionId);
      if (!region) return;
      setIsOnShip(false);
      void viewerRef.current?.flyTo({ ...boxCentre(region), distance: TIER_CAMERA_DISTANCE.strait, durationMs: TIER_MOVE_MS });
    },
    [watchedRegions],
  );

  const shipIndex = moment && selectedMmsi !== null ? findInFrame(moment.frame, selectedMmsi) : -1;
  const selectedRecord = moment && shipIndex !== -1 ? readShipRecord(moment.frame, shipIndex) : null;
  const rightInsetPx = isWide ? RAIL_WIDTH_PX + RAIL_INSET_PX : 0;
  const selectedIncident = incidents.find((incident) => incident.slug === selectedIncidentSlug);
  const selectedLine = selectedLineId === null ? undefined : globeLines.lines.find((line) => line.id === selectedLineId);

  // The Ship tier holds while the camera stays close on the picked ship; zooming out hands back to the distance tiers.
  const tier: GlobeTier = isOnShip && selectedMmsi !== null && place.tier === "strait" ? "ship" : place.tier;
  const currentSea = seaAreas && place.seaIndex >= 0 ? seaAreas.seas[place.seaIndex] : undefined;
  const currentRegion = watchedRegions.find((region) => region.id === place.regionId);
  const shipName = detailsState.kind === "loaded" && detailsState.details?.name ? detailsState.details.name : selectedMmsi === null ? "" : `MMSI ${selectedMmsi}`;
  const crumbs: Crumb[] = [{ tier: "planet", label: "World" }];
  if (tier !== "planet") crumbs.push({ tier: "sea", label: currentSea?.name ?? "Inland" });
  if (tier === "strait" || tier === "ship") crumbs.push({ tier: "strait", label: currentRegion?.name ?? "Close up" });
  if (tier === "ship") crumbs.push({ tier: "ship", label: shipName });
  const seaRegions =
    seaAreas && currentSea
      ? watchedRegions
          .filter((region) => measureSeaShare(seaAreas, region.box, place.seaIndex) >= REGION_SEA_SHARE)
          .map((region) => ({ id: region.id, name: region.name, shipCount: regionCounts?.get(region.id) ?? 0 }))
      : [];
  const seaIncidents = seaAreas && currentSea ? incidents.filter((incident) => findSeaIndex(seaAreas, incident.longitude, incident.latitude) === place.seaIndex) : [];

  const tierLadder = (
    <div className="pointer-events-auto rounded-full bg-card p-1 shadow-row" data-testid="live-tier" data-tier={tier}>
      <TierLadder tier={tier} hasShip={selectedMmsi !== null} onSelect={flyToTier} />
    </div>
  );

  const railCards = (
    <>
      <MomentCard minuteLabel={minuteLabel} shipCount={moment?.frame.shipCount ?? null} digitrafficCount={moment?.digitrafficCount ?? 0} feedCheck={feedCheck} />
      {tier === "planet" && <BusiestSeasCard ranking={seaRanking} onSelect={flyToSea} />}
      {tier === "sea" && currentSea && (
        <SeaCard
          seaName={currentSea.name}
          shipCount={seaCounts?.[place.seaIndex] ?? 0}
          regions={seaRegions}
          incidents={seaIncidents}
          onSelectRegion={flyToRegion}
          onSelectIncident={focusIncident}
        />
      )}
      {selectedIncident && (
        <IncidentCard
          incident={selectedIncident}
          isDiving={divingSlug === selectedIncident.slug}
          onDive={() => void diveIntoIncident(selectedIncident)}
          onClose={() => selectIncident(null)}
        />
      )}
      {selectedMmsi !== null && (
        <ShipCard
          mmsi={selectedMmsi}
          record={selectedRecord}
          momentMs={momentMinuteMs}
          detailsState={detailsState}
          onFocus={() => viewerRef.current?.focusShip(selectedMmsi)}
          onClose={() => selectShip(null)}
        />
      )}
      {selectedLine && lineScan && (
        <LiveLineCard
          line={selectedLine}
          scan={lineScan}
          shipNames={shipNames}
          selectedMmsi={selectedMmsi}
          onCheckDay={() => void checkLineDay()}
          onSelectPassage={selectPassage}
          onClose={() => selectLine(null)}
        />
      )}
      <DetectionsCard state={detectionsState} selectedMmsi={selectedMmsi} onSelect={focusDetection} />
      <DraftCasesCard state={draftCasesState} selectedMmsi={selectedMmsi} onSelectShip={focusDraftShip} />
      {incidents.length > 0 && <IncidentsCard incidents={incidents} selectedSlug={selectedIncidentSlug} onSelect={focusIncident} />}
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
        <div ref={globeHostRef} className="absolute inset-0">
          <LiveGlobeStage
            watchedLines={watchedLines}
            rightInsetPx={rightInsetPx}
            onViewerChange={handleViewerChange}
            onPick={handlePick}
            onViewChange={handleViewChange}
            onLinesChange={handleLinesChange}
          />
        </div>
        <div className="pointer-events-none absolute top-4 left-4 z-(--layer-stage-controls) flex max-w-[calc(100%-32px)] flex-col items-start gap-2">
          <p className="rounded-full bg-card px-4 py-2 text-label shadow-row">A recorded day of ships, not real time</p>
          {/* From orbit the breadcrumb would only say "World", which the ladder already does. */}
          {tier !== "planet" && <TierBreadcrumb crumbs={crumbs} onSelect={flyToTier} />}
          {isWide && tierLadder}
          {frameProblem && (
            <p className="rounded-row bg-card px-4 py-2 text-small shadow-row" role="status">
              {frameProblem}
            </p>
          )}
        </div>
        <div className="absolute bottom-4 left-4 z-(--layer-stage-controls) flex items-center gap-2">
          <div className="hidden items-center gap-x-4 rounded-field bg-card px-3.5 py-2.5 text-micro shadow-row md:flex">
            {tier === "planet" ? (
              <span className="inline-flex items-center gap-1.5" data-testid="live-density-legend">
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  <span className="size-1.5 rounded-full bg-density/80" />
                  <span className="size-2.5 rounded-full bg-density/80" />
                </span>
                Ships per 220 km
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-ship" aria-hidden="true" />
                Ship
              </span>
            )}
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
            {ripples.length > 0 && (
              <span className="inline-flex items-center gap-1.5" data-testid="live-ripple-legend">
                <span className="size-3 rounded-full border-[1.5px] border-alarm" aria-hidden="true" />
                Fault signal today
              </span>
            )}
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
      {/* On a phone the stage is too short for three rows of controls over the globe: the ladder sits under the dock. */}
      {!isWide && <div className="flex justify-center">{tierLadder}</div>}
      {!isWide && <div className="flex flex-col gap-3">{railCards}</div>}
    </div>
  );
}
