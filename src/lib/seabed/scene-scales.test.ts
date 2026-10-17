import { describe, expect, test } from "bun:test";
import { chooseSceneExaggeration, describeOverviewScale } from "./scene-scales";

// Elevation ranges of the shipped seabed files (public/seabed/<area>-seabed.json, elevationRange).
describe("chooseSceneExaggeration", () => {
  test("keeps 20 and 10 for the shallow Baltic blocks", () => {
    expect(chooseSceneExaggeration({ lowestMetres: -118.3, highestMetres: 118.8 })).toEqual({ water: 20, land: 10 });
    expect(chooseSceneExaggeration({ lowestMetres: -247.9, highestMetres: 298.1 })).toEqual({ water: 20, land: 10 });
  });

  test("draws deep water and high land less exaggerated, land never taller than water is deep", () => {
    expect(chooseSceneExaggeration({ lowestMetres: -496, highestMetres: 1891.4 })).toEqual({ water: 10, land: 3 });
    expect(chooseSceneExaggeration({ lowestMetres: -1498, highestMetres: 1495.9 })).toEqual({ water: 3, land: 3 });
    expect(chooseSceneExaggeration({ lowestMetres: -3200, highestMetres: 1035.3 })).toEqual({ water: 2, land: 2 });
  });

  test("falls back to true scale when even that is taller than the limit", () => {
    expect(chooseSceneExaggeration({ lowestMetres: -9000, highestMetres: 0 })).toEqual({ water: 1, land: 1 });
  });
});

describe("describeOverviewScale", () => {
  test("states the area's own factors", () => {
    expect(describeOverviewScale({ water: 2, land: 2 })).toBe("Depth is drawn 2 times deeper and land 2 times higher; the ship is drawn 6 times and the anchor 30 times their size.");
    expect(describeOverviewScale({ water: 1, land: 1 })).toStartWith("Depth is drawn at true scale and land at true scale;");
  });
});
