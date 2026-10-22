"use client";

import dynamic from "next/dynamic";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { CaseCharts } from "@/components/console/ConsoleDock";
import { ShipCameraSwitch } from "@/components/console/ShipCameraSwitch";
import { Icon } from "@/components/icons/Icon";
import { CaseEventList } from "@/components/replay/CaseEventList";
import { formatUtcClock } from "@/lib/replay/format-utc";

// The inspector and the AIS strip load with Ship mode, in their own chunk: home prefetches the console's route chunks
// for its case links, and home's JS budget (docs/PERFORMANCE.md) has no room for them. Each placeholder keeps the
// card's height so nothing below it moves when it arrives.
const VesselInspector = dynamic(() => import("@/components/console/VesselInspector").then((module) => module.VesselInspector), {
  ssr: false,
  loading: () => <div className="h-[384px]" aria-hidden="true" />,
});
const AisSignalCard = dynamic(() => import("@/components/console/AisSignalStrip").then((module) => module.AisSignalCard), {
  ssr: false,
  loading: () => <div className="h-[168px] flex-none rounded-row bg-card shadow-card" aria-hidden="true" />,
});

const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";
// Each mode's rail scrolls inside itself on a short stage. Its 24 px foot lets the last card scroll clear of the edge.
// It is exactly as wide as the cards, with their corners, so a card scrolled past its top edge is cut on the cards' own
// curve, not on a straight line (Andy, 22 Oct 2026), and it draws no scrollbar: a native bar would need a gutter past
// the cards, where the clip's corner no longer meets theirs. The wheel, touch, the keyboard and focus still scroll it,
// and the card cut at its foot shows there is more. No fade mask on it: over the 3D view a mask is composited again
// every frame, 5 fps on Windows Chrome's integrated GPU (57 to 52 fps playing, 21 Oct 2026).
const RAIL_SCROLL_CLASS = "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-row pb-6 [scrollbar-width:none]";
const ROW_BUTTON_CLASS = "grid w-full items-center gap-x-3 rounded-field px-2 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-page aria-[current=true]:bg-soft";

function ShipSample() {
  return (
    <svg width="32" height="20" viewBox="0 0 32 20" aria-hidden="true" className="flex-none">
      <path d="M2 14 C 10 14, 16 8, 26 7" stroke="var(--color-ink)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M23 3.5 L29.5 6.5 L24 11" stroke="var(--color-ink)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CutMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="flex-none">
      <circle cx="7" cy="7" r="5.5" fill="var(--color-card)" stroke="var(--color-alarm)" strokeWidth="2" />
      <circle cx="7" cy="7" r="2" fill="var(--color-alarm)" />
    </svg>
  );
}

/** Folds the floating rail so the 3D view gets the whole stage. */
function HideButton({ onHide }: { onHide: (() => void) | null }) {
  if (!onHide) return null;
  return (
    <button type="button" onClick={onHide} aria-label="Hide panel" className="ml-auto grid size-9 flex-none place-items-center rounded-full text-muted transition-colors duration-140 ease-standard hover:bg-page hover:text-ink">
      <Icon name="panel" />
    </button>
  );
}

/** The ship's name, which opens the vessel card on the ship in the 3D view: the keyboard path to the ship in the scene. */
function ShipHeading({ onHide }: { onHide: (() => void) | null }) {
  const { consoleCase, openLayer, layer } = useConsole();
  return (
    <div className="flex items-center gap-3">
      <h2 className="min-w-0 text-card-title">
        <button
          type="button"
          onClick={(event) => openLayer({ kind: "vessel" }, event.currentTarget)}
          title="Show the vessel card on the ship"
          aria-current={layer.kind === "vessel" ? "true" : undefined}
          className="-mx-2 -my-1 flex items-center gap-3 rounded-field px-2 py-1 text-left transition-colors duration-140 ease-standard hover:bg-page aria-[current=true]:bg-soft"
          data-testid="open-vessel-card"
        >
          <ShipSample />
          {consoleCase.vessel.name}
          <Icon name="chevronRight" className="text-muted" />
        </button>
      </h2>
      <HideButton onHide={onHide} />
    </div>
  );
}

/**
 * Replay mode: who the ship is, in three lines, and the minute-by-minute list. The list keeps room for a few rows; on
 * a short stage (a 720 px tall laptop) the rail scrolls instead of squeezing it to its title.
 */
function ReplayRail({ onHide }: { onHide: (() => void) | null }) {
  const { consoleCase, setMode } = useConsole();
  const { vessel } = consoleCase;
  return (
    <div className={RAIL_SCROLL_CLASS}>
      <section className={`${CARD_CLASS} flex-none`} aria-label="The ship">
        <ShipHeading onHide={onHide} />
        <p className="text-small">
          {vessel.type}, {vessel.flag} flag
        </p>
        <ShipCameraSwitch />
        <p className="text-caption font-normal text-muted">
          {vessel.evidenceBrief}.{" "}
          <button type="button" onClick={() => setMode("ship")} className="font-medium text-brass underline decoration-brass/40 underline-offset-4 hover:decoration-brass">
            Ship details
          </button>
        </p>
      </section>
      <CaseEventList />
    </div>
  );
}

/**
 * Ship mode: the vessel inspector under the ship's name (profile, anchor, figures at the replay moment), the AIS
 * signal strip, and the charts when the dock has none. Scrolls inside itself when the stage is short.
 */
function ShipRail({ onHide, showsCharts }: { onHide: (() => void) | null; showsCharts: boolean }) {
  const { series } = useConsole();
  return (
    <div className={RAIL_SCROLL_CLASS}>
      <section className={`${CARD_CLASS} flex-none`} aria-label="Vessel inspector" data-testid="ship-card">
        <ShipHeading onHide={onHide} />
        <VesselInspector />
      </section>
      <AisSignalCard />
      {showsCharts && series && (
        <section className={`${CARD_CLASS} flex-none`} aria-label="Charts on the replay's time axis">
          <CaseCharts series={series} isStacked surface="card" />
        </section>
      )}
    </div>
  );
}

/** Evidence mode: how each position is placed, the cuts, what followed and every source, each one press away. */
// The first characters of the case file's hash are enough to compare by eye with what the verify script prints.
const SHA256_SHOWN_CHARACTERS = 12;

function EvidenceRail({ onHide }: { onHide: (() => void) | null }) {
  const { consoleCase, openLayer, focusTarget, layer, caseFileSha256 } = useConsole();
  const { recordedTrack } = consoleCase;
  return (
    <div className={RAIL_SCROLL_CLASS}>
      <section className={CARD_CLASS} data-testid="placement-card">
        <div className="flex items-center gap-3">
          <h2 className="text-card-title">How the track is placed</h2>
          <HideButton onHide={onHide} />
        </div>
        <ol className="-mx-2 flex flex-col gap-0.5">
          {consoleCase.positions.map((position, index) => (
            <li key={position.atMs}>
              <button
                type="button"
                onClick={(event) => {
                  openLayer({ kind: "placement", positionIndex: index }, event.currentTarget);
                  focusTarget({ kind: "placement", positionIndex: index });
                }}
                aria-current={layer.kind === "placement" && layer.positionIndex === index ? "true" : undefined}
                className={`${ROW_BUTTON_CLASS} grid-cols-[48px_minmax(0,1fr)_20px]`}
              >
                <span className="flex flex-col">
                  <span className="text-small font-medium tabular-nums">{position.timeLabel}</span>
                  {position.dayLabel && <span className="text-micro text-muted tabular-nums">{position.dayLabel}</span>}
                </span>
                <span className="text-small">{position.place}</span>
                <Icon name="chevronRight" className="text-muted" />
              </button>
            </li>
          ))}
          {recordedTrack && (
            <li className="flex flex-col gap-1 px-2 py-2.5" data-testid="recorded-track-entry">
              <span className="text-small font-medium">
                Recorded AIS from {formatUtcClock(recordedTrack.firstFixMs)} to {formatUtcClock(recordedTrack.lastFixMs)}, {recordedTrack.fixCount} positions
              </span>
              <span className="text-caption font-normal text-muted">{recordedTrack.selection}</span>
              <CitationButtons citations={recordedTrack.citations} />
            </li>
          )}
        </ol>
      </section>
      <section className={CARD_CLASS}>
        <h2 className="text-card-title">Cuts</h2>
        <ol className="-mx-2 flex flex-col gap-0.5">
          {consoleCase.cuts.map((cut, index) => (
            <li key={cut.slug}>
              <button
                type="button"
                onClick={(event) => {
                  openLayer({ kind: "cut", cutIndex: index }, event.currentTarget);
                  focusTarget({ kind: "cut", cutIndex: index });
                }}
                aria-current={layer.kind === "cut" && layer.cutIndex === index ? "true" : undefined}
                className={`${ROW_BUTTON_CLASS} grid-cols-[14px_minmax(0,1fr)_auto]`}
              >
                <CutMark />
                <span className="text-small">
                  {cut.label}, {cut.owner}
                </span>
                <span className="text-small text-muted tabular-nums">{cut.timeLabel}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className={`${CARD_CLASS} px-3 py-2.5`}>
        {consoleCase.aftermath.length > 0 && (
          <button type="button" onClick={(event) => openLayer({ kind: "aftermath" }, event.currentTarget)} className={`${ROW_BUTTON_CLASS} grid-cols-[minmax(0,1fr)_auto_20px]`} data-testid="open-aftermath">
            <span className="text-label">What followed</span>
            <span className="text-small text-muted tabular-nums">{consoleCase.aftermath.length} steps</span>
            <Icon name="chevronRight" className="text-muted" />
          </button>
        )}
        <button type="button" onClick={(event) => openLayer({ kind: "sources" }, event.currentTarget)} className={`${ROW_BUTTON_CLASS} grid-cols-[minmax(0,1fr)_auto_20px]`} data-testid="open-sources">
          <span className="text-label">All sources</span>
          <span className="text-small text-muted tabular-nums">{consoleCase.sources.length}</span>
          <Icon name="chevronRight" className="text-muted" />
        </button>
        <a
          href={`/cases/${consoleCase.slug}/case-file`}
          download={`cabletrace-${consoleCase.slug}.json`}
          className={`${ROW_BUTTON_CLASS} grid-cols-[minmax(0,1fr)_auto_20px]`}
          data-testid="download-case-file"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-label">Case file</span>
            <span className="truncate text-caption font-normal text-muted">JSON with every position, quote and source</span>
          </span>
          {caseFileSha256 ? (
            <span className="text-micro text-muted tabular-nums" title={`SHA-256 ${caseFileSha256}`}>
              {caseFileSha256.slice(0, SHA256_SHOWN_CHARACTERS)}
            </span>
          ) : (
            <span />
          )}
          <Icon name="archive" className="text-muted" />
        </a>
      </section>
    </div>
  );
}

/**
 * The rail's content for the current mode. `onHide` folds the floating rail; null where it cannot fold. `showsCharts`
 * puts the three charts in Ship mode, for layouts whose dock has no room for them.
 */
export function ConsoleRail({ onHide, showsCharts }: { onHide: (() => void) | null; showsCharts: boolean }) {
  const { mode } = useConsole();
  switch (mode) {
    case "replay":
      return <ReplayRail onHide={onHide} />;
    case "ship":
      return <ShipRail onHide={onHide} showsCharts={showsCharts} />;
    case "evidence":
      return <EvidenceRail onHide={onHide} />;
    default: {
      const unhandledMode: never = mode;
      return unhandledMode;
    }
  }
}
