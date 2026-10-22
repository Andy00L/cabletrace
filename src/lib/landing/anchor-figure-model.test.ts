import { describe, expect, test } from "bun:test";
import { estimateCaseShipChain, readChainSpan } from "@/lib/ships/anchor-chain";
import {
  PART_PULL_METRES,
  hawseHeightMetres,
  readCablePhase,
  readChainAt,
  readStageMoment,
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
  });

  test("a cable lies until the hook reaches it, snags for the pull, then parts, scrubbed either way", () => {
    // The hook 40 m aft of the hawse reaches a cable at world 0 once the ship has travelled 40 m.
    expect(readCablePhase(0, -40, 39.9).kind).toBe("lying");
    expect(readCablePhase(0, -40, 40 + PART_PULL_METRES - 0.1)).toEqual({ kind: "snagged", atTravelledMetres: 40 });
    expect(readCablePhase(0, -40, 40 + PART_PULL_METRES)).toEqual({ kind: "parted", atTravelledMetres: 40 });
    expect(readCablePhase(0, -40, 10).kind).toBe("lying");
  });

  test("the stages run in story order: hanging clear, ploughing short of the cable, then past the part", () => {
    const input = { snagAtMetres: 100, draggingPaidOutMetres: 90 };
    const drop = readStageMoment("drop", input);
    const drag = readStageMoment("drag", input);
    const cut = readStageMoment("cut", input);
    expect(readChainAt(FACTS, drop.paidOutMetres, 8).kind).toBe("hanging");
    expect(drop.travelledMetres).toBeLessThan(drag.travelledMetres);
    expect(drag.travelledMetres).toBeLessThan(input.snagAtMetres);
    expect(cut.travelledMetres).toBeGreaterThan(input.snagAtMetres + PART_PULL_METRES);
    expect(drag.paidOutMetres).toBe(90);
  });
});
