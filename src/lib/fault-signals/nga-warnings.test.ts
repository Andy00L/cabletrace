import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/nga-active-warnings-2026-10-17.json";
import { classifyWarning, parseCableShip, parseDateTimeGroup, parseNgaWarnings, parsePositions, parseWarning, parseWarningGeometry } from "./nga-warnings";

// Real warning texts from the NGA feed of 17 Oct 2026 (fixtures/nga-active-warnings-2026-10-17.json).
function warningText(externalNumber: number): string {
  const warning = fixture["broadcast-warn"].find((candidate) => candidate.msgNumber === externalNumber);
  if (!warning) throw new Error(`[warningText] no warning ${externalNumber} in the fixture`);
  return warning.text;
}

describe("parsePositions", () => {
  test("reads degrees and decimal minutes with the hemisphere, south and west negative", () => {
    expect(parsePositions("03-00.70N 006-57.40E, 37-26.90S 053-53.00W")).toEqual([
      [6.956667, 3.011667],
      [-53.883333, -37.448333],
    ]);
  });

  test("accepts the full stop HYDROPAC 1519/24 types between degrees and minutes, and two-digit longitudes", () => {
    expect(parsePositions("13-47.5N 143.46.0E")).toEqual([[143.766667, 13.791667]]);
    expect(parsePositions("22-06.90N 91-23.90W")).toEqual([[-91.398333, 22.115]]);
  });

  test("skips minutes of 60 or more", () => {
    expect(parsePositions("10-61.00N 020-00.00E")).toEqual([]);
  });
});

describe("classifyWarning", () => {
  test("keeps cable work by a cable ship", () => {
    expect(classifyWarning(warningText(950))).toEqual({ isKept: true, kind: "cable-operations" });
  });

  test("drops survey ships towing streamers, a man overboard from a cable ship, and a standing cable area", () => {
    expect(classifyWarning(warningText(827))).toEqual({ isKept: false, reason: "a survey ship towing seismic streamers" });
    expect(classifyWarning(warningText(1565))).toEqual({ isKept: false, reason: "a search and rescue message" });
    expect(classifyWarning(warningText(864))).toEqual({ isKept: false, reason: "a standing cable protection area, no work or damage" });
  });

  test("tells damage and repair from ordinary cable work", () => {
    expect(classifyWarning("BALTIC SEA.\nDAMAGED SUBMARINE CABLE IN 59-55.00N 026-12.00E.")).toEqual({ isKept: true, kind: "cable-damage" });
    expect(classifyWarning("CABLE REPAIR OPERATIONS BY CABLESHIP X IN 59-55.00N 026-12.00E.")).toEqual({ isKept: true, kind: "cable-repair" });
  });
});

describe("parseWarningGeometry", () => {
  test("splits lettered tracklines into separate lines", () => {
    const geometry = parseWarningGeometry(warningText(127));
    expect(geometry?.kind).toBe("tracklines");
    expect(geometry?.kind === "tracklines" ? geometry.lines.map((line) => line.length) : []).toEqual([4, 3]);
  });

  test("reads an area bound by positions as a ring, and a vicinity as points", () => {
    const area = parseWarningGeometry(warningText(1561));
    expect(area?.kind === "area" ? area.ring.length : 0).toBe(5);
    const vicinity = parseWarningGeometry(warningText(2918));
    expect(vicinity).toEqual({ kind: "points", points: [[48.103, 29.328]] });
  });

  test("a trackline in the vicinity of which the work goes on stays a trackline", () => {
    const geometry = parseWarningGeometry(warningText(3390));
    expect(geometry?.kind === "tracklines" ? geometry.lines.map((line) => line.length) : []).toEqual([8]);
  });
});

describe("parseCableShip", () => {
  test("names the cable ship or vessel doing the work", () => {
    expect(parseCableShip(warningText(950))).toBe("ILE DE SEIN");
    expect(parseCableShip(warningText(1558))).toBe("CASTORONE");
    expect(parseCableShip(warningText(2939))).toBe("HALL-1");
    expect(parseCableShip(warningText(2918))).toBeNull();
  });
});

describe("parseDateTimeGroup", () => {
  test("reads four- and two-digit years in UTC", () => {
    expect(parseDateTimeGroup("100559Z MAY 2024")).toBe(Date.parse("2024-05-10T05:59:00Z"));
    expect(parseDateTimeGroup("210001Z AUG 23")).toBe(Date.parse("2023-08-21T00:01:00Z"));
    expect(parseDateTimeGroup("tomorrow")).toBeNull();
  });
});

describe("parseNgaWarnings", () => {
  test("keeps the 14 cable-work warnings of the 17 Oct 2026 feed with their dates and links", () => {
    const parsed = parseNgaWarnings(fixture);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value.signals).toHaveLength(14);
    expect(parsed.value.dropped).toHaveLength(12);
    const nigeria = parsed.value.signals.find((signal) => signal.externalId === "HYDROLANT 950/24");
    expect(nigeria?.title).toBe("Cable work by ILE DE SEIN, Gulf of Guinea, Nigeria (HYDROLANT 950/24)");
    expect(nigeria?.publishedAtMs).toBe(Date.parse("2024-05-04T12:29:00Z"));
    expect(nigeria?.faultNotAfterMs).toBe(nigeria?.publishedAtMs);
    expect(nigeria?.faultNotBeforeMs).toBe((nigeria?.publishedAtMs ?? 0) - 72 * 3_600_000);
    expect(nigeria?.sourceUrl).toBe("https://msi.nga.mil/api/publications/broadcast-warn?output=json&navArea=A&msgYear=2024&msgNumber=950");
  });

  test("a warning that cancels itself carries the cancel time as its end", () => {
    const parsed = parseWarning({ ...fixture["broadcast-warn"][0], text: "CABLE OPERATIONS BY CABLESHIP X ALONG TRACKLINE JOINING 01-00.00N 001-00.00E, 01-10.00N 001-00.00E.\n2. CANCEL THIS MSG 210001Z AUG 24." });
    expect(parsed !== null && "signal" in parsed ? parsed.signal.endsAtMs : null).toBe(Date.parse("2024-08-21T00:01:00Z"));
  });

  test("one malformed warning fails the whole answer", () => {
    expect(parseNgaWarnings({ "broadcast-warn": [{ text: "CABLE OPERATIONS" }] }).ok).toBe(false);
    expect(parseNgaWarnings({ warnings: [] }).ok).toBe(false);
  });
});
