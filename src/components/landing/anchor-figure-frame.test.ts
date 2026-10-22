import { describe, expect, test } from "bun:test";
import { CHAIN_POINT_COUNT, buildAnchorArt, buildStageFrame } from "@/components/landing/anchor-figure-frame";
import { depthOf, iso } from "@/components/iso/iso-kit";
import { BLOCK, DRAWN_SCALES, buildFigureView } from "@/components/landing/anchor-figure-view";
import { readChainAt, type AnchorFigureFacts } from "@/lib/landing/anchor-figure-model";
import { estimateCaseShipChain } from "@/lib/ships/anchor-chain";

// Eagle S at the C-Lion1 cut, as the replay's series reads it from the seabed grid (59.2 m, 6.86 knots).
const FACTS: AnchorFigureFacts = {
  vesselName: "Eagle S",
  lengthMetres: 228.6,
  cutLabel: "C-Lion1",
  depthMetres: 59.2,
  speedKnots: 6.86,
  chain: estimateCaseShipChain("tanker", 228.6),
};
const VIEW = buildFigureView(FACTS);

describe("anchor figure drawing", () => {
  test("the chain's links are common stud links of the model's chain, 6 by 3.6 diameters, at the drawn scale", () => {
    const diameter = (FACTS.chain.chainDiameterMm / 1000) * DRAWN_SCALES.chainLink;
    expect(VIEW.link.length / diameter).toBeCloseTo(6, 6);
    expect(VIEW.link.width / diameter).toBeCloseTo(3.6, 6);
  });

  test("the anchor keeps the Spek sheet's proportions: crown a third of the shank, fluke 0.56 of it", () => {
    expect(VIEW.anchor.crownLength / VIEW.anchor.shank).toBeCloseTo(480 / 1440, 6);
    expect(VIEW.anchor.fluke / VIEW.anchor.shank).toBeCloseTo(800 / 1440, 6);
    expect(VIEW.anchor.shank).toBeCloseTo(4 * DRAWN_SCALES.anchor, 6);
  });

  test("the reader's longest chain and the dragging chain both keep the anchor's crown inside the block", () => {
    for (const paidOut of [VIEW.paidOutRange[1], VIEW.dragPaidOut]) {
      const anchor = buildAnchorArt(VIEW, readChainAt(FACTS, paidOut, CHAIN_POINT_COUNT));
      const crownX = anchor.flukeTip[0] - VIEW.anchor.fluke;
      expect(crownX).toBeGreaterThan(BLOCK.x);
      expect(anchor.isDug).toBe(true);
    }
  });

  test("a hanging anchor has no fluke in the clay, so it catches nothing", () => {
    const anchor = buildAnchorArt(VIEW, readChainAt(FACTS, 45, CHAIN_POINT_COUNT));
    expect(anchor.isDug).toBe(false);
    expect(anchor.parts.every((part) => part.shapes.length === 0 || part.at[2] > 0)).toBe(true);
  });

  test("each stage shows its moment: anchor hanging clear, ploughing with the cable ahead, the cable parted aft", () => {
    const drop = buildStageFrame(FACTS, VIEW, "drop");
    expect(drop.reading.kind).toBe("hanging");
    expect(drop.cables.every((cable) => cable.phase.kind === "lying")).toBe(true);
    expect(drop.readout).toContain("nothing caught");
    const drag = buildStageFrame(FACTS, VIEW, "drag");
    expect(drag.anchor.isDug).toBe(true);
    expect(drag.readout).toMatch(/cable \d+ m ahead/);
    const cut = buildStageFrame(FACTS, VIEW, "cut");
    const parted = cut.cables.filter((cable) => cable.phase.kind === "parted");
    expect(parted).toHaveLength(1);
    const cableX = (parted[0]?.worldMetres ?? 0) - cut.moment.travelledMetres;
    expect(cableX).toBeLessThan(cut.anchor.hook[0] - VIEW.anchor.shank);
    expect(cut.readout).toContain("cable parted");
  });

  test("the seabed stages come in close enough that the anchor and the cut cable both stand inside the square", () => {
    const isInside = (stage: "drag" | "cut", point: [number, number, number]) => {
      const [left, top, size] = VIEW.frames[stage];
      const [screenX, screenY] = iso(point, VIEW.projection);
      return screenX > left && screenX < left + size && screenY > top && screenY < top + size;
    };
    const cut = buildStageFrame(FACTS, VIEW, "cut");
    const parted = cut.cables.find((cable) => cable.phase.kind === "parted");
    expect(parted).toBeDefined();
    const cableX = (parted?.worldMetres ?? 0) - cut.moment.travelledMetres;
    expect(VIEW.frames.cut[2]).toBeLessThanOrEqual(VIEW.frames.drop[2] / 2);
    expect(isInside("cut", cut.anchor.hook)).toBe(true);
    expect(isInside("cut", [cableX, VIEW.chainY, 0])).toBe(true);
    const drag = buildStageFrame(FACTS, VIEW, "drag");
    expect(isInside("drag", drag.anchor.hook)).toBe(true);
  });

  test("a hanging anchor turns on its swivel to face the viewer; a dragging one lies in line with the drag", () => {
    const readFlukeCentres = (paidOut: number) =>
      buildAnchorArt(VIEW, readChainAt(FACTS, paidOut, CHAIN_POINT_COUNT))
        .parts.filter((part) => part.name.startsWith("anchor.fluke#"))
        .map((part) => part.at);
    // Hanging, the two flukes sit side by side across the picture: their depth along the view is the same.
    const [farFluke, nearFluke] = readFlukeCentres(34);
    expect(farFluke && nearFluke && Math.abs(depthOf(farFluke, VIEW.projection) - depthOf(nearFluke, VIEW.projection))).toBeLessThan(0.5);
    // Dragging, they sit either side of the drag line, at the same distance along the track.
    const [farDragged, nearDragged] = readFlukeCentres(VIEW.dragPaidOut);
    expect(farDragged && nearDragged && Math.abs(farDragged[0] - nearDragged[0])).toBeLessThan(0.01);
  });
});
