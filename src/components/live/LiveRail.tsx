"use client";

import { useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { useScrollSelectedIntoView } from "@/components/live/scroll-selected-into-view";
import type { DetectionSummary, ShipDetails } from "@/lib/globe/live-api";
import { describeFlag, readFlagFromMmsi } from "@/lib/globe/ship-identity";
import { shipClassFromAisType } from "@/lib/live/ship-class";
import { SOURCE_CREDITS } from "@/lib/live/frame-layout";
import type { ShipClass, ShipRecord } from "@/lib/live/snapshot-codec";
import { formatUtcClock, formatUtcDate } from "@/lib/replay/format-utc";

const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";
const MS_PER_MINUTE = 60_000;

const SHIP_CLASS_LABELS: Record<ShipClass, string> = {
  unknown: "Type not sent yet",
  cargo: "Cargo ship",
  tanker: "Tanker",
  passenger: "Passenger ship",
  fishing: "Fishing vessel",
  tug: "Tug or towing vessel",
  military: "Military vessel",
  sailing: "Sailing vessel",
  pleasure: "Pleasure craft",
  pilot: "Pilot vessel",
  other: "Other type",
};

export type DetailsState = { kind: "idle" } | { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; details: ShipDetails | null };
export type DetectionsState = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; detections: DetectionSummary[] };

/** The moment on the timeline: how many ships the frame holds and which feed heard them. */
export function MomentCard({ minuteLabel, shipCount, digitrafficCount }: { minuteLabel: string; shipCount: number | null; digitrafficCount: number }) {
  return (
    <section className={CARD_CLASS} aria-label="This moment" data-testid="live-moment">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-card-title">
          At <span className="tabular-nums">{minuteLabel}</span> UTC
        </h2>
        <span className="flex items-center gap-2 text-caption">
          <span className="size-2 rounded-full bg-live" aria-hidden="true" />
          Recorded
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-display tabular-nums" data-testid="live-ship-count">
          {shipCount === null ? "..." : shipCount.toLocaleString("en-US")}
        </p>
        <p className="text-small text-muted">ships heard in this 10-minute frame</p>
      </div>
      {shipCount !== null && (
        <p className="text-caption font-normal text-muted">
          <span className="tabular-nums">{(shipCount - digitrafficCount).toLocaleString("en-US")}</span> from {SOURCE_CREDITS.aisstream},{" "}
          <span className="tabular-nums">{digitrafficCount.toLocaleString("en-US")}</span> from {SOURCE_CREDITS.digitraffic}. Coastal receivers only: where
          the globe is hatched none of them heard a ship. Ships sail there too; no receiver reaches them.
        </p>
      )}
    </section>
  );
}

function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(3)} ${value >= 0 ? positive : negative}`;
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="contents">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

type ShipCardProps = {
  mmsi: number;
  /** The ship's report in the frame on screen, or null when that frame does not hold it. */
  record: ShipRecord | null;
  /** The moment on the timeline, to the minute: a report's age is counted from it. */
  momentMs: number;
  detailsState: DetailsState;
  onFocus: () => void;
  onClose: () => void;
};

/** A report's age as a figure in minutes: "<1", "4", or "1 h 05" past the hour. */
function formatAgeMinutes(ageMs: number): string {
  const minutes = Math.floor(Math.max(0, ageMs) / MS_PER_MINUTE);
  if (minutes < 1) return "<1";
  if (minutes < 60) return String(minutes);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** "228 m long, 32 m wide" from AIS message 5 dimensions; whichever half the feed sent. */
function formatSize(lengthMetres: number | null, beamMetres: number | null): string | null {
  if (lengthMetres && beamMetres) return `${lengthMetres} m long, ${beamMetres} m wide`;
  if (lengthMetres) return `${lengthMetres} m long`;
  if (beamMetres) return `${beamMetres} m wide`;
  return null;
}

/** One of the card's three figures: a big tabular value over a small label. */
function Figure({ value, unit, label }: { value: string; unit: string | null; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-heading tabular-nums">
        {value}
        {unit && <span className="text-label text-muted"> {unit}</span>}
      </p>
      <p className="text-caption font-normal text-muted">{label}</p>
    </div>
  );
}

/**
 * The selected ship: its report in the frame on screen (speed, course, heading, position, age at this moment), its
 * flag from the MMSI's country digits, and its name, type, size, draught and destination when a feed sent them.
 */
export function ShipCard({ mmsi, record, momentMs, detailsState, onFocus, onClose }: ShipCardProps) {
  const details = detailsState.kind === "loaded" ? detailsState.details : null;
  const name = details?.name ?? `MMSI ${mmsi}`;
  // The frame names the class only when the collector knew the type; the details may know it since.
  const shipClass = record && record.shipClass !== "unknown" ? record.shipClass : shipClassFromAisType(details?.shipType ?? null);
  const typeLabel = details?.shipType ? `${SHIP_CLASS_LABELS[shipClass]}, AIS type ${details.shipType}` : SHIP_CLASS_LABELS[shipClass];
  const flag = describeFlag(readFlagFromMmsi(mmsi));
  const ageMs = record ? momentMs - record.reportedAtMs : null;
  return (
    <section className={CARD_CLASS} aria-label="Selected ship" data-testid="live-ship-card" data-mmsi={mmsi}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate text-card-title">{name}</h2>
          <p className="text-caption font-normal text-muted" data-testid="live-ship-type">
            {typeLabel}
            {record ? "" : ". Not heard in this frame"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the ship card" className="ml-auto grid size-9 flex-none place-items-center rounded-full text-muted transition-colors duration-140 ease-standard hover:bg-page hover:text-ink">
          <Icon name="close" />
        </button>
      </div>
      {record && (
        <div className="grid grid-cols-3 gap-3">
          <Figure value={record.speedKnots === null ? "-" : record.speedKnots.toFixed(1)} unit={record.speedKnots === null ? null : "kn"} label={record.speedKnots === null ? "Speed not sent" : "Speed"} />
          <Figure value={record.courseDegrees === null ? "-" : `${Math.round(record.courseDegrees)}\u00B0`} unit={null} label={record.courseDegrees === null ? "Course not sent" : "Course"} />
          <Figure value={ageMs === null ? "-" : formatAgeMinutes(ageMs)} unit="min" label="Since its report" />
        </div>
      )}
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small" data-testid="live-ship-details">
        <DetailRow label="Flag" value={flag} />
        <DetailRow label="Size" value={formatSize(details?.lengthMetres ?? null, details?.beamMetres ?? null)} />
        <DetailRow label="Draught" value={details?.draughtMetres ? `${details.draughtMetres.toFixed(1)} m` : null} />
        <DetailRow label="Destination" value={details?.destination ?? null} />
        <DetailRow label="Heading" value={record === null || record.headingDegrees === null ? null : `${record.headingDegrees}\u00B0`} />
        <DetailRow label="Reported" value={record ? `${formatUtcClock(record.reportedAtMs)} UTC` : null} />
        <DetailRow label="Position" value={record ? `${formatCoordinate(record.latitude, "N", "S")}, ${formatCoordinate(record.longitude, "E", "W")}` : null} />
        <DetailRow label="Call sign" value={details?.callSign ?? null} />
        <DetailRow label="IMO" value={details?.imo ? String(details.imo) : null} />
        <DetailRow label="MMSI" value={details?.name ? String(mmsi) : null} />
      </dl>
      {detailsState.kind === "loading" && <p className="text-caption font-normal text-muted">Looking up the name and size...</p>}
      {detailsState.kind === "loaded" && details === null && <p className="text-caption font-normal text-muted">No feed sent this ship&apos;s name, type or size in the last two days.</p>}
      {detailsState.kind === "loaded" && details?.staticUpdatedMs != null && (
        <p className="text-caption font-normal text-muted tabular-nums">
          Name, type and size as last sent at {formatUtcClock(details.staticUpdatedMs)} UTC on {formatUtcDate(details.staticUpdatedMs)}.
        </p>
      )}
      {detailsState.kind === "failed" && <p className="text-caption font-normal text-muted">The name and size could not be looked up.</p>}
      {record && (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={onFocus}
            className="flex h-9 items-center gap-1.5 rounded-full bg-soft px-3.5 text-label whitespace-nowrap text-ink transition-colors duration-140 ease-standard hover:bg-page"
          >
            <Icon name="follow" />
            Fly to the ship
          </button>
          <span className="text-micro text-faint">
            Position: {SOURCE_CREDITS[record.source]}. Flag: from the MMSI&apos;s country digits (ITU).
          </span>
        </div>
      )}
    </section>
  );
}

/** What the anchor-drag detector ranked in the last day, from the Gulf of Finland recorder. */
export function DetectionsCard({ state, selectedMmsi, onSelect }: { state: DetectionsState; selectedMmsi: number | null; onSelect: (detection: DetectionSummary) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  useScrollSelectedIntoView(listRef, selectedMmsi);
  return (
    <section className={CARD_CLASS} aria-label="Anchor-drag watch" data-testid="live-detections">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-card-title">Anchor-drag watch</h2>
        <p className="text-caption font-normal text-muted">Gulf of Finland, last 24 hours. Ranked by evidence, never a verdict.</p>
      </div>
      {state.kind === "loading" && <p className="text-small text-muted">Loading the detector&apos;s results...</p>}
      {state.kind === "failed" && <p className="text-small text-muted">The detector&apos;s results could not be loaded.</p>}
      {state.kind === "loaded" && state.detections.length === 0 && <p className="text-small text-muted">No ship&apos;s track fit an anchor drag in the last day.</p>}
      {state.kind === "loaded" && state.detections.length > 0 && (
        <ol ref={listRef} className="-mx-2 flex flex-col gap-0.5">
          {state.detections.map((detection) => (
            <li key={detection.id}>
              <button
                type="button"
                onClick={() => onSelect(detection)}
                aria-current={detection.mmsi === selectedMmsi ? "true" : undefined}
                className={`flex w-full flex-col gap-1 rounded-field px-2 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-page ${detection.mmsi === selectedMmsi ? "bg-page" : ""}`}
                data-testid={`live-detection-${detection.id}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`size-2 flex-none rounded-full ${detection.level === "alert" ? "bg-alarm" : "bg-ship"}`} aria-hidden="true" />
                  <span className="truncate text-label">{detection.name ?? `MMSI ${detection.mmsi}`}</span>
                  <span className="ml-auto text-caption font-normal text-muted tabular-nums">
                    {formatUtcClock(detection.startMs)} to {formatUtcClock(detection.endMs)}
                  </span>
                </span>
                <span className="text-caption font-normal text-muted">
                  {detection.level === "alert" ? "Alert" : "Watch"}, score <span className="tabular-nums">{detection.score.toFixed(2)}</span>. {detection.sentences[0] ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
