import { describe, expect, test } from "bun:test";
import { compareFeeds, deadReckon, judgeSamples, parseCrossSourceRows, type CrossSourceSample } from "./cross-source";
import type { ShipRecord } from "./snapshot-codec";

const GULF = { west: 22, east: 30.5, south: 59, north: 60.8 };
const WINDOW_START_MS = 1_000_000;

function ship(fields: Partial<ShipRecord> & Pick<ShipRecord, "mmsi" | "source">): ShipRecord {
  return { longitude: 25, latitude: 60, speedKnots: 10, courseDegrees: 0, headingDegrees: 0, shipClass: "cargo", reportedAtMs: WINDOW_START_MS + 30_000, ...fields };
}

describe("deadReckon", () => {
  test("moves a ship along its course at its speed, and leaves a stopped ship in place", () => {
    // 10 knots for 60 s is 308.7 m, north: 0.002776 degrees of latitude.
    const moved = deadReckon(ship({ mmsi: 1, source: "aisstream" }), WINDOW_START_MS + 90_000);
    expect(moved.longitude).toBeCloseTo(25, 6);
    expect(moved.latitude).toBeCloseTo(60.002776, 5);
    expect(deadReckon(ship({ mmsi: 1, source: "aisstream", speedKnots: 0.2 }), WINDOW_START_MS + 90_000)).toEqual({ longitude: 25, latitude: 60 });
  });
});

describe("compareFeeds", () => {
  test("counts shared, aisstream-only and matched moving ships inside the box", () => {
    const sample = compareFeeds({
      regionId: "gulf-of-finland",
      box: GULF,
      aisstream: [
        ship({ mmsi: 1, source: "aisstream" }),
        ship({ mmsi: 2, source: "aisstream" }),
        // Shared, but stamped 5 minutes apart: not a matched pair.
        ship({ mmsi: 3, source: "aisstream" }),
        // Outside the box.
        ship({ mmsi: 4, source: "aisstream", longitude: 3 }),
        // Moored: not compared, so its absence from Digitraffic counts against nothing.
        ship({ mmsi: 6, source: "aisstream", speedKnots: 0.2 }),
      ],
      digitraffic: [
        ship({ mmsi: 1, source: "digitraffic" }),
        ship({ mmsi: 3, source: "digitraffic", reportedAtMs: WINDOW_START_MS + 330_000 }),
        // Reported before the window: in the snapshot, not counted as heard in the window.
        ship({ mmsi: 5, source: "digitraffic", reportedAtMs: WINDOW_START_MS - 60_000 }),
        // Moored: not counted as a moving Digitraffic ship.
        ship({ mmsi: 7, source: "digitraffic", speedKnots: 0 }),
      ],
      windowStartMs: WINDOW_START_MS,
      sampledAtMs: WINDOW_START_MS + 110_000,
    });
    expect(sample).toEqual({
      regionId: "gulf-of-finland",
      sampledAtMs: WINDOW_START_MS + 110_000,
      windowSeconds: 110,
      aisstreamShips: 3,
      digitrafficShips: 2,
      sharedShips: 2,
      aisstreamOnlyShips: 1,
      matchedPairs: 1,
      medianOffsetMetres: 0,
      p95OffsetMetres: 0,
      withinToleranceShare: 1,
    });
  });
});

function sample(fields: Partial<CrossSourceSample>): CrossSourceSample {
  return {
    regionId: "gulf-of-finland",
    sampledAtMs: 0,
    windowSeconds: 110,
    aisstreamShips: 40,
    digitrafficShips: 300,
    sharedShips: 39,
    aisstreamOnlyShips: 1,
    matchedPairs: 30,
    medianOffsetMetres: 12,
    p95OffsetMetres: 90,
    withinToleranceShare: 1,
    ...fields,
  };
}

describe("judgeSamples", () => {
  test("agrees within tolerance, disagrees beyond it, and declines to judge too few pairs", () => {
    expect(judgeSamples([sample({})]).verdict).toBe("agree");
    const missing = judgeSamples([sample({ sharedShips: 20, aisstreamOnlyShips: 20 })]);
    expect(missing.verdict).toBe("disagree");
    expect(missing.reasons).toEqual(["Digitraffic holds 50% of the moving ships aisstream hears, under 90%"]);
    expect(judgeSamples([sample({ withinToleranceShare: 0.5 })]).reasons).toEqual(["50% of matched positions within 250 m, under 95%"]);
    expect(judgeSamples([sample({ matchedPairs: 5 })]).verdict).toBe("no-data");
    expect(judgeSamples([]).verdict).toBe("no-data");
  });
});

describe("parseCrossSourceRows", () => {
  test("reads Data API rows and rejects a malformed one", () => {
    const row = {
      region_id: "gulf-of-finland",
      sampled_at: "2026-10-19T10:01:50+00:00",
      window_seconds: 110,
      aisstream_ships: 40,
      digitraffic_ships: 300,
      shared_ships: 39,
      aisstream_only_ships: 1,
      matched_pairs: 30,
      median_offset_metres: 12.5,
      p95_offset_metres: null,
      within_tolerance_share: 0.97,
    };
    const parsed = parseCrossSourceRows([row]);
    expect(parsed.ok && parsed.value[0]).toMatchObject({ regionId: "gulf-of-finland", sampledAtMs: Date.UTC(2026, 9, 19, 10, 1, 50), p95OffsetMetres: null, withinToleranceShare: 0.97 });
    expect(parseCrossSourceRows([{ ...row, matched_pairs: "30" }]).ok).toBe(false);
    expect(parseCrossSourceRows({}).ok).toBe(false);
  });
});
