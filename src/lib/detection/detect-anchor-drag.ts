import type { Detection, DetectorInput, Evidence, ShipSize, TrackAssessment, TrackGap, TrackPoint } from "@/lib/detection/detection-types";
import { estimateAnchorModel } from "@/lib/detection/anchor-model";
import { reconstructAnchorPath } from "@/lib/detection/anchor-path";
import {
  ALERT_MIN_SCORE,
  DRAG_SPEED_MAX_KNOTS,
  DRAG_SPEED_MIN_KNOTS,
  REFERENCE_BEFORE_MS,
  RUN_BRIDGE_GAP_MS,
  RUN_MIN_DURATION_MS,
  STEADY_SPEED_SPREAD_KNOTS,
  SUSTAINED_SLOWDOWN_MS,
  WATCH_MIN_SCORE,
  describeCableContact,
  describeHeadingOffset,
  describeLowSpeed,
  describeSpeedDeficit,
  describeStraightRun,
  findReferenceSpeed,
  findSpeedChangePoint,
  isUnderWayOrUnstated,
  speedsOf,
} from "@/lib/detection/drag-rules";
import { distanceMetres, knotsFromMetres, median } from "@/lib/detection/geodesy";
import { MAX_REPORT_GAP_MS, cleanTrack } from "@/lib/detection/track-cleaning";

// AIS ship types (ITU-R M.1371-5, Table 53) that work slowly near cables by trade or carry no cable-cutting anchor:
// 30 fishing, 31 and 32 towing, 33 dredging or underwater operations, 34 diving, 36 sailing, 37 pleasure craft,
// 50 pilot, 51 search and rescue, 52 tug, 53 port tender, 54 anti-pollution, 55 law enforcement, 58 medical transport.
const WORKING_OR_SMALL_SHIP_TYPES: ReadonlySet<number> = new Set([30, 31, 32, 33, 34, 36, 37, 50, 51, 52, 53, 54, 55, 58]);
// Ships under 50 m carry anchors below the 660 kg where IACS UR A1 Table 1 starts (equipment number 205); the drags
// on record are 224 m and 228.6 m ships. Unknown length stays eligible.
const MIN_ELIGIBLE_LENGTH_METRES = 50;
// Fewer reports than this cannot hold a 20-minute run with a reference speed next to it.
const MIN_REPORTS = 5;
// Gaps up to an hour either side of a detection are listed with it.
const GAP_CONTEXT_MS = 60 * 60 * 1000;
const MS_PER_MINUTE = 60_000;

type Run = { firstIndex: number; lastIndex: number };

function checkEligibility(ship: ShipSize | null): string | null {
  if (ship?.shipType !== null && ship?.shipType !== undefined && WORKING_OR_SMALL_SHIP_TYPES.has(ship.shipType)) {
    return `AIS ship type ${ship.shipType} is a working or small craft that operates slowly near cables by trade.`;
  }
  if (ship?.lengthMetres !== null && ship?.lengthMetres !== undefined && ship.lengthMetres > 0 && ship.lengthMetres < MIN_ELIGIBLE_LENGTH_METRES) {
    return `${ship.lengthMetres} m long: under ${MIN_ELIGIBLE_LENGTH_METRES} m, too small to carry an anchor that cuts a cable.`;
  }
  return null;
}

/** Whether two consecutive reports belong to one run: a short silence, or a longer one crossed at a band speed. */
function continuesRun(before: TrackPoint, after: TrackPoint): boolean {
  const silenceMs = after.atMs - before.atMs;
  if (silenceMs <= MAX_REPORT_GAP_MS) return true;
  if (silenceMs > RUN_BRIDGE_GAP_MS) return false;
  const crossingKnots = knotsFromMetres(distanceMetres(before, after), silenceMs);
  return crossingKnots >= DRAG_SPEED_MIN_KNOTS && crossingKnots <= DRAG_SPEED_MAX_KNOTS;
}

function findRuns(points: readonly TrackPoint[], speeds: readonly number[]): Run[] {
  const isInBand = points.map((point, index) => {
    const speed = speeds[index] ?? 0;
    return isUnderWayOrUnstated(point.navigationStatus) && speed >= DRAG_SPEED_MIN_KNOTS && speed <= DRAG_SPEED_MAX_KNOTS;
  });
  const runs: Run[] = [];
  let current: Run | null = null;
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (!isInBand[index]) {
      current = null;
      return;
    }
    if (current && previous && current.lastIndex === index - 1 && continuesRun(previous, point)) {
      current.lastIndex = index;
      return;
    }
    current = { firstIndex: index, lastIndex: index };
    runs.push(current);
  });
  return runs.filter((run) => (points[run.lastIndex]?.atMs ?? 0) - (points[run.firstIndex]?.atMs ?? 0) >= RUN_MIN_DURATION_MS);
}

/** The longest stretch the reports cover without a silence the runs could not bridge. */
function longestCoveredMs(points: readonly TrackPoint[]): number {
  let longest = 0;
  let stretchStartMs = points[0]?.atMs ?? 0;
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous && !continuesRun(previous, point)) stretchStartMs = point.atMs;
    longest = Math.max(longest, point.atMs - stretchStartMs);
  });
  return longest;
}

/** Ranking order: alerts before watches, then the higher score, then the earlier start. */
export function compareDetections(first: Detection, second: Detection): number {
  const levelOrder = (detection: Detection) => (detection.level === "alert" ? 0 : 1);
  return levelOrder(first) - levelOrder(second) || second.score - first.score || first.startMs - second.startMs;
}

function isPresent<Value>(value: Value | null): value is Value {
  return value !== null;
}

/**
 * The steady middle of a run: leading and trailing reports more than half the steady spread away from the run's
 * median are the ship slowing into the run or stopping out of it. They stay in the detection window, not in the
 * speed statistics.
 */
function trimTransitions(runSpeeds: readonly number[]): { first: number; last: number } {
  const runMedian = median(runSpeeds) ?? 0;
  const isTransition = (speed: number | undefined) => speed === undefined || Math.abs(speed - runMedian) > STEADY_SPEED_SPREAD_KNOTS / 2;
  let first = 0;
  let last = runSpeeds.length - 1;
  while (first < last && isTransition(runSpeeds[first])) first += 1;
  while (last > first && isTransition(runSpeeds[last])) last -= 1;
  return { first, last };
}

function assessRun(run: Run, points: readonly TrackPoint[], speeds: readonly number[], input: DetectorInput, gaps: readonly TrackGap[]): Detection | null {
  const runPoints = points.slice(run.firstIndex, run.lastIndex + 1);
  const runSpeeds = speeds.slice(run.firstIndex, run.lastIndex + 1);
  const firstPoint = runPoints[0];
  const lastPoint = runPoints[runPoints.length - 1];
  if (!firstPoint || !lastPoint) return null;
  const steady = trimTransitions(runSpeeds);
  const steadyPoints = runPoints.slice(steady.first, steady.last + 1);
  const lowSpeed = describeLowSpeed(steadyPoints, runSpeeds.slice(steady.first, steady.last + 1));
  // A ship slowing through the band toward a berth is not holding a drag speed: no detection without a steady run
  // that itself lasts the minimum run time.
  if (!lowSpeed || lowSpeed.rule !== "low-speed-under-way") return null;
  if (lowSpeed.measured.durationMinutes * MS_PER_MINUTE < RUN_MIN_DURATION_MS) return null;
  const reference = findReferenceSpeed(points, speeds, firstPoint.atMs, lastPoint.atMs);
  const deficit = describeSpeedDeficit(reference, lowSpeed.measured.medianSpeedKnots);
  // When the ship's own speed outside the run is known and shows no deficit, the ship is simply slow (or sped up
  // without stopping to raise an anchor): nothing to rank. Only a run with no reference at all stays open to a watch.
  if (reference && !deficit) return null;
  const changeWindow = points.flatMap((point, index) =>
    point.atMs >= firstPoint.atMs - REFERENCE_BEFORE_MS && point.atMs <= Math.min(lastPoint.atMs, firstPoint.atMs + REFERENCE_BEFORE_MS) ? [index] : [],
  );
  const changePoint =
    reference?.side === "before"
      ? findSpeedChangePoint(
          changeWindow.flatMap((index) => points[index] ?? []),
          changeWindow.map((index) => speeds[index] ?? 0),
        )
      : null;
  const startMs = changePoint?.rule === "speed-change-point" ? Math.min(changePoint.measured.atMs, firstPoint.atMs) : firstPoint.atMs;
  const endMs = lastPoint.atMs;
  const model = estimateAnchorModel(input.ship);
  const anchor = reconstructAnchorPath({ track: points, startMs, endMs, model, depthAt: input.depthAt, cables: input.cables });
  const evidence: Evidence[] = [
    lowSpeed,
    describeStraightRun(runPoints),
    deficit,
    changePoint,
    describeHeadingOffset(steadyPoints, reference?.points ?? []),
    describeCableContact(anchor.cableCrossings, anchor.followedKm),
  ].filter(isPresent);
  const score = Math.round(evidence.reduce((sum, item) => sum + item.weight, 0) * 100) / 100;
  // Alert level needs the strong form of the speed deficit and the straight passage line both published drags kept
  // (a ship turning along a fairway toward a port is manoeuvring). Slower than afterwards, with a stop long enough to
  // heave an anchor in between, is the strong form on its own. Slower than before is what ships also do for pilots and
  // anchorages, so it counts only once the slow run has lasted SUSTAINED_SLOWDOWN_MS and the anchor path touches a cable.
  const hasCableContact = evidence.some((item) => item.rule === "cable-contact");
  const isStraight = evidence.some((item) => item.rule === "straight-run");
  const isStrongDeficit =
    deficit?.rule === "speed-deficit" &&
    (deficit.measured.referenceSide === "after" || (lowSpeed.measured.durationMinutes * MS_PER_MINUTE >= SUSTAINED_SLOWDOWN_MS && hasCableContact));
  const level = isStrongDeficit && isStraight && score >= ALERT_MIN_SCORE ? "alert" : score >= WATCH_MIN_SCORE ? "watch" : null;
  if (level === null) return null;
  const { chainWeightNewtonsPerMetre, anchorWeightNewtons, hawseAboveWaterMetres, nominalPaidOutMetres, ...anchorModel } = model;
  const modelNote = `Chain ${Math.round(chainWeightNewtonsPerMetre)} N/m and anchor ${Math.round(anchorWeightNewtons / 1000)} kN submerged, hawse ${Math.round(hawseAboveWaterMetres)} m above water, ${nominalPaidOutMetres} m paid out nominally.`;
  return {
    level,
    startMs,
    endMs,
    score,
    evidence,
    cableCrossings: anchor.cableCrossings,
    anchorPath: anchor.anchorPath,
    anchorModel: { ...anchorModel, assumptions: [...anchorModel.assumptions, modelNote] },
    gaps: gaps.filter((gap) => gap.toMs >= startMs - GAP_CONTEXT_MS && gap.fromMs <= endMs + GAP_CONTEXT_MS),
  };
}

/**
 * Assesses one ship's track for behaviour that fits an anchor drag. Ranks with evidence and never accuses: the
 * result says which published signatures the track shows, with the measured numbers, and where the anchor was.
 */
export function assessTrack(input: DetectorInput): TrackAssessment {
  const ineligibility = checkEligibility(input.ship);
  if (ineligibility !== null) return { kind: "not-eligible", reason: ineligibility };
  const clean = cleanTrack(input.track);
  const reportCount = clean.points.length;
  if (reportCount < MIN_REPORTS) {
    return { kind: "insufficient-data", reason: `${reportCount} usable reports; at least ${MIN_REPORTS} are needed.`, reportCount, gaps: clean.gaps };
  }
  if (longestCoveredMs(clean.points) < RUN_MIN_DURATION_MS) {
    return {
      kind: "insufficient-data",
      reason: `The reports never cover ${RUN_MIN_DURATION_MS / MS_PER_MINUTE} minutes without a silence, the shortest run the rules judge.`,
      reportCount,
      gaps: clean.gaps,
    };
  }
  const speeds = speedsOf(clean.points);
  const detections = findRuns(clean.points, speeds)
    .map((run) => assessRun(run, clean.points, speeds, input, clean.gaps))
    .filter(isPresent)
    .sort(compareDetections);
  const [strongest, ...others] = detections;
  if (!strongest) return { kind: "no-fit", reportCount, gaps: clean.gaps };
  return { kind: "fits", reportCount, gaps: clean.gaps, detections: [strongest, ...others] };
}
