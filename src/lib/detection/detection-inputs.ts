import type { Result } from "@/lib/result";
import type { CableKind, CableLine, ShipSize, TrackPoint } from "@/lib/detection/detection-types";

// Parses the payload of public.detection_inputs() (supabase/migrations/20261018300000_detections.sql): recorded
// positions, the static data of the ships they belong to, and the cable routes as GeoJSON. The edge function and the
// backtest both read this one shape, validated once here where it enters. Each position is a row array, not an object
// with named keys: the payload crosses the database's egress on every call, and rows are a third of the size.

export type ShipTrack = { mmsi: number; ship: ShipSize; track: TrackPoint[] };
export type DetectionInputs = { tracks: ShipTrack[]; cables: CableLine[] };

const CABLE_KINDS: readonly CableKind[] = ["power", "telecom", "pipeline"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFinite(source: Record<string, unknown>, key: string): number | null {
  return toFinite(source[key]);
}

function isCableKind(value: unknown): value is CableKind {
  return CABLE_KINDS.some((kind) => kind === value);
}

// One position row: [mmsi, epoch seconds, longitude, latitude, speed knots, course, heading, navigational status],
// the last four null when the ship did not report them.
const POSITION_ROW_LENGTH = 8;
const MS_PER_SECOND = 1000;

/** A reported value: a finite number, or null when the ship did not report it; anything else is malformed. */
function readOptionalAt(row: readonly unknown[], index: number): { isValid: boolean; value: number | null } {
  const value = toFinite(row[index]);
  return { isValid: value !== null || row[index] === null, value };
}

function parsePosition(value: unknown): { mmsi: number; point: TrackPoint } | null {
  if (!Array.isArray(value) || value.length !== POSITION_ROW_LENGTH) return null;
  const mmsi = toFinite(value[0]);
  const epochSeconds = toFinite(value[1]);
  const longitude = toFinite(value[2]);
  const latitude = toFinite(value[3]);
  const speed = readOptionalAt(value, 4);
  const course = readOptionalAt(value, 5);
  const heading = readOptionalAt(value, 6);
  const status = readOptionalAt(value, 7);
  if (mmsi === null || epochSeconds === null || longitude === null || latitude === null) return null;
  if (!speed.isValid || !course.isValid || !heading.isValid || !status.isValid) return null;
  return {
    mmsi,
    point: {
      atMs: epochSeconds * MS_PER_SECOND,
      longitude,
      latitude,
      speedKnots: speed.value,
      courseDegrees: course.value,
      headingDegrees: heading.value,
      navigationStatus: status.value,
    },
  };
}

function parseCoordinatePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [longitude, latitude] = value;
  return typeof longitude === "number" && typeof latitude === "number" && Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
}

/** A GeoJSON LineString or MultiLineString as one CableLine per line part. */
function parseCable(value: unknown): CableLine[] | null {
  if (!isRecord(value) || typeof value.name !== "string" || !isCableKind(value.kind) || !isRecord(value.route)) return null;
  const { name, kind } = value;
  const { type, coordinates } = value.route;
  if (!Array.isArray(coordinates)) return null;
  const parts: unknown[] = type === "MultiLineString" ? coordinates : type === "LineString" ? [coordinates] : [];
  const lines: CableLine[] = [];
  for (const part of parts) {
    if (!Array.isArray(part)) return null;
    const pairs = part.map(parseCoordinatePair);
    const validPairs = pairs.filter((pair): pair is [number, number] => pair !== null);
    if (validPairs.length !== pairs.length) return null;
    if (validPairs.length >= 2) lines.push({ name, kind, coordinates: validPairs });
  }
  return lines;
}

/** Validates the payload; one malformed cable or position fails the whole payload rather than silently shrinking it. */
export function parseDetectionInputs(payload: unknown): Result<DetectionInputs> {
  if (!isRecord(payload)) return { ok: false, reason: "detection inputs are not an object" };
  const { positions, vessels, cables } = payload;
  if (!Array.isArray(positions) || !Array.isArray(vessels) || !Array.isArray(cables)) {
    return { ok: false, reason: "detection inputs need positions, vessels and cables arrays" };
  }
  const shipsByMmsi = new Map<number, ShipSize>();
  for (const vessel of vessels) {
    if (!isRecord(vessel)) return { ok: false, reason: "detection inputs have a malformed vessel" };
    const mmsi = readFinite(vessel, "mmsi");
    if (mmsi === null) return { ok: false, reason: "detection inputs have a vessel without an MMSI" };
    shipsByMmsi.set(mmsi, {
      lengthMetres: readFinite(vessel, "lengthMetres"),
      beamMetres: readFinite(vessel, "beamMetres"),
      draughtMetres: readFinite(vessel, "draughtMetres"),
      shipType: readFinite(vessel, "shipType"),
      antennaFromBowMetres: readFinite(vessel, "antennaFromBowMetres"),
    });
  }
  const tracksByMmsi = new Map<number, TrackPoint[]>();
  for (const position of positions) {
    const parsed = parsePosition(position);
    if (!parsed) return { ok: false, reason: "detection inputs have a malformed position" };
    const track = tracksByMmsi.get(parsed.mmsi) ?? [];
    track.push(parsed.point);
    tracksByMmsi.set(parsed.mmsi, track);
  }
  const cableLines: CableLine[] = [];
  for (const cable of cables) {
    const parsed = parseCable(cable);
    if (!parsed) return { ok: false, reason: "detection inputs have a malformed cable route" };
    cableLines.push(...parsed);
  }
  const unknownShip: ShipSize = { lengthMetres: null, beamMetres: null, draughtMetres: null, shipType: null, antennaFromBowMetres: null };
  const tracks = [...tracksByMmsi.entries()].map(([mmsi, track]) => ({ mmsi, ship: shipsByMmsi.get(mmsi) ?? unknownShip, track }));
  return { ok: true, value: { tracks, cables: cableLines } };
}
