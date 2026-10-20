"use client";

import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { describeCourse, describeNearestLineByName, describeSpeed, NumberGrid, ReplayMinute, useMomentSample } from "@/components/console/MomentNumbers";
import { ANCHOR_STATE_LABELS, formatMetres, useVesselAnchor, VesselProfile } from "@/components/console/VesselProfile";
import type { AnchorState, VesselAnchor } from "@/lib/console/vessel-profile";

const KG_PER_TONNE = 1000;
const ANCHOR_DOT_CLASS: Record<AnchorState, string> = { stowed: "bg-faint", "let-go": "border-2 border-alarm bg-card", dragging: "bg-alarm" };

/** The anchor's state as a contained status: an alarm dot while it drags, a ring while it hangs, grey while stowed. */
function AnchorStatusChip({ state }: { state: AnchorState }) {
  return (
    <span className="flex h-7 flex-none items-center gap-1.5 rounded-full bg-soft px-2.5 text-caption whitespace-nowrap" data-testid="vessel-anchor-state" data-state={state}>
      <span aria-hidden="true" className={`size-[7px] rounded-full ${ANCHOR_DOT_CLASS[state]}`} />
      {ANCHOR_STATE_LABELS[state]}
    </span>
  );
}

function describeChainOut(anchor: VesselAnchor): string {
  const { reading, chain } = anchor;
  if (reading.state === "stowed") return "None, the anchor is stowed";
  const share = chain.nominalPaidOutMetres >= chain.chainPerAnchorMetres ? ", all of one anchor" : "";
  return `${formatMetres(chain.nominalPaidOutMetres)}, ${chain.chainDiameterMm} mm${share}`;
}

/**
 * The vessel inspector in Ship mode (style board, board 23), under the ship's name in the rail: identity, the side
 * profile with the anchor and chain to scale, and the figures at the replay moment. Every figure comes from the
 * state the 3D view and the dock's charts read (the chart sample under the cursor, the anchor model); none is typed.
 */
export function VesselInspector() {
  const { consoleCase, input } = useConsole();
  const sample = useMomentSample();
  const anchor = useVesselAnchor();
  const { vessel } = consoleCase;
  const { reading, chain } = anchor;
  const isAnchorOut = reading.state !== "stowed";
  const basis = sample?.basis ?? "no-position";
  const depthMetres = sample?.depthMetres ?? null;
  return (
    <div className="flex flex-col gap-2" data-testid="vessel-inspector" data-state={reading.state}>
      <p className="text-caption font-normal text-muted">
        {vessel.type}, {vessel.flag}. IMO {vessel.imo ?? "not published"}
        {anchor.isLengthAssumed && `. No length reported: drawn at ${formatMetres(anchor.drawnLengthMetres)}, assumed`}
      </p>
      <VesselProfile anchor={anchor} />
      <section aria-label="Derived at this moment" className="flex flex-col gap-2.5" data-testid="vessel-moment" data-state={basis}>
        <div className="flex items-center gap-2">
          <h3 className="text-label tabular-nums">
            At <ReplayMinute /> UTC
          </h3>
          <span className="text-caption font-normal text-muted">{sample ? (sample.basis === "recorded" ? "from AIS" : "derived") : "no position"}</span>
          <span className="ml-auto">
            <AnchorStatusChip state={reading.state} />
          </span>
        </div>
        {sample ? (
          <NumberGrid numbers={[describeSpeed(sample), describeCourse(sample), describeNearestLineByName(sample, input.cuts)]} testIdPrefix="vessel-number" state={basis} />
        ) : (
          <p className="text-small text-muted">No position for the ship at this moment: the track starts later or has ended.</p>
        )}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-small">
          <dt className="text-muted">Chain out</dt>
          <dd className="tabular-nums" data-testid="vessel-chain-out" data-state={reading.state}>
            {describeChainOut(anchor)}
          </dd>
          {/* While the anchor drags, the drawing states the depth to scale; otherwise it is a row of its own. */}
          {reading.state !== "dragging" && (
            <>
              <dt className="text-muted">Water</dt>
              <dd className="tabular-nums" data-testid="vessel-water-depth" data-state={depthMetres !== null ? "known" : "unknown"}>
                {depthMetres !== null ? `${formatMetres(depthMetres)} under the ship` : "Not mapped here"}
              </dd>
            </>
          )}
          <dt className="text-muted">Anchor</dt>
          <dd className="tabular-nums">{(chain.anchorMassKg / KG_PER_TONNE).toFixed(1)} t, IACS UR A1 for this size</dd>
        </dl>
        <p className="text-caption font-normal text-muted">
          {sample ? (sample.basis === "recorded" ? "Speed as the ship broadcast it, at its AIS position. " : "Between placed positions: speed is a straight-line average, never a recorded speed. ") : ""}
          {/* The track's basis stays in the ship card: placed positions are labelled wherever the ship is described. */}
          {`${vessel.evidence} MMSI ${vessel.mmsi ?? "not published"}. `}
          {anchor.isLengthAssumed ? `${chain.assumptions[0] ?? ""} ` : ""}
          <CitationButtons citations={isAnchorOut ? [...vessel.citations, ...consoleCase.dragCitations] : vessel.citations} />
        </p>
      </section>
    </div>
  );
}
