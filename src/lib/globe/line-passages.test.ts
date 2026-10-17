import { describe, expect, test } from "bun:test";
import { COORDINATE_UNITS_PER_DEGREE } from "@/lib/live/snapshot-codec";
import { addFrameToPassageScan, createPassageScan, PASSAGE_DISTANCE_KM, summarizePassages } from "./line-passages";

const SLOT_MS = 10 * 60_000;
const START_MS = Date.parse("2026-10-17T12:00:00Z");
// A cable running east along 60 N from 24 E to 26 E.
const CABLE = { id: 7, parts: [[24, 60, 26, 60]] };
// 0.01 degrees of latitude is 1.11 km.
const KM_PER_HUNDREDTH = 1.1132;

type Ship = { mmsi: number; longitude: number; latitude: number; ageSeconds?: number };

function frameAt(slot: number, ships: Ship[]) {
  const sorted = [...ships].sort((first, second) => first.mmsi - second.mmsi);
  return {
    frameTimeMs: START_MS + slot * SLOT_MS,
    shipCount: sorted.length,
    mmsi: Uint32Array.from(sorted.map((ship) => ship.mmsi)),
    longitudeUnits: Int32Array.from(sorted.map((ship) => Math.round(ship.longitude * COORDINATE_UNITS_PER_DEGREE))),
    latitudeUnits: Int32Array.from(sorted.map((ship) => Math.round(ship.latitude * COORDINATE_UNITS_PER_DEGREE))),
    ageSeconds: Uint16Array.from(sorted.map((ship) => ship.ageSeconds ?? 0)),
  };
}

describe("line passages", () => {
  test("finds a crossing between two frames and dates it where the move cuts the line", () => {
    const scan = createPassageScan(CABLE);
    // Heading north at about 8 knots: 60 N falls a quarter of the way through the move.
    addFrameToPassageScan(scan, frameAt(0, [{ mmsi: 230000001, longitude: 25, latitude: 59.99 }]));
    addFrameToPassageScan(scan, frameAt(1, [{ mmsi: 230000001, longitude: 25, latitude: 60.03 }]));
    const [passage] = summarizePassages(scan);
    expect(passage?.mmsi).toBe(230000001);
    expect(passage?.closestKm).toBe(0);
    expect(passage?.crossedAtMs).toBeCloseTo(START_MS + SLOT_MS / 4, -3);
  });

  test("keeps a ship that came within the distance and drops one that stayed farther", () => {
    const scan = createPassageScan(CABLE);
    addFrameToPassageScan(scan, frameAt(0, [
      { mmsi: 230000002, longitude: 24.5, latitude: 60.02 },
      { mmsi: 230000003, longitude: 25.5, latitude: 60.1 },
    ]));
    const passages = summarizePassages(scan);
    expect(passages.map((passage) => passage.mmsi)).toEqual([230000002]);
    expect(passages[0]?.crossedAtMs).toBeNull();
    expect(passages[0]?.closestKm).toBeCloseTo(2 * KM_PER_HUNDREDTH, 1);
    expect(passages[0]?.closestKm).toBeLessThanOrEqual(PASSAGE_DISTANCE_KM);
  });

  test("never joins a move faster than 50 knots or across a long gap into a crossing", () => {
    const scan = createPassageScan(CABLE);
    // 0.5 degrees in 10 minutes is about 167 knots: a bad position, not a voyage.
    addFrameToPassageScan(scan, frameAt(0, [{ mmsi: 230000004, longitude: 25, latitude: 59.75 }]));
    addFrameToPassageScan(scan, frameAt(1, [{ mmsi: 230000004, longitude: 25, latitude: 60.25 }]));
    // Two positions three slots apart are not joined.
    addFrameToPassageScan(scan, frameAt(0, [{ mmsi: 230000005, longitude: 24.2, latitude: 59.97 }]));
    addFrameToPassageScan(scan, frameAt(3, [{ mmsi: 230000005, longitude: 24.2, latitude: 60.04 }]));
    expect(summarizePassages(scan)).toEqual([]);
  });

  test("counts a frame once and lists crossings before near passes", () => {
    const scan = createPassageScan(CABLE);
    expect(addFrameToPassageScan(scan, frameAt(0, [{ mmsi: 230000006, longitude: 25.9, latitude: 60.01 }, { mmsi: 230000007, longitude: 24.1, latitude: 59.995 }]))).toBe(true);
    expect(addFrameToPassageScan(scan, frameAt(0, []))).toBe(false);
    addFrameToPassageScan(scan, frameAt(1, [{ mmsi: 230000007, longitude: 24.1, latitude: 60.005 }]));
    expect(summarizePassages(scan).map((passage) => passage.mmsi)).toEqual([230000007, 230000006]);
  });
});
