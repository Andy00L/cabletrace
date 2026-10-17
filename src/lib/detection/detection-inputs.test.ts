import { describe, expect, test } from "bun:test";
import { assessFleet } from "./assess-fleet";
import { parseDetectionInputs } from "./detection-inputs";
import { sailLegs, steadySpeed } from "./synthetic-tracks";

// The shape public.detection_inputs() returns (supabase/migrations/20261018300000_detections.sql).
const PAYLOAD = {
  positions: [
    { mmsi: 1, atMs: 1_000, longitude: 25, latitude: 59.9, speedKnots: 7.5, courseDegrees: 90, headingDegrees: 91, navigationStatus: 0 },
    { mmsi: 1, atMs: 61_000, longitude: 25.01, latitude: 59.9, speedKnots: null, courseDegrees: null, headingDegrees: null, navigationStatus: null },
    { mmsi: 2, atMs: 1_000, longitude: 26, latitude: 60, speedKnots: 0.1, courseDegrees: 10, headingDegrees: 10, navigationStatus: 1 },
  ],
  vessels: [{ mmsi: 1, name: "TEST", shipType: 70, draughtMetres: 9.1 }],
  cables: [
    { name: "Split cable", kind: "telecom", route: { type: "MultiLineString", coordinates: [[[25, 59], [25, 60]], [[26, 59], [26, 60]]] } },
    { name: "Plain cable", kind: "power", route: { type: "LineString", coordinates: [[24, 59], [24, 60]] } },
  ],
};

describe("parseDetectionInputs", () => {
  test("groups positions by ship, keeps nulls as null, and splits multi-part routes", () => {
    const parsed = parseDetectionInputs(PAYLOAD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const firstShip = parsed.value.tracks.find((track) => track.mmsi === 1);
    expect(firstShip?.track).toHaveLength(2);
    expect(firstShip?.track[1]?.speedKnots).toBeNull();
    expect(firstShip?.ship).toEqual({ lengthMetres: null, beamMetres: null, draughtMetres: 9.1, shipType: 70, antennaFromBowMetres: null });
    expect(parsed.value.tracks.find((track) => track.mmsi === 2)?.ship.shipType).toBeNull();
    expect(parsed.value.cables.map((cable) => cable.name)).toEqual(["Split cable", "Split cable", "Plain cable"]);
  });

  test("one malformed position or route fails the whole payload", () => {
    expect(parseDetectionInputs({ ...PAYLOAD, positions: [...PAYLOAD.positions, { mmsi: 3, atMs: "late" }] }).ok).toBe(false);
    expect(parseDetectionInputs({ ...PAYLOAD, cables: [{ name: "Broken", kind: "telecom", route: { type: "LineString", coordinates: [[24, "x"]] } }] }).ok).toBe(false);
    expect(parseDetectionInputs({ ...PAYLOAD, cables: [{ name: "Odd", kind: "sewer", route: PAYLOAD.cables[1]?.route }] }).ok).toBe(false);
    expect(parseDetectionInputs(null).ok).toBe(false);
  });
});

describe("assessFleet", () => {
  test("counts what it could not judge and ranks alerts before watches", () => {
    const startMs = Date.parse("2026-10-01T06:00:00Z");
    const cable = { name: "Test cable", kind: "power" as const, coordinates: [[25.5, 59.7], [25.5, 60.1]] as [number, number][] };
    const leg = (minutes: number, knots: number) => ({ minutes, speedKnots: steadySpeed(knots), courseDegrees: 90, headingOffsetDegrees: 0, navigationStatus: 0 });
    const ship = { lengthMetres: 224, beamMetres: 32, draughtMetres: 14.5, shipType: 70, antennaFromBowMetres: 189 };
    const summary = assessFleet({
      tracks: [
        { mmsi: 10, ship, track: sailLegs({ longitude: 25.1, latitude: 59.9 }, startMs, [leg(60, 11), leg(30, 7), leg(60, 11)]) },
        { mmsi: 20, ship, track: sailLegs({ longitude: 25.0, latitude: 59.9 }, startMs, [leg(60, 11), leg(90, 8)]) },
        { mmsi: 30, ship: { ...ship, shipType: 52 }, track: sailLegs({ longitude: 25.0, latitude: 59.9 }, startMs, [leg(60, 11)]) },
        { mmsi: 40, ship, track: sailLegs({ longitude: 25.0, latitude: 59.9 }, startMs, [leg(2, 11)]) },
      ],
      cables: [cable],
      depthAt: null,
    });
    expect(summary.shipCount).toBe(4);
    expect(summary.notEligibleCount).toBe(1);
    expect(summary.insufficientDataCount).toBe(1);
    expect(summary.detections.map((found) => [found.mmsi, found.detection.level])).toEqual([
      [20, "alert"],
      [10, "watch"],
    ]);
  });
});
