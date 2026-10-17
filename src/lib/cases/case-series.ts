import { positionAtTime, type ReplaySceneInput, type TimedPosition } from "@/lib/replay/replay-scene";
import type { SeabedData } from "@/lib/seabed/seabed-data";
import { createElevationSampler, createProjection, type ScenePoint } from "@/lib/seabed/terrain";

// The three charts under the replay timeline, derived once on the server from the case track and the seabed
// files: speed over ground, distance to the nearest mapped cable or pipeline, and the depth under the vessel.
// None of them is a measurement unless the vessel's own AIS reports bound the stretch: every sample says
// whether it sits between two recorded fixes or on a stretch interpolated from placed positions.

/** Samples across the replay window; enough for a 360 px chart, small enough to ship to the browser. */
export const SERIES_SAMPLE_COUNT = 241;
// One international nautical mile is 1.852 km (BIPM SI Brochure, 9th edition, table 8).
const KM_PER_NAUTICAL_MILE = 1.852;
const MS_PER_HOUR = 3_600_000;
// Course is read across this span around each sample, the span the 3D ship turns its hull by (HEADING_SPAN_MS in
// src/lib/seabed/scene/overview.ts), so a few metres of AIS position noise between close fixes do not swing it.
const COURSE_SPAN_MS = 2 * 60 * 1000;
// Under this much movement across the span (km; 0.4 knots over 4 minutes) the ship is holding still: no course.
const MIN_COURSE_KM = 0.05;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * `recorded`: both ends of the stretch are AIS fixes, so speed is what the ship broadcast.
 * `interpolated`: a placed position bounds the stretch, so speed is the straight-line average and the
 * position (hence distance and depth) is drawn on a straight line between the two placed points.
 */
export type SeriesBasis = "recorded" | "interpolated";

export type SeriesSample = {
  atMs: number;
  basis: SeriesBasis;
  speedKnots: number;
  /**
   * Course over ground in degrees clockwise from north, from where the ship was a span before and after; null while
   * it holds still. The tracks carry no reported heading, so this is the direction of travel, not where the bow points.
   */
  courseDegrees: number | null;
  nearestLine: { name: string; distanceKm: number } | null;
  /** Positive metres of water under the vessel; null where the grid says land or the vessel is outside it. */
  depthMetres: number | null;
};

/** Null before the vessel's first position and after its last: there is nothing to derive there. */
export type CaseSeries = { windowStartMs: number; windowEndMs: number; samples: (SeriesSample | null)[] };

function distanceKm(start: ScenePoint, end: ScenePoint): number {
  return Math.hypot(end.x - start.x, end.z - start.z);
}

function distanceToSegmentKm(point: ScenePoint, start: ScenePoint, end: ScenePoint): number {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  const amount = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared));
  return Math.hypot(point.x - (start.x + segmentX * amount), point.z - (start.z + segmentZ * amount));
}

/** Degrees clockwise from north from one scene point to another (scene x runs east, z runs south); null when they nearly meet. */
function courseBetween(start: ScenePoint, end: ScenePoint): number | null {
  if (distanceKm(start, end) < MIN_COURSE_KM) return null;
  const degrees = Math.atan2(end.x - start.x, start.z - end.z) * DEGREES_PER_RADIAN;
  return (degrees + 360) % 360;
}

/** The two track positions around a moment, or null outside the track. */
function findStretch(track: readonly TimedPosition[], atMs: number): { previous: TimedPosition; next: TimedPosition } | null {
  const first = track[0];
  const last = track[track.length - 1];
  if (!first || !last || atMs < first.atMs || atMs > last.atMs) return null;
  const nextIndex = track.findIndex((position) => position.atMs >= atMs);
  const next = track[nextIndex] ?? last;
  const previous = track[Math.max(0, nextIndex - 1)] ?? first;
  return previous.atMs === next.atMs && nextIndex + 1 < track.length ? { previous: next, next: track[nextIndex + 1] ?? next } : { previous, next };
}

/** Builds every sample of the three charts for one case. */
export function buildCaseSeries(seabed: SeabedData, input: ReplaySceneInput): CaseSeries {
  const projection = createProjection(seabed.features.region);
  const sampleElevation = createElevationSampler(seabed.elevations, seabed.features.grid, projection);
  const lines = seabed.features.lines.map((line) => ({ name: line.name, points: line.points.map(([longitude, latitude]) => projection.toScene(longitude, latitude)) }));
  const isInsideRegion = (longitude: number, latitude: number) => {
    const { west, east, south, north } = seabed.features.region;
    return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
  };

  const spanMs = input.windowEndMs - input.windowStartMs;
  const samples = Array.from({ length: SERIES_SAMPLE_COUNT }, (_unused, index): SeriesSample | null => {
    const atMs = input.windowStartMs + (spanMs * index) / (SERIES_SAMPLE_COUNT - 1);
    const stretch = findStretch(input.track, atMs);
    const position = positionAtTime(input.track, atMs);
    if (!stretch || !position) return null;
    const { previous, next } = stretch;

    const isRecorded = previous.recordedSpeedKnots !== null && next.recordedSpeedKnots !== null;
    const stretchHours = (next.atMs - previous.atMs) / MS_PER_HOUR;
    const straightKm = distanceKm(projection.toScene(previous.longitude, previous.latitude), projection.toScene(next.longitude, next.latitude));
    const averageKnots = stretchHours > 0 ? straightKm / KM_PER_NAUTICAL_MILE / stretchHours : 0;
    const speedKnots = isRecorded ? (previous.recordedSpeedKnots ?? averageKnots) : averageKnots;

    const point = projection.toScene(position.longitude, position.latitude);
    // positionAtTime has nothing before the first position and holds the last one, so the span shortens at the ends.
    const before = positionAtTime(input.track, atMs - COURSE_SPAN_MS) ?? position;
    const after = positionAtTime(input.track, atMs + COURSE_SPAN_MS) ?? position;
    const courseDegrees = courseBetween(projection.toScene(before.longitude, before.latitude), projection.toScene(after.longitude, after.latitude));
    let nearestLine: SeriesSample["nearestLine"] = null;
    for (const line of lines) {
      for (let pointIndex = 1; pointIndex < line.points.length; pointIndex += 1) {
        const start = line.points[pointIndex - 1];
        const end = line.points[pointIndex];
        if (!start || !end) continue;
        const lineDistanceKm = distanceToSegmentKm(point, start, end);
        if (nearestLine === null || lineDistanceKm < nearestLine.distanceKm) nearestLine = { name: line.name, distanceKm: lineDistanceKm };
      }
    }

    const elevation = isInsideRegion(position.longitude, position.latitude) ? sampleElevation(point.x, point.z) : null;
    return {
      atMs,
      basis: isRecorded ? "recorded" : "interpolated",
      speedKnots,
      courseDegrees,
      nearestLine,
      depthMetres: elevation !== null && elevation < 0 ? -elevation : null,
    };
  });
  return { windowStartMs: input.windowStartMs, windowEndMs: input.windowEndMs, samples };
}

/** The sample nearest a moment (where the chart cursor sits), with its index; the sample is null outside the track. */
export function findSeriesSample(series: CaseSeries, atMs: number): { index: number; sample: SeriesSample | null } {
  const spanMs = series.windowEndMs - series.windowStartMs;
  const share = spanMs <= 0 ? 0 : (atMs - series.windowStartMs) / spanMs;
  const index = Math.min(series.samples.length - 1, Math.max(0, Math.round(share * (series.samples.length - 1))));
  return { index, sample: series.samples[index] ?? null };
}
