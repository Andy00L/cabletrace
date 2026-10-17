import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findCaseProblems } from "@/lib/cases/case-file";
import { parseSeabedFeatures } from "@/lib/seabed/seabed-data";
import { CABLE_CASES } from "./index";

// Every published case must pass its own consistency check and match the seabed file its replay loads.
function readSeabedFeatures(area: string) {
  const payload: unknown = JSON.parse(readFileSync(path.join(process.cwd(), "public", "seabed", `${area}-seabed.json`), "utf8"));
  return parseSeabedFeatures(payload);
}

describe.each(CABLE_CASES.map((cableCase) => [cableCase.slug, cableCase] as const))("case %s", (_slug, cableCase) => {
  test("has no consistency problems", () => {
    expect(findCaseProblems(cableCase)).toEqual([]);
  });

  test("names only cables drawn in its seabed file and stays inside the block", () => {
    const features = readSeabedFeatures(cableCase.seabedArea);
    expect(features.ok).toBe(true);
    if (!features.ok) return;
    const lineNames = new Set(features.value.lines.map((line) => line.name));
    cableCase.cuts.forEach((cut) => expect(lineNames.has(cut.cableName)).toBe(true));
    const { west, east, south, north } = features.value.region;
    [...cableCase.track, ...cableCase.cuts].forEach((point) => {
      expect(point.longitude).toBeGreaterThan(west);
      expect(point.longitude).toBeLessThan(east);
      expect(point.latitude).toBeGreaterThan(south);
      expect(point.latitude).toBeLessThan(north);
    });
  });
});

test("case slugs are unique", () => {
  expect(new Set(CABLE_CASES.map((cableCase) => cableCase.slug)).size).toBe(CABLE_CASES.length);
});
