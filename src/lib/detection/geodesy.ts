// Distances, speeds and segment intersections on the scale of a ship track (metres to a few hundred km).
// Pure functions, no runtime-specific imports.

// IUGG mean Earth radius in metres; the case research uses the same value (plan/research/yi-peng-3-reconstruction.md).
const EARTH_RADIUS_METRES = 6_371_008.8;
// International nautical mile in metres: 1 knot is 1852 m per hour.
const METRES_PER_NAUTICAL_MILE = 1852;
const MS_PER_HOUR = 3_600_000;

export type LonLat = { longitude: number; latitude: number };
/** A point in a local flat frame around an origin, in metres: x grows east, y grows north. */
export type LocalPoint = { x: number; y: number };

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(from: LonLat, to: LonLat): number {
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const halfChord =
    Math.sin(deltaLatitude / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(halfChord)));
}

/** Signed difference first minus second, in (-180, 180]. */
export function signedAngleDifferenceDegrees(first: number, second: number): number {
  const difference = (((first - second) % 360) + 540) % 360 - 180;
  return difference === -180 ? 180 : difference;
}

/** Speed in knots implied by covering `metres` in `durationMs`. */
export function knotsFromMetres(metres: number, durationMs: number): number {
  return durationMs > 0 ? metres / METRES_PER_NAUTICAL_MILE / (durationMs / MS_PER_HOUR) : Number.POSITIVE_INFINITY;
}

/**
 * Equirectangular frame around `origin`. It is affine in longitude and latitude, so segment crossings found in it are
 * exact; distances drift with the east-west scale, about 1.4% at 50 km north or south of an origin at 60 N.
 */
export function createLocalFrame(origin: LonLat) {
  const metresPerDegreeLatitude = (Math.PI / 180) * EARTH_RADIUS_METRES;
  const metresPerDegreeLongitude = metresPerDegreeLatitude * Math.cos(toRadians(origin.latitude));
  return {
    toLocal(point: LonLat): LocalPoint {
      return { x: (point.longitude - origin.longitude) * metresPerDegreeLongitude, y: (point.latitude - origin.latitude) * metresPerDegreeLatitude };
    },
    toLonLat(point: LocalPoint): LonLat {
      return { longitude: origin.longitude + point.x / metresPerDegreeLongitude, latitude: origin.latitude + point.y / metresPerDegreeLatitude };
    },
  };
}

/**
 * Where segment A (startA to endA) crosses segment B, as the fraction along each, or null when they do not cross.
 * Parallel and collinear segments count as not crossing: a path running exactly along a cable is "following" it.
 */
export function intersectSegments(startA: LocalPoint, endA: LocalPoint, startB: LocalPoint, endB: LocalPoint): { alongA: number; alongB: number } | null {
  const directionA = { x: endA.x - startA.x, y: endA.y - startA.y };
  const directionB = { x: endB.x - startB.x, y: endB.y - startB.y };
  const denominator = directionA.x * directionB.y - directionA.y * directionB.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const offset = { x: startB.x - startA.x, y: startB.y - startA.y };
  const alongA = (offset.x * directionB.y - offset.y * directionB.x) / denominator;
  const alongB = (offset.x * directionA.y - offset.y * directionA.x) / denominator;
  const isInside = alongA >= 0 && alongA <= 1 && alongB >= 0 && alongB <= 1;
  return isInside ? { alongA, alongB } : null;
}

/** Shortest distance in metres from a point to a segment, all in one local frame. */
export function distanceToSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint): number {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = segment.x ** 2 + segment.y ** 2;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / lengthSquared));
  return Math.hypot(point.x - (start.x + segment.x * amount), point.y - (start.y + segment.y * amount));
}

/** Rounds to a number of decimals, for stored and printed measurements. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Median of a list, or null for an empty list. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) return null;
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}

/** Value at a fraction (0 to 1) through the sorted list, nearest rank; null for an empty list. */
export function quantile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index] ?? null;
}
