import { describe, expect, test } from "bun:test";
import { describeAnchorReadouts } from "@/lib/console/anchor-cam-readout";

// The anchor cam numbers at 10:40 on Eagle S (round-2 storyboard, director.md).
const FACTS = { waterDepthMetres: 75.8, chainPaidOutMetres: 330, laybackMetres: 302, nearestCable: { name: "HVDC Estlink 2", distanceMetres: 1249 }, anchorSpeedKnots: 6.87 };
const CUTS = [{ cableName: "HVDC Estlink 2", label: "Estlink 2" }];

describe("describeAnchorReadouts", () => {
  test("reads board 22's four figures, the cable under the case's own name", () => {
    expect(describeAnchorReadouts(FACTS, CUTS).map((readout) => `${readout.label} ${readout.value} ${readout.unit}`)).toEqual(["Depth 75.8 m", "Chain out 330 m", "To Estlink 2 1.25 km", "Over ground 6.9 kn"]);
  });

  test("gives a cable under a kilometre in metres, and an uncut cable its mapped name", () => {
    const near = describeAnchorReadouts({ ...FACTS, nearestCable: { name: "Baltika", distanceMetres: 279.4 } }, CUTS);
    expect(near[2]).toEqual({ id: "cable", label: "To Baltika", value: "279", unit: "m" });
  });

  test("says so when the area maps no cable", () => {
    expect(describeAnchorReadouts({ ...FACTS, nearestCable: null }, CUTS)[2]).toEqual({ id: "cable", label: "Nearest cable", value: "None", unit: "" });
  });
});
