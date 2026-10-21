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
export const PAID_OUT_MIN_METRES = 30;

/** The longest: all the chain of one anchor (UR A1 Table 1 through the anchor model). */
export const paidOutMaxMetres = (facts: AnchorFigureFacts) => facts.chain.chainPerAnchorMetres;

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

// The illustrated loop. Time runs this many times faster than the drag, so a cable reaches the anchor in seconds.
export const TIME_LAPSE = 12;
// Cables are laid this far apart along the track (m) so one reaches the anchor every loop; Eagle S crossed five cables
// along a 90 to 100 km drag trace (src/data/cases/eagle-s-2024.ts, summary), much further apart than this.
export const CABLE_SPACING_METRES = 480;
// How far the anchor drags a snagged cable before it parts (m). Illustrated: no source gives it.
export const PART_PULL_METRES = 16;
// One international nautical mile is 1,852 m (BIPM SI Brochure, 9th edition, table 8).
const METRES_PER_NAUTICAL_MILE = 1852;

/** Metres the ship covers per second of the figure's clock. */
export const figureMetresPerSecond = (facts: AnchorFigureFacts) => ((facts.speedKnots * METRES_PER_NAUTICAL_MILE) / 3600) * TIME_LAPSE;

/**
 * One cable across the track. `worldMetres` is where it lies along the track; the figure follows the ship, so the
 * cable sits `worldMetres - travelledMetres` ahead of the hawse (negative: behind it).
 */
export type CablePhase =
  | { kind: "lying" }
  | { kind: "passed" }
  | { kind: "snagged"; atTravelledMetres: number }
  | { kind: "parted"; atTravelledMetres: number };

export type CableState = { worldMetres: number; phase: CablePhase };

/** The anchor as the cable sees it: where its flukes are along the track (m from the hawse) and whether they are in the seabed. */
export type AnchorPlace = { aheadOfHawseMetres: number; isOnSeabed: boolean };

export function placeAnchor(reading: ChainReading): AnchorPlace {
  return reading.kind === "grounded" ? { aheadOfHawseMetres: -reading.laybackMetres, isOnSeabed: true } : { aheadOfHawseMetres: 0, isOnSeabed: false };
}

/** How far the anchor has dragged a snagged cable past where it lay (m), 0 before the snag. */
export function readCablePull(cable: CableState, travelledMetres: number): number {
  if (cable.phase.kind === "snagged") return Math.max(0, travelledMetres - cable.phase.atTravelledMetres);
  if (cable.phase.kind === "parted") return PART_PULL_METRES;
  return 0;
}

/**
 * Steps a cable to the ship's new position: a cable reaching anchor flukes in the seabed snags, a snagged cable parts
 * once dragged PART_PULL_METRES, and a cable that reaches a hanging anchor passes under it.
 */
export function stepCable(cable: CableState, anchor: AnchorPlace, travelledMetres: number): CableState {
  const aheadOfAnchor = cable.worldMetres - travelledMetres - anchor.aheadOfHawseMetres;
  switch (cable.phase.kind) {
    case "lying":
      if (aheadOfAnchor > 0) return cable;
      return anchor.isOnSeabed ? { ...cable, phase: { kind: "snagged", atTravelledMetres: travelledMetres + aheadOfAnchor } } : { ...cable, phase: { kind: "passed" } };
    case "snagged":
      return travelledMetres - cable.phase.atTravelledMetres >= PART_PULL_METRES ? { ...cable, phase: { kind: "parted", atTravelledMetres: cable.phase.atTravelledMetres } } : cable;
    case "passed":
    case "parted":
      return cable;
    default: {
      const unhandled: never = cable.phase;
      return unhandled;
    }
  }
}

/** The cables a stretch of track holds, from `fromMetres` to `toMetres` along it, all lying. */
export function layCables(fromMetres: number, toMetres: number): CableState[] {
  const first = Math.ceil(fromMetres / CABLE_SPACING_METRES);
  const last = Math.floor(toMetres / CABLE_SPACING_METRES);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_slot, index) => ({ worldMetres: (first + index) * CABLE_SPACING_METRES, phase: { kind: "lying" } }));
}

/** How far the ship has travelled when, with all the chain out, the anchor meets the cable at the track's start. */
function readFirstSnagMetres(facts: AnchorFigureFacts): number {
  return -placeAnchor(readChainAt(facts, paidOutMaxMetres(facts), 8)).aheadOfHawseMetres;
}

// The tour's hauled-in length: the anchor hangs about 20 m off the seabed in the Eagle S water (m).
const TOUR_HAULED_IN_METRES = 45;

/**
 * The idle tour, as the chain paid out over one loop of two cables: all the chain out while the even cables meet the
 * anchor and part, hauled in right after so the anchor hangs clear while the odd cable passes under the hawse, then
 * paid out again once that cable is aft of the anchor's reach. The windows are shares of the loop counted from a snag,
 * chosen so no cable ever meets the anchor while the chain is moving.
 */
export function tourPaidOutAt(facts: AnchorFigureFacts, travelledMetres: number): number {
  const most = paidOutMaxMetres(facts);
  const loopMetres = 2 * CABLE_SPACING_METRES;
  const share = ((((travelledMetres - readFirstSnagMetres(facts)) / loopMetres) % 1) + 1) % 1;
  const ease = (amount: number) => amount * amount * (3 - 2 * amount);
  const between = (from: number, to: number) => ease(Math.min(1, Math.max(0, (share - from) / (to - from))));
  return most - (most - TOUR_HAULED_IN_METRES) * (between(0.05, 0.155) - between(0.5, 0.8));
}

/**
 * The resting moment the server draws and reduced motion keeps: all the chain out, a cable just parted at the
 * anchor. Returns how far the ship has travelled and the cable as it lies then.
 */
export function readRestingMoment(facts: AnchorFigureFacts): { travelledMetres: number; paidOutMetres: number; cables: CableState[] } {
  const paidOutMetres = paidOutMaxMetres(facts);
  // The cable at the start of the track is met by the anchor once the hawse is a layback past it; it parts a pull later.
  const snagAt = readFirstSnagMetres(facts);
  // Long enough after the snag that the parted ends have fallen clear of the flukes and read as two.
  const travelledMetres = snagAt + PART_PULL_METRES + 26;
  const cable: CableState = { worldMetres: 0, phase: { kind: "parted", atTravelledMetres: snagAt } };
  return { travelledMetres, paidOutMetres, cables: [cable, ...layCables(1, travelledMetres + CABLE_SPACING_METRES * 1.5)] };
}

/** The nearest cable still ahead of the anchor, in metres, or null when none is in reach. */
export function readCableAhead(cables: readonly CableState[], anchor: AnchorPlace, travelledMetres: number): number | null {
  const distances = cables.filter((cable) => cable.phase.kind === "lying").map((cable) => cable.worldMetres - travelledMetres - anchor.aheadOfHawseMetres);
  const ahead = distances.filter((distance) => distance > 0);
  return ahead.length ? Math.min(...ahead) : null;
}

/** What the cable line of the readout says: the nearest cable's distance, or what is happening to one at the anchor. */
export function describeCable(cables: readonly CableState[], anchor: AnchorPlace, travelledMetres: number): string {
  if (cables.some((cable) => cable.phase.kind === "snagged")) return "cable snagged";
  const justParted = cables.some((cable) => cable.phase.kind === "parted" && travelledMetres - cable.phase.atTravelledMetres < PART_PULL_METRES + 120);
  if (justParted) return "cable parted";
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
