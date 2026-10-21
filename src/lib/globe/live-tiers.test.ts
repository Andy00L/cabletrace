import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COORDINATE_UNITS_PER_DEGREE } from "@/lib/live/snapshot-codec";
import { findFaultRipples } from "./fault-ripples";
import { describeShipTierRefusal, readDistanceTier, readPlanetShare, SHIP_TIER_DISTANCE, TIER_CAMERA_DISTANCE } from "./globe-tier";
import { countShipsBySea, countShipsInBoxes, findSeaIndex, measureSeaShare, parseSeaAreas, rankSeasByShips } from "./sea-areas";
import { binShipDensity, findDensityCell } from "./ship-density";
import { readLongitudeLatitude } from "./sphere";

function frameAt(positions: [number, number][]) {
  return {
    shipCount: positions.length,
    longitudeUnits: Int32Array.from(positions.map(([longitude]) => Math.round(longitude * COORDINATE_UNITS_PER_DEGREE))),
    latitudeUnits: Int32Array.from(positions.map(([, latitude]) => Math.round(latitude * COORDINATE_UNITS_PER_DEGREE))),
  };
}

describe("globe tiers", () => {
  test("each ladder distance reads back as its own tier", () => {
    expect(readDistanceTier(TIER_CAMERA_DISTANCE.planet)).toBe("planet");
    expect(readDistanceTier(TIER_CAMERA_DISTANCE.sea)).toBe("sea");
    expect(readDistanceTier(TIER_CAMERA_DISTANCE.strait)).toBe("strait");
  });

  test("the density field is whole from orbit, gone at sea distance, and in between across the crossover", () => {
    expect(readPlanetShare(TIER_CAMERA_DISTANCE.planet)).toBe(1);
    expect(readPlanetShare(TIER_CAMERA_DISTANCE.sea)).toBe(0);
    const middle = readPlanetShare(2.05);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  test("the Ship tier sits well inside the Strait tier, so pressing it visibly closes in", () => {
    expect(readDistanceTier(SHIP_TIER_DISTANCE)).toBe("strait");
    // Altitude above the ground, in Earth radii: the Ship tier at most half the Strait tier's.
    expect(SHIP_TIER_DISTANCE - 1).toBeLessThanOrEqual((TIER_CAMERA_DISTANCE.strait - 1) / 2);
  });
});

describe("a press on Ship that could not fly", () => {
  const ARKTIS_MMSI = 230359000;

  test("asks for a ship until one is picked", () => {
    const refusal = { kind: "no-ship" } as const;
    expect(describeShipTierRefusal({ refusal, selectedMmsi: null, minuteLabel: "22:10", shipName: "" })).toContain("Pick a ship first");
    expect(describeShipTierRefusal({ refusal, selectedMmsi: ARKTIS_MMSI, minuteLabel: "22:10", shipName: "ARKTIS" })).toBeNull();
  });

  test("names the ship and the minute while both stay as they were, then clears", () => {
    const refusal = { kind: "not-in-frames", mmsi: ARKTIS_MMSI, minuteLabel: "04:10" } as const;
    expect(describeShipTierRefusal({ refusal, selectedMmsi: ARKTIS_MMSI, minuteLabel: "04:10", shipName: "ARKTIS" })).toBe(
      "ARKTIS is not in the frames at 04:10 UTC. Move the timeline to a moment a feed heard it.",
    );
    expect(describeShipTierRefusal({ refusal, selectedMmsi: ARKTIS_MMSI, minuteLabel: "04:20", shipName: "ARKTIS" })).toBeNull();
    expect(describeShipTierRefusal({ refusal, selectedMmsi: 244000000, minuteLabel: "04:10", shipName: "OTHER" })).toBeNull();
  });

  test("says nothing when every press flew", () => {
    expect(describeShipTierRefusal({ refusal: null, selectedMmsi: null, minuteLabel: "22:10", shipName: "" })).toBeNull();
  });
});

describe("sea areas", () => {
  // A 4 by 2 grid of 90 degree cells: the north row is sea 1 then sea 2, the south row is land then sea 2.
  const tinyAreas = parseSeaAreas({
    cellDegrees: 90,
    width: 4,
    height: 2,
    seas: [
      { name: "North", longitude: -135, latitude: 45, cellCount: 2 },
      { name: "East", longitude: 45, latitude: 0, cellCount: 3 },
    ],
    runs: [2, 1, 2, 2, 2, 0, 2, 2],
  });

  test("decodes the runs row by row from the north pole and 180 W", () => {
    expect(tinyAreas.ok).toBe(true);
    if (!tinyAreas.ok) return;
    expect(findSeaIndex(tinyAreas.value, -170, 80)).toBe(0);
    expect(findSeaIndex(tinyAreas.value, 100, 10)).toBe(1);
    expect(findSeaIndex(tinyAreas.value, -100, -40)).toBe(-1);
    // The poles and the antimeridian stay inside the grid.
    expect(findSeaIndex(tinyAreas.value, 180, -90)).toBe(1);
  });

  test("counts ships per sea and ranks the busiest first, leaving out empty seas", () => {
    if (!tinyAreas.ok) return;
    const counts = countShipsBySea(tinyAreas.value, frameAt([[-170, 80], [100, 10], [120, -30], [-100, -40]]));
    expect([...counts]).toEqual([1, 2]);
    expect(rankSeasByShips(tinyAreas.value, counts).map((entry) => entry.sea.name)).toEqual(["East", "North"]);
  });

  test("counts a region's ships inside its box only", () => {
    const counts = countShipsInBoxes(frameAt([[25, 60], [24, 59.5], [10, 55]]), [
      { id: "gulf-of-finland", box: { west: 22, east: 30.5, south: 59, north: 60.8 } },
      { id: "elsewhere", box: { west: -10, east: 0, south: 40, north: 50 } },
    ]);
    expect(counts.get("gulf-of-finland")).toBe(2);
    expect(counts.get("elsewhere")).toBe(0);
  });

  test("measures how much of a box lies in each sea", () => {
    if (!tinyAreas.ok) return;
    // Spans the north row's two seas evenly.
    const box = { west: -90, east: 90, south: 10, north: 80 };
    expect(measureSeaShare(tinyAreas.value, box, 0)).toBeCloseTo(3 / 7);
    expect(measureSeaShare(tinyAreas.value, box, 1)).toBeCloseTo(4 / 7);
  });

  test("refuses runs that do not fill the grid or name a sea that does not exist", () => {
    expect(parseSeaAreas({ cellDegrees: 90, width: 4, height: 2, seas: [], runs: [8, 0, 1, 0] }).ok).toBe(false);
    expect(parseSeaAreas({ cellDegrees: 90, width: 4, height: 2, seas: [], runs: [8, 1] }).ok).toBe(false);
    expect(parseSeaAreas({ cellDegrees: 90, width: 4, height: 2, seas: [], runs: [7, 0] }).ok).toBe(false);
  });

  test("the built file puts the replays' waters in the seas a reader expects", () => {
    const areas = parseSeaAreas(JSON.parse(readFileSync("public/globe/seas.json", "utf8")));
    expect(areas.ok).toBe(true);
    if (!areas.ok) return;
    const seaNameAt = (longitude: number, latitude: number) => areas.value.seas[findSeaIndex(areas.value, longitude, latitude)]?.name;
    // Estlink 2's cut (Eagle S) and Helsinki harbour count for the Baltic, the Gulf of Finland being one of its arms.
    expect(seaNameAt(25.04, 59.93)).toBe("Baltic Sea");
    expect(seaNameAt(24.95, 60.16)).toBe("Baltic Sea");
    expect(seaNameAt(42.95, 13.37)).toBe("Red Sea");
    expect(seaNameAt(119.5, 25.2)).toBe("Taiwan Strait");
    expect(seaNameAt(3.5, 56)).toBe("North Sea");
  });
});

describe("ship density", () => {
  test("ships in one cell share one dot whose count is theirs, and the dot sits inside the cell", () => {
    const density = binShipDensity(frameAt([[24.9, 60.1], [25.1, 60.3], [-40, 10]]));
    expect(density.cellCount).toBe(2);
    expect([...density.counts].sort()).toEqual([1, 2]);
    for (let cell = 0; cell < density.cellCount; cell += 1) {
      const centre = readLongitudeLatitude(density.positions[cell * 3] ?? 0, density.positions[cell * 3 + 1] ?? 0, density.positions[cell * 3 + 2] ?? 0);
      const shipLongitude = (density.counts[cell] ?? 0) === 2 ? 25 : -40;
      expect(findDensityCell(centre.longitude, centre.latitude)).toBe(findDensityCell(shipLongitude, (density.counts[cell] ?? 0) === 2 ? 60.2 : 10));
    }
  });

  test("cells keep about the same width on the ground from the equator to the far north", () => {
    // Moving 2 degrees east at the equator and 4 degrees east at 60 N each crosses about 220 km: one cell either way.
    expect(findDensityCell(2.5, 1) - findDensityCell(0.5, 1)).toBe(1);
    expect(findDensityCell(4.5, 61) - findDensityCell(0.5, 61)).toBe(1);
  });

  test("an empty frame draws no dots", () => {
    expect(binShipDensity(frameAt([])).cellCount).toBe(0);
  });
});

describe("fault ripples", () => {
  const estlink = { name: "Estlink 2", kind: "power" as const, points: [24, 59.5, 25, 59.6, 26, 59.7] };
  const dayStartMs = Date.UTC(2026, 9, 20);
  const dayEndMs = dayStartMs + 24 * 3_600_000;

  test("ripples a cable whose fault window overlaps the day, at its middle point, once", () => {
    const drafts = [
      { cableName: "Estlink 2", faultNotBeforeMs: dayStartMs - 3_600_000, faultNotAfterMs: dayStartMs + 3_600_000 },
      { cableName: "Estlink 2", faultNotBeforeMs: dayStartMs + 7_200_000, faultNotAfterMs: dayStartMs + 9_000_000 },
    ];
    expect(findFaultRipples({ drafts, watchedLines: [estlink], dayStartMs, dayEndMs })).toEqual([{ cableName: "Estlink 2", longitude: 25, latitude: 59.6 }]);
  });

  test("leaves out a fault outside the day and a cable the globe does not draw", () => {
    const drafts = [
      { cableName: "Estlink 2", faultNotBeforeMs: dayEndMs + 1, faultNotAfterMs: dayEndMs + 3_600_000 },
      { cableName: "Unknown cable", faultNotBeforeMs: dayStartMs, faultNotAfterMs: dayEndMs },
    ];
    expect(findFaultRipples({ drafts, watchedLines: [estlink], dayStartMs, dayEndMs })).toEqual([]);
  });
});
