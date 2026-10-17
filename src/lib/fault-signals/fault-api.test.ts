import { describe, expect, test } from "bun:test";
import type { RankedShip } from "./draft-case";
import { parseDraftCaseDetail, parseDraftCaseSummary, parseFaultSignalSummary } from "./fault-api";

// Rows as public.recent_draft_cases, public.draft_case_detail and public.recent_fault_signals build them
// (supabase/migrations/20261019300000_fault_signals.sql); Postgres writes timestamptz values in jsonb as ISO strings.
const SIGNAL = {
  id: 3,
  source: "nordpool-umm",
  kind: "power-link-failure",
  title: "Unplanned outage of Estlink 2 between FI and EE, reported by Fingrid Oyj (Nord Pool UMM)",
  faultNotBefore: "2024-12-25T10:26:00+00:00",
  faultNotAfter: "2024-12-25T10:26:00+00:00",
  publishedAt: "2024-12-25T11:01:34+00:00",
  sourceUrl: "https://umm.nordpoolgroup.com/#/messages/79210ee1-3395-4f75-a972-7b03888b107a/2",
  cableShip: null,
};
const SHIP = {
  rank: 1,
  mmsi: 518998865,
  name: "Eagle S",
  basis: "unjudged-at-fault",
  level: null,
  score: null,
  crossingAtMs: null,
  closestApproachMetres: 1,
  closestApproachAtMs: 1735122360000,
  reportCount: 1,
  sentences: ["Recorded 1 m from this cable at 10:26 UTC on 2024-12-25, inside the time the signal gives for the fault."],
} satisfies RankedShip;
const DRAFT_FIELDS = {
  id: 7,
  status: "draft",
  cableName: "HVDC Estlink 2",
  cableKind: "power",
  faultNotBefore: "2024-12-25T10:26:00+00:00",
  faultNotAfter: "2024-12-25T10:26:00+00:00",
  windowStart: "2024-12-25T04:26:00+00:00",
  windowEnd: "2024-12-25T10:41:00+00:00",
  nearMetres: 3000,
  shipCount: 6,
  openedAt: "2024-12-25T11:05:00+00:00",
  updatedAt: "2024-12-26T10:52:00+00:00",
};

describe("parseDraftCaseSummary", () => {
  test("reads a draft with its top ships and signals", () => {
    const summary = parseDraftCaseSummary({ ...DRAFT_FIELDS, topShips: [{ rank: 1, mmsi: 518998865, name: "Eagle S", basis: "unjudged-at-fault", level: null, score: null, closestApproachMetres: 1 }], signals: [SIGNAL] });
    expect(summary?.status).toBe("draft");
    expect(summary?.windowStartMs).toBe(Date.parse("2024-12-25T04:26:00Z"));
    expect(summary?.topShips[0]?.basis).toBe("unjudged-at-fault");
    expect(summary?.signals[0]?.source).toBe("nordpool-umm");
  });

  test("refuses anything not labelled a draft, and malformed ships", () => {
    expect(parseDraftCaseSummary({ ...DRAFT_FIELDS, status: "finding", topShips: [], signals: [] })).toBeNull();
    expect(parseDraftCaseSummary({ ...DRAFT_FIELDS, topShips: [{ rank: 1 }], signals: [] })).toBeNull();
  });
});

describe("parseDraftCaseDetail", () => {
  test("reads every ranked ship with its sentences, and signals with excerpts", () => {
    const detail = parseDraftCaseDetail({ ...DRAFT_FIELDS, rankingSignalId: 3, ships: [SHIP], signals: [{ ...SIGNAL, excerpt: "Failure. Estlink 2 trip" }] });
    expect(detail?.ships).toEqual([SHIP]);
    expect(detail?.signals[0]?.excerpt).toBe("Failure. Estlink 2 trip");
    expect(detail?.rankingSignalId).toBe(3);
  });

  test("refuses a ship with an unknown rank basis", () => {
    expect(parseDraftCaseDetail({ ...DRAFT_FIELDS, rankingSignalId: 3, ships: [{ ...SHIP, basis: "guilty" }], signals: [] })).toBeNull();
  });
});

describe("parseFaultSignalSummary", () => {
  test("reads a signal with the cables it matched and its drafts", () => {
    const summary = parseFaultSignalSummary({ ...SIGNAL, endsAt: null, cables: [{ name: "HVDC Estlink 2", basis: "asset-name", distanceMetres: null }], draftCaseIds: [7] });
    expect(summary?.cables).toEqual([{ name: "HVDC Estlink 2", basis: "asset-name", distanceMetres: null }]);
    expect(summary?.draftCaseIds).toEqual([7]);
    expect(summary?.endsAtMs).toBeNull();
  });
});
