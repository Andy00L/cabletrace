"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CaseStill } from "@/components/cases/CaseStill";
import { ANCHOR_CAM_EXPANDED_WIDTH_PX, ANCHOR_CAM_WIDTH_PX, AnchorCamWindow, readAnchorCamHeightPx, readAnchorCamWidthForHeightPx } from "@/components/console/AnchorCamWindow";
import { ConsoleControllerContext, type ConsoleController } from "@/components/console/console-context";
import { ConsoleDock } from "@/components/console/ConsoleDock";
import { ConsoleLayers } from "@/components/console/ConsoleLayers";
import { ConsoleRail } from "@/components/console/ConsoleRail";
import { ConsoleTopBar, type CaseSwitcherItem } from "@/components/console/ConsoleTopBar";
import { RailHoverTab } from "@/components/console/RailHoverTab";
import { StageOverlays, type SceneSummary } from "@/components/console/StageOverlays";
import { REPLAY_SCRUBBER_ID } from "@/components/replay/ReplayTimeline";
import { SeabedView } from "@/components/replay/SeabedView";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import type { ConsoleCase } from "@/lib/cases/case-console";
import type { CaseSeries } from "@/lib/cases/case-series";
import { formatConsoleState, parseConsoleState, shouldWriteReplayTime, type ConsoleContext, type ConsoleLayer, type ConsoleMode, type SeabedDetail } from "@/lib/console/console-state";
import { classifyKeyTarget, type KeyTargetKind } from "@/lib/console/keyboard-target";
import { createReplayClock } from "@/lib/replay/replay-clock";
import { progressToTimeMs, timeMsToProgress, type ReplaySceneInput } from "@/lib/replay/replay-scene";
import { describeAnchorStatus } from "@/lib/replay/anchor-status";
import type { CameraDriver, CameraMode, SafeInsets, ShipCamera } from "@/lib/seabed/scene/director/camera-driver";
import { readReplayPace } from "@/lib/seabed/scene/director/replay-pace";
import { buildShotList, pickShotAt, readShotView } from "@/lib/seabed/scene/director/shots";
import type { SceneTarget } from "@/lib/seabed/scene/overview";
import type { SeabedViewer, SeabedViewName } from "@/lib/seabed/scene/viewer";

// A full replay takes this long to play at normal pace, whatever span of time the case window covers; the stretch
// around each cut plays slower (replay-pace.ts), which makes Eagle S's whole window about 67 s.
const REPLAY_DURATION_SECONDS = 40;
// A press on the 3D view that moves further than this (CSS px) is the user taking the camera, which stops the director.
// The same slop tells a click from an orbit in the viewer (src/lib/seabed/scene/viewer.ts, CLICK_SLOP_PX).
const CAMERA_GRAB_SLOP_PX = 6;
// Where the stage's own controls reach in from its edges (StageOverlays: 16 px inset, 44 px controls, 12 px of air),
// which the director keeps its subjects clear of; on a phone the anchor status sits on a second row under the views.
const CONTROLS_BAND_PX = 72;
const PHONE_TOP_BAND_PX = 112;
const STAGE_INSET_PX = 16;
// The rail's width and its inset from the stage edge (docs/UI_DESIGN_SYSTEM.md, Console, Layout), in CSS px.
const RAIL_WIDTH_PX = 360;
const RAIL_INSET_PX = 16;
// Under the anchor cam the floating rail needs at least this much height (CSS px: a whole card, 263 px are left at
// 1440 x 900); with less, it folds to a tab that opens it over the stage (RailHoverTab). On Andy's laptop window the
// rail under the anchor cam was a 70 px sliver (21 Oct 2026).
const MIN_RAIL_HEIGHT_PX = 240;
// The folded rail's tab (CSS px, RailHoverTab).
const RAIL_TAB_HEIGHT_PX = 48;
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
  /** The area's credits and exaggeration, from its seabed file; null when it could not be read. */
  sceneSummary: SceneSummary | null;
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

/** What the element a key landed on keeps for itself (keyboard-target.ts); the page and `window` keep nothing. */
function readKeyTargetKind(target: EventTarget | null): KeyTargetKind {
  if (!(target instanceof HTMLElement)) return "other";
  return classifyKeyTarget({ tagName: target.tagName, inputType: target instanceof HTMLInputElement ? target.type : null, isContentEditable: target.isContentEditable });
}

/**
 * The one-screen replay console (style board, boards 6 to 11): top bar, the 3D stage with its controls, the rail
 * of cards over the stage's right edge, the dock with the clock, the timeline and the charts, and the layers that
 * open over them. Owns the replay clock and keeps view, mode, open layer and time in the URL.
 */
export function ReplayConsole({ input, consoleCase, series, switcherCases, sceneSummary, caseFileSha256 }: ReplayConsoleProps) {
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
    const cutTimesMs = input.cuts.map((cut) => cut.atMs);
    const created = createReplayClock({
      durationSeconds: REPLAY_DURATION_SECONDS,
      scheduler: { request: (callback) => window.requestAnimationFrame(callback), cancel: (handle) => window.cancelAnimationFrame(handle) },
      readPace: (progress) => readReplayPace(cutTimesMs, progressToTimeMs(input, progress)),
    });
    created.seek(timeMsToProgress(input, initialState.atMs));
    return created;
  });
  const [ui, setUi] = useState<UiState>({ view: initialState.view, mode: initialState.mode, detail: initialState.detail, layer: initialState.layer });
  // A link that names a view or a moment opens exactly that; a plain link to the case hands the camera to the director.
  const [isDirectorOn, setIsDirectorOn] = useState(() => !searchParams.has("view") && !searchParams.has("t"));
  const shots = useMemo(() => buildShotList(input), [input]);
  // The director's view at the replay moment; re-renders only when the shot changes, not on every frame.
  const readDirectedView = useCallback(() => readShotView(pickShotAt(shots, progressToTimeMs(input, clock.getSnapshot().progress))), [shots, input, clock]);
  const directedView = useSyncExternalStore(clock.subscribe, readDirectedView, readDirectedView);
  const drawnView = isDirectorOn ? directedView : ui.view;
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // The console renders only in the browser (it reads the URL behind a Suspense boundary), so the first render can
  // ask the media queries directly and the layout does not jump once the effect below subscribes.
  // A link that names Ship or Evidence mode opens the rail (or the phone's sheet) on it, whatever the width.
  const [isRailOpen, setIsRailOpen] = useState(() => matchesMedia(ROOMY_LAYOUT_QUERY) || initialState.mode !== "replay");
  const [isWide, setIsWide] = useState(() => matchesMedia(WIDE_LAYOUT_QUERY));
  const [hasFloatingRail, setHasFloatingRail] = useState(() => matchesMedia(FLOATING_RAIL_QUERY));
  const [stageElement, setStageElement] = useState<HTMLElement | null>(null);
  const [stageHeightPx, setStageHeightPx] = useState<number | null>(null);
  const [isAnchorCamExpanded, setAnchorCamExpanded] = useState(false);
  // Counts the reader's mode picks: a rail folded to its tab opens on each one, so "Ship details" shows them.
  const [modePickCount, setModePickCount] = useState(0);
  const [viewer, setViewer] = useState<SeabedViewer | null>(null);
  const [driver, setDriver] = useState<CameraDriver | null>(null);
  const [shipCamera, setShipCameraState] = useState<ShipCamera>("follow");
  // What the controls and cards cover at the stage's edges, read by the camera driver every frame.
  const safeInsetsRef = useRef<SafeInsets>({ left: STAGE_INSET_PX, top: CONTROLS_BAND_PX, right: STAGE_INSET_PX, bottom: CONTROLS_BAND_PX });
  // The anchor is on the seabed (the drag window): the anchor cam has something to show.
  const readIsAnchorDown = useCallback(() => describeAnchorStatus(input, progressToTimeMs(input, clock.getSnapshot().progress)).kind === "dragging", [input, clock]);
  const isAnchorDown = useSyncExternalStore(clock.subscribe, readIsAnchorDown, readIsAnchorDown);
  // The state as last written, so two changes made in one handler (a new mode, then a closed card) both land.
  const uiRef = useRef(ui);

  const writeUrl = useCallback(
    (state: UiState, entry: "push" | "replace") => {
      const atMs = progressToTimeMs(input, clock.getSnapshot().progress);
      // While the director directs, a shared link names the view on screen, so it opens on the same picture.
      const view = isDirectorOn ? readDirectedView() : state.view;
      const query = formatConsoleState({ ...state, view, atMs }, urlContext);
      const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
      if (entry === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [input, clock, urlContext, isDirectorOn, readDirectedView],
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

  // The user always wins: picking a view takes the camera from the director.
  const setView = useCallback(
    (view: SeabedViewName) => {
      setIsDirectorOn(false);
      updateUi({ view }, "replace");
    },
    [updateUi],
  );
  const setDirectorOn = useCallback(
    (isOn: boolean) => {
      if (isOn === isDirectorOn) return;
      setIsDirectorOn(isOn);
      // Taken back, the camera stays on the view the director was drawing, and the link says which.
      if (!isOn) updateUi({ view: readDirectedView() }, "replace");
    },
    [isDirectorOn, updateUi, readDirectedView],
  );
  // A ship camera is drawn in the Vessel view; picking one takes the camera from the director like any view.
  const setShipCamera = useCallback(
    (camera: ShipCamera) => {
      setShipCameraState(camera);
      setView("vessel");
    },
    [setView],
  );
  const setMode = useCallback(
    (mode: ConsoleMode) => {
      setIsRailOpen(true);
      setModePickCount((count) => count + 1);
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
    let lastSnapshot = clock.getSnapshot();
    const unsubscribe = clock.subscribe(() => {
      const snapshot = clock.getSnapshot();
      const shouldWrite = shouldWriteReplayTime(lastSnapshot, snapshot);
      lastSnapshot = snapshot;
      if (!shouldWrite) return;
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

  // Dragging, pinching or scrolling the 3D view takes the camera from the director; the Director toggle gives it back.
  // Listens to pointer and wheel events on the stage, which React does not own.
  useEffect(() => {
    if (!stageElement || !isDirectorOn) return;
    let press: { clientX: number; clientY: number } | null = null;
    // Only the picture counts: a press on a control or a card over it is not a camera move.
    const isOnPicture = (target: EventTarget | null) => target instanceof Element && target.closest('[data-testid="seabed-view"]') !== null && target.closest("button, a, [role='dialog']") === null;
    const handlePointerDown = (event: PointerEvent) => {
      press = isOnPicture(event.target) ? { clientX: event.clientX, clientY: event.clientY } : null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!press || event.buttons === 0) return;
      if (Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) <= CAMERA_GRAB_SLOP_PX) return;
      press = null;
      setDirectorOn(false);
    };
    const handlePointerEnd = () => {
      press = null;
    };
    const handleWheel = (event: WheelEvent) => {
      if (isOnPicture(event.target)) setDirectorOn(false);
    };
    stageElement.addEventListener("pointerdown", handlePointerDown);
    stageElement.addEventListener("pointermove", handlePointerMove);
    stageElement.addEventListener("pointerup", handlePointerEnd);
    stageElement.addEventListener("pointercancel", handlePointerEnd);
    stageElement.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      stageElement.removeEventListener("pointerdown", handlePointerDown);
      stageElement.removeEventListener("pointermove", handlePointerMove);
      stageElement.removeEventListener("pointerup", handlePointerEnd);
      stageElement.removeEventListener("pointercancel", handlePointerEnd);
      stageElement.removeEventListener("wheel", handleWheel);
    };
  }, [stageElement, isDirectorOn, setDirectorOn]);

  // Runs the cameras through the viewer's port once the 3D view draws: syncs with the viewer, which React does not own.
  // The driver's code (with three.js's math) loads after the viewer, never before the first frame.
  useEffect(() => {
    if (!viewer) return;
    let isCancelled = false;
    let created: CameraDriver | null = null;
    void import("@/lib/seabed/scene/director/camera-driver").then(({ createCameraDriver }) => {
      if (isCancelled) return;
      created = createCameraDriver({
        port: viewer.director,
        shots,
        prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        cutLabels: input.cuts.map((cut) => cut.label),
        readSafeInsets: () => safeInsetsRef.current,
      });
      setDriver(created);
    });
    return () => {
      isCancelled = true;
      created?.dispose();
      setDriver(null);
    };
  }, [viewer, shots, input]);

  // Tells the driver who holds the camera: the director, a ship camera of the vessel card, or the view's own camera.
  const cameraModeKey = isDirectorOn ? "director" : drawnView === "vessel" && shipCamera !== "follow" ? shipCamera : "user";
  useEffect(() => {
    if (!driver) return;
    const mode: CameraMode = cameraModeKey === "director" ? { kind: "director" } : cameraModeKey === "user" ? { kind: "user" } : { kind: "ship", camera: cameraModeKey };
    driver.setMode(mode);
  }, [driver, cameraModeKey]);

  // Keyboard shortcuts (the shortcuts dialog lists them). Listens on the window, which React does not own.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const targetKind = readKeyTargetKind(event.target);
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || targetKind === "text-entry") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isOnControl = target !== null && target.closest("button, a, [role='dialog']") !== null;
      if (event.key === " " && !isOnControl) {
        event.preventDefault();
        clock.toggle();
        return;
      }
      // On the scrubber the arrows step it one minute, natively; everywhere else they jump between events.
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !isOnControl && targetKind !== "slider") {
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
  // The 3D picture frames its subject in the part the floating rail leaves visible.
  const rightInsetPx = isRailFloating ? RAIL_WIDTH_PX + RAIL_INSET_PX : 0;
  const isAnchorCamShown = driver !== null && viewer !== null && isAnchorDown && drawnView !== "closeup";
  const isAnchorCamGrown = isAnchorCamShown && !isPhone && isAnchorCamExpanded;
  // Grown, the anchor cam fits the stage with the folded rail's tab under it: 640 px wide, or as wide as the height
  // allows (a 720 px tall window leaves a 420 px stage), never narrower than at rest.
  const anchorCamGrownWidthPx = stageHeightPx === null ? ANCHOR_CAM_EXPANDED_WIDTH_PX : Math.max(ANCHOR_CAM_WIDTH_PX, Math.min(ANCHOR_CAM_EXPANDED_WIDTH_PX, readAnchorCamWidthForHeightPx(stageHeightPx - STAGE_INSET_PX * 2 - 12 - RAIL_TAB_HEIGHT_PX)));
  const anchorCamWidthPx = isAnchorCamGrown ? anchorCamGrownWidthPx : ANCHOR_CAM_WIDTH_PX;
  // The rail starts under the anchor cam when both stand at the stage's right edge.
  const railTopPx = isAnchorCamShown && !isPhone ? STAGE_INSET_PX + readAnchorCamHeightPx(anchorCamWidthPx) + 12 : STAGE_INSET_PX;
  // Too little room under the anchor cam (a short window, or the window grown): the rail folds to a tab, which stays in
  // the stage even when the window leaves it almost nothing.
  const isRailTabbed = isRailFloating && isAnchorCamShown && (isAnchorCamGrown || (stageHeightPx !== null && stageHeightPx - railTopPx - STAGE_INSET_PX < MIN_RAIL_HEIGHT_PX));
  const railTabTopPx = stageHeightPx === null ? railTopPx : Math.max(STAGE_INSET_PX, Math.min(railTopPx, stageHeightPx - STAGE_INSET_PX - RAIL_TAB_HEIGHT_PX));
  const rightColumnPx = Math.max(isRailFloating ? RAIL_WIDTH_PX + RAIL_INSET_PX * 2 : STAGE_INSET_PX, isAnchorCamShown && !isPhone ? anchorCamWidthPx + RAIL_INSET_PX * 2 : STAGE_INSET_PX);
  // The stage's height, for the rail's room under the anchor cam: follows the window, which React does not own.
  useEffect(() => {
    if (!stageElement) return;
    const measure = () => setStageHeightPx(stageElement.clientHeight);
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(stageElement);
    return () => resizeObserver.disconnect();
  }, [stageElement]);
  const railSummary = (() => {
    switch (ui.mode) {
      case "replay":
        return `${consoleCase.vessel.name}, ${consoleCase.windowDaysLabel} minute by minute`;
      case "ship":
        return `${consoleCase.vessel.name}, vessel inspector`;
      case "evidence":
        return "How the track is placed, cuts and sources";
      default: {
        const unhandledMode: never = ui.mode;
        return unhandledMode;
      }
    }
  })();
  // Hands the new insets to the camera driver, which reads them every frame outside React (a ref, so a change costs no
  // render of its own).
  useEffect(() => {
    safeInsetsRef.current = { left: STAGE_INSET_PX, top: isPhone ? PHONE_TOP_BAND_PX : CONTROLS_BAND_PX, right: rightColumnPx, bottom: CONTROLS_BAND_PX };
  }, [isPhone, rightColumnPx]);

  const controller = useMemo<ConsoleController>(
    () => ({
      input,
      consoleCase,
      series,
      clock,
      ...ui,
      view: drawnView,
      isDirectorOn,
      setDirectorOn,
      shipCamera,
      setShipCamera: driver ? setShipCamera : null,
      directorPort: viewer?.director ?? null,
      isAnchorCamExpanded: isAnchorCamGrown,
      setAnchorCamExpanded,
      setView,
      setMode,
      setDetail,
      openLayer,
      closeLayer,
      seekTo,
      focusTarget,
      caseFileSha256,
    }),
    [input, consoleCase, series, clock, ui, drawnView, isDirectorOn, setDirectorOn, shipCamera, driver, setShipCamera, viewer, isAnchorCamGrown, setView, setMode, setDetail, openLayer, closeLayer, seekTo, focusTarget, caseFileSha256],
  );

  return (
    <ConsoleControllerContext.Provider value={controller}>
        <div className="flex h-dvh flex-col overflow-hidden" data-testid="replay-console">
          <h1 className="sr-only">{consoleCase.title}</h1>
          {/* The first stop of the Tab key: the scrubber otherwise sits behind the top bar, the stage controls and
              every row of the rail. Hidden until focused. */}
          <button
            type="button"
            onClick={() => document.getElementById(REPLAY_SCRUBBER_ID)?.focus()}
            className="sr-only z-(--layer-toast) rounded-full bg-ink text-label whitespace-nowrap text-card focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:flex focus:h-10 focus:items-center focus:px-4"
            data-testid="skip-to-timeline"
          >
            Skip to the replay timeline
          </button>
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
                view={drawnView}
                isIllustrated={ui.detail === "illustrated"}
                rightInsetPx={rightInsetPx}
                onViewerChange={setViewer}
                onTargetPick={openTargetCard}
                still={<CaseStill slug={consoleCase.slug} vesselName={consoleCase.vessel.name} />}
              />
              <StageOverlays
                stageElement={stageElement}
                isCompact={!isWide}
                isRailFloating={isRailFloating}
                railWidthPx={hasFloatingRail ? RAIL_WIDTH_PX + RAIL_INSET_PX * 2 : 0}
                onResetView={() => viewer?.resetView()}
                onShowRail={hasFloatingRail && !isRailOpen ? () => setIsRailOpen(true) : null}
                showRailTopPx={railTopPx}
                sceneSummary={sceneSummary}
              />
              {isAnchorCamShown && driver && viewer && <AnchorCamWindow driver={driver} port={viewer.director} presentation={isPhone ? "phone" : "desktop"} expandedWidthPx={anchorCamGrownWidthPx} />}
              {isRailTabbed && (
                <RailHoverTab
                  tabTopPx={railTabTopPx - STAGE_INSET_PX}
                  widthPx={RAIL_WIDTH_PX}
                  summary={railSummary}
                  openRequest={modePickCount}
                  renderRail={(foldRail) => <ConsoleRail onHide={foldRail} showsCharts={!isWide} />}
                />
              )}
              {isRailFloating && !isRailTabbed && (
                <div
                  className="absolute right-4 bottom-4 z-(--layer-panel) flex flex-col gap-3"
                  style={{ width: RAIL_WIDTH_PX, top: railTopPx }}
                  data-label-blocker="true"
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
