import { describe, expect, test } from "bun:test";
import { REGIONS } from "@/data/regions";
import { LIVE_SOURCES } from "@/data/regions/sources";
import { effectiveRetentionHours, findRegion, findRegionAt, findRegistryProblems, selectRegionsBySource, toAisstreamBoundingBoxes, type Region } from "@/lib/regions/region";

const GULF = REGIONS.find((region) => region.id === "gulf-of-finland");

describe("the registry", () => {
  test("holds eight sound regions whose boxes do not overlap", () => {
    expect(REGIONS.length).toBe(8);
    expect(findRegistryProblems(REGIONS)).toEqual([]);
  });

  test("records the Gulf of Finland from Digitraffic and every other region from aisstream, capped at 47 hours", () => {
    expect(selectRegionsBySource(REGIONS, "digitraffic").map((region) => region.id)).toEqual(["gulf-of-finland"]);
    expect(selectRegionsBySource(REGIONS, "aisstream").length).toBe(7);
    expect(REGIONS.map((region) => effectiveRetentionHours(region, LIVE_SOURCES))).toEqual([72, 47, 47, 47, 47, 47, 47, 47]);
  });

  test("every region gives a measured reason", () => {
    expect(REGIONS.filter((region) => !/\d/u.test(region.reason)).map((region) => region.id)).toEqual([]);
  });
});

describe("findRegistryProblems", () => {
  test("reports overlapping boxes, repeated ids, bad time zones and a candidate distance wider than the stored one", () => {
    expect(GULF).toBeDefined();
    if (!GULF) return;
    const overlapping: Region = { ...GULF, id: "gulf-copy", box: { ...GULF.box, west: 29 } };
    const repeated: Region = { ...GULF, box: { west: 0, east: 1, south: 0, north: 1 } };
    const badZone: Region = { ...GULF, id: "bad-zone", box: { west: 2, east: 3, south: 0, north: 1 }, timeZone: "Mars/Olympus" };
    const wideCandidate: Region = { ...GULF, id: "wide-candidate", box: { west: 4, east: 5, south: 0, north: 1 }, recording: { ...GULF.recording, candidateCableMetres: 9000 } };
    expect(findRegistryProblems([GULF, overlapping, repeated, badZone, wideCandidate])).toEqual([
      "bad-zone: Mars/Olympus is not an IANA time zone",
      "wide-candidate: candidateCableMetres is wider than nearCableMetres",
      "gulf-of-finland and gulf-copy: boxes overlap",
      "gulf-of-finland: id used twice",
    ]);
  });
});

describe("lookups", () => {
  test("finds the region of a point, and none at sea between regions", () => {
    expect(findRegionAt(REGIONS, 25.0, 60.0)?.id).toBe("gulf-of-finland");
    expect(findRegionAt(REGIONS, 1.4, 51.0)?.id).toBe("english-channel");
    expect(findRegionAt(REGIONS, -30.0, 40.0)).toBeNull();
    expect(findRegion(REGIONS, "perth").ok).toBe(true);
    expect(findRegion(REGIONS, "atlantis")).toEqual({ ok: false, reason: expect.stringContaining('unknown region "atlantis"') });
  });

  test("writes boxes as aisstream's [[south, west], [north, east]] pairs", () => {
    expect(toAisstreamBoundingBoxes([{ west: 9.5, east: 13, south: 54.3, north: 58 }])).toEqual([
      [
        [54.3, 9.5],
        [58, 13],
      ],
    ]);
  });
});
