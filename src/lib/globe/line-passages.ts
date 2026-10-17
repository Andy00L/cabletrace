import type { GlobeLine } from "@/lib/globe/world-lines";
import { COORDINATE_UNITS_PER_DEGREE, type ShipFrameColumns } from "@/lib/live/snapshot-codec";

// Who crossed a cable or pipeline, or came near it, in the frames the /live page has loaded. Each frame keeps only
// the ships around the line; then each ship's positions are joined frame to frame into straight moves (as the globe
// draws them), and every move is tested against the line: a move that cuts it is a crossing, otherwise its closest
// approach counts when it is within PASSAGE_DISTANCE_KM.

// The live recorder keeps reports within 3 km of a cable (sourceRef: supabase/migrations/20261017020000_live_recorder.sql,
// ingest_vessel_positions, near_cable_metres default 3000); the globe uses the same distance.
export const PASSAGE_DISTANCE_KM = 3;
// Two positions of one ship are joined into a move only across this gap or less (two 10-minute slots), and only when
// the move is no faster than 50 knots, the bound frame-pairing.ts uses to tell a voyage from a bad position.
const MAX_MOVE_GAP_MS = 20 * 60_000;
const MAX_PLAUSIBLE_SPEED_KNOTS = 50;
const KM_PER_NAUTICAL_MILE = 1.852;
const KM_PER_DEGREE = 111.32;
// A ship this far outside the line's box can neither reach it in one move nor come within the distance.
const SEARCH_MARGIN_KM = PASSAGE_DISTANCE_KM + (MAX_PLAUSIBLE_SPEED_KNOTS * KM_PER_NAUTICAL_MILE * MAX_MOVE_GAP_MS) / 3_600_000;
// Line segments are filed in cells of this size (degrees) so a move is tested against the few segments near it.
const CELL_DEGREES = 1;

export type LinePassage = {
  mmsi: number;
  /** When the ship's move cut the line, or null when it only came near. */
  crossedAtMs: number | null;
  /** The closest the ship came (0 for a crossing) and when. */
  closestKm: number;
  closestAtMs: number;
};

type Segment = { fromLongitude: number; fromLatitude: number; toLongitude: number; toLatitude: number };
type ShipSample = { timeMs: number; longitude: number; latitude: number };
type Box = { west: number; east: number; south: number; north: number; spansAntimeridian: boolean };

export type PassageScan = {
  lineId: number;
  segments: Segment[];
  cells: Map<string, number[]>;
  boxes: Box[];
  frameTimes: Set<number>;
  samples: Map<number, ShipSample[]>;
};

function unwrapLongitude(longitude: number, reference: number): number {
  let unwrapped = longitude;
  while (unwrapped - reference > 180) unwrapped -= 360;
  while (unwrapped - reference < -180) unwrapped += 360;
  return unwrapped;
}

function cellKey(column: number, row: number): string {
  return `${((column % 360) + 360) % 360}:${row}`;
}

function marginDegrees(latitude: number): { longitude: number; latitude: number } {
  const latitudeMargin = SEARCH_MARGIN_KM / KM_PER_DEGREE;
  return { latitude: latitudeMargin, longitude: latitudeMargin / Math.max(0.1, Math.cos((Math.min(89, Math.abs(latitude)) * Math.PI) / 180)) };
}

/** Prepares a scan of one line: its segments filed by cell, and a box per part to skip far ships quickly. */
export function createPassageScan(line: Pick<GlobeLine, "id" | "parts">): PassageScan {
  const segments: Segment[] = [];
  const cells = new Map<string, number[]>();
  const boxes: Box[] = [];
  for (const part of line.parts) {
    let west = Number.POSITIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    let south = Number.POSITIVE_INFINITY;
    let north = Number.NEGATIVE_INFINITY;
    let spansAntimeridian = false;
    for (let index = 0; index + 3 < part.length; index += 2) {
      const fromLongitude = part[index] ?? 0;
      const fromLatitude = part[index + 1] ?? 0;
      const toLongitude = unwrapLongitude(part[index + 2] ?? 0, fromLongitude);
      const toLatitude = part[index + 3] ?? 0;
      if (Math.abs(toLongitude) > 180 || Math.abs(fromLongitude) > 180) spansAntimeridian = true;
      const segmentIndex = segments.push({ fromLongitude, fromLatitude, toLongitude, toLatitude }) - 1;
      const margin = marginDegrees(Math.max(Math.abs(fromLatitude), Math.abs(toLatitude)));
      const minColumn = Math.floor((Math.min(fromLongitude, toLongitude) - margin.longitude) / CELL_DEGREES);
      const maxColumn = Math.floor((Math.max(fromLongitude, toLongitude) + margin.longitude) / CELL_DEGREES);
      const minRow = Math.floor((Math.min(fromLatitude, toLatitude) - margin.latitude) / CELL_DEGREES);
      const maxRow = Math.floor((Math.max(fromLatitude, toLatitude) + margin.latitude) / CELL_DEGREES);
      for (let column = minColumn; column <= maxColumn; column += 1) {
        for (let row = minRow; row <= maxRow; row += 1) {
          const key = cellKey(column, row);
          const filed = cells.get(key);
          if (filed) filed.push(segmentIndex);
          else cells.set(key, [segmentIndex]);
        }
      }
      west = Math.min(west, fromLongitude, toLongitude);
      east = Math.max(east, fromLongitude, toLongitude);
      south = Math.min(south, fromLatitude, toLatitude);
      north = Math.max(north, fromLatitude, toLatitude);
    }
    if (!Number.isFinite(west)) continue;
    const margin = marginDegrees(Math.max(Math.abs(south), Math.abs(north)));
    boxes.push({ west: west - margin.longitude, east: east + margin.longitude, south: south - margin.latitude, north: north + margin.latitude, spansAntimeridian });
  }
  return { lineId: line.id, segments, cells, boxes, frameTimes: new Set(), samples: new Map() };
}

function isNearLine(scan: PassageScan, longitude: number, latitude: number): boolean {
  return scan.boxes.some(
    (box) => latitude >= box.south && latitude <= box.north && (box.spansAntimeridian || box.east - box.west >= 360 || (longitude >= box.west && longitude <= box.east)),
  );
}

/** Keeps the ships of one frame that are near the line. Returns false when the frame was already counted. */
export function addFrameToPassageScan(scan: PassageScan, frame: Pick<ShipFrameColumns, "frameTimeMs" | "shipCount" | "mmsi" | "longitudeUnits" | "latitudeUnits" | "ageSeconds">): boolean {
  if (scan.frameTimes.has(frame.frameTimeMs)) return false;
  scan.frameTimes.add(frame.frameTimeMs);
  for (let shipIndex = 0; shipIndex < frame.shipCount; shipIndex += 1) {
    const longitude = (frame.longitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE;
    const latitude = (frame.latitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE;
    if (!isNearLine(scan, longitude, latitude)) continue;
    const mmsi = frame.mmsi[shipIndex] ?? 0;
    // The report's own time: a frame carries a ship's last report up to 30 minutes old.
    const sample = { timeMs: frame.frameTimeMs - (frame.ageSeconds[shipIndex] ?? 0) * 1000, longitude, latitude };
    const shipSamples = scan.samples.get(mmsi);
    if (shipSamples) shipSamples.push(sample);
    else scan.samples.set(mmsi, [sample]);
  }
  return true;
}

type Point = { x: number; y: number };

/** Closest point on segment a-b to p, as the share along a-b and the distance. */
function closestOnSegment(point: Point, from: Point, to: Point): { share: number; distance: number } {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const share = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * deltaX + (point.y - from.y) * deltaY) / lengthSquared));
  return { share, distance: Math.hypot(point.x - (from.x + share * deltaX), point.y - (from.y + share * deltaY)) };
}

/** Share along the first segment where it cuts the second, or null. */
function intersectionShare(firstFrom: Point, firstTo: Point, secondFrom: Point, secondTo: Point): number | null {
  const firstX = firstTo.x - firstFrom.x;
  const firstY = firstTo.y - firstFrom.y;
  const secondX = secondTo.x - secondFrom.x;
  const secondY = secondTo.y - secondFrom.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (denominator === 0) return null;
  const offsetX = secondFrom.x - firstFrom.x;
  const offsetY = secondFrom.y - firstFrom.y;
  const firstShare = (offsetX * secondY - offsetY * secondX) / denominator;
  const secondShare = (offsetX * firstY - offsetY * firstX) / denominator;
  return firstShare >= 0 && firstShare <= 1 && secondShare >= 0 && secondShare <= 1 ? firstShare : null;
}

function segmentsNear(scan: PassageScan, from: ShipSample, to: ShipSample): Set<number> {
  const found = new Set<number>();
  const toLongitude = unwrapLongitude(to.longitude, from.longitude);
  const minColumn = Math.floor(Math.min(from.longitude, toLongitude) / CELL_DEGREES);
  const maxColumn = Math.floor(Math.max(from.longitude, toLongitude) / CELL_DEGREES);
  const minRow = Math.floor(Math.min(from.latitude, to.latitude) / CELL_DEGREES);
  const maxRow = Math.floor(Math.max(from.latitude, to.latitude) / CELL_DEGREES);
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) scan.cells.get(cellKey(column, row))?.forEach((segmentIndex) => found.add(segmentIndex));
  }
  return found;
}

/** Tests one move (or one lone position, from = to) against the nearby segments, in km on a plane around the move. */
function measureMove(scan: PassageScan, from: ShipSample, to: ShipSample): { crossedAtMs: number | null; closestKm: number; closestAtMs: number } {
  const originLongitude = from.longitude;
  const kmPerLongitude = KM_PER_DEGREE * Math.cos((((from.latitude + to.latitude) / 2) * Math.PI) / 180);
  const project = (longitude: number, latitude: number): Point => ({ x: (unwrapLongitude(longitude, originLongitude) - originLongitude) * kmPerLongitude, y: latitude * KM_PER_DEGREE });
  const moveFrom = project(from.longitude, from.latitude);
  const moveTo = project(to.longitude, to.latitude);
  const timeAt = (share: number) => from.timeMs + (to.timeMs - from.timeMs) * share;
  let crossedAtMs: number | null = null;
  let closestKm = Number.POSITIVE_INFINITY;
  let closestAtMs = from.timeMs;
  for (const segmentIndex of segmentsNear(scan, from, to)) {
    const segment = scan.segments[segmentIndex];
    if (!segment) continue;
    const lineFrom = project(segment.fromLongitude, segment.fromLatitude);
    const lineTo = project(segment.toLongitude, segment.toLatitude);
    const crossingShare = intersectionShare(moveFrom, moveTo, lineFrom, lineTo);
    if (crossingShare !== null) {
      const crossingMs = timeAt(crossingShare);
      if (crossedAtMs === null || crossingMs < crossedAtMs) crossedAtMs = crossingMs;
      if (closestKm > 0 || crossingMs < closestAtMs) {
        closestKm = 0;
        closestAtMs = crossingMs;
      }
      continue;
    }
    const candidates = [
      { distance: closestOnSegment(moveFrom, lineFrom, lineTo).distance, share: 0 },
      { distance: closestOnSegment(moveTo, lineFrom, lineTo).distance, share: 1 },
      { ...closestOnSegment(lineFrom, moveFrom, moveTo) },
      { ...closestOnSegment(lineTo, moveFrom, moveTo) },
    ];
    for (const candidate of candidates) {
      if (candidate.distance < closestKm) {
        closestKm = candidate.distance;
        closestAtMs = timeAt(candidate.share);
      }
    }
  }
  return { crossedAtMs, closestKm, closestAtMs };
}

type Measured = Omit<LinePassage, "mmsi">;

/** The stronger of two findings: the earliest crossing, else the closest approach within the distance. */
function pickStronger(best: Measured | null, measured: Measured): Measured | null {
  if (measured.crossedAtMs !== null) {
    if (best === null || best.crossedAtMs === null || measured.crossedAtMs < best.crossedAtMs) {
      return { crossedAtMs: measured.crossedAtMs, closestKm: 0, closestAtMs: measured.crossedAtMs };
    }
    return best;
  }
  if (best?.crossedAtMs != null || measured.closestKm > PASSAGE_DISTANCE_KM) return best;
  return best === null || measured.closestKm < best.closestKm ? measured : best;
}

/** Every ship that crossed the line or came within PASSAGE_DISTANCE_KM: crossings first by time, then by distance. */
export function summarizePassages(scan: PassageScan): LinePassage[] {
  const passages: LinePassage[] = [];
  for (const [mmsi, unsortedSamples] of scan.samples) {
    const samples = [...unsortedSamples].sort((first, second) => first.timeMs - second.timeMs);
    let best: Measured | null = null;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (!sample) continue;
      best = pickStronger(best, measureMove(scan, sample, sample));
      const next = samples[index + 1];
      if (!next || next.timeMs <= sample.timeMs || next.timeMs - sample.timeMs > MAX_MOVE_GAP_MS) continue;
      const kmPerLongitude = KM_PER_DEGREE * Math.cos((((sample.latitude + next.latitude) / 2) * Math.PI) / 180);
      const moveKm = Math.hypot((unwrapLongitude(next.longitude, sample.longitude) - sample.longitude) * kmPerLongitude, (next.latitude - sample.latitude) * KM_PER_DEGREE);
      const knots = moveKm / KM_PER_NAUTICAL_MILE / ((next.timeMs - sample.timeMs) / 3_600_000);
      if (knots <= MAX_PLAUSIBLE_SPEED_KNOTS) best = pickStronger(best, measureMove(scan, sample, next));
    }
    if (best !== null) passages.push({ mmsi, ...best });
  }
  return passages.sort((first, second) => {
    if (first.crossedAtMs !== null && second.crossedAtMs !== null) return first.crossedAtMs - second.crossedAtMs;
    if (first.crossedAtMs !== null) return -1;
    if (second.crossedAtMs !== null) return 1;
    return first.closestKm - second.closestKm;
  });
}
