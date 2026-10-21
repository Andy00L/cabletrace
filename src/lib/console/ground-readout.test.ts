import { describe, expect, test } from "bun:test";
import { describeGroundReadout } from "@/lib/console/ground-readout";

const CUTS = [{ cableName: "C-Lion 1", label: "C-Lion1" }];

describe("describeGroundReadout", () => {
  test("reads the water, the cable under the case's name and the ship's nearest pass", () => {
    const lines = describeGroundReadout({ waterDepthMetres: 61.6, nearestCable: { name: "C-Lion 1", distanceMetres: 1340 }, shipPass: { atMs: Date.parse("2024-12-25T16:41:00Z"), distanceMetres: 120.4 } }, CUTS);
    expect(lines.map((line) => line.text)).toEqual(["62 m of water", "C-Lion1, 1.3 km", "Ship nearest at 16:41 UTC, 120 m off"]);
  });

  test("says land on land and leaves out what the area does not have", () => {
    expect(describeGroundReadout({ waterDepthMetres: null, nearestCable: null, shipPass: null }, CUTS)).toEqual([{ id: "depth", text: "Land" }]);
  });
});
