import { describe, expect, test } from "bun:test";
import { judgeRecorderHealth, parseRecorderSummary, type RecorderSummary } from "./recorder-summary";

const VALID_PAYLOAD = {
  checkedAt: "2026-10-17T02:24:59.068+00:00",
  lastRunAt: "2026-10-17T02:24:02.841+00:00",
  lastRunError: null,
  positionsLastHour: 398,
  shipsLastHour: 178,
  cablesWatched: 16,
};

function buildSummary(overrides: Partial<RecorderSummary>): RecorderSummary {
  return {
    checkedAt: new Date("2026-10-17T02:30:00Z"),
    lastRunAt: new Date("2026-10-17T02:29:10Z"),
    lastRunError: null,
    positionsLastHour: 398,
    shipsLastHour: 178,
    cablesWatched: 16,
    ...overrides,
  };
}

describe("parseRecorderSummary", () => {
  test("reads the database payload", () => {
    const parsed = parseRecorderSummary(VALID_PAYLOAD);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.lastRunAt?.toISOString()).toBe("2026-10-17T02:24:02.841Z");
      expect(parsed.value.shipsLastHour).toBe(178);
    }
  });

  test("accepts a recorder that never ran", () => {
    const parsed = parseRecorderSummary({ ...VALID_PAYLOAD, lastRunAt: null });
    expect(parsed.ok && parsed.value.lastRunAt).toBeNull();
  });

  test("rejects malformed payloads", () => {
    expect(parseRecorderSummary(null).ok).toBe(false);
    expect(parseRecorderSummary([VALID_PAYLOAD]).ok).toBe(false);
    expect(parseRecorderSummary({ ...VALID_PAYLOAD, checkedAt: "yesterday" }).ok).toBe(false);
    expect(parseRecorderSummary({ ...VALID_PAYLOAD, shipsLastHour: "178" }).ok).toBe(false);
    expect(parseRecorderSummary({ ...VALID_PAYLOAD, positionsLastHour: -1 }).ok).toBe(false);
    expect(parseRecorderSummary({ ...VALID_PAYLOAD, lastRunError: 500 }).ok).toBe(false);
  });
});

describe("judgeRecorderHealth", () => {
  test("is recording when the last run is recent and clean", () => {
    expect(judgeRecorderHealth(buildSummary({}))).toEqual({ kind: "recording", minutesSinceLastRun: 0 });
  });

  test("is failing when the last recent run reported an error", () => {
    const health = judgeRecorderHealth(buildSummary({ lastRunError: "Digitraffic answered 503" }));
    expect(health).toEqual({ kind: "failing", minutesSinceLastRun: 0, error: "Digitraffic answered 503" });
  });

  test("is stale after five quiet minutes, whatever the last error", () => {
    const health = judgeRecorderHealth(buildSummary({ lastRunAt: new Date("2026-10-17T02:25:00Z"), lastRunError: "timeout" }));
    expect(health).toEqual({ kind: "stale", minutesSinceLastRun: 5 });
  });

  test("never ran when there is no run at all", () => {
    expect(judgeRecorderHealth(buildSummary({ lastRunAt: null }))).toEqual({ kind: "never-ran" });
  });
});
