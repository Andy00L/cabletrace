"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import type { GlobeIncident } from "@/lib/globe/incidents";
import { formatUtcClock } from "@/lib/replay/format-utc";

const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";

/** The break marker the globe draws at each incident (docs/UI_DESIGN_SYSTEM.md, Signature element), as a list glyph. */
function BreakMarker() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="flex-none">
      <circle cx="7" cy="7" r="6.5" fill="var(--color-card)" stroke="var(--color-soft)" strokeWidth="1" />
      <circle cx="7" cy="7" r="4.6" fill="none" stroke="var(--color-alarm)" strokeWidth="1.4" />
      <circle cx="7" cy="7" r="1.8" fill="var(--color-alarm)" />
    </svg>
  );
}

type IncidentCardProps = {
  incident: GlobeIncident;
  /** Flies down to the cut and on into the case's replay; absent while that is not possible. */
  onDive?: () => void;
  onClose: () => void;
};

/** The selected incident: the ship, the cut and when, and the way into its case. */
export function IncidentCard({ incident, onDive, onClose }: IncidentCardProps) {
  return (
    <section className={CARD_CLASS} aria-label="Selected incident" data-testid="live-incident-card" data-slug={incident.slug}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-card-title">{incident.title}</h2>
          <p className="text-caption font-normal text-muted tabular-nums">
            {incident.dateLabel}, {formatUtcClock(incident.cutAtMs)} UTC
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the incident card" className="ml-auto grid size-9 flex-none place-items-center rounded-full text-muted transition-colors duration-140 ease-standard hover:bg-page hover:text-ink">
          <Icon name="close" />
        </button>
      </div>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small">
        <dt className="text-muted">Ship</dt>
        <dd>
          {incident.vesselName}, {incident.vesselType.toLowerCase()}, {incident.vesselFlag} flag
        </dd>
        <dt className="text-muted">Cut</dt>
        <dd>
          {incident.cutLabel}
          {incident.otherCutCount > 0 ? `, and ${incident.otherCutCount} more ${incident.otherCutCount === 1 ? "line" : "lines"}` : ""}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onDive && (
          <button
            type="button"
            onClick={onDive}
            className="flex h-10 items-center gap-1.5 rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]"
            data-testid="live-incident-dive"
          >
            <Icon name="follow" />
            Fly to the seabed
          </button>
        )}
        <Link
          href={incident.caseHref}
          className="flex min-h-10 items-center text-label text-ink underline decoration-faint underline-offset-4 transition-colors duration-140 ease-standard hover:decoration-ink"
          data-testid="live-incident-link"
        >
          Open the case
        </Link>
      </div>
    </section>
  );
}

/** Every case on file, each row selecting its marker on the globe. */
export function IncidentsCard({ incidents, selectedSlug, onSelect }: { incidents: readonly GlobeIncident[]; selectedSlug: string | null; onSelect: (slug: string) => void }) {
  return (
    <section className={CARD_CLASS} aria-label="Cable cuts on file" data-testid="live-incidents">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-card-title">Cable cuts on file</h2>
        <p className="text-caption font-normal text-muted">Each case replays a cut ship by ship. The globe marks where it happened.</p>
      </div>
      <ol className="-mx-2 flex flex-col gap-0.5">
        {incidents.map((incident) => {
          const isSelected = incident.slug === selectedSlug;
          return (
            <li key={incident.slug}>
              <button
                type="button"
                onClick={() => onSelect(incident.slug)}
                aria-current={isSelected ? "true" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-field px-2 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-page ${isSelected ? "bg-page" : ""}`}
                data-testid={`live-incident-${incident.slug}`}
              >
                <BreakMarker />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-label">{incident.vesselName}</span>
                  <span className="truncate text-caption font-normal text-muted">{incident.cutLabel}</span>
                </span>
                <span className="ml-auto flex-none text-caption font-normal text-muted tabular-nums">{incident.dateLabel}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
