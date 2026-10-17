import { describe, expect, test } from "bun:test";
import { parseDetectionSummary, parseShipDetails } from "./live-api";

describe("parseShipDetails", () => {
  test("reads a live_ship_details row and keeps unsent fields as null", () => {
    const details = parseShipDetails({ mmsi: 636023257, name: " SEA FIGHTER ", call_sign: "", imo: 9799783, ship_type: 70, length_metres: null, beam_metres: null, draught_metres: 7.4, destination: "FOR ORDERS", source: "digitraffic", updated_at: "2026-10-17T09:12:00+00:00" });
    expect(details).toEqual({ mmsi: 636023257, name: "SEA FIGHTER", callSign: null, imo: 9799783, shipType: 70, lengthMetres: null, beamMetres: null, draughtMetres: 7.4, destination: "FOR ORDERS", source: "digitraffic", staticUpdatedMs: Date.parse("2026-10-17T09:12:00Z") });
  });

  test("rejects a row without an MMSI or a source", () => {
    expect(parseShipDetails({ name: "NO MMSI", source: "aisstream" })).toBeNull();
    expect(parseShipDetails({ mmsi: 1 })).toBeNull();
    expect(parseShipDetails({ mmsi: 1, source: "aisstream", updated_at: "soon" })?.staticUpdatedMs).toBeNull();
  });
});

describe("parseDetectionSummary", () => {
  const row = {
    id: 7,
    mmsi: 636023257,
    name: "SEA FIGHTER",
    level: "watch",
    score: 0.95,
    startAt: "2026-10-17T03:39:59+00:00",
    endAt: "2026-10-17T04:29:49+00:00",
    evidence: [{ rule: "low-speed-under-way", sentence: "Held 5.4 knots for 22 minutes." }, { rule: "straight-run" }],
    cableCrossings: [{ cableName: "Estlink 2" }, { cableName: "Estlink 2" }],
  };

  test("keeps the sentences and the crossed cables once each", () => {
    const summary = parseDetectionSummary(row);
    expect(summary?.sentences).toEqual(["Held 5.4 knots for 22 minutes."]);
    expect(summary?.cableNames).toEqual(["Estlink 2"]);
    expect(summary?.startMs).toBe(Date.parse("2026-10-17T03:39:59Z"));
  });

  test("rejects an unknown level or an unreadable time", () => {
    expect(parseDetectionSummary({ ...row, level: "verdict" })).toBeNull();
    expect(parseDetectionSummary({ ...row, endAt: "later" })).toBeNull();
  });
});
