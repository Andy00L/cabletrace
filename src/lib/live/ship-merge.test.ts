import { describe, expect, test } from "bun:test";
import { assignShipClasses, CARRY_FORWARD_MS, DIGITRAFFIC_PRIORITY_MS, mergeShipRecords, pickPreferredReport, prefersReport } from "./ship-merge";
import type { ShipRecord } from "./snapshot-codec";

const FRAME_TIME_MS = Date.UTC(2026, 9, 17, 14, 30);
// Gulf of Finland, inside the Digitraffic box; and the English Channel, outside it.
const HELSINKI = { longitude: 24.95, latitude: 60.15 };
const DOVER = { longitude: 1.4, latitude: 51.0 };

function buildReport(overrides: Partial<ShipRecord>): ShipRecord {
  return {
    mmsi: 230_000_001,
    ...HELSINKI,
    speedKnots: 10,
    courseDegrees: 90,
    headingDegrees: 90,
    shipClass: "unknown",
    reportedAtMs: FRAME_TIME_MS - 60_000,
    source: "aisstream",
    ...overrides,
  };
}

describe("prefersReport", () => {
  test("keeps the newer report from the same source", () => {
    const older = buildReport({ reportedAtMs: FRAME_TIME_MS - 60_000 });
    const newer = buildReport({ reportedAtMs: FRAME_TIME_MS - 10_000 });
    expect(prefersReport(newer, older)).toBe(true);
    expect(prefersReport(older, newer)).toBe(false);
    expect(prefersReport(older, older)).toBe(false);
  });

  test("lets Digitraffic win inside its box even when aisstream is a little newer", () => {
    const digitraffic = buildReport({ source: "digitraffic", reportedAtMs: FRAME_TIME_MS - 4 * 60_000 });
    const aisstream = buildReport({ source: "aisstream", reportedAtMs: FRAME_TIME_MS });
    expect(prefersReport(digitraffic, aisstream)).toBe(true);
    expect(prefersReport(aisstream, digitraffic)).toBe(false);
  });

  test("falls back to the newer report when Digitraffic lost the ship or the ship is outside the box", () => {
    const staleDigitraffic = buildReport({ source: "digitraffic", reportedAtMs: FRAME_TIME_MS - DIGITRAFFIC_PRIORITY_MS - 1 });
    const freshAisstream = buildReport({ source: "aisstream", reportedAtMs: FRAME_TIME_MS });
    expect(prefersReport(freshAisstream, staleDigitraffic)).toBe(true);

    const digitrafficAbroad = buildReport({ ...DOVER, source: "digitraffic", reportedAtMs: FRAME_TIME_MS - 60_000 });
    const aisstreamAbroad = buildReport({ ...DOVER, source: "aisstream", reportedAtMs: FRAME_TIME_MS - 30_000 });
    expect(prefersReport(aisstreamAbroad, digitrafficAbroad)).toBe(true);
  });
});

describe("pickPreferredReport", () => {
  test("keeps the class the losing report knew when the winner has none", () => {
    const classified = buildReport({ shipClass: "tanker", reportedAtMs: FRAME_TIME_MS - 120_000 });
    const fresh = buildReport({ shipClass: "unknown", reportedAtMs: FRAME_TIME_MS });
    expect(pickPreferredReport(classified, fresh)).toEqual({ ...fresh, shipClass: "tanker" });
    expect(pickPreferredReport(undefined, fresh)).toBe(fresh);
  });
});

describe("mergeShipRecords", () => {
  test("carries a quiet ship for 30 minutes, then drops it, and returns ships by MMSI", () => {
    const merged = mergeShipRecords({
      frameTimeMs: FRAME_TIME_MS,
      previous: [
        buildReport({ mmsi: 300_000_003, reportedAtMs: FRAME_TIME_MS - CARRY_FORWARD_MS }),
        buildReport({ mmsi: 300_000_004, reportedAtMs: FRAME_TIME_MS - CARRY_FORWARD_MS - 1 }),
        buildReport({ mmsi: 300_000_001, reportedAtMs: FRAME_TIME_MS - 600_000, shipClass: "cargo" }),
      ],
      incoming: [buildReport({ mmsi: 300_000_001, reportedAtMs: FRAME_TIME_MS - 5_000 })],
    });
    expect(merged.map((ship) => ship.mmsi)).toEqual([300_000_001, 300_000_003]);
    expect(merged[0]).toMatchObject({ reportedAtMs: FRAME_TIME_MS - 5_000, shipClass: "cargo" });
  });

  test("drops reports far in the future and clamps small clock leads to the frame time", () => {
    const merged = mergeShipRecords({
      frameTimeMs: FRAME_TIME_MS,
      previous: [],
      incoming: [buildReport({ mmsi: 1, reportedAtMs: FRAME_TIME_MS + 30_000 }), buildReport({ mmsi: 2, reportedAtMs: FRAME_TIME_MS + 120_000 })],
    });
    expect(merged).toEqual([buildReport({ mmsi: 1, reportedAtMs: FRAME_TIME_MS })]);
  });
});

describe("assignShipClasses", () => {
  test("applies fresh classes and leaves the rest", () => {
    const ships = [buildReport({ mmsi: 1, shipClass: "unknown" }), buildReport({ mmsi: 2, shipClass: "cargo" }), buildReport({ mmsi: 3, shipClass: "tug" })];
    const classes = new Map([
      [1, "passenger" as const],
      [3, "unknown" as const],
    ]);
    expect(assignShipClasses(ships, classes).map((ship) => ship.shipClass)).toEqual(["passenger", "cargo", "tug"]);
  });
});
