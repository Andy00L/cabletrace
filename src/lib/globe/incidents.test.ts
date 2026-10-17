import { describe, expect, test } from "bun:test";
import { CABLE_CASES } from "@/data/cases";
import { parseConsoleState, toCutSlug } from "@/lib/console/console-state";
import { toGlobeIncidents } from "./incidents";

describe("toGlobeIncidents", () => {
  const incidents = toGlobeIncidents(CABLE_CASES);

  test("puts one marker per published case at its primary cut, newest first", () => {
    expect(incidents.map((incident) => incident.slug).sort()).toEqual(CABLE_CASES.map((cableCase) => cableCase.slug).sort());
    for (const incident of incidents) {
      const cableCase = CABLE_CASES.find((candidate) => candidate.slug === incident.slug);
      expect(incident.longitude).toBe(cableCase?.cuts[0].longitude ?? Number.NaN);
      expect(incident.latitude).toBe(cableCase?.cuts[0].latitude ?? Number.NaN);
      expect(incident.vesselName).toBe(cableCase?.vessel.name ?? "");
    }
    const times = incidents.map((incident) => incident.cutAtMs);
    expect(times).toEqual([...times].sort((first, second) => second - first));
  });

  test("links each case at the cut's minute with the cut's card open, as the console reads it", () => {
    for (const incident of incidents) {
      const cableCase = CABLE_CASES.find((candidate) => candidate.slug === incident.slug);
      if (!cableCase) throw new Error(`no case ${incident.slug}`);
      const url = new URL(incident.caseHref, "https://cabletrace.example");
      expect(url.pathname).toBe(`/cases/${cableCase.slug}`);
      const state = parseConsoleState(url.searchParams, {
        windowStartMs: Date.parse(cableCase.window.startUtc),
        windowEndMs: Date.parse(cableCase.window.endUtc),
        openingMs: Date.parse(cableCase.window.startUtc),
        cutSlugs: cableCase.cuts.map((cut) => toCutSlug(cut.label)),
        placementCount: cableCase.track.length,
        sourceIds: cableCase.sources.map((source) => source.id),
      });
      expect(state.layer).toEqual({ kind: "cut", cutIndex: 0 });
      expect(Math.floor(state.atMs / 60_000)).toBe(Math.floor(incident.cutAtMs / 60_000));
    }
  });
});
