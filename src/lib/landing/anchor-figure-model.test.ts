import { describe, expect, test } from "bun:test";
import { estimateCaseShipChain, readChainSpan } from "@/lib/ships/anchor-chain";
import {
  PART_PULL_METRES,
  hawseHeightMetres,
  placeAnchor,
  readChainAt,
  readRestingMoment,
  stepCable,
  tourPaidOutAt,
  type AnchorFigureFacts,
} from "@/lib/landing/anchor-figure-model";

// Eagle S at the C-Lion1 cut, as the replay's series reads it from the seabed grid (59.2 m, 6.86 knots).
const FACTS: AnchorFigureFacts = {
  vesselName: "Eagle S",
  lengthMetres: 228.6,
  cutLabel: "C-Lion1",
  depthMetres: 59.2,
  speedKnots: 6.86,
  chain: estimateCaseShipChain("tanker", 228.6),
};

describe("anchor figure model", () => {
  test("all the chain out gives the replay's own layback for the depth", () => {
    const reading = readChainAt(FACTS, 330, 40);
    const replay = readChainSpan(FACTS.chain, -FACTS.depthMetres);
    expect(reading.kind).toBe("grounded");
    if (reading.kind !== "grounded" || !replay) throw new Error("expected a grounded chain");
    expect(reading.laybackMetres).toBeCloseTo(replay.laybackMetres, 6);
    expect(reading.points.at(-1)?.upMetres).toBeCloseTo(hawseHeightMetres(FACTS), 0);
  });

  test("less chain than the hawse is high leaves the anchor hanging clear of the seabed", () => {
    const reading = readChainAt(FACTS, 45, 10);
    expect(reading.kind).toBe("hanging");
    if (reading.kind !== "hanging") throw new Error("expected a hanging chain");
    expect(reading.clearanceMetres).toBeCloseTo(hawseHeightMetres(FACTS) - 45, 6);
    expect(placeAnchor(reading).isOnSeabed).toBe(false);
  });

  test("a cable reaching flukes in the seabed snags, then parts after the pull", () => {
    const anchor = { aheadOfHawseMetres: -300, isOnSeabed: true };
    const lying = { worldMetres: 0, phase: { kind: "lying" } as const };
    const snagged = stepCable(lying, anchor, 301);
    expect(snagged.phase.kind).toBe("snagged");
    expect(stepCable(snagged, anchor, 300 + PART_PULL_METRES - 1).phase.kind).toBe("snagged");
    expect(stepCable(snagged, anchor, 300 + PART_PULL_METRES + 0.5).phase.kind).toBe("parted");
  });

  test("a cable reaching a hanging anchor passes under it", () => {
    const anchor = { aheadOfHawseMetres: 0, isOnSeabed: false };
    expect(stepCable({ worldMetres: 0, phase: { kind: "lying" } }, anchor, 1).phase.kind).toBe("passed");
  });

  test("the tour keeps all the chain out at the snag and hauls in after it", () => {
    const { travelledMetres } = readRestingMoment(FACTS);
    const snagAt = travelledMetres - PART_PULL_METRES - 26;
    expect(tourPaidOutAt(FACTS, snagAt)).toBeCloseTo(330, 6);
    expect(tourPaidOutAt(FACTS, snagAt + 300)).toBeLessThan(hawseHeightMetres(FACTS));
  });
});
