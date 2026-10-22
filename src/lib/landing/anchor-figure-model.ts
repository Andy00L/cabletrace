import type { CableCase } from "@/lib/cases/case-file";
import { findSeriesSample, type CaseSeries } from "@/lib/cases/case-series";
import type { ChainState } from "@/lib/detection/anchor-model";
import type { Result } from "@/lib/result";
import { estimateCaseShipChain, readChainSpan, shapeCatenary, type ChainPoint } from "@/lib/ships/anchor-chain";

// The truth behind the front page's anchor figure (src/components/landing/AnchorFigure.tsx): one case ship's chain
// from the detector's own model (src/lib/ships/anchor-chain.ts, the one the replays hang their chain from), the water
// depth and speed the replay charts give at one cut (src/lib/cases/case-series.ts), and the illustrated loop of a cable
// meeting the anchor. No DOM, no React: the server builds the resting figure from it and the live component steps it.

/** The numbers the figure is drawn and read from. */
export type AnchorFigureFacts = {
  vesselName: string;
  lengthMetres: number;
  cutLabel: string;
  /** Water under the ship at the cut, from the case's seabed grid (the replay's depth chart). */
  depthMetres: number;
  /** Speed over ground at the cut: the straight-line average between the two placed positions around it. */
  speedKnots: number;
  chain: ChainState;
};

/** Reads the figure's facts for one cut of a case, from the replay's own series; fails when the series has no depth there. */
export function readAnchorFigureFacts(input: { cableCase: CableCase; cutLabel: string; series: CaseSeries }): Result<AnchorFigureFacts> {
  const { cableCase, cutLabel, series } = input;
  const cut = cableCase.cuts.find((candidate) => candidate.label === cutLabel);
  if (!cut) return { ok: false, reason: `no cut labelled ${cutLabel} in ${cableCase.slug}` };
  const { sample } = findSeriesSample(series, Date.parse(cut.atUtc));
  if (!sample || sample.depthMetres === null) return { ok: false, reason: `no depth under ${cableCase.slug} at the ${cutLabel} cut` };
  return {
    ok: true,
    value: {
      vesselName: cableCase.vessel.name,
      lengthMetres: cableCase.vessel.lengthMetres,
      cutLabel,
      depthMetres: sample.depthMetres,
      speedKnots: sample.speedKnots,
      chain: estimateCaseShipChain(cableCase.vessel.kind, cableCase.vessel.lengthMetres),
    },
  };
}

/** The shortest chain the reader can haul in to: the anchor then hangs well clear of the seabed. */
const PAID_OUT_MIN_METRES = 30;

/** The longest: all the chain of one anchor (UR A1 Table 1 through the anchor model). */
const paidOutMaxMetres = (facts: AnchorFigureFacts) => facts.chain.chainPerAnchorMetres;

/** Hawse height above the seabed (m): the water depth plus the model's hawse height above the water. */
export const hawseHeightMetres = (facts: AnchorFigureFacts) => facts.depthMetres + facts.chain.hawseAboveWaterMetres;

/**
 * Where the anchor is for a length of chain paid out, with the chain's shape as points (metres aft of the anchor
 * toward the hawse, metres above the seabed; the anchor first, the hawse last). Too little chain to reach the seabed
 * leaves the anchor hanging under the hawse, as the console's vessel profile draws an anchor let go.
 */
export type ChainReading =
  | { kind: "hanging"; paidOutMetres: number; clearanceMetres: number; points: ChainPoint[] }
  | { kind: "grounded"; paidOutMetres: number; laybackMetres: number; groundedMetres: number; points: ChainPoint[] };

export function readChainAt(facts: AnchorFigureFacts, paidOutMetres: number, pointCount: number): ChainReading {
  const heightMetres = hawseHeightMetres(facts);
  const paidOut = Math.min(paidOutMaxMetres(facts), Math.max(PAID_OUT_MIN_METRES, paidOutMetres));
  const hanging = (): ChainReading => {
    const clearanceMetres = Math.max(0, heightMetres - paidOut);
    const points = Array.from({ length: pointCount }, (_slot, index) => ({ alongMetres: 0, upMetres: clearanceMetres + (paidOut * index) / (pointCount - 1) }));
    return { kind: "hanging", paidOutMetres: paidOut, clearanceMetres, points };
  };
  if (paidOut <= heightMetres) return hanging();
  // The model's span for this length of chain: the same catenary the replays use, with the paid-out length set.
  const span = readChainSpan({ ...facts.chain, nominalPaidOutMetres: paidOut }, -facts.depthMetres);
  if (!span) return hanging();
  const shape = shapeCatenary({ paidOutMetres: paidOut, heightMetres: span.heightMetres, laybackMetres: span.laybackMetres, pointCount });
  if (!shape.ok) return hanging();
  return { kind: "grounded", paidOutMetres: paidOut, laybackMetres: span.laybackMetres, groundedMetres: shape.value.groundedMetres, points: shape.value.points };
}

// Cables are laid this far apart along the track (m), so only one is ever near the anchor; Eagle S crossed five cables
// along a 90 to 100 km drag trace (src/data/cases/eagle-s-2024.ts, summary), much further apart than this.
export const CABLE_SPACING_METRES = 480;
// How far the anchor drags a snagged cable before it parts (m). Illustrated: no source gives it.
export const PART_PULL_METRES = 16;

/**
 * One cable across the track. `worldMetres` is where it lies along the track; the figure follows the ship, so the
 * cable sits `worldMetres - travelledMetres` ahead of the hawse (negative: behind it).
 */
type CablePhase = { kind: "lying" } | { kind: "snagged"; atTravelledMetres: number } | { kind: "parted"; atTravelledMetres: number };

export type CableState = { worldMetres: number; phase: CablePhase };

/** The anchor as the cable sees it: where its hook is along the track (m from the hawse) and whether it is in the seabed. */
export type AnchorPlace = { aheadOfHawseMetres: number; isOnSeabed: boolean };

/** How far the anchor has dragged a snagged cable past where it lay (m), 0 before the snag. */
export function readCablePull(cable: CableState, travelledMetres: number): number {
  if (cable.phase.kind === "snagged") return Math.max(0, travelledMetres - cable.phase.atTravelledMetres);
  if (cable.phase.kind === "parted") return PART_PULL_METRES;
  return 0;
}

/**
 * A cable's phase once the ship has travelled `travelledMetres`, for an anchor dragging with its hook
 * `hookAheadMetres` ahead of the hawse: lying until the hook reaches it, snagged for PART_PULL_METRES, parted after.
 * A function of the distance alone, so the figure can be scrubbed back and forth between its stages.
 */
export function readCablePhase(worldMetres: number, hookAheadMetres: number, travelledMetres: number): CablePhase {
  const snagAt = worldMetres - hookAheadMetres;
  if (travelledMetres < snagAt) return { kind: "lying" };
  if (travelledMetres < snagAt + PART_PULL_METRES) return { kind: "snagged", atTravelledMetres: snagAt };
  return { kind: "parted", atTravelledMetres: snagAt };
}

/** The cables a stretch of track holds, from `fromMetres` to `toMetres` along it, each in its phase at that distance. */
export function layCables(fromMetres: number, toMetres: number, hookAheadMetres: number, travelledMetres: number): CableState[] {
  const first = Math.ceil(fromMetres / CABLE_SPACING_METRES);
  const last = Math.floor(toMetres / CABLE_SPACING_METRES);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_slot, index) => {
    const worldMetres = (first + index) * CABLE_SPACING_METRES;
    return { worldMetres, phase: readCablePhase(worldMetres, hookAheadMetres, travelledMetres) };
  });
}

/**
 * The chain to pay out for a layback (m), by bisection on the model's own span (the layback grows with the chain paid
 * out); held to the model's range. The figure pays out at most the chain that keeps its anchor inside the block.
 */
export function paidOutForLayback(facts: AnchorFigureFacts, laybackMetres: number): number {
  let low = hawseHeightMetres(facts) + 0.5;
  let high = paidOutMaxMetres(facts);
  const laybackOf = (paidOut: number) => {
    const reading = readChainAt(facts, paidOut, 4);
    return reading.kind === "grounded" ? reading.laybackMetres : 0;
  };
  if (laybackOf(high) <= laybackMetres) return high;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    if (laybackOf(middle) < laybackMetres) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** The three moments the front page steps the figure through, in story order. */
export type FigureStage = "drop" | "drag" | "cut";

// The anchor let go and still falling: this much chain out holds its shackle 34 m off the seabed in the Eagle S water,
// so the anchor, drawn 7 times its size (28 m), hangs clear of it.
const DROP_PAID_OUT_METRES = 34;
// Where the cable lies at each stage, against the distance at which the hook reaches the track's first cable (m): well
// ahead while the anchor falls, a short way ahead of the flukes as they plough, and long enough after the part that its
// two ends lie clear aft of the anchor's crown, in the furrow it has cut.
const STAGE_TRAVEL_FROM_SNAG: Record<FigureStage, number> = { drop: -60, drag: -24, cut: PART_PULL_METRES + 26 };

/**
 * One stage as a moment of the drag: how far the ship has travelled and how much chain is out. `snagAtMetres` is the
 * distance at which the anchor's hook reaches the cable at the start of the track, and `draggingPaidOutMetres` the
 * chain the figure drags with.
 */
export function readStageMoment(stage: FigureStage, input: { snagAtMetres: number; draggingPaidOutMetres: number }): { travelledMetres: number; paidOutMetres: number } {
  return {
    travelledMetres: input.snagAtMetres + STAGE_TRAVEL_FROM_SNAG[stage],
    paidOutMetres: stage === "drop" ? DROP_PAID_OUT_METRES : input.draggingPaidOutMetres,
  };
}

/** The nearest cable still ahead of the anchor, in metres, or null when none is in reach. */
function readCableAhead(cables: readonly CableState[], anchor: AnchorPlace, travelledMetres: number): number | null {
  const distances = cables.filter((cable) => cable.phase.kind === "lying").map((cable) => cable.worldMetres - travelledMetres - anchor.aheadOfHawseMetres);
  const ahead = distances.filter((distance) => distance > 0);
  return ahead.length ? Math.min(...ahead) : null;
}

/** What the cable line of the readout says: the nearest cable's distance, or what is happening to one at the anchor. */
export function describeCable(cables: readonly CableState[], anchor: AnchorPlace, travelledMetres: number): string {
  if (cables.some((cable) => cable.phase.kind === "snagged")) return "cable snagged";
  const justParted = cables.some((cable) => cable.phase.kind === "parted" && travelledMetres - cable.phase.atTravelledMetres < PART_PULL_METRES + 120);
  if (justParted) return "cable parted";
  // A hanging anchor catches nothing, so a distance to the next cable would only mislead.
  if (!anchor.isOnSeabed) return "nothing caught";
  const ahead = readCableAhead(cables, anchor, travelledMetres);
  return ahead === null ? "no cable ahead" : `cable ${Math.round(ahead)} m ahead`;
}

/** The card's live readout: chain out, layback (or the anchor's height off the seabed), speed, depth and the cable. */
export function describeReadout(facts: AnchorFigureFacts, reading: ChainReading, cableText: string): string {
  const anchorText = reading.kind === "grounded" ? `layback ${Math.round(reading.laybackMetres)} m` : `anchor ${Math.round(reading.clearanceMetres)} m off the seabed`;
  return `chain ${Math.round(reading.paidOutMetres)} m · ${anchorText} · ${facts.speedKnots.toFixed(1)} kn · depth ${Math.round(facts.depthMetres)} m · ${cableText}`;
}

/** The control's spoken value: written when the reader's choice changes, never from the frame loop. */
export function describeChainForSpeech(reading: ChainReading): string {
  return reading.kind === "grounded"
    ? `${Math.round(reading.paidOutMetres)} metres of chain out; the anchor drags on the seabed ${Math.round(reading.laybackMetres)} metres behind the hawse`
    : `${Math.round(reading.paidOutMetres)} metres of chain out; the anchor hangs ${Math.round(reading.clearanceMetres)} metres above the seabed`;
}
