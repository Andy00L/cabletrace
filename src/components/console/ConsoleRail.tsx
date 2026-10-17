"use client";

import { useSyncExternalStore } from "react";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { Icon } from "@/components/icons/Icon";
import { CaseEventList } from "@/components/replay/CaseEventList";
import { formatUtcClock } from "@/lib/replay/format-utc";
import { progressToTimeMs } from "@/lib/replay/replay-scene";
import { findSeriesSample } from "@/lib/cases/case-series";

const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";
const ROW_BUTTON_CLASS = "grid w-full items-center gap-x-3 rounded-field px-2 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-page";

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

/** Replay mode: who the ship is, in three lines, and the minute-by-minute list. */
function ReplayRail({ onHide }: { onHide: (() => void) | null }) {
  const { consoleCase, setMode } = useConsole();
  const { vessel } = consoleCase;
  return (
    <>
      <section className={CARD_CLASS} aria-label="The ship">
        <div className="flex items-center gap-3">
          <ShipSample />
          <h2 className="text-card-title">{vessel.name}</h2>
          <HideButton onHide={onHide} />
        </div>
        <p className="text-small">
          {vessel.type}, {vessel.flag} flag
        </p>
        <p className="text-caption font-normal text-muted">
          {vessel.evidenceBrief}.{" "}
          <button type="button" onClick={() => setMode("ship")} className="font-medium text-ink underline decoration-faint underline-offset-4 hover:decoration-ink">
            Ship details
          </button>
        </p>
      </section>
      <CaseEventList />
    </>
  );
}

/** The replay's current minute; re-renders once a minute of replay time, not every frame. */
function ReplayMinute() {
  const { input, clock } = useConsole();
  const readMinute = () => formatUtcClock(progressToTimeMs(input, clock.getSnapshot().progress));
  return <>{useSyncExternalStore(clock.subscribe, readMinute, readMinute)}</>;
}

/** The numbers derived at the replay moment, re-rendered only when the chart sample under the cursor changes. */
function DerivedNumbers() {
  const { input, series, clock } = useConsole();
  const readSampleIndex = () => (series ? findSeriesSample(series, progressToTimeMs(input, clock.getSnapshot().progress)).index : -1);
  const sampleIndex = useSyncExternalStore(clock.subscribe, readSampleIndex, readSampleIndex);
  const sample = series?.samples[sampleIndex] ?? null;
  const numbers = [
    { label: "Speed", value: sample ? sample.speedKnots.toFixed(1) : "None", unit: sample ? "kn" : "" },
    { label: "Nearest line", value: sample?.nearestLine ? sample.nearestLine.distanceKm.toFixed(1) : "None", unit: sample?.nearestLine ? "km" : "" },
    { label: "Water under", value: sample?.depthMetres !== null && sample?.depthMetres !== undefined ? Math.round(sample.depthMetres).toString() : "None", unit: sample?.depthMetres ? "m" : "" },
  ];
  return (
    <section className={CARD_CLASS} aria-label="Derived at this moment">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-card-title tabular-nums">
          At <ReplayMinute /> UTC
        </h2>
        <span className="text-caption font-normal text-muted">{sample?.basis === "recorded" ? "from AIS" : "derived"}</span>
      </div>
      {sample ? (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {numbers.map((number) => (
              <div key={number.label} className="flex flex-col gap-0.5">
                <dt className="text-caption font-normal text-muted">{number.label}</dt>
                <dd className="text-heading tabular-nums">
                  {number.value}
                  <span className="ml-0.5 text-label text-muted">{number.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-caption font-normal text-muted">
            {sample.basis === "recorded"
              ? "Speed as the ship broadcast it; distance and depth at its AIS position."
              : "Speed is the straight-line average between two placed positions, never a recorded speed; distance and depth are read on that straight line."}
            {sample.nearestLine ? ` Nearest line: ${sample.nearestLine.name}.` : ""}
          </p>
        </>
      ) : (
        <p className="text-small text-muted">No position for the ship at this moment: the track starts later or has ended.</p>
      )}
    </section>
  );
}

/** Ship mode: the full ship card and the numbers derived at the replay moment. */
function ShipRail({ onHide }: { onHide: (() => void) | null }) {
  const { consoleCase } = useConsole();
  const { vessel } = consoleCase;
  const facts = [
    { label: "Type", value: vessel.type },
    { label: "Flag", value: vessel.flag },
    { label: "IMO", value: vessel.imo ?? "Not published" },
    { label: "MMSI", value: vessel.mmsi ?? "Not published" },
  ];
  return (
    <>
      <section className={CARD_CLASS} data-testid="ship-card">
        <div className="flex items-center gap-3">
          <ShipSample />
          <h2 className="text-card-title">{vessel.name}</h2>
          <HideButton onHide={onHide} />
        </div>
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-small">
          {facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted">{fact.label}</dt>
              <dd className="tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-caption font-normal text-muted">{vessel.evidence}</p>
        <CitationButtons citations={vessel.citations} />
      </section>
      <DerivedNumbers />
    </>
  );
}

/** Evidence mode: how each position is placed, the cuts, what followed and every source, each one press away. */
// The first characters of the case file's hash are enough to compare by eye with what the verify script prints.
const SHA256_SHOWN_CHARACTERS = 12;

function EvidenceRail({ onHide }: { onHide: (() => void) | null }) {
  const { consoleCase, openLayer, caseFileSha256 } = useConsole();
  const { recordedTrack } = consoleCase;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <section className={CARD_CLASS} data-testid="placement-card">
        <div className="flex items-center gap-3">
          <h2 className="text-card-title">How the track is placed</h2>
          <HideButton onHide={onHide} />
        </div>
        <ol className="-mx-2 flex flex-col gap-0.5">
          {consoleCase.positions.map((position, index) => (
            <li key={position.atMs}>
              <button type="button" onClick={(event) => openLayer({ kind: "placement", positionIndex: index }, event.currentTarget)} className={`${ROW_BUTTON_CLASS} grid-cols-[48px_minmax(0,1fr)_20px]`}>
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
              <button type="button" onClick={(event) => openLayer({ kind: "cut", cutIndex: index }, event.currentTarget)} className={`${ROW_BUTTON_CLASS} grid-cols-[14px_minmax(0,1fr)_auto]`}>
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

/** The rail's content for the current mode. `onHide` folds the floating rail; null where it cannot fold. */
export function ConsoleRail({ onHide }: { onHide: (() => void) | null }) {
  const { mode } = useConsole();
  switch (mode) {
    case "replay":
      return <ReplayRail onHide={onHide} />;
    case "ship":
      return <ShipRail onHide={onHide} />;
    case "evidence":
      return <EvidenceRail onHide={onHide} />;
    default: {
      const unhandledMode: never = mode;
      return unhandledMode;
    }
  }
}
