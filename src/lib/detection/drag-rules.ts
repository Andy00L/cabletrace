import type { Evidence, TrackPoint } from "@/lib/detection/detection-types";
import { distanceMetres, knotsFromMetres, median, quantile, roundTo, signedAngleDifferenceDegrees } from "@/lib/detection/geodesy";

// The published signatures of the two Baltic anchor drags with public data, and every threshold drawn from them.
// Sources: plan/research/yi-peng-3-reconstruction.md, plan/research/eagle-s-reconstruction.md (numbers in [] are
// that file's source ids), the Danish Maritime Authority archive aisdk-2024-11-18 (Yi Peng 3, MMSI 414270000), and
// Lloyd's List, "Rushed Swedish investigation says no evidence bulker deliberately damaged cable" (15 Apr 2025,
// https://www.lloydslist.com/LL1153202), which reports the SHK findings and Lloyd's List Intelligence speeds.

// Navigational status codes (ITU-R M.1371-5, Table 45) that say the ship is under way: 0 under way using engine,
// 4 constrained by her draught, 8 under way sailing. Null and 15 (not defined) mean the crew did not say.
// Excluded: 1 at anchor, 2 not under command (drifting), 3 restricted manoeuvrability (dredging, towing, cable work),
// 5 moored, 6 aground, 7 engaged in fishing.
const UNDER_WAY_STATUSES: ReadonlySet<number> = new Set([0, 4, 8]);
const UNDEFINED_STATUS = 15;

// Drag speed band, knots. Low end: Yi Peng 3 held position at 0.1 to 1.0 knots between 08:24 and 09:30 on
// 18 Nov 2024 (DMA archive), so reports under 2 knots are a stopped ship's jitter, and the lowest published drag
// speed is 3.8 knots (Lloyd's List Intelligence, 17 Nov 2024 18:16). High end: Yi Peng 3 dragged at 7.2 to 7.7 knots
// (DMA archive, 06:01 to 08:12), and Eagle S covered its 90 to 100 km trace [9][24] between 10:26 and 16:45 UTC,
// 7.7 to 8.6 knots on average; 9 knots keeps a margin above both.
export const DRAG_SPEED_MIN_KNOTS = 2;
export const DRAG_SPEED_MAX_KNOTS = 9;
// A run must last 20 minutes. Eagle S's speed "began to fall a little after noon" [42] (10:00 UTC) and Estlink 2
// tripped at 10:26 UTC [15]: a run is flagged before the first cut of the only drag whose start is published.
export const RUN_MIN_DURATION_MS = 20 * 60 * 1000;
// Reports in a run may be up to 60 minutes apart when the ship's average speed across the silence stays in the band:
// Yi Peng 3's archive track has a 50-minute silence (06:35:54 to 07:25:55) in the middle of its drag.
export const RUN_BRIDGE_GAP_MS = 60 * 60 * 1000;
// A dragging ship holds its reduced speed: Yi Peng 3's speed spread (90th minus 10th percentile) was 0.4 knots over
// 06:01 to 08:21 (DMA archive, measured by this detector). A ship slowing down through the band toward a berth or
// anchorage spreads far wider.
export const STEADY_SPEED_SPREAD_KNOTS = 2;
// Straight run: Yi Peng 3 and Eagle S both dragged along their passage line (180 nm [7], 90 to 100 km [9][24]).
const STRAIGHT_RUN_MIN_KM = 3;
const STRAIGHTNESS_MIN = 0.9;
// Speed deficit against the ship's own speed outside the run. Published deficits: Eagle S "slowed down by 25%" [39];
// Lloyd's List Intelligence: Yi Peng 3 at 9 knots at 23:41 on 16 Nov, "just over 6 knots" 19 minutes later (33%);
// DMA archive: 7.5 knots dragging against 10.3 knots after the anchor came up (27%). 20% sits under all three.
const SPEED_DEFICIT_MIN_FRACTION = 0.2;
// The reference speed is the 75th percentile of reports in the hour before the run, or in the three hours after it:
// Yi Peng 3 stopped 72 minutes to raise its anchor and was back at 10 knots 96 minutes after stopping (DMA archive).
export const REFERENCE_BEFORE_MS = 60 * 60 * 1000;
const REFERENCE_AFTER_MS = 3 * 60 * 60 * 1000;
const REFERENCE_MIN_REPORTS = 3;
// A faster speed afterwards counts only after a stop: a windlass heaves at a mean of at least 0.15 m/s (Bureau Veritas
// NR626, April 2025, windlass hoisting speed), so even two shots of chain (55 m) take 6 minutes and the 330 m Yi Peng 3
// had out [Lloyd's List] about 37; Yi Peng 3 stopped for 72. A ship that only speeds up again raised no anchor.
const ANCHOR_HEAVING_MIN_STOP_MS = 10 * 60 * 1000;
// A slowdown judged only against the speed before it reaches alert level after 60 minutes of steady slow running,
// and only when the anchor path touches a cable. Set on the live recorder (Gulf of Finland, 17 Oct 2026 02:22 to
// 08:20 UTC, so in-sample): with a 20-minute run, all 6 slowdown-only alerts lasted 20 to 43 minutes, typical of ships
// slowing for a pilot or an anchorage; at 60 minutes one remained, a tanker on the straight fairway leg into Vysotsk
// that touched no cable. The published drags lasted 6 hours (Eagle S, 10:26 to 16:45 UTC) and a day and a half
// (Yi Peng 3 [7]); at 60 minutes Eagle S, already across Estlink 2, would have been flagged about 11:00 UTC, before
// C-Lion1 (16:44) and the other telecom cables broke that evening.
export const SUSTAINED_SLOWDOWN_MS = 60 * 60 * 1000;
// A step in speed of at least 1.5 knots marks when the drag started: the smallest published drop is Eagle S's 25% of
// a speed the sources do not give; 25% of the 6 to 9 knots of the band is 1.5 to 2.25 knots.
const CHANGE_POINT_MIN_DROP_KNOTS = 1.5;
// Heading against course over ground. Lloyd's List, on SHK: "With the port anchor dragging, the vessel would most
// likely have required increased starboard rudder input". Measured on Yi Peng 3 (DMA archive, by this detector):
// heading minus course was +0.7 degrees (median) while dragging and -1.4 degrees in the three hours after the anchor
// came up, a 2.1-degree shift. Weak on its own: wind and current move this angle by as much.
const HEADING_SHIFT_MIN_DEGREES = 2;
const HEADING_MIN_REPORTS = 5;
// Following a cable: the anchor path stays near a route this far. A perpendicular crossing alone keeps it near for
// about 1 km (500 m each side), so 2 km means the path runs along the cable.
const CABLE_FOLLOW_MIN_KM = 2;

// Rule weights sum to 1. A design choice, not a measurement: the speed deficit is the strongest single sign (every
// published drag shows it), cable contact is what makes a drag matter, the rest support. The score ranks; the level
// also needs gates (assessRun in detect-anchor-drag.ts): an alert needs a score of 0.6, a straight run and the strong
// form of the speed deficit; anything else from 0.4 is a watch. Yi Peng 3's recorded drag scores 0.7 (DMA archive).
const RULE_WEIGHTS = {
  "low-speed-under-way": 0.15,
  "straight-run": 0.1,
  "speed-deficit": 0.35,
  "speed-change-point": 0.05,
  "heading-offset": 0.1,
  "cable-contact": 0.25,
} as const satisfies Record<Evidence["rule"], number>;
export const ALERT_MIN_SCORE = 0.6;
export const WATCH_MIN_SCORE = 0.4;

const MS_PER_MINUTE = 60_000;

/** True when the reported status allows a drag: under way, or not stated. */
export function isUnderWayOrUnstated(status: number | null): boolean {
  return status === null || status === UNDEFINED_STATUS || UNDER_WAY_STATUSES.has(status);
}

/** Reported speed, or the speed implied by the move from the previous report when the report has none. */
export function speedsOf(points: readonly TrackPoint[]): number[] {
  const raw = points.map((point, index) => {
    if (point.speedKnots !== null) return point.speedKnots;
    const previous = points[index - 1];
    if (!previous || point.atMs <= previous.atMs) return 0;
    return knotsFromMetres(distanceMetres(previous, point), point.atMs - previous.atMs);
  });
  // Three-report median: one stray report does not split a run or start one.
  return raw.map((speed, index) => median([raw[index - 1] ?? speed, speed, raw[index + 1] ?? speed]) ?? speed);
}

export function describeLowSpeed(points: readonly TrackPoint[], speeds: readonly number[]): Evidence | null {
  const first = points[0];
  const last = points[points.length - 1];
  const medianSpeed = median(speeds);
  const spread = (quantile(speeds, 0.9) ?? 0) - (quantile(speeds, 0.1) ?? 0);
  if (!first || !last || medianSpeed === null || spread > STEADY_SPEED_SPREAD_KNOTS) return null;
  const durationMinutes = (last.atMs - first.atMs) / MS_PER_MINUTE;
  return {
    rule: "low-speed-under-way",
    weight: RULE_WEIGHTS["low-speed-under-way"],
    measured: { durationMinutes: roundTo(durationMinutes, 1), medianSpeedKnots: roundTo(medianSpeed, 1), speedSpreadKnots: roundTo(spread, 1), reportCount: points.length },
    sentence: `Held ${roundTo(medianSpeed, 1)} knots (spread ${roundTo(spread, 1)}) for ${Math.round(durationMinutes)} minutes while reporting under way, inside the ${DRAG_SPEED_MIN_KNOTS} to ${DRAG_SPEED_MAX_KNOTS} knot band of the published drags.`,
  };
}

export function describeStraightRun(points: readonly TrackPoint[]): Evidence | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  let pathMetres = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (before && after) pathMetres += distanceMetres(before, after);
  }
  const straightMetres = distanceMetres(first, last);
  const straightness = pathMetres > 0 ? straightMetres / pathMetres : 0;
  if (straightMetres / 1000 < STRAIGHT_RUN_MIN_KM || straightness < STRAIGHTNESS_MIN) return null;
  return {
    rule: "straight-run",
    weight: RULE_WEIGHTS["straight-run"],
    measured: { straightDistanceKm: roundTo(straightMetres / 1000, 2), pathDistanceKm: roundTo(pathMetres / 1000, 2), straightness: roundTo(straightness, 3) },
    sentence: `Kept a straight line for ${roundTo(straightMetres / 1000, 1)} km (straightness ${roundTo(straightness, 2)}), as both published drags did.`,
  };
}

type ReferenceSpeed = { side: "before" | "after"; speedKnots: number; points: TrackPoint[]; stopMinutes: number | null };

/**
 * The ship's own cruising speed next to the run: before it when the track shows enough, else after it. Only moving
 * reports count (a stop is not a cruising speed); the minutes stopped after the run are measured separately.
 */
export function findReferenceSpeed(track: readonly TrackPoint[], trackSpeeds: readonly number[], runStartMs: number, runEndMs: number): ReferenceSpeed | null {
  const pick = (fromMs: number, toMs: number) => {
    const indexes = track.flatMap((point, index) => (point.atMs >= fromMs && point.atMs < toMs ? [index] : []));
    const isMoving = (index: number) => (trackSpeeds[index] ?? 0) >= DRAG_SPEED_MIN_KNOTS;
    return {
      movingPoints: indexes.filter(isMoving).flatMap((index) => track[index] ?? []),
      movingSpeeds: indexes.filter(isMoving).map((index) => trackSpeeds[index] ?? 0),
      stoppedPoints: indexes.filter((index) => !isMoving(index)).flatMap((index) => track[index] ?? []),
    };
  };
  const before = pick(runStartMs - REFERENCE_BEFORE_MS, runStartMs);
  const beforeSpeed = quantile(before.movingSpeeds, 0.75);
  if (before.movingPoints.length >= REFERENCE_MIN_REPORTS && beforeSpeed !== null) {
    return { side: "before", speedKnots: beforeSpeed, points: before.movingPoints, stopMinutes: null };
  }
  const after = pick(runEndMs + 1, runEndMs + REFERENCE_AFTER_MS);
  const afterSpeed = quantile(after.movingSpeeds, 0.75);
  if (after.movingPoints.length < REFERENCE_MIN_REPORTS || afterSpeed === null) return null;
  // Minutes spent under the band between the run and the resumed passage (raising an anchor takes time).
  const firstStopped = after.stoppedPoints[0];
  const lastStopped = after.stoppedPoints[after.stoppedPoints.length - 1];
  const stopMinutes = firstStopped && lastStopped ? (lastStopped.atMs - firstStopped.atMs) / MS_PER_MINUTE : null;
  return { side: "after", speedKnots: afterSpeed, points: after.movingPoints, stopMinutes };
}

export function describeSpeedDeficit(reference: ReferenceSpeed | null, runSpeedKnots: number): Evidence | null {
  if (!reference || reference.speedKnots <= 0) return null;
  const deficit = 1 - runSpeedKnots / reference.speedKnots;
  if (deficit < SPEED_DEFICIT_MIN_FRACTION) return null;
  const isAfterWithoutStop = reference.side === "after" && (reference.stopMinutes === null || reference.stopMinutes * MS_PER_MINUTE < ANCHOR_HEAVING_MIN_STOP_MS);
  if (isAfterWithoutStop) return null;
  const stopMinutes = reference.stopMinutes === null ? null : roundTo(reference.stopMinutes, 0);
  const sideText =
    reference.side === "before"
      ? `${roundTo(reference.speedKnots, 1)} knots in the hour before`
      : `${roundTo(reference.speedKnots, 1)} knots afterwards${stopMinutes ? `, after a ${stopMinutes}-minute stop` : ""}`;
  return {
    rule: "speed-deficit",
    weight: RULE_WEIGHTS["speed-deficit"],
    measured: {
      referenceSide: reference.side,
      referenceSpeedKnots: roundTo(reference.speedKnots, 1),
      runSpeedKnots: roundTo(runSpeedKnots, 1),
      deficitFraction: roundTo(deficit, 2),
      stopMinutesBeforeResuming: stopMinutes,
    },
    sentence: `Sailed ${Math.round(deficit * 100)}% slower than its own ${sideText}; a dragged anchor brakes a ship by about that much (25 to 33% in the published drags), which fits an anchor drag.`,
  };
}

/** Least-squares split of a speed series into two steady levels; the split with the lowest squared error wins. */
export function findSpeedChangePoint(points: readonly TrackPoint[], speeds: readonly number[]): Evidence | null {
  let best: { index: number; error: number; beforeMean: number; afterMean: number } | null = null;
  for (let split = REFERENCE_MIN_REPORTS; split <= speeds.length - REFERENCE_MIN_REPORTS; split += 1) {
    const beforeSpeeds = speeds.slice(0, split);
    const afterSpeeds = speeds.slice(split);
    const beforeMean = beforeSpeeds.reduce((sum, speed) => sum + speed, 0) / beforeSpeeds.length;
    const afterMean = afterSpeeds.reduce((sum, speed) => sum + speed, 0) / afterSpeeds.length;
    const error =
      beforeSpeeds.reduce((sum, speed) => sum + (speed - beforeMean) ** 2, 0) + afterSpeeds.reduce((sum, speed) => sum + (speed - afterMean) ** 2, 0);
    if (!best || error < best.error) best = { index: split, error, beforeMean, afterMean };
  }
  const changePoint = best ? points[best.index] : undefined;
  if (!best || !changePoint || best.beforeMean - best.afterMean < CHANGE_POINT_MIN_DROP_KNOTS) return null;
  return {
    rule: "speed-change-point",
    weight: RULE_WEIGHTS["speed-change-point"],
    measured: { atMs: changePoint.atMs, speedBeforeKnots: roundTo(best.beforeMean, 1), speedAfterKnots: roundTo(best.afterMean, 1) },
    sentence: `Speed stepped down from ${roundTo(best.beforeMean, 1)} to ${roundTo(best.afterMean, 1)} knots at ${new Date(changePoint.atMs).toISOString().slice(11, 16)} UTC, the moment a drag, if there was one, most likely started.`,
  };
}

function headingOffsets(points: readonly TrackPoint[]): number[] {
  return points.flatMap((point) =>
    point.headingDegrees !== null && point.courseDegrees !== null && (point.speedKnots ?? 0) >= DRAG_SPEED_MIN_KNOTS
      ? [signedAngleDifferenceDegrees(point.headingDegrees, point.courseDegrees)]
      : [],
  );
}

export function describeHeadingOffset(runPoints: readonly TrackPoint[], referencePoints: readonly TrackPoint[]): Evidence | null {
  const runOffsets = headingOffsets(runPoints);
  const referenceOffsets = headingOffsets(referencePoints);
  const runOffset = median(runOffsets);
  const referenceOffset = median(referenceOffsets);
  if (runOffsets.length < HEADING_MIN_REPORTS || referenceOffsets.length < HEADING_MIN_REPORTS || runOffset === null || referenceOffset === null) return null;
  const shift = runOffset - referenceOffset;
  if (Math.abs(shift) < HEADING_SHIFT_MIN_DEGREES) return null;
  return {
    rule: "heading-offset",
    weight: RULE_WEIGHTS["heading-offset"],
    measured: { runOffsetDegrees: roundTo(runOffset, 1), referenceOffsetDegrees: roundTo(referenceOffset, 1), shiftDegrees: roundTo(shift, 1) },
    sentence: `Bow pointed ${roundTo(Math.abs(shift), 1)} degrees further ${shift > 0 ? "to starboard" : "to port"} of its track than outside the run, the steering a weight dragged on one side asks for.`,
  };
}

export function describeCableContact(crossings: readonly { cableName: string }[], followedKm: number): Evidence | null {
  if (crossings.length === 0 && followedKm < CABLE_FOLLOW_MIN_KM) return null;
  const cableNames = [...new Set(crossings.map((crossing) => crossing.cableName))];
  const crossingText = crossings.length > 0 ? `crosses ${cableNames.join(", ")} ${crossings.length === 1 ? "once" : `${crossings.length} times`}` : "crosses no cable";
  const followText = followedKm >= CABLE_FOLLOW_MIN_KM ? ` and runs within 500 m of a cable for ${roundTo(followedKm, 1)} km` : "";
  return {
    rule: "cable-contact",
    weight: RULE_WEIGHTS["cable-contact"],
    measured: { crossingCount: crossings.length, cableNames, followedKm: roundTo(followedKm, 2) },
    sentence: `The reconstructed anchor path ${crossingText}${followText}.`,
  };
}
