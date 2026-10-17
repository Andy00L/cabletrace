"use client";

import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { describeCourse, describeNearestLine, describeSpeed, NumberGrid, useMomentSample } from "@/components/console/MomentNumbers";
import { Icon } from "@/components/icons/Icon";
import { CloseButton, LayerCard, type LayerAnchor, type LayerCardPlacement } from "@/components/ui/LayerCard";
import { LayerSheet } from "@/components/ui/LayerSheet";
import type { CitationView, ConsoleSource } from "@/lib/cases/case-console";
import { toCutSlug } from "@/lib/console/console-state";
import type { SceneTarget } from "@/lib/seabed/scene/overview";
import type { SeabedViewer } from "@/lib/seabed/scene/viewer";

const SHORTCUTS = [
  { keys: "Space", action: "Play or pause" },
  { keys: "Left and right arrows", action: "Previous or next event (on the scrubber: one minute)" },
  { keys: "1, 2, 3, 4", action: "Overview, From above, Vessel, At the cut" },
  { keys: "F", action: "Follow the ship" },
  { keys: "Esc", action: "Close the card or sheet on top" },
  { keys: "?", action: "This list" },
] as const;
// A card on a 3D object opens beside a box this size (CSS px) around the object's point, and beside its label too.
const SCENE_ANCHOR_BOX_PX = 32;
// Far outside any stage: an anchor parked here hides its card until the object is back in view.
const OFF_VIEW_POSITION_PX = -10_000;
const ACTION_BUTTON_CLASS = "flex h-10 items-center gap-2 rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]";

/**
 * Where a card sits: next to the control that opened it, or, when it was opened by a link or its control has gone
 * (a dialog that closed to open it), near the top middle of the stage.
 */
function createAnchor(opener: HTMLElement | null, stageElement: HTMLElement | null): LayerAnchor | null {
  if (!opener && !stageElement) return null;
  return {
    getBoundingClientRect() {
      if (opener?.isConnected) return opener.getBoundingClientRect();
      const rect = stageElement?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      return new DOMRect(rect.left + rect.width / 2, rect.top + rect.height / 3, 0, 0);
    },
  };
}

/**
 * An anchor on a 3D object, re-read every frame while its card is open: the object's point while it is in view;
 * parked off-stage (the card hides) while it is out of view; `fallback` while the picture does not draw it (the
 * close-up, or the ship before its first position). Tells `onVisibilityChange` when the object leaves the view or
 * comes back, for the Show button.
 */
function createSceneAnchor(input: { viewer: SeabedViewer; target: SceneTarget; fallback: LayerAnchor | null; onVisibilityChange: (isInView: boolean) => void }): LayerAnchor {
  const { viewer, target, fallback, onVisibilityChange } = input;
  // Read every frame, so the change is reported only when it happens.
  let wasInView: boolean | null = null;
  return {
    getBoundingClientRect() {
      const projection = viewer.projectTarget(target);
      const isInView = projection.kind !== "off-view";
      if (isInView !== wasInView) onVisibilityChange(isInView);
      wasInView = isInView;
      switch (projection.kind) {
        case "on-view": {
          const { clientX, clientY, labelRect } = projection;
          const halfBoxPx = SCENE_ANCHOR_BOX_PX / 2;
          const left = Math.min(clientX - halfBoxPx, labelRect?.left ?? Number.POSITIVE_INFINITY);
          const top = Math.min(clientY - halfBoxPx, labelRect?.top ?? Number.POSITIVE_INFINITY);
          const right = Math.max(clientX + halfBoxPx, labelRect?.right ?? Number.NEGATIVE_INFINITY);
          const bottom = Math.max(clientY + halfBoxPx, labelRect?.bottom ?? Number.NEGATIVE_INFINITY);
          return new DOMRect(left, top, right - left, bottom - top);
        }
        case "off-view":
          return new DOMRect(OFF_VIEW_POSITION_PX, OFF_VIEW_POSITION_PX, 0, 0);
        case "not-drawn":
          return fallback?.getBoundingClientRect() ?? new DOMRect(OFF_VIEW_POSITION_PX, OFF_VIEW_POSITION_PX, 0, 0);
        default: {
          const unhandledProjection: never = projection;
          return unhandledProjection;
        }
      }
    },
  };
}

/** The vessel's figures at the replay moment, and what they rest on. */
function VesselMoment() {
  const sample = useMomentSample();
  if (!sample) return <p className="text-small text-muted">No position for the ship at this moment: the track starts later or has ended.</p>;
  return (
    <>
      <NumberGrid numbers={[describeSpeed(sample), describeCourse(sample), describeNearestLine(sample)]} />
      <p className="text-caption font-normal text-muted">
        {sample.basis === "recorded"
          ? "Speed as the ship broadcast it; course and distance from its AIS positions."
          : "Between two placed positions: speed and course are straight-line averages, never recorded."}
        {sample.nearestLine ? ` Nearest line: ${sample.nearestLine.name}.` : ""}
      </p>
    </>
  );
}

function Quote({ citation }: { citation: CitationView }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-field bg-page px-3.5 py-3">
      <p className="text-small">{citation.translation ?? citation.quote}</p>
      {citation.translation && <p className="text-caption font-normal text-muted">{citation.quote}</p>}
    </div>
  );
}

function CardHeader({ eyebrow, title, onClose, mark }: { eyebrow: string; title: string; onClose: () => void; mark?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {mark}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption font-normal text-muted">{eyebrow}</span>
        <h2 className="text-card-title">{title}</h2>
      </div>
      <span className="ml-auto">
        <CloseButton onClick={onClose} />
      </span>
    </div>
  );
}

function SourceLinks({ source }: { source: ConsoleSource }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center gap-2 rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page">
        <Icon name="external" />
        Open the page
      </a>
      {source.archivedUrl && (
        <a href={source.archivedUrl} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center gap-2 rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page">
          <Icon name="archive" />
          Archived copy
        </a>
      )}
    </div>
  );
}

type ConsoleLayersProps = {
  stageElement: HTMLElement | null;
  /** The control the open layer was opened from; null when the 3D view or a link opened it. */
  opener: HTMLElement | null;
  /** The 3D view, for cards that sit on an object in it; null until it draws. */
  viewer: SeabedViewer | null;
  /** Width the floating rail covers at the stage's right edge (CSS px); 0 when it is folded or not floating. */
  stageRightInsetPx: number;
  /** True under 1024 px, where the stage is too narrow for a card beside an object. */
  isStageNarrow: boolean;
};

/** Every card, sheet and dialog the console can open, driven by the `layer` state (one at a time). */
export function ConsoleLayers({ stageElement, opener, viewer, stageRightInsetPx, isStageNarrow }: ConsoleLayersProps) {
  const { consoleCase, layer, closeLayer, seekTo, view, setView, setMode } = useConsole();
  const [sourceFilter, setSourceFilter] = useState("");
  const anchor = useMemo(() => createAnchor(opener, stageElement), [opener, stageElement]);
  // A card opened from the dock opens above it; anything else opens beside its control, toward the stage.
  const cardSide = opener?.closest("[data-console-dock]") ? "top" : "left";
  const controlPlacement: LayerCardPlacement = { boundary: null, side: cardSide, align: cardSide === "top" ? "center" : "start", collisionPadding: 16 };

  // The 3D object the open card sits on: the vessel card always sits on the ship; a cut card sits on its marker when
  // the scene or a link opened it, and beside its control otherwise.
  const sceneTarget = useMemo<SceneTarget | null>(() => {
    if (layer.kind === "vessel") return { kind: "vessel" };
    if (layer.kind === "cut" && opener === null) return { kind: "cut", cutIndex: layer.cutIndex };
    return null;
  }, [layer, opener]);
  // The target whose card is hidden because it left the view; compared by identity, so a new card starts visible.
  const [hiddenTarget, setHiddenTarget] = useState<SceneTarget | null>(null);
  const sceneAnchor = useMemo(() => {
    if (!sceneTarget) return null;
    const stageAnchor = createAnchor(null, stageElement);
    if (!viewer) return stageAnchor;
    return createSceneAnchor({ viewer, target: sceneTarget, fallback: stageAnchor, onVisibilityChange: (isInView) => setHiddenTarget(isInView ? null : sceneTarget) });
  }, [sceneTarget, viewer, stageElement]);
  // A card on an object opens beside it, in the part of the stage the rail leaves clear; a narrow stage has no room
  // beside it, so the card opens under or over it and only has to stay on the screen.
  const scenePlacement: LayerCardPlacement = isStageNarrow
    ? { boundary: null, side: "bottom", align: "center", collisionPadding: 16 }
    : { boundary: stageElement, side: "right", align: "center", collisionPadding: { top: 16, right: 16 + stageRightInsetPx, bottom: 16, left: 16 } };
  const isCutOnScene = sceneTarget?.kind === "cut";

  const filteredSources = useMemo(() => {
    const needle = sourceFilter.trim().toLowerCase();
    return needle === "" ? consoleCase.sources : consoleCase.sources.filter((source) => `${source.title} ${source.publisher}`.toLowerCase().includes(needle));
  }, [consoleCase.sources, sourceFilter]);

  const cut = layer.kind === "cut" ? consoleCase.cuts[layer.cutIndex] : undefined;
  const position = layer.kind === "placement" ? consoleCase.positions[layer.positionIndex] : undefined;
  const source = layer.kind === "source" ? consoleCase.sources.find((candidate) => candidate.id === layer.sourceId) : undefined;
  const { vessel } = consoleCase;

  return (
    <>
      <LayerCard
        isOpen={layer.kind === "cut" && cut !== undefined}
        onClose={closeLayer}
        anchor={isCutOnScene ? sceneAnchor : anchor}
        label={cut ? `${cut.label} cut` : "Cut"}
        {...(isCutOnScene ? scenePlacement : controlPlacement)}
        followsAnchor={isCutOnScene}
        hidesWhenDetached={isCutOnScene}
        testId="cut-card"
      >
        {cut && (
          <>
            <CardHeader
              eyebrow={`${cut.owner}${toCutSlug(cut.cableName).replaceAll("-", "") !== toCutSlug(cut.label).replaceAll("-", "") ? `, ${cut.cableName}` : ""}`}
              title={`${cut.label} cut`}
              onClose={closeLayer}
              mark={
                <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true" className="mt-1 flex-none">
                  <circle cx="7" cy="7" r="5.5" fill="var(--color-card)" stroke="var(--color-alarm)" strokeWidth="2" />
                  <circle cx="7" cy="7" r="2" fill="var(--color-alarm)" />
                </svg>
              }
            />
            <p className="flex items-baseline gap-2">
              <span className="text-heading tabular-nums">{cut.timeLabel}</span>
              <span className="text-label text-muted">UTC{cut.dayLabel ? `, ${cut.dayLabel}` : ""}</span>
            </p>
            <p className="text-caption font-normal text-muted">{cut.placement}</p>
            {cut.citations.map((citation, index) => (
              <Quote key={index} citation={citation} />
            ))}
            <CitationButtons citations={cut.citations} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  seekTo(cut.atMs);
                  setView("closeup");
                }}
                className={ACTION_BUTTON_CLASS}
              >
                Go to the close-up
              </button>
            </div>
          </>
        )}
      </LayerCard>

      <LayerCard isOpen={layer.kind === "placement" && position !== undefined} onClose={closeLayer} anchor={anchor} label="How this position is placed" boundary={null} side={cardSide} testId="placement-popover">
        {position && (
          <>
            <CardHeader eyebrow={`${position.timeLabel} UTC${position.dayLabel ? `, ${position.dayLabel}` : ""}, placed from statements`} title={position.place} onClose={closeLayer} />
            <p className="text-small">{position.placement}</p>
            {position.citations.map((citation, index) => (
              <Quote key={index} citation={citation} />
            ))}
            <CitationButtons citations={position.citations} />
            <button
              type="button"
              onClick={() => seekTo(position.atMs)}
              className={`${ACTION_BUTTON_CLASS} self-start`}
            >
              Move the replay to {position.timeLabel}
            </button>
          </>
        )}
      </LayerCard>

      <LayerCard isOpen={layer.kind === "source" && source !== undefined} onClose={closeLayer} anchor={anchor} label={source ? `Source ${source.id}` : "Source"} boundary={null} side={cardSide} width={380} testId="source-popover">
        {source && (
          <>
            <CardHeader eyebrow={`Source ${source.id}, ${source.publisher}, ${source.publishedLabel}`} title={source.title} onClose={closeLayer} />
            <p className="text-caption font-normal text-muted">Quoted {source.uses.length === 1 ? "once" : `${source.uses.length} times`} in this case:</p>
            <ul className="flex flex-col gap-2">
              {source.uses.map((use, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <span className="text-micro text-muted">{use.supports}</span>
                  <Quote citation={{ sourceId: source.id, quote: use.quote, translation: use.translation }} />
                </li>
              ))}
            </ul>
            <SourceLinks source={source} />
          </>
        )}
      </LayerCard>

      <LayerCard
        isOpen={layer.kind === "vessel"}
        onClose={closeLayer}
        anchor={sceneAnchor}
        label={vessel.name}
        {...scenePlacement}
        followsAnchor
        hidesWhenDetached
        width={340}
        testId="vessel-card"
      >
        <CardHeader eyebrow={`${vessel.type}, ${vessel.flag} flag`} title={vessel.name} onClose={closeLayer} />
        <VesselMoment />
        <p className="text-caption font-normal text-muted">{vessel.evidenceBrief}.</p>
        <CitationButtons citations={vessel.citations} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setView(view === "vessel" ? "overview" : "vessel")} aria-pressed={view === "vessel"} className={ACTION_BUTTON_CLASS} data-testid="vessel-card-follow">
            <Icon name="follow" />
            {view === "vessel" ? "Stop following" : "Follow"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("ship");
              closeLayer();
            }}
            className={ACTION_BUTTON_CLASS}
          >
            Ship details
          </button>
        </div>
      </LayerCard>

      {sceneTarget !== null &&
        hiddenTarget === sceneTarget &&
        stageElement !== null &&
        viewer !== null &&
        createPortal(
          <button
            type="button"
            onClick={() => viewer.centerOnTarget(sceneTarget)}
            // Stacked 8 px over the camera controls (StageOverlays: 16 px from the bottom, 44 px tall), clear of the rail.
            className="absolute bottom-[68px] z-(--layer-stage-controls) flex h-10 items-center gap-2 rounded-full bg-card px-3.5 text-label text-ink shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised active:scale-[0.97]"
            style={{ right: stageRightInsetPx + 16 }}
            data-testid="show-card-target"
          >
            <Icon name="follow" />
            {sceneTarget.kind === "vessel" ? "Show the ship" : "Show the cut"}
          </button>,
          stageElement,
        )}

      <LayerSheet
        isOpen={layer.kind === "sources"}
        onClose={closeLayer}
        title="Sources"
        description={`${consoleCase.sources.length} pages. Every quote in this case is copied from them.`}
        placement="sheet"
        testId="source-list"
      >
        <label className="mb-3 flex h-11 items-center gap-2.5 rounded-field bg-page px-3.5 text-muted focus-within:bg-card focus-within:shadow-[0_0_0_2px_var(--color-ink)]">
          <Icon name="search" />
          <span className="sr-only">Filter sources</span>
          <input
            type="search"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            placeholder="Filter by title or publisher"
            className="min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-muted"
          />
        </label>
        {filteredSources.length === 0 && <p className="px-2 py-4 text-small text-muted">No source title or publisher contains {sourceFilter.trim()}.</p>}
        <ol className="flex flex-col gap-1">
          {filteredSources.map((entry) => (
            <li key={entry.id}>
              <details className="group rounded-field transition-colors duration-140 ease-standard open:bg-page">
                <summary className="grid cursor-pointer list-none grid-cols-[28px_minmax(0,1fr)_20px] gap-x-2.5 rounded-field px-2.5 py-3 hover:bg-page">
                  <span className="text-caption text-muted tabular-nums">{entry.id}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-small font-medium wrap-anywhere">{entry.title}</span>
                    <span className="text-caption font-normal text-muted">
                      {entry.publisher}, {entry.publishedLabel}
                    </span>
                  </span>
                  <Icon name="chevronDown" className="mt-0.5 text-muted transition-transform duration-220 ease-standard group-open:rotate-180" />
                </summary>
                <div className="flex flex-col gap-2.5 px-2.5 pt-1 pb-3.5 pl-[48px]">
                  {entry.uses.map((use, index) => (
                    <div key={index} className="flex flex-col gap-1">
                      <span className="text-micro text-muted">{use.supports}</span>
                      <p className="rounded-field bg-card px-3 py-2.5 text-small">{use.translation ?? use.quote}</p>
                    </div>
                  ))}
                  <SourceLinks source={entry} />
                </div>
              </details>
            </li>
          ))}
        </ol>
      </LayerSheet>

      <LayerSheet isOpen={layer.kind === "aftermath"} onClose={closeLayer} title="What followed" description="Recovery, investigation and court steps after the replay window, as the sources state them." placement="dialog" testId="aftermath-card">
        <ol className="flex flex-col gap-1">
          {consoleCase.aftermath.map((step) => (
            <li key={`${step.atMs}-${step.title}`} className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 rounded-field px-2 py-2.5">
              <span className="text-small text-muted tabular-nums">{step.dateLabel}</span>
              <span className="flex flex-col gap-1">
                <span className="text-small">{step.title}</span>
                <CitationButtons citations={step.citations} />
              </span>
            </li>
          ))}
        </ol>
      </LayerSheet>

      <LayerSheet isOpen={layer.kind === "shortcuts"} onClose={closeLayer} title="Keyboard shortcuts" description="They work anywhere in the console except inside a text field." placement="dialog" testId="shortcuts-dialog">
        <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 gap-y-3 text-small">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="contents">
              <dt className="font-medium">{shortcut.keys}</dt>
              <dd className="text-muted">{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </LayerSheet>
    </>
  );
}
