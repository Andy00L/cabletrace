import { describe, expect, test } from "bun:test";
import { parseFaultCaseInputs, parseMatchInputs } from "./fault-inputs";

// The shapes public.fault_match_inputs() and public.fault_case_inputs() return
// (supabase/migrations/20261019300000_fault_signals.sql).

describe("parseMatchInputs", () => {
  test("reads cables with and without their routes", () => {
    const withRoutes = parseMatchInputs({
      cables: [{ id: 13, name: "HVDC Estlink 2", kind: "power", countries: ["EE", "FI"], route: { type: "MultiLineString", coordinates: [[[25.5, 60.3], [26.9, 59.4]]] } }],
    });
    expect(withRoutes).toEqual({ ok: true, value: [{ id: 13, name: "HVDC Estlink 2", kind: "power", countries: ["EE", "FI"], lines: [[[25.5, 60.3], [26.9, 59.4]]] }] });
    const withoutRoutes = parseMatchInputs({ cables: [{ id: 1, name: "Baltika", kind: "telecom", countries: ["RU"] }] });
    expect(withoutRoutes.ok && withoutRoutes.value[0]?.lines).toEqual([]);
  });

  test("a malformed cable fails the payload", () => {
    expect(parseMatchInputs({ cables: [{ id: 1, name: "X", kind: "canal", countries: [] }] }).ok).toBe(false);
    expect(parseMatchInputs({ cables: [{ id: 1, name: "X", kind: "power", countries: [], route: { type: "LineString", coordinates: [[1, "a"]] } }] }).ok).toBe(false);
    expect(parseMatchInputs({}).ok).toBe(false);
  });
});

describe("parseFaultCaseInputs", () => {
  const payload = {
    positions: [
      [1, 1735107960, 26.1, 59.93, null, null, null, null],
      [1, 1735108020, 26.11, 59.93, 7.5, 260, 262, 0],
    ],
    vessels: [
      { mmsi: 1, name: "SLOW ONE", shipType: 80, draughtMetres: 9 },
      { mmsi: 2, name: "FAST ONE", shipType: 70, draughtMetres: null },
    ],
    cables: [{ name: "HVDC Estlink 2", kind: "power", route: { type: "MultiLineString", coordinates: [[[25.5, 60.3], [26.9, 59.4]]] } }],
    passersBy: [[2, 1735108000, 42, 12.5]],
  };

  test("reads the judged tracks, the one cable, the passers-by and the names", () => {
    const parsed = parseFaultCaseInputs(payload);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value.candidates.map((candidate) => [candidate.mmsi, candidate.track.length])).toEqual([[1, 2]]);
    expect(parsed.value.cable.map((part) => part.name)).toEqual(["HVDC Estlink 2"]);
    expect(parsed.value.passers).toEqual([{ mmsi: 2, atMs: 1735108000000, distanceMetres: 42, speedKnots: 12.5 }]);
    expect(parsed.value.names.get(2)).toBe("FAST ONE");
  });

  test("a malformed passer-by fails the payload", () => {
    expect(parseFaultCaseInputs({ ...payload, passersBy: [[2, 1735108000, "near", 12.5]] }).ok).toBe(false);
    expect(parseFaultCaseInputs({ ...payload, passersBy: undefined }).ok).toBe(false);
  });
});
