import { describe, expect, test } from "bun:test";
import { parseFeedCheck, toFeedCheckRegion } from "./feed-check-report";

const GULF_VERDICT = {
  verdict: "disagree" as const,
  sampleCount: 26,
  aisstreamShips: 867,
  sharedShips: 694,
  shipAgreementShare: 694 / 867,
  matchedPairs: 692,
  positionAgreementShare: 0.99856,
  reasons: ["Digitraffic holds 80% of the ships aisstream hears, under 90%"],
};

describe("parseFeedCheck", () => {
  test("reads back what the health route reports, shares rounded to 3 decimals", () => {
    const reported = toFeedCheckRegion("gulf-of-finland", GULF_VERDICT, 6);
    const parsed = parseFeedCheck(JSON.parse(JSON.stringify({ status: "ok", crossSource: [reported] })));
    expect(parsed).toEqual({ ok: true, value: [{ ...reported, shipAgreementShare: 0.8, positionAgreementShare: 0.999 }] });
  });

  test("fails when the server could not read the samples or a region is malformed", () => {
    expect(parseFeedCheck({ status: "ok", crossSource: { state: "unreachable" } }).ok).toBe(false);
    const reported = toFeedCheckRegion("gulf-of-finland", GULF_VERDICT, 6);
    expect(parseFeedCheck({ crossSource: [{ ...reported, verdict: "maybe" }] }).ok).toBe(false);
    expect(parseFeedCheck({ crossSource: [{ ...reported, shipAgreementShare: 1.4 }] }).ok).toBe(false);
  });
});
