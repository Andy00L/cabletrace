// Ship frame codec: every ship on the live globe at one moment, as a compact binary file.
// Written by the collector (supabase/functions/collect-ship-frames) and read by the browser.
//
// Import rule for src/lib/live: files here import each other only with `import type` and a `.ts`
// extension. The edge runtime (Deno) needs the extension, and this project's tsc config accepts an
// extension only on type-only imports, so a runtime import between these files would break one side.
import type { Result } from "../result.ts";

// Layout, version 1, little-endian:
//   header (24 bytes)
//     0  4 bytes  magic "CTSF"
//     4  u8       version (SHIP_FRAME_VERSION)
//     5  u8       flags, 0 (reserved)
//     6  u16      reserved, 0
//     8  f64      frame time, ms since the Unix epoch
//     16 u32      ship count
//     20 u32      reserved, 0
//   then one column per field, ships sorted by ascending MMSI, every ship the same width (21 bytes):
//     mmsi u32 | longitude i32 | latitude i32 | speed u16 | course u16 | heading u16 | age u16 | class and source u8
// Column order puts the 4-byte columns first so each column starts on its own element size: the
// browser reads them as typed array views over the downloaded buffer without copying.
export const SHIP_FRAME_VERSION = 1;
// "CTSF" (CableTrace ship frame) in ASCII: rejects an HTML error page or a foreign file before any parsing.
const MAGIC_BYTES = [0x43, 0x54, 0x53, 0x46] as const;
export const SHIP_FRAME_HEADER_BYTES = 24;
export const SHIP_FRAME_BYTES_PER_SHIP = 21;

// Ship classes as stored in the frame: the wire code is the index in this list.
// Append only: reordering would change the meaning of frames already stored.
export const SHIP_CLASSES = [
  "unknown",
  "cargo",
  "tanker",
  "passenger",
  "fishing",
  "tug",
  "military",
  "sailing",
  "pleasure",
  "pilot",
  "other",
] as const;
export type ShipClass = (typeof SHIP_CLASSES)[number];

// Where a report came from, so the page can credit "aisstream.io" or "Fintraffic / digitraffic.fi".
export type ShipSource = "aisstream" | "digitraffic";

/** One ship's latest known report, in plain units. Null means AIS reported "not available". */
export type ShipRecord = {
  mmsi: number;
  longitude: number;
  latitude: number;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  shipClass: ShipClass;
  reportedAtMs: number;
  source: ShipSource;
};

export type ShipFrame = { frameTimeMs: number; ships: readonly ShipRecord[] };

/**
 * A decoded frame as columns, for rendering thousands of ships without one object each.
 * Index `shipIndex` in every array is the same ship; ships are sorted by ascending MMSI, so two
 * frames can be matched ship by ship with a single merge walk.
 */
export type ShipFrameColumns = {
  frameTimeMs: number;
  shipCount: number;
  mmsi: Uint32Array;
  // Degrees times COORDINATE_UNITS_PER_DEGREE.
  longitudeUnits: Int32Array;
  latitudeUnits: Int32Array;
  // Tenths of a knot; SPEED_NOT_AVAILABLE_TENTHS when unknown.
  speedTenths: Uint16Array;
  // Tenths of a degree; COURSE_NOT_AVAILABLE_TENTHS when unknown.
  courseTenths: Uint16Array;
  // Whole degrees; HEADING_NOT_AVAILABLE when unknown.
  headingDegrees: Uint16Array;
  // Seconds between the ship's report and the frame time.
  ageSeconds: Uint16Array;
  // Low 4 bits: ship class code (index in SHIP_CLASSES). Bit 7: set when the source is Digitraffic.
  classAndSource: Uint8Array;
};

// AIS position resolution is 1/10,000 minute of arc (ITU-R M.1371-5, message 1, longitude and
// latitude fields), so storing that unit loses nothing the transponder sent.
export const COORDINATE_UNITS_PER_DEGREE = 600_000;
// Same "not available" codes as the AIS fields themselves (ITU-R M.1371-5, message 1):
// speed over ground 1023, course over ground 3600, true heading 511.
export const SPEED_NOT_AVAILABLE_TENTHS = 1023;
export const COURSE_NOT_AVAILABLE_TENTHS = 3600;
export const HEADING_NOT_AVAILABLE = 511;
// AIS speed 1022 means "102.2 knots or more", the highest value a report can carry.
const MAX_SPEED_TENTHS = 1022;
// u16 seconds: about 18 hours, far beyond any carry-forward window.
const MAX_AGE_SECONDS = 65_535;
const CLASS_CODE_MASK = 0x0f;
const DIGITRAFFIC_FLAG = 0x80;
const RESERVED_CLASS_BITS = 0x70;
// MMSI is a 9-digit number (ITU-R M.585).
const MAX_MMSI = 999_999_999;
const MAX_LONGITUDE_UNITS = 180 * COORDINATE_UNITS_PER_DEGREE;
const MAX_LATITUDE_UNITS = 90 * COORDINATE_UNITS_PER_DEGREE;

// Typed array views use the platform byte order; every current browser and server is little-endian,
// but a big-endian platform falls back to a DataView copy instead of misreading the file.
const IS_LITTLE_ENDIAN_PLATFORM = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

type ColumnOffsets = {
  mmsi: number;
  longitude: number;
  latitude: number;
  speed: number;
  course: number;
  heading: number;
  age: number;
  classAndSource: number;
  end: number;
};

function computeColumnOffsets(shipCount: number): ColumnOffsets {
  const mmsi = SHIP_FRAME_HEADER_BYTES;
  const longitude = mmsi + shipCount * 4;
  const latitude = longitude + shipCount * 4;
  const speed = latitude + shipCount * 4;
  const course = speed + shipCount * 2;
  const heading = course + shipCount * 2;
  const age = heading + shipCount * 2;
  const classAndSource = age + shipCount * 2;
  return { mmsi, longitude, latitude, speed, course, heading, age, classAndSource, end: classAndSource + shipCount };
}

type EncodedShip = {
  mmsi: number;
  longitudeUnits: number;
  latitudeUnits: number;
  speedTenths: number;
  courseTenths: number;
  headingDegrees: number;
  ageSeconds: number;
  classAndSource: number;
};

function isMmsi(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_MMSI;
}

function quantizeShip(ship: ShipRecord, frameTimeMs: number): Result<EncodedShip> {
  if (!isMmsi(ship.mmsi)) return { ok: false, reason: `MMSI ${ship.mmsi} is not a 9-digit number` };
  const longitudeUnits = Math.round(ship.longitude * COORDINATE_UNITS_PER_DEGREE);
  const latitudeUnits = Math.round(ship.latitude * COORDINATE_UNITS_PER_DEGREE);
  if (!(Math.abs(longitudeUnits) <= MAX_LONGITUDE_UNITS) || !(Math.abs(latitudeUnits) <= MAX_LATITUDE_UNITS)) {
    return { ok: false, reason: `ship ${ship.mmsi} has a position outside the globe` };
  }
  let speedTenths = SPEED_NOT_AVAILABLE_TENTHS;
  if (ship.speedKnots !== null) {
    speedTenths = Math.round(ship.speedKnots * 10);
    if (!(speedTenths >= 0 && speedTenths <= MAX_SPEED_TENTHS)) return { ok: false, reason: `ship ${ship.mmsi} has speed ${ship.speedKnots}` };
  }
  let courseTenths = COURSE_NOT_AVAILABLE_TENTHS;
  if (ship.courseDegrees !== null) {
    // 359.96 degrees rounds to 3600 tenths, which is the same direction as 0.
    courseTenths = Math.round(ship.courseDegrees * 10) % 3600;
    if (!(courseTenths >= 0)) return { ok: false, reason: `ship ${ship.mmsi} has course ${ship.courseDegrees}` };
  }
  let headingDegrees = HEADING_NOT_AVAILABLE;
  if (ship.headingDegrees !== null) {
    headingDegrees = Math.round(ship.headingDegrees) % 360;
    if (!(headingDegrees >= 0)) return { ok: false, reason: `ship ${ship.mmsi} has heading ${ship.headingDegrees}` };
  }
  const ageSeconds = Math.round((frameTimeMs - ship.reportedAtMs) / 1000);
  if (!(ageSeconds >= 0 && ageSeconds <= MAX_AGE_SECONDS)) {
    return { ok: false, reason: `ship ${ship.mmsi} has a report ${ageSeconds} s from the frame time` };
  }
  const classCode = SHIP_CLASSES.indexOf(ship.shipClass);
  if (classCode < 0) return { ok: false, reason: `ship ${ship.mmsi} has an unknown class` };
  const classAndSource = classCode | (ship.source === "digitraffic" ? DIGITRAFFIC_FLAG : 0);
  return {
    ok: true,
    value: { mmsi: ship.mmsi, longitudeUnits, latitudeUnits, speedTenths, courseTenths, headingDegrees, ageSeconds, classAndSource },
  };
}

/**
 * Encodes a frame. Ships are sorted by MMSI; two ships with the same MMSI are an error, because the
 * merge step must already have kept one report per ship.
 */
export function encodeShipFrame(frame: ShipFrame): Result<Uint8Array> {
  if (!Number.isFinite(frame.frameTimeMs) || frame.frameTimeMs < 0) return { ok: false, reason: "frame time is not a valid timestamp" };
  const encodedShips: EncodedShip[] = [];
  for (const ship of frame.ships) {
    const quantized = quantizeShip(ship, frame.frameTimeMs);
    if (!quantized.ok) return quantized;
    encodedShips.push(quantized.value);
  }
  encodedShips.sort((first, second) => first.mmsi - second.mmsi);
  for (let shipIndex = 1; shipIndex < encodedShips.length; shipIndex += 1) {
    if (encodedShips[shipIndex].mmsi === encodedShips[shipIndex - 1].mmsi) {
      return { ok: false, reason: `MMSI ${encodedShips[shipIndex].mmsi} appears twice` };
    }
  }

  const shipCount = encodedShips.length;
  const offsets = computeColumnOffsets(shipCount);
  const bytes = new Uint8Array(offsets.end);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC_BYTES, 0);
  view.setUint8(4, SHIP_FRAME_VERSION);
  view.setFloat64(8, frame.frameTimeMs, true);
  view.setUint32(16, shipCount, true);
  encodedShips.forEach((ship, shipIndex) => {
    view.setUint32(offsets.mmsi + shipIndex * 4, ship.mmsi, true);
    view.setInt32(offsets.longitude + shipIndex * 4, ship.longitudeUnits, true);
    view.setInt32(offsets.latitude + shipIndex * 4, ship.latitudeUnits, true);
    view.setUint16(offsets.speed + shipIndex * 2, ship.speedTenths, true);
    view.setUint16(offsets.course + shipIndex * 2, ship.courseTenths, true);
    view.setUint16(offsets.heading + shipIndex * 2, ship.headingDegrees, true);
    view.setUint16(offsets.age + shipIndex * 2, ship.ageSeconds, true);
    view.setUint8(offsets.classAndSource + shipIndex, ship.classAndSource);
  });
  return { ok: true, value: bytes };
}

function readColumns(bytes: Uint8Array, shipCount: number, offsets: ColumnOffsets): Omit<ShipFrameColumns, "frameTimeMs" | "shipCount"> {
  const canView = IS_LITTLE_ENDIAN_PLATFORM && bytes.byteOffset % 4 === 0;
  const base = bytes.byteOffset;
  if (canView) {
    return {
      mmsi: new Uint32Array(bytes.buffer, base + offsets.mmsi, shipCount),
      longitudeUnits: new Int32Array(bytes.buffer, base + offsets.longitude, shipCount),
      latitudeUnits: new Int32Array(bytes.buffer, base + offsets.latitude, shipCount),
      speedTenths: new Uint16Array(bytes.buffer, base + offsets.speed, shipCount),
      courseTenths: new Uint16Array(bytes.buffer, base + offsets.course, shipCount),
      headingDegrees: new Uint16Array(bytes.buffer, base + offsets.heading, shipCount),
      ageSeconds: new Uint16Array(bytes.buffer, base + offsets.age, shipCount),
      classAndSource: new Uint8Array(bytes.buffer, base + offsets.classAndSource, shipCount),
    };
  }
  const view = new DataView(bytes.buffer, base, bytes.byteLength);
  const columns = {
    mmsi: new Uint32Array(shipCount),
    longitudeUnits: new Int32Array(shipCount),
    latitudeUnits: new Int32Array(shipCount),
    speedTenths: new Uint16Array(shipCount),
    courseTenths: new Uint16Array(shipCount),
    headingDegrees: new Uint16Array(shipCount),
    ageSeconds: new Uint16Array(shipCount),
    classAndSource: bytes.slice(offsets.classAndSource, offsets.classAndSource + shipCount),
  };
  for (let shipIndex = 0; shipIndex < shipCount; shipIndex += 1) {
    columns.mmsi[shipIndex] = view.getUint32(offsets.mmsi + shipIndex * 4, true);
    columns.longitudeUnits[shipIndex] = view.getInt32(offsets.longitude + shipIndex * 4, true);
    columns.latitudeUnits[shipIndex] = view.getInt32(offsets.latitude + shipIndex * 4, true);
    columns.speedTenths[shipIndex] = view.getUint16(offsets.speed + shipIndex * 2, true);
    columns.courseTenths[shipIndex] = view.getUint16(offsets.course + shipIndex * 2, true);
    columns.headingDegrees[shipIndex] = view.getUint16(offsets.heading + shipIndex * 2, true);
    columns.ageSeconds[shipIndex] = view.getUint16(offsets.age + shipIndex * 2, true);
  }
  return columns;
}

// Checks every ship, so the renderer can trust each value without its own guards.
function findInvalidShip(columns: Omit<ShipFrameColumns, "frameTimeMs" | "shipCount">, shipCount: number): string | null {
  for (let shipIndex = 0; shipIndex < shipCount; shipIndex += 1) {
    const mmsi = columns.mmsi[shipIndex];
    if (!isMmsi(mmsi)) return `ship ${shipIndex} has MMSI ${mmsi}`;
    if (shipIndex > 0 && mmsi <= columns.mmsi[shipIndex - 1]) return `ships are not sorted by MMSI at ${shipIndex}`;
    if (Math.abs(columns.longitudeUnits[shipIndex]) > MAX_LONGITUDE_UNITS) return `ship ${mmsi} has a longitude outside the globe`;
    if (Math.abs(columns.latitudeUnits[shipIndex]) > MAX_LATITUDE_UNITS) return `ship ${mmsi} has a latitude outside the globe`;
    const speedTenths = columns.speedTenths[shipIndex];
    if (speedTenths > MAX_SPEED_TENTHS && speedTenths !== SPEED_NOT_AVAILABLE_TENTHS) return `ship ${mmsi} has speed code ${speedTenths}`;
    if (columns.courseTenths[shipIndex] > COURSE_NOT_AVAILABLE_TENTHS) return `ship ${mmsi} has course code ${columns.courseTenths[shipIndex]}`;
    const heading = columns.headingDegrees[shipIndex];
    if (heading > 359 && heading !== HEADING_NOT_AVAILABLE) return `ship ${mmsi} has heading code ${heading}`;
    const classAndSource = columns.classAndSource[shipIndex];
    if ((classAndSource & RESERVED_CLASS_BITS) !== 0) return `ship ${mmsi} uses reserved class bits`;
    if ((classAndSource & CLASS_CODE_MASK) >= SHIP_CLASSES.length) return `ship ${mmsi} has class code ${classAndSource & CLASS_CODE_MASK}`;
  }
  return null;
}

/**
 * Decodes and validates a frame. When the bytes start on a 4-byte boundary (any buffer from
 * fetch or DecompressionStream does), the columns are views over `bytes`: keep it unchanged.
 */
export function decodeShipFrame(bytes: Uint8Array): Result<ShipFrameColumns> {
  if (bytes.byteLength < SHIP_FRAME_HEADER_BYTES) return { ok: false, reason: `frame is ${bytes.byteLength} bytes, shorter than its header` };
  if (MAGIC_BYTES.some((magicByte, byteIndex) => bytes[byteIndex] !== magicByte)) return { ok: false, reason: "not a ship frame (bad magic bytes)" };
  const header = new DataView(bytes.buffer, bytes.byteOffset, SHIP_FRAME_HEADER_BYTES);
  const version = header.getUint8(4);
  if (version !== SHIP_FRAME_VERSION) return { ok: false, reason: `ship frame version ${version} is not supported (expected ${SHIP_FRAME_VERSION})` };
  if (header.getUint8(5) !== 0 || header.getUint16(6, true) !== 0 || header.getUint32(20, true) !== 0) {
    return { ok: false, reason: "ship frame header uses reserved fields" };
  }
  const frameTimeMs = header.getFloat64(8, true);
  if (!Number.isFinite(frameTimeMs) || frameTimeMs < 0) return { ok: false, reason: "ship frame has an invalid frame time" };
  const shipCount = header.getUint32(16, true);
  const offsets = computeColumnOffsets(shipCount);
  if (bytes.byteLength !== offsets.end) {
    return { ok: false, reason: `ship frame is ${bytes.byteLength} bytes, expected ${offsets.end} for ${shipCount} ships` };
  }
  const columns = readColumns(bytes, shipCount, offsets);
  const invalidShip = findInvalidShip(columns, shipCount);
  if (invalidShip !== null) return { ok: false, reason: `ship frame is corrupt: ${invalidShip}` };
  return { ok: true, value: { frameTimeMs, shipCount, ...columns } };
}

/** Reads one ship back into plain units. `shipIndex` must be below `columns.shipCount`. */
export function readShipRecord(columns: ShipFrameColumns, shipIndex: number): ShipRecord {
  const speedTenths = columns.speedTenths[shipIndex];
  const courseTenths = columns.courseTenths[shipIndex];
  const heading = columns.headingDegrees[shipIndex];
  const classAndSource = columns.classAndSource[shipIndex];
  return {
    mmsi: columns.mmsi[shipIndex],
    longitude: columns.longitudeUnits[shipIndex] / COORDINATE_UNITS_PER_DEGREE,
    latitude: columns.latitudeUnits[shipIndex] / COORDINATE_UNITS_PER_DEGREE,
    speedKnots: speedTenths === SPEED_NOT_AVAILABLE_TENTHS ? null : speedTenths / 10,
    courseDegrees: courseTenths === COURSE_NOT_AVAILABLE_TENTHS ? null : courseTenths / 10,
    headingDegrees: heading === HEADING_NOT_AVAILABLE ? null : heading,
    // decodeShipFrame rejects class codes outside the list, so the fallback never applies to a decoded frame.
    shipClass: SHIP_CLASSES[classAndSource & CLASS_CODE_MASK] ?? "unknown",
    reportedAtMs: columns.frameTimeMs - columns.ageSeconds[shipIndex] * 1000,
    source: (classAndSource & DIGITRAFFIC_FLAG) !== 0 ? "digitraffic" : "aisstream",
  };
}

/** Every ship of a decoded frame as plain records (the collector merges these with new reports). */
export function readShipRecords(columns: ShipFrameColumns): ShipRecord[] {
  return Array.from({ length: columns.shipCount }, (_unused, shipIndex) => readShipRecord(columns, shipIndex));
}
