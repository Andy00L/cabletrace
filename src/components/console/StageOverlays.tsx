"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import { useConsole } from "@/components/console/console-context";
import { StageHoverReadout } from "@/components/console/StageHoverReadout";
import { StatusIsland } from "@/components/console/StatusIsland";
import { Icon, type IconName } from "@/components/icons/Icon";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import type { SeabedDetail } from "@/lib/console/console-state";
import type { DrawnLineKinds } from "@/lib/seabed/load-seabed-summary";
import { LAND_CREDIT } from "@/lib/seabed/scene-credits";
import { CLOSE_UP_SCALE_NOTES, describeOverviewScale, type SceneExaggeration } from "@/lib/seabed/scene-scales";
import { planViewReset } from "@/lib/seabed/scene/director/view-reset";
import type { SeabedViewName } from "@/lib/seabed/scene/viewer";

const VIEW_OPTIONS: readonly SegmentOption<SeabedViewName>[] = [
  { value: "overview", label: "Overview" },
  { value: "top", label: "From above" },
  { value: "vessel", label: "Vessel" },
  { value: "closeup", label: "At the cut" },
];
// The same views with short names, for a stage too narrow for the full ones on one row (a phone).
const COMPACT_VIEW_OPTIONS: readonly SegmentOption<SeabedViewName>[] = [
  { value: "overview", label: "Overview" },
  { value: "top", label: "Above" },
  { value: "vessel", label: "Vessel" },
  { value: "closeup", label: "Cut" },
];
const DETAIL_OPTIONS: readonly SegmentOption<SeabedDetail>[] = [
  { value: "measured", label: "Measured" },
  { value: "illustrated", label: "Illustrated" },
];
// The legend's lines; a kind the area does not draw (`drawnKind`) is left out, so the legend never names a missing line.
const LEGEND_ITEMS = [
  { label: "Track", stroke: "var(--color-ink)", width: 2, drawnKind: null },
  { label: "Anchor drag", stroke: "var(--color-alarm)", width: 3, drawnKind: null },
  { label: "Cable", stroke: "var(--color-cable)", width: 2.5, drawnKind: "hasCables" },
  { label: "Pipeline", stroke: "var(--color-pipeline)", width: 3, drawnKind: "hasPipelines" },
] as const satisfies readonly { label: string; stroke: string; width: number; drawnKind: keyof DrawnLineKinds | null }[];
// Credits for the data drawn in the view (docs/UI_DESIGN_SYSTEM.md, Map sources and credits). The land line is fixed
// (src/lib/seabed/scene-credits.ts). Depth, cables and pipelines come from each area's seabed file
// (scripts/seabed/build-seabed.ts writes them): an area outside Europe has its depth from another grid, and a route
// traced off a published map names it.
// The Gulf of Finland's credits and scale, for an area whose seabed file could not be read.
const DEFAULT_SCENE_SUMMARY: SceneSummary = {
  depth: "EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024), CC BY 4.0",
  cables: "OpenStreetMap contributors",
  pipelines: "EMODnet Human Activities",
  exaggeration: { water: 20, land: 10 },
  drawnLineKinds: { hasCables: true, hasPipelines: true },
};

/**
 * Who made the depth grid and mapped the cables and pipelines of the area on screen, as its seabed file credits
 * them, how much the overview exaggerates its relief (chooseSceneExaggeration), and which kinds of line it draws.
 */
export type SceneSummary = { depth: string; cables: string; pipelines: string; exaggeration: SceneExaggeration; drawnLineKinds: DrawnLineKinds };

type StageOverlaysProps = {
  stageElement: HTMLElement | null;
  /** True on a narrow screen: short view names. */
  isCompact: boolean;
  isRailFloating: boolean;
  /** Room the rail takes at the stage's right edge (CSS px), so the controls stay in the clear part. */
  railWidthPx: number;
  onResetView: () => void;
  /** Shows the folded rail again; null when the rail is open or not floating. */
  onShowRail: (() => void) | null;
  /** Where the Show panel button sits from the stage's top (CSS px): under the anchor cam while it is on screen. */
  showRailTopPx: number;
  sceneSummary: SceneSummary | null;
};

// The reset button's tooltip while the director holds the camera, and on the follow camera, which has nothing to undo.
const RESET_TITLE_DIRECTED = "Stop the director and frame this view as it opens";
const RESET_TITLE_FOLLOW = "The Vessel view follows the ship: nothing to reset";

function CameraButton({ icon, label, onClick, title, isDisabled = false, testId }: { icon: IconName; label: string; onClick: () => void; title?: string; isDisabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      disabled={isDisabled}
      data-testid={testId}
      className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-140 ease-standard enabled:hover:bg-page enabled:active:scale-[0.97] disabled:text-faint"
    >
      <Icon name={icon} />
    </button>
  );
}

/** The controls that belong to the picture, inset 16 px inside the stage (board 6). */
export function StageOverlays({ stageElement, isCompact, isRailFloating, railWidthPx, onResetView, onShowRail, showRailTopPx, sceneSummary }: StageOverlaysProps) {
  const { view, setView, detail, setDetail, isDirectorOn, setDirectorOn, shipCamera, setShipCamera } = useConsole();
  const [isFullScreen, setIsFullScreen] = useState(false);
  const isCloseUp = view === "closeup";
  const { depth, cables, pipelines, exaggeration, drawnLineKinds } = sceneSummary ?? DEFAULT_SCENE_SUMMARY;
  const legendItems = LEGEND_ITEMS.filter((item) => item.drawnKind === null || drawnLineKinds[item.drawnKind]);
  const scaleNote = isCloseUp ? CLOSE_UP_SCALE_NOTES[detail] : describeOverviewScale(exaggeration);
  // At the cut, both modes' sentences show, the current one first, so neither needs a switch to read.
  const otherCloseUpNote = isCloseUp ? CLOSE_UP_SCALE_NOTES[detail === "measured" ? "illustrated" : "measured"] : null;
  const clearRight = isRailFloating ? railWidthPx : 16;
  const viewReset = planViewReset({ view, isDirectorOn, shipCamera });
  const sceneCredits = [`Depth: ${depth}.`, LAND_CREDIT, `Cables: ${cables}. Pipelines: ${pipelines}. OpenStreetMap data is under the ODbL.`];

  // Tracks the browser's full-screen state, which React does not own (Esc can leave it too).
  useEffect(() => {
    const update = () => setIsFullScreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  function toggleFullScreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    stageElement?.requestFullscreen().catch((error: unknown) => console.error(`[StageOverlays] full screen refused: ${error instanceof Error ? error.message : String(error)}`));
  }

  // The view goes back to its preset only once nothing else holds the camera (planViewReset); the director's and the
  // ship camera's release reach the camera driver before its next frame (React flushes a click's effects at once).
  function resetView() {
    if (viewReset.kind === "nothing-to-reset") return;
    if (viewReset.releasesDirector) setDirectorOn(false);
    if (viewReset.releasesShipCamera) setShipCamera?.("follow");
    onResetView();
  }

  return (
    <>
      <StageHoverReadout stageElement={stageElement} />

      <div className="pointer-events-none absolute top-4 left-4 z-(--layer-stage-controls) flex flex-col items-start gap-2" data-label-blocker="true">
        <div className="pointer-events-auto rounded-full shadow-row">
          <SegmentedControl label="View" options={isCompact ? COMPACT_VIEW_OPTIONS : VIEW_OPTIONS} value={view} onChange={setView} testId="view-switch" />
        </div>
        {isCloseUp && (
          <div className="pointer-events-auto rounded-full shadow-row">
            <SegmentedControl label="Seabed detail" options={DETAIL_OPTIONS} value={detail} onChange={setDetail} testId="detail-switch" />
          </div>
        )}
      </div>

      <StatusIsland isCloseUp={isCloseUp} />

      {onShowRail && (
        <button
          type="button"
          onClick={onShowRail}
          className="absolute right-4 z-(--layer-stage-controls) flex h-10 items-center gap-2 rounded-full bg-card px-3.5 text-label text-ink shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised active:scale-[0.97]"
          style={{ top: showRailTopPx }}
          data-label-blocker="true"
        >
          <Icon name="panel" />
          Show panel
        </button>
      )}

      <div className="absolute bottom-4 left-4 z-(--layer-stage-controls) flex items-center gap-2" data-label-blocker="true">
        <div className={`hidden flex-wrap gap-x-4 gap-y-1.5 rounded-field bg-card px-3.5 py-2.5 text-micro shadow-row ${isCloseUp ? "" : "md:flex"}`}>
          {legendItems.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
                <path d="M1 4 H21" stroke={item.stroke} strokeWidth={item.width} strokeLinecap="round" />
              </svg>
              {item.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="var(--color-card)" stroke="var(--color-alarm)" strokeWidth="2" />
              <circle cx="7" cy="7" r="2" fill="var(--color-alarm)" />
            </svg>
            Cut
          </span>
        </div>
        <Popover.Root>
          <Popover.Trigger
            aria-label="Scale and data credits"
            className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised data-[state=open]:shadow-selected"
            data-testid="scale-info"
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
              <p className="text-label">How the view is drawn</p>
              <p className="text-small" data-testid="scale-note">
                {scaleNote}
              </p>
              {otherCloseUpNote && <p className="text-caption font-normal text-muted">{otherCloseUpNote}</p>}
              <ul className="flex flex-col gap-1.5 text-caption font-normal text-muted">
                {sceneCredits.map((credit) => (
                  <li key={credit}>{credit}</li>
                ))}
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div role="group" aria-label="Camera" className="absolute bottom-4 z-(--layer-stage-controls) flex items-center gap-0.5 rounded-full bg-card p-1 shadow-row" style={{ right: clearRight }} data-label-blocker="true">
        {/* The one ink control of the stage while it directs (board 22); dragging the view turns it off. */}
        <button
          type="button"
          onClick={() => setDirectorOn(!isDirectorOn)}
          aria-pressed={isDirectorOn}
          title={isDirectorOn ? "The camera follows the story; drag the view to take it" : "Let the camera follow the story"}
          className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-label transition-colors duration-140 ease-standard active:scale-[0.97] ${isDirectorOn ? "bg-ink text-card hover:bg-ink-hover" : "text-ink hover:bg-page"}`}
          data-testid="director-toggle"
          data-state={isDirectorOn ? "on" : "off"}
        >
          <Icon name="director" size={18} />
          Director
        </button>
        <CameraButton
          icon="reset"
          label="Reset the view"
          onClick={resetView}
          title={viewReset.kind === "nothing-to-reset" ? RESET_TITLE_FOLLOW : viewReset.releasesDirector ? RESET_TITLE_DIRECTED : undefined}
          isDisabled={viewReset.kind === "nothing-to-reset"}
          testId="reset-view"
        />
        <CameraButton icon={isFullScreen ? "exitFullscreen" : "fullscreen"} label={isFullScreen ? "Leave full screen" : "Full screen"} onClick={toggleFullScreen} />
      </div>
    </>
  );
}
