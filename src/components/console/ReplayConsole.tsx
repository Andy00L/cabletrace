"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaseSketchMap } from "@/components/cases/CaseCard";
import { ConsoleControllerContext, type ConsoleController } from "@/components/console/console-context";
import { ConsoleDock } from "@/components/console/ConsoleDock";
import { ConsoleLayers } from "@/components/console/ConsoleLayers";
import { ConsoleRail } from "@/components/console/ConsoleRail";
import { ConsoleTopBar, type CaseSwitcherItem } from "@/components/console/ConsoleTopBar";
import { StageOverlays, type SceneSources } from "@/components/console/StageOverlays";
import { SeabedView } from "@/components/replay/SeabedView";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import type { ConsoleCase } from "@/lib/cases/case-console";
import type { CaseSeries } from "@/lib/cases/case-series";
import { formatConsoleState, parseConsoleState, type ConsoleContext, type ConsoleLayer, type ConsoleMode, type SeabedDetail } from "@/lib/console/console-state";
import { createReplayClock } from "@/lib/replay/replay-clock";
import { progressToTimeMs, timeMsToProgress, type ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { SceneTarget } from "@/lib/seabed/scene/overview";
import type { SeabedViewer, SeabedViewName } from "@/lib/seabed/scene/viewer";

// A full replay takes this long to play, whatever span of time the case window covers.
const REPLAY_DURATION_SECONDS = 40;
// The rail's width and its inset from the stage edge (docs/UI_DESIGN_SYSTEM.md, Console, Layout), in CSS px.
const RAIL_WIDTH_PX = 360;
const RAIL_INSET_PX = 16;
// Layouts (docs/UI_DESIGN_SYSTEM.md, Console, Layout): from 1024 px the full console with the charts in the dock;
// from 768 px the rail floats over the stage as a sheet and the charts move into Ship mode; under 768 px the rail's
// content lives in a bottom sheet and cards open as bottom sheets.
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";
const FLOATING_RAIL_QUERY = "(min-width: 768px)";
// What the folded bottom sheet keeps on a phone screen (CSS px): its handle and the mode switch.
const SHEET_PEEK_PX = 96;
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
  /** Who made the area's depth grid and mapped its cables and pipelines, from its seabed file; null when it could not be read. */
  sceneSources: SceneSources | null;
  caseFileSha256: string | null;
};

function matchesMedia(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

/** The card a 3D object opens. */
function toTargetLayer(target: SceneTarget): ConsoleLayer {
  switch (target.kind) {
    case "vessel":
      return { kind: "vessel" };
    case "cut":
      return { kind: "cut", cutIndex: target.cutIndex };
    case "placement":
      return { kind: "placement", positionIndex: target.positionIndex };
    default: {
      const unhandledTarget: never = target;
      return unhandledTarget;
    }
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * The one-screen replay console (style board, boards 6 to 11): top bar, the 3D stage with its controls, the rail
 * of cards over the stage's right edge, the dock with the clock, the timeline and the charts, and the layers that
 * open over them. Owns the replay clock and keeps view, mode, open layer and time in the URL.
 */
export function ReplayConsole({ input, consoleCase, series, switcherCases, sceneSources, caseFileSha256 }: ReplayConsoleProps) {
  const searchParams = useSearchParams();
  const urlContext = useMemo<ConsoleContext>(
    () => ({
      windowStartMs: input.windowStartMs,
      windowEndMs: input.windowEndMs,
      openingMs: Math.min(input.windowEndMs, Math.max(input.windowStartMs, input.track[0]?.atMs ?? input.windowStartMs)),
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
  // A link that names Ship or Evidence mode opens the rail (or the phone's sheet) on it, whatever the width.
  const [isRailOpen, setIsRailOpen] = useState(() => matchesMedia(ROOMY_LAYOUT_QUERY) || initialState.mode !== "replay");
  const [isWide, setIsWide] = useState(() => matchesMedia(WIDE_LAYOUT_QUERY));
  const [hasFloatingRail, setHasFloatingRail] = useState(() => matchesMedia(FLOATING_RAIL_QUERY));
  const [stageElement, setStageElement] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<SeabedViewer | null>(null);
  // The state as last written, so two changes made in one handler (a new mode, then a closed card) both land.
  const uiRef = useRef(ui);

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
    (change: Partial<UiState>, entry: "push" | "replace") => {
      const next = { ...uiRef.current, ...change };
      uiRef.current = next;
      setUi(next);
      writeUrl(next, entry);
    },
    [writeUrl],
  );

  const setView = useCallback((view: SeabedViewName) => updateUi({ view }, "replace"), [updateUi]);
  const setMode = useCallback(
    (mode: ConsoleMode) => {
      setIsRailOpen(true);
      updateUi({ mode }, "replace");
    },
    [updateUi],
  );
  const setDetail = useCallback((detail: SeabedDetail) => updateUi({ detail }, "replace"), [updateUi]);
  const openLayer = useCallback(
    (layer: ConsoleLayer, nextOpener?: HTMLElement | null) => {
      setOpener(nextOpener ?? null);
      // One history entry per opened layer, so Back closes it; switching from one layer to another replaces it.
      updateUi({ layer }, uiRef.current.layer.kind === "none" ? "push" : "replace");
    },
    [updateUi],
  );
  const closeLayer = useCallback(() => updateUi({ layer: { kind: "none" } }, "replace"), [updateUi]);
  // A click on the ship, a cut marker or a placed position in the 3D view opens its card there, on the object.
  const openTargetCard = useCallback((target: SceneTarget) => openLayer(toTargetLayer(target), null), [openLayer]);
  const focusTarget = useCallback((target: SceneTarget) => viewer?.centerOnTarget(target), [viewer]);
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
      const restoredUi = { view: restored.view, mode: restored.mode, detail: restored.detail, layer: restored.layer };
      uiRef.current = restoredUi;
      setUi(restoredUi);
      clock.seek(timeMsToProgress(input, restored.atMs));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clock, input, urlContext]);

  // The layout switches at 768 and 1024 px, and the rail starts open only from 1280 px: follows media queries, a
  // browser system React does not own.
  useEffect(() => {
    const wideQuery = window.matchMedia(WIDE_LAYOUT_QUERY);
    const floatingQuery = window.matchMedia(FLOATING_RAIL_QUERY);
    const roomyQuery = window.matchMedia(ROOMY_LAYOUT_QUERY);
    const update = () => {
      setIsWide(wideQuery.matches);
      setHasFloatingRail(floatingQuery.matches);
    };
    const updateRail = () => setIsRailOpen(roomyQuery.matches);
    update();
    wideQuery.addEventListener("change", update);
    floatingQuery.addEventListener("change", update);
    roomyQuery.addEventListener("change", updateRail);
    return () => {
      wideQuery.removeEventListener("change", update);
      floatingQuery.removeEventListener("change", update);
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

  const isPhone = !hasFloatingRail;
  const isRailFloating = hasFloatingRail && isRailOpen;
  const caseSketch = switcherCases.find((item) => item.slug === consoleCase.slug)?.sketch ?? null;
  // The 3D picture frames its subject in the part the floating rail leaves visible.
  const rightInsetPx = isRailFloating ? RAIL_WIDTH_PX + RAIL_INSET_PX : 0;

  const controller = useMemo<ConsoleController>(
    () => ({ input, consoleCase, series, clock, ...ui, setView, setMode, setDetail, openLayer, closeLayer, seekTo, focusTarget, caseFileSha256 }),
    [input, consoleCase, series, clock, ui, setView, setMode, setDetail, openLayer, closeLayer, seekTo, focusTarget, caseFileSha256],
  );

  return (
    <ConsoleControllerContext.Provider value={controller}>
        <div className="flex h-dvh flex-col overflow-hidden" data-testid="replay-console">
          <h1 className="sr-only">{consoleCase.title}</h1>
          <ConsoleTopBar switcherCases={switcherCases} />
          {/* On a phone the folded bottom sheet covers the screen's last SHEET_PEEK_PX, so the dock stops above it. */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4" style={isPhone ? { paddingBottom: SHEET_PEEK_PX + 16 } : undefined}>
            <section
              ref={setStageElement}
              aria-label="3D replay"
              className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-soft shadow-card"
              data-testid="case-replay"
            >
              <SeabedView
                input={input}
                clock={clock}
                view={ui.view}
                isIllustrated={ui.detail === "illustrated"}
                rightInsetPx={rightInsetPx}
                onViewerChange={setViewer}
                onTargetPick={openTargetCard}
                still={caseSketch ? <CaseSketchMap sketch={caseSketch} vesselName={consoleCase.vessel.name} /> : null}
              />
              <StageOverlays
                stageElement={stageElement}
                isCompact={!isWide}
                isRailFloating={isRailFloating}
                railWidthPx={hasFloatingRail ? RAIL_WIDTH_PX + RAIL_INSET_PX * 2 : 0}
                onResetView={() => viewer?.resetView()}
                onShowRail={hasFloatingRail && !isRailOpen ? () => setIsRailOpen(true) : null}
                sceneSources={sceneSources}
              />
              {isRailFloating && (
                <div
                  className="absolute top-4 right-4 bottom-4 z-(--layer-panel) flex flex-col gap-3"
                  style={{ width: RAIL_WIDTH_PX }}
                  data-overlays-stage="true"
                >
                  <ConsoleRail onHide={() => setIsRailOpen(false)} showsCharts={!isWide} />
                </div>
              )}
            </section>
            <ConsoleDock showCharts={isWide} />
          </div>
          {isPhone && (
            <BottomSheet
              label="case panel"
              isExpanded={isRailOpen}
              onExpandedChange={setIsRailOpen}
              peekHeightPx={SHEET_PEEK_PX}
              header={<SegmentedControl label="Mode" options={MODE_OPTIONS} value={ui.mode} onChange={setMode} testId="mode-switch" />}
              testId="console-panel"
            >
              <ConsoleRail onHide={null} showsCharts />
            </BottomSheet>
          )}
          <ConsoleLayers
            stageElement={stageElement}
            opener={opener}
            viewer={viewer}
            stageRightInsetPx={rightInsetPx}
            isStageNarrow={!isWide}
            cardPresentation={isPhone ? "sheet" : "popover"}
          />
        </div>
    </ConsoleControllerContext.Provider>
  );
}
