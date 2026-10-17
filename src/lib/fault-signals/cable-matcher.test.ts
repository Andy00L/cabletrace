import { describe, expect, test } from "bun:test";
import { distanceToCableMetres, matchSignalToCables, normaliseAssetName } from "./cable-matcher";
import type { FaultSignal, RegistryCable, SignalLocator } from "./fault-signal-types";

// A small registry: two power links across one border, a telecom cable beside them, a pipeline on the same line.
const REGISTRY: RegistryCable[] = [
  { id: 1, name: "Estlink 1", kind: "power", lines: [[[24.55, 59.44], [24.48, 60.07]]], countries: ["EE", "FI"] },
  { id: 2, name: "HVDC Estlink 2", kind: "power", lines: [[[26.95, 59.44], [25.53, 60.29]]], countries: ["EE", "FI"] },
  { id: 3, name: "Finland-Estonia 2 (EESF-2)", kind: "telecom", lines: [[[24.87, 59.55], [24.96, 60.15]]], countries: ["EE", "FI"] },
  { id: 4, name: "Balticconnector", kind: "pipeline", lines: [[[24.13, 59.40], [23.98, 60.01]]], countries: ["EE", "FI"] },
  { id: 5, name: "Baltika", kind: "telecom", lines: [[[28.07, 59.52], [26.47, 59.95]]], countries: ["RU"] },
];

function signalAt(locator: SignalLocator): FaultSignal {
  return {
    source: "nga-warning",
    externalId: "test",
    kind: "cable-repair",
    title: "test",
    faultNotBeforeMs: 0,
    faultNotAfterMs: 0,
    publishedAtMs: 0,
    endsAtMs: null,
    locator,
    cableShip: null,
    sourceUrl: "https://example.org",
    excerpt: "",
  };
}

describe("matchSignalToCables, geometry", () => {
  test("a trackline along a cable matches it and no cable 5 km or more away", () => {
    const matches = matchSignalToCables(signalAt({ kind: "geometry", geometry: { kind: "tracklines", lines: [[[24.551, 59.45], [24.482, 60.06]]] } }), REGISTRY);
    expect(matches.map((match) => [match.cableName, match.basis, match.opensDraft])).toEqual([["Estlink 1", "geometry", true]]);
    expect(matches[0]?.distanceMetres ?? -1).toBeLessThan(200);
  });

  test("a repair area around a cable matches it even with no vertex of the cable inside, and pipelines never match", () => {
    const ring: [number, number][] = [[24.0, 59.7], [24.3, 59.7], [24.3, 59.75], [24.0, 59.75]];
    expect(matchSignalToCables(signalAt({ kind: "geometry", geometry: { kind: "area", ring } }), REGISTRY)).toEqual([]);
    const aroundEstlink: [number, number][] = [[24.4, 59.7], [24.6, 59.7], [24.6, 59.75], [24.4, 59.75]];
    expect(matchSignalToCables(signalAt({ kind: "geometry", geometry: { kind: "area", ring: aroundEstlink } }), REGISTRY).map((match) => match.distanceMetres)).toEqual([0]);
  });

  test("a single position 3 km off a cable matches; 7 km off does not", () => {
    // 0.054 degrees of longitude at 59.75 N is about 3.0 km.
    expect(matchSignalToCables(signalAt({ kind: "geometry", geometry: { kind: "points", points: [[24.567, 59.75]] } }), REGISTRY).map((match) => match.cableName)).toEqual(["Estlink 1"]);
    expect(matchSignalToCables(signalAt({ kind: "geometry", geometry: { kind: "points", points: [[24.64, 59.75]] } }), REGISTRY)).toEqual([]);
  });

  test("distanceToCableMetres gives the gap in metres, or null beyond the limit", () => {
    const cable = REGISTRY[0]?.lines ?? [];
    const distance = distanceToCableMetres({ kind: "points", points: [[24.567, 59.75]] }, cable, 5000);
    expect(distance ?? 0).toBeGreaterThan(2500);
    expect(distance ?? 0).toBeLessThan(3500);
    expect(distanceToCableMetres({ kind: "points", points: [[30, 59.75]] }, cable, 5000)).toBeNull();
  });
});

describe("matchSignalToCables, names, borders and countries", () => {
  test("a link's name matches the registry name and not its sibling", () => {
    expect(normaliseAssetName("HVDC Estlink 2")).toBe("estlink2");
    expect(normaliseAssetName("EstLink 2 (Anttila - Puessi)")).toBe("estlink2");
    const matches = matchSignalToCables(signalAt({ kind: "asset", assetNames: ["EstLink 2"], countries: ["FI", "EE"] }), REGISTRY);
    expect(matches.map((match) => [match.cableName, match.basis])).toEqual([["HVDC Estlink 2", "asset-name"]]);
  });

  test("a withheld asset falls back to every power link across the border; a named asset not in the registry matches nothing", () => {
    const withheld = matchSignalToCables(signalAt({ kind: "asset", assetNames: [], countries: ["FI", "EE"] }), REGISTRY);
    expect(withheld.map((match) => [match.cableName, match.basis, match.opensDraft])).toEqual([
      ["Estlink 1", "border", true],
      ["HVDC Estlink 2", "border", true],
    ]);
    expect(matchSignalToCables(signalAt({ kind: "asset", assetNames: ["Fenno-Skan 2"], countries: ["FI", "SE"] }), REGISTRY)).toEqual([]);
  });

  test("a country matches its telecom cables and opens no draft by itself", () => {
    const matches = matchSignalToCables(signalAt({ kind: "country", country: "RU" }), REGISTRY);
    expect(matches.map((match) => [match.cableName, match.basis, match.opensDraft])).toEqual([["Baltika", "country", false]]);
  });
});
