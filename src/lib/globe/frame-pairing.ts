import { angleBetween, writeUnitVector } from "@/lib/globe/sphere";
import { COORDINATE_UNITS_PER_DEGREE, type ShipFrameColumns } from "@/lib/live/snapshot-codec";

// Two consecutive ship frames matched ship by ship, so the globe can move every ship from where the earlier frame
// had it to where the later one does: the vertex shader blends the two positions for the moment on the timeline.
// A ship in only one frame stays where that frame has it and fades out (or in) across the pair.

// Earth's mean radius (IUGG), for turning an angle on the unit sphere into a distance.
const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_NAUTICAL_MILE = 1.852;
const MS_PER_HOUR = 3_600_000;
// No ship covers ground faster than this; a larger move between two frames is a position error or a reused MMSI,
// and is drawn as a jump to the later position instead of a streak across the map. sourceRef: the detector's
// MAX_PLAUSIBLE_SPEED_KNOTS (src/lib/detection/track-cleaning.ts) uses the same bound.
const MAX_PLAUSIBLE_SPEED_KNOTS = 50;

export type FramePair = {
  /** Frame time of the earlier frame and of the later one (equal when there is no later frame). */
  fromTimeMs: number;
  toTimeMs: number;
  shipCount: number;
  /** Ascending, one per ship in either frame. */
  mmsi: Uint32Array;
  /** Unit-sphere positions, 3 numbers per ship, at the earlier and the later frame time. */
  fromPositions: Float32Array;
  toPositions: Float32Array;
  /** 1 where the ship is in that frame, 0 where it is not. */
  fromPresence: Float32Array;
  toPresence: Float32Array;
  /** The ship's index in the earlier and the later frame, -1 when it is not in that frame. */
  fromIndex: Int32Array;
  toIndex: Int32Array;
};

function writePosition(columns: ShipFrameColumns, shipIndex: number, target: Float32Array, offset: number): void {
  writeUnitVector((columns.longitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE, (columns.latitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE, target, offset);
}

/** Counts the ships of the union of two MMSI-sorted frames with one merge walk. */
function countUnion(earlier: ShipFrameColumns, later: ShipFrameColumns): number {
  let earlierIndex = 0;
  let laterIndex = 0;
  let count = 0;
  while (earlierIndex < earlier.shipCount || laterIndex < later.shipCount) {
    const earlierMmsi = earlierIndex < earlier.shipCount ? (earlier.mmsi[earlierIndex] ?? 0) : Number.POSITIVE_INFINITY;
    const laterMmsi = laterIndex < later.shipCount ? (later.mmsi[laterIndex] ?? 0) : Number.POSITIVE_INFINITY;
    if (earlierMmsi <= laterMmsi) earlierIndex += 1;
    if (laterMmsi <= earlierMmsi) laterIndex += 1;
    count += 1;
  }
  return count;
}

/**
 * Matches the ships of two frames (both sorted by MMSI, as the codec stores them) in one pass. With no later frame,
 * every ship holds still at its earlier position.
 */
export function pairShipFrames(earlier: ShipFrameColumns, later: ShipFrameColumns | null): FramePair {
  const other = later ?? earlier;
  const shipCount = later ? countUnion(earlier, later) : earlier.shipCount;
  const pair: FramePair = {
    fromTimeMs: earlier.frameTimeMs,
    toTimeMs: other.frameTimeMs,
    shipCount,
    mmsi: new Uint32Array(shipCount),
    fromPositions: new Float32Array(shipCount * 3),
    toPositions: new Float32Array(shipCount * 3),
    fromPresence: new Float32Array(shipCount),
    toPresence: new Float32Array(shipCount),
    fromIndex: new Int32Array(shipCount),
    toIndex: new Int32Array(shipCount),
  };
  const intervalHours = Math.max(0, other.frameTimeMs - earlier.frameTimeMs) / MS_PER_HOUR;
  const maxPlausibleAngle = (MAX_PLAUSIBLE_SPEED_KNOTS * KM_PER_NAUTICAL_MILE * intervalHours) / EARTH_RADIUS_KM;
  let earlierIndex = 0;
  let laterIndex = 0;
  for (let shipIndex = 0; shipIndex < shipCount; shipIndex += 1) {
    const earlierMmsi = earlierIndex < earlier.shipCount ? (earlier.mmsi[earlierIndex] ?? 0) : Number.POSITIVE_INFINITY;
    const laterMmsi = later && laterIndex < later.shipCount ? (later.mmsi[laterIndex] ?? 0) : Number.POSITIVE_INFINITY;
    const isInEarlier = earlierMmsi <= laterMmsi;
    const isInLater = later !== null && laterMmsi <= earlierMmsi;
    const offset = shipIndex * 3;
    pair.mmsi[shipIndex] = isInEarlier ? earlierMmsi : laterMmsi;
    pair.fromIndex[shipIndex] = isInEarlier ? earlierIndex : -1;
    pair.toIndex[shipIndex] = isInLater ? laterIndex : later ? -1 : earlierIndex;
    if (isInEarlier) writePosition(earlier, earlierIndex, pair.fromPositions, offset);
    if (later && isInLater) writePosition(later, laterIndex, pair.toPositions, offset);
    if (!later) pair.toPositions.set(pair.fromPositions.subarray(offset, offset + 3), offset);
    else if (!isInLater) pair.toPositions.set(pair.fromPositions.subarray(offset, offset + 3), offset);
    else if (!isInEarlier || angleBetween(pair.fromPositions, offset, pair.toPositions, offset) > maxPlausibleAngle) {
      pair.fromPositions.set(pair.toPositions.subarray(offset, offset + 3), offset);
    }
    pair.fromPresence[shipIndex] = isInEarlier ? 1 : 0;
    pair.toPresence[shipIndex] = later ? (isInLater ? 1 : 0) : 1;
    if (isInEarlier) earlierIndex += 1;
    if (isInLater) laterIndex += 1;
  }
  return pair;
}

/** How far the moment `atMs` sits between the pair's two frames, 0 at the earlier and 1 at the later. */
export function blendAmount(pair: Pick<FramePair, "fromTimeMs" | "toTimeMs">, atMs: number): number {
  const spanMs = pair.toTimeMs - pair.fromTimeMs;
  if (spanMs <= 0) return 0;
  return Math.min(1, Math.max(0, (atMs - pair.fromTimeMs) / spanMs));
}
