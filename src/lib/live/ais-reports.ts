// Parsers for the two AIS feeds behind the live globe, turning untrusted JSON into ship records and
// static data. aisstream.io (https://aisstream.io/documentation) streams the world; Fintraffic
// Digitraffic (https://www.digitraffic.fi/en/marine-traffic/, CC BY 4.0) covers the Finnish area.
// Pure functions, so they run in the edge function and under bun test alike.
// Type-only import: see the import rule at the top of snapshot-codec.ts.
import type { Result } from "../result.ts";
import type { ShipRecord, ShipSource } from "./snapshot-codec.ts";

// AIS "not available" values in decimal units (ITU-R M.1371-5, message 1): speed 102.3 knots,
// course 360 degrees, true heading 511, longitude 181, latitude 91. Anything outside the valid
// ranges below is treated the same way.
const MAX_SPEED_KNOTS = 102.2;
const COURSE_NOT_AVAILABLE = 360;
const HEADING_NOT_AVAILABLE = 511;
// Navigational status 0-15 (ITU-R M.1371-5, Table 45; 15 means "not defined"). Rate of turn as the transponder's
// ROT_AIS code, -127 to 127, with -128 meaning "not available" (message 1, rate of turn field); Digitraffic's `rot`
// carries the same code, so the recorder stores both feeds alike.
const MAX_NAVIGATION_STATUS = 15;
const TURN_RATE_NOT_AVAILABLE = -128;
const MAX_TURN_RATE = 127;

// The aisstream message types (FilterMessageTypes): positions from class A (messages 1-3) and class B (18, 19), which
// the near-cable recorder subscribes to, and static data from class A (5) and class B (24), which the frame collector
// adds for names and ship types.
export const AISSTREAM_POSITION_MESSAGE_TYPES = ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"] as const;
export const AISSTREAM_MESSAGE_TYPES = [...AISSTREAM_POSITION_MESSAGE_TYPES, "ShipStaticData", "StaticDataReport"] as const;

/** Name, identity and size of a ship, from AIS static messages. Null fields were not sent. */
export type ShipStatic = {
  mmsi: number;
  name: string | null;
  callSign: string | null;
  imo: number | null;
  shipType: number | null;
  lengthMetres: number | null;
  beamMetres: number | null;
  draughtMetres: number | null;
  destination: string | null;
  source: ShipSource;
};

/** What the recorder stores beyond the frame's ship record: the crew's navigational status and the rate of turn code. */
export type PositionStatus = { navigationStatus: number | null; turnRate: number | null };

/** A position report with its status fields, as the recorder needs it; the frame keeps only `report`. */
export type PositionDetail = { report: ShipRecord; status: PositionStatus };

export type AisstreamMessage =
  | { kind: "position"; report: ShipRecord; status: PositionStatus; staticData: ShipStatic | null }
  | { kind: "static"; staticData: ShipStatic }
  | { kind: "server-error"; reason: string }
  | { kind: "ignored"; reason: string };

/** One Digitraffic vessel metadata entry and when Digitraffic last received it. */
export type DigitrafficVessel = { staticData: ShipStatic; updatedAtMs: number };

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(source: JsonObject, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMmsi(source: JsonObject, key: string): number | null {
  const value = readNumber(source, key);
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 999_999_999 ? value : null;
}

// AIS 6-bit text pads unused characters with "@" and spaces.
function readAisText(source: JsonObject, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[@\s]+$/u, "").trim();
  return cleaned === "" ? null : cleaned;
}

function readSpeedKnots(value: number | null): number | null {
  return value !== null && value >= 0 && value <= MAX_SPEED_KNOTS ? value : null;
}

function readCourseDegrees(value: number | null): number | null {
  return value !== null && value >= 0 && value < COURSE_NOT_AVAILABLE ? value : null;
}

function readHeadingDegrees(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 && value < 360 && value !== HEADING_NOT_AVAILABLE ? value : null;
}

function readNavigationStatus(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= MAX_NAVIGATION_STATUS ? value : null;
}

function readTurnRate(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value !== TURN_RATE_NOT_AVAILABLE && Math.abs(value) <= MAX_TURN_RATE ? value : null;
}

function isValidPosition(longitude: number | null, latitude: number | null): boolean {
  return longitude !== null && latitude !== null && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90;
}

// The largest size the AIS dimension fields can carry (ITU-R M.1371-5, Figure 42): A and B are 9-bit fields of at most
// 511 m each, C and D 6-bit fields of at most 63 m each. A larger sum is a malformed message, not a ship, and would
// overflow public.live_ships' smallint columns, failing a whole upsert batch.
const MAX_LENGTH_METRES = 2 * 511;
const MAX_BEAM_METRES = 2 * 63;

// A zero or "not available" dimension (ITU-R M.1371-5, Figure 42) leaves the size unknown, and so does one outside
// what the fields allow.
function readSize(dimension: unknown, firstKey: string, secondKey: string, maxMetres: number): number | null {
  if (!isRecord(dimension)) return null;
  const first = readNumber(dimension, firstKey) ?? 0;
  const second = readNumber(dimension, secondKey) ?? 0;
  const total = first + second;
  return total > 0 && first >= 0 && second >= 0 && total <= maxMetres ? total : null;
}

function readLength(dimension: unknown, firstKey: string, secondKey: string): number | null {
  return readSize(dimension, firstKey, secondKey, MAX_LENGTH_METRES);
}

function readBeam(dimension: unknown, firstKey: string, secondKey: string): number | null {
  return readSize(dimension, firstKey, secondKey, MAX_BEAM_METRES);
}

function readPositiveInteger(source: JsonObject, key: string): number | null {
  const value = readNumber(source, key);
  return value !== null && Number.isInteger(value) && value > 0 ? value : null;
}

function emptyStatic(mmsi: number, source: ShipSource): ShipStatic {
  return {
    mmsi,
    name: null,
    callSign: null,
    imo: null,
    shipType: null,
    lengthMetres: null,
    beamMetres: null,
    draughtMetres: null,
    destination: null,
    source,
  };
}

const AISSTREAM_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?/u;

/** Parses aisstream's MetaData.time_utc ("2026-10-17 04:12:31.318353 +0000 UTC") to ms, or null. */
export function parseAisstreamTime(timeText: unknown): number | null {
  if (typeof timeText !== "string") return null;
  const match = AISSTREAM_TIME_PATTERN.exec(timeText);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, fraction] = match;
  const milliseconds = fraction === undefined ? 0 : Math.floor(Number(fraction.padEnd(3, "0").slice(0, 3)));
  const timeMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds);
  return Number.isFinite(timeMs) ? timeMs : null;
}

function readPosition(body: JsonObject, mmsi: number, reportedAtMs: number): ShipRecord | null {
  if (body.Valid === false) return null;
  const longitude = readNumber(body, "Longitude");
  const latitude = readNumber(body, "Latitude");
  if (longitude === null || latitude === null || !isValidPosition(longitude, latitude)) return null;
  return {
    mmsi,
    longitude,
    latitude,
    speedKnots: readSpeedKnots(readNumber(body, "Sog")),
    courseDegrees: readCourseDegrees(readNumber(body, "Cog")),
    headingDegrees: readHeadingDegrees(readNumber(body, "TrueHeading")),
    shipClass: "unknown",
    reportedAtMs,
    source: "aisstream",
  };
}

function readClassAStatic(body: JsonObject, mmsi: number): ShipStatic | null {
  if (body.Valid === false) return null;
  const draught = readNumber(body, "MaximumStaticDraught");
  return {
    ...emptyStatic(mmsi, "aisstream"),
    name: readAisText(body, "Name"),
    callSign: readAisText(body, "CallSign"),
    imo: readPositiveInteger(body, "ImoNumber"),
    shipType: readPositiveInteger(body, "Type"),
    lengthMetres: readLength(body.Dimension, "A", "B"),
    beamMetres: readBeam(body.Dimension, "C", "D"),
    draughtMetres: draught !== null && draught > 0 ? draught : null,
    destination: readAisText(body, "Destination"),
  };
}

// Message 24 arrives in two parts: part A carries the name, part B the type, call sign and size.
function readClassBStatic(body: JsonObject, mmsi: number): ShipStatic | null {
  if (body.Valid === false) return null;
  const staticData = emptyStatic(mmsi, "aisstream");
  if (isRecord(body.ReportA) && body.ReportA.Valid !== false && body.PartNumber !== true) {
    return { ...staticData, name: readAisText(body.ReportA, "Name") };
  }
  if (isRecord(body.ReportB) && body.ReportB.Valid !== false) {
    return {
      ...staticData,
      callSign: readAisText(body.ReportB, "CallSign"),
      shipType: readPositiveInteger(body.ReportB, "ShipType"),
      lengthMetres: readLength(body.ReportB.Dimension, "A", "B"),
      beamMetres: readBeam(body.ReportB.Dimension, "C", "D"),
    };
  }
  return null;
}

// Message 19 carries both a position and the ship's name, type and size.
function readExtendedClassBStatic(body: JsonObject, mmsi: number): ShipStatic {
  return {
    ...emptyStatic(mmsi, "aisstream"),
    name: readAisText(body, "Name"),
    shipType: readPositiveInteger(body, "Type"),
    lengthMetres: readLength(body.Dimension, "A", "B"),
    beamMetres: readBeam(body.Dimension, "C", "D"),
  };
}

/** Parses one aisstream WebSocket message. Never throws: malformed input becomes "ignored". */
export function parseAisstreamMessage(messageText: string): AisstreamMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(messageText);
  } catch {
    return { kind: "ignored", reason: "not JSON" };
  }
  if (!isRecord(parsed)) return { kind: "ignored", reason: "not an object" };
  if (typeof parsed.error === "string") return { kind: "server-error", reason: parsed.error };
  const messageType = parsed.MessageType;
  // The first message after subscribing ({"Message":{"CompressionEnabled":false},...}) carries no report.
  if (messageType === "SubscriptionConfirmation") return { kind: "ignored", reason: "subscription confirmation" };
  if (typeof messageType !== "string" || !isRecord(parsed.Message) || !isRecord(parsed.MetaData)) {
    return { kind: "ignored", reason: "no message envelope" };
  }
  const body = parsed.Message[messageType];
  if (!isRecord(body)) return { kind: "ignored", reason: `no ${messageType} body` };
  const mmsi = readMmsi(body, "UserID") ?? readMmsi(parsed.MetaData, "MMSI");
  if (mmsi === null) return { kind: "ignored", reason: "no MMSI" };

  if (messageType === "ShipStaticData") {
    const staticData = readClassAStatic(body, mmsi);
    return staticData === null ? { kind: "ignored", reason: "invalid static data" } : { kind: "static", staticData };
  }
  if (messageType === "StaticDataReport") {
    const staticData = readClassBStatic(body, mmsi);
    return staticData === null ? { kind: "ignored", reason: "invalid static data" } : { kind: "static", staticData };
  }
  if (messageType === "PositionReport" || messageType === "StandardClassBPositionReport" || messageType === "ExtendedClassBPositionReport") {
    const reportedAtMs = parseAisstreamTime(parsed.MetaData.time_utc);
    if (reportedAtMs === null) return { kind: "ignored", reason: "no report time" };
    const report = readPosition(body, mmsi, reportedAtMs);
    if (report === null) return { kind: "ignored", reason: "no valid position" };
    const staticData = messageType === "ExtendedClassBPositionReport" ? readExtendedClassBStatic(body, mmsi) : null;
    // Class B reports carry neither field; null means the ship did not say.
    const status = { navigationStatus: readNavigationStatus(readNumber(body, "NavigationalStatus")), turnRate: readTurnRate(readNumber(body, "RateOfTurn")) };
    return { kind: "position", report, status, staticData };
  }
  return { kind: "ignored", reason: `message type ${messageType}` };
}

/**
 * Parses Digitraffic /api/ais/v1/locations (GeoJSON) with each report's status fields. Reports older than
 * `sinceMs` are skipped: the endpoint returns the last position of every vessel it has seen, some of them a day old.
 */
export function parseDigitrafficPositions(payload: unknown, sinceMs: number): Result<PositionDetail[]> {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return { ok: false, reason: "Digitraffic locations: no features array" };
  const positions: PositionDetail[] = [];
  for (const feature of payload.features) {
    if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) continue;
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [longitude, latitude] = coordinates;
    if (typeof longitude !== "number" || typeof latitude !== "number" || !isValidPosition(longitude, latitude)) continue;
    const properties = feature.properties;
    const mmsi = readMmsi(properties, "mmsi");
    const reportedAtMs = readNumber(properties, "timestampExternal");
    if (mmsi === null || reportedAtMs === null || reportedAtMs < sinceMs) continue;
    positions.push({
      report: {
        mmsi,
        longitude,
        latitude,
        speedKnots: readSpeedKnots(readNumber(properties, "sog")),
        courseDegrees: readCourseDegrees(readNumber(properties, "cog")),
        headingDegrees: readHeadingDegrees(readNumber(properties, "heading")),
        shipClass: "unknown",
        reportedAtMs,
        source: "digitraffic",
      },
      status: { navigationStatus: readNavigationStatus(readNumber(properties, "navStat")), turnRate: readTurnRate(readNumber(properties, "rot")) },
    });
  }
  return { ok: true, value: positions };
}

/** The ship records of parseDigitrafficPositions, for the live frames. */
export function parseDigitrafficLocations(payload: unknown, sinceMs: number): Result<ShipRecord[]> {
  const positions = parseDigitrafficPositions(payload, sinceMs);
  return positions.ok ? { ok: true, value: positions.value.map((position) => position.report) } : positions;
}

/** Parses Digitraffic /api/ais/v1/vessels. Draught comes in tenths of a metre (AIS message 5); 0 means unknown. */
export function parseDigitrafficVessels(payload: unknown): Result<DigitrafficVessel[]> {
  if (!Array.isArray(payload)) return { ok: false, reason: "Digitraffic vessels: not an array" };
  const vessels: DigitrafficVessel[] = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const mmsi = readMmsi(entry, "mmsi");
    const updatedAtMs = readNumber(entry, "timestamp");
    if (mmsi === null || updatedAtMs === null) continue;
    const draughtTenths = readNumber(entry, "draught");
    const size = { A: entry.referencePointA, B: entry.referencePointB, C: entry.referencePointC, D: entry.referencePointD };
    vessels.push({
      updatedAtMs,
      staticData: {
        ...emptyStatic(mmsi, "digitraffic"),
        name: readAisText(entry, "name"),
        callSign: readAisText(entry, "callSign"),
        imo: readPositiveInteger(entry, "imo"),
        shipType: readPositiveInteger(entry, "shipType"),
        lengthMetres: readLength(size, "A", "B"),
        beamMetres: readBeam(size, "C", "D"),
        draughtMetres: draughtTenths !== null && draughtTenths > 0 ? draughtTenths / 10 : null,
        destination: readAisText(entry, "destination"),
      },
    });
  }
  return { ok: true, value: vessels };
}

/**
 * Combines static messages per MMSI in arrival order: a later message fills or replaces the fields it
 * carries and leaves the others, since class B ships send their name and their type in separate parts.
 */
export function mergeShipStatics(statics: Iterable<ShipStatic>): ShipStatic[] {
  const combinedByMmsi = new Map<number, ShipStatic>();
  for (const staticData of statics) {
    const known = combinedByMmsi.get(staticData.mmsi);
    if (known === undefined) {
      combinedByMmsi.set(staticData.mmsi, staticData);
      continue;
    }
    combinedByMmsi.set(staticData.mmsi, {
      mmsi: staticData.mmsi,
      name: staticData.name ?? known.name,
      callSign: staticData.callSign ?? known.callSign,
      imo: staticData.imo ?? known.imo,
      shipType: staticData.shipType ?? known.shipType,
      lengthMetres: staticData.lengthMetres ?? known.lengthMetres,
      beamMetres: staticData.beamMetres ?? known.beamMetres,
      draughtMetres: staticData.draughtMetres ?? known.draughtMetres,
      destination: staticData.destination ?? known.destination,
      source: staticData.source,
    });
  }
  return [...combinedByMmsi.values()];
}
