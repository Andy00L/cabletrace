import { DETECTION_LOOKBACK_MS, isDetectionCandidate } from "@/lib/detection/assess-fleet";
import type { ShipTrack } from "@/lib/detection/detection-inputs";
import type { CableCrossing, CableLine, DepthLookup, Detection, DetectionLevel, TrackAssessment, TrackPoint } from "@/lib/detection/detection-types";
import { assessTrack, compareDetections } from "@/lib/detection/detect-anchor-drag";
import { DRAG_SPEED_MAX_KNOTS, DRAG_SPEED_MIN_KNOTS } from "@/lib/detection/drag-rules";
import { createLocalFrame, distanceToSegment } from "@/lib/detection/geodesy";
import type { FaultSignal } from "@/lib/fault-signals/fault-signal-types";

// The draft case a matched signal opens: the ships recorded near the affected cable in a window before the fault,
// ranked by the anchor-drag detector's evidence (src/lib/detection) and by whether that evidence puts the ship on this
// cable when the fault happened. A draft names ships to look at first; it is never a finding, and every ranked ship
// says in words why it sits where it does.

// The window starts this long before the earliest moment the signal allows for the fault: the detector's own lookback
// (a drag run of a few hours plus the reference speed around it, src/lib/detection/assess-fleet.ts).
export const DRAFT_LOOKBACK_MS = DETECTION_LOOKBACK_MS;
// And ends this long after the latest moment, the same slack the fault span gets when a ship's time is compared to it:
// ship clocks, AIS latency and an operator's rounded trip time.
export const FAULT_TIME_SLACK_MS = 15 * 60 * 1000;
// public.fault_case_inputs() refuses longer windows; it bounds what one call reads from the database.
export const DRAFT_MAX_WINDOW_MS = 96 * 60 * 60 * 1000;
// The live recorder keeps positions within 3 km of a cable (public.ingest_vessel_positions, near_cable_metres 3000):
// a ship farther from the affected cable was not recorded near it.
export const DRAFT_NEAR_CABLE_METRES = 3000;
// The draft keeps the strongest ships only; the rest are counted.
export const DRAFT_MAX_SHIPS = 20;

export type DraftWindow = { fromMs: number; toMs: number };
type FaultSpan = Pick<FaultSignal, "faultNotBeforeMs" | "faultNotAfterMs">;

/** The span of recorded traffic a draft looks at for one signal. */
export function draftWindowFor(signal: FaultSpan): DraftWindow {
  const toMs = signal.faultNotAfterMs + FAULT_TIME_SLACK_MS;
  const fromMs = Math.max(signal.faultNotBeforeMs - DRAFT_LOOKBACK_MS, toMs - DRAFT_MAX_WINDOW_MS);
  return { fromMs, toMs };
}

/**
 * Whether a signal pins the fault time down more tightly than another. When several signals concern one cable within a
 * day, the draft keeps the ranking built from the tightest one (public.store_fault_run applies the same rule): a trip
 * time to the minute says more about which ship was there than "after noon".
 */
export function isNarrowerFaultSpan(candidate: FaultSpan, current: FaultSpan): boolean {
  return candidate.faultNotAfterMs - candidate.faultNotBeforeMs < current.faultNotAfterMs - current.faultNotBeforeMs;
}

/** A ship near the cable that never reported a drag-band speed: only its closest report is read. */
export type PassingShip = { mmsi: number; atMs: number; distanceMetres: number; speedKnots: number | null };

/**
 * Why a ship sits where it does, strongest first. Ships that could drag an anchor and were on this cable when it
 * failed: a detection whose anchor path crosses the cable inside the fault span, then a ship recorded at the cable in
 * that span whose track the detector cannot judge (too few reports, so it cannot be cleared). Then ships that could
 * drag but do not fit the fault: a detection elsewhere or at another time, a track it cannot judge, a judged track with
 * no drag signature. Last, ships the detector's rules exclude: never in the drag speed band, or a working or small craft.
 */
export type RankBasis = "drag-at-fault" | "unjudged-at-fault" | "drag-elsewhere" | "unjudged" | "no-fit" | "outside-drag-band" | "not-eligible";

const RANK_ORDER: Readonly<Record<RankBasis, number>> = {
  "drag-at-fault": 0,
  "unjudged-at-fault": 1,
  "drag-elsewhere": 2,
  unjudged: 3,
  "no-fit": 4,
  "outside-drag-band": 5,
  "not-eligible": 6,
};

export type RankedShip = {
  rank: number;
  mmsi: number;
  name: string | null;
  basis: RankBasis;
  level: DetectionLevel | null;
  score: number | null;
  /** When the reconstructed anchor path crosses the affected cable, the crossing time; null otherwise. */
  crossingAtMs: number | null;
  closestApproachMetres: number;
  closestApproachAtMs: number;
  reportCount: number;
  /** Plain sentences: why the ship sits at this rank, then the detector's evidence. */
  sentences: string[];
};

export type DraftCase = {
  status: "draft";
  cableName: string;
  window: DraftWindow;
  nearMetres: number;
  /** Every ship recorded near the cable in the window; `ships` holds the first DRAFT_MAX_SHIPS. */
  shipCount: number;
  ships: RankedShip[];
};

export type DraftCaseInput = {
  signal: FaultSpan;
  cableName: string;
  /** Every route part of the affected cable. */
  cable: readonly CableLine[];
  window: DraftWindow;
  nearMetres: number;
  /** Ships near the cable whose window track holds a drag-band report or an unreported speed. */
  candidates: readonly ShipTrack[];
  passers: readonly PassingShip[];
  names: ReadonlyMap<number, string>;
  depthAt: DepthLookup | null;
};

/** Closest distance in metres from a position to the cable, with no limit. */
export function distanceToCable(point: { longitude: number; latitude: number }, cable: readonly CableLine[]): number {
  const frame = createLocalFrame(point);
  const origin = { x: 0, y: 0 };
  let closest = Number.POSITIVE_INFINITY;
  for (const part of cable) {
    part.coordinates.slice(1).forEach((end, index) => {
      const start = part.coordinates[index] ?? end;
      const startLocal = frame.toLocal({ longitude: start[0], latitude: start[1] });
      const endLocal = frame.toLocal({ longitude: end[0], latitude: end[1] });
      closest = Math.min(closest, distanceToSegment(origin, startLocal, endLocal));
    });
  }
  return closest;
}

function closestApproach(track: readonly TrackPoint[], cable: readonly CableLine[]): { metres: number; atMs: number } {
  let best = { metres: Number.POSITIVE_INFINITY, atMs: track[0]?.atMs ?? 0 };
  for (const point of track) {
    const metres = distanceToCable(point, cable);
    if (metres < best.metres) best = { metres, atMs: point.atMs };
  }
  return { metres: Math.round(best.metres), atMs: best.atMs };
}

/**
 * Splits recorded ships the way public.fault_case_inputs() does: ships with a report within `nearMetres` of the cable
 * inside the window; their window track when it holds a drag-band report or an unreported speed, else only their
 * closest report. The replay script uses it to feed the builder the same shape the database sends.
 */
export function splitShipsForDraft(input: { tracks: readonly ShipTrack[]; cable: readonly CableLine[]; window: DraftWindow; nearMetres: number }): { candidates: ShipTrack[]; passers: PassingShip[] } {
  const candidates: ShipTrack[] = [];
  const passers: PassingShip[] = [];
  for (const shipTrack of input.tracks) {
    const inWindow = shipTrack.track.filter((point) => point.atMs >= input.window.fromMs && point.atMs <= input.window.toMs);
    if (inWindow.length === 0) continue;
    const closest = closestApproach(inWindow, input.cable);
    if (closest.metres > input.nearMetres) continue;
    if (isDetectionCandidate(inWindow)) {
      candidates.push({ ...shipTrack, track: inWindow });
      continue;
    }
    const closestPoint = inWindow.find((point) => point.atMs === closest.atMs);
    passers.push({ mmsi: shipTrack.mmsi, atMs: closest.atMs, distanceMetres: closest.metres, speedKnots: closestPoint?.speedKnots ?? null });
  }
  return { candidates, passers };
}

function isInFaultSpan(atMs: number, signal: FaultSpan): boolean {
  return atMs >= signal.faultNotBeforeMs - FAULT_TIME_SLACK_MS && atMs <= signal.faultNotAfterMs + FAULT_TIME_SLACK_MS;
}

/** Whether the crossing's time band, from the anchor layback band, overlaps the fault span. */
function crossesInFaultSpan(crossing: CableCrossing, signal: FaultSpan): boolean {
  return crossing.earliestMs <= signal.faultNotAfterMs + FAULT_TIME_SLACK_MS && crossing.latestMs >= signal.faultNotBeforeMs - FAULT_TIME_SLACK_MS;
}

function formatUtcMinute(atMs: number): string {
  return `${new Date(atMs).toISOString().slice(11, 16)} UTC on ${new Date(atMs).toISOString().slice(0, 10)}`;
}

type Assessed = Omit<RankedShip, "rank"> & { detection: Detection | null };
type Common = Pick<RankedShip, "mmsi" | "name" | "closestApproachMetres" | "closestApproachAtMs" | "reportCount">;

/** The detection that says most about this fault: one crossing the cable inside the fault span, else the strongest. */
function chooseDetection(assessment: TrackAssessment, cableNames: ReadonlySet<string>, signal: FaultSpan): { detection: Detection; crossing: CableCrossing | null } | null {
  if (assessment.kind !== "fits") return null;
  for (const detection of assessment.detections) {
    const crossing = detection.cableCrossings.find((cableCrossing) => cableNames.has(cableCrossing.cableName) && crossesInFaultSpan(cableCrossing, signal));
    if (crossing) return { detection, crossing };
  }
  return { detection: assessment.detections[0], crossing: null };
}

function rankDetection(common: Common, chosen: { detection: Detection; crossing: CableCrossing | null }): Assessed {
  const { detection, crossing } = chosen;
  const opening = crossing
    ? `Its reconstructed anchor path crosses this cable at ${formatUtcMinute(crossing.atMs)}, inside the time the signal gives for the fault.`
    : "Its anchor path does not cross this cable inside the time the signal gives for the fault.";
  return {
    ...common,
    basis: crossing ? "drag-at-fault" : "drag-elsewhere",
    level: detection.level,
    score: detection.score,
    crossingAtMs: crossing?.atMs ?? null,
    sentences: [opening, ...detection.evidence.map((item) => item.sentence)],
    detection,
  };
}

function assessCandidate(shipTrack: ShipTrack, input: DraftCaseInput, cableNames: ReadonlySet<string>): Assessed {
  const assessment = assessTrack({ track: shipTrack.track, cables: input.cable, depthAt: input.depthAt, ship: shipTrack.ship });
  const closest = closestApproach(shipTrack.track, input.cable);
  const common: Common = {
    mmsi: shipTrack.mmsi,
    name: input.names.get(shipTrack.mmsi) ?? null,
    closestApproachMetres: closest.metres,
    closestApproachAtMs: closest.atMs,
    reportCount: shipTrack.track.length,
  };
  const chosen = chooseDetection(assessment, cableNames, input.signal);
  if (chosen) return rankDetection(common, chosen);
  const unranked = { ...common, level: null, score: null, crossingAtMs: null, detection: null };
  switch (assessment.kind) {
    case "not-eligible":
      return { ...unranked, basis: "not-eligible", sentences: [assessment.reason] };
    case "insufficient-data": {
      const atFault = shipTrack.track.find((point) => isInFaultSpan(point.atMs, input.signal) && distanceToCable(point, input.cable) <= input.nearMetres);
      if (atFault) {
        const metres = Math.round(distanceToCable(atFault, input.cable));
        return {
          ...unranked,
          basis: "unjudged-at-fault",
          sentences: [`Recorded ${metres} m from this cable at ${formatUtcMinute(atFault.atMs)}, inside the time the signal gives for the fault.`, assessment.reason, "The detector cannot judge or clear this track."],
        };
      }
      return { ...unranked, basis: "unjudged", sentences: [assessment.reason, "The detector cannot judge or clear this track; it was not recorded at this cable inside the time the signal gives for the fault."] };
    }
    case "no-fit":
    case "fits":
      return { ...unranked, basis: "no-fit", sentences: [`The detector found no drag signature in ${assessment.reportCount} reports.`] };
    default: {
      const unhandled: never = assessment;
      return unhandled;
    }
  }
}

function assessPasser(passer: PassingShip, input: DraftCaseInput): Assessed {
  return {
    mmsi: passer.mmsi,
    name: input.names.get(passer.mmsi) ?? null,
    basis: "outside-drag-band",
    level: null,
    score: null,
    crossingAtMs: null,
    closestApproachMetres: Math.round(passer.distanceMetres),
    closestApproachAtMs: passer.atMs,
    reportCount: 1,
    sentences: [`Never reported a speed between ${DRAG_SPEED_MIN_KNOTS} and ${DRAG_SPEED_MAX_KNOTS} knots near this cable; the detector flags no ship outside that band.`],
    detection: null,
  };
}

/** How far a time lies outside the span the signal allows for the fault (0 inside it). */
function msFromFault(atMs: number, signal: FaultSpan): number {
  if (atMs < signal.faultNotBeforeMs) return signal.faultNotBeforeMs - atMs;
  if (atMs > signal.faultNotAfterMs) return atMs - signal.faultNotAfterMs;
  return 0;
}

function compareAssessed(first: Assessed, second: Assessed, signal: FaultSpan): number {
  const byBasis = RANK_ORDER[first.basis] - RANK_ORDER[second.basis];
  if (byBasis !== 0) return byBasis;
  const byDetection = first.detection && second.detection ? compareDetections(first.detection, second.detection) : 0;
  if (byDetection !== 0) return byDetection;
  return first.closestApproachMetres - second.closestApproachMetres || msFromFault(first.closestApproachAtMs, signal) - msFromFault(second.closestApproachAtMs, signal) || first.mmsi - second.mmsi;
}

/** The stored and served fields of a ranked ship, without the full detection behind it. */
function toRankedShip(ship: Assessed, rank: number): RankedShip {
  return {
    rank,
    mmsi: ship.mmsi,
    name: ship.name,
    basis: ship.basis,
    level: ship.level,
    score: ship.score,
    crossingAtMs: ship.crossingAtMs,
    closestApproachMetres: ship.closestApproachMetres,
    closestApproachAtMs: ship.closestApproachAtMs,
    reportCount: ship.reportCount,
    sentences: ship.sentences,
  };
}

/** Ranks every ship of the window and keeps the strongest DRAFT_MAX_SHIPS. */
export function buildDraftCase(input: DraftCaseInput): DraftCase {
  const cableNames = new Set(input.cable.map((part) => part.name));
  const assessed = [...input.candidates.map((shipTrack) => assessCandidate(shipTrack, input, cableNames)), ...input.passers.map((passer) => assessPasser(passer, input))];
  assessed.sort((first, second) => compareAssessed(first, second, input.signal));
  return {
    status: "draft",
    cableName: input.cableName,
    window: input.window,
    nearMetres: input.nearMetres,
    shipCount: assessed.length,
    ships: assessed.slice(0, DRAFT_MAX_SHIPS).map((ship, index) => toRankedShip(ship, index + 1)),
  };
}
