import { describe, expect, test } from "bun:test";
import type { CrossSourceSample } from "@/lib/live/cross-source";
import { judgeByRegion } from "./cross-source-health";

function sample(regionId: string, sharedShips: number): CrossSourceSample {
  return {
    regionId,
    sampledAtMs: 0,
    windowSeconds: 110,
    aisstreamShips: 40,
    digitrafficShips: 300,
    sharedShips,
    aisstreamOnlyShips: 40 - sharedShips,
    matchedPairs: 30,
    medianOffsetMetres: 12,
    p95OffsetMetres: 90,
    withinToleranceShare: 1,
  };
}

describe("judgeByRegion", () => {
  test("judges each region on its own samples, in first-seen order", () => {
    const verdicts = judgeByRegion([sample("gulf-of-finland", 39), sample("central-baltic", 20), sample("gulf-of-finland", 38)]);
    expect(verdicts.map(({ regionId, verdict }) => [regionId, verdict.verdict, verdict.sampleCount])).toEqual([
      ["gulf-of-finland", "agree", 2],
      ["central-baltic", "disagree", 1],
    ]);
  });
});
