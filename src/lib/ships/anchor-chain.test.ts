import { describe, expect, test } from "bun:test";
import { estimateCaseShipChain, readChainSpan, shapeCatenary } from "@/lib/ships/anchor-chain";

function measureLength(points: readonly { alongMetres: number; upMetres: number }[]): number {
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return previous ? total + Math.hypot(point.alongMetres - previous.alongMetres, point.upMetres - previous.upMetres) : total;
  }, 0);
}

describe("anchor chain", () => {
  test("Eagle S in 70 m of water: 330 m of chain, the anchor about 300 m behind the hawse", () => {
    const model = estimateCaseShipChain("tanker", 228.6);
    expect(model.chainPerAnchorMetres).toBe(330);
    const span = readChainSpan(model, -70);
    expect(span?.laybackMetres).toBeGreaterThan(250);
    expect(span?.laybackMetres).toBeLessThan(330);
  });

  test("the drawn chain runs from the anchor to the hawse and is as long as the chain paid out", () => {
    const model = estimateCaseShipChain("tanker", 228.6);
    const span = readChainSpan(model, -70);
    if (!span) throw new Error("no span at 70 m");
    const shape = shapeCatenary({ paidOutMetres: model.nominalPaidOutMetres, heightMetres: span.heightMetres, laybackMetres: span.laybackMetres, pointCount: 400 });
    if (!shape.ok) throw new Error(shape.reason);
    const first = shape.value.points[0];
    const last = shape.value.points.at(-1);
    expect(first).toEqual({ alongMetres: 0, upMetres: 0 });
    expect(last?.alongMetres).toBeCloseTo(span.laybackMetres, 0);
    expect(last?.upMetres).toBeCloseTo(span.heightMetres, 0);
    expect(measureLength(shape.value.points)).toBeCloseTo(model.nominalPaidOutMetres, -1);
    expect(shape.value.groundedMetres).toBeGreaterThan(0);
  });

  test("a chain shorter than the water is deep never reaches the seabed", () => {
    expect(shapeCatenary({ paidOutMetres: 50, heightMetres: 80, laybackMetres: 0, pointCount: 10 }).ok).toBe(false);
  });
});
