"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConsoleControllerContext, type ConsoleController } from "@/components/console/console-context";
import { ConsoleDock } from "@/components/console/ConsoleDock";
import { ConsoleLayers } from "@/components/console/ConsoleLayers";
import { ConsoleRail } from "@/components/console/ConsoleRail";
import { ConsoleTopBar, type CaseSwitcherItem } from "@/components/console/ConsoleTopBar";
import { StageOverlays, type LineSources } from "@/components/console/StageOverlays";
import { SeabedView } from "@/components/replay/SeabedView";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import type { ConsoleCase } from "@/lib/cases/case-console";
import type { CaseSeries } from "@/lib/cases/case-series";
import { formatConsoleState, parseConsoleState, type ConsoleContext, type ConsoleLayer, type ConsoleMode, type SeabedDetail } from "@/lib/console/console-state";
import { createReplayClock } from "@/lib/replay/replay-clock";
import { progressToTimeMs, timeMsToProgress, type ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { SeabedViewer, SeabedViewName } from "@/lib/seabed/scene/viewer";

// A full replay takes this long to play, whatever span of time the case window covers.
const REPLAY_DURATION_SECONDS = 40;
// The rail's width and its inset from the stage edge (docs/UI_DESIGN_SYSTEM.md, Console, Layout), in CSS px.
const RAIL_WIDTH_PX = 360;
const RAIL_INSET_PX = 16;
// At this width and up the rail floats over the stage; below it the rail's content sits under the dock.
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";
// From this width the open rail still leaves the view room for its controls, so the rail starts open.
const ROOMY_LAYOUT_QUERY = "(min-width: 1280px)";
// Seeking writes the minute into the URL once the hand stops: Safari refuses more than 100 history writes in 30 s.
const URL_TIME_WRITE_DELAY_MS = 400;
const VIEW_KEYS: Record<string, SeabedViewName> = { "1": "overview", "2": "top", "3": "vessel", "4": "closeup" };
const MODE_OPTIONS: readonly SegmentOption<ConsoleMode>[] = [
  { value: "replay", label: "Replay" },
  { value: "ship", label: "Ship" },
  { value: "evidence", label: "Evidence" },
];

type UiState = { view: SeabedViewName; mode: ConsoleMode; detail: SeabedDetail; layer: ConsoleLayer };

type ReplayConsoleProps = {
  input: ReplaySceneInput;
  consoleCase: ConsoleCase;
  series: CaseSeries | null;
  switcherCases: CaseSwitcherItem[];
  /** Who mapped the area's cables and pipelines, from its seabed file; null when it could not be read. */
  lineSources: LineSources | null;
};

function matchesMedia(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * The one-screen replay console (style board, boards 6 to 11): top bar, the 3D stage with its controls, the rail
 * of cards over the stage's right edge, the dock with the clock, the timeline and the charts, and the layers that
 * open over them. Owns the replay clock and keeps view, mode, open layer and time in the URL.
 */
export function ReplayConsole({ input, consoleCase, series, switcherCases, lineSources }: ReplayConsoleProps) {
  const searchParams = useSearchParams();
  const urlContext = useMemo<ConsoleContext>(
    () => ({
      windowStartMs: input.windowStartMs,
      windowEndMs: input.windowEndMs,
      cutSlugs: consoleCase.cuts.map((cut) => cut.slug),
      placementCount: consoleCase.positions.length,
      sourceIds: consoleCase.sources.map((source) => source.id),
    }),
    [input, consoleCase],
  );
  const [initialState] = useState(() => parseConsoleState(searchParams, urlContext));
  const [clock] = useState(() => {
    const created = createReplayClock({
      durationSeconds: REPLAY_DURATION_SECONDS,
      scheduler: { request: (callback) => window.requestAnimationFrame(callback), cancel: (handle) => window.cancelAnimationFrame(handle) },
    });
    created.seek(timeMsToProgress(input, initialState.atMs));
    return created;
  });
  const [ui, setUi] = useState<UiState>({ view: initialState.view, mode: initialState.mode, detail: initialState.detail, layer: initialState.layer });
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // The console renders only in the browser (it reads the URL behind a Suspense boundary), so the first render can
  // ask the media queries directly and the layout does not jump once the effect below subscribes.
  const [isRailOpen, setIsRailOpen] = useState(() => matchesMedia(ROOMY_LAYOUT_QUERY));
  const [isWide, setIsWide] = useState(() => matchesMedia(WIDE_LAYOUT_QUERY));
  const [stageElement, setStageElement] = useState<HTMLElement | null>(null);
  const viewerRef = useRef<SeabedViewer | null>(null);

  const writeUrl = useCallback(
    (state: UiState, entry: "push" | "replace") => {
      const atMs = progressToTimeMs(input, clock.getSnapshot().progress);
      const query = formatConsoleState({ ...state, atMs }, urlContext);
      const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
      if (entry === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [input, clock, urlContext],
  );
  const updateUi = useCallback(
    (next: UiState, entry: "push" | "replace") => {
      setUi(next);
      writeUrl(next, entry);
    },
    [writeUrl],
  );

  const setView = useCallback((view: SeabedViewName) => updateUi({ ...ui, view }, "replace"), [ui, updateUi]);
  const setMode = useCallback(
    (mode: ConsoleMode) => {
      setIsRailOpen(true);
      updateUi({ ...ui, mode }, "replace");
    },
    [ui, updateUi],
  );
  const setDetail = useCallback((detail: SeabedDetail) => updateUi({ ...ui, detail }, "replace"), [ui, updateUi]);
  const openLayer = useCallback(
    (layer: ConsoleLayer, nextOpener?: HTMLElement | null) => {
      setOpener(nextOpener ?? null);
      // One history entry per opened layer, so Back closes it; switching from one layer to another replaces it.
      updateUi({ ...ui, layer }, ui.layer.kind === "none" ? "push" : "replace");
    },
    [ui, updateUi],
  );
  const closeLayer = useCallback(() => updateUi({ ...ui, layer: { kind: "none" } }, "replace"), [ui, updateUi]);
  const seekTo = useCallback((atMs: number) => clock.seek(timeMsToProgress(input, atMs)), [clock, input]);

  // The clock schedules animation frames, a browser system React does not own; stop them when the console goes.
  useEffect(() => () => clock.dispose(), [clock]);

  // Writes the replay minute into the URL once the replay is paused and the hand has stopped. Subscribes to the
  // clock, an external store.
  useEffect(() => {
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastProgress = clock.getSnapshot().progress;
    const unsubscribe = clock.subscribe(() => {
      const snapshot = clock.getSnapshot();
      if (snapshot.isPlaying || snapshot.progress === lastProgress) {
        lastProgress = snapshot.progress;
        return;
      }
      lastProgress = snapshot.progress;
      if (writeTimer !== null) clearTimeout(writeTimer);
      writeTimer = setTimeout(() => writeUrl(ui, "replace"), URL_TIME_WRITE_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (writeTimer !== null) clearTimeout(writeTimer);
    };
  }, [clock, ui, writeUrl]);

  // Back and Forward move through the layers opened: syncs with the browser history, which React does not own.
  useEffect(() => {
    const handlePopState = () => {
      const restored = parseConsoleState(new URLSearchParams(window.location.search), urlContext);
      setUi({ view: restored.view, mode: restored.mode, detail: restored.detail, layer: restored.layer });
      clock.seek(timeMsToProgress(input, restored.atMs));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clock, input, urlContext]);

  // The layout switches at 1024 px, and the rail starts open only from 1280 px: follows media queries, a browser
  // system React does not own.
  useEffect(() => {
    const wideQuery = window.matchMedia(WIDE_LAYOUT_QUERY);
    const roomyQuery = window.matchMedia(ROOMY_LAYOUT_QUERY);
    const update = () => setIsWide(wideQuery.matches);
    const updateRail = () => setIsRailOpen(roomyQuery.matches);
    update();
    updateRail();
    wideQuery.addEventListener("change", update);
    roomyQuery.addEventListener("change", updateRail);
    return () => {
      wideQuery.removeEventListener("change", update);
      roomyQuery.removeEventListener("change", updateRail);
    };
  }, []);

  // Keyboard shortcuts (the shortcuts dialog lists them). Listens on the window, which React does not own.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isOnControl = target !== null && target.closest("button, a, [role='dialog']") !== null;
      if (event.key === " " && !isOnControl) {
        event.preventDefault();
        clock.toggle();
        return;
      }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !isOnControl) {
        event.preventDefault();
        const atMs = progressToTimeMs(input, clock.getSnapshot().progress);
        const events = consoleCase.events;
        const nextEvent = event.key === "ArrowRight" ? events.find((candidate) => candidate.atMs > atMs + 1000) : [...events].reverse().find((candidate) => candidate.atMs < atMs - 1000);
        if (nextEvent) seekTo(nextEvent.atMs);
        return;
      }
      const viewForKey = VIEW_KEYS[event.key];
      if (viewForKey) {
        setView(viewForKey);
        return;
      }
      if (event.key === "f" || event.key === "F") {
        setView("vessel");
        return;
      }
      if (event.key === "?") openLayer({ kind: "shortcuts" }, target);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clock, input, consoleCase, seekTo, setView, openLayer]);

  const isRailFloating = isWide && isRailOpen;
  // The 3D picture frames its subject in the part the floating rail leaves visible.
  const rightInsetPx = isRailFloating ? RAIL_WIDTH_PX + RAIL_INSET_PX : 0;

  const controller = useMemo<ConsoleController>(
    () => ({ input, consoleCase, series, clock, ...ui, setView, setMode, setDetail, openLayer, closeLayer, seekTo }),
    [input, consoleCase, series, clock, ui, setView, setMode, setDetail, openLayer, closeLayer, seekTo],
  );

  return (
    <ConsoleControllerContext.Provider value={controller}>
        <div className="flex h-dvh flex-col overflow-hidden" data-testid="replay-console">
          <h1 className="sr-only">{consoleCase.title}</h1>
          <ConsoleTopBar switcherCases={switcherCases} />
          <div className={`flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 ${isWide ? "" : "overflow-y-auto"}`}>
            <section
              ref={setStageElement}
              aria-label="3D replay"
              className={`relative overflow-hidden rounded-card bg-soft shadow-card ${isWide ? "min-h-0 flex-1" : "h-[52svh] min-h-[300px] flex-none"}`}
              data-testid="case-replay"
            >
              <SeabedView
                input={input}
                clock={clock}
                view={ui.view}
                isIllustrated={ui.detail === "illustrated"}
                rightInsetPx={rightInsetPx}
                onViewerChange={(viewer) => {
                  viewerRef.current = viewer;
                }}
              />
              <StageOverlays
                stageElement={stageElement}
                isCompact={!isWide}
                isRailFloating={isRailFloating}
                railWidthPx={isWide ? RAIL_WIDTH_PX + RAIL_INSET_PX * 2 : 0}
                onResetView={() => viewerRef.current?.resetView()}
                onShowRail={isWide && !isRailOpen ? () => setIsRailOpen(true) : null}
                lineSources={lineSources}
              />
              {isRailFloating && (
                <div
                  className="absolute top-4 right-4 bottom-4 z-(--layer-panel) flex flex-col gap-3"
                  style={{ width: RAIL_WIDTH_PX }}
                  data-overlays-stage="true"
                >
                  <ConsoleRail onHide={() => setIsRailOpen(false)} />
                </div>
              )}
            </section>
            <ConsoleDock showCharts={isWide} />
            {!isWide && (
              <div className="flex flex-col gap-3" data-testid="console-panel">
                <SegmentedControl label="Mode" options={MODE_OPTIONS} value={ui.mode} onChange={setMode} testId="mode-switch" />
                <ConsoleRail onHide={null} />
              </div>
            )}
          </div>
          <ConsoleLayers stageElement={stageElement} opener={opener} />
        </div>
    </ConsoleControllerContext.Provider>
  );
}
