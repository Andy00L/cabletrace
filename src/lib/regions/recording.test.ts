import { describe, expect, test } from "bun:test";
import { REGIONS } from "@/data/regions";
import { boxesForSource, selectRecordableReports, type RecorderReport } from "@/lib/regions/recording";
import { createNearLineIndex } from "@/lib/regions/near-line-index";
import { dayArchivePath, detectionArchivePath } from "@/lib/regions/archive-layout";

function report(fields: Partial<RecorderReport> & Pick<RecorderReport, "mmsi" | "longitude" | "latitude" | "source">): RecorderReport {
  return { reportedAtMs: 1_000, speedKnots: 5, courseDegrees: 90, headingDegrees: 90, navigationStatus: 0, turnRate: null, ...fields };
}

describe("selectRecordableReports", () => {
  test("keeps each report only where its own feed records, newest per ship and feed", () => {
    const selected = selectRecordableReports(REGIONS, [
      report({ mmsi: 1, longitude: 25, latitude: 60, source: "digitraffic" }),
      report({ mmsi: 2, longitude: 25, latitude: 60, source: "aisstream" }),
      report({ mmsi: 3, longitude: 11, latitude: 56, source: "aisstream", reportedAtMs: 1_000 }),
      report({ mmsi: 3, longitude: 11.01, latitude: 56, source: "aisstream", reportedAtMs: 9_000 }),
      report({ mmsi: 4, longitude: 11, latitude: 56, source: "digitraffic" }),
      report({ mmsi: 5, longitude: -40, latitude: 40, source: "aisstream" }),
    ]);
    expect(selected.map((kept) => [kept.mmsi, kept.source, kept.reportedAtMs])).toEqual([
      [1, "digitraffic", 1_000],
      [3, "aisstream", 9_000],
    ]);
  });

  test("subscribes aisstream to the seven boxes recorded from it", () => {
    expect(boxesForSource(REGIONS, "aisstream").length).toBe(7);
    expect(boxesForSource(REGIONS, "digitraffic")).toEqual([{ west: 22.0, east: 30.5, south: 59.0, north: 60.8 }]);
  });
});

describe("createNearLineIndex", () => {
  test("finds the nearest line within reach and nothing beyond it", () => {
    const index = createNearLineIndex(
      [
        { name: "A", kind: "telecom", sourceId: "openstreetmap", sourceRef: "way/1", parts: [[[10, 55], [10.2, 55]]], ends: [] },
        { name: "B", kind: "power", sourceId: "openstreetmap", sourceRef: "way/2", parts: [[[10, 55.02], [10.2, 55.02]]], ends: [] },
      ],
      3000,
    );
    // 0.005 degrees north of A is 556 m; B is 1.67 km away.
    expect(index.findNearest([10.1, 55.005])).toEqual({ lineIndex: 0, distanceMetres: expect.closeTo(556, 0) });
    expect(index.findNearest([10.1, 55.015])?.lineIndex).toBe(1);
    expect(index.findNearest([10.1, 55.06])).toBeNull();
  });
});

describe("archive layout", () => {
  test("names day files only for real calendar days", () => {
    expect(dayArchivePath("gulf-of-finland", "2026-10-17")).toBe("days/gulf-of-finland/2026-10-17.json.gz");
    expect(dayArchivePath("gulf-of-finland", "2026-02-30")).toBeNull();
    expect(dayArchivePath("gulf-of-finland", "../../etc")).toBeNull();
    expect(detectionArchivePath(42)).toBe("detections/42.json.gz");
  });
});
