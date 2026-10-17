import { describe, expect, test } from "bun:test";
import {
  COORDINATE_UNITS_PER_DEGREE,
  decodeShipFrame,
  encodeShipFrame,
  readShipRecords,
  SHIP_FRAME_BYTES_PER_SHIP,
  SHIP_FRAME_HEADER_BYTES,
  SHIP_FRAME_VERSION,
  type ShipRecord,
} from "./snapshot-codec";

const FRAME_TIME_MS = Date.UTC(2026, 9, 17, 14, 23, 41, 250);

function buildShip(overrides: Partial<ShipRecord>): ShipRecord {
  return {
    mmsi: 230_000_001,
    longitude: 24.95,
    latitude: 60.15,
    speedKnots: 12.3,
    courseDegrees: 271.4,
    headingDegrees: 270,
    shipClass: "cargo",
    reportedAtMs: FRAME_TIME_MS - 42_000,
    source: "digitraffic",
    ...overrides,
  };
}

const SHIPS: ShipRecord[] = [
  buildShip({ mmsi: 636_021_117, longitude: -179.999_998, latitude: -89.5, source: "aisstream", shipClass: "tanker" }),
  buildShip({ mmsi: 211_000_002, speedKnots: null, courseDegrees: null, headingDegrees: null, shipClass: "unknown", reportedAtMs: FRAME_TIME_MS }),
  buildShip({ mmsi: 412_345_678, longitude: 121.123_456_7, latitude: 24.987_654_3, speedKnots: 102.2, courseDegrees: 359.96, headingDegrees: 0, shipClass: "other" }),
  buildShip({ mmsi: 1, longitude: 180, latitude: 90, speedKnots: 0, courseDegrees: 0, headingDegrees: 359, reportedAtMs: FRAME_TIME_MS - 1_800_000 }),
];

function encodeOrFail(ships: ShipRecord[], frameTimeMs = FRAME_TIME_MS): Uint8Array {
  const encoded = encodeShipFrame({ frameTimeMs, ships });
  if (!encoded.ok) throw new Error(`encode failed in test setup: ${encoded.reason}`);
  return encoded.value;
}

describe("encodeShipFrame and decodeShipFrame", () => {
  test("round-trips every field at AIS resolution, sorted by MMSI", () => {
    const bytes = encodeOrFail(SHIPS);
    expect(bytes.byteLength).toBe(SHIP_FRAME_HEADER_BYTES + SHIPS.length * SHIP_FRAME_BYTES_PER_SHIP);
    expect(bytes[4]).toBe(SHIP_FRAME_VERSION);
    const decoded = decodeShipFrame(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.frameTimeMs).toBe(FRAME_TIME_MS);
    const records = readShipRecords(decoded.value);
    expect(records.map((record) => record.mmsi)).toEqual([1, 211_000_002, 412_345_678, 636_021_117]);

    const expectedByMmsi = new Map(SHIPS.map((ship) => [ship.mmsi, ship]));
    for (const record of records) {
      const original = expectedByMmsi.get(record.mmsi);
      if (original === undefined) throw new Error(`unexpected MMSI ${record.mmsi}`);
      expect(Math.abs(record.longitude - original.longitude)).toBeLessThanOrEqual(0.5 / COORDINATE_UNITS_PER_DEGREE);
      expect(Math.abs(record.latitude - original.latitude)).toBeLessThanOrEqual(0.5 / COORDINATE_UNITS_PER_DEGREE);
      expect(record.shipClass).toBe(original.shipClass);
      expect(record.source).toBe(original.source);
      expect(Math.abs(record.reportedAtMs - original.reportedAtMs)).toBeLessThanOrEqual(500);
    }
    const [lowest, unavailable, fastest] = records;
    expect(lowest).toMatchObject({ speedKnots: 0, courseDegrees: 0, headingDegrees: 359 });
    expect(unavailable).toMatchObject({ speedKnots: null, courseDegrees: null, headingDegrees: null, shipClass: "unknown" });
    // 359.96 degrees rounds to a full turn, stored as 0.
    expect(fastest).toMatchObject({ speedKnots: 102.2, courseDegrees: 0, headingDegrees: 0 });
  });

  test("round-trips an empty frame", () => {
    const decoded = decodeShipFrame(encodeOrFail([]));
    expect(decoded.ok && decoded.value.shipCount).toBe(0);
  });

  test("decodes bytes that do not start on a 4-byte boundary by copying them", () => {
    const bytes = encodeOrFail(SHIPS);
    const shifted = new Uint8Array(bytes.byteLength + 1);
    shifted.set(bytes, 1);
    const decoded = decodeShipFrame(shifted.subarray(1));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(readShipRecords(decoded.value).map((record) => record.mmsi)).toEqual([1, 211_000_002, 412_345_678, 636_021_117]);
  });

  test("refuses ships the merge step should have removed or that the format cannot hold", () => {
    const failures = [
      encodeShipFrame({ frameTimeMs: FRAME_TIME_MS, ships: [buildShip({}), buildShip({})] }),
      encodeShipFrame({ frameTimeMs: FRAME_TIME_MS, ships: [buildShip({ longitude: 181 })] }),
      encodeShipFrame({ frameTimeMs: FRAME_TIME_MS, ships: [buildShip({ latitude: Number.NaN })] }),
      encodeShipFrame({ frameTimeMs: FRAME_TIME_MS, ships: [buildShip({ reportedAtMs: FRAME_TIME_MS + 5_000 })] }),
      encodeShipFrame({ frameTimeMs: FRAME_TIME_MS, ships: [buildShip({ speedKnots: 102.3 })] }),
      encodeShipFrame({ frameTimeMs: FRAME_TIME_MS, ships: [buildShip({ mmsi: 1_000_000_000 })] }),
      encodeShipFrame({ frameTimeMs: Number.NaN, ships: [] }),
    ];
    expect(failures.map((outcome) => outcome.ok)).toEqual([false, false, false, false, false, false, false]);
    const duplicate = failures[0];
    expect(!duplicate.ok && duplicate.reason).toBe("MMSI 230000001 appears twice");
  });

  test("rejects files that are not intact version 1 frames", () => {
    const bytes = encodeOrFail(SHIPS);
    const withByte = (byteIndex: number, value: number) => {
      const copy = bytes.slice();
      copy[byteIndex] = value;
      return copy;
    };
    // The second ship's MMSI written over the first breaks the strictly ascending order.
    const withFirstMmsi = (mmsi: number) => {
      const copy = bytes.slice();
      new DataView(copy.buffer).setUint32(SHIP_FRAME_HEADER_BYTES, mmsi, true);
      return copy;
    };
    const classColumnStart = bytes.byteLength - SHIPS.length;
    const reasons = [
      decodeShipFrame(new TextEncoder().encode("<html><body>Object not found</body></html>")),
      decodeShipFrame(withByte(4, 2)),
      decodeShipFrame(bytes.subarray(0, bytes.byteLength - 1)),
      decodeShipFrame(withFirstMmsi(211_000_002)),
      decodeShipFrame(withByte(classColumnStart, 0x10)),
      decodeShipFrame(withByte(classColumnStart, 0x0f)),
    ].map((outcome) => (outcome.ok ? "accepted" : outcome.reason));
    expect(reasons[0]).toBe("not a ship frame (bad magic bytes)");
    expect(reasons[1]).toBe("ship frame version 2 is not supported (expected 1)");
    expect(reasons[2]).toContain("expected 108 for 4 ships");
    expect(reasons[3]).toContain("not sorted by MMSI");
    expect(reasons[4]).toContain("reserved class bits");
    expect(reasons[5]).toContain("class code 15");
  });
});
