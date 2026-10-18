"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import { useConsole } from "@/components/console/console-context";
import { StatusIsland } from "@/components/console/StatusIsland";
import { Icon, type IconName } from "@/components/icons/Icon";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import type { SeabedDetail } from "@/lib/console/console-state";
import { LAND_CREDIT } from "@/lib/seabed/scene-credits";
import { CLOSE_UP_SCALE_NOTES, describeOverviewScale, type SceneExaggeration } from "@/lib/seabed/scene-scales";
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
const LEGEND_ITEMS = [
  { label: "Track", stroke: "var(--color-ink)", width: 2 },
  { label: "Anchor drag", stroke: "var(--color-alarm)", width: 3 },
  { label: "Cable", stroke: "var(--color-cable)", width: 2.5 },
  { label: "Pipeline", stroke: "var(--color-pipeline)", width: 3 },
] as const;
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
};

/**
 * Who made the depth grid and mapped the cables and pipelines of the area on screen, as its seabed file credits
 * them, and how much the overview exaggerates its relief (chooseSceneExaggeration).
 */
export type SceneSummary = { depth: string; cables: string; pipelines: string; exaggeration: SceneExaggeration };

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
  sceneSummary: SceneSummary | null;
};

function CameraButton({ icon, label, isPressed, onClick }: { icon: IconName; label: string; isPressed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={isPressed}
      className={`grid size-9 place-items-center rounded-full transition-colors duration-140 ease-standard active:scale-[0.97] ${isPressed ? "bg-soft text-ink" : "text-ink hover:bg-page"}`}
    >
      <Icon name={icon} />
    </button>
  );
}

/** The controls that belong to the picture, inset 16 px inside the stage (board 6). */
export function StageOverlays({ stageElement, isCompact, isRailFloating, railWidthPx, onResetView, onShowRail, sceneSummary }: StageOverlaysProps) {
  const { view, setView, detail, setDetail } = useConsole();
  const [isFullScreen, setIsFullScreen] = useState(false);
  const isCloseUp = view === "closeup";
  const { depth, cables, pipelines, exaggeration } = sceneSummary ?? DEFAULT_SCENE_SUMMARY;
  const scaleNote = isCloseUp ? CLOSE_UP_SCALE_NOTES[detail] : describeOverviewScale(exaggeration);
  // At the cut, both modes' sentences show, the current one first, so neither needs a switch to read.
  const otherCloseUpNote = isCloseUp ? CLOSE_UP_SCALE_NOTES[detail === "measured" ? "illustrated" : "measured"] : null;
  const clearRight = isRailFloating ? railWidthPx : 16;
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

  return (
    <>
      <div className="pointer-events-none absolute top-4 left-4 z-(--layer-stage-controls) flex flex-col items-start gap-2">
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
          className="absolute top-4 right-4 z-(--layer-stage-controls) flex h-10 items-center gap-2 rounded-full bg-card px-3.5 text-label text-ink shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised active:scale-[0.97]"
        >
          <Icon name="panel" />
          Show panel
        </button>
      )}

      <div className="absolute bottom-4 left-4 z-(--layer-stage-controls) flex items-center gap-2">
        <div className={`hidden flex-wrap gap-x-4 gap-y-1.5 rounded-field bg-card px-3.5 py-2.5 text-micro shadow-row ${isCloseUp ? "" : "md:flex"}`}>
          {LEGEND_ITEMS.map((item) => (
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

      <div role="group" aria-label="Camera" className="absolute bottom-4 z-(--layer-stage-controls) flex gap-0.5 rounded-full bg-card p-1 shadow-row" style={{ right: clearRight }}>
        <CameraButton icon="reset" label="Reset the view" onClick={onResetView} />
        <CameraButton icon="follow" label="Follow the ship" isPressed={view === "vessel"} onClick={() => setView(view === "vessel" ? "overview" : "vessel")} />
        <CameraButton icon={isFullScreen ? "exitFullscreen" : "fullscreen"} label={isFullScreen ? "Leave full screen" : "Full screen"} onClick={toggleFullScreen} />
      </div>
    </>
  );
}
