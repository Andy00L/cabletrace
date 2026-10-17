import { describe, expect, test } from "bun:test";
import { estimateAnchorModel } from "./anchor-model";
import { reconstructAnchorPath } from "./anchor-path";
import type { CableLine } from "./detection-types";
import { distanceMetres } from "./geodesy";
import { sailLegs, steadySpeed } from "./synthetic-tracks";

const CABLE: CableLine = { name: "Test cable", kind: "telecom", coordinates: [[25.5, 59.7], [25.5, 60.1]] };
const START_MS = Date.parse("2026-10-01T06:00:00Z");
const MODEL = estimateAnchorModel({ lengthMetres: 224, beamMetres: 32, draughtMetres: 14.5, shipType: 70, antennaFromBowMetres: 189 });
const depthAt = () => -45;

// Eastbound at 7.5 knots from 25.40 E, about 5.6 km west of the cable: the bow is over the cable after about 24 minutes.
const TRACK = sailLegs({ longitude: 25.4, latitude: 59.9 }, START_MS, [
  { minutes: 60, speedKnots: steadySpeed(7.5), courseDegrees: 90, headingOffsetDegrees: 0, navigationStatus: 0 },
]);
const shipCrossingIndex = TRACK.findIndex((point) => point.longitude >= 25.5);
const beforeCrossing = TRACK[shipCrossingIndex - 1];
const afterCrossing = TRACK[shipCrossingIndex];
const shipCrossingMs =
  beforeCrossing && afterCrossing
    ? beforeCrossing.atMs + ((25.5 - beforeCrossing.longitude) / (afterCrossing.longitude - beforeCrossing.longitude)) * (afterCrossing.atMs - beforeCrossing.atMs)
    : 0;
// 7.5 knots in metres per millisecond.
const SPEED_METRES_PER_MS = (7.5 * 1852) / 3_600_000;

describe("reconstructAnchorPath", () => {
  test("the anchor crosses the cable after the ship, at the ship's crossing point, inside its time band", () => {
    const result = reconstructAnchorPath({ track: TRACK, startMs: START_MS, endMs: START_MS + 59 * 60_000, model: MODEL, depthAt, cables: [CABLE] });
    expect(result.cableCrossings).toHaveLength(1);
    const [crossing] = result.cableCrossings;
    expect(crossing?.cableName).toBe("Test cable");
    expect(crossing?.longitude).toBeCloseTo(25.5, 4);
    // The anchor reaches the crossing point one trail distance (layback minus antenna-to-bow) after the antenna did.
    const trailMetres = (result.anchorPath[0]?.laybackMetres ?? 0) - MODEL.antennaFromBowMetres;
    expect(trailMetres).toBeGreaterThan(0);
    expect(Math.abs((crossing?.atMs ?? 0) - (shipCrossingMs + trailMetres / SPEED_METRES_PER_MS))).toBeLessThan(5_000);
    expect(crossing?.earliestMs ?? 0).toBeLessThanOrEqual(crossing?.atMs ?? 0);
    expect(crossing?.latestMs ?? 0).toBeGreaterThanOrEqual(crossing?.atMs ?? 0);
  });

  test("each anchor point trails the ship by the layback minus the antenna's distance from the bow", () => {
    const result = reconstructAnchorPath({ track: TRACK, startMs: START_MS, endMs: START_MS + 59 * 60_000, model: MODEL, depthAt, cables: [CABLE] });
    const anchor = result.anchorPath[result.anchorPath.length - 1];
    const ship = TRACK[TRACK.length - 1];
    if (!anchor || !ship) throw new Error("no anchor point");
    expect(anchor.depthMetres).toBe(45);
    expect(distanceMetres(anchor, ship)).toBeCloseTo(anchor.laybackMetres - MODEL.antennaFromBowMetres, -1);
  });

  test("a drag that ends before the anchor reaches the cable claims no crossing", () => {
    const endMs = shipCrossingMs - 5 * 60_000;
    const result = reconstructAnchorPath({ track: TRACK, startMs: START_MS, endMs, model: MODEL, depthAt, cables: [CABLE] });
    expect(result.cableCrossings).toEqual([]);
  });

  test("no crossing is claimed across a silence", () => {
    const silent = TRACK.filter((point) => point.atMs < shipCrossingMs - 15 * 60_000 || point.atMs > shipCrossingMs + 15 * 60_000);
    const result = reconstructAnchorPath({ track: silent, startMs: START_MS, endMs: START_MS + 59 * 60_000, model: MODEL, depthAt, cables: [CABLE] });
    expect(result.cableCrossings).toEqual([]);
  });

  test("a path along a cable counts as following it", () => {
    const along = sailLegs({ longitude: 25.501, latitude: 59.75 }, START_MS, [
      { minutes: 60, speedKnots: steadySpeed(7.5), courseDegrees: 0, headingOffsetDegrees: 0, navigationStatus: 0 },
    ]);
    const result = reconstructAnchorPath({ track: along, startMs: START_MS, endMs: START_MS + 59 * 60_000, model: MODEL, depthAt, cables: [CABLE] });
    expect(result.followedKm).toBeGreaterThan(10);
  });
});
