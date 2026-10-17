import type { CableCase } from "@/lib/cases/case-file";
import { describeTrackEvidence, formatPublishedDate, formatSourceNote } from "@/lib/cases/case-view";
import { formatUtcClock, formatUtcDate, formatUtcDay, isSameUtcDay } from "@/lib/replay/format-utc";

// The static cards of a case page. Server components: they render once from the case file and ship no JavaScript.

const CARD_CLASS = "flex flex-col gap-4.5 rounded-card bg-card p-6 shadow-card sm:p-7";

/** Who the vessel is, and how its positions are known. */
export function ShipCard({ cableCase }: { cableCase: CableCase }) {
  const { vessel } = cableCase;
  const facts = [
    { label: "Type", value: vessel.type },
    { label: "Flag", value: vessel.flag },
    { label: "IMO", value: vessel.imo ?? "Not published" },
    { label: "MMSI", value: vessel.mmsi ?? "Not published" },
  ];
  return (
    <section className={CARD_CLASS} data-testid="ship-card">
      <div className="flex items-center gap-3.5">
        <svg width="32" height="20" viewBox="0 0 32 20" aria-hidden="true">
          <path d="M2 14 C 10 14, 16 8, 26 7" stroke="var(--color-ink)" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M23 3.5 L29.5 6.5 L24 11" stroke="var(--color-ink)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="text-card-title">{vessel.name}</h2>
      </div>
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-small">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted">{fact.label}</dt>
            <dd className="tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption font-normal text-muted">
        {describeTrackEvidence(cableCase)}{" "}
        <a href="#placement" className="font-medium text-ink underline decoration-faint underline-offset-4">
          How each one is placed
        </a>
        . {formatSourceNote(vessel.citations)}.
      </p>
    </section>
  );
}

/**
 * Each placed position: the place as described, and how the coordinate was derived from it. A recorded AIS
 * stretch closes the list as one entry, with the rows it keeps from the archive.
 */
export function PlacementCard({ cableCase }: { cableCase: CableCase }) {
  const { recordedTrack } = cableCase;
  const firstFix = recordedTrack?.fixes[0];
  const lastFix = recordedTrack?.fixes[recordedTrack.fixes.length - 1];
  // Over a window longer than one UTC day, every time carries its date.
  const isMultiDay = !isSameUtcDay(Date.parse(cableCase.window.startUtc), Date.parse(cableCase.window.endUtc));
  const renderTime = (atUtc: string) => (
    <span className="flex flex-col">
      <span className="text-small font-medium tabular-nums">{formatUtcClock(Date.parse(atUtc))}</span>
      {isMultiDay && <span className="text-micro text-muted tabular-nums">{formatUtcDay(Date.parse(atUtc))}</span>}
    </span>
  );
  return (
    <section id="placement" className={`${CARD_CLASS} scroll-mt-6`} data-testid="placement-card">
      <h2 className="text-card-title">How the track is placed</h2>
      <ol className="flex flex-col gap-4">
        {cableCase.track.map((position) => (
          <li key={position.atUtc} className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1">
            {renderTime(position.atUtc)}
            <span className="text-small font-medium">{position.place}</span>
            <span className="col-start-2 text-caption font-normal text-muted">
              {position.placement} {formatSourceNote(position.citations)}.
            </span>
          </li>
        ))}
        {recordedTrack && firstFix && lastFix && (
          <li className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1" data-testid="recorded-track-entry">
            {renderTime(firstFix.atUtc)}
            <span className="text-small font-medium">
              Recorded AIS to {formatUtcClock(Date.parse(lastFix.atUtc))}, {recordedTrack.fixes.length} positions
            </span>
            <span className="col-start-2 text-caption font-normal text-muted">
              {recordedTrack.selection} {formatSourceNote(recordedTrack.citations)}.
            </span>
          </li>
        )}
      </ol>
    </section>
  );
}

/** Recovery, investigation and court steps after the replay window. */
export function AftermathCard({ cableCase }: { cableCase: CableCase }) {
  if (cableCase.aftermath.length === 0) return null;
  return (
    <section className={CARD_CLASS} data-testid="aftermath-card">
      <h2 className="text-card-title">Since that night</h2>
      <ol className="flex flex-col gap-3">
        {cableCase.aftermath.map((step) => (
          <li key={`${step.atUtc}-${step.title}`} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 text-small">
            <span className="text-muted tabular-nums">{formatUtcDate(Date.parse(step.atUtc))}</span>
            <span>
              {step.title} <span className="text-caption font-normal text-muted">{formatSourceNote(step.citations)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Every source the case cites, numbered as in the research file. */
export function SourceList({ cableCase }: { cableCase: CableCase }) {
  return (
    <section className={CARD_CLASS} data-testid="source-list">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-card-title">Sources</h2>
        <p className="text-caption font-normal text-muted">Every quote in this case is copied from these pages.</p>
      </div>
      <ol className="grid gap-x-7 gap-y-3.5 md:grid-cols-2">
        {cableCase.sources.map((source) => (
          <li key={source.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5">
            <span className="text-caption text-muted tabular-nums">{source.id}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-small font-medium wrap-anywhere text-ink underline decoration-faint underline-offset-4 transition-colors duration-140 ease-standard hover:decoration-ink"
              >
                {source.title}
              </a>
              <span className="text-caption font-normal text-muted">
                {source.publisher}, {formatPublishedDate(source.publishedOn)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
