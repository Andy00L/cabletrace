import { describe, expect, test } from "bun:test";
import { parseCrossingRows, pickTickerCrossings, type CloseCrossing } from "@/lib/landing/live-watch";

function makeRow(mmsi: number, cableName: string, observedAt: string) {
  return { mmsi, observed_at: observedAt, speed_knots: 6.2, cable_distance_metres: 16.1, cables: { name: cableName, region_id: "english-channel" } };
}

function makeCrossing(mmsi: number, cableName: string, minute: number): CloseCrossing {
  return { mmsi, cableName, regionId: "gulf-of-finland", speedKnots: 10, distanceMetres: 40, observedAt: new Date(Date.UTC(2026, 9, 20, 15, minute)) };
}

describe("parseCrossingRows", () => {
  test("reads the embedded cable and the timestamp", () => {
    const parsed = parseCrossingRows([makeRow(235107219, "IFA2", "2026-10-20T15:50:39.841+00:00")]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value[0]).toEqual({
      mmsi: 235107219,
      cableName: "IFA2",
      regionId: "english-channel",
      speedKnots: 6.2,
      distanceMetres: 16.1,
      observedAt: new Date("2026-10-20T15:50:39.841Z"),
    });
  });

  test("keeps a missing speed as null", () => {
    const parsed = parseCrossingRows([{ ...makeRow(1, "IFA2", "2026-10-20T15:50:00Z"), speed_knots: null }]);
    expect(parsed.ok && parsed.value[0]?.speedKnots).toBeNull();
  });

  test("fails the whole read on a row without its cable", () => {
    const parsed = parseCrossingRows([makeRow(1, "IFA2", "2026-10-20T15:50:00Z"), { mmsi: 2, observed_at: "2026-10-20T15:50:00Z", speed_knots: 1, cable_distance_metres: 5, cables: null }]);
    expect(parsed).toEqual({ ok: false, reason: "a close pass row is malformed" });
  });

  test("fails on a payload that is not a list", () => {
    expect(parseCrossingRows({ message: "permission denied" }).ok).toBe(false);
  });
});

describe("pickTickerCrossings", () => {
  test("keeps the newest pass per ship and cable, newest first", () => {
    const picked = pickTickerCrossings([makeCrossing(1, "Estlink 2", 10), makeCrossing(1, "Estlink 2", 40), makeCrossing(2, "C-Lion 1", 30), makeCrossing(1, "Balticconnector", 20)]);
    expect(picked.map((crossing) => `${crossing.mmsi} ${crossing.cableName} ${crossing.observedAt.getUTCMinutes()}`)).toEqual(["1 Estlink 2 40", "2 C-Lion 1 30", "1 Balticconnector 20"]);
  });

  test("cuts to the requested length and handles an empty hour", () => {
    expect(pickTickerCrossings([makeCrossing(1, "A", 1), makeCrossing(2, "B", 2)], 1)).toHaveLength(1);
    expect(pickTickerCrossings([])).toEqual([]);
  });
});
