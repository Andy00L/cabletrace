import { describe, expect, test } from "bun:test";
import { ASSUMED_LENGTH_METRES, buildVesselProfile, isInDragWindow, readVesselAnchor } from "@/lib/console/vessel-profile";
import { SHIP_KINDS } from "@/lib/ships/ship-specs";

// Yi Peng 3 at 02:00 UTC on 18 November 2024: a 224 m bulk carrier inside its drag window, in 47 m of water.
const DRAG_WINDOW = { startMs: Date.parse("2024-11-17T07:45:00Z"), endMs: Date.parse("2024-11-18T08:24:00Z") };
const AT_CUT_MS = Date.parse("2024-11-18T02:00:00Z");
const BOX = { widthPx: 312, heightPx: 118 };

function readNumbers(pathData: string): number[] {
  return [...pathData.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

describe("readVesselAnchor", () => {
  test("Yi Peng 3 at the C-Lion1 cut: 316 m of 84 mm chain, all of one anchor, the anchor about 300 m behind the hawse", () => {
    const anchor = readVesselAnchor({ kind: "bulk-carrier", lengthMetres: 224, isAnchorDown: true, depthMetres: 47 });
    expect(anchor.reading.state).toBe("dragging");
    expect(Math.round(anchor.chain.nominalPaidOutMetres)).toBe(316);
    expect(anchor.chain.chainDiameterMm).toBe(84);
    expect(anchor.chain.anchorMassKg).toBe(8700);
    const layback = anchor.reading.state === "dragging" ? anchor.reading.laybackMetres : 0;
    expect(layback).toBeGreaterThan(280);
    expect(layback).toBeLessThan(316);
  });

  test("the anchor is down only inside the drag window", () => {
    expect(isInDragWindow(DRAG_WINDOW, AT_CUT_MS)).toBe(true);
    expect(isInDragWindow(DRAG_WINDOW, DRAG_WINDOW.endMs + 60_000)).toBe(false);
    expect(isInDragWindow(null, AT_CUT_MS)).toBe(false);
  });

  test("an anchor that is not down is stowed", () => {
    const anchor = readVesselAnchor({ kind: "bulk-carrier", lengthMetres: 224, isAnchorDown: false, depthMetres: 47 });
    expect(anchor.reading).toEqual({ state: "stowed" });
    expect(readVesselAnchor({ kind: "tanker", lengthMetres: 228.6, isAnchorDown: false, depthMetres: 70 }).reading).toEqual({ state: "stowed" });
  });

  test("inside the drag window without a known depth, or deeper than the chain, the anchor is let go", () => {
    expect(readVesselAnchor({ kind: "bulk-carrier", lengthMetres: 224, isAnchorDown: true, depthMetres: null }).reading).toEqual({ state: "let-go", reason: "depth-unknown" });
    expect(readVesselAnchor({ kind: "bulk-carrier", lengthMetres: 224, isAnchorDown: true, depthMetres: 900 }).reading).toEqual({ state: "let-go", reason: "deeper-than-chain" });
  });

  test("a ship with no reported length is drawn at the anchor model's assumed ship and says so", () => {
    const anchor = readVesselAnchor({ kind: "general-cargo", lengthMetres: null, isAnchorDown: true, depthMetres: 40 });
    expect(anchor.isLengthAssumed).toBe(true);
    expect(anchor.drawnLengthMetres).toBe(ASSUMED_LENGTH_METRES);
    expect(anchor.chain.assumptions[0]).toContain("Length unknown");
  });
});

describe("buildVesselProfile", () => {
  const anchor = readVesselAnchor({ kind: "bulk-carrier", lengthMetres: 224, isAnchorDown: true, depthMetres: 47 });
  const profile = buildVesselProfile({ kind: "bulk-carrier", anchor, ...BOX });

  test("one scale for length and depth: the hull spans 224 m and the water 47 m in the same px per metre", () => {
    expect(profile.bowX - profile.sternX).toBeCloseTo(224 * profile.pxPerMetre, 3);
    expect((profile.seabedY ?? 0) - profile.surfaceY).toBeCloseTo(47 * profile.pxPerMetre, 3);
  });

  test("the chain runs from the anchor on the seabed to the hawse, its drawn length the chain paid out", () => {
    const layback = anchor.reading.state === "dragging" ? anchor.reading.laybackMetres : 0;
    expect(profile.anchorPoint.y).toBe(profile.seabedY ?? Number.NaN);
    expect(profile.hawse.x - profile.anchorPoint.x).toBeCloseTo(layback * profile.pxPerMetre, 3);
    const numbers = readNumbers(profile.chain?.d ?? "");
    expect(numbers.slice(-2)[0]).toBeCloseTo(profile.hawse.x, 0);
    expect(numbers.slice(-2)[1]).toBeCloseTo(profile.hawse.y, 0);
    expect((profile.chain?.lengthPx ?? 0) / profile.pxPerMetre).toBeGreaterThan(0.97 * anchor.chain.nominalPaidOutMetres);
    expect((profile.chain?.lengthPx ?? 0) / profile.pxPerMetre).toBeLessThan(1.03 * anchor.chain.nominalPaidOutMetres);
  });

  test("the anchor lies beyond the stern when the layback is longer than the ship, as on board 23", () => {
    expect(profile.anchorPoint.x).toBeLessThan(profile.sternX);
  });

  test("a 224 m bulk carrier shows seven hatch covers", () => {
    expect(profile.shapes.filter((shape) => shape.role === "cargo")).toHaveLength(7);
  });

  test("stowed: no chain, no seabed, the anchor in the hawse", () => {
    const stowed = buildVesselProfile({ kind: "bulk-carrier", anchor: readVesselAnchor({ kind: "bulk-carrier", lengthMetres: 224, isAnchorDown: false, depthMetres: 47 }), ...BOX });
    expect(stowed.chain).toBeNull();
    expect(stowed.seabedY).toBeNull();
    expect(stowed.anchorPoint).toEqual(stowed.hawse);
    expect(stowed.heightPx).toBeLessThan(BOX.heightPx);
  });

  test("every ship type, stowed and dragging, stays inside its box", () => {
    for (const kind of SHIP_KINDS) {
      for (const atMs of [AT_CUT_MS, DRAG_WINDOW.endMs + 60_000]) {
        const kindAnchor = readVesselAnchor({ kind, lengthMetres: kind === "fishing" || kind === "tug" ? 40 : 180, isAnchorDown: isInDragWindow(DRAG_WINDOW, atMs), depthMetres: 60 });
        const drawn = buildVesselProfile({ kind, anchor: kindAnchor, ...BOX });
        const numbers = [...drawn.shapes, ...drawn.lines].flatMap((shape) => readNumbers(shape.d));
        const xs = numbers.filter((_value, index) => index % 2 === 0);
        const ys = numbers.filter((_value, index) => index % 2 === 1);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(BOX.widthPx);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...ys)).toBeLessThanOrEqual(BOX.heightPx);
        expect(Number.isFinite(drawn.pxPerMetre)).toBe(true);
      }
    }
  });
});
