"use client";

import { useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { useScrollSelectedIntoView } from "@/components/live/scroll-selected-into-view";
import type { RankBasis } from "@/lib/fault-signals/draft-case";
import type { DraftCaseSummary } from "@/lib/fault-signals/fault-api";
import type { SignalSource } from "@/lib/fault-signals/fault-signal-types";
import { formatUtcClock, formatUtcDay, isSameUtcDay } from "@/lib/replay/format-utc";

const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";
// The card lists the first three ranked ships of each draft, as public.recent_draft_cases returns them.
const TOP_SHIP_COUNT = 3;
// The window the card asks for (fetchRecentDraftCases, 1 to 365 days).
export const DRAFT_CASE_DAYS = 30;

export type DraftCasesState = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; drafts: DraftCaseSummary[] };

// Why a ship sits at its rank, in a few words (the order and meaning of src/lib/fault-signals/draft-case.ts, RankBasis).
const BASIS_LABELS: Readonly<Record<RankBasis, string>> = {
  "drag-at-fault": "Anchor-drag track crosses the cable in the fault span",
  "unjudged-at-fault": "At the cable in the fault span, too few reports to judge",
  "drag-elsewhere": "Anchor-drag track elsewhere or at another time",
  unjudged: "Near the cable, too few reports to judge",
  "no-fit": "Judged track with no drag signature",
  "outside-drag-band": "Never in the drag speed band",
  "not-eligible": "Working or small craft, outside the detector's rules",
};

const SOURCE_LABELS: Readonly<Record<SignalSource, string>> = {
  "nga-warning": "NGA navigational warning",
  "ioda-alert": "IODA outage alert",
  "entsoe-unavailability": "ENTSO-E unavailability notice",
  "nordpool-umm": "Nord Pool market message",
  "operator-notice": "Operator notice",
};

/** "25 Dec, 10:20 to 10:30 UTC" or "17 Nov, 22:00 to 18 Nov, 06:00 UTC". */
function formatFaultSpan(fromMs: number, toMs: number): string {
  if (isSameUtcDay(fromMs, toMs)) return `${formatUtcDay(fromMs)}, ${formatUtcClock(fromMs)} to ${formatUtcClock(toMs)} UTC`;
  return `${formatUtcDay(fromMs)}, ${formatUtcClock(fromMs)} to ${formatUtcDay(toMs)}, ${formatUtcClock(toMs)} UTC`;
}

type DraftCasesCardProps = {
  state: DraftCasesState;
  selectedMmsi: number | null;
  onSelectShip: (mmsi: number) => void;
};

/**
 * Draft cases the fault-signal matcher opened near watched cables: each lists the ships to look at first, ranked by
 * the anchor-drag detector, and is labelled a draft everywhere, never a finding. Signals show their title and link only.
 */
export function DraftCasesCard({ state, selectedMmsi, onSelectShip }: DraftCasesCardProps) {
  const listRef = useRef<HTMLOListElement>(null);
  useScrollSelectedIntoView(listRef, selectedMmsi);
  return (
    <section className={CARD_CLASS} aria-label="Draft cases" data-testid="live-draft-cases" data-state={state.kind}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-card-title">Draft cases</h2>
        <p className="text-caption font-normal text-muted">
          Opened when a fault signal names a watched cable, last {DRAFT_CASE_DAYS} days. A draft ranks ships to look at first; it is never a finding.
        </p>
      </div>
      {state.kind === "loading" && <p className="text-small text-muted">Loading the draft cases...</p>}
      {state.kind === "failed" && <p className="text-small text-muted">The draft cases could not be loaded.</p>}
      {state.kind === "loaded" && state.drafts.length === 0 && (
        <p className="text-small text-muted" data-testid="live-draft-cases-empty">
          No fault signal named a watched cable in the last {DRAFT_CASE_DAYS} days. Polled: NGA cable warnings hourly, IODA internet outage alerts every 15
          minutes, ENTSO-E power-link outages once its access token is set.
        </p>
      )}
      {state.kind === "loaded" && state.drafts.length > 0 && (
        <ol ref={listRef} className="flex flex-col gap-4">
          {state.drafts.map((draft) => (
            <li key={draft.id} className="flex flex-col gap-2" data-testid={`live-draft-case-${draft.id}`}>
              <div className="flex flex-col gap-0.5">
                <p className="text-caption text-muted">Draft case</p>
                <p className="text-label">{draft.cableName}</p>
                <p className="text-caption font-normal text-muted tabular-nums">
                  Fault {formatFaultSpan(draft.faultNotBeforeMs, draft.faultNotAfterMs)}. <span className="tabular-nums">{draft.shipCount}</span>{" "}
                  {draft.shipCount === 1 ? "ship" : "ships"} within <span className="tabular-nums">{(draft.nearMetres / 1000).toFixed(1)}</span> km.
                </p>
              </div>
              {draft.topShips.length > 0 && (
                <ol className="-mx-2 flex flex-col gap-0.5">
                  {draft.topShips.slice(0, TOP_SHIP_COUNT).map((ship) => {
                    const isSelected = ship.mmsi === selectedMmsi;
                    return (
                      <li key={ship.mmsi}>
                        <button
                          type="button"
                          onClick={() => onSelectShip(ship.mmsi)}
                          aria-current={isSelected ? "true" : undefined}
                          className={`grid w-full grid-cols-[16px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 rounded-field px-2 py-2 text-left transition-colors duration-140 ease-standard hover:bg-page ${isSelected ? "bg-page" : ""}`}
                          data-testid={`live-draft-ship-${draft.id}-${ship.mmsi}`}
                        >
                          <span className="text-caption text-muted tabular-nums">{ship.rank}</span>
                          <span className="truncate text-label">{ship.name ?? `MMSI ${ship.mmsi}`}</span>
                          <span className="col-start-2 text-caption font-normal text-muted">{BASIS_LABELS[ship.basis]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {draft.signals.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {draft.signals.map((signal) => (
                    <li key={signal.id}>
                      <a
                        href={signal.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-8 items-center gap-1.5 text-caption font-normal text-muted underline decoration-faint underline-offset-4 transition-colors duration-140 ease-standard hover:text-ink"
                      >
                        {SOURCE_LABELS[signal.source]}: {signal.title}
                        <Icon name="external" size={16} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
